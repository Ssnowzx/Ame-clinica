<?php

use App\Models\Agendamento;
use App\Models\ListaEspera;
use App\Models\Profissional;
use App\Rules\ProfissionalAtivoOuVinculado;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Monolog\Handler\TestHandler;

/**
 * Gatilho PROF-DESLIGADO (docs/GATILHOS.md): a regra "ativo OU já vinculado ao registro" vive no
 * boundary do servidor (três Requests) e no ramo de série do AgendamentoService — nunca só na tela.
 */

/** Invoca o Rule ISOLADO e devolve a mensagem de falha (null = passou). */
function motivoDaRegra(?int $atual, int $valor): ?string
{
    $mensagem = null;
    (new ProfissionalAtivoOuVinculado($atual))
        ->validate('profissional_id', $valor, function (string $msg) use (&$mensagem): void {
            $mensagem = $msg;
        });

    return $mensagem;
}

// ===== 1. O Rule isolado: a matriz inteira (task 1.2) =====

it('deve passar ao criar com profissional ativo', function () {
    // ARRANGE
    admin();
    $ativo = Profissional::factory()->create(['ativo' => true]);

    // ACT + ASSERT
    expect(motivoDaRegra(null, $ativo->id))->toBeNull();
});

it('deve barrar ao criar com profissional desligado', function () {
    // ARRANGE
    admin();
    $desligado = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT
    expect(motivoDaRegra(null, $desligado->id))->toBe(ProfissionalAtivoOuVinculado::MENSAGEM);
});

it('deve passar ao manter o MESMO desligado já vinculado', function () {
    // ARRANGE
    admin();
    $desligado = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT — o vínculo histórico é preservado
    expect(motivoDaRegra($desligado->id, $desligado->id))->toBeNull();
});

it('deve passar ao trocar de desligado para ativo', function () {
    // ARRANGE
    admin();
    $desligado = Profissional::factory()->create(['ativo' => false]);
    $ativo = Profissional::factory()->create(['ativo' => true]);

    // ACT + ASSERT
    expect(motivoDaRegra($desligado->id, $ativo->id))->toBeNull();
});

it('deve barrar ao trocar de ativo para desligado', function () {
    // ARRANGE
    admin();
    $ativo = Profissional::factory()->create(['ativo' => true]);
    $desligado = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT
    expect(motivoDaRegra($ativo->id, $desligado->id))->toBe(ProfissionalAtivoOuVinculado::MENSAGEM);
});

it('deve barrar ao trocar entre dois desligados', function () {
    // ARRANGE
    admin();
    $d1 = Profissional::factory()->create(['ativo' => false]);
    $d2 = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT
    expect(motivoDaRegra($d1->id, $d2->id))->toBe(ProfissionalAtivoOuVinculado::MENSAGEM);
});

// ===== 2. Boundary do TRATAMENTO via rota (task 5.1) =====

it('deve barrar criar tratamento com profissional desligado', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $desligado = Profissional::factory()->create(['ativo' => false]);
    $payload = [...payloadDeTratamento(), 'profissional_id' => $desligado->id];

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload)
        ->assertStatus(422)->assertJsonValidationErrors('profissional_id');
});

it('deve permitir editar tratamento mantendo o profissional já desligado', function () {
    // ARRANGE — o profissional é desligado DEPOIS de vinculado ao pacote
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    $id = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload)
        ->assertCreated()->json('id');
    Profissional::whereKey($payload['profissional_id'])->update(['ativo' => false]);

    // ACT + ASSERT — repetir o mesmo profissional não congela a edição dos demais campos
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$id}", [...$payload, 'sessoes_total' => 12])
        ->assertOk()->assertJsonPath('sessoes_total', 12);
});

it('deve barrar editar tratamento trocando para um profissional desligado', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = payloadDeTratamento();
    $id = $this->actingAs($adminDaClinica)->postJson('/api/tratamentos', $payload)
        ->assertCreated()->json('id');
    $outroDesligado = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$id}", [
        ...$payload, 'profissional_id' => $outroDesligado->id,
    ])->assertStatus(422)->assertJsonValidationErrors('profissional_id');
});

// ===== 3. Boundary do AGENDAMENTO via rota (task 5.2) =====

it('deve barrar criar agendamento com profissional desligado, mesmo por payload direto', function () {
    // ARRANGE — o payload "curl" burla o filtro do front
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $desligado = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base, 'profissional_id' => $desligado->id,
    ])->assertStatus(422)->assertJsonValidationErrors('profissional_id');
});

it('deve barrar criar BLOQUEIO com profissional desligado', function () {
    // ARRANGE — a regra é uniforme para atendimento e bloqueio
    $adminDaClinica = admin();
    $desligado = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'inicio' => now()->addDay()->format('Y-m-d').' 09:00',
        'profissional_id' => $desligado->id,
    ])->assertStatus(422)->assertJsonValidationErrors('profissional_id');
});

