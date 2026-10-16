<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Foto do profissional (change foto-do-profissional), no molde da foto de perfil do usuário:
 * `foto_path` é SEMPRE server-set (`profissionais/{id}/foto.{ext}`) e nunca aceito do
 * cliente; `foto_atualizado_em` é a versão de cache-bust servida ao front como `foto_versao`.
 * EXPAND puro: duas colunas nulas, nenhuma linha reescrita. O arquivo mora no disco privado.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('profissionais', function (Blueprint $table) {
            $table->string('foto_path')->nullable()->after('obs');
            $table->dateTime('foto_atualizado_em')->nullable()->after('foto_path');
        });
    }

    public function down(): void
    {
        Schema::table('profissionais', function (Blueprint $table) {
            $table->dropColumn(['foto_path', 'foto_atualizado_em']);
        });
    }
};
