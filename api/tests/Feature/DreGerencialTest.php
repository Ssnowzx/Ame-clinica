<?php

use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\Subcategoria;
use App\Models\TipoPagamento;
use App\Models\Transferencia;
use App\Support\Financeiro\EscadaDoDre;
use Illuminate\Support\Facades\DB;

/**
 * Change `dre-gerencial`: a escada, a linha de cada categoria (com o padrão da natureza) e o
 * relatório. Valores e nomes 100% fictícios.
 */

/** Uma categoria fictícia da natureza dada, apontada para a linha (null = padrão). */
function categoriaDoDre(string $nome, string $tipo, ?string $linha = null): Categoria
{
    $categoria = Categoria::create(['nome' => $nome, 'tipo' => $tipo]);
    if ($linha !== null) {
        $categoria->forceFill(['linha_dre' => $linha])->save();
    }

    return $categoria->refresh();
}

/** Um lançamento na categoria; pago em `$pagoEm` (null = em aberto), com a competência dada. */
function lancamentoDoDre(Categoria $categoria, string $valor, ?string $pagoEm, string $competencia = '2026-09-01', array $extra = []): LancamentoCaixa
{
    $lancamento = new LancamentoCaixa([
        'tipo' => $categoria->tipo, 'competencia' => $competencia, 'vencimento' => $competencia, 'valor' => $valor,
        'contabil' => true, 'categoria_id' => $categoria->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'Forma do DRE'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Conta do DRE'])->id,
        ...$extra,
    ]);
    $lancamento->pago_em = $pagoEm;
    $lancamento->save();

    return $lancamento;
}

/** A linha do DRE pelo rótulo, na resposta. */
function linhaDoDre($resposta, string $rotulo): array
{
    return collect($resposta->json('linhas'))->firstWhere('linha', $rotulo) ?? [];
}

it('deve montar a escada do mês com os subtotais da spec', function () {
    // ARRANGE — o cenário da spec: 30.000 de serviços, 2.000 de impostos, 9.000 de repasse,
    // 12.000 de administrativas e 500 de tarifas
    $this->actingAs(admin());
    lancamentoDoDre(categoriaDoDre('Atendimentos Fictícios', 'receita', 'servicos'), '30000.00', '2026-09-10 10:00');
    lancamentoDoDre(categoriaDoDre('Simples Fictício', 'despesa', 'impostos'), '2000.00', '2026-09-20 10:00');
    lancamentoDoDre(categoriaDoDre('Repasse Fictício', 'despesa', 'repasse'), '9000.00', '2026-09-25 10:00');
    lancamentoDoDre(categoriaDoDre('Aluguel Fictício', 'despesa', 'administrativas'), '12000.00', '2026-09-05 10:00');
    lancamentoDoDre(categoriaDoDre('Tarifas Fictícias', 'despesa', 'despesas_financeiras'), '500.00', '2026-09-30 10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30');

    // ASSERT
    $resposta->assertOk();
    expect(linhaDoDre($resposta, 'Receita líquida')['m_2026_09'])->toBe('28000.00')
        ->and(linhaDoDre($resposta, 'Lucro bruto')['m_2026_09'])->toBe('19000.00')
        ->and(linhaDoDre($resposta, 'Resultado operacional')['m_2026_09'])->toBe('7000.00')
        ->and(linhaDoDre($resposta, 'Resultado líquido')['m_2026_09'])->toBe('6500.00')
        ->and(linhaDoDre($resposta, 'Resultado final')['total'])->toBe('6500.00')
        ->and(linhaDoDre($resposta, '(−) Deduções')['m_2026_09'])->toBe('-2000.00')
        ->and(linhaDoDre($resposta, 'Resultado líquido')['destaque'])->toBeTrue()
        ->and(linhaDoDre($resposta, 'Aluguel Fictício')['nivel'])->toBe(2);
});

