<?php

namespace App\Support\Indicadores;

use App\Models\LancamentoCaixa;
use App\Support\Financeiro\LancamentosEmAtraso;

/**
 * `GET /api/indicadores/painel/dinheiro` (change indicadores-profissionais, D4/D9) — sob
 * `fluxo_caixa.ver`: agregado da CLÍNICA, sem eixo por profissional (o mesmo racional da série
 * financeira). Dinheiro sempre como string decimal, somado no banco (lição CR-04), com a fórmula do
 * extrato (`LancamentoCaixa::LIQUIDO_SQL`).
 *
 * Tudo é RECEITA — é o dinheiro que entra:
 *  - **recebido:** caixa realizado no período (`pago_em`), a MESMA soma da série financeira;
 *  - **a receber no mês:** em aberto com vencimento de hoje até o fim do mês (mês fechado: nada);
 *  - **em atraso:** a regra do sino (`LancamentosEmAtraso`) recortada às receitas — a conta da
 *    clínica com o fornecedor atrasada não é dinheiro a receber, e somá-la aqui inventaria um
 *    "em atraso" que nenhum relatório mostra;
 *  - **valor médio por sessão:** lançamentos de sessão FATURADA (`agendamento_id`, que o
 *    faturamento grava) com competência — a data da sessão — no período, ÷ quantos são.
 */
final class PainelDoDinheiro
{
    public function __construct(private readonly LancamentosEmAtraso $emAtraso) {}

    public function calcular(PeriodoComparado $periodo): array
    {
        $comparacao = ComparacaoDoPainel::para($periodo);

        return [
            ...$comparacao->cabecalho(),
            'recebido' => $comparacao->par(
                $this->recebido($periodo->limites()),
                fn (): string => $this->recebido($periodo->limitesComparados()),
            ),
            'a_receber_no_mes' => $this->aReceberNoMes($periodo),
            'em_atraso' => $this->emAtraso(),
            'valor_medio_sessao' => $comparacao->par(
                $this->valorMedioPorSessao($periodo->de->toDateString(), $periodo->ate->toDateString()),
                fn (): ?string => $this->valorMedioPorSessao(
                    $periodo->comparadoDe->toDateString(),
                    $periodo->comparadoAte->toDateString(),
                ),
            ),
            'serie_recebido' => $this->serieDoRecebido($comparacao),
        ];
    }

    /** @param  array{0: string, 1: string}  $limites */
    private function recebido(array $limites): string
    {
        return ComparacaoDoPainel::dinheiro(
            LancamentoCaixa::query()
                ->where('tipo', 'receita')
                ->whereBetween('pago_em', $limites)
                ->toBase()
                ->selectRaw('COALESCE(SUM('.LancamentoCaixa::LIQUIDO_SQL.'), 0) as total')
                ->value('total'),
        );
    }

    private function aReceberNoMes(PeriodoComparado $periodo): string
    {
        $hoje = $periodo->hoje();
        $fimDoMes = $periodo->de->endOfMonth()->toDateString();

        if ($hoje > $fimDoMes) {
            return ComparacaoDoPainel::dinheiro('0');
        }

        return ComparacaoDoPainel::dinheiro(
            LancamentoCaixa::query()
                ->where('tipo', 'receita')
                ->whereNull('pago_em')
                ->whereBetween('vencimento', [$hoje, $fimDoMes])
                ->toBase()
                ->selectRaw('COALESCE(SUM('.LancamentoCaixa::LIQUIDO_SQL.'), 0) as total')
                ->value('total'),
        );
    }

    /** @return array{valor: string, quantidade: int} */
    private function emAtraso(): array
    {
        $linha = $this->emAtraso->consulta()
            ->where('tipo', 'receita')
            ->reorder()
            ->toBase()
            ->selectRaw('COALESCE(SUM('.LancamentoCaixa::LIQUIDO_SQL.'), 0) as total, COUNT(*) as quantidade')
            ->first();

        return [
            'valor' => ComparacaoDoPainel::dinheiro($linha->total ?? '0'),
            'quantidade' => (int) ($linha->quantidade ?? 0),
        ];
    }

    /** O valor médio das sessões faturadas com competência em `$de`..`$ate`; nulo sem sessão. */
    private function valorMedioPorSessao(string $de, string $ate): ?string
    {
        $linha = LancamentoCaixa::query()
            ->where('tipo', 'receita')
            ->whereNotNull('agendamento_id')
            ->whereBetween('competencia', [$de, $ate])
            ->toBase()
            ->selectRaw('COALESCE(SUM('.LancamentoCaixa::LIQUIDO_SQL.'), 0) as total, COUNT(*) as sessoes')
            ->first();

        $sessoes = (int) ($linha->sessoes ?? 0);
        if ($sessoes === 0) {
            return null;
        }

        // meio centavo para cima, como na régua de arredondamento comum (bcdiv só trunca)
        $media = bcdiv((string) $linha->total, (string) $sessoes, 4);

        return bccomp($media, '0', 4) >= 0 ? bcadd($media, '0.005', 2) : bcsub($media, '0.005', 2);
    }

    /**
     * Os 6 meses do recebido terminando no mês pedido — mês inteiro, como a série financeira; os
     * meses antes do histórico da clínica vêm NULOS, nunca "0.00" (D3).
     *
     * @return list<array{mes: string, valor: string|null}>
     */
    private function serieDoRecebido(ComparacaoDoPainel $comparacao): array
    {
        $meses = $comparacao->periodo->mesesDaSerie();
        $porMes = LancamentoCaixa::query()
            ->where('tipo', 'receita')
            ->whereBetween('pago_em', [$meses[0].'-01 00:00:00', $comparacao->periodo->de->endOfMonth()->format('Y-m-d').' 23:59:59'])
            ->groupByRaw("DATE_FORMAT(pago_em, '%Y-%m')")
            ->toBase()
            ->selectRaw("DATE_FORMAT(pago_em, '%Y-%m') as mes, SUM(".LancamentoCaixa::LIQUIDO_SQL.') as total')
            ->pluck('total', 'mes');

        return array_map(fn (string $mes): array => [
            'mes' => $mes,
            'valor' => $comparacao->temHistorico($mes) ? ComparacaoDoPainel::dinheiro($porMes[$mes] ?? '0') : null,
        ], $meses);
    }
}
