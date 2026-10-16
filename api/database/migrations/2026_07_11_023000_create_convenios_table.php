<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Campos TISS/ANS são ARMAZENAMENTO DORMENTE (§14): a esteira de guias/faturamento
// pertence ao gestao_de_convenios — nenhum comportamento aqui sem ADR aprovado.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('convenios', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->string('registro_ans')->nullable();
            $table->string('codigo_operadora')->nullable();
            $table->string('versao_tiss')->nullable();
            $table->boolean('guia_sequencial')->default(false);
            $table->boolean('alerta_agend_mesmo_dia')->default(false);
            $table->json('flags_tiss_json')->nullable();
            $table->boolean('ativo')->default(true);
            $table->timestamps();

            $table->unique(['nome']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('convenios');
    }
};
