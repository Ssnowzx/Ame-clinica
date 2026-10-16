<?php

use App\Models\Agendamento;
use App\Models\AvisoAFamilia;
use App\Models\LembreteEnviado;
use App\Models\Mensagem;
use App\Models\MensagemTemplate;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\AvisoDoAgendamento;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\DisparoDeLembretes;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

/*
 * A repescagem do lembrete (change repescagem-do-lembrete): a sessão marcada depois das 08:00 para
 * o dia que o disparo já cobriu ficava sem lembrete. O mesmo disparo volta de hora em hora.
 *
 * O relógio é CONGELADO numa quarta-feira (sem a regra de segunda-na-sexta no meio), no fuso da
 * clínica. Dados 100% FICTÍCIOS.
 */

/** Quarta-feira fictícia; amanhã é quinta. */
const QUARTA_DA_REPESCAGEM = '2026-10-07';

function naClinica(string $hora, string $dia = QUARTA_DA_REPESCAGEM): Carbon
{
    return Carbon::parse("{$dia} {$hora}", 'America/Sao_Paulo');
}

function prepararRepescagem(): DisparoDeLembretes
{
    admin();
    canalConectado();
    templateAprovado();

    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);

    return app(DisparoDeLembretes::class);
}

/** Sessão marcada para lembrete (`Y-m-d H:i`, hora de parede), de uma criança nova com o telefone dado. */
function sessaoParaLembrete(string $inicio, string $telefone = '(11) 98765-4321'): Agendamento
{
    $base = baseDeAgenda();
    Paciente::query()->whereKey($base['paciente_id'])->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => $telefone]]]);

    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'inicio' => $inicio.':00',
    ]);
    $agendamento->forceFill(['lembrete_whatsapp' => true, 'status_id' => StatusAgendamento::inicialId()])->save();

    return $agendamento;
}

function sessaoDeAmanha(string $hora = '14:00', string $telefone = '(11) 98765-4321'): Agendamento
{
    return sessaoParaLembrete('2026-10-08 '.$hora, $telefone);
}

/** A marca da confirmação que a família recebeu — do horário atual da sessão —, com a mensagem no status dado. */
function confirmacaoRecebida(Agendamento $agendamento, string $statusDaMensagem = 'entregue'): AvisoAFamilia
{
    $marca = AvisoAFamilia::create([
        'tipo' => AvisoAFamilia::TIPO_CONFIRMACAO,
        'chave' => "paciente:{$agendamento->paciente_id}",
        'paciente_id' => $agendamento->paciente_id,
        'agendamento_id' => $agendamento->id,
        'inicio_confirmado' => $agendamento->inicio,
    ]);
    $mensagem = new Mensagem(['corpo' => 'Confirmação fictícia', 'tipo' => 'texto']);
    $mensagem->forceFill([
        'conversa_id' => conversaAberta()->id,
        'direcao' => Mensagem::DIRECAO_ENVIADA,
        'template_nome' => 'confirmacao_agendamento',
        'status' => $statusDaMensagem,
    ])->save();
    $marca->forceFill(['mensagem_id' => $mensagem->id])->save();

    return $marca;
}

function lembretesEnviados(): int
{
    return Mensagem::query()->where('template_nome', 'lembrete_agendamento')->count();
}

beforeEach(function () {
    Queue::fake();
});

afterEach(function () {
    $this->travelBack();
});

// ---------------------------------------------------------------- configuração

it('deve nascer com a repescagem ligada até as 20h', function () {
    // ARRANGE
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/configuracoes');

    // ASSERT
    $valores = collect($resposta->json('configuracoes'))->pluck('valor', 'chave');
    expect($valores['lembretes.repescagem'])->toBeTrue()
        ->and($valores['lembretes.repescagem_ate'])->toBe(20);
});

