<?php

use App\Models\Convenio;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Agenda\BaixaEmLote;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;

/*
 * O SERVIÇO da baixa em lote por status (change `baixa-em-lote-por-status`, grupo 4): quem entra
 * (a flag `em_aberto`), quem é recusado e por quê (D6), as contagens, o teto e o status alvo.
 * Tudo com dados FICTÍCIOS (LGPD). As datas são relativas ao "hoje" da parede da clínica: a
 * baixa nunca alcança o futuro, e um teste com data fixa no passado envelheceria bem, mas um
 * com data fixa no futuro morreria no dia em que ela virasse passado.
 */

/** Liga `aplicavel_em_lote` num status que não nasce marcado (a clínica faz isso na tela). */
function marcarComoAplicavel(string $nome): StatusAgendamento
{
    $status = StatusAgendamento::where('nome', $nome)->firstOrFail();
    $status->forceFill(['aplicavel_em_lote' => true])->save();

    return $status;
}

it('deve alcançar só os agendamentos em status marcado como em aberto', function () {
    // ARRANGE — "Em Aberto" e "Aguardando" entram; "Falta Justificada", "Reserva" e "Consulta" não
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    $nome = fn (string $n): int => StatusAgendamento::where('nome', $n)->firstOrFail()->id;
    $emAberto = agendamentoDaBaixa($base, "{$dia} 08:00");
    $aguardando = agendamentoDaBaixa($base, "{$dia} 09:00", ['status_id' => $nome('Aguardando Atendimento')]);
    agendamentoDaBaixa($base, "{$dia} 10:00", ['status_id' => $nome('Falta Justificada')]);
    agendamentoDaBaixa($base, "{$dia} 11:00", ['status_id' => $nome('Reserva de Agenda')]);
    agendamentoDaBaixa($base, "{$dia} 12:00", ['status_id' => $nome('Consulta')]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos/baixa-em-lote/previa', alcanceDaBaixa($base, $base['status']['finalizado']));

    // ASSERT — os dois em aberto, e a assinatura cobre exatamente eles (D5: ids na ordem
    // `inicio, id` | status | referência, autenticados com a chave do servidor — SEC-BL-02)
    $resposta->assertOk()->assertJsonPath('contagens.agendamentos', 2)->assertJsonPath('recusados', []);
    $referencia = $resposta->json('referencia');
    $esperada = hash_hmac('sha256', "{$emAberto->id},{$aguardando->id}|{$base['status']['finalizado']}|{$referencia}", (string) config('app.key'));
    expect($resposta->json('assinatura'))->toBe($esperada);
});

it('deve alcançar pela flag, não pelo nome: a clínica que renomeou o status inicial', function () {
    // ARRANGE — "Em Aberto" virou "Marcado"; a flag continua
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    StatusAgendamento::whereKey($base['status']['inicial'])->firstOrFail()->forceFill(['nome' => 'Marcado'])->save();
    agendamentoDaBaixa($base, diaDaBaixa().' 09:00');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos/baixa-em-lote/previa', alcanceDaBaixa($base, $base['status']['finalizado']));

    // ASSERT
    $resposta->assertOk()->assertJsonPath('contagens.agendamentos', 1);
});

it('deve deixar de fora o horário que ainda não começou na referência, e incluí-lo quando ela passa dele', function () {
    // ARRANGE — o serviço decide pela REFERÊNCIA recebida, não pelo relógio (D5)
    admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    $agendamento = agendamentoDaBaixa($base, "{$dia} 19:00");
    $alvo = StatusAgendamento::findOrFail($base['status']['finalizado']);
    $servico = app(BaixaEmLote::class);

    // ACT
    $antes = $servico->resolver($base['profissional_id'], $alvo, $dia, $dia, CarbonImmutable::parse("{$dia} 18:59"));
    $depois = $servico->resolver($base['profissional_id'], $alvo, $dia, $dia, CarbonImmutable::parse("{$dia} 19:00"));

    // ASSERT — às 18:59 recusado com o motivo; às 19:00 entra, e a assinatura muda com ele
    expect($antes['contagens']['agendamentos'])->toBe(0)
        ->and($antes['recusados'][0]['agendamento']->id)->toBe($agendamento->id)
        ->and($antes['recusados'][0]['motivo'])->toBe(BaixaEmLote::RECUSA_AINDA_NAO_COMECOU)
        ->and($depois['contagens']['agendamentos'])->toBe(1)
        ->and($depois['recusados'])->toBe([])
        ->and($depois['assinatura'])->not->toBe($antes['assinatura']);
});

it('deve recusar a data final acima de hoje na parede da clínica', function () {
    // ARRANGE — amanhã; "Falta Justificada" não tem guarda de data no consumo, esta é a única (D3)
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $amanha = agoraNaClinica()->addDay()->format('Y-m-d');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['falta_justificada'], diaDaBaixa(), $amanha));

    // ASSERT
    $resposta->assertStatus(422);
    expect($resposta->json('errors.ate.0'))->toContain('já aconteceu');
});

