<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Mídia de uma mensagem (change mensageria-whatsapp) — foto, áudio, laudo em PDF.
 *
 * Mesmo tratamento dos `anexos` do paciente, pela mesma razão: é documento de MENOR, e o
 * NOME DO ARQUIVO codifica diagnóstico ("laudo-tea.pdf"). Por isso `caminho` é server-set
 * e mascarado na trilha, e o download exige `mensagens.ver` com verificação de escopo.
 *
 * `caminho` fica nullable para sobreviver ao expurgo da retenção (D10): o arquivo some, a
 * linha permanece dizendo que houve um documento naquele dia.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mensagem_midias', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('mensagem_id')->constrained('mensagens')->cascadeOnDelete();
            $table->string('wa_media_id', 80)->nullable();
            $table->string('mime', 120);
            $table->unsignedBigInteger('tamanho')->default(0);
            $table->string('caminho', 255)->nullable();
            $table->char('sha256', 64)->nullable();
            $table->timestamps();

        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mensagem_midias');
    }
};
