<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Falta é FLAG por status (T-not-07 — mesmo padrão de desconta_sessao/
// ocupa_horario; a coluna `tipo` string NÃO é reaproveitada: enum-string
// convida ao string-match). Backfill idempotente marca só o default do seed;
// quem customizou não é tocado. Dado 100% editável pela clínica.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('status_agendamento', function (Blueprint $table) {
            $table->boolean('marca_falta')->default(false)->after('ocupa_horario');
        });

        DB::table('status_agendamento')
            ->where('nome', 'Não Compareceu')
            ->update(['marca_falta' => true]);
    }

    public function down(): void
    {
        Schema::table('status_agendamento', function (Blueprint $table) {
            $table->dropColumn('marca_falta');
        });
    }
};
