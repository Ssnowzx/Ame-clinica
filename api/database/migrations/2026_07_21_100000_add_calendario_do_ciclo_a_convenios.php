<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Calendário do ciclo de faturamento como DADO do convênio (change fechamento-de-ciclo,
 * D1 — §13: regra configurável é dado, nunca código). Precedente direto:
 * `pedido_validade_meses` entrou como coluna do convênio na change anterior.
 *
 * `ciclo_dia_corte` para em **28** (SEC-FC-21): com corte em 29–31 o clamp de mês curto
 * abriria BURACO no calendário — corte 30 daria 31/01–28/02 seguido de 01/03–30/03, e
 * 31/03 não pertenceria a período algum (dia eternamente editável). O domínio fechado
 * vive no boundary (`ConvenioRequest`); aqui a coluna só carrega a faixa física.
 * `ultimo_dia` cobre quem fecha no fim do mês (SC Saúde) sem perda.
 *
 * Aditiva e nullable: sem calendário o convênio NÃO tem ciclo e nada muda para ele
 * (fail-safe). Zero backfill. Rollback = drop das duas colunas.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('convenios', function (Blueprint $table) {
            // 1..28 — a faixa de domínio é fechada no boundary (SEC-FC-21)
            $table->unsignedTinyInteger('ciclo_dia_corte')->nullable()->after('pedido_validade_meses');
            // dia_fixo | ultimo_dia — domínio fechado no boundary, sem enum de schema
            // (mesma convenção de `periodo`/`acao` em regras_limite_convenio)
            $table->string('ciclo_tipo_corte', 12)->nullable()->after('ciclo_dia_corte');
        });
    }

    public function down(): void
    {
        Schema::table('convenios', function (Blueprint $table) {
            $table->dropColumn(['ciclo_dia_corte', 'ciclo_tipo_corte']);
        });
    }
};
