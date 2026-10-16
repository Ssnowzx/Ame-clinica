<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Subcategoria;
use App\Models\TipoPagamento;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Gráficos Financeiros (§11) — quatro blocos de UM parâmetro só, sob `fluxo_caixa.ver`.
 *
 * Âncora fixa em 10/06/2026: a vista mistura aritmética de MÊS com janela de ANO, e
 * sem âncora um teste rodado em janeiro veria "mês anterior" cair no ano passado.
 * Junho também garante que existe passado E futuro dentro do mesmo ano — o que a
 * separação entre `vencido` e "a vencer" exige.
 *
 * LGPD: nenhum dado real; nada aqui toca cadastro de paciente.
 */
beforeEach(fn () => Carbon::setTestNow(Carbon::parse('2026-06-10 12:00:00', 'America/Sao_Paulo')));
afterEach(fn () => Carbon::setTestNow());

/** Conta, forma de pagamento e as duas naturezas de categoria da clínica. */
function catalogoDosGraficos(): array
{
    return [
        'conta' => Conta::create(['nome' => 'Caixa dos Gráficos Fictício']),
        'tipoPagamento' => TipoPagamento::create(['nome' => 'PIX dos Gráficos Fictício']),
        'receita' => Categoria::create(['nome' => 'Sessões dos Gráficos Fictícias', 'tipo' => 'receita']),
        'despesa' => Categoria::create(['nome' => 'Aluguel dos Gráficos Fictício', 'tipo' => 'despesa']),
    ];
}

it('deve quebrar por categoria separando receita de despesa pelo tipo do lançamento', function () {
    // ARRANGE — no mês: 2 receitas pagas em categorias/subcategorias distintas e
    // 1 despesa paga. (Prova a SEPARAÇÃO receita×despesa. Não prova que a natureza
    // vem do lançamento e não da categoria: o serviço proíbe categoria de natureza
    // diferente, então as duas coincidem sempre — achado CR-GF-10.)
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita, 'despesa' => $despesa] = catalogoDosGraficos();
    $sessao = Subcategoria::create(['categoria_id' => $receita->id, 'nome' => 'Sessão Fictícia de Fono']);
    $lancar = function (Categoria $categoria, string $valor, ?Subcategoria $subcategoria = null) use ($conta, $tipoPagamento): int {
        $id = $this->postJson('/api/lancamentos', [
            'tipo' => $categoria->tipo,
            'competencia' => agoraNaClinica()->toDateString(),
            'vencimento' => agoraNaClinica()->toDateString(),
            'categoria_id' => $categoria->id,
            'subcategoria_id' => $subcategoria?->id,
            'valor' => $valor,
            'tipo_pagamento_id' => $tipoPagamento->id,
            'conta_id' => $conta->id,
        ])->assertCreated()->json('id');
        $this->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();

        return $id;
    };
    $lancar($receita, '200.00', $sessao);
    $lancar($receita, '50.25');
    $lancar($despesa, '80.55');

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — receita só no bloco de recebido, despesa só no de pago, valores STRING
    $vista->assertOk();
    $recebido = collect($vista->json('recebido_por_categoria'));
    $pago = collect($vista->json('pago_por_categoria'));
    expect($recebido)->toHaveCount(2)
        ->and($recebido->firstWhere('subcategoria', 'Sessão Fictícia de Fono')['total'])->toBe('200.00')
        ->and($recebido->firstWhere('subcategoria', 'Sessão Fictícia de Fono')['categoria'])->toBe('Sessões dos Gráficos Fictícias')
        ->and($pago)->toHaveCount(1)
        ->and($pago->first()['categoria'])->toBe('Aluguel dos Gráficos Fictício')
        ->and($pago->first()['total'])->toBe('80.55');
});

