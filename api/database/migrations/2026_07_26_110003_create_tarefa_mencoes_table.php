<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Menções @ nos comentários do mural — revalidadas na gravação (ativo, sem
// auto-menção); alimentam o bloco de notificações (menções não lidas).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tarefa_mencoes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('comentario_id')
                ->constrained('tarefa_comentarios')->cascadeOnDelete();
            $table->foreignId('usuario_id')->constrained('usuarios')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['comentario_id', 'usuario_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tarefa_mencoes');
    }
};
