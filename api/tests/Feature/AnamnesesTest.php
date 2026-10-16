<?php

use App\Models\Anamnese;
use App\Models\AnamneseModelo;
use App\Models\Auditoria;
use App\Models\Paciente;
use App\Models\Usuario;
use Illuminate\Support\Facades\DB;

/** Modelo com um campo de cada tipo do builder (etapa 2). */
function modeloDeAnamnese(bool $ativo = true): AnamneseModelo
{
    return AnamneseModelo::create([
        'titulo' => 'Ficha Fictícia '.fake()->unique()->numberBetween(1, 99999),
        'campos_json' => [
            ['id' => 'queixa', 'tipo' => 'texto', 'rotulo' => 'Queixa principal', 'obrigatorio' => true],
            ['id' => 'idade_meses', 'tipo' => 'numero', 'rotulo' => 'Idade em meses', 'obrigatorio' => false],
            ['id' => 'lateralidade', 'tipo' => 'opcoes', 'rotulo' => 'Lateralidade', 'obrigatorio' => false, 'opcoes' => ['destro', 'canhoto']],
            ['id' => 'data_avaliacao', 'tipo' => 'data', 'rotulo' => 'Data da avaliação', 'obrigatorio' => false],
            ['id' => 'usa_medicacao', 'tipo' => 'booleano', 'rotulo' => 'Usa medicação', 'obrigatorio' => false],
        ],
        'ativo' => $ativo,
    ]);
}

const RESPOSTAS_VALIDAS = [
    'queixa' => 'Queixa fictícia para teste.',
    'idade_meses' => 42,
    'lateralidade' => 'destro',
    'data_avaliacao' => '2026-07-01',
    'usa_medicacao' => false,
];

it('deve aplicar modelo ao paciente com respostas válidas e preenchida_em do servidor', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $modelo = modeloDeAnamnese();

    // ACT — payload tenta retrodatar (T-ate-12)
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/pacientes/{$paciente->id}/anamneses", [
            'modelo_id' => $modelo->id,
            'respostas_json' => RESPOSTAS_VALIDAS,
            'preenchida_em' => '2020-01-01 00:00',
        ]);

    // ASSERT
    $resposta->assertCreated()
        ->assertJsonPath('paciente_id', $paciente->id)
        ->assertJsonPath('respostas_json.idade_meses', 42);
    // data do servidor NA PAREDE DA CLÍNICA (CR-03)
    expect($resposta->json('preenchida_em'))->toStartWith(agoraNaClinica()->format('Y-m-d'));

    // várias anamneses por paciente (momentos distintos)
    $this->actingAs($adminDaClinica)->postJson("/api/pacientes/{$paciente->id}/anamneses", [
        'modelo_id' => $modelo->id,
        'respostas_json' => RESPOSTAS_VALIDAS,
    ])->assertCreated();
});

it('deve rejeitar cada classe de violação do schema sem ecoar o valor recebido', function (array $respostas, string $chaveDeErro) {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $modelo = modeloDeAnamnese();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/pacientes/{$paciente->id}/anamneses", [
            'modelo_id' => $modelo->id,
            'respostas_json' => $respostas,
        ]);

    // ASSERT — 422 e a resposta nunca ecoa o conteúdo enviado (parecer §5.10)
    $resposta->assertUnprocessable()->assertJsonValidationErrors($chaveDeErro);
    semVazamento($resposta->json(), 'contrabando-fictício');
})->with([
    'chave fora do modelo' => [
        [...RESPOSTAS_VALIDAS, 'campo_estranho' => 'contrabando-fictício'],
        'respostas_json',
    ],
    'obrigatório ausente' => [
        ['idade_meses' => 42],
        'respostas_json.queixa',
    ],
    'opção fora da lista' => [
        [...RESPOSTAS_VALIDAS, 'lateralidade' => 'contrabando-fictício'],
        'respostas_json.lateralidade',
    ],
    'tipo errado no número' => [
        [...RESPOSTAS_VALIDAS, 'idade_meses' => 'contrabando-fictício'],
        'respostas_json.idade_meses',
    ],
    'data inválida' => [
        [...RESPOSTAS_VALIDAS, 'data_avaliacao' => 'contrabando-fictício'],
        'respostas_json.data_avaliacao',
    ],
    'booleano com texto' => [
        [...RESPOSTAS_VALIDAS, 'usa_medicacao' => 'contrabando-fictício'],
        'respostas_json.usa_medicacao',
    ],
]);

it('deve rejeitar texto acima do teto por campo', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $modelo = modeloDeAnamnese();

    // ACT + ASSERT — teto de 2000 por campo (P4)
    $this->actingAs($adminDaClinica)->postJson("/api/pacientes/{$paciente->id}/anamneses", [
        'modelo_id' => $modelo->id,
        'respostas_json' => [...RESPOSTAS_VALIDAS, 'queixa' => str_repeat('a', 2001)],
    ])->assertUnprocessable()->assertJsonValidationErrors('respostas_json.queixa');
});

