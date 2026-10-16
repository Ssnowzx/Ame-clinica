<?php

use App\Models\Profissional;
use App\Models\Usuario;

it('deve vincular usuário a profissional da clínica e expor no me', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();
    $colega = Usuario::factory()->create();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$colega->id}", [
        'profissional_id' => $profissional->id,
    ])->assertOk()->assertJsonPath('profissional_id', $profissional->id);

    // ASSERT — o próprio usuário vê o vínculo no me
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($colega->fresh())->getJson('/api/me')
        ->assertOk()
        ->assertJsonPath('profissional_id', $profissional->id);
});

it('deve rejeitar profissional inexistente no vínculo', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $colega = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$colega->id}", [
        'profissional_id' => 999999,
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
    expect($colega->fresh()->profissional_id)->toBeNull();
});

it('deve criar usuário já vinculado a profissional pelo post', function () {
    // ARRANGE — gate r1 B1.5: o vínculo na CRIAÇÃO é caminho próprio
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();

    // ACT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/usuarios', [
        'nome' => 'Terapeuta Usuária',
        'email' => 'terapeuta@exemplo.com.br',
        'senha' => 'senha-forte-123',
        'profissional_id' => $profissional->id,
    ]);

    // ASSERT — vinculado; e o mesmo profissional não aceita segundo usuário na criação
    $criar->assertCreated()->assertJsonPath('profissional_id', $profissional->id);
    $this->actingAs($adminDaClinica)->postJson('/api/usuarios', [
        'nome' => 'Intrusa',
        'email' => 'intrusa@exemplo.com.br',
        'senha' => 'senha-forte-123',
        'profissional_id' => $profissional->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
});

it('deve rejeitar profissional já vinculado a outro usuário', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();
    $primeiro = Usuario::factory()->create();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$primeiro->id}", [
        'profissional_id' => $profissional->id,
    ])->assertOk();
    $segundo = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$segundo->id}", [
        'profissional_id' => $profissional->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
});

it('deve desvincular e anular o vínculo quando o profissional é excluído', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();
    $colega = Usuario::factory()->create();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$colega->id}", [
        'profissional_id' => $profissional->id,
    ])->assertOk();

    // ACT — desvincular explicitamente
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$colega->id}", [
        'profissional_id' => null,
    ])->assertOk()->assertJsonPath('profissional_id', null);

    // revincular e excluir o profissional → nullOnDelete
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/usuarios/{$colega->id}", [
        'profissional_id' => $profissional->id,
    ])->assertOk();
    $this->actingAs($adminDaClinica)->deleteJson("/api/profissionais/{$profissional->id}")
        ->assertNoContent();

    // ASSERT
    expect($colega->fresh()->profissional_id)->toBeNull();
});
