<?php

use App\Jobs\EnviarMensagemJob;
use App\Models\Agendamento;
use App\Models\Conversa;
use App\Models\LembreteEnviado;
use App\Models\Mensagem;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Mensageria\ClienteSimulado;
use App\Support\Mensageria\ClienteWhatsApp;
use App\Support\Mensageria\DisparoDeLembretes;
use App\Support\Mensageria\FabricaDeCliente;
use Illuminate\Support\Facades\Queue;

/**
 * O disparo automático (change mensageria-whatsapp) — o que a FA-06 previu.
 *
 * A garantia mais cara aqui é "um lembrete por agendamento": mandar dois iguais para a
 * mesma mãe é o defeito que a clínica percebe primeiro.
 *
 * Dados 100% FICTÍCIOS.
 */
function prepararDisparo(): array
{
    $admin = admin();
    canalConectado();
    templateAprovado();

    app(ConfiguracaoService::class)->set('whatsapp.automatico', true);
    app()->instance(ClienteWhatsApp::class, new ClienteSimulado);

    return [$admin, app(DisparoDeLembretes::class)];
}

/** Agendamento de amanhã, marcado para lembrete, do paciente com o telefone dado. */
function agendamentoDeAmanha(string $telefone = '(11) 98765-4321', string $hora = '14:00'): Agendamento
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

    $agendamento->forceFill([
        'lembrete_whatsapp' => true,
        'status_id' => StatusAgendamento::inicialId(),
    ])->save();

    return $agendamento;
}

beforeEach(function () {
    Queue::fake();
});

it('NÃO deve enviar nada com a automação DESLIGADA', function () {
    // ARRANGE — desligar é decisão da clínica, não uma falha a alarmar
    [, $disparo] = prepararDisparo();
    app(ConfiguracaoService::class)->set('whatsapp.automatico', false);
    agendamentoDeAmanha();

    // ACT
    $resultado = $disparo->executar();

    // ASSERT
    expect($resultado['enviados'])->toBe(0);
    expect(Mensagem::query()->count())->toBe(0);
});

it('deve enviar o lembrete do dia seguinte para quem está marcado', function () {
    // ARRANGE
    [, $disparo] = prepararDisparo();
    agendamentoDeAmanha();

    // ACT
    $resultado = $disparo->executar();

    // ASSERT — e o lembrete aparece na thread, com autoria de SISTEMA
    expect($resultado['enviados'])->toBe(1);
    $mensagem = Mensagem::query()->firstOrFail();
    expect($mensagem->automatica)->toBeTrue();
    expect($mensagem->enviada_por)->toBeNull();
    expect($mensagem->template_nome)->toBe('lembrete_agendamento');
});

it('NÃO deve enviar para agendamento sem o marcador', function () {
    // ARRANGE
    [, $disparo] = prepararDisparo();
    agendamentoDeAmanha()->forceFill(['lembrete_whatsapp' => false])->save();

    // ACT / ASSERT
    expect($disparo->executar()['enviados'])->toBe(0);
});

it('NÃO deve enviar quando o status LIBERA o horário', function () {
    // ARRANGE — a decisão é da FLAG `ocupa_horario`, nunca do nome do status (§13)
    [, $disparo] = prepararDisparo();
    $agendamento = agendamentoDeAmanha();
    $liberado = StatusAgendamento::create([
        'nome' => 'Status Fictício Que Libera',
        'cor' => '#94A3B8',
        'ocupa_horario' => false,
        'ordem' => 99,
    ]);
    $agendamento->forceFill(['status_id' => $liberado->id])->save();

    // ACT / ASSERT
    expect($disparo->executar()['enviados'])->toBe(0);
});

it('deve continuar funcionando depois de a clínica RENOMEAR o status', function () {
    // ARRANGE — a régua é a flag; renomear não pode quebrar a regra
    [, $disparo] = prepararDisparo();
    $agendamento = agendamentoDeAmanha();
    StatusAgendamento::query()->whereKey($agendamento->status_id)->firstOrFail()
        ->update(['nome' => 'Nome Completamente Diferente']);

    // ACT / ASSERT
    expect($disparo->executar()['enviados'])->toBe(1);
});

it('NÃO deve mandar dois lembretes do mesmo agendamento, nem rodando duas vezes', function () {
    // ARRANGE
    [, $disparo] = prepararDisparo();
    agendamentoDeAmanha();

    // ACT
    $primeiro = $disparo->executar();
    $segundo = $disparo->executar();

    // ASSERT — a garantia é do índice único, não de uma checagem prévia
    expect($primeiro['enviados'])->toBe(1);
    expect($segundo['enviados'])->toBe(0);
    expect(Mensagem::query()->count())->toBe(1);
});

