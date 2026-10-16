<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Dias da semana de atendimento do profissional (Fase 2 · parecer DAT-DADOS-01).
 * ISO 1=segunda…7=domingo. `null` = atende todos os dias que a clínica abre —
 * retrocompatível (linhas existentes ficam null, comportamento inalterado; sem backfill),
 * espelha "janela null = janela cheia". EXPAND puro: coluna nullable NO FIM da tabela
 * (sem ->after) para preservar ALGORITHM=INSTANT no MariaDB. Sem índice: não há query por
 * dia (a leitura é sempre junto do profissional). Array de escalar, não JSON escondendo
 * schema — no dia do horário-por-dia, migra para tabela filha.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('profissionais', function (Blueprint $table): void {
            $table->json('dias_atendimento_json')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('profissionais', function (Blueprint $table): void {
            $table->dropColumn('dias_atendimento_json');
        });
    }
};
