<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;

/**
 * O relógio é TRAVADO na véspera do dia que os cenários usam.
 *
 * Todas as datas deste arquivo são `2026-09-14` fixo, e o desmarque em lote passa pelo boundary
 * da agenda — que recusa retroativo. Enquanto aquele dia era futuro, a suíte passava; no dia
 * 14/09/2026 ela começou a falhar sozinha, em três testes, conforme as horas do dia foram
 * passando (09:00 e 12:30 viram passado às 13h). Teste que muda de veredito com o calendário não
 * está testando a regra, está testando o dia em que roda.
 *
 * `03:00` em UTC é `00:00` na parede da clínica (America/Sao_Paulo): a data é a mesma nos dois
 * fusos, e todo horário de atendimento do dia é futuro.
 */
beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-09-14 03:00'));
});

afterEach(function () {
    $this->travelBack();
});

it('deve alcançar só a manhã quando o período é manhã', function () {
    // ARRANGE — corte default 12:00
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    $manha = agendamentoDoDesmarque($base, '2026-09-14 09:00');
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'manha',
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('contagens.agendamentos'))->toBe(1);
    expect($manha->refresh()->status_id)->toBe(StatusAgendamento::inicialId());
});

it('deve mover a fronteira manhã/tarde pela configuração da clínica', function () {
    // ARRANGE — a clínica cujo turno vira 13:00; um `if (hora < 12)` erraria aqui
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    app(ConfiguracaoService::class)->set('agenda.corte_manha_tarde', '13:00');
    agendamentoDoDesmarque($base, '2026-09-14 12:30');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'manha',
    ]);

    // ASSERT — com o corte default (12:00) este agendamento seria TARDE
    $resposta->assertOk();
    expect($resposta->json('contagens.agendamentos'))->toBe(1);
});

it('deve aplicar o período a cada dia do intervalo', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    foreach (['2026-09-14', '2026-09-15', '2026-09-16'] as $dia) {
        agendamentoDoDesmarque($base, "{$dia} 14:00");
        agendamentoDoDesmarque($base, "{$dia} 09:00");
    }

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-16', 'periodo' => 'tarde',
    ]);

    // ASSERT — as três tardes, nenhuma manhã
    $resposta->assertOk();
    expect($resposta->json('contagens.agendamentos'))->toBe(3);
});

it('deve contar CRIANÇAS distintas, não só agendamentos', function () {
    // ARRANGE — 3 agendamentos de 2 crianças fictícias: é o número de famílias que dimensiona
    // o estrago de um engano, e "3 agendamentos" o esconderia
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    $outraCrianca = Paciente::factory()->create()->id;
    agendamentoDoDesmarque($base, '2026-09-14 09:00');
    agendamentoDoDesmarque($base, '2026-09-14 10:00');
    agendamentoDoDesmarque($base, '2026-09-14 11:00', ['paciente_id' => $outraCrianca]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'dia',
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('contagens.agendamentos'))->toBe(3)
        ->and($resposta->json('contagens.criancas'))->toBe(2)
        ->and($resposta->json('contagens.avisos'))->toBe(2);
});

it('deve recusar o alcance acima do teto, informando alcance e teto', function () {
    // ARRANGE — o teto é o único freio contra o gesto que desmarca um semestre
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    app(ConfiguracaoService::class)->set('agenda.desmarque_em_lote_maximo', 2);
    foreach (['09:00', '10:00', '11:00'] as $hora) {
        agendamentoDoDesmarque($base, "2026-09-14 {$hora}");
    }

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'dia',
    ]);

    // ASSERT
    $resposta->assertStatus(422);
    expect($resposta->json('errors.ate.0'))->toContain('3')->toContain('2');
});

it('deve recusar intervalo invertido', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDoDesmarque();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-16', 'ate' => '2026-09-14', 'periodo' => 'dia',
    ]);

    // ASSERT
    $resposta->assertStatus(422);
});

