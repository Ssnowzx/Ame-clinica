<?php

use App\Models\Convenio;
use App\Models\RegraLimiteConvenio;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use Carbon\Carbon;

// mesma âncora segura do bloco de pedidos (aritmética de meses, dia 10)
beforeEach(fn () => Carbon::setTestNow(Carbon::parse('2026-06-10 12:00:00', 'America/Sao_Paulo')));
afterEach(fn () => Carbon::setTestNow());

/** Payload-base + convênio (validade 6 meses) + tratamento em andamento do paciente. */
function cenarioDePainel(array $tratamentoExtras = []): array
{
    $base = baseDeAgenda();
    $convenio = Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        'pedido_validade_meses' => 6,
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

it('deve destacar no painel o pedido vencido do tratamento do agendamento', function () {
    // ARRANGE — pedido emitido há 8 meses (validade 6) → vencido
    $adminDaClinica = admin();
    [$payload] = cenarioDePainel([
        'pedido_emitido_em' => agoraNaClinica()->subMonthsNoOverflow(8)->format('Y-m-d'),
    ]);
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);
    $criado->assertCreated();

    // ACT + ASSERT — sinal decidido no SERVIDOR, sob demanda no detalhe
    $painel = $this->getJson('/api/agendamentos/'.$criado->json('id'));
    $painel->assertOk();
    expect($painel->json('alerta_pedido'))->toEqual(['vencido' => true, 'vence_em_dias' => null]);
});

it('deve destacar o pedido prestes a vencer com os dias restantes', function () {
    // ARRANGE — vence em 30 dias (antecedência default 60)
    $adminDaClinica = admin();
    [$payload] = cenarioDePainel([
        // emitido 10/01 + 6 meses = vence 10/07 — 30 dias após o hoje ancorado (10/06)
        'pedido_emitido_em' => '2026-01-10',
    ]);
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);
    $criado->assertCreated();

    // ACT + ASSERT
    expect($this->getJson('/api/agendamentos/'.$criado->json('id'))->json('alerta_pedido'))
        ->toEqual(['vencido' => false, 'vence_em_dias' => 30]);
});

it('deve silenciar o alerta de pedido fora da antecedência, sem pedido e em bloqueio', function () {
    // ARRANGE
    $adminDaClinica = admin();
    // vence em ~100 dias (fora da antecedência 60)
    [$payloadLonge] = cenarioDePainel(['pedido_emitido_em' => '2026-03-18']);
    // sem pedido registrado
    [$payloadSemPedido] = cenarioDePainel([]);

    $longe = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payloadLonge);
    $longe->assertCreated();
    $semPedido = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payloadSemPedido, 'inicio' => agoraNaClinica()->addDays(2)->format('Y-m-d').' 11:00',
    ]);
    $semPedido->assertCreated();
    $bloqueio = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'profissional_id' => $payloadSemPedido['profissional_id'],
        'inicio' => agoraNaClinica()->addDays(2)->format('Y-m-d').' 13:00',
        'duracao_minutos' => 60,
    ]);
    $bloqueio->assertCreated();

    // ACT + ASSERT — a chave existe e é nula nos três
    foreach ([$longe, $semPedido, $bloqueio] as $resposta) {
        $painel = $this->getJson('/api/agendamentos/'.$resposta->json('id'));
        $painel->assertOk();
        expect($painel->json('alerta_pedido'))->toBeNull();
    }
});

it('deve destacar no painel o limite atingido de regra avisar — derivado a cada leitura', function () {
    // ARRANGE — regra "1/dia · avisar"; duas sessões no mesmo dia
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDePainel();
    $regra = new RegraLimiteConvenio(['periodo' => 'dia', 'limite' => 1, 'acao' => 'avisar']);
    $regra->convenio_id = $convenio->id;
    $regra->save();
    $dia = agoraNaClinica()->addDays(3)->format('Y-m-d');
    $primeira = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 08:00"]);
    $primeira->assertCreated();
    $segunda = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos', [...$payload, 'inicio' => "{$dia} 10:00"]);
    $segunda->assertCreated();

    // ACT + ASSERT — o painel da excedente sinaliza {convenio, periodo, limite}
    expect($this->getJson('/api/agendamentos/'.$segunda->json('id'))->json('alerta_limite'))
        ->toEqual(['convenio' => $convenio->nome, 'periodo' => 'dia', 'limite' => 1]);

    // DERIVADO, nunca persistido: desmarcada a 1ª (não ocupa mais), o sinal some
    $desmarcado = StatusAgendamento::where('ocupa_horario', false)->firstOrFail();
    $this->putJsonComVersao('/api/agendamentos/'.$primeira->json('id'), [
        ...$payload, 'inicio' => "{$dia} 08:00", 'status_id' => $desmarcado->id,
    ])->assertOk();
    expect($this->getJson('/api/agendamentos/'.$segunda->json('id'))->json('alerta_limite'))
        ->toBeNull();
});

it('deve manter o card da grade sem os alertas — chave nenhuma nova no periodo', function () {
    // ARRANGE — SEC-LP-03: painel sob demanda, grade limpa (molde SEC-NC-02)
    $adminDaClinica = admin();
    [$payload, $convenio] = cenarioDePainel([
        'pedido_emitido_em' => agoraNaClinica()->subMonthsNoOverflow(8)->format('Y-m-d'), // vencido
    ]);
    $regra = new RegraLimiteConvenio(['periodo' => 'dia', 'limite' => 1, 'acao' => 'avisar']);
    $regra->convenio_id = $convenio->id;
    $regra->save();
    $dia = agoraNaClinica()->addDays(3);
    foreach (['08:00', '10:00'] as $hora) {
        $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
            ...$payload, 'inicio' => $dia->format('Y-m-d')." {$hora}",
        ])->assertCreated();
    }

    // ACT — a grade do período que contém os dois cards
    $grade = $this->getJson('/api/agenda?de='.$dia->format('Y-m-d').'&ate='.$dia->format('Y-m-d'));

    // ASSERT — nenhum card carrega os alertas (nem o dado do pedido)
    $grade->assertOk();
    expect($grade->json())->toHaveCount(2);
    foreach ($grade->json() as $card) {
        expect($card)->not->toHaveKey('alerta_pedido')
            ->not->toHaveKey('alerta_limite')
            ->not->toHaveKey('pedido_vence_em');
    }
});
