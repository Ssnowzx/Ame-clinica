<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Fornecedor;
use App\Models\Paciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Relatorios\ContasEmAberto;
use Carbon\Carbon;

/**
 * O relatório `contas-em-aberto` — "Contas a pagar e a receber" (change `relatorios-do-caixa`):
 * quem deve e o que vence. Só o que está EM ABERTO, pelo VENCIMENTO no período; a situação de
 * cada linha na parede da clínica; totais a receber, a pagar e atrasado por natureza, somados no
 * banco pelo líquido; sob `lancamentos.ver` E `fluxo_caixa.ver`.
 *
 * "Hoje" é 15/09/2026 na parede da clínica em todos os testes (o relógio é fixado em cada um).
 *
 * LGPD: dados 100% fictícios.
 */

/** Setembro de 2026, a query string base do relatório. */
function setembroEmAberto(string $extra = ''): string
{
    return '/api/relatorios/contas-em-aberto?de=2026-09-01&ate=2026-09-30'.$extra;
}

/** 15/09/2026 ao meio-dia de São Paulo — o "hoje" dos testes. */
function hojeEmAberto(): void
{
    test()->travelTo(Carbon::parse('2026-09-15 15:00:00', 'UTC'));
}

/** @return array{crianca: Paciente, fornecedor: Fornecedor} */
function pessoasEmAberto(): array
{
    return [
        'crianca' => Paciente::factory()->create(['nome' => 'Criança Fictícia Devedora']),
        'fornecedor' => Fornecedor::create(['razao_social' => 'Fornecedor Fictício Ltda']),
    ];
}

it('deve listar só o que está em aberto com vencimento no período, com pessoa, categoria, conta e situação', function () {
    // ARRANGE — em aberto em setembro (entra), pago em setembro (não entra: "o pago não aparece")
    // e em aberto vencendo em outubro (fora do período)
    hojeEmAberto();
    $this->actingAs(admin());
    ['crianca' => $crianca] = pessoasEmAberto();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $crianca->id];
    lancamentoNoCaixa('150.00', [...$daCrianca, 'vencimento' => '2026-09-10']);
    lancamentoNoCaixa('999.00', [...$daCrianca, 'vencimento' => '2026-09-12'], ['pago_em' => '2026-09-12 10:00']);
    lancamentoNoCaixa('777.00', [...$daCrianca, 'vencimento' => '2026-10-02']);

    // ACT
    $resposta = $this->getJson(setembroEmAberto());

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('linhas'))->toBe([[
        'vencimento' => '2026-09-10',
        'situacao' => 'Atrasado há 5 dias',
        'pessoa' => 'Criança Fictícia Devedora',
        'categoria' => 'Categoria Fictícia receita',
        'conta' => 'Caixa Fictício',
        'a_receber' => '150.00',
        'a_pagar' => null,
        'atrasado_a_receber' => '150.00',
        'atrasado_a_pagar' => null,
    ]])
        ->and($resposta->getContent())->not->toContain('999')
        ->and($resposta->getContent())->not->toContain('777');
});

