<?php

use App\Jobs\BaixarMidiaJob;
use App\Models\Auditoria;
use App\Models\Configuracao;
use App\Models\Conversa;
use App\Models\Mensagem;
use App\Models\MensagemMidia;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;

/*
 * A mensagem recebida diz o que é (change conversa-legivel, D1). Antes, reação, figurinha,
 * localização e contato caíam como "não suportado" e o tipo da Meta era jogado fora — a clínica
 * via cinco mensagens mudas num dia só. O payload chega pelo WEBHOOK assinado, o caminho de
 * produção. Dados FICTÍCIOS sempre (LGPD).
 */

/** O webhook assinado com UMA mensagem recebida do tipo dado. */
function chegarDaFamilia(array $mensagem, string $id = 'wamid.LEGIVEL_1'): TestResponse
{
    $corpo = json_encode(['entry' => [['changes' => [[
        'field' => 'messages',
        'value' => [
            'metadata' => ['phone_number_id' => PHONE_ID_FICTICIO],
            'contacts' => [['wa_id' => '5511987654321', 'profile' => ['name' => 'Perfil Fictício']]],
            'messages' => [array_merge([
                'from' => '5511987654321', 'id' => $id, 'timestamp' => (string) now()->timestamp,
            ], $mensagem)],
        ],
    ]]]]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    return test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $corpo, SEGREDO_FICTICIO),
    ], $corpo);
}

/** A única mensagem recebida. */
function aMensagemQueChegou(): Mensagem
{
    return Mensagem::query()->sole();
}

/** A mensagem como a thread a entrega à tela. */
function naThread($teste): array
{
    $conversa = Conversa::query()->sole();

    return $teste->getJson("/api/mensagens/conversas/{$conversa->id}")->assertOk()->json('mensagens.0');
}

/** O trecho da conversa na lista, como a tela o mostra. */
function trechoNaLista($teste): ?string
{
    return $teste->getJson('/api/mensagens/conversas')->assertOk()->json('conversas.0.trecho');
}

beforeEach(function () {
    Queue::fake();
});

it('deve registrar a reação com o emoji e o tipo original', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'reaction', 'reaction' => ['message_id' => 'wamid.DA_CLINICA', 'emoji' => '👍']])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    $mensagem = aMensagemQueChegou();
    expect($mensagem->tipo)->toBe('reacao')
        ->and($mensagem->corpo)->toBe('👍')
        ->and($mensagem->tipo_original)->toBe('reaction')
        ->and(trechoNaLista($this))->toBe('Reagiu com 👍');
});

it('deve registrar a reação retirada sem inventar emoji', function () {
    // ARRANGE — a Meta avisa quando a família tira a reação: a chave `emoji` não vem
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'reaction', 'reaction' => ['message_id' => 'wamid.DA_CLINICA']])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    expect(aMensagemQueChegou()->corpo)->toBeNull()
        ->and(trechoNaLista($this))->toBe('Tirou a reação');
});

it('deve baixar a figurinha como mídia e nomeá-la na lista', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'sticker', 'sticker' => ['id' => 'MIDIA_FICTICIA_9', 'mime_type' => 'image/webp', 'animated' => false]])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    $mensagem = aMensagemQueChegou();
    expect($mensagem->tipo)->toBe('figurinha')
        ->and($mensagem->corpo)->toBeNull()
        ->and(MensagemMidia::query()->sole()->wa_media_id)->toBe('MIDIA_FICTICIA_9')
        ->and(trechoNaLista($this))->toBe('Enviou uma figurinha');
    Queue::assertPushed(BaixarMidiaJob::class);
});

it('deve registrar a localização com nome, endereço e o link do mapa montado pelo servidor', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'location', 'location' => [
        'latitude' => -27.5954, 'longitude' => -48.548, 'name' => 'Praça Fictícia', 'address' => 'Rua Fictícia, 100',
    ]])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    $mensagem = naThread($this);
    expect($mensagem['tipo'])->toBe('localizacao')
        ->and($mensagem['corpo'])->toBe("Praça Fictícia\nRua Fictícia, 100")
        ->and($mensagem['mapa_url'])->toBe('https://www.google.com/maps/search/?api=1&query=-27.595400,-48.548000')
        // o endereço não sai no trecho da lista, que qualquer um vê de relance no balcão
        ->and(trechoNaLista($this))->toBe('Enviou uma localização');
});

