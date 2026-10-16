<?php

use App\Models\Cartao;
use App\Models\Conta;

/** Uma conta fictícia própria do teste. */
function contaParaCartao(): Conta
{
    return Conta::create(['nome' => 'Conta Fictícia '.fake()->unique()->numberBetween(1, 9999)]);
}

it('deve criar cartão com bandeira e persistir', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaParaCartao();

    // ACT
    $resposta = $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'bandeira' => 'mastercard',
        'pct_a_vista' => '2.99',
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('bandeira', 'mastercard');
});

it('deve recusar bandeira fora do catálogo fechado', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaParaCartao();

    // ACT + ASSERT
    $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'bandeira' => 'diners',
        'pct_a_vista' => '2.99',
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('bandeira');
});

it('deve aceitar cartão sem bandeira nenhuma', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaParaCartao();

    // ACT
    $resposta = $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'debito',
        'pct_a_vista' => '1.50',
        'dias_recebimento' => 1,
        'conta_id' => $conta->id,
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('bandeira', null);
});

it('deve persistir só as faixas de parcela informadas, sem exigir as demais', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaParaCartao();

    // ACT
    $resposta = $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'pct_parcelas' => ['2' => '3.50', '6' => '4.20'],
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ]);

    // ASSERT — só as duas faixas informadas, nada mais
    $resposta->assertCreated()->assertJsonPath('pct_parcelas', ['2' => '3.50', '6' => '4.20']);
});

it('deve recusar valor de parcela fora de 0..100 apontando a faixa', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaParaCartao();

    // ACT + ASSERT — negativo E acima de 100, nas faixas 3x e 8x
    $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'pct_parcelas' => ['3' => '-1.00', '8' => '150.00'],
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ])->assertUnprocessable()
        ->assertJsonValidationErrors(['pct_parcelas.3', 'pct_parcelas.8']);
});

it('deve recusar valor de parcela com mais de duas casas, sem arredondar', function () {
    // ARRANGE — precedente T-fin-01: rejeitar, nunca arredondar
    $this->actingAs(admin());
    $conta = contaParaCartao();

    // ACT + ASSERT
    $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'pct_parcelas' => ['4' => '3.999'],
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('pct_parcelas.4');
});

it('deve recusar chave de parcela fora de 2..12', function () {
    // ARRANGE — "1" é a taxa à vista (pct_a_vista), "13" não existe no domínio
    $this->actingAs(admin());
    $conta = contaParaCartao();

    // ACT + ASSERT
    $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'pct_parcelas' => ['1' => '2.99', '13' => '9.00'],
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('pct_parcelas');
});

it('deve persistir antecipação de crédito como cadastro, sem cálculo', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaParaCartao();

    // ACT
    $resposta = $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
        'antecipacao_credito' => true,
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('antecipacao_credito', true);
});

it('deve preservar bandeira e parcelas ao editar sem tocar nesses campos', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaParaCartao();
    $id = $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'bandeira' => 'elo',
        'pct_a_vista' => '2.99',
        'pct_parcelas' => ['2' => '3.50'],
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ])->assertCreated()->json('id');
    $versao = Cartao::findOrFail($id)->updated_at->toJSON();

    // ACT — PUT parcial, só troca o nome
    $resposta = $this->withHeader('If-Match', $versao)->putJson("/api/cartoes/{$id}", [
        'nome' => 'Maquininha Fictícia Renomeada',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ]);

    // ASSERT — bandeira e parcelas continuam como estavam
    $resposta->assertOk()
        ->assertJsonPath('bandeira', 'elo')
        ->assertJsonPath('pct_parcelas', ['2' => '3.50']);
});

it('deve recusar pct_parcelas de tipo errado com 422, nunca 500', function () {
    // ARRANGE — SEC-CART-01 (gate): a regra `array` recusa o tipo, mas o Laravel roda
    // TODAS as regras do campo mesmo com uma já falhada; sem o guard, `array_keys()`
    // sobre uma string/int/bool explodia em TypeError → 500
    $this->actingAs(admin());
    $conta = contaParaCartao();
    $base = [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ];

    // ACT + ASSERT — string, número e booleano no lugar do array
    foreach (['hack', 42, true] as $tipoErrado) {
        $this->postJson('/api/cartoes', [...$base, 'pct_parcelas' => $tipoErrado])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('pct_parcelas');
    }
});

it('deve recusar valor de parcela numérico puro, nunca persistir float', function () {
    // ARRANGE — D1: dinheiro/percentual é SEMPRE string decimal, nunca float. `numeric` e
    // `decimal:0,2` sozinhas aceitam int/float; sem a regra `string`, um valor assim
    // persistia como número no JSON em vez de "3.50" (achado do gate)
    $this->actingAs(admin());
    $conta = contaParaCartao();
    $base = [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ];

    // ACT + ASSERT — float e int puros, nas duas faixas
    $this->postJson('/api/cartoes', [...$base, 'pct_parcelas' => ['6' => 3.5]])
        ->assertUnprocessable()->assertJsonValidationErrors('pct_parcelas.6');
    $this->postJson('/api/cartoes', [...$base, 'pct_parcelas' => ['9' => 5]])
        ->assertUnprocessable()->assertJsonValidationErrors('pct_parcelas.9');
});

it('deve aceitar as faixas extremas do domínio: 9x, 10x, 11x e "12x ou mais"', function () {
    // ARRANGE — nenhum teste desta suíte tocava 9/10/11/12; "12" é a única chave de dois
    // dígitos e a mais provável de sofrer erro de digitação futuro (achado do gate: apagar
    // "12" de Cartao::PARCELAS não derrubava teste nenhum)
    $this->actingAs(admin());
    $conta = contaParaCartao();

    // ACT
    $resposta = $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'pct_parcelas' => ['9' => '5.10', '10' => '5.50', '11' => '5.90', '12' => '6.30'],
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('pct_parcelas', [
        '9' => '5.10', '10' => '5.50', '11' => '5.90', '12' => '6.30',
    ]);
});

it('deve limpar bandeira quando o PUT manda null explícito', function () {
    // ARRANGE — o front precisa mandar `bandeira: null` (nunca omitir a chave) para
    // efetivamente limpar; `sometimes` no request preserva o valor antigo quando a
    // chave está ausente
    $this->actingAs(admin());
    $conta = contaParaCartao();
    $id = $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'bandeira' => 'visa',
        'pct_a_vista' => '2.99',
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ])->assertCreated()->json('id');
    $versao = Cartao::findOrFail($id)->updated_at->toJSON();

    // ACT
    $resposta = $this->withHeader('If-Match', $versao)->putJson("/api/cartoes/{$id}", [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'bandeira' => null,
        'pct_a_vista' => '2.99',
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('bandeira', null);
});

it('deve limpar todas as parcelas quando o PUT manda pct_parcelas vazio', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaParaCartao();
    $id = $this->postJson('/api/cartoes', [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'pct_parcelas' => ['6' => '4.20'],
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ])->assertCreated()->json('id');
    $versao = Cartao::findOrFail($id)->updated_at->toJSON();

    // ACT — apagou a ÚNICA faixa que existia
    $resposta = $this->withHeader('If-Match', $versao)->putJson("/api/cartoes/{$id}", [
        'nome' => 'Maquininha Fictícia',
        'tipo' => 'credito',
        'pct_a_vista' => '2.99',
        'pct_parcelas' => [],
        'dias_recebimento' => 30,
        'conta_id' => $conta->id,
    ]);

    // ASSERT — nenhuma faixa sobra
    $resposta->assertOk();
    expect(Cartao::findOrFail($id)->pct_parcelas)->toBeEmpty();
});
