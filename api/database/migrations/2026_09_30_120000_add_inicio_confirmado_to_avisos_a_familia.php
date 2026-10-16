<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * O horário que a confirmação ANUNCIOU (change `repescagem-do-lembrete`, gate SEC-RP2-01/CR-RP2-01).
 *
 * A confirmação do primeiro agendamento dispensa o lembrete da mesma sessão — a família acabou de
 * ser avisada daquele horário. Sem guardar QUAL horário, a sessão remarcada sem aviso logo depois da
 * confirmação tinha o lembrete com o horário novo dispensado, e a família ficava só com o antigo.
 * Com a coluna, a dispensa só vale enquanto a sessão estiver no horário confirmado.
 *
 * Aditiva. Sem backfill: marca antiga fica nula e não
 * dispensa nada — o lembrete sai, que é o lado seguro. Não é conteúdo de mensagem (LGPD): é o
 * horário da sessão, o mesmo que já está em `agendamentos`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('avisos_a_familia', function (Blueprint $table): void {
            $table->dateTime('inicio_confirmado')->nullable()->after('agendamento_id');
        });
    }

    public function down(): void
    {
        Schema::table('avisos_a_familia', function (Blueprint $table): void {
            $table->dropColumn('inicio_confirmado');
        });
    }
};
