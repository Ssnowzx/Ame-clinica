<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\RegraLimiteConvenio;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;

/**
 * Cenário-base da guarda: especialidade+profissional+paciente (baseDeAgenda) +
 * convênio próprio + tratamento EM ANDAMENTO com saldo folgado (o saldo nunca
 * interfere nos cenários de limite). Devolve [payload-base, convênio, tratamento].
 */
function cenarioDeLimite(array $convenioExtras = [], array $tratamentoExtras = []): array
{
    $base = baseDeAgenda();
    $convenio = Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        ...$convenioExtras,
    ]);
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'convenio_id' => $convenio->id,
        'especialidade_id' => $base['especialidade_id'],
        'profissional_id' => $base['profissional_id'],
        'sessoes_total' => 100,
        ...$tratamentoExtras,
    ]);

    return [[...$base, 'tratamento_id' => $tratamento->id], $convenio, $tratamento];
}

/** Regra de limite direto no banco (o CRUD tem teste próprio). */
function novaRegraDeLimite(Convenio $convenio, string $periodo, int $limite, string $acao, ?int $especialidadeId = null): RegraLimiteConvenio
{
    $regra = new RegraLimiteConvenio([
        'especialidade_id' => $especialidadeId,
        'periodo' => $periodo,
        'limite' => $limite,
        'acao' => $acao,
    ]);
    $regra->convenio_id = $convenio->id;
    $regra->save();

    return $regra;
}

it('deve bloquear o excedente com 422 mínimo: só limite, período e nome do convênio', function () {
    // ARRANGE — regra "1 por dia · bloquear"
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'dia', 1, 'bloquear');
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');

    $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 08:00"])
        ->assertCreated();

    // ACT — o 2º do dia excede
    $recusa = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 10:00"]);

    // ASSERT — chave própria; mensagem com limite+período+nome e NADA além
    // (SEC-LP-01: chaves presentes E ausentes)
    $recusa->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
    $mensagem = $recusa->json('errors.limite_convenio.0');
    expect($mensagem)->toContain($convenio->nome)->toContain('1')->toContain('dia')
        ->and(array_keys($recusa->json('errors')))->toBe(['limite_convenio']);
    $nomeDoPaciente = Paciente::findOrFail($payload['paciente_id'])->nome;
    semVazamento($recusa->json(), $nomeDoPaciente);
    expect(Agendamento::count())->toBe(1);
});

it('deve aceitar com aviso quando a regra é avisar — e nada persiste do aviso', function () {
    // ARRANGE — cenário da spec: "psicologia · 4/mês · avisar" (aqui 1/mês p/ encurtar)
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'mes', 1, 'avisar');
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');

    // ACT + ASSERT — 1º dentro do limite: sem chave de alerta
    $primeiro = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 08:00"]);
    $primeiro->assertCreated();
    expect($primeiro->json())->not->toHaveKey('alerta_limite');

    // 2º no mesmo mês: aceito COM aviso na resposta da escrita (D3)
    $segundo = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 10:00"]);
    $segundo->assertCreated();
    expect($segundo->json('alerta_limite'))->toEqual([
        'convenio' => $convenio->nome, 'periodo' => 'mes', 'limite' => 1,
    ]);
    expect(Agendamento::count())->toBe(2);
});

it('deve contar pela flag ocupa_horario do status, nunca pelo nome', function () {
    // ARRANGE — SEC-LP-09: um status de nome qualquer com ocupa=false fica FORA;
    // outro nome qualquer com ocupa=true CONTA. A flag decide, o nome não.
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'dia', 1, 'bloquear');
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');
    $naoOcupa = StatusAgendamento::create([
        'nome' => 'Compareceu Fictício', 'cor' => '#112233', 'ordem' => 90,
        'desconta_sessao' => false, 'ocupa_horario' => false,
    ]);

    // ACT + ASSERT — sessão em status que NÃO ocupa não consome a janela
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => "{$dia} 08:00", 'status_id' => $naoOcupa->id,
    ])->assertCreated();
    $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 10:00"])
        ->assertCreated(); // a ocupante entra normalmente

    // agora a janela está cheia (1 ocupante): a 3ª ocupante é recusada
    $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 12:00"])
        ->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');

    // e um candidato cujo status final NÃO ocupa passa mesmo com a janela cheia
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => "{$dia} 14:00", 'status_id' => $naoOcupa->id,
    ])->assertCreated();
});

