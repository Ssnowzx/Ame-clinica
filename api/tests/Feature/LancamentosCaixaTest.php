<?php

use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Fornecedor;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Subcategoria;
use App\Models\TipoPagamento;
use App\Models\Usuario;

/** Catálogo do dinheiro + payload de despesa válida. */
function cenarioDeLancamento(): array
{
    $conta = Conta::create(['nome' => 'Caixa Fictício '.fake()->unique()->numberBetween(1, 99999)]);
    $categoria = Categoria::create(['nome' => 'Despesa Fictícia '.fake()->unique()->numberBetween(1, 99999), 'tipo' => 'despesa']);
    $tipoPagamento = TipoPagamento::create(['nome' => 'Pgto Fictício '.fake()->unique()->numberBetween(1, 99999)]);

    return [[
        'tipo' => 'despesa',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $categoria->id,
        'valor' => '250.00',
        'tipo_pagamento_id' => $tipoPagamento->id,
        'conta_id' => $conta->id,
    ], $categoria, $conta];
}

it('deve criar lançamento com contabil default da configuração e coerências', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload, $categoriaDespesa] = cenarioDeLancamento();

    // ACT + ASSERT — contabil herda a config (default true)
    $criado = $this->postJson('/api/lancamentos', $payload);
    $criado->assertCreated()->assertJsonPath('contabil', true)
        ->assertJsonPath('liquido', '250.00');

    // categoria de natureza errada → 422 (T-fin-12)
    $this->postJson('/api/lancamentos', [...$payload, 'tipo' => 'receita'])
        ->assertUnprocessable()->assertJsonValidationErrors('categoria_id');

    // subcategoria de OUTRA categoria → 422, inclusive por PUT parcial
    $outraCategoria = Categoria::create(['nome' => 'Outra Fictícia', 'tipo' => 'despesa']);
    $subDaOutra = Subcategoria::create(['categoria_id' => $outraCategoria->id, 'nome' => 'Sub Fictícia']);
    $this->postJson('/api/lancamentos', [...$payload, 'subcategoria_id' => $subDaOutra->id])
        ->assertUnprocessable()->assertJsonValidationErrors('subcategoria_id');

    $subDaCerta = Subcategoria::create(['categoria_id' => $categoriaDespesa->id, 'nome' => 'Sub Certa Fictícia']);
    $comSub = $this->postJson('/api/lancamentos', [...$payload, 'subcategoria_id' => $subDaCerta->id])
        ->assertCreated()->json('id');
    $this->putJsonComVersao("/api/lancamentos/{$comSub}", ['categoria_id' => $outraCategoria->id])
        ->assertUnprocessable()->assertJsonValidationErrors('subcategoria_id'); // estado final
});

it('deve validar o dinheiro: positivo, duas casas e líquido nunca negativo', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload] = cenarioDeLancamento();

    // ACT + ASSERT (T-fin-06) — rejeitar, não arredondar
    $this->postJson('/api/lancamentos', [...$payload, 'valor' => '-10.00'])
        ->assertUnprocessable()->assertJsonValidationErrors('valor');
    $this->postJson('/api/lancamentos', [...$payload, 'valor' => '10.999'])
        ->assertUnprocessable()->assertJsonValidationErrors('valor');
    $this->postJson('/api/lancamentos', [...$payload, 'juros' => '-1.00'])
        ->assertUnprocessable()->assertJsonValidationErrors('juros');
    $this->postJson('/api/lancamentos', [...$payload, 'desconto' => '300.00'])
        ->assertUnprocessable()->assertJsonValidationErrors('desconto'); // líquido < 0

    // líquido negativo por PUT parcial também → 422 (estado final)
    $id = $this->postJson('/api/lancamentos', $payload)->assertCreated()->json('id');
    $this->putJsonComVersao("/api/lancamentos/{$id}", ['desconto' => '250.01'])
        ->assertUnprocessable()->assertJsonValidationErrors('desconto');
});

