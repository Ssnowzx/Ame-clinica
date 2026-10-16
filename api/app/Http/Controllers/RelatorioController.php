<?php

namespace App\Http\Controllers;

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Categoria;
use App\Models\Evolucao;
use App\Models\LancamentoCaixa;
use App\Models\Profissional;
use App\Models\Tratamento;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Rbac\Escopo;
use App\Support\Rbac\EscopoDoProfissional;
use App\Support\Relatorios\CatalogoDeRelatorios;
use App\Support\Relatorios\Envelope;
use App\Support\Relatorios\ExportacaoDeRelatorio;
use App\Support\Relatorios\PlanilhaDoRelatorio;
use App\Support\Relatorios\Relatorio;
use App\Support\Relatorios\SessoesDosTratamentos;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\HeaderUtils;

/**
 * Relatórios do MVP (§11) — VISTAS agregadas: cada uma atrás da permissão do
 * módulo DONO (T-not-13, sem guarda-chuva). Agregação SEMPRE via Model::query()
 * (T-not-16) e somas em SQL (lição CR-04).
 */
class RelatorioController extends Controller
{
    private const JANELA_MAXIMA_DIAS = 366; // T-not-14

    /** As regras do período, compartilhadas pelos GETs agregados e pelo despacho por slug. */
    private const REGRAS_DE_PERIODO = [
        'de' => ['required', 'date_format:Y-m-d'],
        'ate' => ['required', 'date_format:Y-m-d', 'after_or_equal:de'],
    ];

    public function __construct(
        private readonly EscopoDoProfissional $escopos,
        private readonly CatalogoDeRelatorios $catalogo,
        private readonly SessoesDosTratamentos $sessoesDosTratamentos,
    ) {}

    /**
     * O ÍNDICE do catálogo (change `area-de-relatorios`, D4): slugs, títulos, permissões, eixo e
     * a régua AP-09 — sob login, sem permissão específica e SEM dado de negócio. É o que a
     * tela usa para montar o catálogo e esconder o cartão de quem não tem a permissão.
     */
    public function indice(): JsonResponse
    {
        return response()->json(['relatorios' => $this->catalogo->indice()]);
    }

    /**
     * O DESPACHO por slug (D1): 404 se o relatório não existe → 403 se falta QUALQUER permissão
     * declarada → 422 pelos parâmetros → envelope. Nesta ordem, e a ordem é segurança
     * (memória da casa): autorização ANTES de validação e de existência de parâmetro, senão o
     * 422 vira oráculo para quem nem podia perguntar.
     *
     * O escopo D11 entra pelo EIXO que o relatório declara (D6): agenda/clínico escopam pela
     * fonte única; eixo nulo é relatório da clínica (auditoria, caixa) e sai plano por
     * declaração, não por esquecimento.
     */
    public function executar(Request $request, string $slug): JsonResponse
    {
        [$envelope] = $this->pelaPorta($request, $slug);

        return response()->json($envelope->toArray());
    }

