<?php

use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Fornecedor;
use App\Models\Paciente;
use App\Models\TipoPagamento;
use App\Models\Transferencia;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Relatorios\MovimentacaoDoFinanceiro;
use Carbon\Carbon;

/**
 * O relatório `movimentacao-do-financeiro` (change `relatorios-do-caixa`): quem criou, alterou,
 * deu baixa, estornou ou excluiu lançamentos e transferências, lido da TRILHA. O tipo sai do
 * diff (D5); a pessoa e o valor do estado atual, o do excluído do `antes`; a `obs` nunca sai;
 * sob `auditoria.ver` E `lancamentos.ver`.
 *
 * O relógio fica em 15/09/2026 (meio-dia em São Paulo) nos testes que gravam trilha.
 *
 * LGPD: dados 100% fictícios.
 */

/** 15 de setembro de 2026 — a query string base do relatório. */
function diaDaMovimentacaoFinanceira(string $extra = '', string $dia = '2026-09-15'): string
{
    return "/api/relatorios/movimentacao-do-financeiro?de={$dia}&ate={$dia}".$extra;
}

/**
 * O catálogo mínimo do caixa e a criança.
 *
 * @return array{categoria: Categoria, forma: TipoPagamento, conta: Conta, crianca: Paciente}
 */
function catalogoDaMovimentacaoFinanceira(): array
{
    return [
        'categoria' => Categoria::firstOrCreate(['nome' => 'Receita Fictícia da Movimentação', 'tipo' => 'receita']),
        'forma' => TipoPagamento::firstOrCreate(['nome' => 'PIX Fictício da Movimentação']),
        'conta' => Conta::firstOrCreate(['nome' => 'Caixa Fictício da Movimentação']),
        'crianca' => Paciente::factory()->create(['nome' => 'Criança Fictícia da Movimentação']),
    ];
}

/**
 * As seis ações pelo caminho REAL, como um usuário (a trilha só grava o autor em requisição):
 * A é criado, alterado (valor 150 → 160), pago e estornado; B nasce pago; C nasce e é excluído.
 *
 * @param  array{categoria: Categoria, forma: TipoPagamento, conta: Conta, crianca: Paciente}  $catalogo
 * @return array{a: int, b: int, c: int}
 */
function seisAcoesNoCaixa(array $catalogo, ?Fornecedor $fornecedor = null): array
{
    $payload = fn (string $valor, array $extra = []): array => [
        'tipo' => 'receita', 'competencia' => '2026-09-15', 'vencimento' => '2026-09-15',
        'categoria_id' => $catalogo['categoria']->id, 'tipo_pagamento_id' => $catalogo['forma']->id,
        'conta_id' => $catalogo['conta']->id, 'valor' => $valor,
        'interessado_tipo' => 'paciente', 'interessado_id' => $catalogo['crianca']->id, ...$extra,
    ];

    $a = test()->postJson('/api/lancamentos', $payload('150.00'))->assertCreated()->json('id');
    $b = test()->postJson('/api/lancamentos', $payload('80.00', ['pagar_agora' => true]))->assertCreated()->json('id');
    test()->putJsonComVersao("/api/lancamentos/{$a}", ['valor' => '160.00'])->assertOk();
    test()->postJson("/api/lancamentos/{$a}/pagamento")->assertOk();
    test()->deleteJson("/api/lancamentos/{$a}/pagamento")->assertOk();
    $c = test()->postJson('/api/lancamentos', $payload('40.00', $fornecedor === null ? [] : [
        'interessado_tipo' => 'fornecedor', 'interessado_id' => $fornecedor->id,
    ]))->assertCreated()->json('id');
    test()->deleteJson("/api/lancamentos/{$c}")->assertNoContent();

    return ['a' => $a, 'b' => $b, 'c' => $c];
}