it('deve blindar o interessado polimórfico por tipo e no estado final', function () {
    // ARRANGE — um interessado válido de cada tipo (T-fin-11)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload] = cenarioDeLancamento();
    $paciente = Paciente::factory()->create();
    $fornecedor = Fornecedor::create(['razao_social' => 'Fornecedor Fictício Poli']);

    // ACT + ASSERT — válido por tipo, com nome na resposta via whitelist
    $comPaciente = $this->postJson('/api/lancamentos', [
        ...$payload, 'interessado_tipo' => 'paciente', 'interessado_id' => $paciente->id,
    ]);
    $comPaciente->assertCreated()->assertJsonPath('interessado.nome', $paciente->nome);

    // tipo fora do enum / par não-atômico / id órfão → 422
    $this->postJson('/api/lancamentos', [
        ...$payload, 'interessado_tipo' => 'usuario', 'interessado_id' => 1,
    ])->assertUnprocessable()->assertJsonValidationErrors('interessado_tipo');
    $this->postJson('/api/lancamentos', [...$payload, 'interessado_tipo' => 'paciente'])
        ->assertUnprocessable()->assertJsonValidationErrors('interessado_tipo');
    $this->postJson('/api/lancamentos', [
        ...$payload, 'interessado_tipo' => 'funcionario', 'interessado_id' => 999999,
    ])->assertUnprocessable()->assertJsonValidationErrors('interessado_id');

    // PUT parcial trocando SÓ o tipo (id vira órfão no novo tipo) → 422 (T-fin-12).
    // Usa 'funcionario' (nenhum criado neste teste) — o id do paciente é órfão como
    // funcionário SEMPRE. Trocar para 'fornecedor' era flaky sob --parallel: os
    // auto-increment de `pacientes` e `fornecedores` são independentes e podiam
    // coincidir por worker, fazendo o fornecedor com aquele id existir (200, não 422).
    $this->putJsonComVersao('/api/lancamentos/'.$comPaciente->json('id'), [
        'interessado_tipo' => 'funcionario',
    ])->assertUnprocessable()->assertJsonValidationErrors('interessado_id');
});

it('deve materializar parcelamento tudo-ou-nada com resto na última parcela', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload] = cenarioDeLancamento();

    // ACT — 100.00 em 3x (D4): 33.33 + 33.33 + 33.34
    $resposta = $this->postJson('/api/lancamentos', [
        ...$payload, 'valor' => '100.00', 'parcelas' => 3,
        'grupo_parcelamento' => 'forjado', 'parcela' => 99, // server-set: ignorados
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('criados', 3);
    $valores = collect($resposta->json('lancamentos'))->pluck('valor')->all();
    expect($valores)->toBe(['33.33', '33.33', '33.34']);
    $vencimentos = collect($resposta->json('lancamentos'))->pluck('vencimento')->all();
    expect($vencimentos[1])->toBe(agoraNaClinica()->addMonthsNoOverflow(1)->toDateString());
    $grupo = $resposta->json('lancamentos.0.grupo_parcelamento');
    expect($grupo)->not->toBe('forjado')
        ->and($resposta->json('lancamentos.0.parcela'))->toBe(1);

    // acima do teto → 422 e nada criado; acessórios com parcelas → 422
    $this->postJson('/api/lancamentos', [...$payload, 'parcelas' => 61])
        ->assertUnprocessable()->assertJsonValidationErrors('parcelas');
    $this->postJson('/api/lancamentos', [...$payload, 'parcelas' => 2, 'juros' => '1.00'])
        ->assertUnprocessable()->assertJsonValidationErrors('parcelas');

    // parcela de 0,00 → 422 (CR-03: valor não comporta o número de parcelas)
    $this->postJson('/api/lancamentos', [...$payload, 'valor' => '0.05', 'parcelas' => 10])
        ->assertUnprocessable()->assertJsonValidationErrors('parcelas');

    // parcelas é IMUTÁVEL na edição, e a chave NULA é presença (gatilho PROHIBITED-NULL):
    // `prohibited` a deixava passar (= "ausente OU vazio") e o contrato mentia — o
    // `messages()` prometia a recusa e a API respondia 200 descartando a chave em silêncio
    $this->putJsonComVersao("/api/lancamentos/{$resposta->json('lancamentos.0.id')}", ['parcelas' => null])
        ->assertUnprocessable()->assertJsonValidationErrors('parcelas');

    // exclusão no grupo só remove parcelas EM ABERTO
    $primeira = $resposta->json('lancamentos.0.id');
    $segunda = $resposta->json('lancamentos.1.id');
    $this->postJson("/api/lancamentos/{$segunda}/pagamento")->assertOk();
    $this->deleteJson("/api/lancamentos/{$primeira}?aplicar_no_grupo=1")->assertNoContent();
    expect(LancamentoCaixa::where('grupo_parcelamento', $grupo)->pluck('id')->all())
        ->toBe([$segunda]);
});

