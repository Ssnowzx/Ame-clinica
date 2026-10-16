<?php

use App\Models\Agendamento;
use App\Models\Conversa;
use App\Models\LembreteEnviado;
use App\Models\Mensagem;
use App\Models\MensagemTemplate;
use App\Models\Paciente;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\DisparoDeLembretes;
use App\Support\Mensageria\EnvioDeMensagens;
use App\Support\Mensageria\ReaberturaDoLembrete;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;

/*
 * O telefone trocado depois do envio recebe o lembrete de novo (change
 * telefone-que-chega-no-whatsapp, D5).
 *
 * Em 01/10 o lembrete de uma criança saiu às 08:00 para o celular de OUTRA paciente; a recepção corrigiu
 * o número às 10:30, e o lembrete nunca saiu para a família certa — a marca ENVIADO não volta. Agora
 * ela volta a pendente quando o número que recebeu SAIU do cadastro, e a repescagem faz o resto.
 *
 * O relógio é congelado numa quarta (sem a regra de segunda-na-sexta), no fuso da clínica.
 * Dados e telefones 100% FICTÍCIOS.
 */

const QUARTA_DA_REABERTURA = '2026-10-14';

const CELULAR_ERRADO = '(11) 98765-4321';

const CELULAR_CERTO = '(11) 93333-4444';

beforeEach(function () {
    Queue::fake();
});

afterEach(function () {
    $this->travelBack();
});

function horaDaReabertura(string $hora, string $dia = QUARTA_DA_REABERTURA): Carbon
{
    return Carbon::parse("{$dia} {$hora}", 'America/Sao_Paulo');
}

function disparoDaReabertura(): DisparoDeLembretes
{
    admin();
    canalConectado();
    templateAprovado();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);

    return app(DisparoDeLembretes::class);
}

/** Sessão marcada (`Y-m-d H:i`, hora de parede) de uma criança com os celulares dados. */
function sessaoDaReabertura(string $inicio, string ...$celulares): Agendamento
{
    $base = baseDeAgenda();
    trocarCelulares($base['paciente_id'], ...($celulares === [] ? [CELULAR_ERRADO] : $celulares));
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'inicio' => $inicio.':00',
    ]);
    $agendamento->forceFill(['lembrete_whatsapp' => true, 'status_id' => StatusAgendamento::inicialId()])->save();

    return $agendamento;
}

/** Grava os celulares do paciente pelo MODEL — o caminho que dispara o observer, como a tela. */
function trocarCelulares(int $pacienteId, string ...$celulares): void
{
    $paciente = Paciente::query()->findOrFail($pacienteId);
    $paciente->contatos_json = array_map(fn (string $valor): array => ['tipo' => 'celular', 'valor' => $valor], $celulares);
    $paciente->save();
}

function marcaDaSessao(Agendamento $agendamento): LembreteEnviado
{
    return LembreteEnviado::query()->where('agendamento_id', $agendamento->id)->sole();
}

/** @return list<string> os telefones das conversas que receberam lembrete */
function telefonesQueReceberam(): array
{
    return Mensagem::query()->where('template_nome', 'lembrete_agendamento')->orderBy('id')
        ->get()->map(fn (Mensagem $mensagem): string => (string) Conversa::query()->findOrFail($mensagem->conversa_id)->telefone_e164)
        ->all();
}

it('deve mandar o lembrete ao número corrigido na repescagem seguinte', function () {
    // ARRANGE — saiu às 08:00 para o número errado; a recepção corrigiu às 10:30
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);

    // ACT
    $this->travelTo(horaDaReabertura('11:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1)
        ->and(telefonesQueReceberam())->toBe(['+5511987654321', '+5511933334444'])
        ->and(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::ENVIADO)
        ->and(marcaDaSessao($sessao)->motivo)->toBeNull();
});

it('deve deixar o lembrete pendente, com o motivo, entre a correção e a repescagem', function () {
    // ARRANGE
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();

    // ACT
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);

    // ASSERT — é o que o card mostra como "sem lembrete" até a volta seguinte
    expect(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::NAO_ENVIADO)
        ->and(marcaDaSessao($sessao)->motivo)->toBe(ReaberturaDoLembrete::MOTIVO);
});