it('deve recusar o intervalo invertido', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDaBaixa();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado'], diaDaBaixa(1), diaDaBaixa(2)));

    // ASSERT
    $resposta->assertStatus(422);
    expect($resposta->json('errors.ate.0'))->toContain('anterior à inicial');
});

it('deve recusar intervalo acima de 62 dias com comparação real — 10 anos reprovam', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $hoje = diaDaBaixa(0);

    // ACT
    $dezAnos = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado'], agoraNaClinica()->subYears(10)->format('Y-m-d'), $hoje));
    $noTeto = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado'], diaDaBaixa(62), $hoje));

    // ASSERT
    $dezAnos->assertStatus(422);
    expect($dezAnos->json('errors.ate.0'))->toContain('62 dias');
    $noTeto->assertOk();
});

it('deve recusar acima do teto contando os alcançados ANTES da classificação, e aceitar no teto', function () {
    // ARRANGE — 3 em aberto, 1 deles ainda não começou (fim do dia de hoje); teto 2
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    app(ConfiguracaoService::class)->set(BaixaEmLote::CHAVE_DO_TETO, 2);
    $hoje = diaDaBaixa(0);
    agendamentoDaBaixa($base, "{$hoje} 00:00");
    agendamentoDaBaixa($base, "{$hoje} 00:10");
    agendamentoDaBaixa($base, "{$hoje} 23:59");

    // ACT
    $acima = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado'], $hoje, $hoje));
    app(ConfiguracaoService::class)->set(BaixaEmLote::CHAVE_DO_TETO, 3);
    $noTeto = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado'], $hoje, $hoje));

    // ASSERT — "3" e "2" na mensagem; sem linha nenhuma classificada; no teto passa
    $acima->assertStatus(422);
    expect($acima->json('errors.ate.0'))->toContain('3')->toContain('2')
        ->and($acima->json('recusados'))->toBeNull();
    $noTeto->assertOk();
});

it('deve recusar já na prévia a segunda linha do mesmo pacote com saldo 1, e a execução recusa a MESMA linha', function () {
    // ARRANGE — a mesma criança 2× na semana, pacote com 1 sessão de saldo (lição do gate do desmarque)
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $pacote = pacoteDaBaixa($base, total: 10, realizadas: 9);
    $primeira = agendamentoDaBaixa($base, diaDaBaixa(2).' 09:00', ['tratamento_id' => $pacote->id]);
    $segunda = agendamentoDaBaixa($base, diaDaBaixa(1).' 09:00', ['tratamento_id' => $pacote->id]);
    $alcance = alcanceDaBaixa($base, $base['status']['finalizado'], diaDaBaixa(2), diaDaBaixa(1));

    // ACT
    $previa = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa', $alcance);
    $execucao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', [
        ...$alcance, 'assinatura' => $previa->json('assinatura'), 'referencia' => $previa->json('referencia'),
    ]);

    // ASSERT — a prévia: 1 entra, a segunda recusada por sem_saldo; a execução: o mesmo desfecho
    $previa->assertOk()
        ->assertJsonPath('contagens.agendamentos', 1)
        ->assertJsonPath('contagens.sessoes_a_descontar', 1)
        ->assertJsonPath('recusados.0.id', $segunda->id)
        ->assertJsonPath('recusados.0.motivo', 'sem_saldo');
    $execucao->assertOk()
        ->assertJsonPath('aplicados', 1)
        ->assertJsonPath('contagens.sessoes_descontadas', 1)
        ->assertJsonPath('recusados.0.id', $segunda->id)
        ->assertJsonPath('recusados.0.motivo', 'sem_saldo');
    expect($primeira->refresh()->status_id)->toBe($base['status']['finalizado'])
        ->and($primeira->sessao_consumida_em)->not->toBeNull()
        ->and($segunda->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and($pacote->refresh()->sessoes_realizadas)->toBe(10);
});

