<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Responsabilidade COMPARTILHADA (M2M) — sync via service, auditado
// explicitamente (pivot não dispara evento de model — design D2).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tarefa_responsaveis', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tarefa_id')->constrained('tarefas')->cascadeOnDelete();
            $table->foreignId('usuario_id')->constrained('usuarios')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['tarefa_id', 'usuario_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tarefa_responsaveis');
    }
};
