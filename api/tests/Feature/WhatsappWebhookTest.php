<?php

use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\Paciente;
use App\Models\WebhookEvento;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;

/**
 * A porta pública (change mensageria-whatsapp, D4) — a superfície mais exposta da change.
 *
 * Três coisas são provadas aqui, e cada uma protege um erro conhecido desta integração:
 * 1. sem assinatura VÁLIDA nada é persistido — e a resposta não conta se o número existe;
 * 2. a assinatura é dos BYTES CRUS (o corpo re-serializado NÃO vale — é o erro clássico);
 * 3. reentrega da Meta tem efeito visível ZERO.
 *
 * Dados e credenciais 100% FICTÍCIOS.
 */
/** @return array<string, mixed> */
function eventoDeMensagem(array $sobrescreve = [], string $phoneNumberId = PHONE_ID_FICTICIO): array
{
    return ['entry' => [['changes' => [[
        'field' => 'messages',
        'value' => array_merge([
            'metadata' => ['phone_number_id' => $phoneNumberId],
            'contacts' => [['wa_id' => '5511987654321', 'profile' => ['name' => 'Perfil Fictício']]],
            'messages' => [[
                'from' => '5511987654321',
                'id' => 'wamid.FICTICIO_001',
                'timestamp' => (string) now()->timestamp,
                'type' => 'text',
                'text' => ['body' => 'Bom dia, posso remarcar a sessao de amanha?'],
            ]],
        ], $sobrescreve),
    ]]]]];
}

function entregar(array $payload, ?string $segredo = SEGREDO_FICTICIO): TestResponse
{
    $corpo = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $cabecalhos = ['Content-Type' => 'application/json'];

    if ($segredo !== null) {
        $cabecalhos['X-Hub-Signature-256'] = 'sha256='.hash_hmac('sha256', $corpo, $segredo);
    }

    return test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => $cabecalhos['X-Hub-Signature-256'] ?? '',
    ], $corpo);
}

beforeEach(function () {
    Queue::fake();
});

it('NÃO deve persistir NADA quando a assinatura não vem', function () {
    // ARRANGE
    admin();
    canalConectado();

    // ACT
    $resposta = entregar(eventoDeMensagem(), segredo: null);

    // ASSERT
    $resposta->assertForbidden();
    expect(Conversa::query()->count())->toBe(0);
    expect(Mensagem::query()->count())->toBe(0);
    expect(WebhookEvento::query()->count())->toBe(0);
});

it('NÃO deve aceitar assinatura calculada com segredo errado', function () {
    // ARRANGE
    admin();
    canalConectado();

    // ACT
    $resposta = entregar(eventoDeMensagem(), segredo: 'segredo_errado_ficticio');

    // ASSERT
    $resposta->assertForbidden();
    expect(Mensagem::query()->count())->toBe(0);
});

it('NÃO deve aceitar assinatura do corpo RE-SERIALIZADO (o erro clássico)', function () {
    // ARRANGE — `json_encode` reordena e escapa diferente; assinar o resultado em vez dos
    // bytes recebidos reprova entrega legítima. Aqui provamos o inverso: uma assinatura
    // calculada sobre OUTRA serialização do mesmo objeto não passa.
    admin();
    canalConectado();
    $payload = eventoDeMensagem();
    $outraSerializacao = json_encode($payload); // sem UNESCAPED_UNICODE: acentos viram \uXXXX

    // ACT
    $resposta = test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $outraSerializacao, SEGREDO_FICTICIO),
    ], json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

    // ASSERT
    $resposta->assertForbidden();
    expect(Mensagem::query()->count())->toBe(0);
});

it('deve responder ao número DESCONHECIDO igual a uma assinatura inválida', function () {
    // ARRANGE — diferenciar os dois transformaria o webhook num oráculo de existência.
    // `app.debug` desligado porque é a postura de produção (a §segurança amarra
    // APP_DEBUG=false ao deploy) — com o debug ligado, o stack trace da exceção difere
    // por número de linha e a comparação testaria o depurador, não a resposta.
    config(['app.debug' => false]);
    admin();
    canalConectado();

    // ACT
    $desconhecido = entregar(eventoDeMensagem(phoneNumberId: '000000000000000'));
    $assinaturaRuim = entregar(eventoDeMensagem(), segredo: 'outro_segredo_ficticio');

    // ASSERT
    expect($desconhecido->status())->toBe($assinaturaRuim->status());
    expect($desconhecido->getContent())->toBe($assinaturaRuim->getContent());
    expect(Conversa::query()->count())->toBe(0);
});

