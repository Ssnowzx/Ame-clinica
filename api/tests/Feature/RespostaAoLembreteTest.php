<?php

use App\Http\Resources\AuditoriaResource;
use App\Jobs\EnviarMensagemJob;
use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Conversa;
use App\Models\LembreteEnviado;
use App\Models\Mensagem;
use App\Models\MensagemTemplate;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use App\Support\Agenda\AplicadorDeStatusEmLote;
use App\Support\Auditoria\OrigemDaOperacao;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\DisparoDeLembretes;
use App\Support\Mensageria\EnvioDeMensagens;
use App\Support\Mensageria\FabricaDeCliente;
use App\Support\Mensageria\PreenchimentoDoLembrado;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Testing\TestResponse;

/*
 * O toque da família num botão do lembrete (change lembrete-com-botoes-de-resposta, grupo 3). O
 * lembrete sai pelo DISPARO REAL (fila na hora, cliente simulado) e o toque chega pelo WEBHOOK
 * assinado — o caminho de produção inteiro. Dados FICTÍCIOS sempre (LGPD).
 */

const TELEFONE_DA_FAMILIA = '5511987654321';

/** O modelo do lembrete com os dois botões, configurado como o lembrete da clínica. */
function lembreteComBotoesConfigurado(): void
{
    MensagemTemplate::create([
        'nome' => 'lembrete_com_resposta', 'idioma' => 'pt_BR', 'categoria' => 'UTILITY',
        'corpo_previa' => 'Olá {{1}}, amanhã tem atendimento {{2}}. Podemos confirmar?',
        'variaveis_json' => ['1', '2'], 'status_meta' => 'APPROVED',
        'botoes_json' => [['tipo' => 'QUICK_REPLY', 'texto' => '✅ Confirmo'], ['tipo' => 'QUICK_REPLY', 'texto' => '❌ Preciso desmarcar']],
    ]);
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    app(ConfiguracaoService::class)->set('lembretes.template', 'lembrete_com_resposta');
}

/** Uma sessão de amanhã de uma criança com o celular da família; `quantas` crianças = irmãos. */
function sessoesDeAmanha(int $quantas = 1): array
{
    $base = baseDeAgenda();
    $sessoes = [];
    foreach (range(1, $quantas) as $i) {
        $pacienteId = $i === 1 ? $base['paciente_id'] : Paciente::factory()->create()->id;
        Paciente::query()->whereKey($pacienteId)->firstOrFail()
            ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 98765-4321']]]);
        $agendamento = Agendamento::factory()->create([
            'paciente_id' => $pacienteId, 'profissional_id' => $base['profissional_id'],
            'especialidade_id' => $base['especialidade_id'],
            'inicio' => agoraNaClinica()->addDay()->format('Y-m-d').' '.sprintf('%02d', 8 + $i).':00:00',
        ]);
        $agendamento->forceFill(['lembrete_whatsapp' => true, 'status_id' => StatusAgendamento::inicialId()])->save();
        $sessoes[] = $agendamento;
    }

    return $sessoes;
}

/** Canal, modelo, sessões e o lembrete JÁ ENVIADO; devolve [sessões, wamid do lembrete, cliente]. */
function lembreteEnviado(int $criancas = 1): array
{
    admin();
    canalConectado();
    lembreteComBotoesConfigurado();
    $simulado = new ClienteSimulado;
    app()->instance(ClienteWhatsApp::class, $simulado);
    config(['queue.default' => 'sync']);
    $sessoes = sessoesDeAmanha($criancas);
    app(DisparoDeLembretes::class)->executar();
    $wamid = (string) Mensagem::query()->where('template_nome', 'lembrete_com_resposta')->sole()->wa_message_id;
    $simulado->enviados = [];

    return [$sessoes, $wamid, $simulado];
}

/** O webhook assinado com o toque num botão. */
function tocar(?string $wamidDoLembrete, string $payload = 'botao:0', string $texto = '✅ Confirmo', string $de = TELEFONE_DA_FAMILIA, ?int $quando = null, string $id = 'wamid.TOQUE_1'): TestResponse
{
    $mensagem = [
        'from' => $de, 'id' => $id, 'timestamp' => (string) ($quando ?? now()->timestamp),
        'type' => 'button', 'button' => ['payload' => $payload, 'text' => $texto],
    ];
    if ($wamidDoLembrete !== null) {
        $mensagem['context'] = ['from' => '5511333344444', 'id' => $wamidDoLembrete];
    }
    $corpo = json_encode(['entry' => [['changes' => [[
        'field' => 'messages',
        'value' => [
            'metadata' => ['phone_number_id' => PHONE_ID_FICTICIO],
            'contacts' => [['wa_id' => $de, 'profile' => ['name' => 'Perfil Fictício']]],
            'messages' => [$mensagem],
        ],
    ]]]]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    return test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $corpo, SEGREDO_FICTICIO),
    ], $corpo);
}

/** @return list<string|null> a resposta de cada linha do lembrete */
function respostasDoLembrete(): array
{
    return LembreteEnviado::query()->orderBy('id')->pluck('resposta')->all();
}

it('deve confirmar pelo toque as sessões dos irmãos da mesma mensagem, sem mudar o status', function () {
    // ARRANGE — duas crianças, um telefone: um lembrete só
    [$sessoes, $wamid, $simulado] = lembreteEnviado(criancas: 2);

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU, LembreteEnviado::CONFIRMOU])
        ->and(LembreteEnviado::query()->whereNull('respondido_em')->count())->toBe(0)
        ->and($sessoes[0]->fresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and($sessoes[1]->fresh()->status_id)->toBe(StatusAgendamento::inicialId());
});

it('deve responder à família com o texto configurado da confirmação, marcado como automático', function () {
    // ARRANGE
    [, $wamid, $simulado] = lembreteEnviado();

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect($simulado->enviados)->toHaveCount(1)
        ->and($simulado->enviados[0]['tipo'])->toBe('texto')
        ->and($simulado->enviados[0]['texto'])->toBe('Obrigado! Presença confirmada ✅')
        ->and(Mensagem::query()->where('tipo', 'texto')->sole()->automatica)->toBeTrue();
});