it('deve remarcar dentro da janela sem contar o próprio agendamento', function () {
    // ARRANGE — regra 1/dia: remarcar a ÚNICA sessão do dia não pode ser recusada
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'dia', 1, 'bloquear');
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');
    $criado = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 08:00"]);
    $criado->assertCreated();

    // ACT + ASSERT — remarcação no MESMO dia (não conta contra si — D2)
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/agendamentos/'.$criado->json('id'), [
        ...$payload, 'inicio' => "{$dia} 11:00",
    ])->assertOk();

    // PUT parcial (mesmo horário, só o status) também passa — estado final decide
    $outroOcupante = StatusAgendamento::where('nome', 'Confirmado')->first()
        ?? StatusAgendamento::create([
            'nome' => 'Ocupante Fictício', 'cor' => '#445566', 'ordem' => 91,
            'desconta_sessao' => false, 'ocupa_horario' => true,
        ]);
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/agendamentos/'.$criado->json('id'), [
        ...$payload, 'inicio' => "{$dia} 11:00", 'status_id' => $outroOcupante->id,
    ])->assertOk();
});

it('deve deixar fora da contagem as sessões de outro convênio (particular)', function () {
    // ARRANGE — cenário da spec: sessões particulares no mesmo dia não contam
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'dia', 1, 'bloquear');
    $particular = Convenio::create(['nome' => 'Particular Fictício', 'particular' => true]);
    $tratamentoParticular = Tratamento::factory()->create([
        'paciente_id' => $payload['paciente_id'],
        'convenio_id' => $particular->id,
        'especialidade_id' => $payload['especialidade_id'],
        'profissional_id' => $payload['profissional_id'],
        'sessoes_total' => 100,
    ]);
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');

    // ACT + ASSERT — particular primeiro; o convênio com regra ainda cabe
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'tratamento_id' => $tratamentoParticular->id, 'inicio' => "{$dia} 08:00",
    ])->assertCreated();
    $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 09:30"])
        ->assertCreated();

    // a 2ª DO CONVÊNIO excede; uma 2ª particular não (sem regra no particular — fail-safe)
    $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 11:00"])
        ->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'tratamento_id' => $tratamentoParticular->id, 'inicio' => "{$dia} 12:30",
    ])->assertCreated();
});

it('deve aplicar a regra específica da especialidade por cima da regra "todas"', function () {
    // ARRANGE — Unimed real: "todas · 1/dia" + "ABA · 8/dia" (a mais específica aplica)
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'dia', 1, 'bloquear');                                  // todas
    novaRegraDeLimite($convenio, 'dia', 8, 'bloquear', $payload['especialidade_id']);    // específica
    $fono = Especialidade::factory()->create(['tempo_sessao' => 40]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $payload['profissional_id'],
        'especialidade_id' => $fono->id,
    ]);
    $tratamentoFono = Tratamento::factory()->create([
        'paciente_id' => $payload['paciente_id'],
        'convenio_id' => $convenio->id,
        'especialidade_id' => $fono->id,
        'profissional_id' => $payload['profissional_id'],
        'sessoes_total' => 100,
    ]);
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');

    // ACT + ASSERT — 2 sessões da especialidade COM regra específica passam (8/dia)
    $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 08:00"])
        ->assertCreated();
    $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 09:00"])
        ->assertCreated();

    // na OUTRA especialidade vale a "todas" (1/dia): 1ª passa, 2ª recusa
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'especialidade_id' => $fono->id, 'tratamento_id' => $tratamentoFono->id,
        'inicio' => "{$dia} 10:00",
    ])->assertCreated();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'especialidade_id' => $fono->id, 'tratamento_id' => $tratamentoFono->id,
        'inicio' => "{$dia} 11:00",
    ])->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
});

