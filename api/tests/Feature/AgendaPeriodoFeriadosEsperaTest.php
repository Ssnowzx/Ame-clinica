<?php

use App\Models\Feriado;
use App\Models\ListaEspera;
use App\Models\Paciente;

it('deve retornar o período com payload mínimo do card', function () {
    // ARRANGE — abuse case 2 (T-agd-01): nunca despejar o cadastro do menor
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    Paciente::findOrFail($payload['paciente_id'])
        ->update(['cpf' => '52998224725']);
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'obs' => 'Anotação sigilosa',
    ])->assertCreated();

    $de = now()->addDay()->toDateString();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson("/api/agenda?de={$de}&ate={$de}");

    // ASSERT — card com identificação mínima; sem cpf/responsáveis/obs de atendimento
    $resposta->assertOk();
    $cartao = $resposta->json('0');
    expect($cartao['paciente'])->toHaveKeys(['id', 'nome'])
        ->and($cartao)->not->toHaveKey('obs')
        ->and($resposta->getContent())->not->toContain('52998224725')
        ->not->toContain('responsaveis_json')
        ->not->toContain('sigilosa');
    expect($cartao['especialidade'])->toHaveKey('cor')
        ->and($cartao['status'])->toHaveKey('nome');
});

it('deve responder a grade cheia de um dia com vinte profissionais', function () {
    // ARRANGE — piso de performance §16 (smoke: 20 profissionais × dia)
    $adminDaClinica = admin();
    $dia = now()->addDay()->format('Y-m-d');
    foreach (range(1, 20) as $hora) {
        $payload = baseDeAgenda();
        $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
            ...$payload,
            'inicio' => "{$dia} ".str_pad((string) (7 + ($hora % 12)), 2, '0', STR_PAD_LEFT).':00',
        ])->assertCreated();
    }

    // ACT
    $inicioConsulta = microtime(true);
    $resposta = $this->actingAs($adminDaClinica)->getJson("/api/agenda?de={$dia}&ate={$dia}");
    $duracaoMs = (microtime(true) - $inicioConsulta) * 1000;

    // ASSERT — 20 cards com dados completos, em tempo aceitável para a grade
    $resposta->assertOk()->assertJsonCount(20);
    expect($duracaoMs)->toBeLessThan(1500.0);
});

it('deve validar a janela do período', function () {
    // ARRANGE — abuse case 3
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->getJson('/api/agenda?de=2026-01-01&ate=2026-03-10')
        ->assertUnprocessable();
    $this->actingAs($adminDaClinica)
        ->getJson('/api/agenda?de=2026-02-01&ate=2026-01-01')
        ->assertUnprocessable();
    $this->actingAs($adminDaClinica)->getJson('/api/agenda')->assertUnprocessable();
});

it('deve gerenciar feriados com unicidade por data', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — criar, duplicar, atualizar, excluir
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/feriados', [
        'nome' => 'Dia das Crianças', 'data' => '2026-10-12', 'recorrente' => true,
    ]);
    $criar->assertCreated()->assertJsonPath('recorrente', true);

    $this->actingAs($adminDaClinica)->postJson('/api/feriados', [
        'nome' => 'Dia das Crianças', 'data' => '2026-10-12',
    ])->assertUnprocessable()->assertJsonValidationErrors('nome');

    $this->actingAs($adminDaClinica)->deleteJson("/api/feriados/{$criar->json('id')}")
        ->assertNoContent();
    expect(Feriado::count())->toBe(0);
});

it('deve ordenar a lista de espera por prioridade e chegada', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $normal = $this->actingAs($adminDaClinica)->postJson('/api/lista-espera', [
        'paciente_id' => Paciente::factory()->create()->id,
        'prioridade' => 0,
    ]);
    $normal->assertCreated();
    $alta = $this->actingAs($adminDaClinica)->postJson('/api/lista-espera', [
        'paciente_id' => Paciente::factory()->create()->id,
        'prioridade' => 5,
    ]);
    $alta->assertCreated();

    // ACT
    $lista = $this->actingAs($adminDaClinica)->getJson('/api/lista-espera');

    // ASSERT — prioridade maior primeiro; paciente com identificação mínima
    $lista->assertOk();
    expect($lista->json('0.id'))->toBe($alta->json('id'))
        ->and($lista->json('0.paciente'))->toHaveKeys(['id', 'nome']);

    // encaixe feito → sai da fila
    $this->actingAs($adminDaClinica)->deleteJson("/api/lista-espera/{$alta->json('id')}")
        ->assertNoContent();
    expect(ListaEspera::count())->toBe(1);
});
