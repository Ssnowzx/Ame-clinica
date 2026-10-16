<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Flag ocupa_horario (agenda D2): desmarcar libera o slot sem apagar histórico.
// Comportamento por status é FLAG/dado (§13) — nunca nome de status em código.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('status_agendamento', function (Blueprint $table) {
            $table->boolean('ocupa_horario')->default(true)->after('desconta_sessao');
        });

        // backfill único para status já existentes: o default observado que libera
        // horário é o desmarque (a clínica pode editar depois — é dado)
        DB::table('status_agendamento')
            ->where('nome', 'Desmarcado pelo Profissional')
            ->update(['ocupa_horario' => false]);
    }

    public function down(): void
    {
        Schema::table('status_agendamento', function (Blueprint $table) {
            $table->dropColumn('ocupa_horario');
        });
    }
};