it('deve contar sem_pacote, ja_consumidas, com_atendimento_registrado, crianças distintas e sessões a descontar', function () {
    // ARRANGE — 5 em aberto de 3 crianças fictícias: 2 com pacote (1 delas já consumida e
    // atendida), 1 sem pacote, e mais 2 da mesma criança com pacote grande
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    $criancaB = Paciente::factory()->create()->id;
    $criancaC = Paciente::factory()->create()->id;
    $pacoteA = pacoteDaBaixa($base, total: 10);
    $pacoteC = pacoteDaBaixa($base, total: 10, pacienteId: $criancaC);
    $consumida = agendamentoDaBaixa($base, "{$dia} 08:00", ['tratamento_id' => $pacoteA->id]);
    $consumida->forceFill(['sessao_consumida_em' => "{$dia} 08:40"])->save();
    atendimentoRegistradoNaBaixa($base, $consumida->id, "{$dia} 08:40");
    agendamentoDaBaixa($base, "{$dia} 09:00", ['tratamento_id' => $pacoteA->id]);
    agendamentoDaBaixa($base, "{$dia} 10:00", ['paciente_id' => $criancaB]);
    agendamentoDaBaixa($base, "{$dia} 11:00", ['paciente_id' => $criancaC, 'tratamento_id' => $pacoteC->id]);
    agendamentoDaBaixa($base, "{$dia} 12:00", ['paciente_id' => $criancaC, 'tratamento_id' => $pacoteC->id]);

    // ACT
    $descontante = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado']));
    $naoDescontante = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['falta_justificada']));

    // ASSERT
    $descontante->assertOk();
    expect($descontante->json('contagens'))->toBe([
        'agendamentos' => 5,
        'criancas' => 3,
        'sessoes_a_descontar' => 3,
        'sem_pacote' => 1,
        'ja_consumidas' => 1,
        'com_atendimento_registrado' => 1,
    ])->and($descontante->json('status'))->toBe([
        'id' => $base['status']['finalizado'], 'nome' => 'Finalizado', 'desconta_sessao' => true, 'marca_falta' => false,
    ]);
    // alvo não-descontante zera sessões e o que só faz sentido para desconto; ja_consumidas vira estorno
    $naoDescontante->assertOk();
    expect($naoDescontante->json('contagens'))->toBe([
        'agendamentos' => 5,
        'criancas' => 3,
        'sessoes_a_descontar' => 0,
        'sem_pacote' => 0,
        'ja_consumidas' => 1,
        'com_atendimento_registrado' => 0,
    ]);
});

it('deve recusar atendimento registrado só quando o alvo marca falta, e incluí-lo quando o alvo desconta', function () {
    // ARRANGE — "Não Compareceu" (desconta + marca falta) ligado como aplicável em lote pela clínica
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    $falta = marcarComoAplicavel('Não Compareceu');
    $atendido = agendamentoDaBaixa($base, "{$dia} 09:00");
    atendimentoRegistradoNaBaixa($base, $atendido->id, "{$dia} 09:40");
    $livre = agendamentoDaBaixa($base, "{$dia} 10:00");

    // ACT
    $comoFalta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $falta->id));
    $comoFinalizado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado']));

    // ASSERT — atendido não vira falta; atendido é finalizado (e contado)
    $comoFalta->assertOk()
        ->assertJsonPath('contagens.agendamentos', 1)
        ->assertJsonPath('recusados.0.id', $atendido->id)
        ->assertJsonPath('recusados.0.motivo', 'atendimento_registrado');
    $comoFinalizado->assertOk()
        ->assertJsonPath('contagens.agendamentos', 2)
        ->assertJsonPath('contagens.com_atendimento_registrado', 1)
        ->assertJsonPath('recusados', []);
    expect($livre->refresh()->status_id)->toBe($base['status']['inicial']);
});

it('deve classificar ciclo fechado pela fonte única, sem tocar a linha', function () {
    // ARRANGE — convênio com corte dia 15; sessão em 01/07/2026, dentro da janela 16/06–15/07 fechada
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $convenio = Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        'ciclo_tipo_corte' => 'dia_fixo',
        'ciclo_dia_corte' => 15,
    ]);
    $pacote = pacoteDaBaixa($base, total: 10);
    $pacote->forceFill(['convenio_id' => $convenio->id])->save();
    $congelado = agendamentoDaBaixa($base, '2026-07-01 10:00', ['tratamento_id' => $pacote->id]);
    $livre = agendamentoDaBaixa($base, '2026-07-01 11:00');
    fecharJanelaDeJulho($convenio, $adminDaClinica);
    $alcance = alcanceDaBaixa($base, $base['status']['finalizado'], '2026-07-01', '2026-07-01');

    // ACT
    $previa = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa', $alcance);
    $execucao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', [
        ...$alcance, 'assinatura' => $previa->json('assinatura'), 'referencia' => $previa->json('referencia'),
    ]);

    // ASSERT — prévia e resultado recusam a mesma linha por `ciclo_fechado`; o livre passa
    $previa->assertOk()
        ->assertJsonPath('contagens.agendamentos', 1)
        ->assertJsonPath('recusados.0.id', $congelado->id)
        ->assertJsonPath('recusados.0.motivo', 'ciclo_fechado');
    $execucao->assertOk()
        ->assertJsonPath('aplicados', 1)
        ->assertJsonPath('recusados.0.id', $congelado->id)
        ->assertJsonPath('recusados.0.motivo', 'ciclo_fechado');
    expect($congelado->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and($livre->refresh()->status_id)->toBe($base['status']['finalizado']);
});

