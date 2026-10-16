<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Mural de tarefas da equipe (change kanban-da-equipe). Colunas/prioridades são
// string validada na app (Rule::in), nunca ENUM de banco — mudar domínio é
// validação, não ALTER TABLE (design D1). Sem FK de paciente por decisão LGPD:
// o mural é operacional, dado clínico tem lugar próprio (prontuário).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tarefas', function (Blueprint $table) {
            $table->id();
            $table->string('titulo', 200);
            $table->text('descricao')->nullable();
            $table->string('coluna', 20)->default('a_fazer');
            $table->string('prioridade', 10)->default('media');
            $table->date('prazo')->nullable();
            $table->string('etiquetas', 255)->nullable();
            $table->unsignedInteger('posicao')->default(0);
            $table->timestamp('concluida_em')->nullable();
            $table->timestamp('arquivada_em')->nullable();
            $table->foreignId('criado_por')->nullable()
                ->constrained('usuarios')->nullOnDelete();
            $table->timestamps();

            $table->index(['coluna', 'posicao']);
            $table->index(['arquivada_em']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tarefas');
    }
};