it('NÃO deve reenviar quando só se acrescenta um telefone, mantendo o que recebeu', function () {
    // ARRANGE — a alternativa recusada no design: reabrir todo lembrete futuro a cada troca
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, CELULAR_ERRADO, CELULAR_CERTO);

    // ACT
    $this->travelTo(horaDaReabertura('11:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(0)
        ->and(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::ENVIADO);
});

it('NÃO deve reabrir quando a família já respondeu', function () {
    // ARRANGE — "Confirmo" vale; perguntar de novo seria pedir a mesma coisa duas vezes
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();
    marcaDaSessao($sessao)->forceFill(['resposta' => LembreteEnviado::CONFIRMOU, 'respondido_em' => now()])->save();

    // ACT
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);

    // ASSERT
    expect(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::ENVIADO)
        ->and(marcaDaSessao($sessao)->resposta)->toBe(LembreteEnviado::CONFIRMOU);
});

it('deve mandar ao número novo o lembrete que não foi entregue no antigo', function () {
    // ARRANGE — "falha de entrega não é retentada" protege o MESMO número; aqui o número é outro
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();
    Mensagem::query()->where('template_nome', 'lembrete_agendamento')->update(['status' => 'falhou']);
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);

    // ACT
    $this->travelTo(horaDaReabertura('11:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1)
        ->and(telefonesQueReceberam())->toBe(['+5511987654321', '+5511933334444']);
});

it('deve reabrir a sessão de hoje sem que a repescagem a envie', function () {
    // ARRANGE — o lembrete de hoje saiu ontem; corrigido hoje às 09:00, a sessão é às 15:00
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-14 15:00');
    $this->travelTo(horaDaReabertura('08:00', '2026-10-13'));
    $disparo->executar();
    $this->travelTo(horaDaReabertura('09:00'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);

    // ACT
    $this->travelTo(horaDaReabertura('10:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT — o modelo diz "amanhã"; a recepção vê "sem lembrete" no card e liga
    expect($resultado['enviados'])->toBe(0)
        ->and(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::NAO_ENVIADO);
});

it('NÃO deve reabrir a sessão que já passou', function () {
    // ARRANGE — a sessão de hoje às 08:30 já começou quando o telefone é corrigido
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-14 08:30');
    $this->travelTo(horaDaReabertura('08:00', '2026-10-13'));
    $disparo->executar();

    // ACT
    $this->travelTo(horaDaReabertura('09:00'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);

    // ASSERT
    expect(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::ENVIADO);
});

it('NÃO deve reabrir a marca do horário antigo de uma sessão remarcada', function () {
    // ARRANGE — o lembrete falou das 15:00; a sessão foi para as 16:00 (a remarcação tem aviso próprio)
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();
    DB::table('agendamentos')->where('id', $sessao->id)->update(['inicio' => '2026-10-15 16:00:00', 'fim' => '2026-10-15 16:40:00']);

    // ACT
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);

    // ASSERT
    expect(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::ENVIADO);
});

it('NÃO deve mexer na marca sem mensagem, de quem não se sabe o número', function () {
    // ARRANGE — o envio caiu antes de gravar a mensagem: não há como dizer que o número mudou
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();
    marcaDaSessao($sessao)->forceFill(['mensagem_id' => null])->save();

    // ACT
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);

    // ASSERT
    expect(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::ENVIADO);
});

it('NÃO deve tratar como troca o mesmo celular escrito sem o nono dígito', function () {
    // ARRANGE — `98765-4321` e `8765-4321` são o mesmo aparelho
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();

    // ACT
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, '(11) 8765-4321');

    // ASSERT
    expect(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::ENVIADO);
});

it('NÃO deve reabrir nada quando o cadastro muda sem tocar nos contatos', function () {
    // ARRANGE
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();

    // ACT — trocar o nome não é trocar o telefone
    $this->travelTo(horaDaReabertura('10:30'));
    $paciente = Paciente::query()->findOrFail($sessao->paciente_id);
    $paciente->nome = 'Nome Fictício Corrigido';
    $paciente->save();

    // ASSERT
    expect(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::ENVIADO);
});

it('deve reabrir pelo salvar da tela, o caminho que a recepção usa', function () {
    // ARRANGE — o PUT do paciente é a porta real; o observer tem de rodar por ela
    $disparo = disparoDaReabertura();
    $usuario = Usuario::query()->whereHas('roles', fn ($r) => $r->where('name', 'Administrador'))->firstOrFail();
    $criado = $this->actingAs($usuario)->postJson('/api/pacientes', [
        ...pacienteMenorValido(),
        'contatos_json' => [['tipo' => 'celular', 'valor' => CELULAR_ERRADO]],
    ])->assertCreated()->json();
    $base = baseDeAgenda();
    $sessao = Agendamento::factory()->create([
        'paciente_id' => $criado['id'], 'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'], 'inicio' => '2026-10-15 15:00:00',
    ]);
    $sessao->forceFill(['lembrete_whatsapp' => true, 'status_id' => StatusAgendamento::inicialId()])->save();
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();

    // ACT
    $this->travelTo(horaDaReabertura('10:30'));
    $this->actingAs($usuario)
        ->withHeader('If-Match', Paciente::findOrFail($criado['id'])->updated_at->toISOString())
        ->putJson("/api/pacientes/{$criado['id']}", [
            ...pacienteMenorValido(),
            'contatos_json' => [['tipo' => 'celular', 'valor' => CELULAR_CERTO]],
        ])->assertSuccessful();

    // ASSERT
    expect(marcaDaSessao($sessao)->status)->toBe(LembreteEnviado::NAO_ENVIADO);
});

// ---------------------------------------------------------------- gate r1 (SEC-TEL-02, CR-TEL-04)

/** O lembrete com os dois botões, como em produção, e o envio na hora (fila síncrona). */
function lembreteComBotoesDaReabertura(): void
{
    MensagemTemplate::create([
        'nome' => 'lembrete_com_resposta', 'idioma' => 'pt_BR', 'categoria' => 'UTILITY',
        'corpo_previa' => 'Olá {{1}}, amanhã tem atendimento {{2}}. Podemos confirmar?',
        'variaveis_json' => ['1', '2'], 'status_meta' => 'APPROVED',
        'botoes_json' => [['tipo' => 'QUICK_REPLY', 'texto' => '✅ Confirmo'], ['tipo' => 'QUICK_REPLY', 'texto' => '❌ Preciso desmarcar']],
    ]);
    app(ConfiguracaoService::class)->set('lembretes.template', 'lembrete_com_resposta');
    config(['queue.default' => 'sync']);
}

/** O webhook assinado com o toque de quem tem o número `de` na mensagem `wamid`. */
function toqueNaReabertura(string $wamid, string $de, string $payload = 'botao:1', string $texto = '❌ Preciso desmarcar'): TestResponse
{
    $corpo = json_encode(['entry' => [['changes' => [[
        'field' => 'messages',
        'value' => [
            'metadata' => ['phone_number_id' => PHONE_ID_FICTICIO],
            'contacts' => [['wa_id' => $de, 'profile' => ['name' => 'Perfil Fictício']]],
            'messages' => [[
                'from' => $de, 'id' => 'wamid.TOQUE_REABERTURA', 'timestamp' => (string) now()->timestamp,
                'type' => 'button', 'button' => ['payload' => $payload, 'text' => $texto],
                'context' => ['from' => '5511333344444', 'id' => $wamid],
            ]],
        ],
    ]]]]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    return test()->call('POST', '/api/webhooks/whatsapp', [], [], [], [
        'CONTENT_TYPE' => 'application/json',
        'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.hash_hmac('sha256', $corpo, SEGREDO_FICTICIO),
    ], $corpo);
}

it('NÃO deve deixar o número antigo responder pela sessão quando o reenvio cai no meio', function () {
    // ARRANGE — SEC-TEL-02: a linha reaberta apontava para a mensagem do número ANTIGO; se o envio
    // da repescagem caísse depois de `marcar()`, ela ficava ENVIADA apontando para ela, e o toque
    // da outra família virava a resposta desta sessão. A fila é a REAL aqui: com o `Queue::fake()`
    // do arquivo, o envio das 08:00 não sai, a mensagem fica sem id do WhatsApp e o toque não se liga
    // a nada — o teste passaria sem provar o furo
    app()->forgetInstance('queue');
    Queue::clearResolvedInstance('queue');
    $disparo = disparoDaReabertura();
    lembreteComBotoesDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();
    $antiga = Mensagem::query()->findOrFail(marcaDaSessao($sessao)->mensagem_id);
    expect($antiga->wa_message_id)->not->toBeNull();
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);
    $this->travelTo(horaDaReabertura('11:00'));
    app()->instance(EnvioDeMensagens::class, new class(app(ConfiguracaoService::class)) extends EnvioDeMensagens
    {
        public function enviarTemplate(Conversa $conversa, string $nome, array $variaveis, ?int $autorId, bool $automatica = false): Mensagem
        {
            throw new RuntimeException('falha simulada de banco ou de fila');
        }
    });
    try {
        app(DisparoDeLembretes::class)->executar(repescagem: true);
    } catch (RuntimeException) {
        // o envio caiu no meio — é o cenário
    }
    app()->forgetInstance(EnvioDeMensagens::class);

    // ACT — quem tem o número antigo toca "Preciso desmarcar" na mensagem das 08:00
    $this->travelTo(horaDaReabertura('11:05'));
    toqueNaReabertura((string) $antiga->wa_message_id, '5511987654321')->assertOk();

    // ASSERT
    expect(marcaDaSessao($sessao)->resposta)->toBeNull()
        ->and(marcaDaSessao($sessao)->mensagem_id)->not->toBe($antiga->id);
});

it('deve preservar a resposta que chega entre a leitura e a reabertura', function (array $noMeio, array $esperado) {
    // ARRANGE — CR-TEL-04: o UPDATE condicional é a guarda contra o toque que chega no meio. A
    // linha é alterada no banco DEPOIS que a reabertura a leu e ANTES de ela escrever
    $disparo = disparoDaReabertura();
    $sessao = sessaoDaReabertura('2026-10-15 15:00');
    $this->travelTo(horaDaReabertura('08:00'));
    $disparo->executar();
    $marca = marcaDaSessao($sessao);
    $jaMexeu = false;
    LembreteEnviado::retrieved(function (LembreteEnviado $lida) use ($marca, $noMeio, &$jaMexeu): void {
        if (! $jaMexeu && $lida->is($marca)) {
            $jaMexeu = true;
            DB::table('lembretes_enviados')->where('id', $marca->id)->update($noMeio);
        }
    });

    // ACT
    $this->travelTo(horaDaReabertura('10:30'));
    trocarCelulares($sessao->paciente_id, CELULAR_CERTO);

    // ASSERT — o que mudou no meio vence; a reabertura não passa por cima. Na resposta, o dano seria
    // a linha voltar a pendente COM a resposta — e a repescagem perguntar de novo a quem confirmou
    expect($jaMexeu)->toBeTrue()
        ->and(marcaDaSessao($sessao)->only(array_keys($esperado)))->toBe($esperado);
})->with([
    'a família tocou em "Confirmo"' => [
        ['resposta' => LembreteEnviado::CONFIRMOU],
        ['status' => LembreteEnviado::ENVIADO, 'resposta' => LembreteEnviado::CONFIRMOU, 'motivo' => null],
    ],
    'outra volta já a devolveu a pendente' => [
        ['status' => LembreteEnviado::NAO_ENVIADO, 'motivo' => 'motivo de outra volta'],
        ['status' => LembreteEnviado::NAO_ENVIADO, 'motivo' => 'motivo de outra volta'],
    ],
]);
