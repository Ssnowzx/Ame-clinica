<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * "Este status é RESERVA?" vira flag (change mensageria-whatsapp).
 *
 * Mesmo padrão de `desconta_sessao` e `marca_falta`, pela mesma razão (§13): o lembrete
 * automático precisa saber o que é reserva, e decidir isso pelo NOME do status quebraria no
 * dia em que alguém corrigisse a grafia de "Reserva de Agenda" — ou criasse "Reserva
 * provisória". Quem declara é a clínica, na tela de status.
 *
 * O backfill liga a flag no status default de reserva pelo nome UMA VEZ, e isso é semente,
 * não regra: a partir daqui o valor é dado, editável, e nenhum código volta a ler o nome.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('status_agendamento', function (Blueprint $table): void {
            $table->boolean('marca_reserva')->default(false)->after('marca_falta');
        });

        DB::table('status_agendamento')
            ->where('nome', 'Reserva de Agenda')
            ->update(['marca_reserva' => true]);
    }

    public function down(): void
    {
        Schema::table('status_agendamento', function (Blueprint $table): void {
            $table->dropColumn('marca_reserva');
        });
    }
};