it('não deve levar o horário de TÉRMINO à família, só o de início', function () {
    // ARRANGE — change horario-de-termino-no-card, pedido da clínica: "08:40 às 09:20" é da tela da
    // equipe e "não vá para o paciente". O lembrete continua dizendo só quando a sessão começa
    [, $disparo] = prepararDisparo();
    $agendamento = agendamentoDeAmanha(hora: '08:40');
    $agendamento->forceFill(['fim' => $agendamento->inicio->copy()->setTime(9, 20)])->save();

    // ACT
    $disparo->executar();

    // ASSERT
    $corpo = Mensagem::query()->firstOrFail()->corpo;
    expect($corpo)->toContain('08:40')
        ->and($corpo)->not->toContain('09:20');
});

it('deve juntar os irmãos do mesmo dia numa mensagem só', function () {
    // ARRANGE — DOIS PACIENTES distintos no MESMO telefone (o celular da mãe): é o caso
    // que a regra existe para resolver, e o teste antigo usava o mesmo paciente duas
    // vezes, então nunca exercitava o agrupamento entre irmãos (achado do gate)
    [, $disparo] = prepararDisparo();
    agendamentoDeAmanha(hora: '14:00');
    agendamentoDeAmanha(hora: '15:00');
    expect(Paciente::query()->count())->toBe(2);

    // ACT
    $resultado = $disparo->executar();

    // ASSERT — os dois ficam registrados como lembrados, e sai UMA mensagem
    expect($resultado['enviados'])->toBe(2);
    expect(Mensagem::query()->count())->toBe(1);
    // e cada horário diz de quem é: "14:00, 15:00" não diria
    expect(Mensagem::query()->firstOrFail()->corpo)->toContain('às 14:00');
    expect(Mensagem::query()->firstOrFail()->corpo)->toContain('às 15:00');
});

it('deve mandar uma mensagem por agendamento com o LOTE desligado', function () {
    // ARRANGE
    [, $disparo] = prepararDisparo();
    app(ConfiguracaoService::class)->set('lembretes.em_lote', false);
    agendamentoDeAmanha(hora: '14:00');
    agendamentoDeAmanha(hora: '15:00');

    // ACT
    $disparo->executar();

    // ASSERT
    expect(Mensagem::query()->count())->toBe(2);
});

it('NÃO deve enviar para família que pediu para não receber', function () {
    // ARRANGE — o opt-out cala o AUTOMÁTICO, não o atendimento
    [, $disparo] = prepararDisparo();
    agendamentoDeAmanha();
    $conversa = new Conversa;
    $conversa->telefone_e164 = '+5511987654321';
    $conversa->sem_lembretes = true;
    $conversa->save();

    // ACT
    $resultado = $disparo->executar();

    // ASSERT
    expect($resultado['enviados'])->toBe(0);
    expect($resultado['nao_enviados'])->toBe(1);
    expect(Mensagem::query()->count())->toBe(0);
    expect(LembreteEnviado::query()->firstOrFail()->motivo)
        ->toBe('família pediu para não receber lembretes');
});

it('deve REGISTRAR quem ficou sem aviso por não ter telefone', function () {
    // ARRANGE — silêncio aqui é a recepção achando que a família foi avisada
    [, $disparo] = prepararDisparo();
    $agendamento = agendamentoDeAmanha();
    Paciente::query()->whereKey($agendamento->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'email', 'valor' => 'ficticio@exemplo.test']]]);

    // ACT
    $disparo->executar();

    // ASSERT
    $marca = LembreteEnviado::query()->firstOrFail();
    expect($marca->status)->toBe(LembreteEnviado::NAO_ENVIADO);
    expect($marca->motivo)->toBe('sem telefone no cadastro');
});

it('deve dizer telefone inválido, e não sem telefone, quando o número foi digitado errado', function (string $digitado) {
    // ARRANGE — em 02/10 seis crianças TINHAM telefone e o motivo dizia "sem telefone cadastrado"
    // (change telefone-que-chega-no-whatsapp)
    [, $disparo] = prepararDisparo();
    $agendamento = agendamentoDeAmanha();
    Paciente::query()->whereKey($agendamento->paciente_id)->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => $digitado]]]);

    // ACT
    $resultado = $disparo->executar();

    // ASSERT
    $marca = LembreteEnviado::query()->firstOrFail();
    expect($marca->status)->toBe(LembreteEnviado::NAO_ENVIADO);
    expect($marca->motivo)->toBe('telefone inválido no cadastro');
    expect($resultado['motivos'])->toBe(['telefone inválido no cadastro' => 1]);
})->with([
    'DDI na frente, um dígito a menos' => '55 49912-3456',
    'sem DDD' => '8765-4321',
    'de fora do país, curto demais' => '+44 7700',
    'de fora do país, sem o +' => '447700900123',
]);