it('deve exigir auditoria.ver E lancamentos.ver, recusando com 403 quem tem só uma delas, antes de validar', function () {
    // ARRANGE — o cenário "Só auditoria"; os usuários nascem ANTES da primeira requisição
    admin();
    $soAuditoria = usuarioCom(['auditoria.ver'], 'Só auditoria');
    $soLancamentos = usuarioCom(['lancamentos.ver'], 'Só lançamentos');
    $asDuas = usuarioCom(['auditoria.ver', 'lancamentos.ver'], 'Auditoria e lançamentos');

    // ACT + ASSERT
    $this->actingAs($soAuditoria)->getJson('/api/relatorios/movimentacao-do-financeiro?de=nada')->assertForbidden();
    trocarDeUsuario();
    $this->actingAs($soLancamentos)->getJson('/api/relatorios/movimentacao-do-financeiro?de=nada')->assertForbidden();
    trocarDeUsuario();
    $this->actingAs($asDuas)->getJson(diaDaMovimentacaoFinanceira())->assertOk();
});

it('deve derivar do diff criado, criado e pago, alterado, pago, estornado e excluído, com quem fez', function () {
    // ARRANGE
    $this->travelTo(Carbon::parse('2026-09-15 15:00:00', 'UTC'));
    $gestora = admin();
    $gestora->update(['nome' => 'Gestora Fictícia']);
    $this->actingAs($gestora);
    $fornecedor = Fornecedor::create(['razao_social' => 'Fornecedor Fictício Excluído']);
    ['a' => $a, 'b' => $b, 'c' => $c] = seisAcoesNoCaixa(catalogoDaMovimentacaoFinanceira(), $fornecedor);

    // ACT
    $resposta = $this->getJson(diaDaMovimentacaoFinanceira());

    // ASSERT — em ordem cronológica; o A mostra o valor ATUAL (160) em todas as linhas; o C,
    // que não existe mais, sai do `antes` do `excluiu`
    $resposta->assertOk();
    expect(collect($resposta->json('linhas'))->map(fn (array $l) => [$l['tipo'], $l['registro'], $l['natureza'], $l['pessoa'], $l['valor'], $l['por']])->all())
        ->toBe([
            ['Criado', "Lançamento nº {$a}", 'Receita', 'Criança Fictícia da Movimentação', '160.00', 'Gestora Fictícia'],
            ['Criado e pago', "Lançamento nº {$b}", 'Receita', 'Criança Fictícia da Movimentação', '80.00', 'Gestora Fictícia'],
            ['Alterado', "Lançamento nº {$a}", 'Receita', 'Criança Fictícia da Movimentação', '160.00', 'Gestora Fictícia'],
            ['Pago', "Lançamento nº {$a}", 'Receita', 'Criança Fictícia da Movimentação', '160.00', 'Gestora Fictícia'],
            ['Estornado', "Lançamento nº {$a}", 'Receita', 'Criança Fictícia da Movimentação', '160.00', 'Gestora Fictícia'],
            ['Criado', "Lançamento nº {$c}", 'Receita', 'Fornecedor Fictício Excluído', '40.00', 'Gestora Fictícia'],
            ['Excluído', "Lançamento nº {$c}", 'Receita', 'Fornecedor Fictício Excluído', '40.00', 'Gestora Fictícia'],
        ])
        ->and($resposta->json('linhas.0'))->toMatchArray(['data' => '2026-09-15', 'hora' => '12:00']);
});

it('deve filtrar pelo tipo derivado, com o "criado e pago" nos filtros criado e pago', function (string $tipo, array $esperado) {
    // ARRANGE — o cenário "Quem estornou" entre as seis ações
    $this->travelTo(Carbon::parse('2026-09-15 15:00:00', 'UTC'));
    $this->actingAs(admin());
    seisAcoesNoCaixa(catalogoDaMovimentacaoFinanceira());

    // ACT
    $resposta = $this->getJson(diaDaMovimentacaoFinanceira("&tipo={$tipo}"));

    // ASSERT
    expect(collect($resposta->json('linhas'))->pluck('tipo')->all())->toBe($esperado)
        ->and($resposta->json('filtros_aplicados.1.rotulo'))->toBe('Movimentação');
})->with([
    'estornado' => ['estornado', ['Estornado']],
    'criado' => ['criado', ['Criado', 'Criado e pago', 'Criado']],
    'pago' => ['pago', ['Criado e pago', 'Pago']],
    'alterado' => ['alterado', ['Alterado']],
    'excluído' => ['excluido', ['Excluído']],
]);

