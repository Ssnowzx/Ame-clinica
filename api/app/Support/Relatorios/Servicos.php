<?php

namespace App\Support\Relatorios;

use App\Models\Agendamento;
use App\Models\Servico;
use App\Models\Tratamento;
use App\Support\Rbac\Escopo;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Relatório `servicos` (change `area-de-relatorios`, task 2.8): o RANKING por serviço em dois
 * grupos fixos — **Vendidos no período** (tratamentos abertos no período: quantidade e valor =
 * preço do serviço × sessões vendidas) e **Executados no período** (agendamentos do período
 * REALIZADOS pelas FLAGS do status — desconta a sessão e NÃO marca falta —, por serviço do
 * tratamento: quantidade;
 * valor 0,00 porque o executado não tem preço próprio neste envelope). Cobre, no ClinicaÁgil,
 * "Serviços Vendidos" e "Serviços Executados".
 *
 * É NUMÉRICO (AP-09): nenhum nome de criança em lugar nenhum — o teste de contrato varre.
 * Sob `tratamentos.ver`, eixo AGENDA (D11 — ver `eixo()`): vendidos pela coluna dona do
 * tratamento, executados pela do agendamento.
 *
 * O VALOR é dinheiro da clínica — a soma dos vendidos refaz o faturamento por outro caminho —, e
 * só sai para quem tem `fluxo_caixa.ver` (change `financeiro-sem-faturamento-total`, D4): sem ela,
 * some a COLUNA (não um zero, que diria "não vendeu"), o valor dos totais e a ordenação por valor.
 *
 * Serviço é (procedimento, convênio) — o preço muda por operadora —, então a linha diz os dois.
 * Tratamento sem serviço (e sessão realizada sem pacote) entra em "Sem serviço": nunca some da
 * soma (design, riscos).
 */
final class Servicos implements Relatorio
{
    /** @var list<string> */
    public const ORDENACOES = ['quantidade', 'valor'];

    private const ROTULO_DA_ORDENACAO = [
        'quantidade' => 'Quantidade',
        'valor' => 'Valor',
    ];

    private const SEM_SERVICO = 'Sem serviço';

    public function __construct(private readonly PeriodoDoTratamento $periodo) {}

    public function slug(): string
    {
        return 'servicos';
    }

    public function titulo(): string
    {
        return 'Serviços';
    }

    public function permissoes(): array
    {
        return ['tratamentos.ver'];
    }

    /**
     * Eixo AGENDA (D11) — o mesmo de `SessoesDosTratamentos`, e pelo mesmo motivo
     * (`SEC-REL-01`/`CRR-01`): §12 põe pacote e criança no alcance OPERACIONAL do eixo agenda,
     * e é por ele que as portas donas deste dado escopam. Com `clinico`, Secretaria e Faturista
     * (`agenda.ver_todos`, sem `clinico.ver_todos`, sem vínculo — AP-10) recebiam folha em
     * branco, e quem tem só `clinico.ver_todos` saía plano aqui e escopado na porta antiga.
     * Amarrado, papel a papel, por `RelatoriosEixoDoEscopoTest`.
     */
    public function eixo(): ?string
    {
        return 'agenda';
    }

    public function expoeNomeDaCrianca(): bool
    {
        return false;
    }

    public function usaPeriodo(): bool
    {
        return true;
    }

    public function regras(): array
    {
        return [
            'ordenar' => ['sometimes', Rule::in(self::ORDENACOES)],
        ];
    }

