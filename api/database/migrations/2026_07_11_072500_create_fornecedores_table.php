<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Fornecedores (§8/§9) — dados pessoais de ADULTOS (LGPD): cpf_cnpj/contatos/
// endereço mascarados no diff e detail-only. Referenciado por lançamento não se
// exclui (restrict via checagem — interessado é polimórfico) — se inativa (P4).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fornecedores', function (Blueprint $table) {
            $table->id();
            $table->string('razao_social');
            $table->string('nome_fantasia')->nullable();
            $table->string('cpf_cnpj', 14)->nullable();
            $table->json('contatos_json')->nullable();
            $table->json('endereco_json')->nullable();
            $table->foreignId('categoria_id')->nullable()->constrained('categorias')->restrictOnDelete();
            $table->foreignId('subcategoria_id')->nullable()->constrained('subcategorias')->restrictOnDelete();
            $table->string('centro_custo', 100)->nullable();
            $table->boolean('ativo')->default(true);
            $table->timestamps();

            $table->unique(['cpf_cnpj']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fornecedores');
    }
};