it('deve pagar com pago_em do servidor e tornar o lançamento pago imutável', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload] = cenarioDeLancamento();
    $id = $this->postJson('/api/lancamentos', [...$payload, 'pago_em' => '2020-01-01 00:00'])
        ->assertCreated()->json('id');

    // pago_em do payload é ignorado (T-fin-07)
    expect(LancamentoCaixa::find($id)->pago_em)->toBeNull();

    // ACT — pagar (permissão própria) → server-set na parede da clínica
    $pago = $this->postJson("/api/lancamentos/{$id}/pagamento");
    $pago->assertOk();
    expect($pago->json('pago_em'))->toStartWith(agoraNaClinica()->format('Y-m-d'));

    // ASSERT — pago é documento fiscal (T-fin-09)
    $this->putJsonComVersao("/api/lancamentos/{$id}", ['valor' => '1.00'])
        ->assertUnprocessable()->assertJsonValidationErrors('lancamento');
    $this->deleteJson("/api/lancamentos/{$id}")
        ->assertUnprocessable()->assertJsonValidationErrors('lancamento');
    $this->putJsonComVersao("/api/lancamentos/{$id}", ['obs' => 'Anotação fictícia permitida.'])
        ->assertOk(); // obs/documento não são dinheiro

    // re-pagar JÁ PAGO → 422 (CR-02: mudaria o período no extrato sem estorno)
    $this->postJson("/api/lancamentos/{$id}/pagamento")
        ->assertUnprocessable()->assertJsonValidationErrors('lancamento');

    // estorno auditado reabre; correção = estornar → editar → pagar
    $this->deleteJson("/api/lancamentos/{$id}/pagamento")->assertOk();
    expect(LancamentoCaixa::find($id)->pago_em)->toBeNull();
    $this->putJsonComVersao("/api/lancamentos/{$id}", ['valor' => '99.00'])->assertOk();

    // estornar o que NÃO está pago → 422 (CR-06)
    $this->deleteJson("/api/lancamentos/{$id}/pagamento")
        ->assertUnprocessable()->assertJsonValidationErrors('lancamento');

    // sem lancamentos.pagar → 403 (módulo próprio, parecer §3)
    $semPermissao = Usuario::factory()->create();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semPermissao)->postJson("/api/lancamentos/{$id}/pagamento")->assertForbidden();
});

it('deve mascarar obs no diff mantendo o dinheiro em claro e minimizar a listagem', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload] = cenarioDeLancamento();
    $textoSensivel = 'Observação fictícia sobre atraso da família.';
    $this->postJson('/api/lancamentos', [...$payload, 'obs' => $textoSensivel])->assertCreated();

    // ASSERT — obs mascarada; valor/pago_em em claro (parecer §1.3 — antifraude)
    $registro = Auditoria::where('entidade', 'lancamentos_caixa')->where('acao', 'criou')->firstOrFail();
    expect($registro->diff_json['depois']['obs'])->toBe('***')
        ->and($registro->diff_json['depois']['valor'])->toBe('250.00');

    // listagem sem obs (detail-only)
    $lista = $this->getJson('/api/lancamentos');
    $lista->assertOk();
    semVazamento($lista->json(), $textoSensivel);
});

it('deve filtrar a listagem por interessado (tipo + id juntos)', function () {
    // ARRANGE — dois pacientes, um lançamento para cada
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload] = cenarioDeLancamento();

    $pacienteA = Paciente::factory()->create();
    $pacienteB = Paciente::factory()->create();
    $this->postJson('/api/lancamentos', [
        ...$payload, 'interessado_tipo' => 'paciente', 'interessado_id' => $pacienteA->id,
    ])->assertCreated();
    $this->postJson('/api/lancamentos', [
        ...$payload, 'interessado_tipo' => 'paciente', 'interessado_id' => $pacienteB->id,
    ])->assertCreated();

    // ACT — filtra pelo paciente A
    $resposta = $this->getJson("/api/lancamentos?interessado_tipo=paciente&interessado_id={$pacienteA->id}");

    // ASSERT — só o lançamento do A
    $resposta->assertOk();
    $ids = collect($resposta->json('data'))->pluck('interessado.id')->unique()->all();
    expect($ids)->toBe([$pacienteA->id]);
});

it('deve rejeitar o filtro de interessado com tipo sem id (e id sem tipo)', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT + ASSERT — um sem o outro é 422, nunca ignorado em silêncio
    $this->getJson('/api/lancamentos?interessado_tipo=paciente')
        ->assertUnprocessable()->assertJsonValidationErrors('interessado_id');
    $this->getJson('/api/lancamentos?interessado_id=1')
        ->assertUnprocessable()->assertJsonValidationErrors('interessado_tipo');
    // tipo fora do enum → 422 (nunca um filtro por tipo inexistente)
    $this->getJson('/api/lancamentos?interessado_tipo=medico&interessado_id=1')
        ->assertUnprocessable()->assertJsonValidationErrors('interessado_tipo');
});
