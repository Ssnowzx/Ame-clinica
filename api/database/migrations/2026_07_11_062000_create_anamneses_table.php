<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// ANAMNESE RESPONDIDA (§7) — ficha inicial aplicada ao paciente, validada contra
// o campos_json do modelo (etapa 2). Dado sensível de saúde de MENOR (art. 11):
// respostas cifradas pelo cast do model — mediumText comporta 60 campos × 2000
// chars + overhead do ciphertext. Sem DELETE no v1; modelo com respostas não se
// exclui (FK restrict).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('anamneses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('paciente_id')
                ->constrained('pacientes')->restrictOnDelete();
            $table->foreignId('modelo_id')
                ->constrained('anamnese_modelos')->restrictOnDelete();
            $table->mediumText('respostas_json');
            $table->dateTime('preenchida_em'); // server-set (T-ate-12)
            $table->timestamps();

        });
    }

    public function down(): void
    {
        Schema::dropIfExists('anamneses');
    }
};