it('deve enviar o lembrete para o celular de fora do país', function () {
    // ARRANGE — família com celular do Reino Unido (change telefone-estrangeiro); faixa de ficção da Ofcom
    [, $disparo] = prepararDisparo();
    agendamentoDeAmanha('+44 7700 900123');

    // ACT — o disparo enfileira; o job roda aqui, de verdade, contra o cliente simulado
    $resultado = $disparo->executar();
    Queue::pushed(EnviarMensagemJob::class)
        ->each(fn (EnviarMensagemJob $job) => $job->handle(app(FabricaDeCliente::class)));

    // ASSERT — sai para o número como a família o tem, e a conversa é a dele
    $simulado = app(ClienteWhatsApp::class);
    expect($resultado['enviados'])->toBe(1)
        ->and($simulado->enviados)->toHaveCount(1)
        ->and($simulado->enviados[0]['para'])->toBe('+447700900123')
        ->and(Conversa::query()->sole()->telefone_e164)->toBe('+447700900123');
});

it('NÃO deve deixar o teto do mês passar batido — e deve registrar o motivo', function () {
    // ARRANGE
    [, $disparo] = prepararDisparo();
    app(ConfiguracaoService::class)->set('whatsapp.limite_mensal', 0);
    agendamentoDeAmanha();

    // ACT
    $resultado = $disparo->executar();

    // ASSERT — o lembrete não sai, e o fato fica consultável
    expect($resultado['enviados'])->toBe(0);
    expect($resultado['nao_enviados'])->toBe(1);
    expect(LembreteEnviado::query()->firstOrFail()->motivo)->toContain('limite');
});

it('NÃO deve enviar para RESERVA por padrão, e deve enviar quando a clínica liga a opção', function () {
    // ARRANGE — reserva é compromisso provisório; avisá-la por padrão vira promessa
    [, $disparo] = prepararDisparo();
    $agendamento = agendamentoDeAmanha();
    $reserva = StatusAgendamento::create([
        'nome' => 'Reserva Fictícia',
        'cor' => '#8B5CF6',
        'ocupa_horario' => true,
        'marca_reserva' => true,
        'ordem' => 98,
    ]);
    $agendamento->forceFill(['status_id' => $reserva->id])->save();

    // ACT / ASSERT
    expect($disparo->executar()['enviados'])->toBe(0);

    app(ConfiguracaoService::class)->set('lembretes.incluir_reservas', true);
    expect($disparo->executar()['enviados'])->toBe(1);
});

it('deve cobrir a SEGUNDA no disparo de sexta, sem repetir no domingo', function () {
    // ARRANGE — sem a regra, o lembrete de segunda sairia no domingo, dia em que a clínica
    // não atende e a família não tem a quem responder
    [, $disparo] = prepararDisparo();

    $sexta = agoraNaClinica()->next(Carbon\Carbon::FRIDAY)->setTime(8, 0);
    $base = baseDeAgenda();
    Paciente::query()->whereKey($base['paciente_id'])->firstOrFail()
        ->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 98765-4321']]]);

    $segunda = $sexta->copy()->next(Carbon\Carbon::MONDAY);
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'inicio' => $segunda->format('Y-m-d').' 10:00:00',
    ]);
    $agendamento->forceFill([
        'lembrete_whatsapp' => true,
        'status_id' => StatusAgendamento::inicialId(),
    ])->save();

    // ACT — o disparo de SEXTA
    $naSexta = $disparo->executar($sexta);
    // e o de DOMINGO, que não pode repetir
    $noDomingo = $disparo->executar($sexta->copy()->addDays(2)->setTime(8, 0));

    // ASSERT
    expect($naSexta['enviados'])->toBe(1);
    expect($noDomingo['enviados'])->toBe(0);
    expect(Mensagem::query()->count())->toBe(1);
});

it('deve calcular o dia no fuso da CLÍNICA, não no do servidor', function () {
    // ARRANGE — o servidor roda em UTC; às 21h de Brasília, "amanhã" lá já é depois de
    // amanhã. Sem o fuso da clínica, o lembrete das 8h sairia para o dia errado.
    [, $disparo] = prepararDisparo();
    $agendamento = agendamentoDeAmanha(hora: '09:00');

    // ACT — 21h na parede da clínica (00h UTC do dia seguinte)
    $resultado = $disparo->executar(agoraNaClinica()->setTime(21, 0));

    // ASSERT — ainda pega o agendamento de amanhã na parede da clínica
    expect($resultado['enviados'])->toBe(1);
    expect(LembreteEnviado::query()->firstOrFail()->competencia->format('Y-m-d'))
        ->toBe($agendamento->inicio->format('Y-m-d'));
});

