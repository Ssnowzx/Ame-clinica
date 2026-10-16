<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Comunicados internos da clínica (§10) — texto PURO (nunca HTML interpretado,
// T-not-05); diff de auditoria EM CLARO deliberado (broadcast — parecer §1.4).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('informativos', function (Blueprint $table) {
            $table->id();
            $table->string('titulo', 150);
            $table->text('corpo');
            $table->boolean('publicado')->default(false);
            $table->foreignId('criado_por')->nullable()
                ->constrained('usuarios')->nullOnDelete();
            $table->timestamps();

            $table->index(['publicado']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('informativos');
    }
};
