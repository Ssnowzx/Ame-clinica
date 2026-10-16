<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Índice da varredura por REGIME DE CAIXA: faixa de `pago_em` SEM filtro de conta.
 *
 * O índice que já existia, `(conta_id, pago_em)`, tem `conta_id` no MEIO —
 * sem igualdade em conta o otimizador não alcança a parte `pago_em` e cai em varredura
 * total. Medido pelo `perf-engineer` com 400 mil linhas (medição herdada do produto de origem):
 * 4 das 5 agregações da vista de gráficos davam `type=ALL`, `key=NULL`, `r_rows=400.000`
 * — a quebra do mês lia a tabela INTEIRA para somar 3.047 linhas.
 *
 * **Ganho medido (rodada 2, condição declarada abaixo): p95 da rota de ~292 ms para
 * 89 ms, 3,35×.** As quatro agregações passam a `range`/`ref` no índice novo; a quebra
 * do mês cai de ~52 ms para ~2,5 ms.
 *
 * O ganho não é só da tela nova. `/api/indicadores/financeiro` — o bloco do painel, que
 * **já está em produção** — sofre do mesmo defeito: p95 de 79,5 para 35,4 ms. E de
 * brinde: extrato sem filtro de conta 40,0 → 6,6 ms, relatório financeiro por período
 * 49,6 → 2,9 ms.
 *
 * **Por que TRÊS colunas e não duas.** Com `(pago_em)` só, a query da previsão
 * entra por `pago_em IS NULL` e lê TODO o não-pago, ignorando o ano pedido —
 * com 102 mil em aberto ela volta a `type=ALL` e perde o índice por completo. A terceira
 * coluna dá a faixa de `vencimento` dentro do balde de não-pagos, e mantém o mesmo
 * prefixo `(pago_em)`, então preserva todos os ganhos acima. Custo: 13,55 MB
 * contra 12,55 MB. Ganhos extra medidos: `vencido` 9,5 → 1,46 ms (6,5×), p95 da rota
 * 84,9 → 71,3 ms, e vazão em concorrência REAL de 31,9 para 41,4 req/s (+29,9%).
 *
 * **O argumento decisivo:** em concorrência 15, o índice de 2 colunas dá p95 de 565–604 ms
 * — ACIMA do penhasco de 500 ms da casa. O de 3 colunas dá 426–461 ms, abaixo dele.
 *
 * **A terceira coluna MOVE o penhasco, não o remove.** Medido: Q2 fica em `range` até
 * ~44 mil lançamentos em aberto DENTRO do ano pedido, e volta a `type=ALL` a partir de
 * ~64 mil (200 ms). Fora do envelope de operação — 64 mil em aberto num ano é 1,6× um ano
 * inteiro sem ninguém pagar nada — e o índice de 2 colunas cai no MESMO ponto, então isso
 * não distingue os dois desenhos. Fica escrito para ninguém ler imunidade onde há limite.
 *
 * Custo de escrita, medido: INSERT unitário 0,413 → 0,429 ms na média aparada (+3,9%),
 * **mas a CAUDA cresce mais: p95 de 0,95 → 1,16 ms (+22%)**. Lote de 20 mil, +7,6%.
 *
 * *Condição das medidas:* MacBook M5, app e MariaDB 11.8.8 no MESMO box,
 * `innodb_buffer_pool_size` 128 MB contra 176 MB de working set, PHP 8.5.2, banco
 * descartável, p95 de 60 requisições. Números de VPS real: não medidos.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lancamentos_caixa', function (Blueprint $tabela) {
            $tabela->index(['pago_em', 'vencimento']);
        });
    }

    public function down(): void
    {
        Schema::table('lancamentos_caixa', function (Blueprint $tabela) {
            $tabela->dropIndex(['pago_em', 'vencimento']);
        });
    }
};