it('deve registrar o toque na conversa com o texto do botão', function () {
    // ARRANGE
    [, $wamid] = lembreteEnviado();

    // ACT
    tocar($wamid, texto: '✅ Confirmo')->assertOk();

    // ASSERT
    $toque = Mensagem::query()->where('tipo', 'botao')->sole();
    expect($toque->corpo)->toBe('✅ Confirmo')
        ->and($toque->direcao)->toBe(Mensagem::DIRECAO_RECEBIDA)
        ->and(LembreteEnviado::query()->first()->resposta_mensagem_id)->toBe($toque->id);
});

it('deve sinalizar o pedido de desmarque sem desmarcar, e responder com o texto do desmarque', function () {
    // ARRANGE — o padrão é sinalizar: a recepção decide
    [$sessoes, $wamid, $simulado] = lembreteEnviado();

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::PEDIU_DESMARQUE])
        ->and($sessoes[0]->fresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and($simulado->enviados[0]['texto'])->toBe('Recebemos 👍 A recepção vai falar com você para remarcar.');
});

it('não deve responder ao lembrete com o toque de uma mensagem interativa que o cita', function () {
    // ARRANGE — o `interactive` também vira `botao` na conversa (conversa-legivel), mas não carrega
    // payload nosso: mesmo citando o lembrete e com o texto do botão, não é resposta a ele
    [$sessoes, $wamid, $simulado] = lembreteEnviado();
    $corpo = json_encode(['entry' => [['changes' => [[
        'field' => 'messages',
        'value' => [
            'metadata' => ['phone_number_id' => PHONE_ID_FICTICIO],
            'contacts' => [['wa_id' => TELEFONE_DA_FAMILIA, 'profile' => ['name' => 'Perfil Fictício']]],
            'messages' => [[
                'from' => TELEFONE_DA_FAMILIA, 'id' => 'wamid.INTERATIVO_1', 'timestamp' => (string) now()->timestamp,
                'type' => 'interactive', 'context' => ['from' => '5511333344444', 'id' => $wamid],
                'interactive' => ['type' => 'button_reply', 'button_reply' => ['id' => 'botao:0', 'title' => '✅ Confirmo']],
                // a chave `button` contrabandeada: só o `type` cru decide quem responde ao lembrete
                'button' => ['payload' => 'botao:0', 'text' => '✅ Confirmo'],
            ]],
        ],
    ]]]]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // ACT
    test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $corpo, SEGREDO_FICTICIO),
    ], $corpo)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([null])
        ->and(Mensagem::query()->where('wa_message_id', 'wamid.INTERATIVO_1')->sole()->tipo)->toBe('botao')
        ->and($simulado->enviados)->toBe([]);
});

it('não deve mexer na agenda com um toque que não cita mensagem nenhuma', function () {
    // ARRANGE
    [, , $simulado] = lembreteEnviado();

    // ACT
    tocar(null)->assertOk();

    // ASSERT — fica só na conversa
    expect(respostasDoLembrete())->toBe([null])
        ->and(Mensagem::query()->where('tipo', 'botao')->count())->toBe(1)
        ->and($simulado->enviados)->toBe([]);
});

it('não deve mexer na agenda com um toque que cita uma mensagem que não é lembrete', function () {
    // ARRANGE — um texto nosso na mesma conversa
    [, , $simulado] = lembreteEnviado();
    $texto = new Mensagem(['corpo' => 'Texto fictício', 'tipo' => 'texto']);
    $texto->conversa_id = Conversa::query()->sole()->id;
    $texto->direcao = Mensagem::DIRECAO_ENVIADA;
    $texto->wa_message_id = 'wamid.TEXTO_FICTICIO';
    $texto->save();

    // ACT
    tocar('wamid.TEXTO_FICTICIO')->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([null])
        ->and($simulado->enviados)->toBe([]);
});

it('não deve deixar outro telefone responder pelo lembrete de uma família', function () {
    // ARRANGE
    [, $wamid, $simulado] = lembreteEnviado();

    // ACT — outro número cita o wamid do lembrete
    tocar($wamid, de: '5511912345678')->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([null])
        ->and($simulado->enviados)->toBe([]);
});

it('não deve mexer na sessão que já passou nem responder à família', function () {
    // ARRANGE — a família toca no lembrete depois da sessão
    [, $wamid, $simulado] = lembreteEnviado();
    $this->travelTo(agoraNaClinica()->addDays(2));

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([null])
        ->and($simulado->enviados)->toBe([]);
});

it('não deve mexer na sessão que foi remarcada para outro dia', function () {
    // ARRANGE — o lembrete era de amanhã; a sessão foi para depois de amanhã
    [$sessoes, $wamid] = lembreteEnviado();
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update(['inicio' => agoraNaClinica()->addDays(2)->format('Y-m-d').' 09:00:00']);

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([null]);
});

it('não deve mexer na sessão que já não está marcada', function () {
    // ARRANGE — a recepção desmarcou antes do toque
    [$sessoes, $wamid] = lembreteEnviado();
    $desmarcado = StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->value('id');
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update(['status_id' => $desmarcado]);

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([null]);
});

it('deve ficar com o último toque quando a família muda de ideia', function () {
    // ARRANGE
    [, $wamid] = lembreteEnviado();
    tocar($wamid, quando: now()->timestamp - 60)->assertOk();

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: now()->timestamp, id: 'wamid.TOQUE_2')->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::PEDIU_DESMARQUE]);
});

it('não deve deixar um toque mais velho, entregue depois, apagar o mais novo', function () {
    // ARRANGE — a Meta entrega fora de ordem: o desmarque (mais novo) chega primeiro
    [, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: now()->timestamp, id: 'wamid.TOQUE_2')->assertOk();

    // ACT — a confirmação (mais velha) chega depois
    tocar($wamid, quando: now()->timestamp - 60)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::PEDIU_DESMARQUE]);
});

it('não deve dar significado a um payload que não é de botão nosso', function () {
    // ARRANGE — o modelo antigo do sistema anterior devolvia o próprio texto como payload
    [, $wamid, $simulado] = lembreteEnviado();

    // ACT
    tocar($wamid, payload: 'Confirmar')->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([null])
        ->and($simulado->enviados)->toBe([]);
});

it('não deve dar significado ao toque num lembrete cujo modelo não tem os dois botões', function () {
    // ARRANGE — o modelo perdeu os botões depois do envio (a clínica trocou na Meta)
    [, $wamid] = lembreteEnviado();
    MensagemTemplate::query()->where('nome', 'lembrete_com_resposta')->update(['botoes_json' => json_encode([['tipo' => 'QUICK_REPLY', 'texto' => 'Ok']])]);

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([null]);
});

