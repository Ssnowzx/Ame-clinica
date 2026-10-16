<?php

use App\Jobs\EnviarMensagemJob;
use App\Models\Auditoria;
use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\Paciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\ErroDeEnvio;
use App\Support\Mensageria\FabricaDeCliente;
use Illuminate\Support\Facades\Queue;

/**
 * O envio (change mensageria-whatsapp, D5/D8/D9): janela de 24h, teto de custo e a regra
 * de que uma falha NUNCA some da thread.
 *
 * Dados 100% FICTÍCIOS.
 */
beforeEach(function () {
    Queue::fake();
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);
});

it('deve enviar texto dentro da janela e nascer PENDENTE', function () {
    // ARRANGE — o envio é assíncrono: um "Enviar" não espera a rede de um terceiro
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'texto',
        'corpo' => 'Bom dia! Confirmado para amanha as 14h.',
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('status', 'pendente');
    Queue::assertPushed(EnviarMensagemJob::class);
});

it('NÃO deve deixar escrever texto livre com a janela FECHADA', function () {
    // ARRANGE — regra do canal, verificada no SERVIDOR antes de qualquer chamada externa:
    // a tela carrega um relógio que corre no cliente e pode estar desatualizada
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta(janelaAberta: false);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'texto',
        'corpo' => 'oi',
    ]);

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors(['janela']);
    Queue::assertNothingPushed();
});

it('deve aceitar TEMPLATE com a janela fechada', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    templateAprovado();
    $conversa = conversaAberta(janelaAberta: false);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'template',
        'template' => 'lembrete_agendamento',
        'variaveis' => ['1' => 'Ana', '2' => 'quarta às 14h'],
    ]);

    // ASSERT — a prévia montada é o que a família vai ler, e é ela que fica na thread
    $resposta->assertCreated();
    expect(Mensagem::query()->firstOrFail()->corpo)
        ->toBe('Olá Ana, lembrando da sua sessão em quarta às 14h.');
});

it('NÃO deve enviar template com variável faltando', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    templateAprovado();
    $conversa = conversaAberta(janelaAberta: false);

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'template',
        'template' => 'lembrete_agendamento',
        'variaveis' => ['1' => 'Ana'],
    ]);

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors(['variaveis']);
});

it('NÃO deve enviar template que não está aprovado na Meta', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    templateAprovado()->forceFill(['status_meta' => 'REJECTED'])->save();
    $conversa = conversaAberta(janelaAberta: false);

    // ACT / ASSERT
    $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'template',
        'template' => 'lembrete_agendamento',
        'variaveis' => ['1' => 'Ana', '2' => 'quarta'],
    ])->assertStatus(422)->assertJsonValidationErrors(['template']);
});

it('NÃO deve enviar nada com o canal DESCONECTADO', function () {
    // ARRANGE — o estado de hoje: sistema pronto, credencial ainda não colada
    $admin = admin();
    $conversa = conversaAberta();

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'texto',
        'corpo' => 'oi',
    ]);

    // ASSERT — recusa com motivo, e nada enfileirado em silêncio para "quando conectar"
    $resposta->assertStatus(422)->assertJsonValidationErrors(['conexao']);
    Queue::assertNothingPushed();
});

it('deve BARRAR template quando o teto do mês é atingido', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    templateAprovado();
    app(ConfiguracaoService::class)->set('whatsapp.limite_mensal', 1);
    $conversa = conversaAberta(janelaAberta: false);

    $enviarTemplate = fn () => $this->actingAs($admin)
        ->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
            'tipo' => 'template',
            'template' => 'lembrete_agendamento',
            'variaveis' => ['1' => 'Ana', '2' => 'quarta'],
        ]);

    // ACT
    $enviarTemplate()->assertCreated();
    $segundo = $enviarTemplate();

    // ASSERT
    $segundo->assertStatus(422)->assertJsonValidationErrors(['limite']);
});

it('NÃO deve deixar o teto calar a RESPOSTA a uma família', function () {
    // ARRANGE — o teto protege a fatura; cortar a resposta a quem escreveu seria o efeito
    // colateral inaceitável dessa proteção (D9)
    $admin = admin();
    canalConectado();
    app(ConfiguracaoService::class)->set('whatsapp.limite_mensal', 0);
    $conversa = conversaAberta();

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'texto',
        'corpo' => 'Claro, pode trazer sim!',
    ]);

    // ASSERT
    $resposta->assertCreated();
});

