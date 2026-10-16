<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A marca da CONFIRMAÇÃO do primeiro agendamento que saiu para a família (change
 * `avisos-do-agendamento-por-whatsapp`): a confirmação sai uma vez por criança, mesmo que o
 * agendamento seja excluído e recriado. Mudança de horário e cancelamento NÃO têm marca (rodada 2
 * do gate: calava aviso necessário) — o freio deles é o limite diário por família
 * (`mensagens.avisos_por_familia_dia`), contado em `mensagens`.
 *
 * A `chave` é `paciente:{id}`; o `tipo` fica na unicidade para um aviso futuro poder ter marca
 * própria sem migration nova. A marca sobrevive à exclusão do agendamento (`nullOnDelete`).
 *
 * Nenhum conteúdo de mensagem mora aqui (LGPD) — só a
 * marca; o texto está cifrado em `mensagens`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('avisos_a_familia', function (Blueprint $table): void {
            $table->id();
            // hoje só `confirmacao`
            $table->string('tipo', 20);
            $table->string('chave', 120);
            $table->foreignId('paciente_id')->nullable()->constrained('pacientes')->nullOnDelete();
            // nullOnDelete, e não cascade: a marca da confirmação precisa sobreviver à exclusão
            $table->foreignId('agendamento_id')->nullable()->constrained('agendamentos')->nullOnDelete();
            $table->foreignId('mensagem_id')->nullable()->constrained('mensagens')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tipo', 'chave'], 'avisos_a_familia_unico');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('avisos_a_familia');
    }
};
