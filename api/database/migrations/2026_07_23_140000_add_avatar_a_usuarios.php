<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Foto de perfil do usuário (change foto-de-perfil-do-usuario). Espelha o logo da
 * clínica: o caminho é SEMPRE server-set (`usuarios/{id}/avatar.{ext}`) e nunca aceito
 * em payload — por isso mora aqui, em colunas próprias, fora de $fillable no model.
 * `avatar_atualizado_em` é a versão de cache-bust servida ao front no /me. EXPAND puro:
 * colunas nullable no fim da tabela; sem backfill — null = sem foto (mostra o ícone),
 * comportamento de hoje.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('usuarios', function (Blueprint $table): void {
            $table->string('avatar_path')->nullable();
            $table->dateTime('avatar_atualizado_em')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('usuarios', function (Blueprint $table): void {
            $table->dropColumn(['avatar_path', 'avatar_atualizado_em']);
        });
    }
};
