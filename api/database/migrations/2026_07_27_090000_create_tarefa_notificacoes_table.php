<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Eventos DIRECIONADOS do mural (change alertas-do-mural, design D1): primeira
// notificação PERSISTIDA do produto — restrita ao mural; os demais blocos do
// centro continuam derivados por leitura (§10). `tipo` validado na app como as
// colunas do quadro (ferramenta interna ≠ regra clínica §13). Sem trilha de
// auditoria — a MUTAÇÃO de origem já é auditada; o aviso é dado derivado.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tarefa_notificacoes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tarefa_id')->constrained('tarefas')->cascadeOnDelete();
            $table->foreignId('usuario_id')->constrained('usuarios')->cascadeOnDelete();
            $table->foreignId('autor_id')->constrained('usuarios')->cascadeOnDelete();
            $table->string('tipo', 20);
            $table->json('dados')->nullable();
            $table->timestamp('lida_em')->nullable();
            $table->timestamps();

            // a consulta do sino: "não lidas DESTE usuário" (design D1)
            $table->index(['usuario_id', 'lida_em']);
            // marcar lidas por tarefa ao abrir o modal (design D5)
            $table->index(['tarefa_id', 'usuario_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tarefa_notificacoes');
    }
};