it('não deve montar link do mapa com coordenada fora do planeta', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'location', 'location' => ['latitude' => 91, 'longitude' => 10]])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    $mensagem = naThread($this);
    expect($mensagem['tipo'])->toBe('localizacao')
        ->and($mensagem['mapa_url'])->toBeNull()
        ->and(aMensagemQueChegou()->detalhes_json)->toBeNull();
});

it('não deve montar link do mapa com coordenada que não é número', function () {
    // ARRANGE — o link é do servidor; nada que não seja número entra nele
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'location', 'location' => ['latitude' => 'javascript:alert(1)', 'longitude' => '10']])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    expect(naThread($this)['mapa_url'])->toBeNull();
});

it('deve guardar as coordenadas cifradas no banco', function () {
    // ARRANGE
    admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'location', 'location' => ['latitude' => -27.5954, 'longitude' => -48.548]])->assertOk();

    // ASSERT — coordenada é endereço de família: em repouso, nunca em claro
    $bruto = (string) DB::table('mensagens')->value('detalhes_json');
    expect($bruto)->not->toBe('')
        ->and($bruto)->not->toContain('27.5954')
        ->and($bruto)->not->toContain('latitude');
});

it('não deve pôr as coordenadas na trilha de auditoria', function () {
    // ARRANGE
    admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'location', 'location' => ['latitude' => -27.5954, 'longitude' => -48.548, 'name' => 'Praça Fictícia']])->assertOk();

    // ASSERT — a trilha prova que a mensagem existiu; o lugar fica fora dela, nem cifrado (a
    // trilha guarda o valor CRU, e o cru de uma coluna cifrada é o texto cifrado inteiro)
    $trilha = Auditoria::query()->withoutGlobalScopes()->where('entidade', 'mensagens')->sole();
    expect($trilha->diff_json['depois']['detalhes_json'])->toBe('***')
        ->and(json_encode($trilha->diff_json))->not->toContain('27.5954')
        ->and(json_encode($trilha->diff_json))->not->toContain('Praça Fictícia');
});

it('deve registrar o contato com nome e telefone, até cinco', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    $contatos = array_map(fn (int $i) => [
        'name' => ['formatted_name' => "Contato Fictício {$i}"],
        'phones' => [['phone' => "+55 11 90000-000{$i}", 'type' => 'CELL']],
    ], range(1, 7));

    // ACT
    chegarDaFamilia(['type' => 'contacts', 'contacts' => $contatos])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    $mensagem = aMensagemQueChegou();
    expect($mensagem->tipo)->toBe('contato')
        ->and(explode("\n", (string) $mensagem->corpo))->toHaveCount(5)
        ->and(explode("\n", (string) $mensagem->corpo)[0])->toBe('Contato Fictício 1 — +55 11 90000-0001')
        ->and(trechoNaLista($this))->toBe('Enviou um contato');
});

it('deve registrar o toque em mensagem interativa com o título tocado', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'interactive', 'interactive' => [
        'type' => 'list_reply', 'list_reply' => ['id' => 'opcao-1', 'title' => 'Manhã', 'description' => 'Das 8h às 12h'],
    ]])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    $mensagem = aMensagemQueChegou();
    expect($mensagem->tipo)->toBe('botao')
        ->and($mensagem->corpo)->toBe('Manhã')
        ->and($mensagem->tipo_original)->toBe('interactive')
        ->and(trechoNaLista($this))->toBe('Tocou em: Manhã');
});

it('deve guardar o subtipo do que o WhatsApp não entrega ao sistema', function () {
    // ARRANGE — a família editou uma mensagem: a Meta diz O QUE não entregou em `unsupported.type`
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia([
        'type' => 'unsupported',
        'unsupported' => ['type' => 'edit'],
        'errors' => [['code' => 131051, 'title' => 'Message type unknown']],
    ])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    $mensagem = aMensagemQueChegou();
    expect($mensagem->tipo)->toBe('nao_suportado')
        ->and($mensagem->corpo)->toBeNull()
        ->and($mensagem->tipo_original)->toBe('unsupported:edit')
        ->and(naThread($this)['tipo_original'])->toBe('unsupported:edit')
        ->and(trechoNaLista($this))->toBe('Editou uma mensagem');
});

