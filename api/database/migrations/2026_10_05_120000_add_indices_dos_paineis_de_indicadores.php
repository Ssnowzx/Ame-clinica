<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dois índices dos painéis de indicadores (change indicadores-profissionais, rodada 1 do gate).
 *
 * **`lembretes_enviados (inicio_lembrado)` — PERF-03.** As confirmadas do painel da agenda
 * filtram os lembretes pelo HORÁRIO LEMBRADO do período. A tabela só tinha `(competencia)`
 * e a chave única `(agendamento_id, tipo, competencia)`: o EXPLAIN dava `type=ALL`, lendo os 41 mil
 * lembretes da projeção para achar os 3,3 mil do mês. Com o índice, faixa no período.
 *
 * **`agendamentos (tipo, profissional_id, fim)` — PERF-05.** Os bloqueios da grade são
 * lidos por SOBREPOSIÇÃO (`inicio <= fim do período` e `fim >= começo do período`). Bloqueio não tem
 * duração máxima (férias de vários dias), então o limite inferior só pode ser o `fim` — e nenhum
 * índice tinha `fim`: o EXPLAIN dava `type=ALL`, lendo os 45 mil agendamentos da projeção (o histórico
 * inteiro) para devolver 100 bloqueios. Com `tipo` e `profissional_id` antes do `fim`, a faixa fica
 * presa aos bloqueios de quem está na grade, e a escopada lê só os dela. O mesmo formato serve à
 * produtividade (`ProdutividadeDoMes::bloqueiosPorProfissional`).
 *
 * Os números de antes e depois estão no relatório da rodada (projeção de 20 profissionais × 12 meses,
 * MariaDB 11.8.8 local). Só índices: nenhuma linha muda, e o `down` desfaz exatamente o `up`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lembretes_enviados', function (Blueprint $tabela): void {
            $tabela->index(['inicio_lembrado']);
        });

        Schema::table('agendamentos', function (Blueprint $tabela): void {
            $tabela->index(['tipo', 'profissional_id', 'fim']);
        });
    }

    public function down(): void
    {
        Schema::table('agendamentos', function (Blueprint $tabela): void {
            $tabela->dropIndex(['tipo', 'profissional_id', 'fim']);
        });

        Schema::table('lembretes_enviados', function (Blueprint $tabela): void {
            $tabela->dropIndex(['inicio_lembrado']);
        });
    }
};
