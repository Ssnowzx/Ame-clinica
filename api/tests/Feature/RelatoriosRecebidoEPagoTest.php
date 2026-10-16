<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Paciente;
use App\Models\TipoPagamento;
use App\Models\Transferencia;
use App\Support\Relatorios\RecebidoEPago;

/**
 * O relatório `recebido-e-pago` — "Recebido e pago" (change `relatorios-do-caixa`): quanto entrou
 * e saiu, e por onde. Pela data do PAGAMENTO (`pago_em`), pelo líquido; transferência não entra;
 * os totais batem com o Fluxo de caixa do mesmo período; sob `lancamentos.ver` E
 * `fluxo_caixa.ver`.
 *
 * LGPD: dados 100% fictícios.
 */

/** Setembro de 2026, a query string base do relatório. */
function setembroDoCaixa(string $extra = ''): string
{
    return '/api/relatorios/recebido-e-pago?de=2026-09-01&ate=2026-09-30'.$extra;
}

it('deve decidir o período pela data do pagamento, nunca pelo vencimento nem pela competência', function () {
    // ARRANGE — vencida e competente em agosto, paga em setembro (entra); vencida em setembro e
    // paga em outubro (não entra); em aberto (não entra)
    $this->actingAs(admin());
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia Pagante']);
    lancamentoNoCaixa('150.00', [
        'competencia' => '2026-08-20', 'vencimento' => '2026-08-20',
        'interessado_tipo' => 'paciente', 'interessado_id' => $crianca->id,
    ], ['pago_em' => '2026-09-02 08:30']);
    lancamentoNoCaixa('888.00', [], ['pago_em' => '2026-10-01 09:00']);
    lancamentoNoCaixa('777.00');

    // ACT
    $resposta = $this->getJson(setembroDoCaixa());

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('linhas'))->toBe([[
        'data' => '2026-09-02',
        'pessoa' => 'Criança Fictícia Pagante',
        'categoria' => 'Categoria Fictícia receita',
        'forma_de_pagamento' => 'PIX Fictício',
        'conta' => 'Caixa Fictício',
        'recebido' => '150.00',
        'pago' => null,
        'resultado' => '150.00',
    ]])
        ->and($resposta->json('totais'))->toBe(['recebido' => '150.00', 'pago' => '0.00', 'resultado' => '150.00']);
});

it('deve entrar pelo líquido: 200 com 10 de juros e 5 de desconto entra por 205', function () {
    // ARRANGE — o cenário da spec, e uma despesa com multa
    $this->actingAs(admin());
    lancamentoNoCaixa('200.00', ['juros' => '10.00', 'desconto' => '5.00'], ['pago_em' => '2026-09-10 10:00']);
    lancamentoNoCaixa('80.00', ['tipo' => 'despesa', 'multa' => '1.50'], ['pago_em' => '2026-09-11 10:00']);

    // ACT
    $resposta = $this->getJson(setembroDoCaixa());

    // ASSERT — a linha da despesa diz o seu efeito negativo no resultado
    expect($resposta->json('linhas.0'))->toMatchArray(['recebido' => '205.00', 'resultado' => '205.00'])
        ->and($resposta->json('linhas.1'))->toMatchArray(['pago' => '81.50', 'resultado' => '-81.50', 'recebido' => null])
        ->and($resposta->json('totais'))->toBe(['recebido' => '205.00', 'pago' => '81.50', 'resultado' => '123.50']);
});

it('deve bater com o Fluxo de caixa do mesmo período, sem contar a transferência', function (bool $soDaGaveta) {
    // ARRANGE — receitas e despesas pagas em duas contas, uma em aberto e uma transferência de 50
    // entre as contas (não é receita nem despesa)
    $this->actingAs(admin());
    $gaveta = Conta::create(['nome' => 'Gaveta Fictícia']);
    $banco = Conta::create(['nome' => 'Banco Fictício']);
    lancamentoNoCaixa('200.00', ['conta_id' => $gaveta->id, 'juros' => '3.00'], ['pago_em' => '2026-09-03 10:00']);
    lancamentoNoCaixa('120.00', ['conta_id' => $banco->id], ['pago_em' => '2026-09-04 10:00']);
    lancamentoNoCaixa('45.00', ['tipo' => 'despesa', 'conta_id' => $gaveta->id, 'desconto' => '5.00'], ['pago_em' => '2026-09-05 10:00']);
    lancamentoNoCaixa('999.00', ['conta_id' => $gaveta->id]);
    Transferencia::create(['conta_origem_id' => $gaveta->id, 'conta_destino_id' => $banco->id, 'valor' => '50.00', 'data' => '2026-09-06']);
    $conta = $soDaGaveta ? "&conta_id={$gaveta->id}" : '';

    // ACT
    $relatorio = $this->getJson(setembroDoCaixa($conta))->assertOk();
    $fluxo = $this->getJson('/api/fluxo-caixa?de=2026-09-01&ate=2026-09-30'.$conta)->assertOk();

    // ASSERT — as duas vistas contam a mesma coisa
    expect($relatorio->json('totais'))->toBe([
        'recebido' => $fluxo->json('totais.entradas'),
        'pago' => $fluxo->json('totais.saidas'),
        'resultado' => $fluxo->json('totais.saldo_do_periodo'),
    ])
        ->and($relatorio->json('totais.recebido'))->toBe($soDaGaveta ? '203.00' : '323.00')
        ->and($relatorio->json('totais.pago'))->toBe('40.00')
        ->and($relatorio->getContent())->not->toContain('50.00');
})->with([
    'a clínica inteira' => [false],
    'só a gaveta' => [true],
]);

