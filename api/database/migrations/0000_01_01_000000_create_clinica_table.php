<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A identidade da clínica — UMA linha só (o sistema atende uma clínica, não um parque delas).
 *
 * Prefixo 0000_*: as demais tabelas não dependem dela por FK, mas o observer que semeia os
 * defaults (níveis, status, catálogo do caixa) roda na criação desta linha.
 *
 * - `logo_path`/`logo_atualizado_em` (change identidade-da-clinica): o caminho é SEMPRE
 *   server-set e mora aqui, nunca em `configuracoes` — o PUT genérico de configurações aceita
 *   string livre, e um caminho gravável pelo cliente viraria leitura arbitrária de arquivo no
 *   GET. `logo_atualizado_em` é a versão de cache-bust servida ao front. Null = sem logo.
 * - `cadastro_online_slug` (change cadastro-online-do-paciente): o endereço público do
 *   auto-cadastro. Valor impossível de adivinhar, nasce NULO (ninguém ganha uma porta pública
 *   por deploy) e é rotacionado sem deploy se o link vazar. `unique` porque é chave de URL.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('clinica', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->boolean('ativo')->default(true);
            // nullable + unique: no MySQL, vários NULL convivem sob índice único
            $table->string('cadastro_online_slug', 32)->nullable()->unique();
            $table->string('logo_path')->nullable();
            $table->dateTime('logo_atualizado_em')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('clinica');
    }
};