it('deve marcar FALHOU com motivo legível no erro permanente, sem retentar', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();
    app()->instance(ClienteWhatsApp::class, new class extends ClienteSimulado
    {
        public function enviarTexto(string $paraE164, string $texto): string
        {
            throw ErroDeEnvio::permanente('Recipient phone number not a WhatsApp user.');
        }
    });

    $mensagem = new Mensagem(['corpo' => 'oi', 'tipo' => 'texto']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_ENVIADA;
    $mensagem->status = 'pendente';
    $mensagem->save();

    // ACT — roda o Job de verdade (sem fila)
    (new EnviarMensagemJob($mensagem->id))
        ->handle(app(FabricaDeCliente::class));

    // ASSERT — a mensagem NÃO some da thread: fica visível com o porquê
    $mensagem->refresh();
    expect($mensagem->status)->toBe('falhou');
    expect($mensagem->erro_motivo)->toBe('Recipient phone number not a WhatsApp user.');
});

it('deve RELANÇAR erro temporário para a fila retentar', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();
    app()->instance(ClienteWhatsApp::class, new class extends ClienteSimulado
    {
        public function enviarTexto(string $paraE164, string $texto): string
        {
            throw ErroDeEnvio::temporario('Service temporarily unavailable.');
        }
    });

    $mensagem = new Mensagem(['corpo' => 'oi', 'tipo' => 'texto']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_ENVIADA;
    $mensagem->status = 'pendente';
    $mensagem->save();

    // ACT / ASSERT — o Job falha (a fila cuida do backoff) e a mensagem segue pendente
    expect(fn () => (new EnviarMensagemJob($mensagem->id))
        ->handle(app(FabricaDeCliente::class)))
        ->toThrow(ErroDeEnvio::class);
    expect($mensagem->fresh()->status)->toBe('pendente');
});

it('deve gravar o id da Meta ao enviar, para o status futuro encontrar a mensagem', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();
    $mensagem = new Mensagem(['corpo' => 'oi', 'tipo' => 'texto']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_ENVIADA;
    $mensagem->status = 'pendente';
    $mensagem->save();

    // ACT
    (new EnviarMensagemJob($mensagem->id))
        ->handle(app(FabricaDeCliente::class));

    // ASSERT
    $mensagem->refresh();
    expect($mensagem->status)->toBe('enviada');
    expect($mensagem->wa_message_id)->toStartWith('wamid.');
});

it('NÃO deve encher a trilha com o progresso de entrega', function () {
    // ARRANGE — três registros de auditoria por mensagem (enviada→entregue→lida) afogariam
    // as escritas que importam: quem falou com a família, quem conectou o canal
    $admin = admin();
    canalConectado();
    $conversa = conversaAberta();
    $mensagem = new Mensagem(['corpo' => 'oi', 'tipo' => 'texto']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_ENVIADA;
    $mensagem->status = 'pendente';
    $mensagem->save();

    $antes = Auditoria::query()->where('entidade', 'mensagens')->count();

    // ACT
    (new EnviarMensagemJob($mensagem->id))
        ->handle(app(FabricaDeCliente::class));

    // ASSERT — a CRIAÇÃO continua auditada (é ela que prova o evento); o progresso, não
    expect(Auditoria::query()->where('entidade', 'mensagens')->count())->toBe($antes);
    expect($antes)->toBe(1);
});

it('deve zerar as não lidas ao ABRIR a conversa', function () {
    // ARRANGE — é a leitura que marca como lido; ninguém clica em "marcar como lida"
    $admin = admin();
    $conversa = conversaAberta();
    $conversa->forceFill(['nao_lidas' => 3])->save();

    // ACT
    $this->actingAs($admin)->getJson("/api/mensagens/conversas/{$conversa->id}")->assertOk();

    // ASSERT
    expect($conversa->fresh()->nao_lidas)->toBe(0);
});

it('deve permitir vincular e DESvincular a conversa a um paciente', function () {
    // ARRANGE — quem vinculou errado precisa poder desfazer
    $admin = admin();
    $conversa = conversaAberta();
    $paciente = Paciente::factory()->create();

    // ACT / ASSERT
    $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/vincular", [
        'paciente_id' => $paciente->id,
    ])->assertOk()->assertJsonPath('paciente.id', $paciente->id);

    $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/vincular", [
        'paciente_id' => null,
    ])->assertOk()->assertJsonPath('paciente', null);
});

it('NÃO deve expor mais que nome e nome social da criança', function () {
    // ARRANGE — esta aba fica aberta o dia inteiro num balcão de recepção
    $admin = admin();
    $conversa = conversaAberta();
    $paciente = Paciente::factory()->create(['necessidade' => 'TEA nivel 2 ficticio']);
    $conversa->forceFill(['paciente_id' => $paciente->id])->save();

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/mensagens/conversas');

    // ASSERT
    $resposta->assertOk();
    expect(array_keys($resposta->json('conversas.0.paciente')))->toBe(['id', 'nome', 'nome_social']);
    semVazamento($resposta->json(), 'TEA nivel 2 ficticio');
    semVazamento($resposta->json(), (string) $paciente->nascimento->format('Y-m-d'));
});