it('deve criar conversa e mensagem quando a assinatura confere', function () {
    // ARRANGE
    admin();
    canalConectado();

    // ACT
    $resposta = entregar(eventoDeMensagem());

    // ASSERT
    $resposta->assertOk();

    $conversa = Conversa::query()->firstOrFail();
    expect($conversa->telefone_e164)->toBe('+5511987654321');
    expect($conversa->nao_lidas)->toBe(1);
    expect($conversa->nome_perfil)->toBe('Perfil Fictício');
    // a janela de 24h nasce da mensagem recebida
    expect($conversa->janelaAberta())->toBeTrue();

    $mensagem = Mensagem::query()->firstOrFail();
    expect($mensagem->direcao)->toBe(Mensagem::DIRECAO_RECEBIDA);
    expect($mensagem->corpo)->toBe('Bom dia, posso remarcar a sessao de amanha?');
});

it('deve vincular a conversa ao paciente pelo telefone do cadastro', function () {
    // ARRANGE
    admin();
    canalConectado();
    $paciente = Paciente::factory()->create([
        'contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 98765-4321']],
    ]);

    // ACT
    entregar(eventoDeMensagem())->assertOk();

    // ASSERT
    expect(Conversa::query()->firstOrFail()->paciente_id)->toBe($paciente->id);
});

it('deve ligar à criança a resposta da família com celular de fora do país', function () {
    // ARRANGE — a Meta manda o DDI completo, sem o `+`; o cadastro tem o `+44` (change
    // telefone-estrangeiro). Reino Unido na faixa de ficção da Ofcom
    admin();
    canalConectado();
    $crianca = Paciente::factory()->create([
        'contatos_json' => [['tipo' => 'whatsapp', 'valor' => '+44 7700 900123']],
    ]);
    $doReinoUnido = eventoDeMensagem([
        'contacts' => [['wa_id' => '447700900123', 'profile' => ['name' => 'Perfil Fictício do Reino Unido']]],
        'messages' => [[
            'from' => '447700900123',
            'id' => 'wamid.FICTICIO_ESTRANGEIRO',
            'timestamp' => (string) now()->timestamp,
            'type' => 'text',
            'text' => ['body' => 'Bom dia, confirmo a sessao'],
        ]],
    ]);

    // ACT
    entregar($doReinoUnido)->assertOk();

    // ASSERT
    $conversa = Conversa::query()->sole();
    expect($conversa->telefone_e164)->toBe('+447700900123')
        ->and($conversa->paciente_id)->toBe($crianca->id)
        ->and($conversa->nome_perfil)->toBe('Perfil Fictício do Reino Unido');
});

it('deve continuar ligando à criança o celular brasileiro que a Meta entrega sem o nono dígito', function () {
    // ARRANGE — o cadastro tem o 9; a conta antiga do WhatsApp chega sem ele
    admin();
    canalConectado();
    $crianca = Paciente::factory()->create([
        'contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 98765-4321']],
    ]);
    $semONove = eventoDeMensagem([
        'contacts' => [['wa_id' => '551187654321', 'profile' => ['name' => 'Perfil Fictício']]],
        'messages' => [[
            'from' => '551187654321',
            'id' => 'wamid.FICTICIO_SEM_NONO',
            'timestamp' => (string) now()->timestamp,
            'type' => 'text',
            'text' => ['body' => 'Bom dia'],
        ]],
    ]);

    // ACT
    entregar($semONove)->assertOk();

    // ASSERT
    $conversa = Conversa::query()->sole();
    expect($conversa->telefone_e164)->toBe('+551187654321')
        ->and($conversa->paciente_id)->toBe($crianca->id);
});

it('deve absorver a REENTREGA do mesmo evento sem efeito visível', function () {
    // ARRANGE — a Meta reentrega por desenho; o efeito da segunda vez tem de ser ZERO
    admin();
    canalConectado();

    // ACT
    entregar(eventoDeMensagem())->assertOk();
    entregar(eventoDeMensagem())->assertOk();

    // ASSERT
    expect(Mensagem::query()->count())->toBe(1);
    expect(Conversa::query()->firstOrFail()->nao_lidas)->toBe(1);
});