    /**
     * `GET /relatorios/{slug}/planilha` — o MESMO envelope, em CSV que o Excel pt-BR abre (change
     * `relatorio-em-planilha`). A porta é a do `executar` (D2): uma segunda autorização só da
     * planilha é como o furo do id fracionário aconteceu nesta casa. Cada planilha baixada vira
     * `exportou` na trilha — quem, qual relatório, quais parâmetros —, nunca o conteúdo (D4).
     */
    public function planilha(Request $request, string $slug): Response
    {
        // só os parâmetros VALIDADOS vão para a trilha (SEC-FIN-06): a query crua levava qualquer
        // chave que o cliente inventasse
        [$envelope, $parametros] = $this->pelaPorta($request, $slug);
        RegistroDeAuditoria::registrar(new ExportacaoDeRelatorio, 'exportou', [
            'depois' => ['relatorio' => $slug, 'parametros' => $parametros],
        ]);

        $nome = $envelope->periodo === null
            ? "{$slug}.csv"
            : "{$slug}_{$envelope->periodo['de']}_a_{$envelope->periodo['ate']}.csv";

        return response(PlanilhaDoRelatorio::csv($envelope), Response::HTTP_OK, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => HeaderUtils::makeDisposition(HeaderUtils::DISPOSITION_ATTACHMENT, $nome, 'relatorio.csv'),
        ]);
    }

    /**
     * A porta ÚNICA de um relatório da área: 404 se o slug não existe, 403 se falta QUALQUER
     * permissão declarada (antes de validar), 422 pelas regras, e o escopo do eixo.
     *
     * @return array{0: Envelope, 1: array<string, mixed>} o envelope e os parâmetros validados
     */
    private function pelaPorta(Request $request, string $slug): array
    {
        $relatorio = $this->catalogo->porSlug($slug);
        if ($relatorio === null) {
            abort(404, 'Relatório não encontrado.');
        }

        $usuario = $request->user();
        foreach ($relatorio->permissoes() as $permissao) {
            if (! $usuario->can($permissao)) {
                abort(403, 'Sem permissão para este relatório.');
            }
        }

        $parametros = $this->parametrosValidados($request, $relatorio);

        $escopo = match ($relatorio->eixo()) {
            'agenda' => $this->escopos->agenda($usuario),
            'clinico' => $this->escopos->clinico($usuario),
            null => Escopo::plano(),
        };

        return [$relatorio->executar($parametros, $escopo), $parametros];
    }

    /** Sob atendimentos.ver (D9/P4): fontes canônicas da etapa 6 (T-not-15). */
    public function producaoPorProfissional(Request $request): JsonResponse
    {
        [$de, $ate] = $this->periodoValidado($request);

        // D11 (#30, eixo CLÍNICO): o escopado vê só a PRÓPRIA linha. As três fontes contam trabalho
        // do profissional (atendimento/consumo pelo agendamento; evolução pela autoria) — o escopo
        // filtra cada uma pela coluna dona. Plano vê todas; sem vínculo → todas vazias.
        $escopo = $this->escopos->clinico($request->user());

        $atendimentos = $escopo->aplicar(
            Atendimento::query()
                ->join('agendamentos', 'agendamentos.id', '=', 'atendimentos.agendamento_id')
                ->whereBetween('atendimentos.finalizado_em', ["{$de} 00:00:00", "{$ate} 23:59:59"]),
            'agendamentos.profissional_id',
        )
            ->groupBy('agendamentos.profissional_id')
            ->selectRaw('agendamentos.profissional_id, COUNT(*) as total')
            ->pluck('total', 'profissional_id');

        // as sessões CONSUMIDAS pelo dia da SESSÃO, nunca pelo dia da baixa (change
        // producao-pelo-dia-da-sessao): a baixa de setembro feita em 1º de outubro inflava outubro.
        // É a mesma competência do fechamento de período do convênio, que decide pelo `inicio`
        $consumos = $escopo->aplicar(
            Agendamento::query()
                ->whereNotNull('sessao_consumida_em')
                ->whereBetween('inicio', ["{$de} 00:00:00", "{$ate} 23:59:59"]),
        )
            ->groupBy('profissional_id')
            ->selectRaw('profissional_id, COUNT(*) as total')
            ->pluck('total', 'profissional_id');

        $evolucoes = $escopo->aplicar(
            Evolucao::query()
                ->whereBetween('preenchida_em', ["{$de} 00:00:00", "{$ate} 23:59:59"]),
        )
            ->groupBy('profissional_id')
            ->selectRaw('profissional_id, COUNT(*) as total')
            ->pluck('total', 'profissional_id');

        $ids = $atendimentos->keys()->merge($consumos->keys())->merge($evolucoes->keys())->unique();
        $nomes = Profissional::whereIn('id', $ids)->pluck('nome', 'id');

        $linhas = $ids->map(fn ($id): array => [
            'profissional' => ['id' => (int) $id, 'nome' => $nomes[$id] ?? null],
            'atendimentos' => (int) ($atendimentos[$id] ?? 0),
            'sessoes_consumidas' => (int) ($consumos[$id] ?? 0),
            'evolucoes_preenchidas' => (int) ($evolucoes[$id] ?? 0),
        ])->sortBy(fn (array $l) => $l['profissional']['nome'])->values();

        return response()->json(['de' => $de, 'ate' => $ate, 'linhas' => $linhas]);
    }

    /** Sob fluxo_caixa.ver (agregado da clínica — totais-do-caixa): regime de CAIXA (pago_em — coerente com o extrato, D9/P4). */
    public function financeiroPorPeriodo(Request $request): JsonResponse
    {
        [$de, $ate] = $this->periodoValidado($request);

        $porCategoria = LancamentoCaixa::query()
            ->whereBetween('pago_em', ["{$de} 00:00:00", "{$ate} 23:59:59"])
            ->groupBy('tipo', 'categoria_id')
            ->selectRaw('tipo, categoria_id, SUM(valor + juros + multa - desconto) as total')
            ->get();

        $nomes = Categoria::whereIn('id', $porCategoria->pluck('categoria_id')->unique())
            ->pluck('nome', 'id');

        $totais = ['receita' => '0.00', 'despesa' => '0.00'];
        $linhas = $porCategoria->map(function ($linha) use (&$totais, $nomes): array {
            $totais[$linha->tipo] = bcadd($totais[$linha->tipo], (string) $linha->total, 2);

            return [
                'tipo' => $linha->tipo,
                'categoria' => ['id' => $linha->categoria_id, 'nome' => $nomes[$linha->categoria_id] ?? null],
                'total' => bcadd((string) $linha->total, '0', 2),
            ];
        });

        return response()->json([
            'de' => $de,
            'ate' => $ate,
            'linhas' => $linhas,
            'totais' => [
                'receitas' => $totais['receita'],
                'despesas' => $totais['despesa'],
                'saldo_do_periodo' => bcsub($totais['receita'], $totais['despesa'], 2),
                // transferências FORA dos totais (T-fin-19) — extrato as detalha
            ],
        ]);
    }

    /** Sob tratamentos.ver: vendido × realizado × saldo, fonte canônica da etapa 4/6. */
    public function sessoesVendidasRealizadas(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'status' => ['sometimes', Rule::in(Tratamento::STATUS)],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        // ESCOPO D11 do eixo AGENDA (`SEC-VP-45`, rodada 4): a lista é POR CRIANÇA — nome,
        // modalidade em tratamento, convênio e saldo —, o mesmo dado que `GET /tratamentos` recorta
        // para o profissional escopado. Aqui ele era plano sob a mesma `tratamentos.ver`: o
        // terapeuta lia, de toda criança da clínica, o que a change passou três rodadas escondendo
        // no `show`/`index`. Sem vínculo e sem `agenda.ver_todos`, relatório vazio (fail-closed).
        //
        // A BASE e a CONTA são as do relatório `sessoes-dos-tratamentos` (area-de-relatorios,
        // task 2.10): um número só para os dois — o JSON daqui não muda, só deixa de ter conta própria.
        $tratamentos = $this->sessoesDosTratamentos->consultaBase($this->escopos->agenda($request->user()))
            ->with(['paciente:id,nome', 'convenio:id,nome', 'especialidade:id,nome'])
            ->when($filtros['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->orderByDesc('id')
            ->paginate($filtros['per_page'] ?? 50);

        $tratamentos->getCollection()->transform(fn (Tratamento $t): array => [
            'tratamento_id' => $t->id,
            'paciente' => $t->paciente?->only(['id', 'nome']),
            'convenio' => $t->convenio?->only(['id', 'nome']),
            'especialidade' => $t->especialidade?->only(['id', 'nome']),
            'status' => $t->status,
            ...$this->sessoesDosTratamentos->sessoes($t),
        ]);

        return response()->json($tratamentos);
    }

    /** @return array{0: string, 1: string} */
    private function periodoValidado(Request $request): array
    {
        $filtros = $request->validate(self::REGRAS_DE_PERIODO);
        $this->assegurarJanela($filtros['de'], $filtros['ate']);

        return [$filtros['de'], $filtros['ate']];
    }

    /**
     * Os parâmetros de um relatório do catálogo: `de`/`ate` (quando ele usa período) + as
     * regras que ELE declara, validados de uma vez — um 422 só, com todos os erros. Só o que
     * foi validado atravessa (`validate()` descarta o resto): o boundary faz parse, não repasse.
     *
     * @return array<string, mixed>
     */
    private function parametrosValidados(Request $request, Relatorio $relatorio): array
    {
        $regras = $relatorio->usaPeriodo()
            ? [...self::REGRAS_DE_PERIODO, ...$relatorio->regras()]
            : $relatorio->regras();

        $parametros = $request->validate($regras);

        if ($relatorio->usaPeriodo()) {
            $this->assegurarJanela($parametros['de'], $parametros['ate']);
        }

        return $parametros;
    }

    /**
     * Teto de 366 dias (T-not-14) — 422 no mesmo formato do validador.
     *
     * O período é INCLUSIVO nas duas pontas, e é assim que a spec e a tela o contam
     * (`web/src/lib/relatorios/periodo.ts`: `diasDoPeriodo` soma 1). Comparar o `diffInDays`
     * cru contra 366 aceitava 367 dias inclusivos — 1º/01 a 02/01 do ano seguinte tem diff
     * 366 e passava (`CRR-15`). Agora 366 inclusivos (diff 365) passam e 367 recusam, que é
     * o mesmo limite dos dois lados.
     */
    private function assegurarJanela(string $de, string $ate): void
    {
        $inicio = Carbon::createFromFormat('Y-m-d', $de);
        $fim = Carbon::createFromFormat('Y-m-d', $ate);
        if ((int) $inicio->diffInDays($fim) + 1 > self::JANELA_MAXIMA_DIAS) {
            abort(response()->json([
                'message' => 'Janela máxima de '.self::JANELA_MAXIMA_DIAS.' dias.',
                'errors' => ['ate' => ['Janela máxima de '.self::JANELA_MAXIMA_DIAS.' dias.']],
            ], 422));
        }
    }
}