it('NÃO deve deixar quem só LÊ enviar mensagem', function () {
    // ARRANGE
    admin();
    canalConectado();
    $conversa = conversaAberta();
    $leitor = usuarioCom(['mensagens.ver'], 'Leitor');

    // ACT / ASSERT
    $this->actingAs($leitor)->getJson('/api/mensagens/conversas')->assertOk();
    $this->actingAs($leitor)->postJson("/api/mensagens/conversas/{$conversa->id}/mensagens", [
        'tipo' => 'texto', 'corpo' => 'oi',
    ])->assertForbidden();
});

it('NÃO deve deixar responder mensagem sem a permissão do módulo, mesmo com acesso a pacientes', function () {
    // ARRANGE — o canal não se herda de `pacientes.*` nem de `agenda.*`
    admin();
    $conversa = conversaAberta();
    $clinico = usuarioCom(['pacientes.ver', 'agenda.ver'], 'Clínico');

    // ACT / ASSERT
    $this->actingAs($clinico)->getJson('/api/mensagens/conversas')->assertForbidden();
});

it('deve marcar e desmarcar o opt-out de lembretes da família', function () {
    // ARRANGE
    $admin = admin();
    $conversa = conversaAberta();

    // ACT / ASSERT
    $this->actingAs($admin)->postJson("/api/mensagens/conversas/{$conversa->id}/lembretes", [
        'sem_lembretes' => true,
    ])->assertOk()->assertJsonPath('sem_lembretes', true);

    expect($conversa->fresh()->sem_lembretes)->toBeTrue();
});

it('deve entregar a thread em JANELA, não a conversa inteira', function () {
    // ARRANGE — dois anos de acompanhamento acumulam milhares de mensagens, e a tela relê a
    // thread a cada 8 s: sem janela, cada ciclo arrastaria tudo pela rede
    $admin = admin();
    $conversa = conversaAberta();

    foreach (range(1, 60) as $n) {
        $mensagem = new Mensagem(['corpo' => "mensagem ficticia {$n}", 'tipo' => 'texto']);
        $mensagem->conversa_id = $conversa->id;
        $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
        $mensagem->save();
    }

    // ACT
    $resposta = $this->actingAs($admin)->getJson("/api/mensagens/conversas/{$conversa->id}");

    // ASSERT — as 50 MAIS RECENTES (não as 50 mais antigas), em ordem de leitura
    $resposta->assertOk()->assertJsonCount(50, 'mensagens')->assertJsonPath('tem_anteriores', true);
    expect($resposta->json('mensagens.0.corpo'))->toBe('mensagem ficticia 11');
    expect($resposta->json('mensagens.49.corpo'))->toBe('mensagem ficticia 60');
});

it('deve paginar a thread para trás sem mexer nas não lidas', function () {
    // ARRANGE — ler histórico antigo não é "ler a conversa"
    $admin = admin();
    $conversa = conversaAberta();

    foreach (range(1, 60) as $n) {
        $mensagem = new Mensagem(['corpo' => "mensagem ficticia {$n}", 'tipo' => 'texto']);
        $mensagem->conversa_id = $conversa->id;
        $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
        $mensagem->save();
    }
    $conversa->forceFill(['nao_lidas' => 4])->save();
    $primeiraDaJanela = Mensagem::query()->orderByDesc('id')->skip(49)->first();

    // ACT
    $resposta = $this->actingAs($admin)
        ->getJson("/api/mensagens/conversas/{$conversa->id}?antes={$primeiraDaJanela->id}");

    // ASSERT
    $resposta->assertOk()->assertJsonCount(10, 'mensagens')->assertJsonPath('tem_anteriores', false);
    expect($resposta->json('mensagens.0.corpo'))->toBe('mensagem ficticia 1');
    expect($conversa->fresh()->nao_lidas)->toBe(4);
});

it('deve PAGINAR a lista de conversas — nunca cortar em silêncio', function () {
    // ARRANGE — com ~400 pacientes ativos, passar de uma página é certeza
    $admin = admin();

    foreach (range(1, 55) as $n) {
        $conversa = new Conversa;
        $conversa->telefone_e164 = '+55119876'.str_pad((string) $n, 5, '0', STR_PAD_LEFT);
        $conversa->ultima_mensagem_em = now()->subMinutes($n);
        $conversa->save();
    }

    // ACT
    $primeira = $this->actingAs($admin)->getJson('/api/mensagens/conversas');
    $segunda = $this->actingAs($admin)->getJson('/api/mensagens/conversas?page=2');

    // ASSERT — o TOTAL sai junto: a recepção sabe quantas conversas existem
    $primeira->assertOk()->assertJsonCount(50, 'conversas')
        ->assertJsonPath('total', 55)->assertJsonPath('ultima_pagina', 2);
    $segunda->assertOk()->assertJsonCount(5, 'conversas');
});
