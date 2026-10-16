<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// EVOLUÇÃO = registro clínico POR SESSÃO (§7) — prontuário, dado sensível de
// saúde de MENOR (art. 11). conteudo cifrado pelo cast do model: mediumText
// comporta o teto de 20000 chars + overhead do ciphertext. Sem DELETE no v1.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('evolucoes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('atendimento_id')->unique()
                ->constrained('atendimentos')->restrictOnDelete();
            $table->foreignId('profissional_id')
                ->constrained('profissionais')->restrictOnDelete();
            $table->foreignId('responsavel_tecnico_id')->nullable()
                ->constrained('profissionais')->restrictOnDelete();
            $table->mediumText('conteudo');
            $table->dateTime('preenchida_em'); // server-set — evolução nasce preenchida (design D5)
            $table->timestamps();

            $table->index(['preenchida_em']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('evolucoes');
    }
};
