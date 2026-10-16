<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Cartões (§9) — CADASTRO DORMENTE no v1 (T-fin-03): a engine de recebíveis/
// liquidação é fase 2 e exigirá parecer próprio. Faixas validadas na entrada.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cartoes', function (Blueprint $table) {
            $table->id();
            $table->string('nome');
            $table->string('tipo', 10); // credito|debito
            $table->decimal('pct_a_vista', 5, 2)->default(0);
            $table->unsignedSmallInteger('dias_recebimento')->default(0);
            $table->foreignId('conta_id')->constrained('contas')->restrictOnDelete();
            $table->boolean('liquidar_auto')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cartoes');
    }
};
