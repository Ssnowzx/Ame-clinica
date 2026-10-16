<?php

use App\Models\Auditoria;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\RegraLimiteConvenio;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

it('deve criar, listar, atualizar e excluir regras de limite do convênio', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);
    $aba = Especialidade::factory()->create(['nome' => 'Terapia ABA Fictícia']);

    // ACT + ASSERT — criar regra específica (o cenário da spec: "ABA · 8 · dia · bloquear")
    $criar = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'especialidade_id' => $aba->id, 'periodo' => 'dia', 'limite' => 8, 'acao' => 'bloquear',
    ]);
    $criar->assertCreated()
        ->assertJsonPath('periodo', 'dia')
        ->assertJsonPath('limite', 8)
        ->assertJsonPath('acao', 'bloquear')
        ->assertJsonPath('especialidade.id', $aba->id)
        ->assertJsonPath('especialidade.nome', 'Terapia ABA Fictícia');

    // regra "todas as especialidades" (especialidade null)
    $todas = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'periodo' => 'mes', 'limite' => 4, 'acao' => 'avisar',
    ]);
    $todas->assertCreated()->assertJsonPath('especialidade', null);

    // listar sob convenios.ver
    $listar = $this->actingAs($adminDaClinica)->getJson("/api/convenios/{$convenio->id}/regras");
    $listar->assertOk();
    expect($listar->json())->toHaveCount(2);

    // atualizar (com o token de versão, como toda edição)
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/convenios/{$convenio->id}/regras/{$criar->json('id')}", [
            'especialidade_id' => $aba->id, 'periodo' => 'dia', 'limite' => 4, 'acao' => 'avisar',
        ])->assertOk()->assertJsonPath('limite', 4)->assertJsonPath('acao', 'avisar');

    // excluir
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/convenios/{$convenio->id}/regras/{$todas->json('id')}")
        ->assertNoContent();
    expect(RegraLimiteConvenio::count())->toBe(1);
});

it('deve recusar período e ação fora do domínio sem ecoar o valor recebido', function () {
    // ARRANGE — domínio fechado (spec convenios · SEC-LP-08)
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);

    // ACT + ASSERT — período inválido
    $periodo = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'periodo' => 'quinzena', 'limite' => 2, 'acao' => 'bloquear',
    ]);
    $periodo->assertUnprocessable()->assertJsonValidationErrors('periodo');
    semVazamento($periodo->json(), 'quinzena');

    // ação inválida
    $acao = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'periodo' => 'dia', 'limite' => 2, 'acao' => 'explodir',
    ]);
    $acao->assertUnprocessable()->assertJsonValidationErrors('acao');
    semVazamento($acao->json(), 'explodir');

    // nada persistido
    expect(RegraLimiteConvenio::count())->toBe(0);
});

it('deve recusar limite fora da faixa 1..99', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);

    // ACT + ASSERT
    foreach ([0, 100] as $limiteInvalido) {
        $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
            'periodo' => 'dia', 'limite' => $limiteInvalido, 'acao' => 'bloquear',
        ])->assertUnprocessable()->assertJsonValidationErrors('limite');
    }
    expect(RegraLimiteConvenio::count())->toBe(0);
});

it('deve recusar regra duplicada por convênio, especialidade e período — e aceitar em outro convênio', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);
    $outro = Convenio::create(['nome' => 'Outro Convênio Fictício']);
    $aba = Especialidade::factory()->create();
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'especialidade_id' => $aba->id, 'periodo' => 'dia', 'limite' => 8, 'acao' => 'bloquear',
    ])->assertCreated();
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'periodo' => 'mes', 'limite' => 4, 'acao' => 'avisar',
    ])->assertCreated();

    // ACT + ASSERT — duplicada específica e duplicada "todas"
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'especialidade_id' => $aba->id, 'periodo' => 'dia', 'limite' => 2, 'acao' => 'avisar',
    ])->assertUnprocessable()->assertJsonValidationErrors('periodo');
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'periodo' => 'mes', 'limite' => 9, 'acao' => 'bloquear',
    ])->assertUnprocessable()->assertJsonValidationErrors('periodo');

    // mesma especialidade+período em OUTRO convênio é legítimo
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$outro->id}/regras", [
        'especialidade_id' => $aba->id, 'periodo' => 'dia', 'limite' => 1, 'acao' => 'bloquear',
    ])->assertCreated();
});

it('deve garantir a unicidade da regra "todas" também no banco (coluna gerada)', function () {
    // ARRANGE — o 422 do boundary é a 1ª camada; o índice único sobre
    // COALESCE(especialidade_id, 0) é o backstop que NULL ≠ NULL não fura (SEC-LP-07)
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);
    $linha = [
        'convenio_id' => $convenio->id,
        'especialidade_id' => null,
        'periodo' => 'mes',
        'limite' => 4,
        'acao' => 'avisar',
    ];
    DB::table('regras_limite_convenio')->insert($linha);

    // ACT + ASSERT — a duplicata crua (fora do boundary) morre no banco
    expect(fn () => DB::table('regras_limite_convenio')->insert($linha))
        ->toThrow(QueryException::class);
});