it('deve trazer só a gaveta quando a gestora escolhe a conta, e dizer a conta no papel', function () {
    // ARRANGE — o cenário "Recebido só da gaveta"
    $this->actingAs(admin());
    $caixa = Conta::firstOrCreate(['nome' => 'Caixa']); // a conta de fábrica da clínica
    lancamentoNoCaixa('70.00', ['conta_id' => $caixa->id], ['pago_em' => '2026-09-10 10:00']);
    lancamentoNoCaixa('500.00', [], ['pago_em' => '2026-09-10 11:00']);

    // ACT
    $resposta = $this->getJson(setembroDoCaixa("&conta_id={$caixa->id}"));

    // ASSERT
    expect(collect($resposta->json('linhas'))->pluck('conta')->all())->toBe(['Caixa'])
        ->and($resposta->json('totais.recebido'))->toBe('70.00')
        ->and($resposta->json('filtros_aplicados'))->toContain(['rotulo' => 'Conta', 'valor' => 'Caixa']);
});

it('deve filtrar pela categoria', function () {
    // ARRANGE
    $this->actingAs(admin());
    $aluguel = Categoria::create(['nome' => 'Aluguel de Sala Fictício', 'tipo' => 'receita']);
    lancamentoNoCaixa('400.00', ['categoria_id' => $aluguel->id], ['pago_em' => '2026-09-10 10:00']);
    lancamentoNoCaixa('150.00', [], ['pago_em' => '2026-09-10 11:00']);

    // ACT
    $resposta = $this->getJson(setembroDoCaixa("&categoria_id={$aluguel->id}"));

    // ASSERT
    expect($resposta->json('totais.recebido'))->toBe('400.00')
        ->and($resposta->json('filtros_aplicados'))->toContain(['rotulo' => 'Categoria', 'valor' => 'Aluguel de Sala Fictício']);
});

it('deve trazer só a natureza do Tipo escolhido, com só a coluna dela', function (string $tipo, string $coluna, string $total) {
    // ARRANGE
    $this->actingAs(admin());
    lancamentoNoCaixa('150.00', [], ['pago_em' => '2026-09-10 10:00']);
    lancamentoNoCaixa('60.00', ['tipo' => 'despesa'], ['pago_em' => '2026-09-10 11:00']);

    // ACT
    $resposta = $this->getJson(setembroDoCaixa("&tipo={$tipo}"));

    // ASSERT
    expect($resposta->json('totais'))->toBe([$coluna => $total])
        ->and(collect($resposta->json('colunas'))->where('tipo', 'dinheiro')->pluck('chave')->all())->toBe([$coluna])
        ->and($resposta->json('linhas'))->toHaveCount(1);
})->with([
    'recebido' => ['recebido', 'recebido', '150.00'],
    'pago' => ['pago', 'pago', '60.00'],
]);

it('deve recusar com 422 a categoria de receita pedida com o Tipo "Pago"', function () {
    // ARRANGE
    $this->actingAs(admin());
    $receita = Categoria::create(['nome' => 'Receita Fictícia', 'tipo' => 'receita']);

    // ACT
    $resposta = $this->getJson(setembroDoCaixa("&tipo=pago&categoria_id={$receita->id}"));

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('categoria_id');
});

