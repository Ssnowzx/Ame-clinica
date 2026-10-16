<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\NivelPermissao;
use App\Models\TipoPagamento;
use Database\Seeders\CatalogoPermissoesSeeder;
use Spatie\Permission\PermissionRegistrar;

/**
 * Change totais-do-caixa: os AGREGADOS financeiros da clínica (extrato com totais,
 * série dos indicadores, relatório por período) saem de `lancamentos.ver` e passam
 * para `fluxo_caixa.ver` (D1). O 403 do servidor é o contrato; o front é cortesia (D4).
 */

/** Receita PAGA de valor distintivo na clínica — o segredo que as portas guardam. */
function receitaPagaDosTotais(string $valor): void
{
    $conta = Conta::create(['nome' => 'Caixa dos Totais Fictício '.fake()->unique()->numberBetween(1, 99999)]);
    $categoria = Categoria::create(['nome' => 'Receita dos Totais Fictícia '.fake()->unique()->numberBetween(1, 99999), 'tipo' => 'receita']);
    $tipo = TipoPagamento::create(['nome' => 'PIX dos Totais Fictício '.fake()->unique()->numberBetween(1, 99999)]);

    $id = test()->postJson('/api/lancamentos', [
        'tipo' => 'receita',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $categoria->id,
        'valor' => $valor,
        'tipo_pagamento_id' => $tipo->id,
        'conta_id' => $conta->id,
    ])->assertCreated()->json('id');
    test()->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();
}

it('deve negar as três portas de agregado a quem tem só lancamentos.ver, sem entregar nenhum total', function () {
    // ARRANGE — receita paga de valor distintivo; usuário que opera lançamentos um a um
    // (o nível restrito nasce ANTES do tráfego HTTP: auth:sanctum troca o guard default)
    $adminDaClinica = admin();
    $soLancamentos = usuarioCom(['lancamentos.ver'], 'Recepção dos Totais');
    $this->actingAs($adminDaClinica);
    receitaPagaDosTotais('731.77');
    $hoje = agoraNaClinica()->toDateString();
    $mes = agoraNaClinica()->format('Y-m');

    // ACT + ASSERT — 403 por porta e o valor NUNCA no corpo (D4: o servidor é o contrato)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($soLancamentos);
    $portas = [
        "/api/fluxo-caixa?de={$hoje}&ate={$hoje}",
        "/api/indicadores/painel/dinheiro?mes={$mes}",
        "/api/indicadores/financeiro/graficos?mes={$mes}",
        "/api/relatorios/financeiro-por-periodo?de={$hoje}&ate={$hoje}",
    ];
    foreach ($portas as $porta) {
        $resposta = $this->getJson($porta);
        $resposta->assertForbidden();
        semVazamento($resposta->json(), '731.77');
    }
});

it('deve abrir as três portas de agregado a quem tem fluxo_caixa.ver', function () {
    // ARRANGE — movimento real na clínica; usuário SÓ com a permissão dos agregados
    $adminDaClinica = admin();
    $gestor = usuarioCom(['fluxo_caixa.ver'], 'Gestão dos Totais');
    $this->actingAs($adminDaClinica);
    receitaPagaDosTotais('200.00');
    $hoje = agoraNaClinica()->toDateString();
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($gestor);
    $extrato = $this->getJson("/api/fluxo-caixa?de={$hoje}&ate={$hoje}");
    $painel = $this->getJson("/api/indicadores/painel/dinheiro?mes={$mes}");
    $relatorio = $this->getJson("/api/relatorios/financeiro-por-periodo?de={$hoje}&ate={$hoje}");

    // ASSERT — movimentos e totais como hoje (a superfície não mudou, só a permissão)
    $extrato->assertOk()
        ->assertJsonPath('totais.entradas', '200.00')
        ->assertJsonCount(1, 'movimentos');
    $painel->assertOk()->assertJsonPath('recebido.atual', '200.00');
    $relatorio->assertOk()->assertJsonPath('totais.receitas', '200.00');
});

it('deve manter a lista de lançamentos sob lancamentos.ver, paginando sem nenhum agregado junto', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $soLancamentos = usuarioCom(['lancamentos.ver'], 'Faturista dos Totais');
    $this->actingAs($adminDaClinica);
    receitaPagaDosTotais('150.00');

    // ACT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $lista = $this->actingAs($soLancamentos)->getJson('/api/lancamentos');

    // ASSERT — a operação por-lançamento segue intacta; nenhum total da clínica no payload
    $lista->assertOk()
        ->assertJsonPath('total', 1)
        ->assertJsonPath('data.0.valor', '150.00')
        ->assertJsonMissingPath('totais');
});

it('deve nascer o Administrador da clínica com fluxo_caixa.ver', function () {
    // ACT — a clínica do teste nasce pelo `ClinicaObserver`
    $clinica = clinica();

    // ASSERT — o catálogo completo do observer inclui a permissão dos agregados
    expect($clinica->exists)->toBeTrue();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    expect($administrador->hasPermissionTo('fluxo_caixa.ver'))->toBeTrue();
});

it('deve ressincronizar o Administrador da clínica existente sem backfill para quem tem lancamentos.ver', function () {
    // ARRANGE — clínica "antiga": Administrador sem a permissão nova; nível restrito
    // com lancamentos.ver (a recepção/faturista de AP-10)
    $adminDaClinica = admin();
    $recepcao = usuarioCom(['lancamentos.ver'], 'Recepção Antiga dos Totais');
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $administrador->revokePermissionTo('fluxo_caixa.ver');
    app(PermissionRegistrar::class)->forgetCachedPermissions();
    expect($adminDaClinica->fresh()->can('fluxo_caixa.ver'))->toBeFalse();

    // ACT — o que a migration de deploy roda (padrão CatalogoPermissoesSeeder)
    $this->seed(CatalogoPermissoesSeeder::class);

    // ASSERT — Administrador ressincronizado; o nível restrito NÃO ganha nada (D2:
    // perder os totais é o objetivo — conceder de volta é decisão na tela de Níveis)
    $adminRecarregado = $adminDaClinica->fresh()->unsetRelation('roles')->unsetRelation('permissions');
    $recepcaoRecarregada = $recepcao->fresh()->unsetRelation('roles')->unsetRelation('permissions');
    expect($adminRecarregado->can('fluxo_caixa.ver'))->toBeTrue()
        ->and($recepcaoRecarregada->can('fluxo_caixa.ver'))->toBeFalse()
        ->and($recepcaoRecarregada->can('lancamentos.ver'))->toBeTrue();
});
