<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PREP-03 (parecer pré-código da change importacao-da-virada): nenhuma planilha do
 * ClinicaÁgil traz o sexo, e a carga da virada JAMAIS inventa dado — a coluna relaxa
 * para nullable, no MESMO precedente de `nascimento`/`necessidade` (migration de
 * 2026-07-23, pré-cadastro do balcão). O boundary da API continua exigindo sexo no
 * cadastro completo (PacienteRequest — nada muda para quem digita); null = "a carga
 * não tinha o dado", e o `cadastro_incompleto` derivado sinaliza a ficha a completar.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pacientes', function (Blueprint $table): void {
            $table->string('sexo', 20)->nullable()->change();
        });
    }

    public function down(): void
    {
        // volta ao NOT NULL: linhas da carga sem sexo precisam de valor antes do rollback
        Schema::table('pacientes', function (Blueprint $table): void {
            $table->string('sexo', 20)->nullable(false)->change();
        });
    }
};