    public function executar(array $parametros, Escopo $escopo): Envelope
    {
        $ordenar = $parametros['ordenar'] ?? 'quantidade';
        $comValor = Auth::user()?->can('fluxo_caixa.ver') === true;
        if (! $comValor && $ordenar === 'valor') {
            // ordenar pelo dinheiro sem mostrá-lo ainda revelaria o ranking do faturamento
            throw ValidationException::withMessages([
                'ordenar' => 'Ordenar por valor é para quem vê o caixa da clínica.',
            ]);
        }
        $de = $parametros['de'];
        $ate = $parametros['ate'];

        $vendidos = $this->vendidos($de, $ate, $escopo);
        $executados = $this->executados($de, $ate, $escopo);

        // um nome por serviço, buscado UMA vez para os dois grupos
        $titulos = $this->titulos($vendidos->pluck('chave')->merge($executados->pluck('chave')));

        $linhasVendidas = $this->ranking($vendidos, $titulos, $ordenar, $comValor);
        $linhasExecutadas = $this->ranking($executados, $titulos, $ordenar, $comValor);

        $valorVendido = $vendidos->reduce(fn (string $soma, array $l): string => bcadd($soma, $l['valor'], 2), '0.00');

        return new Envelope(
            slug: $this->slug(),
            titulo: $this->titulo(),
            periodo: ['de' => $de, 'ate' => $ate],
            filtrosAplicados: [['rotulo' => 'Ordenado por', 'valor' => self::ROTULO_DA_ORDENACAO[$ordenar]]],
            colunas: [
                ['chave' => 'servico', 'rotulo' => 'Serviço', 'tipo' => 'texto'],
                ['chave' => 'quantidade', 'rotulo' => 'Quantidade', 'tipo' => 'numero'],
                ...($comValor ? [['chave' => 'valor', 'rotulo' => 'Valor', 'tipo' => 'dinheiro']] : []),
            ],
            linhas: [],
            grupos: $this->gruposComLinha([
                [
                    'titulo' => 'Vendidos no período',
                    'linhas' => $linhasVendidas,
                    'totais' => ['quantidade' => (int) $vendidos->sum('quantidade'), ...($comValor ? ['valor' => $valorVendido] : [])],
                ],
                [
                    'titulo' => 'Executados no período',
                    'linhas' => $linhasExecutadas,
                    'totais' => ['quantidade' => (int) $executados->sum('quantidade'), ...($comValor ? ['valor' => '0.00'] : [])],
                ],
            ]),
            totais: [
                'vendidos' => (int) $vendidos->sum('quantidade'),
                'executados' => (int) $executados->sum('quantidade'),
                ...($comValor ? ['valor_vendido' => $valorVendido] : []),
            ],
        );
    }

    /**
     * Só os grupos QUE TÊM LINHA (`CRR-07`).
     *
     * Os dois grupos daqui são CABEÇALHOS de ranking, não linhas — mas o `Envelope` conta grupo
     * vazio como 1, porque no sintético por dimensão o grupo É a linha da tabela. Com o recorte
     * sem dado nenhum, `servicos` devolvia `contagem: 2` e zero linha: a tela nunca chegava ao
     * vazio explicado nem ao botão Imprimir, e o papel saía com dois títulos e nada embaixo.
     * Omitindo, os dois vazios viram `grupos: []` e `contagem: 0` — o vazio que a tela entende.
     *
     * @param  list<array{titulo: string, linhas: list<array<string, mixed>>, totais: array<string, int|float|string>}>  $grupos
     * @return list<array{titulo: string, linhas: list<array<string, mixed>>, totais: array<string, int|float|string>}>
     */
    private function gruposComLinha(array $grupos): array
    {
        return array_values(array_filter($grupos, fn (array $grupo): bool => $grupo['linhas'] !== []));
    }

    /**
     * Vendidos: tratamentos abertos no período, por `servico_id`, somados NO BANCO (CR-04) — o
     * preço entra por left join; sem serviço o produto é nulo e a soma vale 0.
     *
     * @return Collection<int, array{chave: int|null, quantidade: int, valor: string}>
     */
    private function vendidos(string $de, string $ate, Escopo $escopo): Collection
    {
        $abertura = $this->periodo->expressaoDeAbertura();

        return $escopo->aplicar(Tratamento::query(), 'tratamentos.profissional_id')
            ->whereRaw("{$abertura} BETWEEN ? AND ?", [$de, $ate])
            ->leftJoin('servicos', fn (JoinClause $join) => $join
                ->on('servicos.id', '=', 'tratamentos.servico_id'))
            ->selectRaw('tratamentos.servico_id as chave, COUNT(*) as quantidade, '
                .'COALESCE(SUM(servicos.valor * tratamentos.sessoes_total), 0) as valor')
            ->groupBy('tratamentos.servico_id')
            ->get()
            ->map(fn ($linha): array => [
                'chave' => $linha->chave === null ? null : (int) $linha->chave,
                'quantidade' => (int) $linha->quantidade,
                'valor' => bcadd((string) $linha->valor, '0', 2),
            ]);
    }