it('deve permitir editar agendamento mantendo o profissional já desligado', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $id = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $base)
        ->assertCreated()->json('id');
    Profissional::whereKey($base['profissional_id'])->update(['ativo' => false]);

    // ACT — reagenda repetindo o mesmo profissional
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$id}", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'obs' => 'Reagendado',
    ])->assertOk();

    // ASSERT
    expect(Agendamento::find($id)->obs)->toBe('Reagendado');
});

// ===== 4. Boundary do ENCAIXE via rota (task 5.3) =====

it('deve barrar encaixar em profissional desligado e manter a entrada na fila', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $entrada = ListaEspera::create([
        'paciente_id' => $base['paciente_id'],
        'especialidade_id' => $base['especialidade_id'],
        'profissional_id' => $base['profissional_id'],
        'prioridade' => 5,
    ]);
    $desligado = Profissional::factory()->create(['ativo' => false]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $desligado->id,
        'especialidade_id' => $base['especialidade_id'],
    ])->assertStatus(422)->assertJsonValidationErrors('profissional_id');

    expect(ListaEspera::find($entrada->id))->not->toBeNull();
});

// ===== 5. Log de segurança da tentativa bloqueada, sem dado de MENOR (task 3.3) =====

it('deve registrar a tentativa bloqueada no log de segurança sem obs nem paciente', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $desligado = Profissional::factory()->create(['ativo' => false]);

    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT — bloqueio com obs (texto clínico) no payload
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base,
        'profissional_id' => $desligado->id,
        'obs' => 'Observação clínica sigilosa da criança',
    ])->assertStatus(422);

    // ASSERT — um evento, com a whitelist e SEM dado do menor
    expect($handler->getRecords())->toHaveCount(1);
    $registro = $handler->getRecords()[0];
    expect($registro['message'])->toBe('prof_desligado.bloqueado');
    $contexto = $registro['context'];
    expect($contexto)->not->toHaveKey('obs')
        ->and($contexto)->not->toHaveKey('paciente_id')
        ->and($contexto['recurso'])->toBe('agendamento')
        ->and($contexto['operacao'])->toBe('criar')
        ->and($contexto['motivo'])->toBe(ProfissionalAtivoOuVinculado::MOTIVO)
        ->and($contexto['profissional_tentado_id'])->toBe($desligado->id);
    semVazamento($contexto, 'Observação clínica sigilosa da criança');
});

// ===== 6. Guarda de série no AgendamentoService (task 4.2, SEC-PD-03) =====

it('deve barrar aplicar-na-série re-vinculando uma irmã a um profissional desligado', function () {
    // ARRANGE — série de 3 com o profissional P1
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(8, 0);
    $criacao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base,
        'inicio' => $inicio->format('Y-m-d H:i'),
        'recorrencia' => ['ate' => $inicio->copy()->addWeeks(2)->format('Y-m-d')],
    ])->assertCreated();
    $ids = collect($criacao->json('agendamentos'))->pluck('id');

    // uma irmã é reatribuída a P2 (ativo, com a MESMA especialidade)
    $p2 = Profissional::factory()->create(['ativo' => true]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $p2->id,
        'especialidade_id' => $base['especialidade_id'],
    ]);
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ids[1]}", [
        'inicio' => Agendamento::find($ids[1])->inicio->format('Y-m-d H:i'),
        'profissional_id' => $p2->id,
    ])->assertOk();

    // P1 é desligado DEPOIS (vínculo histórico do clicado)
    Profissional::whereKey($base['profissional_id'])->update(['ativo' => false]);

    // ACT — aplicar na série propaga P1 (desligado) e barra na irmã que aponta para P2
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ids[0]}", [
        'inicio' => $inicio->copy()->addHour()->format('Y-m-d H:i'),
        'profissional_id' => $base['profissional_id'],
        'aplicar_na_serie' => true,
    ])->assertStatus(422)->assertJsonValidationErrors('profissional_id');

    // ASSERT — a transação reverte: a irmã continua com P2
    expect(Agendamento::find($ids[1])->profissional_id)->toBe($p2->id);
});

it('deve permitir aplicar-na-série quando todas as irmãs já apontam para o desligado', function () {
    // ARRANGE — série inteira em P1, depois desligado (vínculo histórico legítimo)
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(8, 0);
    $criacao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base,
        'inicio' => $inicio->format('Y-m-d H:i'),
        'recorrencia' => ['ate' => $inicio->copy()->addWeeks(2)->format('Y-m-d')],
    ])->assertCreated();
    $ids = collect($criacao->json('agendamentos'))->pluck('id');
    Profissional::whereKey($base['profissional_id'])->update(['ativo' => false]);

    // ACT + ASSERT — o guard não pode barrar a série histórica (cada irmã já é do desligado)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ids[0]}", [
        'inicio' => $inicio->copy()->addHour()->format('Y-m-d H:i'),
        'profissional_id' => $base['profissional_id'],
        'aplicar_na_serie' => true,
    ])->assertOk();
});
