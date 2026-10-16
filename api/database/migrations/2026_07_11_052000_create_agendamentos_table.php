<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Núcleo do produto (§6). inicio/fim em vez de data_hora+duracao (agenda D1):
// sobreposição vira comparação de intervalos indexável.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('agendamentos', function (Blueprint $table) {
            $table->id();
            $table->string('tipo', 20)->default('atendimento'); // atendimento|bloqueio (D3)
            $table->foreignId('paciente_id')->nullable()->constrained('pacientes')->restrictOnDelete();
            $table->foreignId('profissional_id')->constrained('profissionais')->restrictOnDelete();
            $table->foreignId('especialidade_id')->nullable()->constrained('especialidades')->restrictOnDelete();
            $table->foreignId('tratamento_id')->nullable()->constrained('tratamentos')->restrictOnDelete();
            $table->foreignId('sala_id')->nullable()->constrained('salas')->restrictOnDelete();
            $table->foreignId('equipamento_id')->nullable()->constrained('equipamentos')->restrictOnDelete();
            $table->foreignId('medico_id')->nullable()->constrained('medicos')->restrictOnDelete();
            $table->foreignId('status_id')->nullable()->constrained('status_agendamento')->restrictOnDelete();
            $table->dateTime('inicio');
            $table->dateTime('fim');
            $table->string('origem', 20)->default('recepcao');
            $table->boolean('is_reposicao')->default(false);
            $table->foreignId('reposicao_de_id')->nullable()
                ->constrained('agendamentos')->nullOnDelete();
            $table->uuid('recorrencia_grupo_id')->nullable();
            $table->text('obs')->nullable();
            $table->timestamps();

            $table->index(['profissional_id', 'inicio']);
            $table->index(['inicio']);
            $table->index(['recorrencia_grupo_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('agendamentos');
    }
};
