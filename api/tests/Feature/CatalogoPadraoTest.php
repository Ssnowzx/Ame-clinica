<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\TipoPagamento;
use App\Support\Financeiro\CatalogoPadrao;

/** Conta o catálogo do dinheiro da clínica. */
function catalogoDaClinica(): array
{
    return [
        'contas' => Conta::count(),
        'tipos_pagamento' => TipoPagamento::count(),
        'categorias' => Categoria::count(),
    ];
}

/** Esvazia o catálogo da clínica — o estado da clínica ANTES desta change. */
function esvaziarCatalogo(): void
{
    Categoria::query()->delete();
    TipoPagamento::query()->delete();
    Conta::query()->delete();
}

it('deve fazer a clínica NASCER com o catálogo do dinheiro', function () {
    // ARRANGE + ACT — o gancho é o `ClinicaObserver`, não o seeder: a clínica também nasce de
    // factory (o `TestCase` a cria), do importador da virada e (um dia) de uma tela

    // ASSERT
    expect(catalogoDaClinica())
        ->toBe(['contas' => 1, 'tipos_pagamento' => 5, 'categorias' => 2]);
    expect(Conta::where('nome', 'Caixa')->exists())->toBeTrue();
    expect(TipoPagamento::pluck('nome')->sort()->values()->all())
        ->toBe(['Cartão de crédito', 'Cartão de débito', 'Dinheiro', 'PIX', 'Transferência']);
    expect(Categoria::where('tipo', 'receita')->value('nome'))->toBe('Atendimentos');
    expect(Categoria::where('tipo', 'despesa')->value('nome'))->toBe('Despesas da clínica');
});

it('deve semear o que falta numa clínica que já perdeu parte do catálogo', function () {
    // ARRANGE — o caso REAL da clínica: alguém já criou "Caixa" e "PIX" à mão
    esvaziarCatalogo();
    Conta::create(['nome' => 'Caixa']);
    TipoPagamento::create(['nome' => 'PIX']);

    // ACT
    $criados = app(CatalogoPadrao::class)->aplicar();

    // ASSERT — só o que faltava
    expect($criados)->toBe(['contas' => 0, 'tipos_pagamento' => 4, 'categorias' => 2]);
    expect(catalogoDaClinica())
        ->toBe(['contas' => 1, 'tipos_pagamento' => 5, 'categorias' => 2]);
});

it('deve ser idempotente: aplicar de novo não cria nem duplica nada', function () {
    // ARRANGE — a clínica já nasce completa

    // ACT
    $criados = app(CatalogoPadrao::class)->aplicar();

    // ASSERT
    expect($criados)->toBe(['contas' => 0, 'tipos_pagamento' => 0, 'categorias' => 0]);
    expect(catalogoDaClinica())
        ->toBe(['contas' => 1, 'tipos_pagamento' => 5, 'categorias' => 2]);
});

it('deve semear pelo comando e relatar o que criou', function () {
    // ARRANGE — o caso da clínica que já está no ar sem catálogo
    esvaziarCatalogo();

    // ACT + ASSERT
    $this->artisan('financeiro:catalogo-padrao')
        ->expectsOutputToContain('1 conta(s), 5 forma(s) de pagamento e 2 categoria(s)')
        ->assertExitCode(0);
    expect(catalogoDaClinica())
        ->toBe(['contas' => 1, 'tipos_pagamento' => 5, 'categorias' => 2]);
});

it('deve relatar zero na segunda passada do comando, sem duplicar', function () {
    // ARRANGE — a clínica já nasce completa

    // ACT + ASSERT
    $this->artisan('financeiro:catalogo-padrao')
        ->expectsOutputToContain('0 conta(s), 0 forma(s) de pagamento e 0 categoria(s)')
        ->assertExitCode(0);
    expect(catalogoDaClinica())
        ->toBe(['contas' => 1, 'tipos_pagamento' => 5, 'categorias' => 2]);
});
