<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marcador de lembrete por agendamento (change mensageria-whatsapp).
 *
 * O default do BANCO é `false` — o piso conservador. A PRÉ-SELEÇÃO da clínica
 * (`whatsapp.pre_selecionado`, §13) é aplicada no boundary de criação, não aqui: parametrização
 * da clínica é dado, e um default de coluna é regra congelada em schema, que é exatamente o que
 * a §13 proíbe.
 *
 * Índice parcial não existe em MySQL/MariaDB; o índice composto com a data serve o agendador,
 * que pergunta "quais agendamentos de amanhã estão marcados?".
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agendamentos', function (Blueprint $table): void {
            $table->boolean('lembrete_whatsapp')->default(false)->after('obs');
        });

        Schema::table('agendamentos', function (Blueprint $table): void {
            $table->index(['inicio', 'lembrete_whatsapp'], 'agend_lembrete_idx');
        });
    }

    public function down(): void
    {
        Schema::table('agendamentos', function (Blueprint $table): void {
            $table->dropIndex('agend_lembrete_idx');
            $table->dropColumn('lembrete_whatsapp');
        });
    }
};
