<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Tratamento/pacote (§5/§7): amarra paciente+convênio+especialidade+profissional+serviço.
// matricula/guia são ARMAZENAMENTO (§14 — esteira de guias é do gestao_de_convenios).
// sessoes_realizadas só muda via atendimento (etapa 6) — nunca pela API de tratamentos.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tratamentos', function (Blueprint $table) {
            $table->id();
            $table->foreignId('paciente_id')->constrained('pacientes')->restrictOnDelete();
            $table->foreignId('convenio_id')->constrained('convenios')->restrictOnDelete();
            $table->foreignId('especialidade_id')->constrained('especialidades')->restrictOnDelete();
            $table->foreignId('profissional_id')->constrained('profissionais')->restrictOnDelete();
            $table->foreignId('servico_id')->nullable()->constrained('servicos')->restrictOnDelete();
            $table->string('tipo', 30)->default('pacote');
            $table->string('matricula')->nullable();
            $table->string('guia')->nullable();
            $table->unsignedSmallInteger('sessoes_total');
            $table->unsignedSmallInteger('sessoes_realizadas')->default(0);
            $table->date('data_inicio')->nullable();
            $table->unsignedSmallInteger('validade_dias')->nullable();
            $table->string('status', 20)->default('andamento');
            $table->timestamps();

            $table->index(['status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tratamentos');
    }
};
