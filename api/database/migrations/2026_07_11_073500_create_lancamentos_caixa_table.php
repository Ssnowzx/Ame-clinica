<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Lançamento de caixa (§9) — documento contábil-fiscal: PAGO não tem DELETE
// (T-fin-09). Dinheiro em decimal, NUNCA float (D1). Interessado polimórfico
// SEM FK física (T-fin-11 — a validação de aplicação é a única defesa).
// unique(agendamento_id) = anti-duplo-faturamento no banco (T-fin-13).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lancamentos_caixa', function (Blueprint $table) {
            $table->id();
            $table->string('tipo', 10); // receita|despesa
            $table->date('competencia');
            $table->date('vencimento');
            $table->string('interessado_tipo', 15)->nullable(); // paciente|fornecedor|funcionario
            $table->unsignedBigInteger('interessado_id')->nullable();
            $table->foreignId('categoria_id')->constrained('categorias')->restrictOnDelete();
            $table->foreignId('subcategoria_id')->nullable()->constrained('subcategorias')->restrictOnDelete();
            $table->decimal('valor', 10, 2);
            $table->decimal('juros', 10, 2)->default(0);
            $table->decimal('multa', 10, 2)->default(0);
            $table->decimal('desconto', 10, 2)->default(0);
            $table->foreignId('tipo_pagamento_id')->constrained('tipos_pagamento')->restrictOnDelete();
            $table->foreignId('conta_id')->constrained('contas')->restrictOnDelete();
            $table->boolean('contabil');
            $table->string('documento', 60)->nullable();
            $table->text('obs')->nullable();
            $table->foreignId('agendamento_id')->nullable()->unique()
                ->constrained('agendamentos')->restrictOnDelete();
            $table->foreignId('tratamento_id')->nullable()
                ->constrained('tratamentos')->restrictOnDelete();
            $table->uuid('grupo_parcelamento')->nullable();
            $table->unsignedSmallInteger('parcela')->nullable();
            $table->unsignedSmallInteger('parcelas_total')->nullable();
            $table->dateTime('pago_em')->nullable(); // server-set (T-fin-07)
            $table->timestamps();

            $table->index(['vencimento']);
            $table->index(['conta_id', 'pago_em']);
            $table->index(['grupo_parcelamento']);
            $table->index(
                ['interessado_tipo', 'interessado_id'],
                'lancamentos_caixa_interessado_index' // nome do Laravel excede 64 chars
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lancamentos_caixa');
    }
};
