<?php

namespace App\Http\Controllers;

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Categoria;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Subcategoria;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Indicadores\PeriodoComparado;
use App\Support\Indicadores\ProdutividadeDoMes;
use App\Support\Rbac\EscopoDoProfissional;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Indicadores do dashboard (§11) — VISTAS agregadas por mês: cada uma atrás da
 * permissão do módulo DONO (T-not-13, sem guarda-chuva). Agregação SEMPRE via
 * Model::query() (T-not-16), somas em SQL
 * (lição CR-04) e decimais como string. Séries de 6 meses SEM buracos: os
 * buckets são materializados aqui, não no cliente.
 */
class IndicadorController extends Controller
{
    private const MESES_DA_SERIE = 6;

    /**
     * Bandas etárias FIXAS (§11) para uma clínica neuro-pediátrica + faixa adulto —
     * `ate` é o teto inclusivo de anos completos; `null` é a banda aberta final.
     * Convenção de relatório, não regra de negócio (§13): não altera agenda/
     * financeiro/permissão — como `MESES_DA_SERIE`, é constante.
     */
    private const FAIXAS_ETARIAS = [
        ['faixa' => '0-2', 'ate' => 2],
        ['faixa' => '3-5', 'ate' => 5],
        ['faixa' => '6-8', 'ate' => 8],
        ['faixa' => '9-11', 'ate' => 11],
        ['faixa' => '12-14', 'ate' => 14],
        ['faixa' => '15-17', 'ate' => 17],
        ['faixa' => '18+', 'ate' => null],
    ];

    public function __construct(
        private readonly EscopoDoProfissional $escopos,
        private readonly ConfiguracaoService $configuracoes,
        private readonly ProdutividadeDoMes $produtividade,
    ) {}

    /**
     * Sob agenda.ver E atendimentos.ver (as duas encadeadas na rota): a produtividade do
     * profissional (§11, change produtividade-do-profissional) — capacidade pela grade real ×
     * marcado × realizado, com a perda discriminada. Escopo D11 pela INTERSEÇÃO dos dois eixos:
     * capacidade e marcações são dado da agenda, "realizado" é dado clínico — quem é plano num
     * eixo e escopado no outro vê só a própria linha. A conta vive em `ProdutividadeDoMes`.
     */
    public function produtividade(Request $request): JsonResponse
    {
        $mes = $this->mesValidado($request);

        return response()->json(
            $this->produtividade->calcular($mes, $this->escopos->agendaEClinico($request->user())),
        );
    }

    /** Sob atendimentos.ver, escopo D11 clínico: total por finalizado_em + quebras. */
    public function atendimentos(Request $request): JsonResponse
    {
        $mes = $this->mesValidado($request);
        $escopo = $this->escopos->clinico($request->user());
        $limites = $this->limitesDoMes($mes);

        // régua canônica da produção: atendimento CONTA quando finalizado (T-not-15)
        $base = fn () => $escopo->aplicar(
            Atendimento::query()
                ->join('agendamentos', 'agendamentos.id', '=', 'atendimentos.agendamento_id')
                ->whereBetween('atendimentos.finalizado_em', $limites),
            'agendamentos.profissional_id',
        );

        $porEspecialidade = $base()
            ->groupBy('agendamentos.especialidade_id')
            ->selectRaw('agendamentos.especialidade_id as especialidade_id, COUNT(*) as total')
            ->pluck('total', 'especialidade_id');
        $nomesDeEspecialidade = Especialidade::whereIn('id', $porEspecialidade->keys())
            ->pluck('nome', 'id');

        $porConvenio = $base()
            ->leftJoin('tratamentos', 'tratamentos.id', '=', 'agendamentos.tratamento_id')
            ->groupBy('tratamentos.convenio_id')
            ->selectRaw('tratamentos.convenio_id as convenio_id, COUNT(*) as total')
            ->get();
        $nomesDeConvenio = Convenio::whereIn('id', $porConvenio->pluck('convenio_id')->filter())
            ->pluck('nome', 'id');

        return response()->json([
            'mes' => $mes->format('Y-m'),
            'total' => $base()->count(),
            // relevância primeiro (escala): total desc — ordem por nome afunda o que importa
            'por_especialidade' => $porEspecialidade
                ->map(fn (int|string $total, int|string $id): array => [
                    'especialidade' => ['id' => (int) $id, 'nome' => $nomesDeEspecialidade[$id] ?? null],
                    'total' => (int) $total,
                ])
                ->sortByDesc('total')
                ->values(),
            'por_convenio' => $porConvenio
                ->map(fn ($linha): array => [
                    // sem convênio é LINHA PRÓPRIA (`convenio: null`) — o front rotula
                    'convenio' => $linha->convenio_id === null
                        ? null
                        : ['id' => (int) $linha->convenio_id, 'nome' => $nomesDeConvenio[$linha->convenio_id] ?? null],
                    'total' => (int) $linha->total,
                ])
                ->sortByDesc('total')
                ->values(),
        ]);
    }