it('deve guardar o tipo original do não suportado que vem sem subtipo', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'unsupported', 'errors' => [['code' => 131051, 'title' => 'Message type unknown']]])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    expect(aMensagemQueChegou()->tipo_original)->toBe('unsupported')
        ->and(trechoNaLista($this))->toBe('Mensagem que o WhatsApp não mostra');
});

it('deve dizer na lista que o ARQUIVO foi recusado, e não que o WhatsApp não mostra', function () {
    // ARRANGE — "não suportado" também é a mídia que NÓS recusamos (grande demais, formato fora da
    // lista): o WhatsApp entregou, e dizer o contrário manda a recepção pedir o que já chegou
    $admin = admin();
    $conversa = conversaAberta();
    $mensagem = new Mensagem(['corpo' => 'Legenda fictícia', 'tipo' => 'nao_suportado']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
    $mensagem->tipo_original = 'document';
    $mensagem->erro_motivo = 'Mídia recusada: formato não aceito.';
    $mensagem->save();

    // ACT
    $this->actingAs($admin);
    $trecho = trechoNaLista($this);

    // ASSERT
    expect($trecho)->toBe('Enviou um arquivo que o sistema não aceita');
});

it('não deve dar título a um toque interativo que não é resposta a botão nem a lista', function () {
    // ARRANGE — `nfm_reply` (formulário) não tem o que mostrar como toque
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'interactive', 'interactive' => [
        'type' => 'nfm_reply', 'nfm_reply' => ['name' => 'flow', 'response_json' => '{}'],
    ]])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    expect(aMensagemQueChegou()->tipo)->toBe('nao_suportado')
        ->and(aMensagemQueChegou()->tipo_original)->toBe('interactive');
});

it('não deve perder as mensagens boas do lote quando uma vem com formato quebrado', function (array $quebrada) {
    // ARRANGE — um 500 desfaz o evento inteiro e a Meta reentrega até desistir: a mensagem boa que
    // veio junto se perdia (SEC-CL-01)
    admin();
    canalConectado();
    $mensagens = [
        ['from' => '5511987654321', 'id' => 'wamid.BOA_1', 'timestamp' => (string) now()->timestamp, 'type' => 'text', 'text' => ['body' => 'Texto fictício bom']],
        array_merge(['from' => '5511987654321', 'id' => 'wamid.QUEBRADA_1', 'timestamp' => (string) now()->timestamp], $quebrada),
    ];
    $corpo = json_encode(['entry' => [['changes' => [[
        'field' => 'messages',
        'value' => ['metadata' => ['phone_number_id' => PHONE_ID_FICTICIO], 'messages' => $mensagens],
    ]]]]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // ACT
    $resposta = test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $corpo, SEGREDO_FICTICIO),
    ], $corpo);

    // ASSERT
    $resposta->assertOk();
    expect(DB::table('mensagens')->where('wa_message_id', 'wamid.BOA_1')->exists())->toBeTrue();
})->with([
    'type que não é texto' => [['type' => ['x' => 'y']]],
    'mime da figurinha em lista' => [['type' => 'sticker', 'sticker' => ['id' => 'MIDIA_FICTICIA_1', 'mime_type' => ['image/webp']]]],
    'id da figurinha maior que a coluna' => [['type' => 'sticker', 'sticker' => ['id' => str_repeat('9', 200), 'mime_type' => 'image/webp']]],
    'corpo do texto em lista' => [['type' => 'text', 'text' => ['body' => ['a', 'b']]]],
    'texto do botão em lista' => [['type' => 'button', 'button' => ['payload' => 'x', 'text' => ['a']]]],
    'id maior que a coluna' => [['id' => str_repeat('w', 200), 'type' => 'text', 'text' => ['body' => 'x']]],
    'timestamp exponencial' => [['timestamp' => '1e30', 'type' => 'text', 'text' => ['body' => 'x']]],
    'timestamp fora da faixa do banco' => [['timestamp' => '99999999999', 'type' => 'text', 'text' => ['body' => 'x']]],
    'timestamp depois de 2038' => [['timestamp' => '9999999999', 'type' => 'text', 'text' => ['body' => 'x']]],
]);

