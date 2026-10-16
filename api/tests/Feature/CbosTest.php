<?php

use App\Models\Auditoria;
use App\Models\Cbos;
use App\Models\Usuario;
use Database\Seeders\CbosSeeder;

it('deve listar o catálogo cbos para qualquer usuário autenticado', function () {
    // ARRANGE — catálogo é global e público; leitura não exige permissão
    $this->seed(CbosSeeder::class);
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT
    $resposta = $this->actingAs($usuarioSemNivel)->getJson('/api/cbos');

    // ASSERT
    $resposta->assertOk();
    expect(collect($resposta->json())->pluck('codigo'))->toContain('225112');
});

it('deve criar cbos com permissão de edição de médicos', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/cbos', [
        'codigo' => '225125',
        'nome' => 'Médico clínico',
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('codigo', '225125');
});

it('deve rejeitar código cbos duplicado', function () {
    // ARRANGE
    Cbos::create(['codigo' => '225112', 'nome' => 'Médico neurologista']);
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/cbos', [
        'codigo' => '225112',
        'nome' => 'Duplicado',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('codigo');
});

it('deve rejeitar código cbos fora do formato de seis dígitos', function (string $codigoInvalido) {
    // ARRANGE — abuse case 8 (poluição do catálogo global, T-cb-01)
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/cbos', [
        'codigo' => $codigoInvalido,
        'nome' => 'Inválido',
    ])->assertUnprocessable()->assertJsonValidationErrors('codigo');
    expect(Cbos::count())->toBe(0);
})->with(['<script>', '12345678901234567890', '12AB56', '12345']);

it('deve auditar a criação de cbos com o autor', function () {
    // ARRANGE — T-cb-02: o catálogo de CBOs é global e a escrita nele exige trilha
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/cbos', [
        'codigo' => '223625',
        'nome' => 'Fisioterapeuta neurofuncional',
    ])->assertCreated();

    // ASSERT
    $registro = Auditoria::where('entidade', 'cbos')->where('acao', 'criou')->firstOrFail();
    expect($registro->usuario_id)->toBe($adminDaClinica->id)
        ->and($registro->diff_json['depois']['codigo'])->toBe('223625');
});

it('deve negar criação de cbos sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->postJson('/api/cbos', [
        'codigo' => '999999',
        'nome' => 'Não deve entrar',
    ])->assertForbidden();
    expect(Cbos::where('codigo', '999999')->exists())->toBeFalse();
});
