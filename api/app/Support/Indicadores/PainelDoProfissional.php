<?php

namespace App\Support\Indicadores;

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\TipoPagamento;
use App\Support\Clinica\PacotesAcabando;
use App\Support\Rbac\Escopo;
use App\Support\Relatorios\RecebidoPorProfissional;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\JoinClause;

/**
 * `GET /api/profissionais/{id}/painel` (change painel-do-profissional, D1/D7) — o mês de UM
 * profissional numa chamada.
 *
 * Os blocos de agenda, produtividade, equipe e pacientes são as saídas dos painéis de Indicadores
 * calculadas com `Escopo::de({id})`: as classes já recebem o escopo, então o recorte de um
 * profissional sai das MESMAS regras, sem cópia — o número da ficha e o da linha dele em
 * Indicadores › Equipe são, por construção, um só (a lição de "o mesmo número em duas telas").
 *
 * Quais blocos vêm é decidido no BOUNDARY (`PainelDoProfissionalController`, D3/D4) e chega aqui
 * como lista: esta classe só calcula o que lhe pedem. Bloco fora da lista não é calculado nem
 * aparece — ausência é negação, nunca um zero.
 *
 * Só agregados nos blocos dos Indicadores; o nome de criança sai SÓ nas sessões sem pagamento do
 * financeiro (D4), que o profissional já vê na própria agenda.
 */
final class PainelDoProfissional
{
    /** Seis meses de tendência (decisão do dono, 2026-10-15). */
    public const MESES_DA_SERIE = 6;

    /** Teto declarado da lista nominal das sessões sem pagamento — a `quantidade` conta todas. */
    public const TETO_SEM_PAGAMENTO = 200;

    public function __construct(
        private readonly PainelDaAgenda $agenda,
        private readonly PainelDaEquipe $equipe,
        private readonly PacotesAcabando $pacotesAcabando,
        private readonly ProdutividadeDoMes $produtividade,
    ) {}

    /**
     * @param  list<string>  $blocos  o que quem pede pode ver, decidido no boundary: `agenda`, `produtividade`,
     *                                `equipe`, `pacientes` e `financeiro`
     * @return array<string, mixed>
     */
    public function calcular(Profissional $profissional, PeriodoComparado $periodo, array $blocos): array
    {
        $escopo = Escopo::de($profissional->id);
        $comparacao = ComparacaoDoPainel::para($periodo);
        $tem = fn (string $bloco): bool => in_array($bloco, $blocos, true);

        $painel = [
            'profissional' => [
                'id' => $profissional->id,
                'nome' => $profissional->nome,
                'foto_versao' => $profissional->foto_atualizado_em?->format('YmdHis'),
            ],
            ...$comparacao->cabecalho(),
        ];

        if ($tem('agenda')) {
            $painel['agenda'] = $this->agenda->calcular($periodo, $escopo);
        }
        if ($tem('produtividade')) {
            $painel['produtividade'] = $this->linhaDaProdutividade($periodo, $escopo);
        }
        if ($tem('equipe')) {
            $painel['equipe'] = $this->equipe->calcular($periodo, $escopo, $escopo);
        }
        if ($tem('pacientes')) {
            // do painel de pacientes, SÓ o que segue o escopo do profissional: os pacotes no fim, pela
            // MESMA consulta do sino e do painel (`PacotesAcabando`). `ativos`, `novos` e `sairam` são da
            // clínica inteira (integração, 2026-10-15), e a fila também: nem são calculados (gate r1, I2)
            $painel['pacientes'] = ['pacotes_no_fim' => $this->pacotesAcabando->consulta($escopo)->count()];
        }
        if ($tem('produtividade') || $tem('financeiro')) {
            $painel['serie'] = $this->serie($profissional->id, $comparacao, $tem('produtividade'), $tem('financeiro'));
        }
        if ($tem('financeiro')) {
            // o nome das crianças só para quem vê a agenda dele, onde esses nomes já estão (SEC-PP-02)
            $painel['financeiro'] = $this->financeiro($profissional->id, $comparacao, comNomes: $tem('agenda'));
        }

        return $painel;
    }

