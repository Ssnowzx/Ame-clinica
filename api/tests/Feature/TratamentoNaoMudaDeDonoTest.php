<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;

/** As 5 pontas do tratamento, da clínica. */
function tratamentoDoDono(): array
{
    $convenio = Convenio::create(['nome' => 'Convênio '.fake()->unique()->word()]);
    $servico = new Servico(['procedimento' => 'Sessão '.fake()->unique()->word(), 'valor' => 150]);
    $servico->convenio_id = $convenio->id;
    $servico->save();

    return [
        'paciente_id' => Paciente::factory()->create()->id,
        'convenio_id' => $convenio->id,
        'especialidade_id' => Especialidade::factory()->create()->id,
        'profissional_id' => Profissional::factory()->create()->id,
        'servico_id' => $servico->id,
        'sessoes_total' => 10,
    ];
}

/**
 * O tratamento pertence a UMA criança. Suas sessões consumidas nasceram dos
 * atendimentos dela, e os agendamentos dela apontam para ele
 * (`agendamentos.tratamento_id`).
 *
 * Trocar o `paciente_id` de um tratamento EM USO re-parenta histórico clínico e
 * financeiro de uma criança para outra: o saldo consumido pela primeira passaria a
 * contar contra o pacote da segunda. A tela desta change é a primeira a expor esse
 * botão — a guarda tem que existir antes dele.
 */
it('deve recusar trocar o paciente de um tratamento que já tem agendamento', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = tratamentoDoDono();
    $tratamento = Tratamento::create($payload);
    $outraCrianca = Paciente::factory()->create();

    Agendamento::create([
        'paciente_id' => $payload['paciente_id'],
        'profissional_id' => $payload['profissional_id'],
        'especialidade_id' => $payload['especialidade_id'],
        'tratamento_id' => $tratamento->id,
        'status_id' => StatusAgendamento::inicialId(),
        'inicio' => now()->addDay()->setTime(9, 0),
        'fim' => now()->addDay()->setTime(9, 40),
        'tipo' => 'atendimento',
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        ...$payload,
        'paciente_id' => $outraCrianca->id,
    ]);

    // ASSERT: a recusa diz o que fazer, e o tratamento continua com a criança dele
    $resposta->assertStatus(422)->assertJsonValidationErrors('paciente_id');
    expect((int) $tratamento->fresh()->paciente_id)->toBe((int) $payload['paciente_id']);
});

it('deve recusar trocar o paciente de um tratamento com sessões já realizadas', function () {
    // ARRANGE: as sessões consumidas são fato clínico da criança atual
    $adminDaClinica = admin();
    $payload = tratamentoDoDono();
    $tratamento = Tratamento::create($payload);
    $tratamento->forceFill(['sessoes_realizadas' => 3])->save();
    $outraCrianca = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        ...$payload,
        'paciente_id' => $outraCrianca->id,
    ]);

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('paciente_id');
    expect((int) $tratamento->fresh()->paciente_id)->toBe((int) $payload['paciente_id']);
});

it('deve recusar a troca de paciente MESMO num tratamento sem uso', function () {
    // ARRANGE: a recusa é incondicional de propósito. "Só quando já tem uso" seria uma
    // contagem SEM LOCK — um agendamento pode nascer entre a checagem e a gravação. E
    // não se perde nada: um pacote sem uso já pode ser EXCLUÍDO e recriado no paciente
    // certo (parecer SEC-TR-01).
    $adminDaClinica = admin();
    $payload = tratamentoDoDono();
    $tratamento = Tratamento::create($payload);
    $outraCrianca = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        ...$payload,
        'paciente_id' => $outraCrianca->id,
    ]);

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('paciente_id');
    expect((int) $tratamento->fresh()->paciente_id)->toBe((int) $payload['paciente_id']);
});

it('deve recusar trocar a especialidade — mesmo sem agendamento nenhum', function () {
    // ARRANGE: condicionar a "quando já tem agendamento" seria um SELECT sem lock, e a
    // criação de agendamento valida a coerência FORA da transação: um agendamento pode
    // nascer entre a checagem e a gravação, e já nascer CONGELADO (gate CR-TR-04)
    $adminDaClinica = admin();
    $payload = tratamentoDoDono();
    $tratamento = Tratamento::create($payload);
    $outraEspecialidadeSemUso = Especialidade::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        ...$payload,
        'especialidade_id' => $outraEspecialidadeSemUso->id,
    ]);

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('especialidade_id');
});

it('deve recusar trocar a especialidade de um tratamento com agendamentos', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = tratamentoDoDono();
    $tratamento = Tratamento::create($payload);
    Agendamento::create([
        'paciente_id' => $payload['paciente_id'],
        'profissional_id' => $payload['profissional_id'],
        'especialidade_id' => $payload['especialidade_id'],
        'tratamento_id' => $tratamento->id,
        'status_id' => StatusAgendamento::inicialId(),
        'inicio' => now()->addDay()->setTime(9, 0),
        'fim' => now()->addDay()->setTime(9, 40),
        'tipo' => 'atendimento',
    ]);
    $outraEspecialidade = Especialidade::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        ...$payload,
        'especialidade_id' => $outraEspecialidade->id,
    ]);

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('especialidade_id');
});

it('deve recusar trocar o convênio de um tratamento com sessões realizadas', function () {
    // ARRANGE: o convênio decide se o pacote é lançado no caixa ou segue a esteira do
    // sistema irmão (§14) — pacote com dinheiro rodando não muda de regra de faturamento
    $adminDaClinica = admin();
    $payload = tratamentoDoDono();
    $tratamento = Tratamento::create($payload);
    $tratamento->forceFill(['sessoes_realizadas' => 2])->save();
    $outroConvenio = Convenio::create(['nome' => 'Outro Convênio Fictício']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        ...$payload,
        'convenio_id' => $outroConvenio->id,
        'servico_id' => null,
    ]);

    // ASSERT
    $resposta->assertStatus(422)->assertJsonValidationErrors('convenio_id');
});

it('deve recusar encolher o total abaixo do que já foi consumido', function () {
    // ARRANGE: a revalidação acontece SOB LOCK (o validator a fez fora dele)
    $adminDaClinica = admin();
    $payload = tratamentoDoDono();
    $tratamento = Tratamento::create($payload);
    $tratamento->forceFill(['sessoes_realizadas' => 4])->save();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        ...$payload,
        'sessoes_total' => 3,
    ]);

    // ASSERT: a mensagem diz QUANTAS já foram feitas — a recepção precisa do número
    $resposta->assertStatus(422)->assertJsonValidationErrors('sessoes_total');
    expect($tratamento->fresh()->sessoes_total)->toBe(10);
});

it('deve continuar aceitando editar o tratamento em uso sem trocar o paciente', function () {
    // ARRANGE: a guarda protege o DONO, não engessa o pacote
    $adminDaClinica = admin();
    $payload = tratamentoDoDono();
    $tratamento = Tratamento::create($payload);
    $tratamento->forceFill(['sessoes_realizadas' => 3])->save();

    // ACT: parar o tratamento é edição legítima
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        ...$payload,
        'status' => 'parado',
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('status', 'parado');
});