    /**
     * Sob pacientes.ver: contagens + série + quebras demográficas — nunca lista/nome/id.
     *
     * `created_at` é UTC e o mês é o da PAREDE da clínica (CR-IND-05): os limites são convertidos
     * e a série agrupa pelo mês da clínica, como o painel (`PainelDosPacientes`). Sem isso, o
     * cadastro das 22h do último dia caía no mês seguinte aqui e no certo lá.
     */
    public function pacientes(Request $request): JsonResponse
    {
        $mes = $this->mesValidado($request);
        $fuso = (string) $this->configuracoes->get('clinica.timezone');
        $doMes = PeriodoComparado::limitesEmUtc($this->limitesDoMes($mes), $fuso);
        $deslocamento = now($fuso)->format('P');

        // "novo" é cadastro feito NESTE sistema: quem veio na importação da virada já era paciente da
        // clínica — a mesma regra do painel (PainelDosPacientes), para novos, série e indicação mensal
        // dizerem o mesmo número
        $novosPorMes = Paciente::query()
            ->whereNull('importado_clinicaagil_em')
            ->whereBetween('created_at', PeriodoComparado::limitesEmUtc($this->limitesDaSerie($mes), $fuso))
            ->toBase()
            ->selectRaw('DATE_FORMAT(CONVERT_TZ(created_at, ?, ?), ?) as mes, COUNT(*) as total', ['+00:00', $deslocamento, '%Y-%m'])
            ->groupBy('mes')
            ->pluck('total', 'mes');

        return response()->json([
            'mes' => $mes->format('Y-m'),
            'ativos' => Paciente::where('ativo', true)->count(),
            'novos_no_mes' => Paciente::whereNull('importado_clinicaagil_em')->whereBetween('created_at', $doMes)->count(),
            'serie' => $this->serie($mes, fn (string $chave): array => [
                'total' => (int) ($novosPorMes[$chave] ?? 0),
            ]),
            // quebras demográficas (§11) — foto da base ATIVA (só a `mensal` da indicação
            // usa o mês). Contagens e rótulos agregados, JAMAIS o dado de UM paciente.
            'por_sexo' => $this->quebraPorSexo(),
            'por_faixa_etaria' => $this->quebraPorFaixaEtaria(),
            'por_indicacao' => [
                'total' => $this->quebraPorIndicacao(Paciente::query()->where('ativo', true)),
                'mensal' => $this->quebraPorIndicacao(
                    Paciente::query()->whereNull('importado_clinicaagil_em')->whereBetween('created_at', $doMes),
                ),
            ],
            'por_convenio' => $this->quebraPorConvenio(),
        ]);
    }