it('não deve deixar sair a observação do lançamento nem a da transferência, que a trilha guarda em claro', function () {
    // ARRANGE — a `obs` do lançamento vai MASCARADA para a trilha; a da transferência vai CRUA
    // (não está no `auditExclude`), inclusive no `antes` do `excluiu`
    $this->travelTo(Carbon::parse('2026-09-15 15:00:00', 'UTC'));
    $this->actingAs(admin());
    $catalogo = catalogoDaMovimentacaoFinanceira();
    $banco = Conta::create(['nome' => 'Banco Fictício da Movimentação']);
    $lancamento = lancamentoNoCaixa('150.00', ['obs' => 'Observação sigilosa fictícia do lançamento']);
    $lancamento->update(['obs' => 'Outra observação sigilosa fictícia do lançamento']);
    $transferencia = Transferencia::create([
        'conta_origem_id' => $catalogo['conta']->id, 'conta_destino_id' => $banco->id,
        'valor' => '50.00', 'data' => '2026-09-15', 'obs' => 'Observação sigilosa fictícia da transferência',
    ]);
    $transferencia->update(['obs' => 'Segunda observação sigilosa fictícia da transferência']);
    $transferencia->delete();

    // ACT
    $respostas = collect(['', '&resultado=sintetico&dividir_por=pessoa', '&resultado=sintetico&dividir_por=tipo'])
        ->map(fn (string $extra) => $this->getJson(diaDaMovimentacaoFinanceira($extra))->assertOk()->json());

    // ASSERT — a transferência aparece (contas e valor), a observação nunca
    expect(collect($respostas[0]['linhas'])->where('natureza', 'Transferência')->pluck('pessoa')->unique()->all())
        ->toBe(['Caixa Fictício da Movimentação → Banco Fictício da Movimentação'])
        ->and(collect($respostas[0]['linhas'])->where('natureza', 'Transferência')->pluck('valor')->unique()->all())->toBe(['50.00']);
    foreach ($respostas as $json) {
        semVazamento($json, 'sigilosa');
    }
});

it('deve dizer "Lançamento excluído" quando o registro sumiu sem deixar o instantâneo', function () {
    // ARRANGE — trilha anterior ao `excluiu` (ou lançamento apagado por fora do model)
    $this->travelTo(Carbon::parse('2026-09-15 15:00:00', 'UTC'));
    $this->actingAs(admin());
    Auditoria::create([
        'autor_tipo' => 'sistema', 'entidade' => 'lancamentos_caixa', 'entidade_id' => 987654,
        'acao' => 'criou', 'diff_json' => ['depois' => ['valor' => '10.00']], 'criado_em' => now(),
    ]);

    // ACT
    $resposta = $this->getJson(diaDaMovimentacaoFinanceira());

    // ASSERT
    expect($resposta->json('linhas.0'))->toMatchArray([
        'tipo' => 'Criado', 'registro' => 'Lançamento nº 987654', 'pessoa' => 'Lançamento excluído', 'valor' => null, 'por' => 'Sistema',
    ]);
});

