<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Conversa de WhatsApp — uma por telefone canônico (change mensageria-whatsapp).
 *
 * `paciente_id` é NULLABLE por decisão, não por preguiça: quando o telefone corresponde a
 * dois pacientes (dois irmãos em terapia no mesmo número — o caso comum de uma clínica
 * infantil), a conversa fica NÃO VINCULADA e espera uma pessoa decidir. Adivinhar por ordem
 * de cadastro misturaria prontuário de criança.
 *
 * `janela_expira_em` materializa a regra da Meta: 24h contadas da última mensagem RECEBIDA;
 * fora dela só template passa. Fica em coluna para o servidor conferir antes de chamar a
 * Meta — perguntar a ela custa uma requisição e uma falha de rede a mais por envio.
 *
 * `sem_lembretes` é o opt-out da família: cala o disparo AUTOMÁTICO e não o atendimento
 * humano. Recusar aviso automático não é recusar ser atendido.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversas', function (Blueprint $table): void {
            $table->id();
            $table->string('telefone_e164', 20);
            $table->foreignId('paciente_id')->nullable()
                ->constrained('pacientes')->nullOnDelete();
            $table->string('nome_perfil', 120)->nullable();
            $table->timestamp('janela_expira_em')->nullable();
            $table->timestamp('ultima_mensagem_em')->nullable();
            $table->unsignedInteger('nao_lidas')->default(0);
            $table->boolean('sem_lembretes')->default(false);
            $table->timestamp('arquivada_em')->nullable();
            $table->timestamps();

            $table->unique(['telefone_e164']);
            // a lista da aba: não arquivadas, mais recentes primeiro
            $table->index(['arquivada_em', 'ultima_mensagem_em']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('conversas');
    }
};
