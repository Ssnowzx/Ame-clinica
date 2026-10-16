<?php

use App\Models\Auditoria;
use App\Models\Convenio;
use App\Models\Servico;
use App\Models\Usuario;

it('deve criar, listar, atualizar e excluir convênio', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/convenios', [
        'nome' => 'Convênio Fictício',
        'registro_ans' => '123456',
    ]);
    $criar->assertCreated()->assertJsonPath('nome', 'Convênio Fictício');
    $id = $criar->json('id');

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/convenios/{$id}", [
        'nome' => 'Convênio Fictício Renomeado',
    ])->assertOk()->assertJsonPath('nome', 'Convênio Fictício Renomeado');

    $this->actingAs($adminDaClinica)->deleteJson("/api/convenios/{$id}")->assertNoContent();
    expect(Convenio::count())->toBe(0);
});

it('deve rejeitar nome de convênio duplicado na clínica', function () {
    // ARRANGE
    $adminDaClinica = admin();
    Convenio::create(['nome' => 'Particular']);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/convenios', ['nome' => 'Particular'])
        ->assertUnprocessable()->assertJsonValidationErrors('nome');
});

it('deve gerenciar a tabela de serviços de um convênio', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Particular']);

    // ACT + ASSERT — criar serviço
    $criar = $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/servicos", [
            'procedimento' => 'Sessão de Terapia ABA',
            'valor' => 180.50,
        ]);
    $criar->assertCreated()->assertJsonPath('procedimento', 'Sessão de Terapia ABA');

    // listar
    $listar = $this->actingAs($adminDaClinica)->getJson("/api/convenios/{$convenio->id}/servicos");
    $listar->assertOk();
    expect($listar->json())->toHaveCount(1);
});

it('deve rejeitar procedimento duplicado no mesmo convênio e aceitar em outro', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $particular = Convenio::create(['nome' => 'Particular']);
    $outroConvenio = Convenio::create(['nome' => 'Convênio B']);
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$particular->id}/servicos", [
        'procedimento' => 'Avaliação Inicial', 'valor' => 200,
    ])->assertCreated();

    // ACT + ASSERT — duplicado no mesmo convênio
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$particular->id}/servicos", [
        'procedimento' => 'Avaliação Inicial', 'valor' => 250,
    ])->assertUnprocessable()->assertJsonValidationErrors('procedimento');

    // mesmo procedimento em convênio diferente com outro valor
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$outroConvenio->id}/servicos", [
        'procedimento' => 'Avaliação Inicial', 'valor' => 150,
    ])->assertCreated();
});

it('deve rejeitar valor monetário negativo ou com mais de duas casas', function () {
    // ARRANGE — abuse case 10 (T-fin-01): rejeitar, nunca arredondar
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Particular']);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/servicos", [
        'procedimento' => 'Sessão', 'valor' => -10,
    ])->assertUnprocessable()->assertJsonValidationErrors('valor');

    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/servicos", [
        'procedimento' => 'Sessão', 'valor' => 10.999,
    ])->assertUnprocessable()->assertJsonValidationErrors('valor');

    expect(Servico::count())->toBe(0);
});

it('deve bloquear exclusão de convênio com serviços', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Particular']);
    $servico = new Servico(['procedimento' => 'Sessão', 'valor' => 100]);
    $servico->convenio_id = $convenio->id;
    $servico->save();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->deleteJson("/api/convenios/{$convenio->id}");

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('convenio');
    expect(Convenio::count())->toBe(1);
});

it('deve rejeitar valor acima do teto do decimal', function () {
    // ARRANGE — teto de decimal(10,2) (abuse case 10)
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Particular']);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/servicos", [
        'procedimento' => 'Sessão', 'valor' => 100000000,
    ])->assertUnprocessable()->assertJsonValidationErrors('valor');
});

it('deve auditar mutações de convênios e serviços', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/convenios', ['nome' => 'Auditado'])
        ->assertCreated();

    // ASSERT
    $registro = Auditoria::where('entidade', 'convenios')->where('acao', 'criou')->firstOrFail();
    expect($registro->usuario_id)->toBe($adminDaClinica->id);
});

it('deve negar acesso a convênios sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/convenios')->assertForbidden();
});

// ── Código do procedimento da operadora (change codigo-do-procedimento-no-servico) ──────────

it('deve guardar e devolver o código do procedimento da operadora', function () {
    // ARRANGE — dado de REFERÊNCIA: não muda preço nem faturamento (§14)
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);

    // ACT
    $criar = $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/servicos", [
            'procedimento' => 'Sessão de Fonoaudiologia',
            'codigo_procedimento' => '50000470',
            'valor' => 150.00,
        ]);

    // ASSERT — volta na criação e na leitura (a coluna precisa estar em CAMPOS)
    $criar->assertCreated()->assertJsonPath('codigo_procedimento', '50000470');
    $this->actingAs($adminDaClinica)->getJson("/api/convenios/{$convenio->id}/servicos")
        ->assertOk()->assertJsonPath('0.codigo_procedimento', '50000470');
    expect(Servico::first()->codigo_procedimento)->toBe('50000470');
});

it('deve aceitar serviço sem código e código repetido no mesmo convênio', function () {
    // ARRANGE — o Particular não tem código; e o mesmo procedimento base pode repetir
    // em serviços diferentes (design D3: sem unicidade)
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);

    // ACT + ASSERT — sem código
    $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/servicos", [
            'procedimento' => 'Sessão avulsa',
            'valor' => 100.00,
        ])->assertCreated()->assertJsonPath('codigo_procedimento', null);

    // dois procedimentos DIFERENTES com o MESMO código
    $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/servicos", [
            'procedimento' => 'Sessão de 30 min',
            'codigo_procedimento' => '50000470',
            'valor' => 90.00,
        ])->assertCreated();
    $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/servicos", [
            'procedimento' => 'Sessão de 50 min',
            'codigo_procedimento' => '50000470',
            'valor' => 150.00,
        ])->assertCreated();

    expect(Servico::where('codigo_procedimento', '50000470')->count())->toBe(2);
});

it('deve rejeitar código de procedimento acima do limite', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->postJson("/api/convenios/{$convenio->id}/servicos", [
            'procedimento' => 'Sessão longa',
            'codigo_procedimento' => str_repeat('9', 41),
            'valor' => 150.00,
        ])->assertUnprocessable()->assertJsonValidationErrors('codigo_procedimento');
});