it('deve valer regras de PERÍODOS diferentes juntas — o mês barra com o dia folgado', function () {
    // ARRANGE — o cenário órfão (I5): a resolução específica-vence-"todas" acontece
    // DENTRO de cada período, nunca entre períodos. "ABA · 8/dia" (específica) e
    // "todas · 4/mês" coexistem: a específica não desliga a mensal.
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'dia', 8, 'bloquear', $payload['especialidade_id']); // específica
    novaRegraDeLimite($convenio, 'mes', 4, 'bloquear');                               // todas
    // tudo no MESMO dia de propósito: o teto diário (8) fica visivelmente folgado
    $dia = agoraNaClinica()->addMonths(2)->startOfMonth()->format('Y-m-d');

    // ACT + ASSERT — 4 passam (dia 4<8, mês 4=4 só na 5ª)
    foreach (['08:00', '09:00', '10:00', '11:00'] as $hora) {
        $this->actingAs($adminDaClinica)
            ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} {$hora}"])
            ->assertCreated();
    }

    // a 5ª é recusada pela regra MENSAL, com o dia ainda em 4 de 8
    $recusa = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 14:00"]);
    $recusa->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
    expect($recusa->json('errors.limite_convenio.0'))->toContain('mês')->toContain('4');
    expect(Agendamento::count())->toBe(4);
});

it('deve seguir como hoje quando o convênio não tem regra (fail-safe)', function () {
    // ARRANGE — SEC-LP-11
    $adminDaClinica = admin();
    [$payload] = cenarioDeLimite();
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');

    // ACT + ASSERT — 3 no mesmo dia, nada muda
    foreach (['08:00', '09:00', '10:00'] as $hora) {
        $resposta = $this->actingAs($adminDaClinica)
            ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} {$hora}"]);
        $resposta->assertCreated();
        expect($resposta->json())->not->toHaveKey('alerta_limite');
    }
});

it('deve fazer o override do pedido vencer a regra semanal do convênio', function () {
    // ARRANGE — cenário da spec: regra semanal 2, pedido de 3/semana →
    // a 3ª da semana é aceita e a 4ª cai na ação da regra
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite([], [
        'pedido_emitido_em' => agoraNaClinica()->subDays(10)->format('Y-m-d'),
        'pedido_sessoes_por_semana' => 3,
    ]);
    novaRegraDeLimite($convenio, 'semana', 2, 'bloquear');
    $segunda = agoraNaClinica()->addWeeks(2)->startOfWeek(CarbonInterface::MONDAY);

    // ACT + ASSERT
    foreach ([0, 1, 2] as $diasDepois) {
        $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
            ...$payload, 'inicio' => $segunda->copy()->addDays($diasDepois)->format('Y-m-d').' 09:00',
        ])->assertCreated();
    }
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $segunda->copy()->addDays(3)->format('Y-m-d').' 09:00',
    ])->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
});

it('deve fazer o override do pedido vencer a regra semanal ESPECÍFICA da especialidade', function () {
    // ARRANGE — SEC-LP-12 recalibrado (I3): o override vence a regra semanal APLICÁVEL,
    // não só a "todas". O pedido médico é prescrição DAQUELE caso naquela especialidade —
    // se parasse na regra específica, a especialidade que a clínica configurou com cuidado
    // seria a única onde o pedido do médico não valeria.
    // Cenário: "todas · 4/semana" + "ABA · 1/semana · bloquear" (a específica vence a
    // "todas") + pedido de 3/semana → é a ESPECÍFICA que afrouxa, de 1 para 3.
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite([], [
        'pedido_emitido_em' => agoraNaClinica()->subDays(10)->format('Y-m-d'),
        'pedido_sessoes_por_semana' => 3,
    ]);
    novaRegraDeLimite($convenio, 'semana', 4, 'bloquear');                                 // todas
    novaRegraDeLimite($convenio, 'semana', 1, 'bloquear', $payload['especialidade_id']);   // específica
    $segunda = agoraNaClinica()->addWeeks(2)->startOfWeek(CarbonInterface::MONDAY);

    // ACT + ASSERT — 3 na semana (a específica sozinha barraria já na 2ª)
    foreach ([0, 1, 2] as $diasDepois) {
        $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
            ...$payload, 'inicio' => $segunda->copy()->addDays($diasDepois)->format('Y-m-d').' 09:00',
        ])->assertCreated();
    }

    // a 4ª cai no teto do PEDIDO (3), com a AÇÃO da regra específica — o override
    // troca o número, nunca a ação
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $segunda->copy()->addDays(3)->format('Y-m-d').' 09:00',
    ])->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
    expect(Agendamento::count())->toBe(3);
});