it('deve mostrar o lançamento sem subcategoria como a categoria sozinha', function () {
    // ARRANGE — uma receita paga SEM subcategoria
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita] = catalogoDosGraficos();
    $id = $this->postJson('/api/lancamentos', [
        'tipo' => 'receita',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $receita->id,
        'valor' => '120.00',
        'tipo_pagamento_id' => $tipoPagamento->id,
        'conta_id' => $conta->id,
    ])->assertCreated()->json('id');
    $this->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — subcategoria NULA nas duas pontas, sem inventar nível
    $vista->assertOk();
    $linha = collect($vista->json('recebido_por_categoria'))->first();
    expect($linha['categoria'])->toBe('Sessões dos Gráficos Fictícias')
        ->and($linha['subcategoria'])->toBeNull()
        ->and($linha['subcategoria_id'])->toBeNull()
        ->and($linha['total'])->toBe('120.00');
});

it('deve ordenar a quebra por valor decrescente', function () {
    // ARRANGE — 9.00 e 100.00: a ordem tem de vir pronta do banco, porque o teto de
    // 8 linhas + cauda "Outras" da tela corta pelo FIM da lista.
    // (Não é sobre comparação de texto: o PHP compara duas strings numéricas como
    // número — `"9.00" > "100.00"` é `false`. Trocar o ORDER BY por `sortByDesc` em
    // PHP NÃO derruba este teste; remover a ordenação, sim. Achado CR-GF-09.)
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita] = catalogoDosGraficos();
    $pequena = Subcategoria::create(['categoria_id' => $receita->id, 'nome' => 'Fictícia de Nove']);
    $grande = Subcategoria::create(['categoria_id' => $receita->id, 'nome' => 'Fictícia de Cem']);
    $lancar = function (Subcategoria $subcategoria, string $valor) use ($conta, $tipoPagamento, $receita): void {
        $id = $this->postJson('/api/lancamentos', [
            'tipo' => 'receita',
            'competencia' => agoraNaClinica()->toDateString(),
            'vencimento' => agoraNaClinica()->toDateString(),
            'categoria_id' => $receita->id,
            'subcategoria_id' => $subcategoria->id,
            'valor' => $valor,
            'tipo_pagamento_id' => $tipoPagamento->id,
            'conta_id' => $conta->id,
        ])->assertCreated()->json('id');
        $this->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();
    };
    $lancar($pequena, '9.00');
    $lancar($grande, '100.00');

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — a maior primeiro
    $vista->assertOk();
    expect(collect($vista->json('recebido_por_categoria'))->pluck('total')->all())
        ->toBe(['100.00', '9.00']);
});

it('deve cobrir os 12 meses do ano na série de caixa, sem buraco', function () {
    // ARRANGE — pago em junho e pago em fevereiro do MESMO ano
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita] = catalogoDosGraficos();
    $lancarPago = function (string $valor, ?string $pagoEm = null) use ($conta, $tipoPagamento, $receita): void {
        $id = $this->postJson('/api/lancamentos', [
            'tipo' => 'receita',
            'competencia' => agoraNaClinica()->toDateString(),
            'vencimento' => agoraNaClinica()->toDateString(),
            'categoria_id' => $receita->id,
            'valor' => $valor,
            'tipo_pagamento_id' => $tipoPagamento->id,
            'conta_id' => $conta->id,
        ])->assertCreated()->json('id');
        $this->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();
        if ($pagoEm !== null) {
            DB::table('lancamentos_caixa')->where('id', $id)->update(['pago_em' => $pagoEm]);
        }
    };
    $lancarPago('300.00');
    $lancarPago('75.50', '2026-02-05 09:00:00');

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — 12 buckets de janeiro a dezembro, os parados zerados
    $vista->assertOk();
    $serie = collect($vista->json('serie_do_ano'));
    expect($serie)->toHaveCount(12)
        ->and($serie->first()['mes'])->toBe('2026-01')
        ->and($serie->last()['mes'])->toBe('2026-12')
        ->and($serie->firstWhere('mes', '2026-06')['recebidas'])->toBe('300.00')
        ->and($serie->firstWhere('mes', '2026-02')['recebidas'])->toBe('75.50')
        ->and($serie->firstWhere('mes', '2026-01')['recebidas'])->toBe('0.00')
        ->and($serie->firstWhere('mes', '2026-12')['pagas'])->toBe('0.00')
        ->and($vista->json('ano'))->toBe('2026');
});