it('deve dividir por forma de pagamento, categoria, conta e dia, com os grupos fechando no total', function (string $divisao, array $esperado) {
    // ARRANGE — o cenário "Quanto entrou por PIX": duas formas, duas contas, dois dias
    $this->actingAs(admin());
    $dinheiro = TipoPagamento::create(['nome' => 'Dinheiro Fictício']);
    $banco = Conta::create(['nome' => 'Banco Fictício']);
    lancamentoNoCaixa('150.00', [], ['pago_em' => '2026-09-10 10:00']);
    lancamentoNoCaixa('100.00', ['tipo_pagamento_id' => $dinheiro->id, 'conta_id' => $banco->id], ['pago_em' => '2026-09-11 10:00']);
    lancamentoNoCaixa('30.00', ['tipo' => 'despesa'], ['pago_em' => '2026-09-11 15:00']);

    // ACT
    $resposta = $this->getJson(setembroDoCaixa("&resultado=sintetico&dividir_por={$divisao}"));

    // ASSERT
    $resposta->assertOk();
    $grupos = collect($resposta->json('grupos'));
    expect($grupos->map(fn (array $g) => [$g['titulo'], $g['totais']['recebido'], $g['totais']['pago'], $g['totais']['resultado']])->all())
        ->toBe($esperado)
        ->and($grupos->reduce(fn (string $soma, array $g): string => bcadd($soma, $g['totais']['resultado'], 2), '0.00'))
        ->toBe($resposta->json('totais.resultado'))
        ->and($resposta->json('totais'))->toBe(['recebido' => '250.00', 'pago' => '30.00', 'resultado' => '220.00', 'lancamentos' => 3]);
})->with([
    'forma de pagamento' => ['forma_de_pagamento', [['Dinheiro Fictício', '100.00', '0.00', '100.00'], ['PIX Fictício', '150.00', '30.00', '120.00']]],
    'categoria' => ['categoria', [['Categoria Fictícia despesa', '0.00', '30.00', '-30.00'], ['Categoria Fictícia receita', '250.00', '0.00', '250.00']]],
    'conta' => ['conta', [['Banco Fictício', '100.00', '0.00', '100.00'], ['Caixa Fictício', '150.00', '30.00', '120.00']]],
    'dia' => ['dia', [['10/09/2026', '150.00', '0.00', '150.00'], ['11/09/2026', '100.00', '30.00', '70.00']]],
]);

it('deve pôr cada total na coluna de dinheiro de mesma chave, em todo tipo e resultado', function (string $extra) {
    // ARRANGE — a tela só desenha na linha de totais a chave que também é coluna
    $this->actingAs(admin());
    lancamentoNoCaixa('150.00', [], ['pago_em' => '2026-09-10 10:00']);
    lancamentoNoCaixa('60.00', ['tipo' => 'despesa'], ['pago_em' => '2026-09-10 11:00']);

    // ACT
    $resposta = $this->getJson(setembroDoCaixa($extra));

    // ASSERT — a coluna de dinheiro é a chave do total, nos dois sentidos
    $colunas = collect($resposta->json('colunas'));
    $dinheiro = $colunas->where('tipo', 'dinheiro')->pluck('chave')->all();
    expect($dinheiro)->not->toBeEmpty()
        ->and(array_values(array_diff($dinheiro, array_keys($resposta->json('totais')))))->toBe([])
        ->and(array_values(array_diff(array_keys($resposta->json('totais')), $colunas->pluck('chave')->all())))->toBe([]);
})->with([
    'analítico, os dois tipos' => [''],
    'analítico, recebido' => ['&tipo=recebido'],
    'analítico, pago' => ['&tipo=pago'],
    'sintético, os dois tipos' => ['&resultado=sintetico&dividir_por=forma_de_pagamento'],
    'sintético, pago' => ['&tipo=pago&resultado=sintetico&dividir_por=dia'],
]);

it('deve declarar a base no cabeçalho do papel', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT
    $resposta = $this->getJson(setembroDoCaixa());

    // ASSERT
    expect($resposta->json('filtros_aplicados.0'))->toBe(['rotulo' => 'Base', 'valor' => 'Pela data do pagamento']);
});

it('deve negar com 403, antes de validar, quem não tem as duas permissões do caixa', function (array $permissoes) {
    // ARRANGE
    admin();
    $restrito = usuarioCom($permissoes, 'Restrito Fictício');

    // ACT
    $resposta = $this->actingAs($restrito)->getJson('/api/relatorios/recebido-e-pago?de=nada');

    // ASSERT
    $resposta->assertForbidden();
})->with([
    'só lançamentos' => [['lancamentos.ver', 'lancamentos.criar', 'lancamentos.pagar']],
    'só o fluxo de caixa' => [['fluxo_caixa.ver']],
]);

it('deve cortar o analítico no limite, com o total do recorte inteiro', function () {
    // ARRANGE
    $this->actingAs(admin());
    foreach (['10.00', '20.00', '30.00'] as $valor) {
        lancamentoNoCaixa($valor, [], ['pago_em' => '2026-09-10 10:00']);
    }
    app()->bind(RecebidoEPago::class, fn () => new RecebidoEPago(limiteDeLinhas: 2));

    // ACT
    $resposta = $this->getJson(setembroDoCaixa());

    // ASSERT
    expect($resposta->json('linhas'))->toHaveCount(2)
        ->and($resposta->json('truncado'))->toBeTrue()
        ->and($resposta->json('totais.recebido'))->toBe('60.00');
});
