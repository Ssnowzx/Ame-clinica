<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Espelho local dos templates APROVADOS na Meta (change mensageria-whatsapp).
 *
 * Fora da janela de 24h, template é o único jeito de a clínica iniciar conversa. O cadastro
 * e a submissão à aprovação acontecem no Business Manager (fora do escopo desta change); aqui
 * só se sincroniza o que já está aprovado, para o seletor da tela montar a prévia e cobrar as
 * variáveis ANTES do envio — em vez de deixar a recepção descobrir pelo erro da Meta.
 *
 * `status_meta` é espelho, não verdade: um template pode ser reprovado depois de sincronizado,
 * e é por isso que o envio confere o estado no momento de enviar.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mensagem_templates', function (Blueprint $table): void {
            $table->id();
            $table->string('nome', 120);
            $table->string('idioma', 10)->default('pt_BR');
            $table->string('categoria', 30)->nullable();
            $table->text('corpo_previa')->nullable();
            $table->json('variaveis_json')->nullable();
            // APPROVED | PENDING | REJECTED | PAUSED — vocabulário da Meta, preservado
            $table->string('status_meta', 20)->default('PENDING');
            $table->timestamp('sincronizado_em')->nullable();
            $table->timestamps();

            $table->unique(['nome', 'idioma']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mensagem_templates');
    }
};
