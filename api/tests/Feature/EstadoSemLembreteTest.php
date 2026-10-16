<?php

use App\Models\Agendamento;
use App\Models\Conversa;
use App\Models\LembreteEnviado;
use App\Models\Paciente;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\DisparoDeLembretes;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

/*
 * O card da sessão que ficou SEM lembrete (change telefone-que-chega-no-whatsapp, D4).
 *
 * Em 02/10 uma criança ficou sem lembrete porque o telefone tinha um dígito a mais, e o card dela não
 * mostrava nada — nem a faixa a contava. A recepção não tinha como saber. Falha aparece POR PADRÃO;
 * só o que é decisão (opt-out da família, dispensa pela confirmação) fica sem estado.
 *
 * Dados 100% FICTÍCIOS.
 */

beforeEach(function () {
    Queue::fake();
});

afterEach(function () {
    $this->travelBack();
});

/** Uma sessão de amanhã, marcada, de uma criança com o telefone dado. */
function sessaoDoCardSemLembrete(string $telefone = '(11) 98765-4321', string $hora = '14:00'): Agendamento
{
    $base = baseDeAgenda();
    Paciente::query()->whereKey($base['paciente_id'])->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => $telefone]]]);
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'inicio' => agoraNaClinica()->addDay()->format('Y-m-d').' '.$hora.':00',
    ]);
    $agendamento->forceFill(['lembrete_whatsapp' => true, 'status_id' => StatusAgendamento::inicialId()])->save();

    return $agendamento;
}

/** A marca de NÃO enviado desta sessão, como o disparo a grava. */
function naoEnviadoDaSessao(Agendamento $agendamento, string $motivo): LembreteEnviado
{
    return LembreteEnviado::create([
        'agendamento_id' => $agendamento->id,
        ...LembreteEnviado::doQueFoiLembrado($agendamento),
        'tipo' => LembreteEnviado::TIPO_AGENDAMENTO,
        'competencia' => $agendamento->inicio->format('Y-m-d'),
        'status' => LembreteEnviado::NAO_ENVIADO,
        'motivo' => $motivo,
    ]);
}

/** @return list<array<string, mixed>> os cards de amanhã, como a grade os recebe */
function cardsDoDiaSeguinte($teste): array
{
    $amanha = agoraNaClinica()->addDay()->format('Y-m-d');
    $usuario = Usuario::query()->whereHas('roles', fn ($r) => $r->where('name', 'Administrador'))->firstOrFail();

    return $teste->actingAs($usuario)->getJson("/api/agenda?de={$amanha}&ate={$amanha}")->assertOk()->json();
}

it('deve mostrar no card a sessão que ficou sem lembrete por telefone inválido', function () {
    // ARRANGE — o caminho de produção inteiro: o disparo real recusa o número
    admin();
    canalConectado();
    templateAprovado();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);
    sessaoDoCardSemLembrete('55 49912-3456');
    app(DisparoDeLembretes::class)->executar();

    // ACT
    $cards = cardsDoDiaSeguinte($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBe([
        'estado' => 'nao_enviado',
        'em' => null,
        'motivo' => 'telefone inválido no cadastro',
        'confirmavel' => true,
    ]);
});

it('NÃO deve mostrar estado quando a família pediu para não receber lembretes', function () {
    // ARRANGE — opt-out é decisão da família, não falha da clínica
    admin();
    canalConectado();
    templateAprovado();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);
    sessaoDoCardSemLembrete();
    $conversa = new Conversa;
    $conversa->telefone_e164 = '+5511987654321';
    $conversa->sem_lembretes = true;
    $conversa->save();
    app(DisparoDeLembretes::class)->executar();
    expect(LembreteEnviado::query()->sole()->status)->toBe(LembreteEnviado::NAO_ENVIADO);

    // ACT
    $cards = cardsDoDiaSeguinte($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBeNull();
});

