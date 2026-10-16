<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// MODELO de anamnese (template de ficha inicial — ≠ evolução, §5 correção 1).
// campos_json é o schema contra o qual as RESPOSTAS (change futura, dado sensível
// de menores) serão validadas — validação estrita é controle de segurança.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('anamnese_modelos', function (Blueprint $table) {
            $table->id();
            $table->string('titulo');
            $table->foreignId('especialidade_id')->nullable()
                ->constrained('especialidades')->restrictOnDelete();
            $table->json('campos_json');
            $table->boolean('ativo')->default(true);
            $table->timestamps();

            $table->unique(['titulo']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('anamnese_modelos');
    }
};
