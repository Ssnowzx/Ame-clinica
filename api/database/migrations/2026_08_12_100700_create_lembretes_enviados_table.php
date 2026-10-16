<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Registro do que o disparo automático fez (change mensageria-whatsapp, D3).
 *
 * O UNIQUE `(agendamento_id, tipo, competencia)` É a garantia de "um lembrete por
 * agendamento" — não a checagem prévia no comando, que duas execuções simultâneas do
 * agendador furam. Mandar dois lembretes iguais para a mesma mãe é o defeito que a clínica
 * percebe primeiro, e o índice é o que o torna impossível.
 *
 * `competencia` é o DIA A QUE O LEMBRETE SE REFERE (não o dia do envio): é o que faz a regra
 * "segunda avisada na sexta" conviver com a idempotência sem que a segunda receba de novo no
 * domingo.
 *
 * A linha existe TAMBÉM para o não enviado, com motivo (sem telefone, teto atingido, opt-out):
 * a recepção precisa saber quem ficou sem aviso — silêncio aqui é a pessoa achando que a
 * família foi avisada.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('lembretes_enviados', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('agendamento_id')->constrained('agendamentos')->cascadeOnDelete();
            $table->string('tipo', 30)->default('lembrete_agendamento');
            $table->date('competencia');
            $table->foreignId('mensagem_id')->nullable()
                ->constrained('mensagens')->nullOnDelete();
            // enviado | nao_enviado
            $table->string('status', 20)->default('enviado');
            $table->string('motivo', 255)->nullable();
            $table->timestamps();

            // a invariante: um por agendamento, por tipo, por dia de referência
            $table->unique(['agendamento_id', 'tipo', 'competencia'], 'lembrete_unico');
            $table->index(['competencia']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lembretes_enviados');
    }
};