    /**
     * A LINHA do profissional na produtividade do mês — `null` quando ele não está ativo (a vista só
     * lista os ativos). É a mesma chamada de `/indicadores/produtividade`, no escopo dele.
     *
     * @return array<string, mixed>|null
     */
    private function linhaDaProdutividade(PeriodoComparado $periodo, Escopo $escopo): ?array
    {
        $mes = Carbon::createFromFormat('Y-m-d', $periodo->mes.'-01')->startOfDay();

        return $this->produtividade->calcular($mes, $escopo)['linhas'][0] ?? null;
    }

    /**
     * Os seis meses que terminam no mês pedido (D2). Realizados e faltas pelos baldes da
     * produtividade (uma consulta agrupada por mês); o recebido pelo recorte do financeiro (outra).
     * Antes do início dos indicadores, `sem_dados` e os valores `null` — nunca zero. O mês corrente
     * vem `parcial`.
     *
     * Cada chave de valor só existe com o bloco dono: `realizados`/`faltas` com a produtividade,
     * `recebido` com o financeiro.
     *
     * @return list<array<string, mixed>>
     */
    private function serie(int $profissionalId, ComparacaoDoPainel $comparacao, bool $comAgenda, bool $comDinheiro): array
    {
        $periodo = $comparacao->periodo;
        $meses = $periodo->mesesDaSerie(self::MESES_DA_SERIE);
        $ultimoMes = $meses[count($meses) - 1];

        $contagens = $comAgenda
            // cortada no "já passou", como o cartão de realizados do mesmo quadro
            ? $this->produtividade->realizadosEFaltasPorMes(Escopo::de($profissionalId), $meses[0], $ultimoMes, $periodo->agoraNaParede())
            : [];
        $recebidos = $comDinheiro ? $this->recebidoPorMes($profissionalId, $meses[0], $ultimoMes) : [];

        return array_map(function (string $mes) use ($comparacao, $periodo, $contagens, $recebidos, $comAgenda, $comDinheiro): array {
            $semDados = ! $comparacao->temHistorico($mes);
            $item = [
                'mes' => $mes,
                'parcial' => $periodo->parcial && $mes === $periodo->mes,
                'sem_dados' => $semDados,
            ];
            if ($comAgenda) {
                $item['realizados'] = $semDados ? null : ($contagens[$mes]['realizados'] ?? 0);
                $item['faltas'] = $semDados ? null : ($contagens[$mes]['faltas'] ?? 0);
            }
            if ($comDinheiro) {
                $item['recebido'] = $semDados ? null : ComparacaoDoPainel::dinheiro($recebidos[$mes] ?? '0');
            }

            return $item;
        }, $meses);
    }

    /**
     * O financeiro do profissional (D4), só leitura: o recebido no mês (pelo `pago_em`) com a
     * comparação do MESMO período, as quebras por forma de pagamento e por convênio, e as sessões
     * realizadas cujo lançamento segue em aberto.
     *
     * Nenhuma chave de total da clínica, de "Sem profissional", de despesa da clínica nem de saldo
     * existe aqui: o recorte nasce com o profissional fixo (`doProfissional`).
     *
     * @param  bool  $comNomes  a lista nominal das sessões sem pagamento vem (quem pede vê a agenda dele)
     * @return array<string, mixed>
     */
    private function financeiro(int $profissionalId, ComparacaoDoPainel $comparacao, bool $comNomes): array
    {
        $periodo = $comparacao->periodo;
        $de = $periodo->de->toDateString();
        $ate = $periodo->ate->toDateString();

        return [
            // pago no caixa da clínica; o que a operadora do plano paga não passa por ele (§14)
            'base' => 'caixa',
            'recebido' => $comparacao->par(
                $this->soma($this->doProfissional($profissionalId, $de, $ate)),
                fn (): string => $this->soma($this->doProfissional(
                    $profissionalId,
                    $periodo->comparadoDe->toDateString(),
                    $periodo->comparadoAte->toDateString(),
                )),
            ),
            'por_forma' => $this->porForma($this->doProfissional($profissionalId, $de, $ate)),
            'por_convenio' => $this->porConvenio($this->doProfissional($profissionalId, $de, $ate)),
            'sem_pagamento' => $this->semPagamento($profissionalId, $periodo, $comNomes),
        ];
    }

