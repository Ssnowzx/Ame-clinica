<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Rastro curto dos eventos recebidos no webhook (change mensageria-whatsapp, D3).
 *
 * Nem todo evento da Meta vira mensagem: status de entrega, erro e notificação de conta são a
 * maioria do volume. Guardá-los em `mensagens` inflaria a thread com o que ninguém lê. Aqui
 * fica só o hash do payload, para (a) descartar reentrega de evento que não gera mensagem e
 * (b) diagnosticar "a Meta mandou?" sem depender de log rotacionado.
 *
 * SEM corpo do evento: o payload traz o texto da mensagem e o telefone da família — guardá-lo
 * cru seria uma segunda cópia do dado de menor, fora de toda a proteção construída para a
 * primeira.
 *
 * Evento de número desconhecido NÃO entra aqui (não há conexão a quem pertencer): é descartado
 * com sucesso e registrado apenas no log da aplicação.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhook_eventos', function (Blueprint $table): void {
            $table->id();
            $table->char('payload_hash', 64);
            $table->string('tipo', 30)->nullable();
            $table->timestamp('recebido_em');

            $table->unique(['payload_hash']);
            // a limpeza periódica varre por idade
            $table->index(['recebido_em']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_eventos');
    }
};
