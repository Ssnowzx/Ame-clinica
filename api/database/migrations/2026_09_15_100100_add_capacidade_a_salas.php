<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Quantas crianças a sala comporta ao mesmo tempo (change atendimento-em-grupo, D1).
 *
 * Existe pelo mesmo pedido da coluna irmã em `profissionais`, e é o que impede o conserto
 * pela metade: o atendimento em grupo da clínica é **na mesma sala** (resposta da Camille,
 * 2026-09-15). Liberar só o eixo do profissional trocaria uma recusa por outra — e a
 * segunda seria pior de entender, porque a recepção pensaria no profissional.
 *
 * Mesmo contrato que `equipamentos.quantidade_total` já tem desde a primeira migration da
 * agenda: a checagem conta ocupantes sobrepostos contra o número em vez de recusar no
 * primeiro. Não é mecanismo novo — é um mecanismo existente aplicado a mais um eixo.
 *
 * Default 1 = comportamento atual. Faixa 1..20 no boundary (uma sala é maior que um
 * profissional, mas não é um auditório).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('salas', function (Blueprint $table) {
            $table->unsignedTinyInteger('capacidade')->default(1)->after('nome');
        });
    }

    public function down(): void
    {
        Schema::table('salas', function (Blueprint $table) {
            $table->dropColumn('capacidade');
        });
    }
};