    /**
     * Sob fluxo_caixa.ver: a tela Gráficos Financeiros (§11) — quatro blocos a partir
     * de UM parâmetro só. As duas quebras são do MÊS de `mes`; as duas séries são do
     * ANO dele (D2: dois controles de período podem discordar entre si, um não pode).
     *
     * **Custo: 10 queries numa requisição HTTP real.** São 4 agregações + `vencido` + 2
     * resoluções de nome por quebra (4 no total) + **a leitura de `clinica.timezone` que
     * `vencido()` faz**. Eu havia escrito 9: o harness em processo mostra 9 porque o
     * `ConfiguracaoService` memoiza por INSTÂNCIA e o container é reaproveitado; numa
     * requisição de verdade o container nasce novo e a consulta aparece (PERF-GRAF-08).
     *
     * As quatro agregações dependem do índice `(pago_em, vencimento)` para não
     * varrerem a tabela inteira. **Medido: p95 de ~292 ms sem ele para 89 ms com ele
     * (3,35×)**, com 200 mil linhas na tabela. *Eu havia escrito "542 ms" e "6,2×" — não
     * reproduzem; o "antes" da primeira medição saiu inflado por resíduo de buffer pool
     * (PERF-GRAF-07). O "depois" reproduz exato.*
     *
     * `serie_do_ano` é REALIZADO (caixa, bucket por `pago_em`); `previsao_do_ano` é o
     * que ainda NÃO foi pago, bucket por `vencimento`. São regimes DIFERENTES e
     * nenhum campo desta resposta soma os dois — a mesma disciplina que mantém
     * transferência fora de entradas/saídas (T-fin-19). A soma dos dois seria um
     * número que não existe em relatório nenhum, e alguém decidiria com ele.
     */
    public function graficosDoFinanceiro(Request $request): JsonResponse
    {
        $mes = $this->mesValidado($request);
        $limitesDoAno = $this->limitesDoAno($mes);

        // REALIZADO: o MESMO regime e a MESMA fórmula da série de 6 meses, só com a
        // janela do ano. `pago_em` é dateTime — a janela leva hora.
        $realizadoPorMes = LancamentoCaixa::query()
            ->whereBetween('pago_em', [$limitesDoAno[0].' 00:00:00', $limitesDoAno[1].' 23:59:59'])
            ->groupByRaw("DATE_FORMAT(pago_em, '%Y-%m'), tipo")
            ->selectRaw("DATE_FORMAT(pago_em, '%Y-%m') as mes, tipo, SUM(valor + juros + multa - desconto) as total")
            ->get()
            ->groupBy('mes');

        // PREVISÃO: só o que NÃO tem `pago_em`, bucket pelo vencimento. `vencimento`
        // é DATE (não dateTime) — a janela é de data pura, sem hora.
        $previstoPorMes = LancamentoCaixa::query()
            ->whereNull('pago_em')
            ->whereBetween('vencimento', $limitesDoAno)
            ->groupByRaw("DATE_FORMAT(vencimento, '%Y-%m'), tipo")
            ->selectRaw("DATE_FORMAT(vencimento, '%Y-%m') as mes, tipo, SUM(valor + juros + multa - desconto) as total")
            ->get()
            ->groupBy('mes');

        return response()->json([
            'mes' => $mes->format('Y-m'),
            'ano' => $mes->format('Y'),
            'recebido_por_categoria' => $this->quebraPorCategoria($mes, 'receita'),
            'pago_por_categoria' => $this->quebraPorCategoria($mes, 'despesa'),
            'serie_do_ano' => $this->serieDoAno($mes, fn (string $chave): array => [
                'recebidas' => $this->totalDoTipo($realizadoPorMes->get($chave, collect()), 'receita'),
                'pagas' => $this->totalDoTipo($realizadoPorMes->get($chave, collect()), 'despesa'),
            ]),
            'previsao_do_ano' => $this->serieDoAno($mes, fn (string $chave): array => [
                'a_receber' => $this->totalDoTipo($previstoPorMes->get($chave, collect()), 'receita'),
                'a_pagar' => $this->totalDoTipo($previstoPorMes->get($chave, collect()), 'despesa'),
            ]),
            'vencido' => $this->vencido($limitesDoAno),
        ]);
    }

