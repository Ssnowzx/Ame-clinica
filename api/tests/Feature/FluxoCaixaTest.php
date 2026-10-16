<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\TipoPagamento;
use App\Models\Usuario;
use Illuminate\Support\Facades\DB;

/** Duas contas + categorias das duas naturezas + tipo. */
function cenarioDeFluxo(): array
{
    return [
        Conta::create(['nome' => 'Caixa Principal Fictício '.fake()->unique()->numberBetween(1, 99999)]),
        Conta::create(['nome' => 'Banco Fictício '.fake()->unique()->numberBetween(1, 99999)]),
        Categoria::create(['nome' => 'Receitas Fictícias '.fake()->unique()->numberBetween(1, 99999), 'tipo' => 'receita']),
        Categoria::create(['nome' => 'Despesas Fictícias '.fake()->unique()->numberBetween(1, 99999), 'tipo' => 'despesa']),
        TipoPagamento::create(['nome' => 'Dinheiro Fictício '.fake()->unique()->numberBetween(1, 99999)]),
    ];
}

function novoLancamentoDeFluxo(Conta $conta, Categoria $categoria, TipoPagamento $tipo, string $valor, bool $pagar): int
{
    $id = test()->postJson('/api/lancamentos', [
        'tipo' => $categoria->tipo,
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $categoria->id,
        'valor' => $valor,
        'tipo_pagamento_id' => $tipo->id,
        'conta_id' => $conta->id,
    ])->assertCreated()->json('id');

    if ($pagar) {
        test()->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();
    }

    return $id;
}

it('deve validar transferências entre contas distintas da clínica', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$origem, $destino] = cenarioDeFluxo();

    // ACT + ASSERT (T-fin-19)
    $this->postJson('/api/transferencias', [
        'conta_origem_id' => $origem->id, 'conta_destino_id' => $origem->id,
        'valor' => '50.00', 'data' => agoraNaClinica()->toDateString(),
    ])->assertUnprocessable()->assertJsonValidationErrors('conta_destino_id');

    $this->postJson('/api/transferencias', [
        'conta_origem_id' => $origem->id, 'conta_destino_id' => $destino->id,
        'valor' => '0.00', 'data' => agoraNaClinica()->toDateString(),
    ])->assertUnprocessable()->assertJsonValidationErrors('valor');

    $this->postJson('/api/transferencias', [
        'conta_origem_id' => $origem->id, 'conta_destino_id' => $destino->id,
        'valor' => '50.00', 'data' => agoraNaClinica()->toDateString(),
    ])->assertCreated();
});

it('deve montar o extrato em regime de caixa sem dupla contagem de transferência', function () {
    // ARRANGE — receita paga 200, despesa paga 80, receita EM ABERTO 999,
    // transferência 50 entre contas
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$contaA, $contaB, $receita, $despesa, $tipoPagamento] = cenarioDeFluxo();
    novoLancamentoDeFluxo($contaA, $receita, $tipoPagamento, '200.00', pagar: true);
    novoLancamentoDeFluxo($contaA, $despesa, $tipoPagamento, '80.00', pagar: true);
    novoLancamentoDeFluxo($contaA, $receita, $tipoPagamento, '999.00', pagar: false);
    $this->postJson('/api/transferencias', [
        'conta_origem_id' => $contaA->id, 'conta_destino_id' => $contaB->id,
        'valor' => '50.00', 'data' => agoraNaClinica()->toDateString(),
    ])->assertCreated();

    $hoje = agoraNaClinica()->toDateString();

    // ACT
    $extrato = $this->getJson("/api/fluxo-caixa?de={$hoje}&ate={$hoje}");

    // ASSERT — regime de caixa (D6): aberto fora; transferência fora dos totais
    $extrato->assertOk()
        ->assertJsonPath('totais.entradas', '200.00')
        ->assertJsonPath('totais.saidas', '80.00')
        ->assertJsonPath('totais.saldo_do_periodo', '120.00')
        ->assertJsonPath('totais.transferido', '50.00');
    $movimentos = collect($extrato->json('movimentos'));
    expect($movimentos)->toHaveCount(3)
        ->and($movimentos->pluck('movimento'))->not->toContain('receita em aberto')
        ->and(json_encode($extrato->json()))->not->toContain('999.00');

    // filtro por conta: transferência aparece para origem E destino
    $extratoB = $this->getJson("/api/fluxo-caixa?de={$hoje}&ate={$hoje}&conta_id={$contaB->id}");
    $extratoB->assertOk()->assertJsonPath('totais.entradas', '0.00');
    expect(collect($extratoB->json('movimentos'))->pluck('movimento')->all())->toBe(['transferencia']);
});

it('deve impor teto de janela e filtro inerte no extrato', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$contaDoOutroLado] = [null];
    $de = agoraNaClinica()->subDays(370)->toDateString();
    $ate = agoraNaClinica()->toDateString();

    // ACT + ASSERT — janela > 366 dias → 422 (T-fin-20)
    $this->getJson("/api/fluxo-caixa?de={$de}&ate={$ate}")
        ->assertUnprocessable();
    $this->getJson('/api/fluxo-caixa')->assertUnprocessable(); // de/ate obrigatórios

    // teto de movimentos (CR-04): 2001 pagos no dia → 422 pedindo refino
    [$conta, , $receita, , $tipoPagamento] = cenarioDeFluxo();
    $agoraDaParede = agoraNaClinica()->format('Y-m-d H:i:s');
    $linhas = collect(range(1, 2001))->map(fn (int $numero) => [
        'tipo' => 'receita',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $receita->id,
        'valor' => '1.00',
        'tipo_pagamento_id' => $tipoPagamento->id,
        'conta_id' => $conta->id,
        'contabil' => true,
        'pago_em' => $agoraDaParede,
        'created_at' => $agoraDaParede,
        'updated_at' => $agoraDaParede,
    ]);
    foreach ($linhas->chunk(500) as $bloco) {
        DB::table('lancamentos_caixa')->insert($bloco->all());
    }
    $hoje = agoraNaClinica()->toDateString();
    $this->getJson("/api/fluxo-caixa?de={$hoje}&ate={$hoje}")
        ->assertUnprocessable();

    // conta sem movimento → vazio
    $contaVazia = Conta::create(['nome' => 'Conta Vazia Fictícia']);
    $this->actingAs($adminDaClinica)
        ->getJson("/api/fluxo-caixa?de={$hoje}&ate={$hoje}&conta_id={$contaVazia->id}")
        ->assertOk()->assertJsonPath('totais.entradas', '0.00')
        ->assertJsonPath('movimentos', []);

    // 403 sem a permissão dos agregados (fluxo_caixa.ver — totais-do-caixa)
    $semPermissao = Usuario::factory()->create();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semPermissao)->getJson("/api/fluxo-caixa?de={$hoje}&ate={$hoje}")
        ->assertForbidden();
});
