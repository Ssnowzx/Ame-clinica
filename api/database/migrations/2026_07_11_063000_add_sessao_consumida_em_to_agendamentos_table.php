<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Marcador idempotente do consumo de sessão (design D2, T-ate-13): fonte da
// verdade do que já foi consumido — nunca no payload/$fillable. Nasce NULL para
// todo o legado (nada foi consumido até aqui).
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('agendamentos', function (Blueprint $table) {
            $table->dateTime('sessao_consumida_em')->nullable()
                ->after('recorrencia_grupo_id');
        });
    }

    public function down(): void
    {
        Schema::table('agendamentos', function (Blueprint $table) {
            $table->dropColumn('sessao_consumida_em');
        });
    }
};