    /**
     * A quebra do MÊS por categoria › subcategoria para um `tipo`. A natureza vem do
     * LANÇAMENTO (`lancamentos_caixa.tipo`), nunca da categoria — receita lançada numa
     * categoria de despesa continua sendo receita, e a coerência das duas é problema
     * da validação do lançamento, não desta vista.
     *
     * Achatada e ordenada por valor DESC no SQL (D6): o teto de 8 linhas + cauda
     * "Outras" da tela corta pelo FIM da lista, então a ordem tem de chegar pronta —
     * ranquear no cliente exigiria trazer tudo. A ordenação é do banco porque ele
     * ordena a SOMA decimal na origem, sem depender da semântica de comparação do
     * PHP para strings (que aqui até funcionaria: `"9.00" > "100.00"` é `false`,
     * PHP compara duas strings numéricas como número — mas isso vale para os
     * valores DESTA coluna, não é uma propriedade em que valha a pena apoiar).
     *
     * Os nomes vêm de consultas SEPARADAS nos models de categoria/subcategoria, cada
     * um pelo seu model (T-not-16) — o mesmo desenho de `quebraPorConvenio`.
     *
     * @return list<array{categoria_id: int, categoria: string|null, subcategoria_id: int|null, subcategoria: string|null, total: string}>
     */
    private function quebraPorCategoria(Carbon $mes, string $tipo): array
    {
        $linhas = LancamentoCaixa::query()
            ->where('tipo', $tipo)
            ->whereBetween('pago_em', $this->limitesDoMes($mes))
            ->groupBy('categoria_id', 'subcategoria_id')
            ->selectRaw('categoria_id, subcategoria_id, SUM(valor + juros + multa - desconto) as total')
            ->orderByDesc('total')
            ->get();

        // `unique()` porque várias subcategorias compartilham a mesma categoria: sem ele
        // o `IN` saía com o mesmo id repetido três, quatro vezes (achado PERF-GRAF-05).
        // Custo real irrisório, mas é lista que vai para o banco — vai limpa.
        $nomesDeCategoria = Categoria::whereIn('id', $linhas->pluck('categoria_id')->unique())
            ->pluck('nome', 'id');
        $nomesDeSubcategoria = Subcategoria::whereIn('id', $linhas->pluck('subcategoria_id')->filter()->unique())
            ->pluck('nome', 'id');

        return $linhas
            ->map(fn ($linha): array => [
                'categoria_id' => (int) $linha->categoria_id,
                'categoria' => $nomesDeCategoria[$linha->categoria_id] ?? null,
                // subcategoria ausente fica NULA — a tela mostra a categoria sozinha,
                // sem inventar um nível que o lançamento não tem
                'subcategoria_id' => $linha->subcategoria_id === null ? null : (int) $linha->subcategoria_id,
                'subcategoria' => $linha->subcategoria_id === null
                    ? null
                    : ($nomesDeSubcategoria[$linha->subcategoria_id] ?? null),
                'total' => bcadd((string) $linha->total, '0', 2),
            ])
            ->values()
            ->all();
    }

    /**
     * O não pago cujo vencimento JÁ PASSOU, dentro do mesmo ano dos buckets. É um
     * RECORTE de `previsao_do_ano` (o mesmo dinheiro visto por outro corte), nunca uma
     * parcela a mais — por isso a janela do ano entra aqui também: sem ela, "vencido"
     * traria dívida de anos anteriores e deixaria de ser subconjunto do que a tela
     * mostra. O rótulo da tela diz que é recorte.
     *
     * @param  array{0: string, 1: string}  $limitesDoAno
     * @return array{a_receber: string, a_pagar: string}
     */
    private function vencido(array $limitesDoAno): array
    {
        $porTipo = LancamentoCaixa::query()
            ->whereNull('pago_em')
            ->whereBetween('vencimento', $limitesDoAno)
            // "hoje" é a parede da CLÍNICA, nunca o relógio do servidor: `vencimento` e
            // `pago_em` são gravados no fuso da clínica (LancamentoCaixaService), e comparar
            // com UTC punha, das 21h à meia-noite em São Paulo, um dia inteiro de contas que
            // ainda vencem HOJE dentro de "já vencido" — errado e que se conserta sozinho de
            // manhã, o pior tipo de defeito para reproduzir (achado CR-GF-01 do gate)
            ->where('vencimento', '<', now($this->configuracoes->get('clinica.timezone'))->toDateString())
            ->groupBy('tipo')
            ->selectRaw('tipo, SUM(valor + juros + multa - desconto) as total')
            ->get();

        return [
            'a_receber' => $this->totalDoTipo($porTipo, 'receita'),
            'a_pagar' => $this->totalDoTipo($porTipo, 'despesa'),
        ];
    }

