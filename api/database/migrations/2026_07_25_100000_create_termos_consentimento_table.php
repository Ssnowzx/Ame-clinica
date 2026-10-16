<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// O TERMO de consentimento da clínica (FA-08 — o contrato terapêutico), como DADO
// versionado: uma linha por VERSÃO, jamais um texto digitado no balcão.
//
// Cada aceite (pacientes.consentimentos_json) aponta para a linha que estava
// vigente — por isso publicar uma versão nova NÃO altera nem remove as anteriores:
// elas são a prova do que cada família aceitou. Só uma vigente por vez; a
// unicidade é invariante de ESCRITA (transação + lock), porque MariaDB não tem
// índice único parcial, e a leitura desempata pela maior versão.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('termos_consentimento', function (Blueprint $table) {
            $table->id();
            $table->string('titulo', 160);
            $table->unsignedInteger('versao');
            $table->longText('texto');
            $table->boolean('vigente')->default(false);
            $table->timestamps();

            $table->unique(['versao']);
            $table->index(['vigente']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('termos_consentimento');
    }
};
