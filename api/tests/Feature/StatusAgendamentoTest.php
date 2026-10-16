<?php

use App\Models\Auditoria;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use App\Support\Agenda\StatusAgendamentoDefaults;

it('deve criar a clínica já com o conjunto default de status', function () {
    // ARRANGE + ACT — a clínica do teste nasce pelo TestCase, e o observer cria os defaults

    // ASSERT — Finalizado desconta; Falta Justificada não (spec status-agendamento)
    $statuses = StatusAgendamento::pluck('desconta_sessao', 'nome');

    expect($statuses)->toHaveCount(count(StatusAgendamentoDefaults::DEFAULTS))
        ->and($statuses['Finalizado'])->toBeTrue()
        ->and($statuses['Falta Justificada'])->toBeFalse();

    // agenda D2: só o desmarque nasce liberando o horário
    $ocupa = StatusAgendamento::pluck('ocupa_horario', 'nome');
    expect($ocupa['Desmarcado pelo Profissional'])->toBeFalse()
        ->and($ocupa['Finalizado'])->toBeTrue();
});

it('deve alterar a flag ocupa_horario e auditar o diff', function () {
    // ARRANGE — agenda D2: comportamento por status é dado
    $adminDaClinica = admin();
    $reserva = StatusAgendamento::where('nome', 'Reserva de Agenda')->firstOrFail();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/status-agendamento/{$reserva->id}", [
        'nome' => 'Reserva de Agenda',
        'cor' => $reserva->cor,
        'ocupa_horario' => false,
    ])->assertOk()->assertJsonPath('ocupa_horario', false);

    // ASSERT
    expect($reserva->fresh()->ocupa_horario)->toBeFalse();
    $registro = Auditoria::where('entidade', 'status_agendamento')
        ->where('entidade_id', $reserva->id)->where('acao', 'atualizou')->firstOrFail();
    expect($registro->diff_json['depois'])->toHaveKey('ocupa_horario');
});

it('deve criar status próprio da clínica', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/status-agendamento', [
        'nome' => 'Em Teleatendimento',
        'cor' => '#0EA5E9',
        'desconta_sessao' => true,
        'ordem' => 11,
    ]);

    // ASSERT
    $resposta->assertCreated()
        ->assertJsonPath('nome', 'Em Teleatendimento')
        ->assertJsonPath('desconta_sessao', true);
});

it('deve rejeitar nome de status duplicado na clínica', function () {
    // ARRANGE — "Finalizado" já existe (default da clínica)
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/status-agendamento', [
        'nome' => 'Finalizado', 'cor' => '#000000',
    ])->assertUnprocessable()->assertJsonValidationErrors('nome');
});

it('deve alterar a flag desconta_sessao e auditar o diff', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $faltaJustificada = StatusAgendamento::where('nome', 'Falta Justificada')->firstOrFail();

    // ACT — a clínica decide que falta justificada passa a descontar
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/status-agendamento/{$faltaJustificada->id}", [
        'nome' => 'Falta Justificada',
        'cor' => $faltaJustificada->cor,
        'desconta_sessao' => true,
    ])->assertOk()->assertJsonPath('desconta_sessao', true);

    // ASSERT — flag persiste e o diff está na auditoria
    expect($faltaJustificada->fresh()->desconta_sessao)->toBeTrue();
    $registro = Auditoria::where('entidade', 'status_agendamento')
        ->where('entidade_id', $faltaJustificada->id)
        ->where('acao', 'atualizou')
        ->firstOrFail();
    expect((bool) $registro->diff_json['antes']['desconta_sessao'])->toBeFalse()
        ->and((bool) $registro->diff_json['depois']['desconta_sessao'])->toBeTrue();
});

it('deve rejeitar cor fora do formato hex', function () {
    // ARRANGE — abuse case 11 (cor como vetor de injeção)
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/status-agendamento', [
        'nome' => 'Injetado', 'cor' => 'red;background:url(x)',
    ])->assertUnprocessable()->assertJsonValidationErrors('cor');
});

it('deve responder 403 sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/status-agendamento')->assertForbidden();
});