    /**
     * O recorte do relatório "Recebido por profissional" (`RecebidoPorProfissional::pagosNoPeriodo`)
     * com o profissional FIXO pela MESMA atribuição (quem atendeu → dono do tratamento) e SEM o
     * convênio de plano.
     *
     * O plano sai porque a ficha só fala do caixa da clínica (§14): o lançamento de um tratamento de
     * convênio não particular só chega ao caixa com `financeiro.lancar_convenio_no_caixa` ligada, e
     * esse dinheiro não é "o que a família pagou pelos seus atendimentos". Com a flag desligada (o
     * padrão), a ficha e o relatório somam igual. Tratamento sem convênio não existe
     * (`convenio_id` é obrigatório); lançamento sem tratamento — a sessão faturada sem vínculo —
     * fica.
     *
     * @return Builder<LancamentoCaixa>
     */
    private function doProfissional(int $profissionalId, string $de, string $ate): Builder
    {
        return RecebidoPorProfissional::pagosNoPeriodo($de, $ate)
            ->whereRaw(RecebidoPorProfissional::PROFISSIONAL_ATRIBUIDO.' = ?', [$profissionalId])
            ->where(fn (Builder $q) => $q
                ->whereNull('tratamentos.convenio_id')
                ->orWhereIn('tratamentos.convenio_id', Convenio::query()->where('particular', true)->select('id')));
    }

    /**
     * A soma no banco, em decimal, com a fórmula do extrato — a devolução à família subtrai, como
     * no relatório.
     *
     * @param  Builder<LancamentoCaixa>  $consulta
     */
    private function soma(Builder $consulta): string
    {
        return ComparacaoDoPainel::dinheiro(
            $consulta->toBase()
                ->selectRaw('COALESCE(SUM('.LancamentoCaixa::LIQUIDO_COM_SINAL_SQL.'), 0) as total')
                ->value('total'),
        );
    }

    /**
     * O recebido de cada mês da série, numa consulta (mês inteiro, como a série do dinheiro).
     *
     * @return array<string, string> "YYYY-MM" → soma
     */
    private function recebidoPorMes(int $profissionalId, string $primeiroMes, string $ultimoMes): array
    {
        $mesSql = "DATE_FORMAT(lancamentos_caixa.pago_em, '%Y-%m')";
        $ultimoDia = Carbon::createFromFormat('Y-m-d', $ultimoMes.'-01')->endOfMonth()->toDateString();

        return $this->doProfissional($profissionalId, $primeiroMes.'-01', $ultimoDia)
            ->groupByRaw($mesSql)
            ->toBase()
            ->selectRaw($mesSql.' as mes, COALESCE(SUM('.LancamentoCaixa::LIQUIDO_COM_SINAL_SQL.'), 0) as total')
            ->pluck('total', 'mes')
            ->map(fn (mixed $total): string => (string) $total)
            ->all();
    }

    /**
     * @param  Builder<LancamentoCaixa>  $consulta
     * @return list<array{forma: string, valor: string}>
     */
    private function porForma(Builder $consulta): array
    {
        $somas = $consulta->toBase()
            ->groupBy('lancamentos_caixa.tipo_pagamento_id')
            ->selectRaw('lancamentos_caixa.tipo_pagamento_id as chave, COALESCE(SUM('.LancamentoCaixa::LIQUIDO_COM_SINAL_SQL.'), 0) as total')
            ->get();
        $nomes = TipoPagamento::query()->whereIn('id', $somas->pluck('chave')->filter())->pluck('nome', 'id');

        return $this->emOrdem($somas->map(fn (object $linha): array => [
            'forma' => (string) ($nomes[$linha->chave] ?? 'Sem forma de pagamento'),
            'valor' => ComparacaoDoPainel::dinheiro($linha->total),
        ])->all(), 'forma');
    }

    /**
     * @param  Builder<LancamentoCaixa>  $consulta
     * @return list<array{convenio: string, valor: string}>
     */
    private function porConvenio(Builder $consulta): array
    {
        $somas = $consulta->toBase()
            ->groupBy('tratamentos.convenio_id')
            ->selectRaw('tratamentos.convenio_id as chave, COALESCE(SUM('.LancamentoCaixa::LIQUIDO_COM_SINAL_SQL.'), 0) as total')
            ->get();
        $nomes = Convenio::query()->whereIn('id', $somas->pluck('chave')->filter())->pluck('nome', 'id');

        return $this->emOrdem($somas->map(fn (object $linha): array => [
            // a sessão faturada sem tratamento vinculado não tem convênio — o rótulo que a tela já usa
            'convenio' => $linha->chave === null ? 'Sem convênio' : (string) ($nomes[$linha->chave] ?? 'Sem convênio'),
            'valor' => ComparacaoDoPainel::dinheiro($linha->total),
        ])->all(), 'convenio');
    }

