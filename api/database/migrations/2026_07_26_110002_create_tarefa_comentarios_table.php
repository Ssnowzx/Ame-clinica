<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Comentários do mural — texto PURO (mesma doutrina dos informativos, T-not-05).
// autor_id preservado com nullOnDelete: a conversa sobrevive à saída do autor.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tarefa_comentarios', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tarefa_id')->constrained('tarefas')->cascadeOnDelete();
            $table->foreignId('autor_id')->nullable()
                ->constrained('usuarios')->nullOnDelete();
            $table->text('corpo');
            $table->timestamps();

        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tarefa_comentarios');
    }
};