it('não deve responder de novo quando a família toca o mesmo botão outra vez', function () {
    // ARRANGE — dez toques em "Confirmo" não podem virar dez "Obrigado!"; a hora do card continua a
    // do primeiro toque
    [, $wamid, $simulado] = lembreteEnviado();
    tocar($wamid, quando: now()->timestamp - 60)->assertOk();
    $primeiraHora = LembreteEnviado::query()->sole()->respondido_em;

    // ACT
    tocar($wamid, quando: now()->timestamp, id: 'wamid.TOQUE_2')->assertOk();

    // ASSERT
    expect($simulado->enviados)->toHaveCount(1)
        ->and(LembreteEnviado::query()->sole()->respondido_em->equalTo($primeiraHora))->toBeTrue();
});

it('deve processar uma vez só o mesmo evento reentregue pela Meta', function () {
    // ARRANGE
    [, $wamid, $simulado] = lembreteEnviado();
    tocar($wamid)->assertOk();

    // ACT — o mesmo corpo de novo
    tocar($wamid)->assertOk();

    // ASSERT — uma resposta automática só
    expect($simulado->enviados)->toHaveCount(1)
        ->and(Mensagem::query()->where('tipo', 'botao')->count())->toBe(1);
});

it('deve desmarcar sozinho no modo desmarcar, com a família como origem na trilha', function () {
    // ARRANGE
    [$sessoes, $wamid] = lembreteEnviado();
    $statusDaFamilia = StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->value('id');
    app(ConfiguracaoService::class)->set('lembretes.acao_desmarque', 'desmarcar');
    app(ConfiguracaoService::class)->set('lembretes.status_desmarque_familia_id', $statusDaFamilia);

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();

    // ASSERT
    expect($sessoes[0]->fresh()->status_id)->toBe($statusDaFamilia);
    $trilha = Auditoria::query()->where('entidade', 'agendamentos')->where('entidade_id', $sessoes[0]->id)->where('acao', 'atualizou')->latest('id')->first();
    expect($trilha?->autor_tipo)->toBe(OrigemDaOperacao::WHATSAPP)
        ->and($trilha?->usuario_id)->toBeNull()
        ->and(AuditoriaResource::make($trilha)->resolve()['autor'])->toBe('Família, pelo WhatsApp');
});

it('deve só sinalizar no modo sinalizar mesmo com o status da família configurado', function () {
    // ARRANGE — a escolha da clínica: marcar em vermelho; o status configurado é para o clique da
    // recepção, não para o sistema aplicar sozinho
    [$sessoes, $wamid] = lembreteEnviado();
    app(ConfiguracaoService::class)->set('lembretes.status_desmarque_familia_id', StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->value('id'));

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();

    // ASSERT
    expect($sessoes[0]->fresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and(respostasDoLembrete())->toBe([LembreteEnviado::PEDIU_DESMARQUE]);
});

it('deve só sinalizar no modo desmarcar quando o status da família não foi configurado', function () {
    // ARRANGE
    [$sessoes, $wamid] = lembreteEnviado();
    app(ConfiguracaoService::class)->set('lembretes.acao_desmarque', 'desmarcar');

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();

    // ASSERT
    expect($sessoes[0]->fresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and(respostasDoLembrete())->toBe([LembreteEnviado::PEDIU_DESMARQUE]);
});

it('não deve responder quando o texto da resposta está vazio, mas deve confirmar', function () {
    // ARRANGE
    [, $wamid, $simulado] = lembreteEnviado();
    app(ConfiguracaoService::class)->set('lembretes.resposta_confirmou', '');

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU])
        ->and($simulado->enviados)->toBe([]);
});

it('não deve responder à família que pediu para não receber mensagens automáticas', function () {
    // ARRANGE
    [, $wamid, $simulado] = lembreteEnviado();
    Conversa::query()->update(['sem_lembretes' => true]);

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU])
        ->and($simulado->enviados)->toBe([]);
});

it('deve manter a confirmação quando o envio da resposta falha', function () {
    // ARRANGE — o webhook responde 200 e a marcação fica
    [, $wamid] = lembreteEnviado();
    $this->mock(EnvioDeMensagens::class, fn ($envio) => $envio
        ->shouldReceive('enviarTexto')->andThrow(new RuntimeException('falha fictícia')));

    Exceptions::fake();

    // ACT
    $resposta = tocar($wamid);

    // ASSERT — a marcação fica e o relato diz o que falhou (N2-03)
    $resposta->assertOk();
    expect(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU]);
    Exceptions::assertReported(fn (RuntimeException $erro): bool => str_contains($erro->getMessage(), 'Resposta automática ao lembrete não saiu'));
});

it('não deve contar a resposta automática no teto mensal de modelos', function () {
    // ARRANGE — teto já no limite com o próprio lembrete: a resposta em texto sai mesmo assim
    [, $wamid, $simulado] = lembreteEnviado();
    app(ConfiguracaoService::class)->set('whatsapp.limite_mensal', 1);

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect($simulado->enviados)->toHaveCount(1);
});

// ── O card da agenda (grupo 4.1) ─────────────────────────────────────────────────────────────

/** Os cards de amanhã, como a grade os pede. */
function cardsDeAmanha($teste): array
{
    $amanha = agoraNaClinica()->addDay()->format('Y-m-d');
    $usuario = Usuario::query()->whereHas('roles', fn ($r) => $r->where('name', 'Administrador'))->firstOrFail();

    return $teste->actingAs($usuario)->getJson("/api/agenda?de={$amanha}&ate={$amanha}")->assertOk()->json();
}