it('deve separar os dois regimes: pago fica fora da previsão e a vencer fica fora do caixa', function () {
    // ARRANGE — 1 receita PAGA em junho e 1 receita NÃO paga vencendo em agosto
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita, 'despesa' => $despesa] = catalogoDosGraficos();
    $lancar = function (Categoria $categoria, string $valor, string $vencimento, bool $pagar) use ($conta, $tipoPagamento): void {
        $id = $this->postJson('/api/lancamentos', [
            'tipo' => $categoria->tipo,
            'competencia' => agoraNaClinica()->toDateString(),
            'vencimento' => $vencimento,
            'categoria_id' => $categoria->id,
            'valor' => $valor,
            'tipo_pagamento_id' => $tipoPagamento->id,
            'conta_id' => $conta->id,
        ])->assertCreated()->json('id');
        if ($pagar) {
            $this->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();
        }
    };
    $lancar($receita, '300.00', '2026-06-10', true);
    $lancar($receita, '480.00', '2026-08-15', false);
    $lancar($despesa, '90.00', '2026-08-20', false);

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — o pago só no caixa; o não pago só na previsão, no mês do VENCIMENTO
    $vista->assertOk();
    $caixa = collect($vista->json('serie_do_ano'));
    $previsao = collect($vista->json('previsao_do_ano'));
    expect($caixa->firstWhere('mes', '2026-06')['recebidas'])->toBe('300.00')
        ->and($caixa->firstWhere('mes', '2026-08')['recebidas'])->toBe('0.00')
        ->and($previsao)->toHaveCount(12)
        ->and($previsao->firstWhere('mes', '2026-06')['a_receber'])->toBe('0.00')
        ->and($previsao->firstWhere('mes', '2026-08')['a_receber'])->toBe('480.00')
        ->and($previsao->firstWhere('mes', '2026-08')['a_pagar'])->toBe('90.00');
});

it('deve somar em vencido só o não pago com vencimento já passado no mesmo ano', function () {
    // ARRANGE — atrasada (maio), a vencer (agosto), paga atrasada (março, não conta)
    // e uma atrasada do ANO ANTERIOR, que está fora da janela dos buckets
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita, 'despesa' => $despesa] = catalogoDosGraficos();
    $lancar = function (Categoria $categoria, string $valor, string $vencimento, bool $pagar) use ($conta, $tipoPagamento): void {
        $id = $this->postJson('/api/lancamentos', [
            'tipo' => $categoria->tipo,
            'competencia' => $vencimento,
            'vencimento' => $vencimento,
            'categoria_id' => $categoria->id,
            'valor' => $valor,
            'tipo_pagamento_id' => $tipoPagamento->id,
            'conta_id' => $conta->id,
        ])->assertCreated()->json('id');
        if ($pagar) {
            $this->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();
        }
    };
    $lancar($receita, '150.00', '2026-05-10', false);
    $lancar($despesa, '40.00', '2026-05-20', false);
    $lancar($receita, '999.00', '2026-08-10', false);
    $lancar($receita, '70.00', '2026-03-10', true);
    $lancar($receita, '888.00', '2025-11-10', false);

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — só as duas atrasadas de 2026; a paga e a de 2025 ficam fora
    $vista->assertOk();
    expect($vista->json('vencido.a_receber'))->toBe('150.00')
        ->and($vista->json('vencido.a_pagar'))->toBe('40.00');
});

