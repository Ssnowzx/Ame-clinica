<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Carimbo de leitura POR tarefa+usuário: responde "comentários não lidos" e
// "menções não lidas" de uma vez (design D7). Sem trilha de auditoria — carimbo
// de leitura é ruído, não mutação de dado.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tarefa_comentario_leituras', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tarefa_id')->constrained('tarefas')->cascadeOnDelete();
            $table->foreignId('usuario_id')->constrained('usuarios')->cascadeOnDelete();
            $table->timestamp('lido_em');
            $table->timestamps();

            $table->unique(['tarefa_id', 'usuario_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tarefa_comentario_leituras');
    }
};
