<?php

use App\Support\Agenda\StatusAgendamentoDefaults;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill do ÍCONE (`tipo`) dos status default já existentes — a coluna é
 * PRÉ-EXISTENTE e nasceu nula (change da agenda). Status nascidos dos defaults já
 * recebem o ícone; esta migration só alcança os criados antes.
 *
 * É migration de DADO, uma vez: comparar pelo nome aqui é backfill, não regra
 * de runtime (nenhum código de produção decide nada pelo nome do status, §13).
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (StatusAgendamentoDefaults::DEFAULTS as $padrao) {
            DB::table('status_agendamento')
                ->where('nome', $padrao['nome'])
                ->whereNull('tipo')   // idempotente e não sobrescreve escolha da clínica
                ->update(['tipo' => $padrao['tipo']]);
        }
    }

    /**
     * NÃO dropa a coluna `tipo` (ela não nasceu aqui — dropá-la destruiria o
     * cadastro da clínica, T-sag-13). Reverter o backfill é limpar apenas os
     * valores que ele mesmo escreveu.
     */
    public function down(): void
    {
        foreach (StatusAgendamentoDefaults::DEFAULTS as $padrao) {
            DB::table('status_agendamento')
                ->where('nome', $padrao['nome'])
                ->where('tipo', $padrao['tipo'])
                ->update(['tipo' => null]);
        }
    }
};