it('deve dizer a situação pela parede da clínica, e vencer hoje não é atraso', function () {
    // ARRANGE — 16/09 às 02:00 em UTC ainda é 15/09 às 23:00 em São Paulo: um "hoje" em UTC
    // daria "Atrasado há 1 dia" ao que vence hoje
    $this->travelTo(Carbon::parse('2026-09-16 02:00:00', 'UTC'));
    $this->actingAs(admin());
    foreach (['2026-09-12', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-20'] as $vencimento) {
        lancamentoNoCaixa('10.00', ['vencimento' => $vencimento]);
    }

    // ACT
    $resposta = $this->getJson(setembroEmAberto());

    // ASSERT
    expect(collect($resposta->json('linhas'))->pluck('situacao')->all())->toBe([
        'Atrasado há 3 dias', 'Atrasado há 1 dia', 'Vence hoje', 'Vence em 1 dia', 'Vence em 5 dias',
    ])
        ->and($resposta->json('totais.atrasado_a_receber'))->toBe('20.00');
});

it('deve somar a receber, a pagar e o atrasado de cada natureza pelo líquido com juros, multa e desconto', function () {
    // ARRANGE — receita de 200 com 10 de juros e 5 de desconto (vale 205, atrasada), receita de
    // 100 a vencer; despesa de 80 com 2 de multa (vale 82, atrasada) e despesa de 50 a vencer
    hojeEmAberto();
    $this->actingAs(admin());
    lancamentoNoCaixa('200.00', ['vencimento' => '2026-09-05', 'juros' => '10.00', 'desconto' => '5.00']);
    lancamentoNoCaixa('100.00', ['vencimento' => '2026-09-25']);
    lancamentoNoCaixa('80.00', ['tipo' => 'despesa', 'vencimento' => '2026-09-01', 'multa' => '2.00']);
    lancamentoNoCaixa('50.00', ['tipo' => 'despesa', 'vencimento' => '2026-09-30']);

    // ACT
    $resposta = $this->getJson(setembroEmAberto());

    // ASSERT
    expect($resposta->json('totais'))->toBe([
        'a_receber' => '305.00',
        'a_pagar' => '132.00',
        'atrasado_a_receber' => '205.00',
        'atrasado_a_pagar' => '82.00',
    ])
        ->and($resposta->json('linhas.0'))->toMatchArray(['vencimento' => '2026-09-01', 'a_pagar' => '82.00', 'atrasado_a_pagar' => '82.00', 'a_receber' => null])
        ->and($resposta->json('linhas.1'))->toMatchArray(['vencimento' => '2026-09-05', 'a_receber' => '205.00', 'atrasado_a_receber' => '205.00']);
});

it('deve trazer só as receitas com o Tipo "Receber", com o valor, a criança, o atraso e o total atrasado', function () {
    // ARRANGE — o cenário da spec: a gestora cobra setembro
    hojeEmAberto();
    $this->actingAs(admin());
    ['crianca' => $crianca, 'fornecedor' => $fornecedor] = pessoasEmAberto();
    lancamentoNoCaixa('150.00', ['vencimento' => '2026-09-08', 'interessado_tipo' => 'paciente', 'interessado_id' => $crianca->id]);
    lancamentoNoCaixa('90.00', ['vencimento' => '2026-09-20', 'interessado_tipo' => 'paciente', 'interessado_id' => $crianca->id]);
    lancamentoNoCaixa('300.00', ['tipo' => 'despesa', 'vencimento' => '2026-09-08', 'interessado_tipo' => 'fornecedor', 'interessado_id' => $fornecedor->id]);

    // ACT
    $receber = $this->getJson(setembroEmAberto('&tipo=receber'));
    $pagar = $this->getJson(setembroEmAberto('&tipo=pagar'));

    // ASSERT — a coluna "Atrasado" é a do tipo escolhido, e o papel diz o tipo
    expect(collect($receber->json('linhas'))->map(fn (array $l) => [$l['pessoa'], $l['situacao'], $l['a_receber']])->all())
        ->toBe([['Criança Fictícia Devedora', 'Atrasado há 7 dias', '150.00'], ['Criança Fictícia Devedora', 'Vence em 5 dias', '90.00']])
        ->and($receber->json('totais'))->toBe(['a_receber' => '240.00', 'atrasado_a_receber' => '150.00'])
        ->and(collect($receber->json('colunas'))->where('tipo', 'dinheiro')->pluck('rotulo', 'chave')->all())
        ->toBe(['a_receber' => 'A receber', 'atrasado_a_receber' => 'Atrasado'])
        ->and($receber->json('filtros_aplicados'))->toContain(['rotulo' => 'Tipo', 'valor' => 'Receber'])
        ->and(collect($pagar->json('linhas'))->pluck('pessoa')->all())->toBe(['Fornecedor Fictício Ltda'])
        ->and($pagar->json('totais'))->toBe(['a_pagar' => '300.00', 'atrasado_a_pagar' => '300.00']);
});

it('deve filtrar pela conta e pela categoria, e dizer as duas no papel', function () {
    // ARRANGE — a mesma natureza em duas contas e duas categorias
    hojeEmAberto();
    $this->actingAs(admin());
    $banco = Conta::create(['nome' => 'Banco Fictício']);
    $aluguel = Categoria::create(['nome' => 'Aluguel de Sala Fictício', 'tipo' => 'receita']);
    lancamentoNoCaixa('100.00');
    lancamentoNoCaixa('200.00', ['conta_id' => $banco->id]);
    lancamentoNoCaixa('400.00', ['conta_id' => $banco->id, 'categoria_id' => $aluguel->id]);

    // ACT
    $doBanco = $this->getJson(setembroEmAberto("&conta_id={$banco->id}"));
    $doAluguel = $this->getJson(setembroEmAberto("&conta_id={$banco->id}&categoria_id={$aluguel->id}"));

    // ASSERT
    expect($doBanco->json('totais.a_receber'))->toBe('600.00')
        ->and($doBanco->json('filtros_aplicados'))->toContain(['rotulo' => 'Conta', 'valor' => 'Banco Fictício'])
        ->and($doAluguel->json('totais.a_receber'))->toBe('400.00')
        ->and($doAluguel->json('filtros_aplicados'))->toContain(['rotulo' => 'Categoria', 'valor' => 'Aluguel de Sala Fictício']);
});

it('deve recusar com 422 a categoria de despesa pedida com o Tipo "Receber"', function () {
    // ARRANGE — pedido incoerente: a folha vazia seria lida como "ninguém deve"
    $this->actingAs(admin());
    $despesa = Categoria::create(['nome' => 'Despesa Fictícia', 'tipo' => 'despesa']);

    // ACT
    $resposta = $this->getJson(setembroEmAberto("&tipo=receber&categoria_id={$despesa->id}"));

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('categoria_id');
});

it('deve dividir por categoria, por pessoa e por mês de vencimento, com os grupos fechando no total', function (string $divisao, array $esperado) {
    // ARRANGE — a criança deve 150 (atrasado) e 90; o fornecedor recebe 300; uma receita sem pessoa
    hojeEmAberto();
    $this->actingAs(admin());
    ['crianca' => $crianca, 'fornecedor' => $fornecedor] = pessoasEmAberto();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $crianca->id];
    lancamentoNoCaixa('150.00', [...$daCrianca, 'vencimento' => '2026-09-08']);
    lancamentoNoCaixa('90.00', [...$daCrianca, 'vencimento' => '2026-10-20']);
    lancamentoNoCaixa('300.00', ['tipo' => 'despesa', 'vencimento' => '2026-09-20', 'interessado_tipo' => 'fornecedor', 'interessado_id' => $fornecedor->id]);
    lancamentoNoCaixa('40.00', ['vencimento' => '2026-09-25']);

    // ACT — setembro e outubro, para o mês de vencimento ter dois grupos
    $resposta = $this->getJson("/api/relatorios/contas-em-aberto?de=2026-09-01&ate=2026-10-31&resultado=sintetico&dividir_por={$divisao}");

    // ASSERT
    $resposta->assertOk();
    $grupos = collect($resposta->json('grupos'));
    expect($grupos->map(fn (array $g) => [$g['titulo'], $g['totais']['a_receber'], $g['totais']['a_pagar'], $g['totais']['lancamentos']])->all())
        ->toBe($esperado)
        ->and($grupos->reduce(fn (string $soma, array $g): string => bcadd($soma, $g['totais']['a_receber'], 2), '0.00'))
        ->toBe($resposta->json('totais.a_receber'))
        ->and($resposta->json('totais'))->toBe([
            'a_receber' => '280.00', 'a_pagar' => '300.00', 'atrasado_a_receber' => '150.00', 'atrasado_a_pagar' => '0.00', 'lancamentos' => 4,
        ]);
})->with([
    'categoria' => ['categoria', [['Categoria Fictícia despesa', '0.00', '300.00', 1], ['Categoria Fictícia receita', '280.00', '0.00', 3]]],
    'pessoa' => ['pessoa', [['Criança Fictícia Devedora', '240.00', '0.00', 2], ['Fornecedor Fictício Ltda', '0.00', '300.00', 1], ['Sem pessoa', '40.00', '0.00', 1]]],
    'mês de vencimento' => ['mes', [['setembro de 2026', '190.00', '300.00', 3], ['outubro de 2026', '90.00', '0.00', 1]]],
]);

