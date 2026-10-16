<?php

use App\Models\AnamneseModelo;
use App\Models\Auditoria;
use App\Models\Usuario;

function camposDeAnamneseValidos(): array
{
    return [
        ['id' => 'queixa', 'tipo' => 'texto', 'rotulo' => 'Queixa principal', 'obrigatorio' => true],
        [
            'id' => 'lateralidade', 'tipo' => 'opcoes', 'rotulo' => 'Lateralidade',
            'obrigatorio' => false, 'opcoes' => ['Destro', 'Canhoto', 'Ambidestro'],
        ],
    ];
}

it('deve criar modelo com campos válidos e persistir o schema', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/anamnese-modelos', [
        'titulo' => 'Anamnese Inicial',
        'campos_json' => camposDeAnamneseValidos(),
    ]);

    // ASSERT — campos persistem exatamente como definidos
    $resposta->assertCreated();
    expect($resposta->json('campos_json'))->toBe(camposDeAnamneseValidos());
});

it('deve rejeitar título duplicado na clínica', function () {
    // ARRANGE
    $adminDaClinica = admin();
    AnamneseModelo::create(['titulo' => 'Anamnese Inicial', 'campos_json' => camposDeAnamneseValidos()]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/anamnese-modelos', [
        'titulo' => 'Anamnese Inicial',
        'campos_json' => camposDeAnamneseValidos(),
    ])->assertUnprocessable()->assertJsonValidationErrors('titulo');
});

it('deve rejeitar campo de tipo desconhecido', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/anamnese-modelos', [
        'titulo' => 'Inválido',
        'campos_json' => [
            ['id' => 'x', 'tipo' => 'telepatia', 'rotulo' => 'X', 'obrigatorio' => false],
        ],
    ])->assertUnprocessable()->assertJsonValidationErrors('campos_json.0.tipo');
    expect(AnamneseModelo::count())->toBe(0);
});

it('deve rejeitar campo de opções sem a lista de opções', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/anamnese-modelos', [
        'titulo' => 'Inválido',
        'campos_json' => [
            ['id' => 'x', 'tipo' => 'opcoes', 'rotulo' => 'X', 'obrigatorio' => false],
        ],
    ])->assertUnprocessable()->assertJsonValidationErrors('campos_json.0.opcoes');
});

it('deve rejeitar chaves não permitidas no campo', function () {
    // ARRANGE — abuse case 9 (contrabando no campos_json)
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/anamnese-modelos', [
        'titulo' => 'Contrabando',
        'campos_json' => [
            [
                'id' => 'x', 'tipo' => 'texto', 'rotulo' => 'X', 'obrigatorio' => false,
                'html' => '<img onerror=alert(1)>',
            ],
        ],
    ])->assertUnprocessable()->assertJsonValidationErrors('campos_json.0');
    expect(AnamneseModelo::count())->toBe(0);
});

it('deve rejeitar ids de campo duplicados no modelo', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/anamnese-modelos', [
        'titulo' => 'Ids repetidos',
        'campos_json' => [
            ['id' => 'x', 'tipo' => 'texto', 'rotulo' => 'A', 'obrigatorio' => false],
            ['id' => 'x', 'tipo' => 'texto', 'rotulo' => 'B', 'obrigatorio' => false],
        ],
    ])->assertUnprocessable();
});

it('deve rejeitar modelo acima do limite de campos', function () {
    // ARRANGE — limite P3: ≤ 60 campos
    $adminDaClinica = admin();
    $campos = collect(range(1, 61))->map(fn (int $indice) => [
        'id' => "campo_{$indice}", 'tipo' => 'texto', 'rotulo' => "Campo {$indice}", 'obrigatorio' => false,
    ])->all();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/anamnese-modelos', [
        'titulo' => 'Gigante',
        'campos_json' => $campos,
    ])->assertUnprocessable()->assertJsonValidationErrors('campos_json');
});

it('deve auditar mutações de modelos de anamnese', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/anamnese-modelos', [
        'titulo' => 'Auditada',
        'campos_json' => camposDeAnamneseValidos(),
    ])->assertCreated();

    // ASSERT
    $registro = Auditoria::where('entidade', 'anamnese_modelos')->where('acao', 'criou')->firstOrFail();
    expect($registro->usuario_id)->toBe($adminDaClinica->id);
});

it('deve responder 403 sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/anamnese-modelos')->assertForbidden();
});
