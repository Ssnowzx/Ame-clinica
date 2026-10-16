<?php

use App\Support\Mensageria\PreenchimentoDoLembrado;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A resposta da família ao lembrete (change `lembrete-com-botoes-de-resposta`, design D1/D2).
 *
 * `lembretes_enviados` ganha a resposta ao LEMBRETE daquela data — não ao agendamento: remarcar para
 * outro dia ou desmarcar apaga o estado da tela sem escrita nenhuma (o card só mostra a resposta
 * da linha cuja `competencia` é a data do `inicio`, com a sessão ainda marcada). `resposta_mensagem_id`
 * aponta o toque que respondeu, na conversa.
 *
 * `paciente_id` e `inicio_lembrado` (rodada 1 do gate, SEC-BT-01/CRB-08): de QUEM e de QUE HORÁRIO o
 * lembrete falou. A resposta só vale enquanto a sessão tem a mesma criança e o mesmo horário — se a
 * recepção troca a criança do agendamento, a família antiga não responde pela sessão da nova; se
 * remarca (mesmo no mesmo dia), o pedido de desmarque deixa de valer. As linhas existentes recebem o
 * paciente ATUAL do agendamento e o horário só quando a data ainda é a do lembrete
 * (`PreenchimentoDoLembrado`).
 *
 * `mensagem_templates.botoes_json` guarda os botões de resposta rápida de cada modelo (ordem e texto),
 * para o envio saber se o modelo os tem. A ordem é o significado: 1º confirmar, 2º desmarcar.
 *
 * Aditiva.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('lembretes_enviados', function (Blueprint $table): void {
            // confirmou | pediu_desmarque
            $table->string('resposta', 20)->nullable()->after('motivo');
            $table->timestamp('respondido_em')->nullable()->after('resposta');
            $table->foreignId('resposta_mensagem_id')->nullable()->after('respondido_em')
                ->constrained('mensagens')->nullOnDelete();
            $table->foreignId('paciente_id')->nullable()->after('agendamento_id')
                ->constrained('pacientes')->nullOnDelete();
            $table->dateTime('inicio_lembrado')->nullable()->after('competencia');
            // o instante do ÚLTIMO toque — ordena os toques ("vale o último", mesmo repetindo o botão),
            // enquanto `respondido_em` guarda a hora da resposta atual, que o card mostra (CRB2-02)
            $table->timestamp('ultimo_toque_em')->nullable()->after('respondido_em');
        });

        PreenchimentoDoLembrado::preencher();

        Schema::table('mensagem_templates', function (Blueprint $table): void {
            $table->json('botoes_json')->nullable()->after('variaveis_json');
        });
    }

    public function down(): void
    {
        Schema::table('mensagem_templates', function (Blueprint $table): void {
            $table->dropColumn('botoes_json');
        });

        Schema::table('lembretes_enviados', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('resposta_mensagem_id');
            $table->dropConstrainedForeignId('paciente_id');
            $table->dropColumn(['resposta', 'respondido_em', 'ultimo_toque_em', 'inicio_lembrado']);
        });
    }
};
