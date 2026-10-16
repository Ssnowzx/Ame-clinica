<?php

namespace App\Http\Controllers;

use App\Http\Requests\AtendimentoRequest;
use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Clinica\RegistroDeAtendimento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Http\ConcorrenciaOtimista;
use App\Support\Rbac\Escopo;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AtendimentoController extends Controller
{
    /** Código MySQL/MariaDB de violação de FK ao excluir linha referenciada. */
    private const ERRO_FK_RESTRICT = 1451;

    private const CAMPOS = ['id', 'agendamento_id', 'iniciado_em', 'finalizado_em', 'observacoes', 'updated_at'];

    /** observacoes é dado clínico detail-only (T-ate-03) — nunca em listagem. */
    private const CAMPOS_LISTAGEM = ['id', 'agendamento_id', 'iniciado_em', 'finalizado_em'];

    public function __construct(
        private readonly ConfiguracaoService $configuracoes,
        private readonly EscopoDoProfissional $escopos,
        private readonly RegistroDeAtendimento $registro,
        private readonly GuardaDeCicloFechado $ciclos,
    ) {}

    /** O escopo CLÍNICO do usuário atual (D11 · SEC-VP-01) — o dono é o agendamento-mãe. */
    private function escopoClinico(): Escopo
    {
        return $this->escopos->clinico(request()->user());
    }

    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'agendamento_id' => ['sometimes', 'integer'],
            'paciente_id' => ['sometimes', 'integer'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        // D11 (eixo CLÍNICO): o atendimento não carrega `profissional_id` — o dono é o do
        // agendamento-mãe. Escopado vê só os do próprio; plano vê todos; nenhum → nada.
        // O filtro `paciente_id` (prontuário da ficha) é um EXISTS independente em AND com
        // o escopo, na MESMA query (SEC-PF-01) — interseção por construção, nunca união.
        // Id inexistente/fora do escopo = 200 vazia, resposta uniforme
        // (SEC-PF-03): o filtro não é oráculo de existência de cadastro.
        $atendimentos = $this->escopoClinico()->aplicarNaRelacao(
            Atendimento::query()->with('evolucao:id,atendimento_id'),
            'agendamento',
        )
            ->when(isset($filtros['agendamento_id']), fn ($q) => $q->where('agendamento_id', $filtros['agendamento_id']))
            ->when(isset($filtros['paciente_id']), fn ($q) => $q->whereHas(
                'agendamento',
                fn ($a) => $a->where('paciente_id', $filtros['paciente_id'])
            ))
            ->orderByDesc('finalizado_em')
            ->paginate($filtros['per_page'] ?? 50);

        $atendimentos->getCollection()->transform(
            fn (Atendimento $a) => $this->serializar($a, self::CAMPOS_LISTAGEM)
        );

        return response()->json($atendimentos);
    }

    public function store(AtendimentoRequest $request, int $agendamentoId): JsonResponse
    {
        // POSSE ANTES DA EXISTÊNCIA (`SEC-VP-47`, rodada 4): com `findOrFail` primeiro, o escopado
        // recebia 404 para id inexistente e 403 para o agendamento do colega — a diferença
        // enumerava a densidade da agenda da clínica. Inexistente → `null` → 404 depois da posse.
        $agendamento = Agendamento::find($agendamentoId); // ANTES de abrir transação
        // D11 (eixo CLÍNICO): o escopado só registra atendimento no PRÓPRIO agendamento (403)
        $this->escopoClinico()->assegurarPosse($agendamento?->profissional_id);
        abort_if($agendamento === null, 404);

        $dados = $request->validated();
        $dados['finalizado_em'] ??= now($this->fusoDaClinica())->format('Y-m-d H:i');
        $this->validarTempos($dados['iniciado_em'] ?? null, $dados['finalizado_em']);

        // O OUTRO LADO DA CORRIDA (parecer SEC-AE-05). A guarda do PUT trava o agendamento e
        // recusa a troca de paciente / a conversão para bloqueio quando existe atendimento —
        // isso protege a direção "o PUT chega depois". Sem RELER o agendamento SOB LOCK aqui,
        // a direção "o atendimento chega depois" continua aberta: o PUT lê "sem atendimento",
        // o atendimento nasce, o PUT grava o paciente novo — e o prontuário fica colado na
        // criança errada, sem caminho de volta.
        //
        // O `unique(agendamento_id)` NÃO cobre isto: ele protege contra o POST duplo, não
        // contra um PUT concorrente.
        $atendimento = $this->registro->registrar($agendamentoId, $dados);

        return response()->json($this->serializar($atendimento->refresh()), 201);
    }

    /**
     * Detalhe com observações (texto potencialmente clínico) — leitura AUDITADA,
     * mesmo regime do prontuário (SEC-ate-01).
     */
    public function show(int $id): JsonResponse
    {
        $atendimento = Atendimento::find($id);
        // D11 (eixo CLÍNICO): 403 ANTES de auditar — negar não registra leitura do dado de outro.
        // Posse antes da existência (`SEC-VP-47`): inexistente e do colega respondem igual ao escopado.
        $this->escopoClinico()->assegurarPosse($atendimento?->agendamento()->value('profissional_id'));
        abort_if($atendimento === null, 404);

        RegistroDeAuditoria::registrar($atendimento, 'consultou', []);

        return response()->json($this->serializar($atendimento));
    }

    /**
     * O PUT passa a rodar sob transação + lock (D4). Antes ele gravava sem nenhum — o
     * estado sobre o qual as invariantes eram decididas podia mudar entre a leitura e o
     * `update`, e a guarda de ciclo herdaria esse TOCTOU (não só o dela: o `validarTempos`
     * também julgava um `finalizado_em` que podia já não ser o do banco).
     *
     * Ordem de gates preservada (SEC-FC-08): `findOrFail` → posse (403/404) → concorrência
     * (409/428) → ciclo (422). Um atendimento de OUTRO profissional em ciclo fechado
     * responde 403, jamais 422 — a recusa por ciclo nunca vira oráculo de existência.
     */
    public function update(AtendimentoRequest $request, int $id): JsonResponse
    {
        $atendimento = Atendimento::find($id);
        // D11 (eixo CLÍNICO): o escopado não edita atendimento de outro profissional (403).
        // Posse antes da existência (`SEC-VP-47`).
        $this->escopoClinico()->assegurarPosse($atendimento?->agendamento()->value('profissional_id'));
        abort_if($atendimento === null, 404);
        $dados = $request->validated();

        DB::transaction(function () use ($id, $request, $dados): void {
            // ordem de locks da casa: atendimentos ANTES de convenios (a guarda de ciclo
            // trava o convênio lá dentro) — nunca o inverso
            $travado = Atendimento::whereKey($id)->lockForUpdate()->firstOrFail();
            // posse antes da versão (SEC-OCC-02); versão antes das invariantes de domínio.
            // Sob o lock, como na evolução: comparar e gravar leem a MESMA linha travada
            ConcorrenciaOtimista::assegurar($travado, $request);

            // invariantes no ESTADO FINAL (T-ate-02)
            $finalizado = $dados['finalizado_em'] ?? $travado->finalizado_em->format('Y-m-d H:i');
            $iniciado = array_key_exists('iniciado_em', $dados)
                ? $dados['iniciado_em']
                : $travado->iniciado_em?->format('Y-m-d H:i');
            $this->validarTempos($iniciado, $finalizado);

            // DUPLA VERIFICAÇÃO ORIGEM→DESTINO (D4 — o fix do SEC-TE-01). Só o destino
            // deixaria "arrastar para fora", que é literalmente o contorno registrado; só a
            // origem deixaria "empurrar para dentro", sujando um ciclo já enviado.
            $tratamentoId = $travado->agendamento()->value('tratamento_id');
            $this->ciclos->assegurarPorTratamento([
                [$tratamentoId, $travado->finalizado_em], // origem
                [$tratamentoId, $finalizado],             // destino
            ]);

            $travado->update($dados);
        });

        return response()->json($this->serializar($atendimento->refresh()));
    }

    public function destroy(int $id): Response
    {
        $atendimento = Atendimento::find($id);
        // D11 (eixo CLÍNICO): o escopado não exclui atendimento de outro profissional (403).
        // Posse antes da existência (`SEC-VP-47`).
        $this->escopoClinico()->assegurarPosse($atendimento?->agendamento()->value('profissional_id'));
        abort_if($atendimento === null, 404);

        DB::transaction(function () use ($atendimento): void {
            $travado = Atendimento::whereKey($atendimento->id)->lockForUpdate()->firstOrFail();

            // a prova da sessão não some (T-ate-04): com evolução ou consumo → 422
            if ($travado->evolucao()->exists()) {
                throw ValidationException::withMessages([
                    'atendimento' => 'Atendimento com evolução registrada não pode ser excluído.',
                ]);
            }
            if ($travado->agendamento()->value('sessao_consumida_em') !== null) {
                throw ValidationException::withMessages([
                    'atendimento' => 'Atendimento com sessão consumida não pode ser excluído — estorne primeiro mudando o status.',
                ]);
            }

            // excluir é a forma mais completa de editar: some com a produção inteira do
            // período fechado. Aqui não há destino — só a origem existe.
            $this->ciclos->assegurarPorTratamento([
                [$travado->agendamento()->value('tratamento_id'), $travado->finalizado_em],
            ]);

            try {
                $travado->delete();
            } catch (QueryException $excecao) {
                // corrida DELETE × POST de evolução (CR-08): o FK restrict segura a
                // integridade; a violação vira o mesmo 422, nunca 500
                if (($excecao->errorInfo[1] ?? null) !== self::ERRO_FK_RESTRICT) {
                    throw $excecao;
                }
                throw ValidationException::withMessages([
                    'atendimento' => 'Atendimento com evolução registrada não pode ser excluído.',
                ]);
            }
        });

        return response()->noContent();
    }

    /** Parede da clínica, como na agenda: comparação naive no fuso da clínica. */
    private function validarTempos(?string $iniciado, string $finalizado): void
    {
        if ($finalizado > now($this->fusoDaClinica())->format('Y-m-d H:i')) {
            throw ValidationException::withMessages([
                'finalizado_em' => 'O atendimento não pode terminar no futuro.',
            ]);
        }

        if ($iniciado !== null && $iniciado > $finalizado) {
            throw ValidationException::withMessages([
                'iniciado_em' => 'O início não pode ser depois do fim do atendimento.',
            ]);
        }
    }

    /**
     * `evolucao_id` é o que a TELA precisa para saber se este atendimento já tem
     * prontuário — e para buscá-lo. Sem ele, a tela teria de adivinhar entre "escrever"
     * e "ler/editar", e não teria por onde carregar o detalhe.
     *
     * É um IDENTIFICADOR, nunca conteúdo: revela que a evolução existe, jamais o que ela
     * diz. O conteúdo continua atrás de `evolucoes.ver`, no `show`, e a leitura dele
     * continua auditada.
     *
     * @param  list<string>  $campos
     * @return array<string, mixed>
     */
    private function serializar(Atendimento $atendimento, array $campos = self::CAMPOS): array
    {
        $base = collect($atendimento->attributesToArray())->only($campos)->all();

        // SEC-FC-09 — booleano DERIVADO por registro, só no DETALHE: é o que a tela usa
        // para sumir com "Editar"/"Excluir" (D7). Nunca a lista de fechamentos, nunca o
        // calendário: a afordância informaria sobre o cadastro de convênios de quem não tem
        // `convenios.ver`. Fora da LISTAGEM de propósito — uma página de 100 atendimentos
        // faria 100 consultas para pintar um botão que a listagem nem tem.
        if ($campos === self::CAMPOS) {
            $base['em_ciclo_fechado'] = $this->ciclos->emCicloFechado(
                $atendimento->agendamento()->value('tratamento_id'),
                $atendimento->finalizado_em,
            );
        }

        // `evolucao_id` só para quem PODE ver ou escrever evolução (gate SEC F-03 + CR I-1).
        // Ele é identificador, nunca conteúdo — mas o que ele revela é o NEGATIVO: quem tem
        // `atendimentos.ver` e nenhuma permissão de evolução pagina a listagem e deriva a
        // fila inteira de quem está com prontuário atrasado. É o que `/evolucoes/em-aberto`
        // protege — e porta lateral que contorna uma permissão não é detalhe de serialização.
        // Quem tem `evolucoes.criar` é quem RESOLVE a pendência: sem o campo, o botão
        // "Escrever evolução" sumia exatamente para quem podia escrever (re-review I-1).
        $usuario = Auth::user();
        if ($usuario?->can('evolucoes.ver') !== true && $usuario?->can('evolucoes.criar') !== true) {
            return $base;
        }

        // a listagem faz eager load: consultar a relação linha a linha aqui seria N+1
        // numa página de até 100 atendimentos
        $evolucaoId = $atendimento->relationLoaded('evolucao')
            ? $atendimento->evolucao?->id
            : $atendimento->evolucao()->value('id');

        return [...$base, 'evolucao_id' => $evolucaoId];
    }

    private function fusoDaClinica(): string
    {
        return $this->configuracoes->get('clinica.timezone');
    }
}