it('deve ignorar o override sem a emissão do pedido (cerca do override)', function () {
    // ARRANGE — SEC-LP-12: `tratamentos.editar` não fura a política de
    // `convenios.editar` gravando só o número semanal
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite([], [
        'pedido_emitido_em' => null,
        'pedido_sessoes_por_semana' => 3, // órfão: SEM efeito
    ]);
    novaRegraDeLimite($convenio, 'semana', 2, 'bloquear');
    $segunda = agoraNaClinica()->addWeeks(2)->startOfWeek(CarbonInterface::MONDAY);

    // ACT + ASSERT — vale a regra do convênio (2/semana)
    foreach ([0, 1] as $diasDepois) {
        $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
            ...$payload, 'inicio' => $segunda->copy()->addDays($diasDepois)->format('Y-m-d').' 09:00',
        ])->assertCreated();
    }
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $segunda->copy()->addDays(2)->format('Y-m-d').' 09:00',
    ])->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
});

it('deve manter o override quando o pedido está vencido (alerta, não bloqueio)', function () {
    // ARRANGE — SEC-LP-12, decisão default registrada: pedido vencido MANTÉM o
    // override — a clínica pediu ALERTA para pedido, não bloqueio de agenda
    $adminDaClinica = admin();
    [$payload, $convenio, $tratamento] = cenarioDeLimite(
        ['pedido_validade_meses' => 6],
        [
            'pedido_emitido_em' => agoraNaClinica()->subMonths(8)->format('Y-m-d'), // vencido
            'pedido_sessoes_por_semana' => 3,
        ],
    );
    expect($tratamento->fresh()->pedidoVencido())->toBeTrue();
    novaRegraDeLimite($convenio, 'semana', 2, 'bloquear');
    $segunda = agoraNaClinica()->addWeeks(2)->startOfWeek(CarbonInterface::MONDAY);

    // ACT + ASSERT — o override (3/semana) continua valendo
    foreach ([0, 1, 2] as $diasDepois) {
        $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
            ...$payload, 'inicio' => $segunda->copy()->addDays($diasDepois)->format('Y-m-d').' 09:00',
        ])->assertCreated();
    }
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $segunda->copy()->addDays(3)->format('Y-m-d').' 09:00',
    ])->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
});

it('deve herdar a guarda no encaixe da lista de espera — recusado, o paciente segue na fila', function () {
    // ARRANGE — cenário da spec: encaixe que excederia regra `bloquear` é recusado
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'dia', 1, 'bloquear');
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');
    $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 08:00"])
        ->assertCreated();
    $entrada = $this->actingAs($adminDaClinica)->postJson('/api/lista-espera', [
        'paciente_id' => $payload['paciente_id'],
        'especialidade_id' => $payload['especialidade_id'],
        'profissional_id' => $payload['profissional_id'],
    ]);
    $entrada->assertCreated();

    // ACT — encaixar no MESMO dia excede a regra
    $encaixe = $this->actingAs($adminDaClinica)
        ->postJson('/api/lista-espera/'.$entrada->json('id').'/encaixar', [
            'inicio' => "{$dia} 10:00",
            'profissional_id' => $payload['profissional_id'],
            'especialidade_id' => $payload['especialidade_id'],
            'tratamento_id' => $payload['tratamento_id'],
        ]);

    // ASSERT — 422 pela MESMA guarda; transação desfeita: a entrada CONTINUA na fila
    $encaixe->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
    expect(Agendamento::count())->toBe(1);
    expect($this->getJson('/api/lista-espera')->json())->toHaveCount(1);
});

it('deve carregar o aviso de limite também na resposta do encaixe (regra avisar)', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'dia', 1, 'avisar');
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');
    $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 08:00"])
        ->assertCreated();
    $entrada = $this->actingAs($adminDaClinica)->postJson('/api/lista-espera', [
        'paciente_id' => $payload['paciente_id'],
        'especialidade_id' => $payload['especialidade_id'],
    ]);
    $entrada->assertCreated();

    // ACT
    $encaixe = $this->actingAs($adminDaClinica)
        ->postJson('/api/lista-espera/'.$entrada->json('id').'/encaixar', [
            'inicio' => "{$dia} 10:00",
            'profissional_id' => $payload['profissional_id'],
            'especialidade_id' => $payload['especialidade_id'],
            'tratamento_id' => $payload['tratamento_id'],
        ]);

    // ASSERT — aceito com aviso; a entrada saiu da fila
    $encaixe->assertCreated();
    expect($encaixe->json('alerta_limite'))->toEqual([
        'convenio' => $convenio->nome, 'periodo' => 'dia', 'limite' => 1,
    ]);
    expect($this->getJson('/api/lista-espera')->json())->toHaveCount(0);
});