it('deve rejeitar modelo inativo na criação e tolerar inativação posterior na edição', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $inativo = modeloDeAnamnese(ativo: false);

    // ACT + ASSERT — criação com modelo inativo → 422 (T-ate-12)
    $this->actingAs($adminDaClinica)->postJson("/api/pacientes/{$paciente->id}/anamneses", [
        'modelo_id' => $inativo->id,
        'respostas_json' => RESPOSTAS_VALIDAS,
    ])->assertUnprocessable()->assertJsonValidationErrors('modelo_id');

    // edição tolera modelo inativado DEPOIS; trocar o modelo é proibido
    $modelo = modeloDeAnamnese();
    $id = $this->actingAs($adminDaClinica)->postJson("/api/pacientes/{$paciente->id}/anamneses", [
        'modelo_id' => $modelo->id,
        'respostas_json' => RESPOSTAS_VALIDAS,
    ])->assertCreated()->json('id');
    $modelo->update(['ativo' => false]);

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/anamneses/{$id}", [
        'respostas_json' => [...RESPOSTAS_VALIDAS, 'queixa' => 'Queixa fictícia revisada.'],
    ])->assertOk()->assertJsonPath('respostas_json.queixa', 'Queixa fictícia revisada.');

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/anamneses/{$id}", [
        'modelo_id' => modeloDeAnamnese()->id,
        'respostas_json' => RESPOSTAS_VALIDAS,
    ])->assertUnprocessable()->assertJsonValidationErrors('modelo_id');

    // ...e a chave NULA também é uma tentativa de escrita (gatilho PROHIBITED-NULL):
    // `prohibited` a deixava passar (= "ausente OU vazio") e o `validated()` a carregava
    // adiante. Chave AUSENTE é chave preservada; chave NULA, não.
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/anamneses/{$id}", [
        'modelo_id' => null,
        'respostas_json' => RESPOSTAS_VALIDAS,
    ])->assertUnprocessable()->assertJsonValidationErrors('modelo_id');

    // a edição revalida contra o schema
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/anamneses/{$id}", [
        'respostas_json' => [...RESPOSTAS_VALIDAS, 'lateralidade' => 'ambidestro'],
    ])->assertUnprocessable()->assertJsonValidationErrors('respostas_json.lateralidade');
});

it('deve manter respostas sem delete, minimizadas, cifradas, mascaradas e com leitura auditada', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $modelo = modeloDeAnamnese();
    $id = $this->actingAs($adminDaClinica)->postJson("/api/pacientes/{$paciente->id}/anamneses", [
        'modelo_id' => $modelo->id,
        'respostas_json' => RESPOSTAS_VALIDAS,
    ])->assertCreated()->json('id');

    // ASSERT — sem rota DELETE (T-ate-11)
    $this->actingAs($adminDaClinica)->deleteJson("/api/anamneses/{$id}")->assertStatus(405);
    expect(Anamnese::find($id))->not->toBeNull();

    // listagem minimizada: modelo/datas, NUNCA respostas
    $lista = $this->actingAs($adminDaClinica)->getJson("/api/pacientes/{$paciente->id}/anamneses");
    $lista->assertOk()->assertJsonPath('total', 1)
        ->assertJsonPath('data.0.modelo.titulo', $modelo->titulo);
    semVazamento($lista->json(), 'Queixa fictícia');

    // cifrada em repouso
    $cru = DB::table('anamneses')->where('id', $id)->value('respostas_json');
    expect(str_contains($cru, 'Queixa fictícia'))->toBeFalse();

    // mascarada no diff da auditoria
    $registro = Auditoria::where('entidade', 'anamneses')->where('acao', 'criou')->firstOrFail();
    expect($registro->diff_json['depois']['respostas_json'])->toBe('***');
    semVazamento($registro->diff_json, 'Queixa fictícia');

    // leitura do detalhe auditada com autor e IP (art. 11)
    $this->actingAs($adminDaClinica)->getJson("/api/anamneses/{$id}")
        ->assertOk()->assertJsonPath('respostas_json.queixa', RESPOSTAS_VALIDAS['queixa']);
    $consulta = Auditoria::where('entidade', 'anamneses')->where('acao', 'consultou')
        ->where('entidade_id', $id)->firstOrFail();
    expect($consulta->usuario_id)->toBe($adminDaClinica->id)
        ->and($consulta->ip)->not->toBeNull();
});

it('deve responder 403 sem permissão de leitura clínica', function () {
    // ARRANGE
    $paciente = Paciente::factory()->create();
    $semPermissao = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($semPermissao)
        ->getJson("/api/pacientes/{$paciente->id}/anamneses")->assertForbidden();
});
