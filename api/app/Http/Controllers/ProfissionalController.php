<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ProtegeExclusaoEmUso;
use App\Http\Requests\ProfissionalRequest;
use App\Models\Profissional;
use App\Models\Usuario;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class ProfissionalController extends Controller
{
    use ProtegeExclusaoEmUso;

    private const CAMPOS = [
        'id', 'nome', 'conselho', 'uf_conselho', 'num_conselho', 'cbos_id',
        'obs', 'ativo', 'atendimentos_simultaneos', 'mensagens_automaticas',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    public function index(): JsonResponse
    {
        return response()->json(
            Profissional::with(['especialidades:id,nome', 'horarios'])->orderBy('nome')->get()
                ->map(fn (Profissional $profissional) => $this->serializar($profissional))
        );
    }

    public function store(ProfissionalRequest $request): JsonResponse
    {
        $dados = $request->validated();

        // create + as duas sincronizações (especialidades e horários) são ATÔMICAS: uma falha
        // parcial deixaria horários zerados = "atende todos os dias" (fail-open silencioso).
        $profissional = DB::transaction(function () use ($dados) {
            $profissional = Profissional::create($dados);
            $this->sincronizarEspecialidadesAuditando($profissional, $dados['especialidades'] ?? []);
            $this->sincronizarHorariosAuditando($profissional, $dados['horarios'] ?? []);

            return $profissional;
        });

        return response()->json($this->serializar($profissional->load(['especialidades:id,nome', 'horarios'])), 201);
    }

    /**
     * A autorização vive AQUI, não no middleware (change ficha-do-profissional): além
     * de `profissionais.ver`, o DONO lê a própria ficha (`usuario.profissional_id ===
     * id`) — um profissional sempre pode ver o próprio cadastro, e escondê-lo atrás de
     * uma permissão que o papel escopado não tem seria a tela prometendo o que o
     * servidor nega. SÓ o show: index/criar/editar/excluir seguem no middleware.
     */
    public function show(int $id): JsonResponse
    {
        $usuario = request()->user();
        abort_unless(
            $usuario?->can('profissionais.ver') === true || $usuario?->profissional_id === $id,
            403,
        );

        return response()->json(
            $this->serializar(Profissional::with(['especialidades:id,nome', 'horarios'])->findOrFail($id))
        );
    }

    public function update(ProfissionalRequest $request, int $id): JsonResponse
    {
        $profissional = Profissional::findOrFail($id);
        ConcorrenciaOtimista::assegurar($profissional, $request);
        $dados = $request->validated();

        DB::transaction(function () use ($profissional, $dados): void {
            $profissional->update($dados);
            if (array_key_exists('especialidades', $dados)) {
                $this->sincronizarEspecialidadesAuditando($profissional, $dados['especialidades']);
            }
            if (array_key_exists('horarios', $dados)) {
                $this->sincronizarHorariosAuditando($profissional, $dados['horarios'] ?? []);
            }
        });

        return response()->json($this->serializar($profissional->load(['especialidades:id,nome', 'horarios'])));
    }

    public function destroy(int $id): Response
    {
        $profissional = Profissional::findOrFail($id);
        $fotoDoCadastro = $profissional->foto_path;

        // desvínculo + delete atômicos (gate r1, I2): se o delete falhar (futura FK
        // de agendamentos → 422), o desvínculo não pode persistir sozinho
        DB::transaction(function () use ($profissional): void {
            // desvincular explicitamente ANTES do delete: o nullOnDelete resolveria
            // no banco, mas sem trilha do lado do usuário (parecer T-vinc-02)
            Usuario::where('profissional_id', $profissional->id)
                ->first()
                ?->update(['profissional_id' => null]);

            $this->excluirProtegido(
                $profissional,
                'profissional',
                'Este profissional está vinculado a outros registros e não pode ser excluído.'
            );
        });

        // a foto é dado pessoal e não sobrevive à exclusão do cadastro (SEC-FP-02); DEPOIS do
        // commit — arquivo apagado com linha ainda viva seria o pior dos dois mundos
        if ($fotoDoCadastro !== null) {
            Storage::disk('local')->delete($fotoDoCadastro);
        }

        return response()->noContent();
    }

    /**
     * Pivot não dispara evento de model — auditar a mudança de especialidades
     * explicitamente (mesmo padrão da atribuição de nível das fundações).
     *
     * @param  list<int>  $especialidadeIds
     */
    private function sincronizarEspecialidadesAuditando(Profissional $profissional, array $especialidadeIds): void
    {
        $antes = $profissional->especialidades()->pluck('especialidades.id')->sort()->values()->all();

        $profissional->especialidades()->sync($especialidadeIds);

        $depois = collect($especialidadeIds)->map(fn ($id) => (int) $id)->sort()->values()->all();

        if ($antes !== $depois) {
            RegistroDeAuditoria::registrar($profissional, 'alterou_especialidades', [
                'antes' => ['especialidades' => $antes],
                'depois' => ['especialidades' => $depois],
            ]);
        }
    }

    private function serializar(Profissional $profissional): array
    {
        return [
            ...$profissional->only(self::CAMPOS),
            // a foto sai como VERSÃO (cache-bust); o caminho é interno (foto-do-profissional)
            'foto_versao' => $profissional->foto_atualizado_em?->format('YmdHis'),
            'horarios' => $profissional->mapaDeHorarios(),
            'especialidades' => $profissional->especialidades
                ->map(fn ($especialidade) => $especialidade->only(['id', 'nome']))
                ->values(),
        ];
    }

    /**
     * Sincroniza as linhas de `profissional_horarios` a partir do mapa validado
     * (`{ dia: [{inicio,fim}] }`; vazio ⇒ sem linhas = todos os dias). Delete+insert é
     * simples e correto para um conjunto pequeno; a mudança é auditada como a de
     * especialidades (relação não dispara evento de model).
     *
     * @param  array<int|string, list<array{inicio: string, fim: string}>>  $mapa
     */
    private function sincronizarHorariosAuditando(Profissional $profissional, array $mapa): void
    {
        $antes = $profissional->load('horarios')->mapaDeHorarios();

        $linhas = [];
        foreach ($mapa as $dia => $intervalos) {
            foreach ($intervalos as $intervalo) {
                $linhas[] = [
                    'dia_semana' => (int) $dia,
                    'inicio' => $intervalo['inicio'],
                    'fim' => $intervalo['fim'],
                ];
            }
        }

        // delete+insert do schedule (o store/update que chama já roda em DB::transaction, então
        // a falha parcial não deixa horários zerados = "atende todos os dias" — fail-closed).
        $profissional->horarios()->delete();
        if ($linhas !== []) {
            $profissional->horarios()->createMany($linhas);
        }

        $depois = $profissional->load('horarios')->mapaDeHorarios();

        if ($antes !== $depois) {
            RegistroDeAuditoria::registrar($profissional, 'alterou_horarios', [
                'antes' => ['horarios' => $antes],
                'depois' => ['horarios' => $depois],
            ]);
        }
    }
}