it('deve recusar 422 em status_id o status sem aplicavel_em_lote, o em aberto e o inexistente', function () {
    // ARRANGE — "Consulta" (não marcado), o inicial (em aberto) e um id inexistente
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $consulta = StatusAgendamento::where('nome', 'Consulta')->firstOrFail()->id;
    $inexistente = StatusAgendamento::max('id') + 1000;
    $previa = fn (int $statusId) => $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos/baixa-em-lote/previa', alcanceDaBaixa($base, $statusId));

    // ACT
    $semFlag = $previa($consulta);
    $emAberto = $previa($base['status']['inicial']);
    $naoExiste = $previa($inexistente);

    // ASSERT — todos 422 em `status_id`; o admin (que edita status) recebe o caminho
    foreach ([$semFlag, $emAberto, $naoExiste] as $resposta) {
        $resposta->assertStatus(422)->assertJsonValidationErrors(['status_id']);
    }
    expect($semFlag->json('errors.status_id.0'))
        ->toBe('Este status não está marcado como aplicável em lote. Marque em Cadastros › Status de agendamento.')
        ->and($emAberto->json('errors.status_id.0'))->toBe($semFlag->json('errors.status_id.0'));
});

it('deve omitir o caminho "Marque em Cadastros" para quem não edita status', function () {
    // ARRANGE — recepção com agenda.editar, sem status_agendamento.editar
    admin();
    $base = baseDaBaixa();
    $recepcao = usuarioCom(['agenda.ver', 'agenda.editar', 'agenda.ver_todos'], 'Recepção fictícia');
    $consulta = StatusAgendamento::where('nome', 'Consulta')->firstOrFail()->id;

    // ACT
    $resposta = $this->actingAs($recepcao)
        ->postJson('/api/agendamentos/baixa-em-lote/previa', alcanceDaBaixa($base, $consulta));

    // ASSERT
    $resposta->assertStatus(422);
    expect($resposta->json('errors.status_id.0'))->toBe('Este status não está marcado como aplicável em lote.');
});

it('deve devolver evolucoes_vencidas só quando o alvo desconta', function () {
    // ARRANGE — prazo 1 dia, carência 0: um atendimento de 5 dias atrás sem evolução está vencido
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    app(ConfiguracaoService::class)->set('evolucoes.prazo_dias', 1);
    app(ConfiguracaoService::class)->set('evolucoes.trava_carencia_dias', 0);
    $antigo = agendamentoDaBaixa($base, diaDaBaixa(5).' 09:00');
    atendimentoRegistradoNaBaixa($base, $antigo->id, diaDaBaixa(5).' 09:40');
    agendamentoDaBaixa($base, diaDaBaixa().' 09:00');

    // ACT
    $descontante = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado']));
    $naoDescontante = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['falta_justificada']));

    // ASSERT — o aviso informa e não trava; sem desconto, a chave nem existe
    $descontante->assertOk()->assertJsonPath('avisos.evolucoes_vencidas', 1)->assertJsonPath('contagens.agendamentos', 1);
    $naoDescontante->assertOk();
    expect($naoDescontante->json('avisos'))->toBe([]);
});

it('deve ignorar periodo no payload: o alcance é o dia inteiro', function () {
    // ARRANGE — manhã e tarde em aberto; `periodo=manha` não existe no contrato (D16)
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $dia = diaDaBaixa();
    agendamentoDaBaixa($base, "{$dia} 09:00");
    agendamentoDaBaixa($base, "{$dia} 15:00");

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        [...alcanceDaBaixa($base, $base['status']['finalizado']), 'periodo' => 'manha']);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('contagens.agendamentos', 2);
});

it('deve recusar profissional desligado em profissional_id', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    Profissional::whereKey($base['profissional_id'])->update(['ativo' => false]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa',
        alcanceDaBaixa($base, $base['status']['finalizado']));

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors(['profissional_id']);
});

it('deve encontrar a agenda vazia ao repetir o gesto', function () {
    // ARRANGE — a baixa do dia já aplicada
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    agendamentoDaBaixa($base, diaDaBaixa().' 09:00');
    $alcance = alcanceDaBaixa($base, $base['status']['falta_justificada']);
    $previa = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa', $alcance);
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', [
        ...$alcance, 'assinatura' => $previa->json('assinatura'), 'referencia' => $previa->json('referencia'),
    ])->assertOk()->assertJsonPath('aplicados', 1);

    // ACT
    $deNovo = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa', $alcance);

    // ASSERT — zero agendamentos, zero crianças, nenhum recusado
    $deNovo->assertOk()
        ->assertJsonPath('contagens.agendamentos', 0)
        ->assertJsonPath('contagens.criancas', 0)
        ->assertJsonPath('recusados', []);
});