it('deve RETENTAR o agendamento cujo lembrete não saiu, quando o cadastro é corrigido', function () {
    // ARRANGE — a marca de NÃO ENVIADO era terminal: o disparo das 08:00 registrava "sem
    // telefone", a recepção corrigia o cadastro às 09:00, e nenhum lembrete jamais saía
    // para aquele agendamento — sem envio manual para compensar (FA-06). Achado do gate.
    [, $disparo] = prepararDisparo();
    $agendamento = agendamentoDeAmanha();
    $paciente = Paciente::query()->whereKey($agendamento->paciente_id)->firstOrFail();
    $paciente->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '8765-4321']]]);

    expect($disparo->executar()['enviados'])->toBe(0);
    expect(LembreteEnviado::query()->firstOrFail()->status)->toBe(LembreteEnviado::NAO_ENVIADO);

    // ACT — a recepção corrige o telefone e o disparo roda de novo
    $paciente->update(['contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 98765-4321']]]);
    $resultado = $disparo->executar();

    // ASSERT — agora sai, e a marca vira ENVIADO sem duplicar a linha
    expect($resultado['enviados'])->toBe(1);
    expect(LembreteEnviado::query()->count())->toBe(1);
    expect(LembreteEnviado::query()->firstOrFail()->status)->toBe(LembreteEnviado::ENVIADO);
    expect(Mensagem::query()->count())->toBe(1);
});

it('NÃO deve reenviar o que JÁ foi enviado, mesmo reexecutando', function () {
    // ARRANGE — a retentabilidade não pode abrir a porta da duplicata
    [, $disparo] = prepararDisparo();
    agendamentoDeAmanha();

    // ACT
    expect($disparo->executar()['enviados'])->toBe(1);
    $segundo = $disparo->executar();

    // ASSERT
    expect($segundo['enviados'])->toBe(0);
    expect(Mensagem::query()->count())->toBe(1);
});

// ── Mensagens automáticas por profissional (change mensagens-automaticas-por-profissional) ───

it('NÃO deve lembrar nem registrar a sessão do profissional com as mensagens automáticas desligadas', function () {
    // ARRANGE — ela confirma as famílias por conta própria: não é falha, então nem "não enviado" vira
    [, $disparo] = prepararDisparo();
    $sessao = agendamentoDeAmanha();
    Profissional::whereKey($sessao->profissional_id)->update(['mensagens_automaticas' => false]);

    // ACT
    $resultado = $disparo->executar();

    // ASSERT
    expect($resultado['enviados'])->toBe(0)
        ->and($resultado['nao_enviados'])->toBe(0)
        ->and(Mensagem::query()->count())->toBe(0)
        ->and(LembreteEnviado::query()->where('agendamento_id', $sessao->id)->exists())->toBeFalse();
});

it('deve lembrar no lote só o horário do profissional com as mensagens ligadas', function () {
    // ARRANGE — o celular da mãe com dois filhos: um com a profissional que confirma sozinha, outro não
    [, $disparo] = prepararDisparo();
    $daQueConfirmaSozinha = agendamentoDeAmanha(hora: '14:00');
    $doOutro = agendamentoDeAmanha(hora: '15:00');
    Profissional::whereKey($daQueConfirmaSozinha->profissional_id)->update(['mensagens_automaticas' => false]);

    // ACT
    $resultado = $disparo->executar();

    // ASSERT — uma mensagem, com o horário do outro e sem o dela
    expect($resultado['enviados'])->toBe(1);
    $mensagem = Mensagem::query()->sole();
    expect($mensagem->variaveis_json['2'])->toBe('15:00')
        ->and(LembreteEnviado::query()->where('agendamento_id', $doOutro->id)->value('status'))->toBe(LembreteEnviado::ENVIADO)
        ->and(LembreteEnviado::query()->where('agendamento_id', $daQueConfirmaSozinha->id)->exists())->toBeFalse();
});

it('deve parar de lembrar as sessões já marcadas quando o profissional é desligado depois', function () {
    // ARRANGE — a série nasceu com o lembrete; desligar pela TELA tem de valer sem editar agendamento
    [$admin, $disparo] = prepararDisparo();
    $sessao = agendamentoDeAmanha();
    $profissional = Profissional::findOrFail($sessao->profissional_id);
    $this->actingAs($admin)->putJsonComVersao("/api/profissionais/{$profissional->id}", [
        'nome' => $profissional->nome,
        'mensagens_automaticas' => false,
    ])->assertOk();

    // ACT
    $resultado = $disparo->executar();

    // ASSERT — o agendamento continua pedindo WhatsApp; quem cala é o cadastro, lido na hora
    expect($sessao->fresh()->lembrete_whatsapp)->toBeTrue()
        ->and($resultado['enviados'])->toBe(0)
        ->and(Mensagem::query()->count())->toBe(0);
});
