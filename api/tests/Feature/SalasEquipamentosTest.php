<?php

use App\Models\Auditoria;
use App\Models\Equipamento;
use App\Models\Especialidade;
use App\Models\Sala;
use App\Models\Usuario;

it('deve criar, listar, atualizar e excluir sala', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/salas', ['nome' => 'Sala 1']);
    $criar->assertCreated()->assertJsonPath('nome', 'Sala 1');
    $id = $criar->json('id');

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/salas/{$id}", [
        'nome' => 'Sala 1A', 'ativo' => false,
    ])->assertOk()->assertJsonPath('ativo', false);

    $this->actingAs($adminDaClinica)->deleteJson("/api/salas/{$id}")->assertNoContent();
    expect(Sala::count())->toBe(0);
});

it('deve rejeitar nome de sala duplicado na clínica', function () {
    // ARRANGE
    $adminDaClinica = admin();
    Sala::create(['nome' => 'Sala 1']);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/salas', ['nome' => 'Sala 1'])
        ->assertUnprocessable()->assertJsonValidationErrors('nome');
});

it('deve criar equipamento com quantidade e especialidade da clínica', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $especialidade = Especialidade::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/equipamentos', [
        'nome' => 'Bola Bobath',
        'quantidade_total' => 3,
        'especialidade_id' => $especialidade->id,
    ]);

    // ASSERT
    $resposta->assertCreated()
        ->assertJsonPath('quantidade_total', 3)
        ->assertJsonPath('especialidade_id', $especialidade->id);
});

it('deve rejeitar quantidade de equipamento menor que um', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/equipamentos', [
        'nome' => 'Esteira', 'quantidade_total' => 0,
    ])->assertUnprocessable()->assertJsonValidationErrors('quantidade_total');
});

it('deve bloquear exclusão de especialidade vinculada a equipamento', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $especialidade = Especialidade::factory()->create();
    Equipamento::create([
        'nome' => 'Bola', 'quantidade_total' => 1, 'especialidade_id' => $especialidade->id,
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->deleteJson("/api/especialidades/{$especialidade->id}");

    // ASSERT — restrictOnDelete vira 422, nunca 500
    $resposta->assertUnprocessable()->assertJsonValidationErrors('especialidade');
    expect(Especialidade::count())->toBe(1);
});

it('deve auditar mutações de salas e equipamentos', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/salas', ['nome' => 'Sala Auditada'])
        ->assertCreated();

    // ASSERT
    $registro = Auditoria::where('entidade', 'salas')->where('acao', 'criou')->firstOrFail();
    expect($registro->usuario_id)->toBe($adminDaClinica->id);
});

it('deve negar acesso a salas e equipamentos sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/salas')->assertForbidden();
    $this->actingAs($usuarioSemNivel)->postJson('/api/equipamentos', [
        'nome' => 'X', 'quantidade_total' => 1,
    ])->assertForbidden();
});
