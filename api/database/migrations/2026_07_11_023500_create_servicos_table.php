<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Tabela de serviços (procedimento × valor) por convênio (§5/§9) — precifica
// tratamentos e lançamentos. Dinheiro em decimal, nunca float (design D4).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('servicos', function (Blueprint $table) {
            $table->id();
            // restrict: convênio com serviços não pode ser excluído (design D4)
            $table->foreignId('convenio_id')->constrained('convenios')->restrictOnDelete();
            $table->string('procedimento');
            $table->decimal('valor', 10, 2);
            $table->timestamps();

            $table->unique(['convenio_id', 'procedimento']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('servicos');
    }
};