it('deve pôr cada total na coluna de dinheiro de mesma chave, em todo tipo e resultado', function (string $extra) {
    // ARRANGE — a tela só desenha na linha de totais a chave que também é coluna; um total com
    // outro nome some do papel em silêncio (lição do `recebido-por-profissional`)
    hojeEmAberto();
    $this->actingAs(admin());
    lancamentoNoCaixa('150.00', ['vencimento' => '2026-09-05']);
    lancamentoNoCaixa('80.00', ['tipo' => 'despesa', 'vencimento' => '2026-09-05']);

    // ACT
    $resposta = $this->getJson(setembroEmAberto($extra));

    // ASSERT — a coluna de dinheiro é a chave do total, nos dois sentidos
    $colunas = collect($resposta->json('colunas'));
    $dinheiro = $colunas->where('tipo', 'dinheiro')->pluck('chave')->all();
    expect($dinheiro)->not->toBeEmpty()
        ->and(array_values(array_diff($dinheiro, array_keys($resposta->json('totais')))))->toBe([])
        ->and(array_values(array_diff(array_keys($resposta->json('totais')), $colunas->pluck('chave')->all())))->toBe([]);
})->with([
    'analítico, os dois tipos' => [''],
    'analítico, receber' => ['&tipo=receber'],
    'analítico, pagar' => ['&tipo=pagar'],
    'sintético, os dois tipos' => ['&resultado=sintetico&dividir_por=categoria'],
    'sintético, receber' => ['&tipo=receber&resultado=sintetico&dividir_por=pessoa'],
]);