it('deve pôr no padrão da natureza a categoria sem linha, e avisar', function () {
    // ARRANGE — nada configurado
    $this->actingAs(admin());
    lancamentoDoDre(categoriaDoDre('Sessões Fictícias', 'receita'), '1000.00', '2026-09-10 10:00');
    lancamentoDoDre(categoriaDoDre('Luz Fictícia', 'despesa'), '300.00', '2026-09-10 10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30');

    // ASSERT — nunca zerado em silêncio
    expect(linhaDoDre($resposta, 'Prestação de serviços')['total'])->toBe('1000.00')
        ->and(linhaDoDre($resposta, 'Despesas administrativas')['total'])->toBe('-300.00')
        ->and($resposta->json('avisos.0'))->toContain('Configurar DRE');
});

it('deve deixar a linha da subcategoria vencer a da categoria', function () {
    // ARRANGE
    $this->actingAs(admin());
    $pessoal = categoriaDoDre('Pessoal Fictício', 'despesa', 'pessoal');
    $vale = Subcategoria::create(['categoria_id' => $pessoal->id, 'nome' => 'Rendimento Fictício']);
    $vale->forceFill(['linha_dre' => 'despesas_financeiras'])->save();
    lancamentoDoDre($pessoal, '100.00', '2026-09-10 10:00');
    lancamentoDoDre($pessoal, '40.00', '2026-09-10 10:00', extra: ['subcategoria_id' => $vale->id]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30');

    // ASSERT
    expect(linhaDoDre($resposta, 'Despesas com pessoal')['total'])->toBe('-100.00')
        ->and(linhaDoDre($resposta, 'Despesas financeiras')['total'])->toBe('-40.00');
});

it('deve usar o pagamento ou a competência conforme a base', function () {
    // ARRANGE — serviço de setembro pago em outubro
    $this->actingAs(admin());
    lancamentoDoDre(categoriaDoDre('Atendimentos Fictícios', 'receita', 'servicos'), '500.00', '2026-10-03 10:00', '2026-09-01');

    // ACT
    $pagamento = $this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-10-31');
    $competencia = $this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-10-31&tipo=competencia');

    // ASSERT
    expect(linhaDoDre($pagamento, 'Prestação de serviços')['m_2026_10'])->toBe('500.00')
        ->and(linhaDoDre($pagamento, 'Prestação de serviços')['m_2026_09'])->toBe('0.00')
        ->and(linhaDoDre($competencia, 'Prestação de serviços')['m_2026_09'])->toBe('500.00');
});

it('deve deixar fora o que está em aberto pela base do pagamento, e incluir pela competência', function () {
    // ARRANGE
    $this->actingAs(admin());
    lancamentoDoDre(categoriaDoDre('Atendimentos Fictícios', 'receita', 'servicos'), '700.00', null, '2026-09-01');

    // ACT + ASSERT
    expect(linhaDoDre($this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30'), 'Prestação de serviços')['total'])->toBe('0.00')
        ->and(linhaDoDre($this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30&tipo=competencia'), 'Prestação de serviços')['total'])->toBe('700.00');
});

it('deve filtrar só os contábeis quando pedido', function () {
    // ARRANGE
    $this->actingAs(admin());
    $categoria = categoriaDoDre('Atendimentos Fictícios', 'receita', 'servicos');
    lancamentoDoDre($categoria, '100.00', '2026-09-10 10:00');
    lancamentoDoDre($categoria, '50.00', '2026-09-10 10:00', extra: ['contabil' => false]);

    // ACT + ASSERT
    expect(linhaDoDre($this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30&somente_contabeis=1'), 'Prestação de serviços')['total'])->toBe('100.00')
        ->and(linhaDoDre($this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30'), 'Prestação de serviços')['total'])->toBe('150.00');
});

it('deve somar o líquido e deixar a transferência de fora', function () {
    // ARRANGE — 200 + 10 de juros − 5 de desconto; uma transferência de 999 não é resultado
    $this->actingAs(admin());
    lancamentoDoDre(categoriaDoDre('Atendimentos Fictícios', 'receita', 'servicos'), '200.00', '2026-09-10 10:00', extra: ['juros' => '10.00', 'desconto' => '5.00']);
    Transferencia::create([
        'conta_origem_id' => Conta::firstOrCreate(['nome' => 'Conta do DRE'])->id,
        'conta_destino_id' => Conta::create(['nome' => 'Banco do DRE'])->id,
        'valor' => '999.00', 'data' => '2026-09-10',
    ]);

    // ACT + ASSERT
    expect(linhaDoDre($this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30'), 'Resultado final')['total'])->toBe('205.00');
});

it('deve negar o DRE a quem não vê o caixa da clínica', function () {
    // ARRANGE
    admin();
    $semCaixa = usuarioCom(['lancamentos.ver'], 'Sem caixa do DRE');

    // ACT + ASSERT
    $this->actingAs($semCaixa)->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30')->assertForbidden();
    $this->actingAs($semCaixa)->getJson('/api/dre/linhas')->assertForbidden();
});

// ==================== configurar ====================

it('deve listar a escada e onde cada categoria cai, contando as do padrão', function () {
    // ARRANGE
    $this->actingAs(admin());
    categoriaDoDre('Aluguel Fictício', 'despesa', 'administrativas');
    categoriaDoDre('Luz Fictícia', 'despesa');

    // ACT
    $resposta = $this->getJson('/api/dre/linhas');

    // ASSERT
    $resposta->assertOk();
    $luz = collect($resposta->json('categorias'))->firstWhere('nome', 'Luz Fictícia');
    expect($luz)->toMatchArray(['linha_dre' => null, 'linha_efetiva' => 'administrativas'])
        ->and($resposta->json('no_padrao'))->toBeGreaterThanOrEqual(1)
        ->and(collect($resposta->json('linhas'))->pluck('codigo'))->toContain('repasse');
});

it('deve trocar a linha, auditar, e voltar ao padrão com null', function () {
    // ARRANGE
    $this->actingAs(admin());
    $categoria = categoriaDoDre('Repasse Fictício', 'despesa');

    // ACT
    $this->putJsonComVersao("/api/categorias/{$categoria->id}/linha-dre", ['linha_dre' => 'repasse'])->assertOk();
    $depois = $categoria->fresh()->linha_dre;
    $this->putJsonComVersao("/api/categorias/{$categoria->id}/linha-dre", ['linha_dre' => null])->assertOk();

    // ASSERT
    expect($depois)->toBe('repasse')
        ->and($categoria->fresh()->linha_dre)->toBeNull()
        ->and(Auditoria::where('entidade', 'categorias')->where('entidade_id', $categoria->id)->where('acao', 'atualizou')->count())->toBe(2);
});

it('deve recusar linha da natureza errada e código desconhecido', function (string $linha) {
    // ARRANGE
    $this->actingAs(admin());
    $despesa = categoriaDoDre('Despesa Fictícia', 'despesa');

    // ACT + ASSERT
    $this->putJsonComVersao("/api/categorias/{$despesa->id}/linha-dre", ['linha_dre' => $linha])
        ->assertUnprocessable()->assertJsonValidationErrors('linha_dre');
    expect($despesa->fresh()->linha_dre)->toBeNull();
})->with([
    'receita numa despesa' => ['servicos'],
    'código inventado' => ['lucro_magico'],
]);

it('deve seguir a natureza da categoria ao trocar a linha da subcategoria', function () {
    // ARRANGE
    $this->actingAs(admin());
    $receita = categoriaDoDre('Receita Fictícia', 'receita', 'servicos');
    $sub = Subcategoria::create(['categoria_id' => $receita->id, 'nome' => 'Aluguel de sala fictício']);

    // ACT + ASSERT
    $this->putJsonComVersao("/api/subcategorias/{$sub->id}/linha-dre", ['linha_dre' => 'outras_receitas'])->assertOk();
    $this->putJsonComVersao("/api/subcategorias/{$sub->id}/linha-dre", ['linha_dre' => 'pessoal'])->assertUnprocessable();
    expect($sub->fresh()->linha_dre)->toBe('outras_receitas');
});

it('deve exigir categorias.editar e fluxo_caixa.ver para trocar a linha', function (array $permissoes) {
    // ARRANGE
    admin();
    $categoria = categoriaDoDre('Categoria Fictícia', 'despesa');
    $usuario = usuarioCom($permissoes, 'Meio acesso DRE '.implode('-', $permissoes));

    // ACT + ASSERT
    $this->actingAs($usuario)->putJsonComVersao("/api/categorias/{$categoria->id}/linha-dre", ['linha_dre' => 'pessoal'])->assertForbidden();
})->with([
    'só edita categorias' => [['categorias.ver', 'categorias.editar']],
    'só vê o caixa' => [['categorias.ver', 'fluxo_caixa.ver']],
]);

it('não deve expor escada com código fora do catálogo', function () {
    // ARRANGE + ACT + ASSERT — toda linha de grupo aponta para uma linha que existe
    foreach (EscadaDoDre::ESCADA as $degrau) {
        foreach ($degrau['linhas'] ?? [] as $codigo) {
            expect(EscadaDoDre::existe($codigo))->toBeTrue();
        }
    }
    expect(collect(EscadaDoDre::ESCADA)->flatMap(fn (array $d): array => $d['linhas'] ?? [])->sort()->values()->all())
        ->toBe(collect(array_keys(EscadaDoDre::LINHAS))->sort()->values()->all());
});

it('deve recusar trocar a natureza de uma categoria em uso', function () {
    // ARRANGE — SEC-FIN-01: quem só edita categorias virava receita em despesa e invertia o
    // resultado do DRE, sem poder ver o DRE
    $this->actingAs(admin());
    $categoria = categoriaDoDre('Atendimentos Fictícios', 'receita');
    lancamentoDoDre($categoria, '100.00', '2026-09-10 10:00');

    // ACT
    $resposta = $this->putJsonComVersao("/api/categorias/{$categoria->id}", ['nome' => 'Atendimentos Fictícios', 'tipo' => 'despesa']);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('tipo');
    expect($categoria->fresh()->tipo)->toBe('receita');
});

it('deve deixar trocar a natureza da categoria que ninguém usa', function () {
    // ARRANGE
    $this->actingAs(admin());
    $categoria = categoriaDoDre('Categoria Nova Fictícia', 'receita');

    // ACT + ASSERT
    $this->putJsonComVersao("/api/categorias/{$categoria->id}", ['nome' => 'Categoria Nova Fictícia', 'tipo' => 'despesa'])->assertOk();
    expect($categoria->fresh()->tipo)->toBe('despesa');
});

// ==================== rodada 1 do gate de código (CR-API1) ====================

it('deve pôr a despesa no lado da despesa depois de a natureza da categoria ser corrigida', function () {
    // ARRANGE — CR-API1-01: a categoria nasceu receita e ganhou "Prestação de serviços"; sem
    // lançamento ainda, a natureza foi corrigida para despesa. Antes, R$ 1.000 de despesa saíam
    // como +1.000 de serviço
    $this->actingAs(admin());
    $categoria = categoriaDoDre('Categoria Corrigida Fictícia', 'receita', 'servicos');
    $this->putJsonComVersao("/api/categorias/{$categoria->id}", ['nome' => 'Categoria Corrigida Fictícia', 'tipo' => 'despesa'])->assertOk();
    lancamentoDoDre($categoria->fresh(), '1000.00', '2026-09-10 10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30');

    // ASSERT — a linha voltou ao padrão, e o resultado é negativo
    expect($categoria->fresh()->linha_dre)->toBeNull()
        ->and(linhaDoDre($resposta, 'Prestação de serviços')['total'])->toBe('0.00')
        ->and(linhaDoDre($resposta, 'Resultado final')['total'])->toBe('-1000.00');
});

it('deve somar pela natureza do lançamento mesmo com linha gravada de outra natureza', function (string $linhaGravada) {
    // ARRANGE — dado antigo inconsistente (linha de receita numa categoria de despesa) ou um código
    // que saiu da escada: cai no padrão da natureza do dinheiro, nunca some nem inverte
    $this->actingAs(admin());
    $categoria = categoriaDoDre('Despesa Estranha Fictícia', 'despesa');
    $categoria->forceFill(['linha_dre' => $linhaGravada])->save();
    lancamentoDoDre($categoria->fresh(), '300.00', '2026-09-10 10:00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30');

    // ASSERT
    expect(linhaDoDre($resposta, 'Despesas administrativas')['total'])->toBe('-300.00')
        ->and(linhaDoDre($resposta, 'Resultado final')['total'])->toBe('-300.00');
})->with([
    'linha de receita' => ['servicos'],
    'código que saiu da escada' => ['linha_extinta'],
]);

it('deve exigir fluxo_caixa.ver também na linha da subcategoria', function () {
    // ARRANGE — CR-API1-05 (D3)
    admin();
    $categoria = categoriaDoDre('Pessoal Fictício', 'despesa', 'pessoal');
    $sub = Subcategoria::create(['categoria_id' => $categoria->id, 'nome' => 'Vale Fictício']);
    $soEdita = usuarioCom(['categorias.ver', 'categorias.editar'], 'Só edita categorias DRE');

    // ACT + ASSERT
    $this->actingAs($soEdita)->putJsonComVersao("/api/subcategorias/{$sub->id}/linha-dre", ['linha_dre' => 'pessoal'])->assertForbidden();
});

it('deve contar exatamente as categorias no padrão, na configuração e no aviso', function () {
    // ARRANGE — CR-API1-05 (D4/D5): uma configurada e uma no padrão, além do catálogo da clínica
    $this->actingAs(admin());
    categoriaDoDre('Configurada Fictícia', 'despesa', 'pessoal');
    lancamentoDoDre(categoriaDoDre('No Padrão Fictícia', 'receita'), '10.00', '2026-09-10 10:00');
    $esperado = Categoria::whereNull('linha_dre')->count();

    // ACT
    $linhas = $this->getJson('/api/dre/linhas');
    $dre = $this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30');

    // ASSERT
    expect($linhas->json('no_padrao'))->toBe($esperado)
        ->and($esperado)->toBeLessThan(Categoria::count())
        ->and($dre->json('avisos.0'))->toStartWith("{$esperado} categorias");
});

it('deve sair na planilha com os subtotais como texto limpo, sem apóstrofo', function () {
    // ARRANGE — CR-API1-06: "= Receita líquida" virava "'= Receita líquida" no Excel do contador
    $this->actingAs(admin());
    lancamentoDoDre(categoriaDoDre('Atendimentos Fictícios', 'receita', 'servicos'), '100.00', '2026-09-10 10:00');

    // ACT
    $conteudo = $this->get('/api/relatorios/dre-gerencial/planilha?de=2026-09-01&ate=2026-09-30')->assertOk()->getContent();

    // ASSERT
    expect($conteudo)->toContain('"Receita líquida";')->not->toContain("\"'");
});

// ==================== rodada 2 do gate de código (CR-R2) ====================

it('deve somar pela natureza do LANÇAMENTO quando a categoria diverge dela', function () {
    // ARRANGE — dado legado: a receita foi lançada, e a natureza da categoria mudou por fora da
    // API. O sinal vem do dinheiro, não da categoria (CR-R2, mutação D1b)
    $this->actingAs(admin());
    $categoria = categoriaDoDre('Receita Divergente Fictícia', 'receita');
    lancamentoDoDre($categoria, '100.00', '2026-09-10 10:00');
    DB::table('categorias')->where('id', $categoria->id)->update(['tipo' => 'despesa']);

    // ACT
    $resposta = $this->getJson('/api/relatorios/dre-gerencial?de=2026-09-01&ate=2026-09-30');

    // ASSERT
    expect(linhaDoDre($resposta, 'Resultado final')['total'])->toBe('100.00');
});

it('deve recusar trocar a natureza da categoria que tem subcategoria, mesmo sem lançamento', function () {
    // ARRANGE — SEC-FIN-01, o ramo das subcategorias (mutação F1c)
    $this->actingAs(admin());
    $categoria = categoriaDoDre('Categoria com Filhas Fictícia', 'despesa');
    Subcategoria::create(['categoria_id' => $categoria->id, 'nome' => 'Filha Fictícia']);

    // ACT
    $resposta = $this->putJsonComVersao("/api/categorias/{$categoria->id}", ['nome' => 'Categoria com Filhas Fictícia', 'tipo' => 'receita']);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('tipo');
    expect($categoria->fresh()->tipo)->toBe('despesa');
});