it('deve mostrar no card que o lembrete saiu e a família ainda não respondeu', function () {
    // ARRANGE
    lembreteEnviado();

    // ACT
    $cards = cardsDeAmanha($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBe(['estado' => 'aguardando', 'em' => null, 'confirmavel' => true]);
});

it('deve mostrar no card a confirmação da família com a hora do toque', function () {
    // ARRANGE
    [, $wamid] = lembreteEnviado();
    tocar($wamid)->assertOk();

    // ACT
    $cards = cardsDeAmanha($this);

    // ASSERT
    expect($cards[0]['confirmacao']['estado'])->toBe('confirmado')
        ->and($cards[0]['confirmacao']['em'])->not->toBeNull()
        ->and($cards[0]['confirmacao']['por'])->toBe('familia');
});

it('deve mostrar no card o pedido de desmarque', function () {
    // ARRANGE
    [, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();

    // ACT
    $cards = cardsDeAmanha($this);

    // ASSERT
    expect($cards[0]['confirmacao']['estado'])->toBe('pediu_desmarque');
});

it('deve mostrar no card o lembrete que não foi entregue', function () {
    // ARRANGE — a Meta avisou que falhou: é preciso ligar para a família
    lembreteEnviado();
    Mensagem::query()->where('template_nome', 'lembrete_com_resposta')->update(['status' => 'falhou']);

    // ACT
    $cards = cardsDeAmanha($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBe(['estado' => 'nao_entregue', 'em' => null, 'confirmavel' => true]);
});

it('deve tirar o alerta do card quando a recepção desmarca a sessão', function () {
    // ARRANGE — pediu para desmarcar, e a recepção resolveu
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update([
        'status_id' => StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->value('id'),
    ]);

    // ACT
    $cards = cardsDeAmanha($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBeNull();
});

it('não deve mostrar estado no card de sessão sem lembrete', function () {
    // ARRANGE — uma sessão de amanhã sem WhatsApp
    admin();
    $sessao = sessoesDeAmanha()[0];
    $sessao->forceFill(['lembrete_whatsapp' => false])->save();

    // ACT
    $cards = cardsDeAmanha($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBeNull();
});

it('não deve mostrar no card a resposta a um lembrete de outro dia', function () {
    // ARRANGE — confirmou o lembrete de amanhã; a sessão foi para depois de amanhã
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid)->assertOk();
    $depois = agoraNaClinica()->addDays(2)->format('Y-m-d');
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update(['inicio' => $depois.' 09:00:00', 'fim' => $depois.' 09:40:00']);

    // ACT
    $usuario = Usuario::query()->firstOrFail();
    $cards = $this->actingAs($usuario)->getJson("/api/agenda?de={$depois}&ate={$depois}")->assertOk()->json();

    // ASSERT
    expect($cards[0]['confirmacao'])->toBeNull();
});

it('deve carregar a resposta de todos os cards sem uma consulta por card', function () {
    // ARRANGE — 1 sessão e depois 12: o número de consultas da grade não cresce
    // (cada medição vem depois de uma leitura de aquecimento: a primeira da requisição carrega
    // permissões e sessão, e isso não é da grade)
    lembreteEnviado();
    DB::enableQueryLog();
    cardsDeAmanha($this);
    DB::flushQueryLog();
    cardsDeAmanha($this);
    $comUma = count(DB::getQueryLog());
    sessoesDeAmanha(11);
    app(DisparoDeLembretes::class)->executar();
    cardsDeAmanha($this);
    DB::flushQueryLog();

    // ACT
    $cards = cardsDeAmanha($this);
    $comDoze = count(DB::getQueryLog());

    // ASSERT
    expect(count($cards))->toBe(12)
        ->and($comDoze)->toBe($comUma);
});

// ── O centro de notificações (grupo 5) ───────────────────────────────────────────────────────

it('deve acender o bloco de pedidos de desmarque contando por dia, sem nome de criança', function () {
    // ARRANGE — duas crianças do mesmo lembrete pediram para desmarcar
    [, $wamid] = lembreteEnviado(criancas: 2);
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $bloco = $this->actingAs($admin)->getJson('/api/notificacoes')->assertOk()->json('pedidos_de_desmarque');

    // ASSERT
    expect($bloco)->toBe(['total' => 2, 'itens' => [['dia' => agoraNaClinica()->addDay()->format('Y-m-d'), 'total' => 2]]])
        ->and(json_encode($bloco))->not->toContain('nome');
});

it('deve apagar o pedido do bloco quando a recepção resolve', function () {
    // ARRANGE
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update([
        'status_id' => StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->value('id'),
    ]);
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $bloco = $this->actingAs($admin)->getJson('/api/notificacoes')->json('pedidos_de_desmarque');

    // ASSERT
    expect($bloco['total'])->toBe(0);
});

it('não deve contar a confirmação no bloco de pedidos de desmarque', function () {
    // ARRANGE
    [, $wamid] = lembreteEnviado();
    tocar($wamid)->assertOk();
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $bloco = $this->actingAs($admin)->getJson('/api/notificacoes')->json('pedidos_de_desmarque');

    // ASSERT
    expect($bloco['total'])->toBe(0);
});

it('deve mostrar à profissional escopada só os pedidos da própria agenda', function () {
    // ARRANGE — dois irmãos, cada um com uma profissional; a escopada é a do segundo
    [$sessoes, $wamid] = lembreteEnviado(criancas: 2);
    $outra = Profissional::factory()->create();
    DB::table('agendamentos')->where('id', $sessoes[1]->id)->update(['profissional_id' => $outra->id]);
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    $escopada = usuarioEscopadoEm($outra);

    // ACT
    $bloco = $this->actingAs($escopada)->getJson('/api/notificacoes')->json('pedidos_de_desmarque');

    // ASSERT
    expect($bloco['total'])->toBe(1);
});

it('não deve entregar o bloco a quem não vê a agenda', function () {
    // ARRANGE
    lembreteEnviado();
    $semAgenda = usuarioCom(['pacientes.ver'], 'Sem Agenda Fictício');

    // ACT
    $blocos = $this->actingAs($semAgenda)->getJson('/api/notificacoes')->assertOk()->json();

    // ASSERT
    expect($blocos)->not->toHaveKey('pedidos_de_desmarque');
});

it('não deve contar no bloco o pedido de uma sessão que foi para outro dia', function () {
    // ARRANGE — pediu para desmarcar a de amanhã; a recepção a remarcou para depois de amanhã
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    $depois = agoraNaClinica()->addDays(2)->format('Y-m-d');
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update(['inicio' => $depois.' 09:00:00', 'fim' => $depois.' 09:40:00']);
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $bloco = $this->actingAs($admin)->getJson('/api/notificacoes')->json('pedidos_de_desmarque');

    // ASSERT
    expect($bloco['total'])->toBe(0);
});

// ── Rodada 1 do gate ────────────────────────────────────────────────────────────────────────────

it('não deve deixar a família antiga responder depois que a recepção troca a criança da sessão', function () {
    // ARRANGE — o lembrete falou da criança A; a sessão passou a ser da criança B (SEC-BT-01)
    [$sessoes, $wamid] = lembreteEnviado();
    $outra = Paciente::factory()->create()->id;
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update(['paciente_id' => $outra]);

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();

    // ASSERT — nada na sessão de B: nem resposta, nem estado no card, nem pedido no sino
    $admin = Usuario::query()->firstOrFail();
    expect(respostasDoLembrete())->toBe([null])
        ->and(cardsDeAmanha($this)[0]['confirmacao'])->toBeNull()
        ->and($this->actingAs($admin)->getJson('/api/notificacoes')->json('pedidos_de_desmarque.total'))->toBe(0);
});

it('deve apagar o pedido de desmarque quando a recepção remarca no mesmo dia', function () {
    // ARRANGE — pediu para desmarcar as 09:00; a recepção passou para as 15:00 do mesmo dia (CRB-08)
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    $dia = agoraNaClinica()->addDay()->format('Y-m-d');
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update(['inicio' => $dia.' 15:00:00', 'fim' => $dia.' 15:40:00']);

    // ACT
    $cards = cardsDeAmanha($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBeNull();
});

it('deve aceitar o toque do celular antigo que a Meta entrega sem o nono dígito', function () {
    // ARRANGE — o lembrete foi para +55 11 98765-4321; a Meta entrega o toque como 55 11 8765-4321 (CRB-02)
    [, $wamid] = lembreteEnviado();

    // ACT
    tocar($wamid, de: '551187654321')->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU]);
});

it('não deve mandar a resposta automática com as mensagens automáticas desligadas', function () {
    // ARRANGE — a clínica desligou o automático depois de o lembrete sair (CRB-03)
    [, $wamid, $simulado] = lembreteEnviado();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', false);

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT — a confirmação conta; a resposta não sai
    expect(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU])
        ->and($simulado->enviados)->toBe([]);
});

it('não deve dar significado ao toque cujo texto não é o do botão daquela posição', function () {
    // ARRANGE — alguém inverteu os botões na Meta: o 1º agora diz "Preciso desmarcar"
    [, $wamid] = lembreteEnviado();

    // ACT
    tocar($wamid, payload: 'botao:0', texto: '❌ Preciso desmarcar')->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([null]);
});

it('deve reconhecer o toque pelo modelo do mesmo idioma do envio', function () {
    // ARRANGE — um modelo de mesmo nome em inglês, sem botões, é o PRIMEIRO da tabela (CRB-05)
    [, $wamid] = lembreteEnviado();
    MensagemTemplate::query()->where('nome', 'lembrete_com_resposta')->delete();
    MensagemTemplate::create([
        'nome' => 'lembrete_com_resposta', 'idioma' => 'en_US', 'categoria' => 'UTILITY', 'corpo_previa' => 'Hello {{1}} {{2}}',
        'variaveis_json' => ['1', '2'], 'status_meta' => 'APPROVED', 'botoes_json' => [],
    ]);
    lembreteComBotoesConfigurado();

    // ACT
    tocar($wamid)->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU]);
});