it('deve recusar a última hora da repescagem fora de 9 a 22', function (int $hora) {
    // ARRANGE
    $admin = admin();

    // ACT
    $resposta = $this->actingAs($admin)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'lembretes.repescagem_ate',
        'valor' => $hora,
    ]);

    // ASSERT
    $resposta->assertStatus(422);
    expect(app(ConfiguracaoService::class)->get('lembretes.repescagem_ate'))->toBe(20);
})->with([23, 8]);

// ---------------------------------------------------------------- a volta de hora em hora

it('deve lembrar na repescagem a sessão de amanhã marcada à tarde', function () {
    // ARRANGE — a criança já é paciente: não há confirmação, e sem a repescagem ficava sem nada
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('08:00'));
    $disparo->executar();
    $this->travelTo(naClinica('15:10'));
    $sessao = sessaoDeAmanha();

    // ACT
    $this->travelTo(naClinica('16:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1)
        ->and(lembretesEnviados())->toBe(1);
    $marca = LembreteEnviado::query()->where('agendamento_id', $sessao->id)->firstOrFail();
    expect($marca->status)->toBe(LembreteEnviado::ENVIADO)
        ->and($marca->competencia->format('Y-m-d'))->toBe('2026-10-08');
});

it('NÃO deve lembrar de novo quem já recebeu às 08:00', function () {
    // ARRANGE
    $disparo = prepararRepescagem();
    sessaoDeAmanha();
    $this->travelTo(naClinica('08:00'));
    $disparo->executar();

    // ACT
    $this->travelTo(naClinica('16:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(0)
        ->and(lembretesEnviados())->toBe(1);
});

it('deve mandar só o horário do irmão marcado depois, numa mensagem própria', function () {
    // ARRANGE — o lote junta o que ainda não foi lembrado; o filho das 08:00 não volta
    $disparo = prepararRepescagem();
    sessaoDeAmanha('10:00', '(11) 91111-2222');
    $this->travelTo(naClinica('08:00'));
    $disparo->executar();
    $this->travelTo(naClinica('14:30'));
    sessaoDeAmanha('15:00', '(11) 91111-2222');

    // ACT
    $this->travelTo(naClinica('15:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1)
        ->and(lembretesEnviados())->toBe(2);
    $segunda = Mensagem::query()->where('template_nome', 'lembrete_agendamento')->latest('id')->firstOrFail();
    expect($segunda->variaveis_json['2'])->toBe('15:00');
});

it('deve lembrar na repescagem quem ficou sem telefone de manhã e foi corrigido', function () {
    // ARRANGE
    $disparo = prepararRepescagem();
    $sessao = sessaoDeAmanha();
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()->update(['contatos_json' => []]);
    $this->travelTo(naClinica('08:00'));
    $disparo->executar();
    expect(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('status'))
        ->toBe(LembreteEnviado::NAO_ENVIADO);
    $this->travelTo(naClinica('11:20'));
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 93333-4444']]]);

    // ACT
    $this->travelTo(naClinica('12:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1)
        ->and(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('status'))
        ->toBe(LembreteEnviado::ENVIADO);
});

it('NÃO deve repescar depois da última hora configurada', function () {
    // ARRANGE — marcada às 20:30; a volta seguinte é às 21:00, fora da janela
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('20:30'));
    sessaoDeAmanha();

    // ACT
    $this->travelTo(naClinica('21:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(0)
        ->and(lembretesEnviados())->toBe(0);
});

it('deve repescar na própria última hora configurada', function () {
    // ARRANGE
    $disparo = prepararRepescagem();
    app(ConfiguracaoService::class)->set('lembretes.repescagem_ate', 18);
    sessaoDeAmanha();

    // ACT
    $this->travelTo(naClinica('18:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1);
});

it('NÃO deve repescar antes das 09:00', function () {
    // ARRANGE — a volta das 08:00 é o disparo principal, não a repescagem
    $disparo = prepararRepescagem();
    sessaoDeAmanha();

    // ACT
    $this->travelTo(naClinica('08:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(0);
});

it('NÃO deve repescar com a repescagem desligada', function () {
    // ARRANGE
    $disparo = prepararRepescagem();
    app(ConfiguracaoService::class)->set('lembretes.repescagem', false);
    sessaoDeAmanha();

    // ACT
    $this->travelTo(naClinica('16:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(0)
        ->and(lembretesEnviados())->toBe(0);
});

it('deve repescar os dias do disparo das 08:00, e não os da hora corrente', function () {
    // ARRANGE — antecedência de 36 h: às 08:00 o alvo é quinta (20:00); às 17:00, somar daria sexta
    $disparo = prepararRepescagem();
    app(ConfiguracaoService::class)->set('lembretes.antecedencia_horas', 36);
    $quinta = sessaoDeAmanha('14:00', '(11) 95555-6666');
    $sexta = sessaoParaLembrete('2026-10-09 14:00', '(11) 97777-8888');

    // ACT
    $this->travelTo(naClinica('17:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1)
        ->and(LembreteEnviado::query()->where('agendamento_id', $quinta->id)->exists())->toBeTrue()
        ->and(LembreteEnviado::query()->where('agendamento_id', $sexta->id)->exists())->toBeFalse();
});

// ---------------------------------------------------------------- sessão que já começou

it('NÃO deve lembrar a sessão que já começou', function () {
    // ARRANGE — antecedência de 1 h faz o alvo do disparo ser HOJE; rodado à mão às 15:00, a sessão
    // das 10:00 já passou
    $disparo = prepararRepescagem();
    app(ConfiguracaoService::class)->set('lembretes.antecedencia_horas', 1);
    $passada = sessaoParaLembrete('2026-10-07 10:00', '(11) 95555-6666');
    $futura = sessaoParaLembrete('2026-10-07 17:00', '(11) 97777-8888');

    // ACT
    $this->travelTo(naClinica('15:00'));
    $disparo->executar();

    // ASSERT
    expect(LembreteEnviado::query()->where('agendamento_id', $passada->id)->exists())->toBeFalse()
        ->and(LembreteEnviado::query()->where('agendamento_id', $futura->id)->value('status'))
        ->toBe(LembreteEnviado::ENVIADO);
});

it('NÃO deve repescar sessão de hoje, mesmo com antecedência curta', function () {
    // ARRANGE — o modelo diz "amanhã"; com antecedência de 1 h o dia das 08:00 é o próprio dia
    $disparo = prepararRepescagem();
    app(ConfiguracaoService::class)->set('lembretes.antecedencia_horas', 1);
    $this->travelTo(naClinica('14:00'));
    $deHoje = sessaoParaLembrete('2026-10-07 17:00');

    // ACT
    $this->travelTo(naClinica('15:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(0)
        ->and(LembreteEnviado::query()->where('agendamento_id', $deHoje->id)->exists())->toBeFalse();
});

it('NÃO deve mandar duas vezes quando outra execução retenta a mesma marca ao mesmo tempo', function () {
    // ARRANGE — sem telefone às 08:00 (não enviado, retentável); telefone corrigido; às 12:00, entre
    // esta execução ler a marca e gravá-la, outra execução a vira para enviado
    $disparo = prepararRepescagem();
    $sessao = sessaoDeAmanha();
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()->update(['contatos_json' => []]);
    $this->travelTo(naClinica('08:00'));
    $disparo->executar();
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 93333-4444']]]);
    $marcaId = (int) LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('id');
    LembreteEnviado::retrieved(function (LembreteEnviado $lida) use ($marcaId): void {
        if ((int) $lida->id === $marcaId) {
            DB::table('lembretes_enviados')->where('id', $marcaId)->update(['status' => LembreteEnviado::ENVIADO]);
        }
    });

    // ACT
    $this->travelTo(naClinica('12:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT — quem perdeu a corrida não envia
    expect($resultado['enviados'])->toBe(0)
        ->and(lembretesEnviados())->toBe(0);
});

it('deve contar o mesmo não enviado só na volta que o registrou', function () {
    // ARRANGE
    $disparo = prepararRepescagem();
    $sessao = sessaoDeAmanha();
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()->update(['contatos_json' => []]);
    $this->travelTo(naClinica('08:00'));
    $manha = $disparo->executar();

    // ACT
    $this->travelTo(naClinica('09:00'));
    $volta = $disparo->executar(repescagem: true);

    // ASSERT
    expect($manha['nao_enviados'])->toBe(1)
        ->and($volta['nao_enviados'])->toBe(0);
});

it('deve trocar o motivo do não enviado quando o cadastro muda, sem contar de novo', function () {
    // ARRANGE — change telefone-que-chega-no-whatsapp: de manhã o cadastro estava vazio; às 08:40
    // alguém digitou o número errado. "Sem telefone" mandaria a recepção procurar um campo vazio
    $disparo = prepararRepescagem();
    $sessao = sessaoDeAmanha();
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()->update(['contatos_json' => []]);
    $this->travelTo(naClinica('08:00'));
    $disparo->executar();
    $this->travelTo(naClinica('08:40'));
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '55 49912-3456']]]);

    // ACT
    $this->travelTo(naClinica('09:00'));
    $volta = $disparo->executar(repescagem: true);

    // ASSERT
    $marca = LembreteEnviado::query()->where('agendamento_id', $sessao->id)->firstOrFail();
    expect($marca->status)->toBe(LembreteEnviado::NAO_ENVIADO)
        ->and($marca->motivo)->toBe('telefone inválido no cadastro')
        ->and($volta['nao_enviados'])->toBe(0);
});

it('deve dizer sem telefone quando o número que recebeu é apagado do cadastro', function () {
    // ARRANGE — o lembrete saiu às 08:00; às 09:30 a recepção apaga o número (era de outra família).
    // A reabertura devolve o lembrete a pendente, e a volta seguinte diz o que falta: o cadastro
    // ficou sem telefone (change telefone-que-chega-no-whatsapp)
    $disparo = prepararRepescagem();
    $sessao = sessaoDeAmanha();
    $this->travelTo(naClinica('08:00'));
    $disparo->executar();
    $this->travelTo(naClinica('09:30'));
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()->update(['contatos_json' => []]);

    // ACT
    $this->travelTo(naClinica('10:00'));
    $volta = $disparo->executar(repescagem: true);

    // ASSERT
    $marca = LembreteEnviado::query()->where('agendamento_id', $sessao->id)->firstOrFail();
    expect($marca->status)->toBe(LembreteEnviado::NAO_ENVIADO)
        ->and($marca->motivo)->toBe('sem telefone no cadastro')
        ->and($volta['enviados'])->toBe(0)
        ->and(lembretesEnviados())->toBe(1);
});

// ---------------------------------------------------------------- confirmação no mesmo dia

it('NÃO deve lembrar a criança nova que recebeu a confirmação hoje, e deve dizer por quê', function () {
    // ARRANGE — "confirmado para amanhã" e, uma hora depois, "podemos confirmar?" é demais
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('15:10'));
    $sessao = sessaoDeAmanha();
    confirmacaoRecebida($sessao);

    // ACT
    $this->travelTo(naClinica('16:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(0)
        ->and($resultado['motivos'])->toBe([DisparoDeLembretes::MOTIVO_JA_CONFIRMADO => 1])
        ->and(lembretesEnviados())->toBe(0);
    $marca = LembreteEnviado::query()->where('agendamento_id', $sessao->id)->firstOrFail();
    expect($marca->status)->toBe(LembreteEnviado::NAO_ENVIADO)
        ->and($marca->motivo)->toBe(DisparoDeLembretes::MOTIVO_JA_CONFIRMADO);
});

it('deve lembrar na véspera a sessão cuja confirmação saiu em outro dia', function () {
    // ARRANGE — confirmada no domingo, na criação; o lembrete das 08:00 de quarta é outra notícia
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('10:00', '2026-10-04'));
    $sessao = sessaoDeAmanha();
    confirmacaoRecebida($sessao);

    // ACT
    $this->travelTo(naClinica('08:00'));
    $resultado = $disparo->executar();

    // ASSERT
    expect($resultado['enviados'])->toBe(1);
});

it('deve lembrar quando a confirmação de hoje falhou', function () {
    // ARRANGE — sem a confirmação, o lembrete é o único aviso
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('15:10'));
    $sessao = sessaoDeAmanha();
    confirmacaoRecebida($sessao, 'falhou');

    // ACT
    $this->travelTo(naClinica('16:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1);
});

it('NÃO deve dispensar quando a criança do agendamento foi trocada depois da confirmação', function () {
    // ARRANGE — a confirmação foi para a família de OUTRA criança
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('10:00'));
    $sessao = sessaoDeAmanha();
    confirmacaoRecebida($sessao);
    $this->travelTo(naClinica('10:30'));
    $outra = Paciente::factory()->create();
    $outra->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 94444-5555']]]);
    $sessao->forceFill(['paciente_id' => $outra->id])->save();

    // ACT
    $this->travelTo(naClinica('11:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1)
        ->and(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('paciente_id'))->toBe($outra->id);
});

it('NÃO deve tratar como de hoje a confirmação de ontem à noite no fuso da clínica', function () {
    // ARRANGE — 22:30 em São Paulo já é o dia seguinte em UTC
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('22:30', '2026-10-06'));
    $sessao = sessaoDeAmanha();
    confirmacaoRecebida($sessao);

    // ACT
    $this->travelTo(naClinica('08:00'));
    $resultado = $disparo->executar();

    // ASSERT
    expect($resultado['enviados'])->toBe(1);
});

it('deve manter a dispensa até o dia da sessão, sem lembrar no domingo a segunda dispensada na sexta', function () {
    // ARRANGE — com a segunda avisada na sexta, o domingo é o dia que a clínica quis evitar
    $disparo = prepararRepescagem();
    app(ConfiguracaoService::class)->set('lembretes.segunda_na_sexta', true);
    $this->travelTo(naClinica('15:10', '2026-10-09'));
    $sessao = sessaoParaLembrete('2026-10-12 14:00');
    confirmacaoRecebida($sessao);
    $this->travelTo(naClinica('16:00', '2026-10-09'));
    $disparo->executar(repescagem: true);

    // ACT
    $this->travelTo(naClinica('08:00', '2026-10-11'));
    $resultado = $disparo->executar();

    // ASSERT
    expect($resultado['enviados'])->toBe(0)
        ->and(lembretesEnviados())->toBe(0)
        ->and(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('motivo'))
        ->toBe(DisparoDeLembretes::MOTIVO_JA_CONFIRMADO);
});

it('deve lembrar no domingo a segunda dispensada na sexta quando a confirmação falha depois', function () {
    // ARRANGE — a dispensa que atravessa os dias também cai quando a confirmação não chegou
    $disparo = prepararRepescagem();
    app(ConfiguracaoService::class)->set('lembretes.segunda_na_sexta', true);
    $this->travelTo(naClinica('15:10', '2026-10-09'));
    $sessao = sessaoParaLembrete('2026-10-12 14:00');
    $marca = confirmacaoRecebida($sessao);
    $this->travelTo(naClinica('16:00', '2026-10-09'));
    $disparo->executar(repescagem: true);
    $this->travelTo(naClinica('11:00', '2026-10-10'));
    Mensagem::query()->whereKey($marca->mensagem_id)->update(['status' => 'falhou']);

    // ACT
    $this->travelTo(naClinica('08:00', '2026-10-11'));
    $resultado = $disparo->executar();

    // ASSERT
    expect($resultado['enviados'])->toBe(1);
});

it('deve lembrar no domingo a segunda dispensada na sexta quando o horário mudou depois', function () {
    // ARRANGE — a confirmação falou das 14:00; a sessão foi para as 16:00 sem aviso
    $disparo = prepararRepescagem();
    app(ConfiguracaoService::class)->set('lembretes.segunda_na_sexta', true);
    $this->travelTo(naClinica('15:10', '2026-10-09'));
    $sessao = sessaoParaLembrete('2026-10-12 14:00');
    confirmacaoRecebida($sessao);
    $this->travelTo(naClinica('16:00', '2026-10-09'));
    $disparo->executar(repescagem: true);
    $sessao->forceFill(['inicio' => '2026-10-12 16:00:00'])->save();

    // ACT
    $this->travelTo(naClinica('08:00', '2026-10-11'));
    $resultado = $disparo->executar();

    // ASSERT
    expect($resultado['enviados'])->toBe(1);
});

it('deve lembrar na volta seguinte quando o horário muda no mesmo dia depois da dispensa', function () {
    // ARRANGE — a confirmação falou das 14:00; a sessão foi para as 16:00 sem aviso à família
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('15:10'));
    $sessao = sessaoDeAmanha('14:00');
    confirmacaoRecebida($sessao);
    $this->travelTo(naClinica('16:00'));
    $disparo->executar(repescagem: true);
    $this->travelTo(naClinica('16:30'));
    $sessao->forceFill(['inicio' => '2026-10-08 16:00:00'])->save();

    // ACT
    $this->travelTo(naClinica('17:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1)
        ->and(Mensagem::query()->where('template_nome', 'lembrete_agendamento')->firstOrFail()->variaveis_json['2'])
        ->toBe('16:00');
});

it('NÃO deve dispensar quando o horário mudou entre a confirmação e a primeira volta', function () {
    // ARRANGE — remarcada sem aviso antes de qualquer dispensa: a família só conhece as 14:00
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('10:00'));
    $sessao = sessaoDeAmanha('14:00');
    confirmacaoRecebida($sessao);
    $this->travelTo(naClinica('10:30'));
    $sessao->forceFill(['inicio' => '2026-10-08 16:00:00'])->save();

    // ACT
    $this->travelTo(naClinica('11:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1);
});

it('NÃO deve dispensar com a marca antiga, sem o horário confirmado', function () {
    // ARRANGE — marca anterior à coluna: sem saber o horário anunciado, o lembrete sai
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('15:10'));
    $sessao = sessaoDeAmanha();
    confirmacaoRecebida($sessao)->forceFill(['inicio_confirmado' => null])->save();

    // ACT
    $this->travelTo(naClinica('16:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1);
});

it('deve gravar na confirmação real o horário anunciado, e a repescagem respeitá-lo', function () {
    // ARRANGE — o caminho de produção: a confirmação do primeiro agendamento, sem marca de teste
    $disparo = prepararRepescagem();
    MensagemTemplate::create([
        'nome' => 'confirmacao_agendamento', 'idioma' => 'pt_BR', 'categoria' => 'UTILITY',
        'corpo_previa' => 'Olá! {{1}} está confirmada para {{2}} com {{3}}.',
        'variaveis_json' => ['1', '2', '3'], 'status_meta' => 'APPROVED',
    ]);
    $this->travelTo(naClinica('15:10'));
    $sessao = sessaoDeAmanha('14:00');
    $aviso = app(AvisoDoAgendamento::class)->confirmar([$sessao], null);

    // ACT
    $this->travelTo(naClinica('16:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($aviso['enviado'] ?? null)->toBeTrue()
        ->and(AvisoAFamilia::query()->where('agendamento_id', $sessao->id)->firstOrFail()->inicio_confirmado->format('Y-m-d H:i'))
        ->toBe('2026-10-08 14:00')
        ->and($resultado['enviados'])->toBe(0)
        ->and($resultado['motivos'])->toBe([DisparoDeLembretes::MOTIVO_JA_CONFIRMADO => 1]);
});

it('deve devolver a não enviado a retentativa recusada, para tentar de novo depois', function () {
    // ARRANGE — sem telefone às 08:00; telefone corrigido, mas o teto zerado recusa a retentativa
    $disparo = prepararRepescagem();
    $sessao = sessaoDeAmanha();
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()->update(['contatos_json' => []]);
    $this->travelTo(naClinica('08:00'));
    $disparo->executar();
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 93333-4444']]]);
    app(ConfiguracaoService::class)->set('whatsapp.limite_mensal', 0);
    $this->travelTo(naClinica('09:00'));
    $disparo->executar(repescagem: true);
    $depoisDaRecusa = LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('status');
    app(ConfiguracaoService::class)->set('whatsapp.limite_mensal', 6000);

    // ACT
    $this->travelTo(naClinica('10:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT — a recusa não pode deixar a linha como "enviado" sem mensagem
    expect($depoisDaRecusa)->toBe(LembreteEnviado::NAO_ENVIADO)
        ->and($resultado['enviados'])->toBe(1)
        ->and(lembretesEnviados())->toBe(1);
});

it('deve liberar o lembrete na volta seguinte quando a confirmação falha depois', function () {
    // ARRANGE — a dispensa fica como não enviado, que é retentável
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('15:10'));
    $sessao = sessaoDeAmanha();
    $marca = confirmacaoRecebida($sessao);
    $this->travelTo(naClinica('16:00'));
    $disparo->executar(repescagem: true);
    Mensagem::query()->whereKey($marca->mensagem_id)->update(['status' => 'falhou']);

    // ACT
    $this->travelTo(naClinica('17:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($resultado['enviados'])->toBe(1)
        ->and(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('status'))
        ->toBe(LembreteEnviado::ENVIADO);
});

it('deve lembrar a família certa quando a confirmação foi ao número que saiu do cadastro', function () {
    // ARRANGE — gate r1, CR-TEL-02: a criança nova foi cadastrada com o número de OUTRA família; a
    // confirmação foi para ele às 09:05 e dispensou o lembrete. A recepção corrige às 10:30 — e a
    // dispensa supunha "a família recebeu a confirmação", o que deixou de ser verdade
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('09:00'));
    $sessao = sessaoDeAmanha('15:00');
    confirmacaoRecebida($sessao);
    $this->travelTo(naClinica('10:00'));
    $disparo->executar(repescagem: true);
    expect(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('motivo'))
        ->toBe(DisparoDeLembretes::MOTIVO_JA_CONFIRMADO);
    $this->travelTo(naClinica('10:30'));
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 93333-4444']]]);

    // ACT
    $this->travelTo(naClinica('11:00'));
    $volta = $disparo->executar(repescagem: true);

    // ASSERT — o lembrete vai ao número novo
    expect($volta['enviados'])->toBe(1)
        ->and(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('status'))->toBe(LembreteEnviado::ENVIADO);
});

it('deve manter a dispensa da confirmação que ainda está sendo enviada', function () {
    // ARRANGE — gate r2, CR-TEL-14: a marca da confirmação sem mensagem é um envio EM ANDAMENTO
    // (dentro do prazo do `falhou()`); sem mensagem não há número a comparar, e a dispensa vale
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('09:59'));
    $sessao = sessaoDeAmanha('15:00');
    AvisoAFamilia::create([
        'tipo' => AvisoAFamilia::TIPO_CONFIRMACAO,
        'chave' => "paciente:{$sessao->paciente_id}",
        'paciente_id' => $sessao->paciente_id,
        'agendamento_id' => $sessao->id,
        'inicio_confirmado' => $sessao->inicio,
    ]);

    // ACT
    $this->travelTo(naClinica('10:00'));
    $volta = $disparo->executar(repescagem: true);

    // ASSERT
    expect($volta['enviados'])->toBe(0)
        ->and(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('motivo'))->toBe(DisparoDeLembretes::MOTIVO_JA_CONFIRMADO);
});

it('deve manter a dispensa quando a confirmação foi ao número que continua no cadastro', function () {
    // ARRANGE — o controle do caso acima: acrescentar um telefone não desfaz a dispensa
    $disparo = prepararRepescagem();
    $this->travelTo(naClinica('09:00'));
    $sessao = sessaoDeAmanha('15:00');
    confirmacaoRecebida($sessao);
    $this->travelTo(naClinica('10:30'));
    Paciente::query()->whereKey($sessao->paciente_id)->firstOrFail()->update(['contatos_json' => [
        ['tipo' => 'celular', 'valor' => '(11) 98765-4321'],
        ['tipo' => 'whatsapp', 'valor' => '(11) 93333-4444'],
    ]]);

    // ACT
    $this->travelTo(naClinica('11:00'));
    $volta = $disparo->executar(repescagem: true);

    // ASSERT
    expect($volta['enviados'])->toBe(0)
        ->and(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->value('motivo'))->toBe(DisparoDeLembretes::MOTIVO_JA_CONFIRMADO);
});

// ---------------------------------------------------------------- agendador

it('deve agendar o disparo das 08:00 e a repescagem de hora em hora', function () {
    // ARRANGE — o `withSchedule` só registra quando o console sobe; sozinho, este teste passava
    // porque a migração do banco subia o console, e na suíte inteira a lista vinha vazia
    $this->artisan('schedule:list')->assertSuccessful();
    $eventos = collect(app(Schedule::class)->events())
        ->filter(fn ($evento): bool => str_contains((string) $evento->command, 'lembretes:enviar'));

    // ACT
    $porComando = $eventos->mapWithKeys(fn ($evento): array => [
        trim(substr((string) $evento->command, strpos((string) $evento->command, 'lembretes:enviar'))) => $evento->expression,
    ]);

    // ASSERT — o cron do principal vem da constante; a repescagem roda toda hora, com trava que
    // expira antes da volta seguinte
    expect($porComando->all())->toBe([
        'lembretes:enviar' => '0 '.DisparoDeLembretes::HORA_DO_DISPARO.' * * *',
        'lembretes:enviar --repescagem' => '0 * * * *',
    ]);
    $repescagem = $eventos->first(fn ($evento): bool => str_contains((string) $evento->command, '--repescagem'));
    expect($repescagem->withoutOverlapping)->toBeTrue()
        ->and($repescagem->expiresAt)->toBe(55);
});

it('deve repassar a opção de repescagem do comando ao disparo', function () {
    // ARRANGE
    prepararRepescagem();
    sessaoDeAmanha();
    $this->travelTo(naClinica('16:00'));

    // ACT
    $this->artisan('lembretes:enviar --repescagem')->assertSuccessful();

    // ASSERT — sanidade do caminho pelo comando; quem prova que a opção chega ao disparo é o
    // teste abaixo (às 16:00 o disparo principal também alcançaria a sessão)
    expect(lembretesEnviados())->toBe(1);
});

it('NÃO deve enviar pelo comando de repescagem fora da janela', function () {
    // ARRANGE
    prepararRepescagem();
    sessaoDeAmanha();
    $this->travelTo(naClinica('07:00'));

    // ACT
    $this->artisan('lembretes:enviar --repescagem')->assertSuccessful();

    // ASSERT — sem a opção, o disparo das 07:00 enviaria (antecedência de 24 h)
    expect(lembretesEnviados())->toBe(0);
});

// ---------------------------------------------------------------- mensagens automáticas por profissional

it('deve lembrar na repescagem a sessão do profissional religado depois das 08:00', function () {
    // ARRANGE — desligado às 08:00 a sessão nem entrou; religar no mesmo dia tem de alcançá-la
    // (change mensagens-automaticas-por-profissional)
    $disparo = prepararRepescagem();
    $sessao = sessaoDeAmanha();
    Profissional::whereKey($sessao->profissional_id)->update(['mensagens_automaticas' => false]);
    $this->travelTo(naClinica('08:00'));
    $principal = $disparo->executar();
    Profissional::whereKey($sessao->profissional_id)->update(['mensagens_automaticas' => true]);

    // ACT
    $this->travelTo(naClinica('11:00'));
    $resultado = $disparo->executar(repescagem: true);

    // ASSERT
    expect($principal['enviados'])->toBe(0)
        ->and($resultado['enviados'])->toBe(1)
        ->and(lembretesEnviados())->toBe(1);
});