/** Primeiro dia de um mês FUTURO com 29+ dias (5 ocorrências semanais do mesmo weekday). */
function primeiroDiaDeMesComCincoSemanas(): Carbon\Carbon
{
    $primeiro = agoraNaClinica()->addMonths(2)->startOfMonth()->setTime(9, 0);
    if ($primeiro->month === 2) {
        $primeiro->addMonth(); // fevereiro pode ter só 4 ocorrências do weekday
    }

    return $primeiro;
}

it('deve recusar a série inteira quando uma irmã excede a regra mensal — nada é criado', function () {
    // ARRANGE — SEC-LP-10: 4/mês × série semanal de 5 no MESMO mês; a contagem
    // por-irmã enxerga as irmãs da mesma transação (o banco ainda não as tem)
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'mes', 4, 'bloquear');
    $primeiro = primeiroDiaDeMesComCincoSemanas(); // dias 1, 8, 15, 22, 29 do mesmo mês

    // ACT
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $primeiro->format('Y-m-d H:i'),
        'recorrencia' => ['ate' => $primeiro->copy()->addDays(28)->format('Y-m-d')],
    ]);

    // ASSERT — 422 e NADA criado (tudo-ou-nada)
    $serie->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
    expect(Agendamento::count())->toBe(0);
});

it('deve criar a série com aviso quando a regra mensal excedida é avisar', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'mes', 4, 'avisar');
    $primeiro = primeiroDiaDeMesComCincoSemanas();

    // ACT
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $primeiro->format('Y-m-d H:i'),
        'recorrencia' => ['ate' => $primeiro->copy()->addDays(28)->format('Y-m-d')],
    ]);

    // ASSERT — 5 criadas, aviso na resposta
    $serie->assertCreated()->assertJsonPath('criados', 5);
    expect($serie->json('alerta_limite'))->toEqual([
        'convenio' => $convenio->nome, 'periodo' => 'mes', 'limite' => 4,
    ]);
});

it('deve aplicar a guarda por-irmã no aplicar-na-série: delta que empilha irmã num dia cheio', function () {
    // ARRANGE — série de 3 segundas (sem regra ainda) + sessão avulsa na terça da 2ª
    // semana; a regra 1/dia entra DEPOIS; o delta de +1 dia empurraria a irmã da 2ª
    // semana para o dia da avulsa (SEC-LP-10 — o teste do parecer)
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    $primeiro = primeiroDiaDeMesComCincoSemanas();
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $primeiro->format('Y-m-d H:i'),
        'recorrencia' => ['ate' => $primeiro->copy()->addDays(14)->format('Y-m-d')],
    ]);
    $serie->assertCreated()->assertJsonPath('criados', 3);
    $clicadaId = $serie->json('agendamentos.0.id');
    // avulsa no dia seguinte à 2ª irmã, em HORÁRIO diferente (sem conflito de agenda)
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $primeiro->copy()->addDays(8)->format('Y-m-d').' 14:00',
    ])->assertCreated();
    novaRegraDeLimite($convenio, 'dia', 1, 'bloquear');

    // ACT — aplicar na série deslocando tudo +1 dia
    $mover = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$clicadaId}", [
        ...$payload,
        'inicio' => $primeiro->copy()->addDay()->format('Y-m-d H:i'),
        'aplicar_na_serie' => true,
    ]);

    // ASSERT — 422 pela irmã empilhada; transação desfeita: a clicada não se moveu
    $mover->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
    expect(Agendamento::findOrFail($clicadaId)->inicio->format('Y-m-d H:i'))
        ->toBe($primeiro->format('Y-m-d H:i'));
});

// ══════════ REGRESSÃO SEC-LP-10-01: `avisar` não pode desligar a guarda ══════════
// O `??=` de PHP NÃO avalia o lado direito quando o esquerdo já tem valor: memorizar
// o aviso na mesma expressão que avaliava a guarda fazia a primeira regra `avisar`
// desligar a checagem das irmãs SEGUINTES — inclusive contra regras `bloquear`.
// Os dois testes abaixo exercem o cenário misto que faltava (achado do gate).

