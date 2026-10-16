<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Se as famílias atendidas pelo profissional recebem as mensagens que a clínica manda sozinha —
 * o lembrete da véspera e a confirmação do primeiro agendamento (change
 * mensagens-automaticas-por-profissional, D1).
 *
 * Pedido da clínica (2026-10-01): uma profissional confirma os próprios pacientes, e a família
 * recebia duas confirmações. O opt-out da família calaria TODOS os profissionais daquela criança;
 * desligar a automação calaria a clínica inteira. "Confirma com as famílias por conta própria" é
 * atributo de QUEM atende — o molde de `atendimentos_simultaneos`.
 *
 * **Default true = o comportamento de hoje, exatamente.** Nenhum profissional muda sem alguém
 * desligar a chave na tela — o rollback é religá-la, sem deploy.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('profissionais', function (Blueprint $table) {
            $table->boolean('mensagens_automaticas')->default(true)->after('atendimentos_simultaneos');
        });
    }

    public function down(): void
    {
        Schema::table('profissionais', function (Blueprint $table) {
            $table->dropColumn('mensagens_automaticas');
        });
    }
};