    /**
     * Maior valor primeiro; empate pelo nome.
     *
     * @param  list<array<string, string>>  $linhas
     * @return list<array<string, string>>
     */
    private function emOrdem(array $linhas, string $rotulo): array
    {
        usort($linhas, fn (array $a, array $b): int => bccomp($b['valor'], $a['valor'], 2) ?: strcmp($a[$rotulo], $b[$rotulo]));

        return $linhas;
    }

    /**
     * As sessões REALIZADAS do profissional no período (D4) cujo lançamento de receita vinculado
     * (`lancamentos_caixa.agendamento_id`, o que o faturamento grava) segue em aberto — e, como o
     * resto do financeiro, sem o convênio de plano.
     *
     * "Realizada" é a da `ClassificacaoDosStatus` (desconta a sessão e não é falta nem reserva), a
     * mesma régua dos painéis. Ficou de FORA a sessão realizada de tratamento particular SEM
     * lançamento nenhum: o pacote pago adiantado não grava lançamento por sessão, e contá-la diria
     * "sem pagamento" do que já foi pago inteiro.
     *
     * `atendimento_id` é o id do agendamento de atendimento — o que a agenda abre. Só leitura: a
     * cobrança continua com quem tem as permissões do financeiro.
     *
     * A lista NOMINAL (`itens`, com o nome da criança) só vem com `$comNomes` — quem vê a agenda do
     * profissional, onde esses nomes já estão. Sem ela, só a `quantidade`, e a chave `itens` nem existe
     * (SEC-PP-02): a régua do relatório não exige agenda, e o recebido não pode virar a porta para os
     * nomes das crianças de uma agenda que quem pede não vê.
     *
     * @return array{quantidade: int, itens?: list<array{atendimento_id: int, data: string, paciente: string, valor: string|null}>}
     */
    private function semPagamento(int $profissionalId, PeriodoComparado $periodo, bool $comNomes): array
    {
        $status = ClassificacaoDosStatus::daClinica();
        $realizadas = $status->emOrdem()
            ->filter(fn (StatusAgendamento $registro): bool => $status->ehRealizada((int) $registro->id))
            ->pluck('id')
            ->all();

        $consulta = Agendamento::query()
            ->join('lancamentos_caixa', fn (JoinClause $join) => $join
                ->on('lancamentos_caixa.agendamento_id', '=', 'agendamentos.id'))
            ->leftJoin('tratamentos', fn (JoinClause $join) => $join
                ->on('tratamentos.id', '=', 'lancamentos_caixa.tratamento_id'))
            ->where('agendamentos.profissional_id', $profissionalId)
            ->where('agendamentos.tipo', 'atendimento')
            ->whereBetween('agendamentos.inicio', $periodo->limites())
            ->whereIn('agendamentos.status_id', $realizadas)
            ->where('lancamentos_caixa.tipo', 'receita')
            ->whereNull('lancamentos_caixa.pago_em')
            ->where(fn (Builder $q) => $q
                ->whereNull('tratamentos.convenio_id')
                ->orWhereIn('tratamentos.convenio_id', Convenio::query()->where('particular', true)->select('id')));

        if (! $comNomes) {
            return ['quantidade' => $consulta->count()];
        }

        $linhas = (clone $consulta)
            ->toBase()
            ->select(['agendamentos.id', 'agendamentos.inicio', 'agendamentos.paciente_id'])
            ->selectRaw(LancamentoCaixa::LIQUIDO_SQL.' as valor')
            ->orderBy('agendamentos.inicio')
            ->orderBy('agendamentos.id')
            ->limit(self::TETO_SEM_PAGAMENTO)
            ->get();
        $nomes = Paciente::query()->whereIn('id', $linhas->pluck('paciente_id')->unique())->pluck('nome', 'id');

        return [
            'quantidade' => $consulta->count(),
            'itens' => $linhas->map(fn (object $linha): array => [
                'atendimento_id' => (int) $linha->id,
                'data' => substr((string) $linha->inicio, 0, 10),
                'paciente' => (string) ($nomes[$linha->paciente_id] ?? ''),
                'valor' => ComparacaoDoPainel::dinheiro($linha->valor),
            ])->values()->all(),
        ];
    }
}