it('deve barrar a irmã que excede o bloquear mesmo depois de um avisar ter disparado', function () {
    // ARRANGE — MESMO convênio com as duas ações: semana 1/avisar (dispara já na 1ª
    // irmã) e mês 4/bloquear (só a 5ª estoura). É a grade real da clínica (SC Saúde
    // tem regra semanal E mensal) e o go-live manda semear misto.
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    $primeiro = primeiroDiaDeMesComCincoSemanas();
    // avulsa na MESMA semana da 1ª irmã: é ela que faz o `avisar` semanal disparar
    // JÁ na primeira avaliação — sem isso o aviso nunca precede o bloqueio e o
    // teste não exerce o curto-circuito (erodido para provar).
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $primeiro->copy()->addDay()->format('Y-m-d').' 14:00',
    ])->assertCreated();
    novaRegraDeLimite($convenio, 'semana', 1, 'avisar');
    novaRegraDeLimite($convenio, 'mes', 4, 'bloquear');

    // ACT — série semanal de 5 no mesmo mês
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $primeiro->format('Y-m-d H:i'),
        'recorrencia' => ['ate' => $primeiro->copy()->addDays(28)->format('Y-m-d')],
    ]);

    // ASSERT — o aviso da semana NÃO pode ter engolido o bloqueio do mês
    $serie->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
    expect(Agendamento::count())->toBe(1); // só a avulsa do arrange
});

it('deve barrar no aplicar-na-série mesmo depois de um avisar ter disparado', function () {
    // ARRANGE — série de 3 + avulsa no dia seguinte à 2ª irmã; regras entram DEPOIS:
    // semana 1/avisar (dispara na 1ª irmã do delta) e dia 1/bloquear (a irmã empilhada)
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    $primeiro = primeiroDiaDeMesComCincoSemanas();
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $primeiro->format('Y-m-d H:i'),
        'recorrencia' => ['ate' => $primeiro->copy()->addDays(14)->format('Y-m-d')],
    ]);
    $serie->assertCreated()->assertJsonPath('criados', 3);
    $clicadaId = $serie->json('agendamentos.0.id');
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $primeiro->copy()->addDays(8)->format('Y-m-d').' 14:00',
    ])->assertCreated();
    novaRegraDeLimite($convenio, 'semana', 1, 'avisar');
    novaRegraDeLimite($convenio, 'dia', 1, 'bloquear');

    // ACT — deslocar a série +1 dia
    $mover = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$clicadaId}", [
        ...$payload,
        'inicio' => $primeiro->copy()->addDay()->format('Y-m-d H:i'),
        'aplicar_na_serie' => true,
    ]);

    // ASSERT — 422 pela irmã empilhada; a clicada não se moveu
    $mover->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
    expect(Agendamento::findOrFail($clicadaId)->inicio->format('Y-m-d H:i'))
        ->toBe($primeiro->format('Y-m-d H:i'));
});

it('deve manter dia e mês em pé quando o override do pedido afrouxa a semana', function () {
    // ARRANGE — SEC-LP-12 (3º recorte, sem teste até aqui): o override do pedido
    // substitui SÓ o número da regra `semana`; regras de dia/mês seguem valendo
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDeLimite();
    novaRegraDeLimite($convenio, 'semana', 1, 'bloquear');
    novaRegraDeLimite($convenio, 'dia', 1, 'bloquear');
    Tratamento::whereKey($payload['tratamento_id'])->update([
        'pedido_emitido_em' => agoraNaClinica()->subDays(10)->format('Y-m-d'),
        'pedido_sessoes_por_semana' => 5, // afrouxa a SEMANA de 1 para 5
    ]);
    $dia = agoraNaClinica()->addMonths(2)->startOfMonth()->setTime(9, 0);

    // ACT — 2ª sessão na MESMA semana (override permite) e 2ª no MESMO dia (não)
    $outroDia = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $dia->format('Y-m-d H:i'),
    ]);
    $mesmaSemana = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $dia->copy()->addDay()->format('Y-m-d H:i'),
    ]);
    $mesmoDia = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $dia->copy()->addDay()->format('Y-m-d').' 15:00',
    ]);

    // ASSERT — a semana afrouxou, o DIA continua barrando
    $outroDia->assertCreated();
    $mesmaSemana->assertCreated();
    $mesmoDia->assertUnprocessable()->assertJsonValidationErrors('limite_convenio');
});
