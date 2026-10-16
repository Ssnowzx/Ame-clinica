<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Pré-cadastro de paciente (change pre-cadastro-de-paciente): a recepção cria pelo
 * balcão só com nome/sexo/telefone — `nascimento` e `necessidade` ficam VAZIOS até a
 * ficha ser completada. Nullable é a representação honesta de "ainda não sabemos";
 * "cadastro incompleto" é DERIVADO dessas ausências (design d.1), nunca flag gravada.
 * O boundary COMPLETO (PacienteRequest) continua exigindo ambos — só o pré-cadastro
 * dispensa. EXPAND puro: nenhuma linha existente muda.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pacientes', function (Blueprint $table): void {
            $table->date('nascimento')->nullable()->change();
            $table->string('necessidade', 30)->nullable()->change();
        });
    }

    public function down(): void
    {
        // volta a NOT NULL — falha de propósito se houver pré-cadastros pendentes:
        // apagar a ausência inventando uma data seria mentira clínica
        Schema::table('pacientes', function (Blueprint $table): void {
            $table->date('nascimento')->nullable(false)->change();
            $table->string('necessidade', 30)->nullable(false)->change();
        });
    }
};