it('deve declarar a base no cabeçalho do papel', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT
    $resposta = $this->getJson(setembroEmAberto());

    // ASSERT
    expect($resposta->json('filtros_aplicados.0'))->toBe(['rotulo' => 'Base', 'valor' => 'Pelo vencimento, só o que está em aberto']);
});

it('deve negar com 403, antes de validar, quem não tem as duas permissões do caixa', function (array $permissoes) {
    // ARRANGE — o cenário "Sem ver o caixa": quem lança não vê o total da clínica (2026-07-19)
    admin();
    $restrito = usuarioCom($permissoes, 'Restrito Fictício');

    // ACT — período inválido: o 403 vem antes do 422
    $resposta = $this->actingAs($restrito)->getJson('/api/relatorios/contas-em-aberto?de=nada');

    // ASSERT
    $resposta->assertForbidden();
})->with([
    'só lançamentos' => [['lancamentos.ver', 'lancamentos.criar', 'lancamentos.pagar']],
    'só o fluxo de caixa' => [['fluxo_caixa.ver']],
]);

it('deve abrir a quem tem lancamentos.ver e fluxo_caixa.ver', function () {
    // ARRANGE — o par mínimo; o 403 acima é por falta, não por nível
    admin();
    $gestao = usuarioCom(['lancamentos.ver', 'fluxo_caixa.ver'], 'Gestão Fictícia');

    // ACT
    $resposta = $this->actingAs($gestao)->getJson(setembroEmAberto());

    // ASSERT
    $resposta->assertOk();
});

it('deve cortar o analítico no limite, com o total do recorte inteiro', function () {
    // ARRANGE — limite injetado de 2 linhas; 3 contas em aberto
    hojeEmAberto();
    $this->actingAs(admin());
    foreach (['10.00', '20.00', '30.00'] as $valor) {
        lancamentoNoCaixa($valor);
    }
    app()->bind(ContasEmAberto::class, fn () => new ContasEmAberto(app(ConfiguracaoService::class), limiteDeLinhas: 2));

    // ACT
    $resposta = $this->getJson(setembroEmAberto('&tipo=receber'));

    // ASSERT
    expect($resposta->json('linhas'))->toHaveCount(2)
        ->and($resposta->json('truncado'))->toBeTrue()
        ->and($resposta->json('totais.a_receber'))->toBe('60.00');
});
