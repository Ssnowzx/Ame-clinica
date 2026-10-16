<?php

namespace App\Http\Controllers;

use App\Http\Requests\AnamneseRequest;
use App\Models\Anamnese;
use App\Models\AnamneseModelo;
use App\Models\Paciente;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Clinica\ValidadorRespostasAnamnese;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Rbac\Escopo;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Anamnese respondida (§7) — dado sensível de saúde de MENOR (art. 11).
 * Sem DELETE no v1 (T-ate-11); respostas detail-only, cifradas e mascaradas no
 * diff; leitura do detalhe auditada.
 */
class AnamneseController extends Controller
{
    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
    ) {}

    /** O escopo CLÍNICO do usuário atual (D11 · SEC-VP-01). */
    private function escopoClinico(): Escopo
    {
        return $this->escopos->clinico(request()->user());
    }

    /** Listagem por paciente — metadados apenas, NUNCA respostas (T-ate-11). */
    public function index(Request $request, int $pacienteId): JsonResponse
    {
        // POSSE ANTES DA EXISTÊNCIA (`SEC-VP-46`, rodada 4): o `findOrFail` primeiro confirmava ao
        // escopado se a criança existe — inclusive a que recebeu alta, que a seleção esconde.
        $paciente = Paciente::find($pacienteId);
        // D11 (eixo CLÍNICO, art. 11): PORTÃO por-id — só as anamneses de um paciente SEU (403)
        $this->escopos->assegurarPaciente($this->escopoClinico(), $paciente?->id);
        abort_if($paciente === null, 404); // inexistente → 404 (só para o plano)

        $filtros = $request->validate([
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        $anamneses = Anamnese::query()
            ->where('paciente_id', $paciente->id)
            ->with('modelo:id,titulo')
            ->orderByDesc('preenchida_em')
            ->paginate($filtros['per_page'] ?? 50);

        $anamneses->getCollection()->transform(fn (Anamnese $anamnese): array => [
            'id' => $anamnese->id,
            'paciente_id' => $anamnese->paciente_id,
            'modelo' => $anamnese->modelo?->only(['id', 'titulo']),
            'preenchida_em' => $anamnese->preenchida_em->format('Y-m-d H:i'),
        ]);

        return response()->json($anamneses);
    }

    public function store(AnamneseRequest $request, int $pacienteId): JsonResponse
    {
        $paciente = Paciente::find($pacienteId);
        // D11 (eixo CLÍNICO, art. 11): só registra anamnese em paciente SEU (403). Posse antes da
        // existência (`SEC-VP-46`).
        $this->escopos->assegurarPaciente($this->escopoClinico(), $paciente?->id);
        abort_if($paciente === null, 404);
        $dados = $request->validated();

        $modelo = AnamneseModelo::findOrFail($dados['modelo_id']);
        if (! $modelo->ativo) {
            throw ValidationException::withMessages([
                'modelo_id' => 'Este modelo de anamnese está inativo.',
            ]); // T-ate-12: só na criação — edição tolera inativação posterior
        }

        $this->validarRespostas($modelo, $dados['respostas_json']);

        $anamnese = new Anamnese($dados);
        $anamnese->paciente_id = $paciente->id;
        // SEMPRE do servidor (T-ate-12), na parede da clínica (CR-03)
        $anamnese->preenchida_em = now($this->configuracoes->get('clinica.timezone'))
            ->format('Y-m-d H:i');
        $anamnese->save();

        return response()->json($this->serializar($anamnese->refresh()), 201);
    }

    /** Detalhe com respostas — leitura AUDITADA (art. 11, parecer §1). */
    public function show(int $id): JsonResponse
    {
        $anamnese = Anamnese::find($id);
        // D11 (eixo CLÍNICO, art. 11): respostas de saúde do menor — 403 se não é seu paciente,
        // ANTES de auditar (negar não registra a leitura do dado de outro) e ANTES da existência
        // (`SEC-VP-46`).
        $this->escopos->assegurarPaciente($this->escopoClinico(), $anamnese?->paciente_id);
        abort_if($anamnese === null, 404);

        RegistroDeAuditoria::registrar($anamnese, 'consultou', []);

        return response()->json($this->serializar($anamnese));
    }

    public function update(AnamneseRequest $request, int $id): JsonResponse
    {
        $anamnese = Anamnese::find($id);
        // D11 (eixo CLÍNICO, art. 11): edita respostas só de paciente SEU (403). Posse antes da
        // existência (`SEC-VP-46`).
        $this->escopos->assegurarPaciente($this->escopoClinico(), $anamnese?->paciente_id);
        abort_if($anamnese === null, 404);
        // posse antes da versão (SEC-OCC-02)
        ConcorrenciaOtimista::assegurar($anamnese, $request);
        $dados = $request->validated();

        $this->validarRespostas($anamnese->modelo, $dados['respostas_json']);

        $anamnese->update(['respostas_json' => $dados['respostas_json']]);

        return response()->json($this->serializar($anamnese->refresh()));
    }

    /** @param array<mixed> $respostas */
    private function validarRespostas(AnamneseModelo $modelo, array $respostas): void
    {
        $erros = ValidadorRespostasAnamnese::validar($modelo->campos_json, $respostas);

        if ($erros !== []) {
            throw ValidationException::withMessages($erros);
        }
    }

    private function serializar(Anamnese $anamnese): array
    {
        return collect($anamnese->attributesToArray())
            ->only(['id', 'paciente_id', 'modelo_id', 'respostas_json', 'preenchida_em', 'updated_at'])
            ->all();
    }
}
