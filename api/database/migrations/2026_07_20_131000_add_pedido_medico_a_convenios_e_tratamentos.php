<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Pedido médico como DADO (change limites-e-pedidos-por-convenio, D4): a validade em
// meses é do CONVÊNIO (Unimed 6 · SC Saúde 3 — entra por cadastro); a emissão e o
// override semanal ("conforme pedido") são do TRATAMENTO. O vencimento é SEMPRE
// derivado (emissão + validade, fuso da clínica) — nunca coluna (dessincronizaria ao
// trocar a validade do convênio). Colunas nullable, aditivas: zero backfill, opt-in
// por cadastro. Pedido médico é solicitação clínica — nada de guia/TISS (§14).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('convenios', function (Blueprint $table) {
            $table->unsignedTinyInteger('pedido_validade_meses')->nullable() // 1..36 no boundary
                ->after('flags_tiss_json');
        });

        Schema::table('tratamentos', function (Blueprint $table) {
            $table->date('pedido_emitido_em')->nullable()->after('validade_dias');
            $table->unsignedTinyInteger('pedido_sessoes_por_semana')->nullable() // 1..40 no boundary
                ->after('pedido_emitido_em');
        });
    }

    public function down(): void
    {
        Schema::table('tratamentos', function (Blueprint $table) {
            $table->dropColumn(['pedido_emitido_em', 'pedido_sessoes_por_semana']);
        });

        Schema::table('convenios', function (Blueprint $table) {
            $table->dropColumn('pedido_validade_meses');
        });
    }
};