it('não deve escrever nada na prévia', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    $agendamento = agendamentoDoDesmarque($base, '2026-09-14 09:00');
    $statusOriginal = $agendamento->status_id;
    $bloqueiosAntes = Agendamento::where('tipo', 'bloqueio')->count();

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'dia',
        'bloquear' => true, 'motivo' => 'Atestado fictício',
    ])->assertOk();

    // ASSERT — nem status, nem bloqueio
    expect($agendamento->refresh()->status_id)->toBe($statusOriginal)
        ->and(Agendamento::where('tipo', 'bloqueio')->count())->toBe($bloqueiosAntes);
});

it('deve recusar agendamento com atendimento registrado, sem impedir os outros', function () {
    // ARRANGE — não se desmarca o que já aconteceu
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    $atendido = agendamentoDoDesmarque($base, '2026-09-14 09:00');
    $livre = agendamentoDoDesmarque($base, '2026-09-14 10:00');
    // `agendamento_id` fica fora de `$fillable` (server-set): atribuídos direto
    $atendimento = new Atendimento([
        'iniciado_em' => '2026-09-14 09:00',
        'finalizado_em' => '2026-09-14 09:40',
    ]);
    $atendimento->agendamento_id = $atendido->id;
    $atendimento->save();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'dia',
    ]);

    // ASSERT — o livre foi desmarcado, o atendido não
    $resposta->assertOk();
    expect($resposta->json('desmarcados'))->toBe(1)
        ->and($atendido->refresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and($livre->refresh()->status_id)->not->toBe(StatusAgendamento::inicialId());
});

it('deve recusar status que desconta sessão na execução', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    $agendamento = agendamentoDoDesmarque($base, '2026-09-14 09:00');
    $descontante = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'dia',
        'status_id' => $descontante->id,
    ]);

    // ASSERT — nada foi alterado
    $resposta->assertStatus(422);
    expect($agendamento->refresh()->status_id)->toBe(StatusAgendamento::inicialId());
});

it('deve recusar a execução quando a clínica não configurou o status, dizendo o caminho', function () {
    // ARRANGE — adivinhar um status aqui gastaria sessão de dezenas de pacotes
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    app(ConfiguracaoService::class)->set('agenda.status_desmarque_id', 0);
    agendamentoDoDesmarque($base, '2026-09-14 09:00');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'dia',
    ]);

    // ASSERT
    $resposta->assertStatus(422);
    expect($resposta->json('errors.status_id.0'))->toContain('Configurações');
});

it('deve criar um bloqueio por dia quando pedido, e nenhum quando não pedido', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    agendamentoDoDesmarque($base, '2026-09-14 14:00');
    agendamentoDoDesmarque($base, '2026-09-15 14:00');

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-15', 'periodo' => 'tarde',
        'bloquear' => true, 'motivo' => 'Congresso fictício',
    ])->assertOk();

    // ASSERT
    $bloqueios = Agendamento::where('tipo', 'bloqueio')->get();
    expect($bloqueios)->toHaveCount(2)
        ->and($bloqueios->first()->obs)->toBe('Congresso fictício');
});

it('deve desmarcar sem criar bloqueio quando não é pedido', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ])->assertOk();

    // ASSERT
    expect(Agendamento::where('tipo', 'bloqueio')->count())->toBe(0);
});

it('deve ESTORNAR a sessão consumida ao desmarcar — a criança não perde por imprevisto dele', function () {
    // ARRANGE — a guarda de consumo do domínio protege a EXCLUSÃO, não a mudança de status
    // (design D7). Recusar aqui deixaria a criança sem a sessão E sem o atendimento.
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    // o payload do helper traz convênio e serviço, que são obrigatórios no schema
    $tratamento = Tratamento::create([
        ...payloadDeTratamento(),
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'sessoes_total' => 20,
    ]);
    $tratamento->forceFill(['sessoes_realizadas' => 9])->save();
    $agendamento = agendamentoDoDesmarque($base, '2026-09-14 14:00', [
        'tratamento_id' => $tratamento->id,
    ]);
    // marcador de consumo é server-set (fora de `$fillable`)
    $agendamento->forceFill(['sessao_consumida_em' => '2026-09-14 14:00'])->save();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ]);

    // ASSERT — desmarcado E a sessão de volta no saldo
    $resposta->assertOk();
    expect($resposta->json('desmarcados'))->toBe(1)
        ->and($agendamento->refresh()->sessao_consumida_em)->toBeNull()
        ->and($tratamento->refresh()->sessoes_realizadas)->toBe(8);
});