    /**
     * O drill-down do bloco Agenda: os ITENS de um status no mês — paginados (50),
     * whitelist mínima (id, início, paciente, profissional). Mesma permissão e mesmo
     * escopo do bloco que o origina (T-not-13/D11): o drill NUNCA mostra mais que a
     * caixa. Bloqueio não entra — a caixa conta atendimentos.
     *
     * `passadas=1` (change indicadores-profissionais, CR-IND-02): só as sessões que JÁ
     * PASSARAM (`inicio < agora` na parede da clínica) — o mesmo corte da tabela "Situação das
     * sessões que já passaram" do painel da agenda, que abre esta lista. Sem ele, a linha
     * "Finalizado 12" abria uma lista com as finalizadas de mais tarde também.
     */
    public function itensDaAgenda(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'mes' => ['required', 'date_format:Y-m'],
            'status_id' => ['required', 'integer'],
            'passadas' => ['sometimes', 'boolean'],
        ]);
        $mes = $this->mesAncorado($filtros['mes']);
        // status inexistente → 404, ANTES de tocar a lista
        $status = StatusAgendamento::findOrFail((int) $filtros['status_id']);
        $agoraNaParede = now((string) $this->configuracoes->get('clinica.timezone'))->format('Y-m-d H:i:s');

        $pagina = $this->escopos->agenda($request->user())->aplicar(
            Agendamento::query()
                ->with(['paciente:id,nome', 'profissional:id,nome'])
                ->where('tipo', 'atendimento')
                ->where('status_id', $status->id)
                ->whereBetween('inicio', $this->limitesDoMes($mes))
                ->when($request->boolean('passadas'), fn (Builder $consulta) => $consulta->where('inicio', '<', $agoraNaParede)),
        )
            // desempate por id: a grade em slots EMPATA `inicio` aos montes (20
            // profissionais às 08:00) e, sem tie-break, LIMIT/OFFSET repete/some
            // item entre páginas (CR-DD-01 — "estável em escala" é goal da change)
            ->orderByDesc('inicio')
            ->orderByDesc('id')
            ->paginate(50);

        // whitelist explícita no transform (lição WHITELIST-do-menor): nunca toArray() do model
        $pagina->getCollection()->transform(fn (Agendamento $item): array => [
            'id' => $item->id,
            'inicio' => $item->inicio->format('Y-m-d H:i'),
            'paciente' => $item->paciente === null ? null : ['id' => $item->paciente->id, 'nome' => $item->paciente->nome],
            'profissional' => $item->profissional === null ? null : ['id' => $item->profissional->id, 'nome' => $item->profissional->nome],
        ]);

        return response()->json($this->envelopeDeItens($mes, $status->nome, $pagina));
    }

    /**
     * O drill-down do bloco Atendimentos: os finalizados do mês por UMA dimensão
     * (profissional | especialidade | convênio), ou o mês inteiro sem dimensão (a
     * porta do TOTAL). EXCEÇÃO deliberada: `especialidade_id` PODE refinar
     * `profissional_id` — o combo pedido pela clínica. Duas bases → 422.
     */
    public function itensDeAtendimentos(Request $request): JsonResponse
    {
        $filtros = $request->validate([
            'mes' => ['required', 'date_format:Y-m'],
            'profissional_id' => ['sometimes', 'integer'],
            'especialidade_id' => ['sometimes', 'integer'],
            'convenio_id' => ['sometimes', 'integer'],
        ]);
        $mes = $this->mesAncorado($filtros['mes']);

        $temProfissional = array_key_exists('profissional_id', $filtros);
        $temEspecialidade = array_key_exists('especialidade_id', $filtros);
        $temConvenio = array_key_exists('convenio_id', $filtros);
        $bases = (int) $temProfissional + (int) $temEspecialidade + (int) $temConvenio;
        // é drill-down, não relatório: no MÁXIMO uma dimensão — salvo o combo da clínica
        if ($bases > 1 && ! ($temProfissional && $temEspecialidade && ! $temConvenio)) {
            throw ValidationException::withMessages([
                'filtro' => 'Escolha uma única dimensão (a especialidade pode refinar o profissional).',
            ]);
        }

        // cada âncora resolvida ANTES da lista: id inexistente → 404, nunca lista vazia ambígua
        $profissional = $temProfissional ? Profissional::findOrFail((int) $filtros['profissional_id']) : null;
        $especialidade = $temEspecialidade ? Especialidade::findOrFail((int) $filtros['especialidade_id']) : null;
        $convenio = $temConvenio ? Convenio::findOrFail((int) $filtros['convenio_id']) : null;
        $rotulo = implode(' · ', array_filter([
            $profissional?->nome,
            $especialidade?->nome,
            $convenio?->nome,
        ])) ?: 'Atendimentos finalizados';

        // D11 (eixo CLÍNICO) na relação-mãe, como na listagem de atendimentos (SEC-PF-01):
        // filtros em AND com o escopo na MESMA query — interseção por construção
        $pagina = $this->escopos->clinico($request->user())->aplicarNaRelacao(
            Atendimento::query()
                ->with([
                    'agendamento:id,paciente_id,profissional_id,especialidade_id,tratamento_id',
                    'agendamento.paciente:id,nome',
                    'agendamento.profissional:id,nome',
                    'agendamento.especialidade:id,nome',
                    'agendamento.tratamento:id,convenio_id',
                    'agendamento.tratamento.convenio:id,nome',
                ])
                ->whereBetween('finalizado_em', $this->limitesDoMes($mes)),
            'agendamento',
        )
            ->when($profissional !== null, fn ($q) => $q->whereHas(
                'agendamento',
                fn ($a) => $a->where('profissional_id', $profissional->id),
            ))
            ->when($especialidade !== null, fn ($q) => $q->whereHas(
                'agendamento',
                fn ($a) => $a->where('especialidade_id', $especialidade->id),
            ))
            ->when($convenio !== null, fn ($q) => $q->whereHas(
                'agendamento.tratamento',
                fn ($t) => $t->where('convenio_id', $convenio->id),
            ))
            // mesmo desempate do drill da agenda (CR-DD-01): finalizado_em empata no minuto
            ->orderByDesc('finalizado_em')
            ->orderByDesc('id')
            ->paginate(50);

        $pagina->getCollection()->transform(fn (Atendimento $item): array => [
            'id' => $item->id,
            'finalizado_em' => $item->finalizado_em?->format('Y-m-d H:i'),
            'paciente' => $item->agendamento?->paciente === null
                ? null
                : ['id' => $item->agendamento->paciente->id, 'nome' => $item->agendamento->paciente->nome],
            'profissional' => $item->agendamento?->profissional === null
                ? null
                : ['id' => $item->agendamento->profissional->id, 'nome' => $item->agendamento->profissional->nome],
            'especialidade' => $item->agendamento?->especialidade === null
                ? null
                : ['id' => $item->agendamento->especialidade->id, 'nome' => $item->agendamento->especialidade->nome],
            'convenio' => $item->agendamento?->tratamento?->convenio === null
                ? null
                : ['id' => $item->agendamento->tratamento->convenio->id, 'nome' => $item->agendamento->tratamento->convenio->nome],
        ]);

        return response()->json($this->envelopeDeItens($mes, $rotulo, $pagina));
    }

    /** `mes=YYYY-MM` obrigatório; ancorado no dia 1º (createFromFormat('Y-m') herdaria o DIA de hoje e estouraria mês curto). */
    private function mesValidado(Request $request): Carbon
    {
        $filtros = $request->validate(['mes' => ['required', 'date_format:Y-m']]);

        return $this->mesAncorado($filtros['mes']);
    }

    /** A MESMA âncora do dia 1º para um `YYYY-MM` já validado (CR-DD-06). */
    private function mesAncorado(string $mes): Carbon
    {
        return Carbon::createFromFormat('Y-m-d', $mes.'-01')->startOfDay();
    }

    /**
     * Envelope das vistas de ITENS — a whitelist que o tipo do web declara, e SÓ ela.
     * O `toArray()` cru do paginator embarcava `links`/`next_page_url` SEM os filtros
     * (segui-los daria 422) e metadados fora do contrato (CR-DD-07/SEC-DD-02).
     *
     * @param  LengthAwarePaginator<int, mixed>  $pagina
     * @return array<string, mixed>
     */
    private function envelopeDeItens(Carbon $mes, string $rotulo, $pagina): array
    {
        return [
            'mes' => $mes->format('Y-m'),
            'contexto' => ['rotulo' => $rotulo, 'total' => $pagina->total()],
            'data' => $pagina->items(),
            'current_page' => $pagina->currentPage(),
            'last_page' => $pagina->lastPage(),
            'per_page' => $pagina->perPage(),
            'total' => $pagina->total(),
        ];
    }

    /** @return array{0: string, 1: string} */
    private function limitesDoMes(Carbon $mes): array
    {
        return [
            $mes->copy()->startOfMonth()->format('Y-m-d 00:00:00'),
            $mes->copy()->endOfMonth()->format('Y-m-d 23:59:59'),
        ];
    }

    /** @return array{0: string, 1: string} — a janela dos 6 meses que TERMINAM no mês pedido */
    private function limitesDaSerie(Carbon $mes): array
    {
        return [
            $mes->copy()->startOfMonth()->subMonths(self::MESES_DA_SERIE - 1)->format('Y-m-d 00:00:00'),
            $mes->copy()->endOfMonth()->format('Y-m-d 23:59:59'),
        ];
    }

    /**
     * Materializa os buckets da série (mais antigo → mês pedido), zerando o que
     * o SQL não trouxe — série de gráfico não pode ter buraco.
     *
     * @param  callable(string): array<string, mixed>  $valores
     * @return list<array<string, mixed>>
     */
    private function serie(Carbon $mes, callable $valores): array
    {
        $buckets = [];
        for ($i = self::MESES_DA_SERIE - 1; $i >= 0; $i--) {
            $chave = $mes->copy()->subMonths($i)->format('Y-m');
            $buckets[] = ['mes' => $chave] + $valores($chave);
        }

        return $buckets;
    }

    /**
     * Janela de DATA (não dateTime) do ano de `$mes`: 1º de janeiro a 31 de dezembro.
     * Quem consulta `pago_em` (dateTime) acrescenta a hora; quem consulta `vencimento`
     * (date) usa como está.
     *
     * @return array{0: string, 1: string}
     */
    private function limitesDoAno(Carbon $mes): array
    {
        return [
            $mes->copy()->startOfYear()->format('Y-m-d'),
            $mes->copy()->endOfYear()->format('Y-m-d'),
        ];
    }

    /**
     * Os 12 buckets do ano de `$mes` (janeiro → dezembro), zerando o que o SQL não
     * trouxe — série de gráfico não pode ter buraco. Irmã de `serie()`, que faz o
     * mesmo para a janela de 6 meses terminada no mês pedido.
     *
     * @param  callable(string): array<string, mixed>  $valores  recebe a chave `Y-m` do bucket
     * @return list<array<string, mixed>>
     */
    private function serieDoAno(Carbon $mes, callable $valores): array
    {
        $janeiro = $mes->copy()->startOfYear();
        $buckets = [];
        for ($i = 0; $i < 12; $i++) {
            $chave = $janeiro->copy()->addMonths($i)->format('Y-m');
            $buckets[] = ['mes' => $chave] + $valores($chave);
        }

        return $buckets;
    }

    /**
     * O total de um `tipo` num bucket já agrupado, normalizado em duas casas como
     * STRING (D1 — dinheiro não vira float no caminho). Bucket sem a linha do tipo
     * devolve "0.00", não `null`.
     */
    private function totalDoTipo(Collection $doBucket, string $tipo): string
    {
        return bcadd((string) ($doBucket->firstWhere('tipo', $tipo)->total ?? '0'), '0', 2);
    }

    /**
     * Quebra da base ATIVA por sexo, relevância primeiro (soma = `ativos`).
     *
     * @return list<array{sexo: string, total: int}>
     */
    private function quebraPorSexo(): array
    {
        return Paciente::query()
            ->where('ativo', true)
            ->groupBy('sexo')
            ->selectRaw('sexo, COUNT(*) as total')
            ->get()
            ->map(fn ($linha): array => ['sexo' => (string) $linha->sexo, 'total' => (int) $linha->total])
            ->sortByDesc('total')
            ->values()
            ->all();
    }

    /**
     * Idade em anos completos na PAREDE da clínica (fuso da clínica, mesmo idioma de
     * PedidosMedicos/EvolucoesEmAberto), bucketizada nas bandas fixas. Todas as
     * bandas presentes mesmo zeradas (legenda estável, soma = `ativos`). Idade
     * negativa (nascimento futuro — dado ruim) cai na primeira banda.
     *
     * @return list<array{faixa: string, total: int}>
     */
    private function quebraPorFaixaEtaria(): array
    {
        // $hoje nasce de now()->toDateString() (Y-m-d server-gerado) — sem superfície
        // de injeção; interpolado uma vez para casar select e group by (idioma da casa)
        $hoje = now($this->configuracoes->get('clinica.timezone'))->toDateString();
        $idadeExpr = "TIMESTAMPDIFF(YEAR, nascimento, '{$hoje}')";

        $porIdade = Paciente::query()
            ->where('ativo', true)
            ->groupByRaw($idadeExpr)
            ->selectRaw("{$idadeExpr} as idade, COUNT(*) as total")
            ->get();

        $contagem = array_fill_keys(array_column(self::FAIXAS_ETARIAS, 'faixa'), 0);
        // pré-cadastro (pre-cadastro-de-paciente): nascimento ausente NÃO inventa idade —
        // linha própria "não informado" (padrão da indicação), partição preservada
        $semNascimento = 0;
        foreach ($porIdade as $linha) {
            if ($linha->idade === null) {
                $semNascimento += (int) $linha->total;

                continue;
            }
            $contagem[$this->faixaDaIdade((int) $linha->idade)] += (int) $linha->total;
        }

        $bandas = array_map(
            fn (array $faixa): array => ['faixa' => $faixa['faixa'], 'total' => $contagem[$faixa['faixa']]],
            self::FAIXAS_ETARIAS,
        );
        if ($semNascimento > 0) {
            $bandas[] = ['faixa' => 'não informado', 'total' => $semNascimento];
        }

        return $bandas;
    }

    /** A banda etária de uma idade (clamp inferior na primeira banda). */
    private function faixaDaIdade(int $idade): string
    {
        foreach (self::FAIXAS_ETARIAS as $faixa) {
            if ($faixa['ate'] === null || $idade <= $faixa['ate']) {
                return $faixa['faixa'];
            }
        }

        return self::FAIXAS_ETARIAS[array_key_last(self::FAIXAS_ETARIAS)]['faixa'];
    }

    /**
     * Quebra por indicação (canal de origem — texto livre; `null` = "não informado")
     * sobre a base dada: ATIVOS para o total, criados no mês para o mensal.
     *
     * @param  Builder<Paciente>  $base
     * @return list<array{indicacao: string|null, total: int}>
     */
    private function quebraPorIndicacao(Builder $base): array
    {
        return $base
            ->groupBy('indicacao')
            ->selectRaw('indicacao, COUNT(*) as total')
            ->get()
            ->map(fn ($linha): array => ['indicacao' => $linha->indicacao, 'total' => (int) $linha->total])
            ->sortByDesc('total')
            ->values()
            ->all();
    }

    /**
     * Pacientes ATIVOS distintos por convênio, via tratamentos: um paciente com
     * tratamentos em N convênios conta em cada linha (a soma NÃO particiona a base);
     * paciente sem tratamento não aparece. `tratamentos.convenio_id` é NOT NULL —
     * "particular" é um convênio com a flag `particular` (linha nomeada normal),
     * nunca `null`.
     *
     * @return list<array{convenio: array{id: int, nome: string|null}, total: int}>
     */
    private function quebraPorConvenio(): array
    {
        $linhas = Paciente::query()
            ->where('pacientes.ativo', true)
            ->join('tratamentos', 'tratamentos.paciente_id', '=', 'pacientes.id')
            ->groupBy('tratamentos.convenio_id')
            ->selectRaw('tratamentos.convenio_id as convenio_id, COUNT(DISTINCT pacientes.id) as total')
            ->get();

        $nomesDeConvenio = Convenio::whereIn('id', $linhas->pluck('convenio_id'))->pluck('nome', 'id');

        return $linhas
            ->map(fn ($linha): array => [
                'convenio' => ['id' => (int) $linha->convenio_id, 'nome' => $nomesDeConvenio[$linha->convenio_id] ?? null],
                'total' => (int) $linha->total,
            ])
            ->sortByDesc('total')
            ->values()
            ->all();
    }
}