it('deve manter os dois regimes sem NENHUM campo que os some', function () {
    // ARRANGE — movimento nos dois regimes, para que uma soma indevida fosse visível
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita] = catalogoDosGraficos();
    $pago = $this->postJson('/api/lancamentos', [
        'tipo' => 'receita',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => '2026-06-10',
        'categoria_id' => $receita->id,
        'valor' => '300.00',
        'tipo_pagamento_id' => $tipoPagamento->id,
        'conta_id' => $conta->id,
    ])->assertCreated()->json('id');
    $this->postJson("/api/lancamentos/{$pago}/pagamento")->assertOk();
    $this->postJson('/api/lancamentos', [
        'tipo' => 'receita',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => '2026-08-15',
        'categoria_id' => $receita->id,
        'valor' => '480.00',
        'tipo_pagamento_id' => $tipoPagamento->id,
        'conta_id' => $conta->id,
    ])->assertCreated();

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — o CONJUNTO EXATO de chaves, em cada nível: qualquer campo novo
    // (um `total_geral` somando caixa + previsão, por exemplo) derruba isto
    $vista->assertOk();
    expect(array_keys($vista->json()))->toBe([
        'mes', 'ano', 'recebido_por_categoria', 'pago_por_categoria',
        'serie_do_ano', 'previsao_do_ano', 'vencido',
    ])
        ->and(array_keys($vista->json('serie_do_ano.0')))->toBe(['mes', 'recebidas', 'pagas'])
        ->and(array_keys($vista->json('previsao_do_ano.0')))->toBe(['mes', 'a_receber', 'a_pagar'])
        ->and(array_keys($vista->json('vencido')))->toBe(['a_receber', 'a_pagar'])
        ->and(array_keys($vista->json('recebido_por_categoria.0')))->toBe([
            'categoria_id', 'categoria', 'subcategoria_id', 'subcategoria', 'total',
        ]);
});

it('deve exigir fluxo_caixa.ver, e não a permissão de lançamentos', function () {
    // ARRANGE — a vista é AGREGADO da clínica: `lancamentos.ver` não abre a porta.
    $soLancamentos = usuarioCom(['lancamentos.ver'], 'Só Lançamentos dos Gráficos');

    // ACT
    $this->actingAs($soLancamentos);
    $resposta = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT
    $resposta->assertForbidden();
});

it('deve recusar o mês ausente ou fora do formato', function () {
    // ARRANGE — já com a permissão do dono, para isolar a VALIDAÇÃO da autorização
    $this->actingAs(admin());

    // ACT + ASSERT
    $this->getJson('/api/indicadores/financeiro/graficos')->assertUnprocessable();
    $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-13')->assertUnprocessable();
    $this->getJson('/api/indicadores/financeiro/graficos?mes=junho')->assertUnprocessable();
});

it('deve medir o vencido pela parede da clínica, não pelo relógio do servidor', function () {
    // ARRANGE — 21h30 em São Paulo é 00h30 do dia SEGUINTE em UTC. Uma conta que vence
    // HOJE (10/06) não está atrasada; com `Carbon::today()` (UTC) ela entrava em
    // `vencido` todo dia das 21h à meia-noite, e "sarava" sozinha de manhã (CR-GF-01).
    Carbon::setTestNow(Carbon::parse('2026-06-10 21:30:00', 'America/Sao_Paulo'));
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita, 'despesa' => $despesa] = catalogoDosGraficos();
    $lancarAberto = function (Categoria $categoria, string $valor, string $vencimento) use ($conta, $tipoPagamento): void {
        $this->postJson('/api/lancamentos', [
            'tipo' => $categoria->tipo,
            'competencia' => $vencimento,
            'vencimento' => $vencimento,
            'categoria_id' => $categoria->id,
            'valor' => $valor,
            'tipo_pagamento_id' => $tipoPagamento->id,
            'conta_id' => $conta->id,
        ])->assertCreated();
    };
    $lancarAberto($receita, '123.45', '2026-06-10');   // vence HOJE na parede da clínica
    $lancarAberto($despesa, '77.00', '2026-06-10');    // idem
    $lancarAberto($receita, '500.00', '2026-06-09');   // esta SIM está atrasada

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — só a de ontem conta como vencida; as de hoje ainda estão no prazo
    $vista->assertOk();
    expect($vista->json('vencido.a_receber'))->toBe('500.00')
        ->and($vista->json('vencido.a_pagar'))->toBe('0.00');
});