it('deve mandar os botões do modelo do mesmo idioma da mensagem', function () {
    // ARRANGE — o de mesmo nome em inglês, sem botões, vem primeiro; a mensagem é em português (CRB-05)
    admin();
    canalConectado();
    MensagemTemplate::create([
        'nome' => 'lembrete_com_resposta', 'idioma' => 'en_US', 'categoria' => 'UTILITY', 'corpo_previa' => 'Hello {{1}} {{2}}',
        'variaveis_json' => ['1', '2'], 'status_meta' => 'APPROVED', 'botoes_json' => [],
    ]);
    lembreteComBotoesConfigurado();
    $simulado = new ClienteSimulado;
    app()->instance(ClienteWhatsApp::class, $simulado);
    $conversa = conversaAberta(janelaAberta: false);
    $mensagem = new Mensagem(['corpo' => 'Prévia fictícia', 'tipo' => 'template']);
    $mensagem->conversa_id = $conversa->id;
    $mensagem->direcao = Mensagem::DIRECAO_ENVIADA;
    $mensagem->status = 'pendente';
    $mensagem->template_nome = 'lembrete_com_resposta';
    $mensagem->template_idioma = 'pt_BR';
    $mensagem->variaveis_json = ['1' => 'Criança Fictícia', '2' => '14:00'];
    $mensagem->save();

    // ACT
    (new EnviarMensagemJob($mensagem->id))->handle(app(FabricaDeCliente::class));

    // ASSERT
    expect($simulado->enviados[0]['botoes'])->toBe([0 => 'botao:0', 1 => 'botao:1']);
});