it('NÃO deve mostrar estado quando a confirmação do mesmo dia dispensou o lembrete', function () {
    // ARRANGE
    admin();
    naoEnviadoDaSessao(sessaoDoCardSemLembrete(), LembreteEnviado::MOTIVO_JA_CONFIRMADO);

    // ACT
    $cards = cardsDoDiaSeguinte($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBeNull();
});

it('deve mostrar uma falha que ainda não tem nome — a falha aparece por padrão', function () {
    // ARRANGE — um motivo novo (o teto, um modelo recusado, o que vier) não pode nascer invisível
    admin();
    naoEnviadoDaSessao(sessaoDoCardSemLembrete(), 'qualquer falha nova');

    // ACT
    $cards = cardsDoDiaSeguinte($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBe(['estado' => 'nao_enviado', 'em' => null, 'motivo' => 'qualquer falha nova', 'confirmavel' => true]);
});

it('NÃO deve herdar o alerta do horário antigo quando a sessão é remarcada', function () {
    // ARRANGE — o não enviado falava das 14:00; a sessão foi para as 16:00 do mesmo dia
    admin();
    $sessao = sessaoDoCardSemLembrete();
    naoEnviadoDaSessao($sessao, 'telefone inválido no cadastro');
    DB::table('agendamentos')->where('id', $sessao->id)->update([
        'inicio' => agoraNaClinica()->addDay()->format('Y-m-d').' 16:00:00',
        'fim' => agoraNaClinica()->addDay()->format('Y-m-d').' 16:40:00',
    ]);

    // ACT
    $cards = cardsDoDiaSeguinte($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBeNull();
});

it('NÃO deve mostrar o alerta na sessão que deixou de estar marcada', function () {
    // ARRANGE
    admin();
    $sessao = sessaoDoCardSemLembrete();
    naoEnviadoDaSessao($sessao, 'telefone inválido no cadastro');
    $desmarcado = StatusAgendamento::query()->where('ocupa_horario', false)->firstOrFail();
    DB::table('agendamentos')->where('id', $sessao->id)->update(['status_id' => $desmarcado->id]);

    // ACT
    $cards = cardsDoDiaSeguinte($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBeNull();
});

it('deve passar de sem lembrete para aguardando quando o lembrete sai na volta seguinte', function () {
    // ARRANGE — cadastro corrigido; o disparo vira a mesma linha para enviado
    admin();
    canalConectado();
    templateAprovado();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);
    $sessao = sessaoDoCardSemLembrete('55 49912-3456');
    app(DisparoDeLembretes::class)->executar();
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 93333-4444']]]);

    // ACT
    app(DisparoDeLembretes::class)->executar();
    $cards = cardsDoDiaSeguinte($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBe(['estado' => 'aguardando', 'em' => null, 'confirmavel' => true]);
});

it('deve carregar o estado sem lembrete de todos os cards sem uma consulta por card', function () {
    // ARRANGE — 1 sessão sem lembrete e depois 6: o número de consultas da grade não cresce
    admin();
    naoEnviadoDaSessao(sessaoDoCardSemLembrete(hora: '08:00'), 'telefone inválido no cadastro');
    cardsDoDiaSeguinte($this);
    DB::enableQueryLog();
    cardsDoDiaSeguinte($this);
    $comUma = count(DB::getQueryLog());
    foreach (['09:00', '10:00', '11:00', '13:00', '15:00'] as $hora) {
        naoEnviadoDaSessao(sessaoDoCardSemLembrete(hora: $hora), 'sem telefone no cadastro');
    }
    DB::flushQueryLog();

    // ACT
    $cards = cardsDoDiaSeguinte($this);

    // ASSERT
    expect(count(DB::getQueryLog()))->toBe($comUma)
        ->and(collect($cards)->pluck('confirmacao.estado')->unique()->values()->all())->toBe(['nao_enviado']);
});

it('deve devolver o alerta à sessão remarcada no mesmo dia, na volta seguinte', function (array $mudanca) {
    // ARRANGE — gate r1, CR-TEL-01: o não enviado guardava a criança e o horário de quando foi
    // registrado; remarcada para as 16:00 (ou com a criança trocada), a sessão ficava sem alerta para
    // sempre, porque a volta seguinte só trocava o motivo
    admin();
    canalConectado();
    templateAprovado();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);
    $sessao = sessaoDoCardSemLembrete('55 49912-3456');
    $this->travelTo(agoraNaClinica()->setTime(8, 0));
    app(DisparoDeLembretes::class)->executar();
    $amanha = agoraNaClinica()->addDay()->format('Y-m-d');
    if (isset($mudanca['inicio'])) {
        DB::table('agendamentos')->where('id', $sessao->id)->update([
            'inicio' => $amanha.' '.$mudanca['inicio'], 'fim' => $amanha.' 16:40:00',
        ]);
    } else {
        $outra = Paciente::factory()->create(['contatos_json' => [['tipo' => 'celular', 'valor' => '(49) 49912-3456']]]);
        DB::table('agendamentos')->where('id', $sessao->id)->update(['paciente_id' => $outra->id]);
    }

    // ACT — a volta seguinte
    $this->travelTo(agoraNaClinica()->setTime(9, 0));
    app(DisparoDeLembretes::class)->executar(repescagem: true);
    $cards = cardsDoDiaSeguinte($this);

    // ASSERT
    expect($cards[0]['confirmacao'])->toBe(['estado' => 'nao_enviado', 'em' => null, 'motivo' => 'telefone inválido no cadastro', 'confirmavel' => true]);
})->with([
    'remarcada para as 16:00' => [['inicio' => '16:00:00']],
    'com a criança trocada' => [['paciente' => true]],
]);

it('NÃO deve reescrever a linha de um lembrete que já saiu', function () {
    // ARRANGE — gate r1, CR-TEL-08: só se chega aqui por corrida (outra volta enviou entre a escolha
    // das sessões e o registro do não enviado), então o caminho é chamado direto
    admin();
    $sessao = sessaoDoCardSemLembrete();
    $enviada = LembreteEnviado::create([
        'agendamento_id' => $sessao->id,
        ...LembreteEnviado::doQueFoiLembrado($sessao),
        'tipo' => LembreteEnviado::TIPO_AGENDAMENTO,
        'competencia' => $sessao->inicio->format('Y-m-d'),
        'status' => LembreteEnviado::ENVIADO,
    ]);
    $disparo = app(DisparoDeLembretes::class);

    // ACT
    $registrou = (fn (): bool => $this->registrarNaoEnviado($sessao, 'sem telefone no cadastro'))->call($disparo);

    // ASSERT
    expect($registrou)->toBeFalse()
        ->and($enviada->fresh()->status)->toBe(LembreteEnviado::ENVIADO)
        ->and($enviada->fresh()->motivo)->toBeNull();
});