it('deve limitar a quebra por categoria ao MÊS pedido, não à janela da série', function () {
    // ARRANGE — a delta spec diz "o movimento DO MÊS de `mes`". Sem guarda, trocar
    // `limitesDoMes` por `limitesDaSerie` (6 meses) passava batido: um pagamento de
    // fevereiro entrava na quebra de junho sem nada reprovar (achado CR-GF-02).
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita] = catalogoDosGraficos();
    $lancarPago = function (string $valor, ?string $pagoEm) use ($conta, $tipoPagamento, $receita): void {
        $id = $this->postJson('/api/lancamentos', [
            'tipo' => 'receita',
            'competencia' => agoraNaClinica()->toDateString(),
            'vencimento' => agoraNaClinica()->toDateString(),
            'categoria_id' => $receita->id,
            'valor' => $valor,
            'tipo_pagamento_id' => $tipoPagamento->id,
            'conta_id' => $conta->id,
        ])->assertCreated()->json('id');
        $this->postJson("/api/lancamentos/{$id}/pagamento")->assertOk();
        if ($pagoEm !== null) {
            DB::table('lancamentos_caixa')->where('id', $id)->update(['pago_em' => $pagoEm]);
        }
    };
    $lancarPago('310.00', null);                       // pago em junho (o mês pedido)
    $lancarPago('999.00', '2026-02-05 09:00:00');      // pago em fevereiro — DENTRO da
    $lancarPago('888.00', '2026-05-05 09:00:00');      // janela de 6 meses, FORA do mês

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — só o de junho na quebra; os outros dois aparecem na SÉRIE, não aqui
    $vista->assertOk();
    expect(collect($vista->json('recebido_por_categoria'))->pluck('total')->all())->toBe(['310.00'])
        ->and(collect($vista->json('serie_do_ano'))->firstWhere('mes', '2026-02')['recebidas'])->toBe('999.00')
        ->and(collect($vista->json('serie_do_ano'))->firstWhere('mes', '2026-05')['recebidas'])->toBe('888.00');
});

it('deve manter o vencido como RECORTE da previsão, reaparecendo no bucket do mês', function () {
    // ARRANGE — a tela AFIRMA em texto que "estes dois valores já estão contados nos
    // meses abaixo". Sem esta guarda, filtrar a previsão só para o futuro deixaria a
    // afirmação falsa e nenhum teste reclamaria (achado CR-GF-03).
    $this->actingAs(admin());
    ['conta' => $conta, 'tipoPagamento' => $tipoPagamento, 'receita' => $receita, 'despesa' => $despesa] = catalogoDosGraficos();
    $lancarAberto = function (Categoria $categoria, string $valor, string $vencimento) use ($conta, $tipoPagamento): void {
        $this->postJson('/api/lancamentos', [
            'tipo' => $categoria->tipo,
            'competencia' => $vencimento,
            'vencimento' => $vencimento,
            'categoria_id' => $categoria->id,
            'valor' => $valor,
            'tipo_pagamento_id' => $tipoPagamento->id,
            'conta_id' => $conta->id,
        ])->assertCreated();
    };
    $lancarAberto($receita, '150.00', '2026-05-10');   // atrasada
    $lancarAberto($despesa, '40.00', '2026-05-20');    // atrasada

    // ACT
    $vista = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-06');

    // ASSERT — o vencido bate E o mesmo dinheiro está no bucket de maio
    $vista->assertOk();
    $maio = collect($vista->json('previsao_do_ano'))->firstWhere('mes', '2026-05');
    expect($vista->json('vencido.a_receber'))->toBe('150.00')
        ->and($vista->json('vencido.a_pagar'))->toBe('40.00')
        ->and($maio['a_receber'])->toBe('150.00')
        ->and($maio['a_pagar'])->toBe('40.00');
});
