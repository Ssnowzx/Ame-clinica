<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Médico SOLICITANTE/encaminhador (≠ profissional executante — §5 correção 2).
// Minimização LGPD: sem CPF/contato nesta change (design D7).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('medicos', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->string('conselho', 20); // ex.: CRM
            $table->string('uf_conselho', 2);
            $table->string('num_conselho', 20);
            $table->foreignId('cbos_id')->nullable()->constrained('cbos')->restrictOnDelete();
            $table->json('codigos_operadora_json')->nullable(); // {convenio_id: codigo}
            $table->timestamps();

            $table->unique(['conselho', 'uf_conselho', 'num_conselho']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('medicos');
    }
};