it('deve recusar intervalo acima do teto de dias — a regra anterior era DECORATIVA', function () {
    // ARRANGE — `before_or_equal:62 days after de` NÃO existe em Laravel: `strtotime` devolve
    // `false` e a comparação passa. A guarda ia para o commit parecendo fechada, e o gate de
    // segurança provou 10 anos passando (1096 bloqueios em 3,12s, com o alcance em ZERO
    // agendamentos, porque o teto contava linhas de agenda e não os bloqueios).
    $adminDaClinica = admin();
    $base = baseDoDesmarque();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2027-01-01', 'ate' => '2029-12-31', 'periodo' => 'dia',
    ]);

    // ASSERT
    $resposta->assertStatus(422);
    expect($resposta->json('errors.ate.0'))->toContain('62 dias');
});

it('deve aceitar exatamente o teto de dias e recusar um dia além', function () {
    // ARRANGE — os dois lados da borda, senão a guarda pode estar recusando tudo.
    // O teto de LINHAS é subido de propósito: com o default (60) os 62 bloqueios de um
    // intervalo no limite já estouram o outro teto, e o teste mediria a guarda errada — os
    // dois se cruzam, e é bom que se cruzem.
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    app(ConfiguracaoService::class)->set('agenda.desmarque_em_lote_maximo', 200);
    $de = '2026-09-01';

    // ACT / ASSERT — 62 dias passa
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => $de, 'ate' => CarbonImmutable::parse($de)->addDays(62)->format('Y-m-d'),
        'periodo' => 'dia',
    ])->assertOk();

    // 63 recusa
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => $de, 'ate' => CarbonImmutable::parse($de)->addDays(63)->format('Y-m-d'),
        'periodo' => 'dia',
    ])->assertStatus(422);
});

it('deve contar os BLOQUEIOS no teto — a prévia tem de dizer o maior número que a operação grava', function () {
    // ARRANGE — sem isso o gate mediu a prévia dizendo "1 agendamento · 1 criança" enquanto a
    // operação escrevia 1206 linhas
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    app(ConfiguracaoService::class)->set('agenda.desmarque_em_lote_maximo', 5);
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT — 10 dias de intervalo = 10 bloqueios + 1 agendamento, acima do teto de 5
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-23', 'periodo' => 'tarde',
    ]);

    // ASSERT — a recusa nomeia as duas dimensões
    $resposta->assertStatus(422);
    expect($resposta->json('errors.ate.0'))->toContain('bloqueios');
});

it('deve devolver a contagem de bloqueios na prévia', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    agendamentoDoDesmarque($base, '2026-09-14 14:00');

    // ACT — 3 dias
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-16', 'periodo' => 'tarde',
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('contagens.bloqueios'))->toBe(3);
});

it('deve recusar profissional inexistente na escrita', function () {
    // ARRANGE — um bloqueio apontando para profissional inexistente seria linha órfã que não
    // aparece em coluna nenhuma da grade
    $adminDaClinica = admin();
    baseDoDesmarque();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => 99999999,
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
        'bloquear' => true,
    ]);

    // ASSERT — e nenhum bloqueio órfão nasceu
    $resposta->assertStatus(422);
    expect(Agendamento::where('tipo', 'bloqueio')->count())->toBe(0);
});

