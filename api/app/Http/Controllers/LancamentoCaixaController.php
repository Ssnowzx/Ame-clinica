<?php

namespace App\Http\Controllers;

use App\Http\Requests\LancamentoCaixaRequest;
use App\Models\LancamentoAnexo;
use App\Models\LancamentoCaixa;
use App\Support\Ciclos\GuardaDeCicloFechado;
use App\Support\Financeiro\LancamentoCaixaService;
use App\Support\Financeiro\LancamentosVisiveis;
use App\Support\Financeiro\NomesDosInteressados;
use App\Support\Financeiro\UltimaCobranca;
use App\Support\Http\ConcorrenciaOtimista;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

class LancamentoCaixaController extends Controller
{
    private const CAMPOS = [
        'id', 'tipo', 'competencia', 'vencimento', 'interessado_tipo', 'interessado_id',
        'categoria_id', 'subcategoria_id', 'valor', 'juros', 'multa', 'desconto',
        'tipo_pagamento_id', 'conta_id', 'contabil', 'documento', 'obs',
        'agendamento_id', 'tratamento_id', 'grupo_parcelamento', 'parcela',
        'parcelas_total', 'pago_em',
        'updated_at', // token da concorrência otimista (If-Match)
    ];

    /** obs é texto livre potencialmente sensível — detail-only (parecer §1.3). */
    private const CAMPOS_LISTAGEM = [
        'id', 'tipo', 'competencia', 'vencimento', 'interessado_tipo', 'interessado_id',
        'categoria_id', 'subcategoria_id', 'valor', 'juros', 'multa', 'desconto',
        'tipo_pagamento_id', 'conta_id', 'contabil', 'documento',
        'agendamento_id', 'grupo_parcelamento', 'parcela', 'parcelas_total', 'pago_em',
    ];