it('deve absorver a MESMA mensagem chegando em evento diferente', function () {
    // ARRANGE — reentrega com timestamp de evento diferente escapa do hash do payload;
    // quem segura é o unique de `wa_message_id`
    admin();
    canalConectado();

    // ACT
    entregar(eventoDeMensagem())->assertOk();
    entregar(eventoDeMensagem(['contacts' => [['wa_id' => '5511987654321', 'profile' => ['name' => 'Outro Perfil']]]]))
        ->assertOk();

    // ASSERT
    expect(Mensagem::query()->count())->toBe(1);
    expect(Conversa::query()->firstOrFail()->nao_lidas)->toBe(1);
});

it('NÃO deve deixar um status atrasado rebaixar a mensagem já LIDA', function () {
    // ARRANGE — a Meta entrega status fora de ordem; é normal
    admin();
    canalConectado();
    entregar(eventoDeMensagem())->assertOk();
    $mensagem = Mensagem::query()->firstOrFail();
    $mensagem->forceFill(['direcao' => Mensagem::DIRECAO_ENVIADA, 'status' => 'pendente'])->save();

    $status = fn (string $qual) => eventoDeMensagem([
        'messages' => null,
        'statuses' => [['id' => 'wamid.FICTICIO_001', 'status' => $qual, 'timestamp' => (string) now()->timestamp]],
    ]);

    // ACT
    entregar($status('read'))->assertOk();
    entregar($status('sent'))->assertOk();

    // ASSERT
    expect($mensagem->fresh()->status)->toBe('lida');
});

it('deve avançar o status na ordem certa', function () {
    // ARRANGE
    admin();
    canalConectado();
    entregar(eventoDeMensagem())->assertOk();
    $mensagem = Mensagem::query()->firstOrFail();
    $mensagem->forceFill(['direcao' => Mensagem::DIRECAO_ENVIADA, 'status' => 'pendente'])->save();

    // ACT
    entregar(eventoDeMensagem([
        'messages' => null,
        'statuses' => [['id' => 'wamid.FICTICIO_001', 'status' => 'delivered', 'timestamp' => (string) now()->timestamp]],
    ]))->assertOk();

    // ASSERT
    expect($mensagem->fresh()->status)->toBe('entregue');
    expect($mensagem->fresh()->entregue_em)->not->toBeNull();
});

it('deve devolver o desafio do handshake em texto puro, e só com o token certo', function () {
    // ARRANGE — JSON aqui reprova a verificação no painel da Meta
    admin();
    canalConectado();

    // ACT / ASSERT
    $this->get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-ficticio-para-teste-1234567890&hub.challenge=desafio123')
        ->assertOk()
        ->assertSee('desafio123');

    $this->get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=desafio123')
        ->assertForbidden();

    // e o desafio REFLETIDO tem forma validada: a reflexão acontece no domínio da clínica
    $this->get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-ficticio-para-teste-1234567890&hub.challenge=<script>alert(1)</script>')
        ->assertForbidden();
});

it('deve reabrir conversa ARQUIVADA quando a família escreve de novo', function () {
    // ARRANGE — arquivar é "resolvido por ora", não "não quero mais falar"
    admin();
    canalConectado();
    entregar(eventoDeMensagem())->assertOk();
    Conversa::query()->firstOrFail()->forceFill(['arquivada_em' => now()])->save();

    // ACT
    entregar(eventoDeMensagem([
        'messages' => [[
            'from' => '5511987654321',
            'id' => 'wamid.FICTICIO_002',
            'timestamp' => (string) now()->timestamp,
            'type' => 'text',
            'text' => ['body' => 'oi de novo'],
        ]],
    ]))->assertOk();

    // ASSERT
    expect(Conversa::query()->firstOrFail()->arquivada_em)->toBeNull();
});

it('deve registrar tipo não suportado sem inventar corpo', function () {
    // ARRANGE — enquete, visualização única: a Meta não entrega o conteúdo, e pôr texto aqui
    // seria pôr palavra na boca da família (reação, figurinha e localização ganharam tipo
    // próprio na change conversa-legivel)
    admin();
    canalConectado();

    // ACT
    entregar(eventoDeMensagem([
        'messages' => [[
            'from' => '5511987654321',
            'id' => 'wamid.FICTICIO_003',
            'timestamp' => (string) now()->timestamp,
            'type' => 'unsupported',
            'errors' => [['code' => 131051, 'title' => 'Message type unknown']],
        ]],
    ]))->assertOk();

    // ASSERT
    $mensagem = Mensagem::query()->firstOrFail();
    expect($mensagem->tipo)->toBe('nao_suportado');
    expect($mensagem->corpo)->toBeNull();
});