it('deve só sinalizar no modo desmarcar quando o status da família foi editado para descontar', function () {
    // ARRANGE — o ponteiro foi gravado válido; depois, a clínica editou o status (SEC-BT-02/CRB-06)
    [$sessoes, $wamid] = lembreteEnviado();
    $statusDaFamilia = StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->value('id');
    app(ConfiguracaoService::class)->set('lembretes.acao_desmarque', 'desmarcar');
    app(ConfiguracaoService::class)->set('lembretes.status_desmarque_familia_id', $statusDaFamilia);
    DB::table('status_agendamento')->where('id', $statusDaFamilia)->update(['desconta_sessao' => true]);

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();

    // ASSERT
    expect($sessoes[0]->fresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and(respostasDoLembrete())->toBe([LembreteEnviado::PEDIU_DESMARQUE]);
});

it('não deve desmarcar sozinho a sessão que mudou entre a marcação e o desmarque', function () {
    // ARRANGE — a recepção remarca no meio do caminho: o desmarque reconfere sob trava (SEC-BT-04/CRB-07)
    [$sessoes, $wamid] = lembreteEnviado();
    app(ConfiguracaoService::class)->set('lembretes.acao_desmarque', 'desmarcar');
    app(ConfiguracaoService::class)->set('lembretes.status_desmarque_familia_id', StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->value('id'));
    $dia = agoraNaClinica()->addDay()->format('Y-m-d');
    LembreteEnviado::saved(function (LembreteEnviado $linha) use ($dia): void {
        if ($linha->resposta === LembreteEnviado::PEDIU_DESMARQUE) {
            DB::table('agendamentos')->where('id', $linha->agendamento_id)->update(['inicio' => $dia.' 16:00:00', 'fim' => $dia.' 16:40:00']);
        }
    });

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();

    // ASSERT
    expect($sessoes[0]->fresh()->status_id)->toBe(StatusAgendamento::inicialId());
});

it('não deve pôr o telefone da família no log quando o banco falha no toque', function () {
    // ARRANGE — a mensagem de uma QueryException traz os bindings (CRB-09)
    Exceptions::fake();
    [, $wamid] = lembreteEnviado();
    $pdo = new PDOException('falha fictícia');
    $pdo->errorInfo = ['HY000', 1205, 'Lock wait timeout'];
    LembreteEnviado::saving(function () use ($pdo): void {
        throw new QueryException('mysql', 'update lembretes_enviados set x = ?', ['+5511987654321'], $pdo);
    });

    // ACT
    $resposta = tocar($wamid);

    // ASSERT — o webhook responde; o log só tem a forma do erro
    $resposta->assertOk();
    Exceptions::assertReported(fn (RuntimeException $erro): bool => str_contains($erro->getMessage(), 'Resposta ao lembrete não aplicada')
        && str_contains($erro->getMessage(), 'SQLSTATE HY000/1205')
        && ! str_contains($erro->getMessage(), '98765'));
    Exceptions::assertNotReported(QueryException::class);
});

it('deve mostrar o toque na lista de conversas como a thread mostra', function () {
    // ARRANGE (N2) — sem a resposta automática, o toque é a última mensagem da conversa
    [, $wamid] = lembreteEnviado();
    app(ConfiguracaoService::class)->set('lembretes.resposta_confirmou', '');
    tocar($wamid)->assertOk();
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $lista = $this->actingAs($admin)->getJson('/api/mensagens/conversas')->assertOk()->json();

    // ASSERT
    expect(json_encode($lista, JSON_UNESCAPED_UNICODE))->toContain('Tocou em: ✅ Confirmo');
});

// ── Manter a sessão (a família desistiu) ─────────────────────────────────────────────────────────

it('deve manter a sessão quando a família desiste do pedido de desmarque', function () {
    // ARRANGE — tocou errado e confirmou por telefone (CRB-08)
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessoes[0]->id}/manter-sessao");

    // ASSERT — confirmado; o elo com o toque da família (a evidência) fica; o sino apaga
    $resposta->assertOk();
    expect($resposta->json('confirmacao.estado'))->toBe('confirmado')
        ->and(LembreteEnviado::query()->sole()->resposta_mensagem_id)->toBe(Mensagem::query()->where('tipo', 'botao')->sole()->id)
        ->and($this->actingAs($admin)->getJson('/api/notificacoes')->json('pedidos_de_desmarque.total'))->toBe(0);
});

it('deve recusar manter a sessão quando não há pedido de desmarque que valha', function () {
    // ARRANGE — a família confirmou; não há o que desfazer
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid)->assertOk();
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessoes[0]->id}/manter-sessao");

    // ASSERT
    $resposta->assertStatus(422);
});

it('não deve deixar a profissional escopada manter a sessão de outra agenda', function () {
    // ARRANGE
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    $escopada = usuarioEscopadoEm(Profissional::factory()->create());

    // ACT
    $resposta = $this->actingAs($escopada)->postJson("/api/agendamentos/{$sessoes[0]->id}/manter-sessao");

    // ASSERT
    $resposta->assertForbidden();
    expect(respostasDoLembrete())->toBe([LembreteEnviado::PEDIU_DESMARQUE]);
});

it('não deve deixar quem não edita a agenda manter a sessão', function () {
    // ARRANGE
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    $soVe = usuarioCom(['agenda.ver'], 'Só Vê Fictício');

    // ACT
    $resposta = $this->actingAs($soVe)->postJson("/api/agendamentos/{$sessoes[0]->id}/manter-sessao");

    // ASSERT
    $resposta->assertForbidden();
});

it('deve tirar o pedido do sino e do card quando a recepção troca a criança depois do pedido', function () {
    // ARRANGE — a família pediu para desmarcar; a recepção deu a vaga para outra criança
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update(['paciente_id' => Paciente::factory()->create()->id]);
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $bloco = $this->actingAs($admin)->getJson('/api/notificacoes')->json('pedidos_de_desmarque');
    $cards = cardsDeAmanha($this);

    // ASSERT
    expect($bloco['total'])->toBe(0)
        ->and($cards[0]['confirmacao'])->toBeNull();
});

// ── Rodada 2 do gate ────────────────────────────────────────────────────────────────────────────

it('deve ficar com o último toque mesmo quando a família repete o botão fora de ordem', function () {
    // ARRANGE — "Confirmo" t1, "Confirmo" t3 e, chegando por último, "Preciso desmarcar" t2 (CRB2-02)
    [, $wamid] = lembreteEnviado();
    $agora = now()->timestamp;
    tocar($wamid, quando: $agora - 120, id: 'wamid.TOQUE_T1')->assertOk();
    tocar($wamid, quando: $agora, id: 'wamid.TOQUE_T3')->assertOk();

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: $agora - 60, id: 'wamid.TOQUE_T2')->assertOk();

    // ASSERT — o último toque foi uma confirmação
    expect(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU]);
});

it('deve registrar na trilha do agendamento quem manteve a sessão', function () {
    // ARRANGE — se a sessão virar falta depois, a clínica sabe quem decidiu manter (CRB2-03/SEC-BT-06)
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $this->actingAs($admin)->postJson("/api/agendamentos/{$sessoes[0]->id}/manter-sessao")->assertOk();

    // ASSERT
    $trilha = Auditoria::query()->where('entidade', 'agendamentos')->where('entidade_id', $sessoes[0]->id)->where('acao', 'manteve_sessao')->sole();
    expect($trilha->usuario_id)->toBe($admin->id)
        ->and($trilha->autor_tipo)->toBe(OrigemDaOperacao::USUARIO);
});

it('não deve deixar um toque mais velho da família desfazer a sessão mantida pela recepção', function () {
    // ARRANGE — a recepção manteve; chega atrasado um toque ANTERIOR de "Preciso desmarcar"
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: now()->timestamp - 120)->assertOk();
    $admin = Usuario::query()->firstOrFail();
    $this->actingAs($admin)->postJson("/api/agendamentos/{$sessoes[0]->id}/manter-sessao")->assertOk();

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: now()->timestamp - 60, id: 'wamid.TOQUE_ATRASADO')->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU]);
});