it('deve desmarcar E bloquear mesmo com um agendamento RECUSADO ocupando a janela', function () {
    // ARRANGE — o caso corriqueiro da clínica, e o que derrubava o lote inteiro: uma sessão já
    // atendida no meio da tarde. O recusado continua ocupando o horário (o status dele ocupa),
    // então o bloqueio conflitava e a transação revertia tudo. Bloqueio marca AUSÊNCIA, não
    // reserva slot — ele não precisa do horário livre.
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    $atendido = agendamentoDoDesmarque($base, '2026-09-14 14:00');
    $livre = agendamentoDoDesmarque($base, '2026-09-14 16:00');
    $atendimento = new Atendimento([
        'iniciado_em' => '2026-09-14 14:00',
        'finalizado_em' => '2026-09-14 14:40',
    ]);
    $atendimento->agendamento_id = $atendido->id;
    $atendimento->save();

    // ACT — com bloqueio, que é o default da tela
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
        'bloquear' => true, 'motivo' => 'Atestado fictício',
    ]);

    // ASSERT — o livre desmarcado, o atendido intacto, e o bloqueio NASCEU
    $resposta->assertOk();
    expect($resposta->json('desmarcados'))->toBe(1)
        ->and($atendido->refresh()->status_id)->toBe(StatusAgendamento::inicialId())
        ->and($livre->refresh()->status_id)->not->toBe(StatusAgendamento::inicialId())
        ->and(Agendamento::where('tipo', 'bloqueio')->count())->toBe(1);
});

it('deve poder REPETIR o gesto — a operação não pode se envenenar', function () {
    // ARRANGE — depois de criar o bloqueio, ele passava a ocupar a janela inteira e NENHUM card
    // dali podia mais ser editado: repetir o desmarque (atestado que se estende mais um dia)
    // falhava no primeiro `atualizar`, dizendo "Horário ocupado do profissional" — causada pelo
    // bloqueio que a própria recepcionista tinha acabado de criar.
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    agendamentoDoDesmarque($base, '2026-09-14 14:00');
    $payload = [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
        'bloquear' => true, 'motivo' => 'Atestado fictício',
    ];
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', $payload)->assertOk();
    $novo = agendamentoDoDesmarque($base, '2026-09-14 17:00');

    // ACT — o mesmo gesto, de novo
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', $payload);

    // ASSERT
    $resposta->assertOk();
    expect($novo->refresh()->status_id)->not->toBe(StatusAgendamento::inicialId());
});

it('deve CONTINUAR recusando agendamento NOVO sobre um bloqueio — é para isso que ele existe', function () {
    // ARRANGE — a guarda que NÃO pode ter sido afrouxada junto
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    Agendamento::create([
        'tipo' => 'bloqueio',
        'profissional_id' => $base['profissional_id'],
        'inicio' => '2026-09-14 14:00',
        'fim' => '2026-09-14 18:00',
        'obs' => 'Bloqueio fictício',
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base,
        'inicio' => '2026-09-14 15:00',
    ]);

    // ASSERT
    $resposta->assertStatus(422);
    // a frase passou a nomear a CAUSA (change atendimento-em-grupo, r1 do gate): "ocupado"
    // servia para lotação e para bloqueio, e mandava a recepção procurar sessões que não existem
    expect($resposta->json('errors.profissional_id.0'))->toContain('bloqueado');
});

it('deve recusar SÓ a linha que o domínio rejeita, e desmarcar as outras', function () {
    // ARRANGE — o beco que a execução real do gate encontrou: um lote de 6 recusado INTEIRO
    // por um único tratamento sem saldo, com a mensagem sem dizer qual, o botão continuando
    // "Desmarcar 6" e apertar de novo repetindo a mesma frase. A recusa de uma linha é
    // RESULTADO da operação, não falha dela.
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    $semSaldo = Tratamento::create([
        ...payloadDeTratamento(),
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'sessoes_total' => 1,
    ]);
    $semSaldo->forceFill(['sessoes_realizadas' => 1])->save();
    $problema = agendamentoDoDesmarque($base, '2026-09-14 14:00', ['tratamento_id' => $semSaldo->id]);
    $livre = agendamentoDoDesmarque($base, '2026-09-14 16:00');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
    ]);

    // ASSERT — 200, o livre desmarcado, e o problemático NOMEADO na lista de recusados
    $resposta->assertOk();
    expect($resposta->json('desmarcados'))->toBe(1)
        ->and($livre->refresh()->status_id)->not->toBe(StatusAgendamento::inicialId());
    $recusadosDoProblema = collect($resposta->json('recusados'))->firstWhere('id', $problema->id);
    expect($recusadosDoProblema)->not->toBeNull()
        ->and($recusadosDoProblema['motivo'])->not->toBe('');
});
