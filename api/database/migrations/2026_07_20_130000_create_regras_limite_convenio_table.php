<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Regras de limite de atendimento por convênio (change limites-e-pedidos-por-convenio, D1):
// convênio × especialidade (NULL = todas) × período × limite × ação — regra é DADO (§13),
// nunca código. Precedente estrutural: a tabela de serviços (filha do convênio).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('regras_limite_convenio', function (Blueprint $table) {
            $table->id();
            // restrict: convênio com regras não some por engano — excluir pede limpar as
            // regras antes (cada exclusão auditada), mesmo backstop da tabela de serviços
            $table->foreignId('convenio_id')->constrained('convenios')->restrictOnDelete();
            // NULL = regra vale para TODAS as especialidades; restrict: excluir a
            // especialidade não pode transformar uma regra específica em "todas" (nullOn)
            // nem apagá-la em silêncio (cascade)
            $table->foreignId('especialidade_id')->nullable()
                ->constrained('especialidades')->restrictOnDelete();
            $table->string('periodo', 10);  // dia | semana | mes — domínio fechado no boundary
            $table->unsignedSmallInteger('limite'); // 1..99 (SEC-LP-08) — faixa no boundary
            $table->string('acao', 10);     // bloquear | avisar — domínio fechado no boundary
            // NULL escapa de UNIQUE no MariaDB (NULL ≠ NULL): duas regras "todas·mes"
            // passariam pelo índice. A coluna gerada COALESCE(especialidade_id, 0) fecha a
            // unicidade NO BANCO também para o caso "todas" (SEC-LP-07).
            $table->unsignedBigInteger('especialidade_chave')
                ->storedAs('coalesce(`especialidade_id`, 0)');
            $table->timestamps();

            $table->unique(
                ['convenio_id', 'especialidade_chave', 'periodo'],
                'regras_limite_convenio_unicas'
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('regras_limite_convenio');
    }
};