it('deve responder 404 para convênio inexistente e para regra de outro convênio', function () {
    // ARRANGE — paridade com a tabela de serviços (SEC-LP-07, abuse 6)
    $inexistente = 999999;

    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);
    $outroConvenio = Convenio::create(['nome' => 'Outro Convênio Fictício']);
    $regra = new RegraLimiteConvenio(['periodo' => 'dia', 'limite' => 1, 'acao' => 'bloquear']);
    $regra->convenio_id = $convenio->id;
    $regra->save();

    // ACT + ASSERT — pai inexistente: nem lista nem cria
    $this->actingAs($adminDaClinica)->getJson("/api/convenios/{$inexistente}/regras")->assertNotFound();
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$inexistente}/regras", [
        'periodo' => 'dia', 'limite' => 1, 'acao' => 'bloquear',
    ])->assertNotFound();

    // filho SEMPRE pela relação do pai: a regra de um convênio não é alcançável pelo outro
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/convenios/{$outroConvenio->id}/regras/{$regra->id}", [
            'periodo' => 'dia', 'limite' => 9, 'acao' => 'avisar',
        ])->assertNotFound();
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/convenios/{$outroConvenio->id}/regras/{$regra->id}")
        ->assertNotFound();
    expect(RegraLimiteConvenio::count())->toBe(1);
});

it('deve recusar especialidade inexistente na regra', function () {
    // ARRANGE — FK validada no boundary (SEC-LP-07)
    $inexistente = 999999;

    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'especialidade_id' => $inexistente, 'periodo' => 'dia', 'limite' => 1, 'acao' => 'bloquear',
    ])->assertUnprocessable()->assertJsonValidationErrors('especialidade_id');
    expect(RegraLimiteConvenio::count())->toBe(0);
});

it('deve negar a escrita de regra sem convenios.editar e a leitura sem convenios.ver', function () {
    // ARRANGE — cenário da spec: sem a permissão não há escrita de regra
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);
    $regra = new RegraLimiteConvenio(['periodo' => 'dia', 'limite' => 1, 'acao' => 'bloquear']);
    $regra->convenio_id = $convenio->id;
    $regra->save();

    $soVe = usuarioCom(['convenios.ver'], 'Só Vê Convênios');
    $semNada = usuarioCom(['agenda.ver'], 'Sem Convênios');

    // ACT + ASSERT — leitura ok com convenios.ver; escrita 403
    $this->actingAs($soVe)->getJson("/api/convenios/{$convenio->id}/regras")->assertOk();
    $this->actingAs($soVe)->postJson("/api/convenios/{$convenio->id}/regras", [
        'periodo' => 'mes', 'limite' => 4, 'acao' => 'avisar',
    ])->assertForbidden();
    $this->actingAs($soVe)->putJsonComVersao("/api/convenios/{$convenio->id}/regras/{$regra->id}", [
        'periodo' => 'dia', 'limite' => 9, 'acao' => 'avisar',
    ])->assertForbidden();
    $this->actingAs($soVe)->deleteJson("/api/convenios/{$convenio->id}/regras/{$regra->id}")
        ->assertForbidden();

    // sem convenios.ver, nem leitura
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semNada)->getJson("/api/convenios/{$convenio->id}/regras")->assertForbidden();
    expect(RegraLimiteConvenio::count())->toBe(1);
});

it('deve auditar as mutações das regras de limite', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);

    // ACT
    $criar = $this->actingAs($adminDaClinica)->postJson("/api/convenios/{$convenio->id}/regras", [
        'periodo' => 'dia', 'limite' => 8, 'acao' => 'bloquear',
    ]);
    $criar->assertCreated();

    // ASSERT — trilha do criou com o diff em claro (regra é parametrização, não PII)
    $registro = Auditoria::where('entidade', 'regras_limite_convenio')
        ->where('acao', 'criou')->firstOrFail();
    expect($registro->usuario_id)->toBe($adminDaClinica->id)
        ->and($registro->diff_json['depois']['limite'])->toBe(8);
});

it('deve bloquear a exclusão de convênio que possui regras', function () {
    // ARRANGE — FK restrict como backstop (mesmo padrão dos serviços)
    $adminDaClinica = admin();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício']);
    $regra = new RegraLimiteConvenio(['periodo' => 'dia', 'limite' => 1, 'acao' => 'bloquear']);
    $regra->convenio_id = $convenio->id;
    $regra->save();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->deleteJson("/api/convenios/{$convenio->id}")
        ->assertUnprocessable()->assertJsonValidationErrors('convenio');
    expect(Convenio::count())->toBe(1);
});
