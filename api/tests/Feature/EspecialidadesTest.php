<?php

use App\Models\Auditoria;
use App\Models\Especialidade;
use App\Models\Usuario;

it('deve criar, listar, atualizar e excluir especialidade', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — criar
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/especialidades', [
        'nome' => 'Terapia ABA',
        'tempo_sessao' => 40,
        'cor' => '#4F46E5',
        'exige_termo' => true,
    ]);
    $criar->assertCreated()->assertJsonPath('nome', 'Terapia ABA');
    $id = $criar->json('id');

    // listar
    $listar = $this->actingAs($adminDaClinica)->getJson('/api/especialidades');
    $listar->assertOk();
    expect(collect($listar->json())->pluck('nome'))->toContain('Terapia ABA');

    // atualizar
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/especialidades/{$id}", [
        'nome' => 'Terapia ABA Intensiva',
        'tempo_sessao' => 60,
        'cor' => '#0EA5E9',
    ])->assertOk()->assertJsonPath('tempo_sessao', 60);

    // excluir
    $this->actingAs($adminDaClinica)->deleteJson("/api/especialidades/{$id}")->assertNoContent();
    expect(Especialidade::count())->toBe(0);
});

it('deve rejeitar nome de especialidade duplicado na clínica', function () {
    // ARRANGE
    $adminDaClinica = admin();
    Especialidade::factory()->create(['nome' => 'Fonoaudiologia']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/especialidades', [
        'nome' => 'Fonoaudiologia',
        'tempo_sessao' => 40,
        'cor' => '#22C55E',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('nome');
});

it('deve negar acesso sem permissão de especialidades', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/especialidades')->assertForbidden();
    $this->actingAs($usuarioSemNivel)->postJson('/api/especialidades', [
        'nome' => 'X', 'tempo_sessao' => 40, 'cor' => '#000000',
    ])->assertForbidden();
});

it('deve validar tempo de sessão e formato da cor', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/especialidades', [
        'nome' => 'Inválida',
        'tempo_sessao' => 0,
        'cor' => 'azul',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors(['tempo_sessao', 'cor']);
});

it('deve auditar mutações de especialidade', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/especialidades', [
        'nome' => 'Nutrição',
        'tempo_sessao' => 40,
        'cor' => '#84CC16',
    ])->assertCreated();

    // ASSERT
    $registro = Auditoria::where('entidade', 'especialidades')->where('acao', 'criou')->firstOrFail();
    expect($registro->diff_json['depois']['nome'])->toBe('Nutrição')
        ->and($registro->usuario_id)->toBe($adminDaClinica->id);
});