    /**
     * Executados: agendamentos de atendimento do período REALIZADOS pelo helper canônico
     * (`SituacaoDoAgendamento::realizados` — desconta a sessão E não marca falta), por serviço
     * do tratamento (left join: sessão sem pacote é "Sem serviço").
     *
     * Filtrar só por `desconta_sessao` era o defeito `CRR-02`/`CRR-06`: o "Não Compareceu" do
     * catálogo padrão tem AS DUAS flags, e a falta cobrada entrava aqui como execução — este
     * relatório contava 1 onde `atendimentos`, que já usa o helper, contava 0.
     *
     * @return Collection<int, array{chave: int|null, quantidade: int, valor: string}>
     */
    private function executados(string $de, string $ate, Escopo $escopo): Collection
    {
        $consulta = SituacaoDoAgendamento::realizados(
            Agendamento::query()
                ->where('agendamentos.tipo', 'atendimento')
                ->whereBetween('agendamentos.inicio', ["{$de} 00:00:00", "{$ate} 23:59:59"])
        );

        return $escopo->aplicar($consulta, 'agendamentos.profissional_id')
            ->leftJoin('tratamentos', fn (JoinClause $join) => $join
                ->on('tratamentos.id', '=', 'agendamentos.tratamento_id'))
            ->selectRaw('tratamentos.servico_id as chave, COUNT(*) as quantidade')
            ->groupBy('tratamentos.servico_id')
            ->get()
            ->map(fn ($linha): array => [
                'chave' => $linha->chave === null ? null : (int) $linha->chave,
                'quantidade' => (int) $linha->quantidade,
                'valor' => '0.00',
            ]);
    }

    /**
     * "Procedimento (Convênio)" por id de serviço — o serviço é a dupla, e o preço muda por
     * operadora. Só os ids que apareceram, num `whereIn` escopado pelo model.
     *
     * @param  Collection<int, int|null>  $chaves
     * @return array<int, string>
     */
    private function titulos(Collection $chaves): array
    {
        $ids = $chaves->filter(fn ($chave) => $chave !== null)->unique()->values();
        if ($ids->isEmpty()) {
            return [];
        }

        return Servico::whereIn('id', $ids)
            ->with('convenio:id,nome')
            ->get(['id', 'procedimento', 'convenio_id'])
            ->mapWithKeys(fn (Servico $s): array => [
                $s->id => $s->convenio === null ? $s->procedimento : "{$s->procedimento} ({$s->convenio->nome})",
            ])
            ->all();
    }

    /**
     * O ranking: decrescente pelo pedido (`quantidade` ou `valor`), depois pelo outro, e o nome
     * como desempate — "Sem serviço" por último entre iguais. Dinheiro comparado em decimal.
     * Sem o valor, ele não desempata nem sai na linha: a ordem entre iguais também o contaria.
     *
     * @param  Collection<int, array{chave: int|null, quantidade: int, valor: string}>  $agregado
     * @param  array<int, string>  $titulos
     * @return list<array{servico: string, quantidade: int, valor?: string}>
     */
    private function ranking(Collection $agregado, array $titulos, string $ordenar, bool $comValor): array
    {
        $porQuantidade = fn (array $a, array $b): int => $b['quantidade'] <=> $a['quantidade'];
        $porValor = fn (array $a, array $b): int => bccomp($b['valor'], $a['valor'], 2);
        $semDesempate = fn (): int => 0;
        [$primario, $secundario] = match (true) {
            $ordenar === 'valor' => [$porValor, $porQuantidade],
            $comValor => [$porQuantidade, $porValor],
            default => [$porQuantidade, $semDesempate],
        };

        return $agregado
            ->map(fn (array $l): array => [
                'servico' => $l['chave'] === null ? self::SEM_SERVICO : ($titulos[$l['chave']] ?? self::SEM_SERVICO),
                'quantidade' => $l['quantidade'],
                'valor' => $l['valor'],
                'sem_servico' => $l['chave'] === null,
            ])
            ->sort(fn (array $a, array $b): int => $primario($a, $b)
                ?: $secundario($a, $b)
                ?: ($a['sem_servico'] <=> $b['sem_servico'])
                ?: strcmp(mb_strtolower($a['servico']), mb_strtolower($b['servico'])))
            ->map(fn (array $l): array => [
                'servico' => $l['servico'],
                'quantidade' => $l['quantidade'],
                ...($comValor ? ['valor' => $l['valor']] : []),
            ])
            ->values()
            ->all();
    }
}
