<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Funcionários (§8/§9) — registro operacional (NÃO é usuário do sistema).
// Dados pessoais de ADULTOS: cpf/contatos/endereço mascarados e detail-only.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('funcionarios', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->string('cpf', 11)->nullable();
            $table->string('funcao', 100);
            $table->json('contatos_json')->nullable();
            $table->json('endereco_json')->nullable();
            $table->date('nascimento')->nullable();
            $table->boolean('ativo')->default(true);
            $table->timestamps();

            $table->unique(['cpf']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('funcionarios');
    }
};