    public function __construct(
        private readonly LancamentoCaixaService $servico,
        private readonly GuardaDeCicloFechado $ciclos,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'tipo' => ['sometimes', Rule::in(LancamentoCaixa::TIPOS)],
            'pago' => ['sometimes', 'boolean'],
            'conta_id' => ['sometimes', 'integer'],
            'de' => ['sometimes', 'date_format:Y-m-d'],
            'ate' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:de'],
            // filtro por interessado — tipo e id JUNTOS (um sem o outro é 422, nunca
            // um filtro silenciosamente ignorado). É o que a seção Financeiro da ficha usa.
            // Sem `sometimes`: ele cancelaria o `required_with` (pula o campo ausente antes
            // de checar a exigência mútua); as regras não-implícitas (`in`/`integer`) já
            // não rodam em campo ausente.
            'interessado_tipo' => ['required_with:interessado_id', Rule::in(LancamentoCaixa::INTERESSADOS)],
            'interessado_id' => ['required_with:interessado_tipo', 'integer'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        // o salário só sai para quem vê a folha (change `financeiro-sem-faturamento-total`)
        $lancamentos = LancamentosVisiveis::filtrar(LancamentoCaixa::query())
            ->when($filtros['tipo'] ?? null, fn ($q, $tipo) => $q->where('tipo', $tipo))
            ->when(isset($filtros['pago']), fn ($q) => $filtros['pago']
                ? $q->whereNotNull('pago_em') : $q->whereNull('pago_em'))
            ->when(isset($filtros['conta_id']), fn ($q) => $q->where('conta_id', $filtros['conta_id']))
            ->when(isset($filtros['interessado_id']), fn ($q) => $q
                ->where('interessado_tipo', $filtros['interessado_tipo'])
                ->where('interessado_id', $filtros['interessado_id']))
            ->when($filtros['de'] ?? null, fn ($q, $de) => $q->where('vencimento', '>=', $de))
            ->when($filtros['ate'] ?? null, fn ($q, $ate) => $q->where('vencimento', '<=', $ate))
            ->orderBy('vencimento')
            ->paginate($filtros['per_page'] ?? 50);

        $nomes = NomesDosInteressados::de(collect($lancamentos->items()));
        // o selo "com anexo" (change `anexo-no-lancamento`): UMA consulta para a página, e nunca
        // `withExists` — ele injeta `lancamentos_caixa.*` e passa por cima da whitelist
        $comAnexo = LancamentoAnexo::query()
            ->whereIn('lancamento_id', collect($lancamentos->items())->pluck('id'))
            ->distinct()->pluck('lancamento_id')->flip();
        $lancamentos->getCollection()->transform(fn (LancamentoCaixa $l) => [
            ...self::serializarComInteressado($l, self::CAMPOS_LISTAGEM, $nomes),
            'tem_anexo' => $comAnexo->has($l->id),
        ]);

        return response()->json($lancamentos);
    }

    public function store(LancamentoCaixaRequest $request): JsonResponse
    {
        $linhas = $this->servico->criar($request->validated());

        if (count($linhas) === 1) {
            return response()->json($this->serializar($linhas[0]), 201);
        }

        return response()->json([
            'criados' => count($linhas),
            'grupo_parcelamento' => $linhas[0]->grupo_parcelamento,
            'lancamentos' => array_map(fn (LancamentoCaixa $l) => $this->serializar($l), $linhas),
        ], 201);
    }

    public function show(int $id): JsonResponse
    {
        return response()->json($this->serializar(LancamentosVisiveis::encontrar($id)));
    }

    public function update(LancamentoCaixaRequest $request, int $id): JsonResponse
    {
        $lancamento = LancamentosVisiveis::encontrar($id);
        ConcorrenciaOtimista::assegurar($lancamento, $request);

        return response()->json($this->serializar(
            $this->servico->atualizar($lancamento, $request->validated(), $request->estadoAutorizado)
        ));
    }

    public function destroy(Request $request, int $id): Response
    {
        $this->servico->excluir(
            LancamentosVisiveis::encontrar($id),
            $request->boolean('aplicar_no_grupo'),
        );

        return response()->noContent();
    }

    /** Transição própria atrás de lancamentos.pagar (T-fin-07). */
    public function pagar(int $id): JsonResponse
    {
        return response()->json($this->serializar(
            $this->servico->pagar(LancamentosVisiveis::encontrar($id))
        ));
    }

    public function estornarPagamento(int $id): JsonResponse
    {
        return response()->json($this->serializar(
            $this->servico->estornarPagamento(LancamentosVisiveis::encontrar($id))
        ));
    }

    /**
     * Detalhe + o booleano derivado do ciclo (SEC-FC-09) — a tela some com "Editar",
     * "Excluir", "Pagar" e "Estornar" quando a produção do período já foi enviada. Só aqui,
     * nunca na LISTAGEM: seriam 100 consultas por página, e a lista não tem essas ações.
     */
    private function serializar(LancamentoCaixa $lancamento): array
    {
        $nomes = NomesDosInteressados::de(collect([$lancamento]));

        return [
            ...self::serializarComInteressado($lancamento, self::CAMPOS, $nomes),
            'em_ciclo_fechado' => $this->ciclos->emCicloFechado(
                $lancamento->tratamento_id,
                $lancamento->competencia,
            ),
            // quem já abriu a cobrança desta receita, e quando (change `cobranca-pelo-whatsapp`) —
            // sem telefone nem texto: só o nome de quem cobrou
            'ultima_cobranca' => UltimaCobranca::de($lancamento),
        ];
    }

    /**
     * Interessado SEMPRE `{tipo, id, nome}` via whitelist — nunca o cadastro
     * (T-fin-21). Nomes resolvidos em lote para a listagem.
     */
    private static function serializarComInteressado(LancamentoCaixa $lancamento, array $campos, Collection $nomes): array
    {
        $base = [
            ...collect($lancamento->attributesToArray())->only($campos)->all(),
            'liquido' => $lancamento->liquido,
        ];

        if ($lancamento->interessado_tipo !== null) {
            $base['interessado'] = [
                'tipo' => $lancamento->interessado_tipo,
                'id' => $lancamento->interessado_id,
                'nome' => $nomes[$lancamento->interessado_tipo.'#'.$lancamento->interessado_id] ?? null,
            ];
        }

        return $base;
    }
}
