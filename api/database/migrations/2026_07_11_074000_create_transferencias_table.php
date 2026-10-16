<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Transferência entre contas (§9) — NÃO é lançamento: nunca entra nos totais de
// receita/despesa do extrato (T-fin-19).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('transferencias', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conta_origem_id')->constrained('contas')->restrictOnDelete();
            $table->foreignId('conta_destino_id')->constrained('contas')->restrictOnDelete();
            $table->decimal('valor', 10, 2);
            $table->date('data');
            $table->string('obs', 255)->nullable();
            $table->timestamps();

            $table->index(['data']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('transferencias');
    }
};