it('deve responder à família mesmo quando o desmarque automático falha', function () {
    // ARRANGE — o pedido já foi gravado; a falha do desmarque não cala a resposta (N2-05)
    Exceptions::fake();
    [, $wamid, $simulado] = lembreteEnviado();
    app(ConfiguracaoService::class)->set('lembretes.acao_desmarque', 'desmarcar');
    app(ConfiguracaoService::class)->set('lembretes.status_desmarque_familia_id', StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->value('id'));
    $this->mock(AplicadorDeStatusEmLote::class, fn ($aplicador) => $aplicador
        ->shouldReceive('aplicar')->andThrow(new RuntimeException('falha fictícia')));

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();

    // ASSERT
    expect(respostasDoLembrete())->toBe([LembreteEnviado::PEDIU_DESMARQUE])
        ->and($simulado->enviados)->toHaveCount(1);
    Exceptions::assertReported(fn (RuntimeException $erro): bool => str_contains($erro->getMessage(), 'Desmarque automático não aplicado'));
});

it('deve preencher o lembrete antigo só quando a sessão continua na data dele', function () {
    // ARRANGE — um lembrete de ANTES da change (sem criança/horário) de uma sessão que depois foi
    // remarcada para outro dia, e o lembrete novo dessa outra data com pedido de desmarque (CRB2-01)
    [$sessoes] = lembreteEnviado();
    $antigo = LembreteEnviado::query()->sole();
    $depois = agoraNaClinica()->addDays(2)->format('Y-m-d');
    DB::table('agendamentos')->where('id', $sessoes[0]->id)->update(['inicio' => $depois.' 09:00:00', 'fim' => $depois.' 09:40:00']);
    DB::table('lembretes_enviados')->where('id', $antigo->id)->update(['paciente_id' => null, 'inicio_lembrado' => null]);
    DB::table('lembretes_enviados')->insert([
        'agendamento_id' => $sessoes[0]->id, 'paciente_id' => $sessoes[0]->paciente_id,
        'tipo' => LembreteEnviado::TIPO_AGENDAMENTO, 'competencia' => $depois, 'inicio_lembrado' => $depois.' 09:00:00',
        'status' => LembreteEnviado::ENVIADO, 'resposta' => LembreteEnviado::PEDIU_DESMARQUE, 'respondido_em' => now(),
        'created_at' => now(), 'updated_at' => now(),
    ]);

    // ACT
    PreenchimentoDoLembrado::preencher();

    // ASSERT — o antigo fica sem horário (falha fechada) e o card mostra o pedido do lembrete novo
    $admin = Usuario::query()->firstOrFail();
    $cards = $this->actingAs($admin)->getJson("/api/agenda?de={$depois}&ate={$depois}")->assertOk()->json();
    expect($antigo->fresh()->inicio_lembrado)->toBeNull()
        ->and($antigo->fresh()->paciente_id)->toBe($sessoes[0]->paciente_id)
        ->and($cards[0]['confirmacao']['estado'])->toBe('pediu_desmarque');
});

it('deve preencher criança e horário do lembrete antigo cuja sessão continua na data', function () {
    // ARRANGE — o caso comum do backfill
    [$sessoes] = lembreteEnviado();
    DB::table('lembretes_enviados')->update(['paciente_id' => null, 'inicio_lembrado' => null]);

    // ACT
    PreenchimentoDoLembrado::preencher();

    // ASSERT
    $linha = LembreteEnviado::query()->sole();
    expect($linha->paciente_id)->toBe($sessoes[0]->paciente_id)
        ->and($linha->inicio_lembrado?->format('Y-m-d H:i'))->toBe($sessoes[0]->inicio->format('Y-m-d H:i'));
});

it('não deve oferecer o desmarque da família quando o status foi editado para descontar', function () {
    // ARRANGE — o ponteiro foi gravado válido; depois o status passou a descontar (N2-04)
    $admin = admin();
    $alvo = StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->firstOrFail();
    app(ConfiguracaoService::class)->set('lembretes.status_desmarque_familia_id', $alvo->id);
    DB::table('status_agendamento')->where('id', $alvo->id)->update(['desconta_sessao' => true]);

    // ACT
    $status = collect($this->actingAs($admin)->getJson('/api/agenda/selecao')->assertOk()->json('status'));

    // ASSERT
    expect($status->where('desmarque_da_familia', true)->count())->toBe(0);
});

// ── Confirmação pela clínica × toque da família (change confirmacao-pela-clinica) ─────────────────

it('deve dizer que a clínica confirmou depois que a recepção mantém a sessão', function () {
    // ARRANGE — "Manter" também é a clínica registrando o que a família disse por telefone
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar')->assertOk();
    $admin = Usuario::query()->firstOrFail();

    // ACT
    $this->actingAs($admin)->postJson("/api/agendamentos/{$sessoes[0]->id}/manter-sessao")->assertOk();

    // ASSERT — pela GRADE, que é o que a recepção vê
    expect(cardsDeAmanha($this)[0]['confirmacao']['por'])->toBe('clinica')
        ->and(LembreteEnviado::query()->sole()->confirmado_por)->toBe($admin->id);
});

it('deve valer o pedido de desmarque que a família toca depois da confirmação da clínica', function () {
    // ARRANGE — a recepção confirmou por telefone; mais tarde a família toca em "Preciso desmarcar"
    [$sessoes] = lembreteEnviado();
    $wamid = (string) Mensagem::query()->where('template_nome', 'lembrete_com_resposta')->sole()->wa_message_id;
    $admin = Usuario::query()->firstOrFail();
    $this->actingAs($admin)->postJson("/api/agendamentos/{$sessoes[0]->id}/confirmar")->assertOk();

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: now()->addMinute()->timestamp)->assertOk();

    // ASSERT — o pedido é da família: a confirmação da clínica deixa de valer
    $linha = LembreteEnviado::query()->sole();
    expect($linha->resposta)->toBe(LembreteEnviado::PEDIU_DESMARQUE)
        ->and($linha->confirmado_por)->toBeNull()
        ->and(cardsDeAmanha($this)[0]['confirmacao']['estado'])->toBe('pediu_desmarque');
});

