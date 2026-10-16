<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marcador da CARGA DA VIRADA (change importacao-da-virada, design D5).
 *
 * `importado_clinicaagil_em` marca as linhas criadas pelo comando `virada:importar` —
 * é a trilha da carga, a chave de reconciliação HUMANA com o gestao_de_convenios (as
 * planilhas não trazem id do ClinicaÁgil; a identidade é nome+CPF/telefone) e o que
 * permite conferir e reverter a carga cirurgicamente. EXPAND puro: nullable, sem
 * backfill — null = linha que nasceu no próprio sistema (todas as de hoje). SEMPRE
 * server-set pelo comando; fora de $fillable nos models.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pacientes', function (Blueprint $table): void {
            $table->dateTime('importado_clinicaagil_em')->nullable();
        });
        Schema::table('tratamentos', function (Blueprint $table): void {
            $table->dateTime('importado_clinicaagil_em')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('pacientes', function (Blueprint $table): void {
            $table->dropColumn('importado_clinicaagil_em');
        });
        Schema::table('tratamentos', function (Blueprint $table): void {
            $table->dropColumn('importado_clinicaagil_em');
        });
    }
};
