<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lista_espera', function (Blueprint $table) {
            $table->id();
            $table->foreignId('paciente_id')->constrained('pacientes')->restrictOnDelete();
            $table->foreignId('especialidade_id')->nullable()->constrained('especialidades')->restrictOnDelete();
            $table->foreignId('profissional_id')->nullable()->constrained('profissionais')->restrictOnDelete();
            $table->unsignedTinyInteger('prioridade')->default(0);
            $table->text('obs')->nullable();
            $table->timestamps();

            $table->index(['prioridade']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lista_espera');
    }
};