it('não deve perder a mensagem boa quando o resto do evento vem com formato quebrado', function (array $valor) {
    // ARRANGE — o que não é a mensagem também derrubava o lote: o nome do perfil, o status, o motivo
    // da falha (SEC-CL2-01)
    admin();
    canalConectado();
    $corpo = json_encode(['entry' => [['changes' => [[
        'field' => 'messages',
        'value' => array_merge([
            'metadata' => ['phone_number_id' => PHONE_ID_FICTICIO],
            'messages' => [['from' => '5511987654321', 'id' => 'wamid.BOA_1', 'timestamp' => (string) now()->timestamp, 'type' => 'text', 'text' => ['body' => 'Texto fictício bom']]],
        ], $valor),
    ]]]]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // ACT
    $resposta = test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $corpo, SEGREDO_FICTICIO),
    ], $corpo);

    // ASSERT
    $resposta->assertOk();
    expect(DB::table('mensagens')->where('wa_message_id', 'wamid.BOA_1')->exists())->toBeTrue();
})->with([
    'nome do perfil maior que a coluna' => [['contacts' => [['wa_id' => '5511987654321', 'profile' => ['name' => str_repeat('N', 200)]]]]],
    'status em lista' => [['statuses' => [['id' => 'wamid.BOA_1', 'status' => ['read']]]]],
    'motivo da falha em lista' => [['statuses' => [['id' => 'wamid.BOA_1', 'status' => 'failed', 'errors' => [['title' => ['x']]]]]]],
    'status que não é lista' => [['statuses' => 'lido']],
]);

it('não deve perder as outras entradas do evento quando uma vem com formato quebrado', function (string $caso) {
    // ARRANGE — `entry` e `changes` também são listas que a Meta monta; a quebrada não leva a boa
    // junto (CRL3-03). A boa vem antes
    admin();
    canalConectado();
    $valorBom = [
        'metadata' => ['phone_number_id' => PHONE_ID_FICTICIO],
        'messages' => [['from' => '5511987654321', 'id' => 'wamid.BOA_1', 'timestamp' => (string) now()->timestamp, 'type' => 'text', 'text' => ['body' => 'Texto fictício bom']]],
    ];
    $entradas = match ($caso) {
        'changes que não é lista' => [['changes' => [['field' => 'messages', 'value' => $valorBom]]], ['changes' => 'x']],
        'field em lista' => [['changes' => [['field' => ['a'], 'value' => $valorBom]]]],
    };
    $corpo = json_encode(['entry' => $entradas], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // ACT
    $resposta = test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $corpo, SEGREDO_FICTICIO),
    ], $corpo);

    // ASSERT
    $resposta->assertOk();
    expect(DB::table('mensagens')->where('wa_message_id', 'wamid.BOA_1')->exists())->toBeTrue();
})->with(['changes que não é lista', 'field em lista']);

it('deve responder com sucesso quando a lista de mensagens não é lista', function () {
    // ARRANGE
    admin();
    canalConectado();
    $corpo = json_encode(['entry' => [['changes' => [[
        'field' => 'messages',
        'value' => ['metadata' => ['phone_number_id' => PHONE_ID_FICTICIO], 'messages' => 'texto solto'],
    ]]]]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // ACT
    $resposta = test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $corpo, SEGREDO_FICTICIO),
    ], $corpo);

    // ASSERT
    $resposta->assertOk();
    expect(DB::table('mensagens')->count())->toBe(0);
});

it('deve guardar a troca de número da família sem guardar os números', function () {
    // ARRANGE — o `system` traz no corpo o número antigo e o novo: o subtipo basta para a recepção
    // conferir o cadastro, e os números não entram no banco (CRL2-06)
    $admin = admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'system', 'system' => [
        'body' => 'Fictício mudou de 5511987654321 para 5511900000000',
        'wa_id' => '5511900000000',
        'type' => 'user_changed_number',
    ]])->assertOk();

    // ASSERT
    $this->actingAs($admin);
    $mensagem = aMensagemQueChegou();
    expect($mensagem->tipo)->toBe('nao_suportado')
        ->and($mensagem->corpo)->toBeNull()
        ->and($mensagem->tipo_original)->toBe('system:user_changed_number')
        ->and(trechoNaLista($this))->toBe('Trocou de número no WhatsApp');
});