it('deve dividir por quem fez e por tipo, com os grupos fechando no total', function (string $divisao, array $esperado) {
    // ARRANGE — um lançamento lançado pelo SISTEMA (antes de qualquer requisição) e as seis
    // ações da gestora
    $this->travelTo(Carbon::parse('2026-09-15 15:00:00', 'UTC'));
    $gestora = admin();
    $gestora->update(['nome' => 'Gestora Fictícia']);
    lancamentoNoCaixa('10.00');
    $this->actingAs($gestora);
    seisAcoesNoCaixa(catalogoDaMovimentacaoFinanceira());

    // ACT
    $resposta = $this->getJson(diaDaMovimentacaoFinanceira("&resultado=sintetico&dividir_por={$divisao}"));

    // ASSERT
    $resposta->assertOk();
    $grupos = collect($resposta->json('grupos'));
    expect($grupos->map(fn (array $g) => [$g['titulo'], $g['totais']['acoes']])->all())->toBe($esperado)
        ->and($grupos->sum(fn (array $g) => $g['totais']['acoes']))->toBe($resposta->json('totais.acoes'))
        ->and($resposta->json('totais'))->toBe(['acoes' => 8]);
})->with([
    'quem fez' => ['pessoa', [['Gestora Fictícia', 7], ['Sistema', 1]]],
    'tipo' => ['tipo', [['Criado', 3], ['Criado e pago', 1], ['Alterado', 1], ['Pago', 1], ['Estornado', 1], ['Excluído', 1]]],
]);

it('deve ler o período na parede da clínica, não em UTC', function () {
    // ARRANGE — 16/09 às 01:00 UTC é 15/09 às 22:00 em São Paulo
    $this->travelTo(Carbon::parse('2026-09-16 01:00:00', 'UTC'));
    $this->actingAs(admin());
    lancamentoNoCaixa('10.00');

    // ACT
    $dia15 = $this->getJson(diaDaMovimentacaoFinanceira('', '2026-09-15'));
    $dia16 = $this->getJson(diaDaMovimentacaoFinanceira('', '2026-09-16'));

    // ASSERT
    expect($dia15->json('linhas.0'))->toMatchArray(['data' => '2026-09-15', 'hora' => '22:00'])
        ->and($dia16->json('linhas'))->toBe([]);
});

it('deve deixar o valor sem total — somar criar, alterar e excluir não é dinheiro de ninguém', function () {
    // ARRANGE — nos relatórios de SOMA a coluna de dinheiro é a chave do total; aqui o valor é de
    // CONFERÊNCIA (o mesmo lançamento criado e excluído somaria duas vezes o mesmo dinheiro)
    $this->travelTo(Carbon::parse('2026-09-15 15:00:00', 'UTC'));
    $this->actingAs(admin());
    lancamentoNoCaixa('10.00')->delete();

    // ACT
    $analitico = $this->getJson(diaDaMovimentacaoFinanceira());
    $sintetico = $this->getJson(diaDaMovimentacaoFinanceira('&resultado=sintetico&dividir_por=tipo'));

    // ASSERT — nenhum total de dinheiro; o do sintético é a contagem, e ela É coluna
    expect(collect($analitico->json('colunas'))->where('tipo', 'dinheiro')->pluck('chave')->all())->toBe(['valor'])
        ->and($analitico->json('totais'))->toBe(['quantidade' => 2])
        ->and($sintetico->json('totais'))->toBe(['acoes' => 2])
        ->and(collect($sintetico->json('colunas'))->pluck('chave')->all())->toBe(['grupo', 'acoes']);
});

it('deve declarar a base no cabeçalho do papel', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT
    $resposta = $this->getJson(diaDaMovimentacaoFinanceira());

    // ASSERT
    expect($resposta->json('filtros_aplicados.0'))->toBe(['rotulo' => 'Base', 'valor' => 'Pela data da ação']);
});

it('deve cortar o analítico no limite', function () {
    // ARRANGE — limite injetado de 2 linhas; 3 criações
    $this->travelTo(Carbon::parse('2026-09-15 15:00:00', 'UTC'));
    $this->actingAs(admin());
    foreach (['10.00', '20.00', '30.00'] as $valor) {
        lancamentoNoCaixa($valor);
    }
    app()->bind(MovimentacaoDoFinanceiro::class, fn () => new MovimentacaoDoFinanceiro(app(ConfiguracaoService::class), limiteDeLinhas: 2));

    // ACT
    $resposta = $this->getJson(diaDaMovimentacaoFinanceira());

    // ASSERT
    expect($resposta->json('linhas'))->toHaveCount(2)
        ->and($resposta->json('truncado'))->toBeTrue();
});
