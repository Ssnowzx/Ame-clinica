<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Mensagem de uma conversa (change mensageria-whatsapp, D3).
 *
 * `wa_message_id` UNIQUE é a idempotência inteira: a Meta reentrega eventos, e a
 * defesa é o índice — não um SELECT antes do INSERT, que duas entregas em paralelo furam.
 * O caminho de escrita trata a violação de unicidade como SUCESSO, não como erro. Fica
 * nullable porque a mensagem que a clínica envia nasce antes de a Meta devolver o id (e o
 * unique do MySQL admite vários NULL).
 *
 * `automatica` é coluna e não dedução de `enviada_por IS NULL`: "null significa sistema" é
 * exatamente o tipo de codificação implícita que se lê errado seis meses depois.
 *
 * `expurgada_em` distingue "mensagem sem texto" de "texto apagado pela retenção" (D10) — sem
 * ela, a linha do tempo depois do expurgo parece corrompida em vez de minimizada.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mensagens', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('conversa_id')->constrained('conversas')->cascadeOnDelete();

            // recebida | enviada — string validada na app, nunca ENUM de banco
            $table->string('direcao', 10);
            $table->string('wa_message_id', 80)->nullable();
            // texto | imagem | audio | documento | video | template | nao_suportado
            $table->string('tipo', 20)->default('texto');
            $table->text('corpo')->nullable();
            $table->string('template_nome', 120)->nullable();
            // pendente | enviada | entregue | lida | falhou | recebida
            $table->string('status', 12)->default('pendente');
            $table->text('erro_motivo')->nullable();

            $table->foreignId('enviada_por')->nullable()
                ->constrained('usuarios')->nullOnDelete();
            $table->boolean('automatica')->default(false);

            $table->timestamp('recebida_em')->nullable();
            $table->timestamp('enviada_em')->nullable();
            $table->timestamp('entregue_em')->nullable();
            $table->timestamp('lida_em')->nullable();
            $table->timestamp('expurgada_em')->nullable();
            $table->timestamps();

            // a idempotência (vários NULL convivem; um mesmo id da Meta, não)
            $table->unique(['wa_message_id']);
            // a thread: mensagens de uma conversa em ordem
            $table->index(['conversa_id', 'id']);
            // o expurgo da retenção varre por idade
            $table->index(['created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mensagens');
    }
};