it('não deve guardar como tipo original o que não é nome de formato', function () {
    // ARRANGE — o tipo cru vai à tela como chave; lixo não é chave (SEC-CL2-02)
    admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => '<img src=x onerror=alert(1)>'])->assertOk();

    // ASSERT
    expect(DB::table('mensagens')->value('tipo_original'))->toBeNull()
        ->and(DB::table('mensagens')->value('tipo'))->toBe('nao_suportado');
});

it('deve gravar só tipos que o model declara', function (array $mensagem) {
    // ARRANGE — `Mensagem::TIPOS` é o catálogo que a tela espelha; um tipo novo gravado sem entrar
    // nele é um tipo que a tela não conhece
    admin();
    canalConectado();

    // ACT
    chegarDaFamilia($mensagem)->assertOk();

    // ASSERT
    expect(Mensagem::TIPOS)->toContain((string) DB::table('mensagens')->value('tipo'));
})->with([
    'texto' => [['type' => 'text', 'text' => ['body' => 'Olá fictício']]],
    'imagem' => [['type' => 'image', 'image' => ['id' => 'M1', 'mime_type' => 'image/jpeg']]],
    'vídeo' => [['type' => 'video', 'video' => ['id' => 'M2', 'mime_type' => 'video/mp4']]],
    'áudio' => [['type' => 'audio', 'audio' => ['id' => 'M3', 'mime_type' => 'audio/ogg']]],
    'documento' => [['type' => 'document', 'document' => ['id' => 'M4', 'mime_type' => 'application/pdf']]],
    'botão' => [['type' => 'button', 'button' => ['payload' => 'x', 'text' => 'Ok']]],
    'interativo' => [['type' => 'interactive', 'interactive' => ['type' => 'button_reply', 'button_reply' => ['id' => 'a', 'title' => 'Sim']]]],
    'reação' => [['type' => 'reaction', 'reaction' => ['message_id' => 'w', 'emoji' => '👍']]],
    'figurinha' => [['type' => 'sticker', 'sticker' => ['id' => 'M5', 'mime_type' => 'image/webp']]],
    'localização' => [['type' => 'location', 'location' => ['latitude' => 1, 'longitude' => 2]]],
    'contato' => [['type' => 'contacts', 'contacts' => [['name' => ['formatted_name' => 'Fictício']]]]],
    'não suportado' => [['type' => 'unsupported']],
]);

it('deve guardar o tipo original também do texto', function () {
    // ARRANGE — o `GROUP BY tipo_original` do runbook só responde se TODA recebida o tiver
    admin();
    canalConectado();

    // ACT
    chegarDaFamilia(['type' => 'text', 'text' => ['body' => 'Bom dia, texto fictício']])->assertOk();

    // ASSERT
    expect(DB::table('mensagens')->value('tipo_original'))->toBe('text');
});

it('deve apagar as coordenadas no expurgo e manter o tipo original', function () {
    // ARRANGE
    $admin = admin();
    canalConectado();
    Configuracao::create(['chave' => 'mensagens.retencao_dias', 'valor' => '30']);
    chegarDaFamilia(['type' => 'location', 'location' => ['latitude' => -27.5954, 'longitude' => -48.548, 'name' => 'Praça Fictícia']])->assertOk();
    DB::table('mensagens')->update(['created_at' => now()->subDays(60)]);

    // ACT
    $this->artisan('mensagens:expurgar')->assertSuccessful();

    // ASSERT
    $this->actingAs($admin);
    $mensagem = aMensagemQueChegou();
    expect($mensagem->corpo)->toBeNull()
        ->and($mensagem->detalhes_json)->toBeNull()
        ->and($mensagem->tipo_original)->toBe('location')
        ->and(naThread($this)['mapa_url'])->toBeNull();
});

it('não deve montar link do mapa de coordenada gravada fora da faixa', function () {
    // ARRANGE — a faixa é conferida na chegada E na leitura: o link não confia no que está no banco
    admin();
    $conversa = conversaAberta();
    $mensagem = new Mensagem(['corpo' => null, 'tipo' => 'localizacao']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_RECEBIDA;
    $mensagem->detalhes_json = ['latitude' => 10.0, 'longitude' => 181.0];
    $mensagem->save();

    // ACT
    $link = $mensagem->fresh()->mapaUrl();

    // ASSERT
    expect($link)->toBeNull();
});