it('não deve deixar um toque mais velho, entregue depois, desfazer a confirmação da clínica', function () {
    // ARRANGE — a família tocou em "Preciso desmarcar" ANTES de a recepção confirmar, mas o toque chegou depois
    [$sessoes, $wamid] = lembreteEnviado();
    $admin = Usuario::query()->firstOrFail();
    $this->actingAs($admin)->postJson("/api/agendamentos/{$sessoes[0]->id}/confirmar")->assertOk();

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: now()->subMinutes(2)->timestamp)->assertOk();

    // ASSERT
    expect(cardsDeAmanha($this)[0]['confirmacao'])->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica']);
});

it('deve continuar confirmada pela clínica quando a família toca em Confirmo depois', function () {
    // ARRANGE — a resposta não muda: a hora e a origem do card ficam as da clínica
    [$sessoes, $wamid] = lembreteEnviado();
    $admin = Usuario::query()->firstOrFail();
    $this->actingAs($admin)->postJson("/api/agendamentos/{$sessoes[0]->id}/confirmar")->assertOk();
    $horaDaClinica = LembreteEnviado::query()->sole()->respondido_em;

    // ACT
    tocar($wamid, quando: now()->addMinute()->timestamp)->assertOk();

    // ASSERT
    $linha = LembreteEnviado::query()->sole();
    expect($linha->confirmado_por)->toBe($admin->id)
        ->and($linha->respondido_em->equalTo($horaDaClinica))->toBeTrue();
});

it('não deve deixar o número que saiu do cadastro desfazer a confirmação da clínica', function () {
    // ARRANGE — gate r1, CR-CC-01: o lembrete foi para o número errado; a recepção ligou para a família
    // certa, confirmou e corrigiu o cadastro. A reabertura não reabre a confirmada, mas tira dela a
    // mensagem do número antigo
    [$sessoes, $wamid] = lembreteEnviado();
    $admin = Usuario::query()->firstOrFail();
    $this->actingAs($admin)->postJson("/api/agendamentos/{$sessoes[0]->id}/confirmar")->assertOk();
    Paciente::query()->whereKey($sessoes[0]->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 91234-5678']]]);

    // ACT — quem tem o número antigo toca "Preciso desmarcar" depois
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: now()->addMinute()->timestamp)->assertOk();

    // ASSERT
    $linha = LembreteEnviado::query()->sole();
    expect($linha->resposta)->toBe(LembreteEnviado::CONFIRMOU)
        ->and($linha->confirmado_por)->toBe($admin->id)
        ->and($linha->mensagem_id)->toBeNull()
        ->and(cardsDeAmanha($this)[0]['confirmacao'])->toMatchArray(['estado' => 'confirmado', 'por' => 'clinica']);
});

it('não deve deixar o número que saiu do cadastro mudar a resposta que ele mesmo deu', function () {
    // ARRANGE — gate r2, SEC-CC-07 (modo sinalizar, o da clínica): o lembrete foi ao número de outra
    // família, que pediu para desmarcar; a recepção só corrigiu o cadastro
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: now()->subMinutes(5)->timestamp)->assertOk();
    Paciente::query()->whereKey($sessoes[0]->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 91234-5678']]]);

    // ACT — o número antigo toca "Confirmo" depois
    tocar($wamid, quando: now()->timestamp, id: 'wamid.TOQUE_DEPOIS')->assertOk();

    // ASSERT — a bandeira não some por um toque de quem já não é da família
    $linha = LembreteEnviado::query()->sole();
    expect($linha->resposta)->toBe(LembreteEnviado::PEDIU_DESMARQUE)
        ->and($linha->mensagem_id)->toBeNull();
});

it('não deve deixar o número que saiu do cadastro desmarcar sozinho a sessão', function () {
    // ARRANGE — gate r2, SEC-CC-07 (modo desmarcar): o número errado tinha confirmado; a recepção
    // corrigiu o cadastro, e depois ele toca "Preciso desmarcar"
    [$sessoes, $wamid] = lembreteEnviado();
    tocar($wamid, quando: now()->subMinutes(5)->timestamp)->assertOk();
    app(ConfiguracaoService::class)->set('lembretes.acao_desmarque', 'desmarcar');
    app(ConfiguracaoService::class)->set('lembretes.status_desmarque_familia_id', StatusAgendamento::where('nome', 'Desmarcado pelo Paciente')->value('id'));
    Paciente::query()->whereKey($sessoes[0]->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 91234-5678']]]);

    // ACT
    tocar($wamid, payload: 'botao:1', texto: '❌ Preciso desmarcar', quando: now()->timestamp, id: 'wamid.TOQUE_DEPOIS')->assertOk();

    // ASSERT
    expect($sessoes[0]->fresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and(respostasDoLembrete())->toBe([LembreteEnviado::CONFIRMOU]);
});

it('deve tirar o número antigo da linha mesmo quando a confirmação da clínica grava no meio da reabertura', function () {
    // ARRANGE — gate r2, CR-CC-13: a reabertura leu a linha sem resposta, e a recepção confirmou antes da
    // escrita; quem decide é o banco, não a leitura
    [$sessoes] = lembreteEnviado();
    $admin = Usuario::query()->firstOrFail();
    $injetou = false;
    DB::listen(function ($consulta) use (&$injetou, $admin): void {
        $sql = strtolower($consulta->sql);
        if (! $injetou && str_starts_with($sql, 'select') && str_contains($sql, 'lembretes_enviados')
            && str_contains($sql, 'competencia') && str_contains($sql, 'mensagem_id')) {
            $injetou = true;
            DB::table('lembretes_enviados')->update([
                'resposta' => LembreteEnviado::CONFIRMOU, 'respondido_em' => now(), 'ultimo_toque_em' => now(), 'confirmado_por' => $admin->id,
            ]);
        }
    });

    // ACT — a recepção corrige o cadastro
    Paciente::query()->whereKey($sessoes[0]->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 91234-5678']]]);

    // ASSERT
    $linha = LembreteEnviado::query()->sole();
    expect($injetou)->toBeTrue()
        ->and($linha->mensagem_id)->toBeNull()
        ->and($linha->status)->toBe(LembreteEnviado::ENVIADO)
        ->and($linha->confirmado_por)->toBe($admin->id);
});
