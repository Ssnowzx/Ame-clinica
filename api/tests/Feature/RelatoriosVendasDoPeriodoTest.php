<?php

use App\Models\Agendamento;
use App\Models\Categoria;
use App\Models\Convenio;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\Tratamento;
use App\Support\Relatorios\VendasDoPeriodo;

/**
 * O relatório `vendas-do-periodo` — "Vendas do período" (change `relatorios-do-caixa`): quanto a
 * clínica vendeu. Receitas pela COMPETÊNCIA, pagas ou não; vendido, recebido e em aberto; o
 * profissional pela MESMA atribuição do Recebido por profissional (D4); sob `lancamentos.ver`,
 * `fluxo_caixa.ver` E `tratamentos.ver`.
 *
 * A cena é a do Recebido por profissional: a Ana ATENDE uma sessão do pacote da Bia (10
 * sessões, 4 realizadas). Uma atribuição que olhasse só o tratamento daria a sessão da Ana à Bia.
 *
 * LGPD: dados 100% fictícios.
 */

/** @return array{particular: Convenio, servico: Servico, ana: Profissional, bia: Profissional, crianca: Paciente, pacote: Tratamento, sessao: Agendamento} */
function cenaDasVendas(): array
{
    $particular = Convenio::create(['nome' => 'Particular Fictício', 'particular' => true]);
    $servico = new Servico(['procedimento' => 'Psicologia Fictícia', 'valor' => '150.00']);
    $servico->convenio_id = $particular->id;
    $servico->save();

    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia Compradora']);

    $pacote = Tratamento::factory()->create([
        'paciente_id' => $crianca->id, 'convenio_id' => $particular->id,
        'servico_id' => $servico->id, 'profissional_id' => $bia->id, 'sessoes_total' => 10,
    ]);
    $pacote->forceFill(['sessoes_realizadas' => 4])->save();

    $sessao = Agendamento::factory()->create([
        'paciente_id' => $crianca->id, 'profissional_id' => $ana->id,
        'inicio' => '2026-09-03 14:00:00', 'fim' => '2026-09-03 14:40:00',
    ]);
    $sessao->forceFill(['tratamento_id' => $pacote->id])->save();

    return compact('particular', 'servico', 'ana', 'bia', 'crianca', 'pacote', 'sessao');
}

/** Setembro de 2026, a query string base do relatório. */
function setembroDasVendas(string $extra = ''): string
{
    return '/api/relatorios/vendas-do-periodo?de=2026-09-01&ate=2026-09-30'.$extra;
}

/** @param array{crianca: Paciente} $cena */
function daCriancaDasVendas(array $cena): array
{
    return ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
}

it('deve listar tudo o que foi vendido com competência no período, pago ou não, com o recebido e o em aberto', function () {
    // ARRANGE — o cenário "O mês vendido, pago ou não": competência de setembro paga, competência
    // de setembro em aberto; competência de agosto paga em setembro (não é venda de setembro) e
    // uma despesa de setembro (não é venda)
    $this->actingAs(admin());
    $cena = cenaDasVendas();
    lancamentoNoCaixa('1200.00', [...daCriancaDasVendas($cena), 'competencia' => '2026-09-01'], ['tratamento_id' => $cena['pacote']->id, 'pago_em' => '2026-09-05 10:00']);
    lancamentoNoCaixa('150.00', [...daCriancaDasVendas($cena), 'competencia' => '2026-09-03', 'juros' => '5.00'], ['agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id]);
    lancamentoNoCaixa('888.00', [...daCriancaDasVendas($cena), 'competencia' => '2026-08-20'], ['pago_em' => '2026-09-02 10:00']);
    lancamentoNoCaixa('777.00', ['tipo' => 'despesa', 'competencia' => '2026-09-10']);

    // ACT
    $resposta = $this->getJson(setembroDasVendas());

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('linhas'))->toBe([
        [
            'competencia' => '2026-09-01', 'pessoa' => 'Criança Fictícia Compradora', 'servico' => 'Psicologia Fictícia (Particular Fictício)',
            'profissional' => 'Bia Fictícia', 'sessoes' => '4/10 sessões', 'situacao' => 'Pago em 05/09',
            'vendido' => '1200.00', 'recebido' => '1200.00', 'em_aberto' => null,
        ],
        [
            'competencia' => '2026-09-03', 'pessoa' => 'Criança Fictícia Compradora', 'servico' => 'Psicologia Fictícia (Particular Fictício)',
            'profissional' => 'Ana Fictícia', 'sessoes' => '4/10 sessões', 'situacao' => 'Em aberto',
            'vendido' => '155.00', 'recebido' => null, 'em_aberto' => '155.00',
        ],
    ])
        ->and($resposta->json('totais'))->toBe(['vendido' => '1355.00', 'recebido' => '1200.00', 'em_aberto' => '155.00']);
});

it('deve mostrar serviço, profissional e "4/10 sessões" quando a receita é do pacote, e vazio sem tratamento', function () {
    // ARRANGE — o cenário "Pacote com sessões", e uma receita avulsa sem vínculo
    $this->actingAs(admin());
    $cena = cenaDasVendas();
    lancamentoNoCaixa('1200.00', daCriancaDasVendas($cena), ['tratamento_id' => $cena['pacote']->id]);
    lancamentoNoCaixa('90.00', [...daCriancaDasVendas($cena), 'competencia' => '2026-09-20']);

    // ACT
    $resposta = $this->getJson(setembroDasVendas());

    // ASSERT
    expect(collect($resposta->json('linhas'))->map(fn (array $l) => [$l['servico'], $l['profissional'], $l['sessoes']])->all())
        ->toBe([['Psicologia Fictícia (Particular Fictício)', 'Bia Fictícia', '4/10 sessões'], ['—', '—', null]]);
});

it('deve atribuir cada venda ao MESMO profissional que o Recebido por profissional', function () {
    // ARRANGE — D4: a sessão que a Ana atendeu no pacote da Bia, e o pacote da Bia, ambos pagos
    // em setembro (para o Recebido por profissional também os ver)
    $this->actingAs(admin());
    $cena = cenaDasVendas();
    lancamentoNoCaixa('150.00', [...daCriancaDasVendas($cena), 'competencia' => '2026-09-03'], [
        'agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id, 'pago_em' => '2026-09-03 15:00',
    ]);
    lancamentoNoCaixa('1200.00', [...daCriancaDasVendas($cena), 'competencia' => '2026-09-04'], [
        'tratamento_id' => $cena['pacote']->id, 'pago_em' => '2026-09-04 15:00',
    ]);

    // ACT
    $vendas = $this->getJson(setembroDasVendas());
    $recebido = $this->getJson('/api/relatorios/recebido-por-profissional?de=2026-09-01&ate=2026-09-30');

    // ASSERT — as duas folhas dão cada pagamento à mesma pessoa
    $porValor = fn (array $linhas, string $chave): array => collect($linhas)->mapWithKeys(fn (array $l) => [$l[$chave] => $l['profissional']])->all();
    expect($porValor($vendas->json('linhas'), 'vendido'))->toBe(['150.00' => 'Ana Fictícia', '1200.00' => 'Bia Fictícia'])
        ->and($porValor($vendas->json('linhas'), 'vendido'))->toBe($porValor($recebido->json('linhas'), 'recebido'));
});

it('deve filtrar pelo profissional pela MESMA regra que atribui', function () {
    // ARRANGE — filtrar pela coluna do tratamento daria à Bia a sessão que a Ana atendeu
    $this->actingAs(admin());
    $cena = cenaDasVendas();
    lancamentoNoCaixa('150.00', daCriancaDasVendas($cena), ['agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id]);
    lancamentoNoCaixa('1200.00', daCriancaDasVendas($cena), ['tratamento_id' => $cena['pacote']->id]);

    // ACT
    $daBia = $this->getJson(setembroDasVendas("&profissional_id={$cena['bia']->id}"));
    $daAna = $this->getJson(setembroDasVendas("&profissional_id={$cena['ana']->id}"));

    // ASSERT
    expect($daBia->json('totais.vendido'))->toBe('1200.00')
        ->and($daAna->json('totais.vendido'))->toBe('150.00')
        ->and($daBia->json('filtros_aplicados'))->toContain(['rotulo' => 'Profissional', 'valor' => 'Bia Fictícia']);
});

it('deve filtrar pelo serviço e pela categoria', function () {
    // ARRANGE — um pacote de outro serviço e uma receita de outra categoria
    $this->actingAs(admin());
    $cena = cenaDasVendas();
    $fono = new Servico(['procedimento' => 'Fono Fictícia', 'valor' => '120.00']);
    $fono->convenio_id = $cena['particular']->id;
    $fono->save();
    $pacoteDeFono = Tratamento::factory()->create(['paciente_id' => $cena['crianca']->id, 'servico_id' => $fono->id, 'profissional_id' => $cena['ana']->id]);
    $aluguel = Categoria::create(['nome' => 'Aluguel de Sala Fictício', 'tipo' => 'receita']);
    lancamentoNoCaixa('1200.00', daCriancaDasVendas($cena), ['tratamento_id' => $cena['pacote']->id]);
    lancamentoNoCaixa('480.00', daCriancaDasVendas($cena), ['tratamento_id' => $pacoteDeFono->id]);
    lancamentoNoCaixa('300.00', ['categoria_id' => $aluguel->id]);

    // ACT
    $porServico = $this->getJson(setembroDasVendas("&servico_id={$cena['servico']->id}"));
    $porCategoria = $this->getJson(setembroDasVendas("&categoria_id={$aluguel->id}"));

    // ASSERT
    expect($porServico->json('totais.vendido'))->toBe('1200.00')
        ->and($porServico->json('filtros_aplicados'))->toContain(['rotulo' => 'Serviço', 'valor' => 'Psicologia Fictícia'])
        ->and($porCategoria->json('totais.vendido'))->toBe('300.00')
        ->and($porCategoria->json('filtros_aplicados'))->toContain(['rotulo' => 'Categoria', 'valor' => 'Aluguel de Sala Fictício']);
});

it('deve recusar com 422 a categoria de despesa — venda é receita', function () {
    // ARRANGE
    $this->actingAs(admin());
    $despesa = Categoria::create(['nome' => 'Despesa Fictícia', 'tipo' => 'despesa']);

    // ACT
    $resposta = $this->getJson(setembroDasVendas("&categoria_id={$despesa->id}"));

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('categoria_id');
});

it('deve dividir por serviço, profissional e categoria, com os grupos fechando no total', function (string $divisao, array $esperado) {
    // ARRANGE — a sessão da Ana (em aberto), o pacote da Bia (pago) e um avulso sem vínculo (pago)
    $this->actingAs(admin());
    $cena = cenaDasVendas();
    lancamentoNoCaixa('150.00', daCriancaDasVendas($cena), ['agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id]);
    lancamentoNoCaixa('1200.00', daCriancaDasVendas($cena), ['tratamento_id' => $cena['pacote']->id, 'pago_em' => '2026-09-05 10:00']);
    lancamentoNoCaixa('90.00', daCriancaDasVendas($cena), ['pago_em' => '2026-09-06 10:00']);

    // ACT
    $resposta = $this->getJson(setembroDasVendas("&resultado=sintetico&dividir_por={$divisao}"));

    // ASSERT
    $resposta->assertOk();
    $grupos = collect($resposta->json('grupos'));
    expect($grupos->map(fn (array $g) => [$g['titulo'], $g['totais']['vendido'], $g['totais']['recebido'], $g['totais']['em_aberto'], $g['totais']['vendas']])->all())
        ->toBe($esperado)
        ->and($grupos->reduce(fn (string $soma, array $g): string => bcadd($soma, $g['totais']['vendido'], 2), '0.00'))
        ->toBe($resposta->json('totais.vendido'))
        ->and($resposta->json('totais'))->toBe(['vendido' => '1440.00', 'recebido' => '1290.00', 'em_aberto' => '150.00', 'vendas' => 3]);
})->with([
    'serviço' => ['servico', [['Psicologia Fictícia (Particular Fictício)', '1350.00', '1200.00', '150.00', 2], ['Sem serviço', '90.00', '90.00', '0.00', 1]]],
    'profissional' => ['profissional', [['Ana Fictícia', '150.00', '0.00', '150.00', 1], ['Bia Fictícia', '1200.00', '1200.00', '0.00', 1], ['Sem profissional', '90.00', '90.00', '0.00', 1]]],
    'categoria' => ['categoria', [['Categoria Fictícia receita', '1440.00', '1290.00', '150.00', 3]]],
]);

it('deve pôr cada total na coluna de dinheiro de mesma chave, nos dois resultados', function (string $extra) {
    // ARRANGE — a tela só desenha na linha de totais a chave que também é coluna
    $this->actingAs(admin());
    $cena = cenaDasVendas();
    lancamentoNoCaixa('1200.00', daCriancaDasVendas($cena), ['tratamento_id' => $cena['pacote']->id]);

    // ACT
    $resposta = $this->getJson(setembroDasVendas($extra));

    // ASSERT — a coluna de dinheiro é a chave do total, nos dois sentidos
    $colunas = collect($resposta->json('colunas'));
    expect($colunas->where('tipo', 'dinheiro')->pluck('chave')->all())->toBe(['vendido', 'recebido', 'em_aberto'])
        ->and($resposta->json('totais.vendido'))->toBe('1200.00')
        ->and(array_values(array_diff(array_keys($resposta->json('totais')), $colunas->pluck('chave')->all())))->toBe([]);
})->with([
    'analítico' => [''],
    'sintético' => ['&resultado=sintetico&dividir_por=profissional'],
]);

it('deve declarar a base no cabeçalho do papel', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT
    $resposta = $this->getJson(setembroDasVendas());

    // ASSERT
    expect($resposta->json('filtros_aplicados.0'))->toBe(['rotulo' => 'Base', 'valor' => 'Pela competência (o mês do serviço), pago ou não']);
});

it('deve negar com 403, antes de validar, quem não tem as três permissões', function (array $permissoes) {
    // ARRANGE — `tratamentos.ver` porque a linha nomeia serviço e terapeuta de cada criança
    admin();
    $restrito = usuarioCom($permissoes, 'Restrito Fictício');

    // ACT
    $resposta = $this->actingAs($restrito)->getJson('/api/relatorios/vendas-do-periodo?de=nada');

    // ASSERT
    $resposta->assertForbidden();
})->with([
    'sem tratamentos' => [['lancamentos.ver', 'fluxo_caixa.ver']],
    'sem o fluxo de caixa' => [['lancamentos.ver', 'tratamentos.ver']],
    'sem lançamentos' => [['fluxo_caixa.ver', 'tratamentos.ver']],
]);

it('deve abrir a quem tem as três permissões', function () {
    // ARRANGE
    admin();
    $gestao = usuarioCom(['lancamentos.ver', 'fluxo_caixa.ver', 'tratamentos.ver'], 'Gestão Fictícia');

    // ACT
    $resposta = $this->actingAs($gestao)->getJson(setembroDasVendas());

    // ASSERT
    $resposta->assertOk();
});

it('deve cortar o analítico no limite, com o total do recorte inteiro', function () {
    // ARRANGE
    $this->actingAs(admin());
    foreach (['10.00', '20.00', '30.00'] as $valor) {
        lancamentoNoCaixa($valor);
    }
    app()->bind(VendasDoPeriodo::class, fn () => new VendasDoPeriodo(limiteDeLinhas: 2));

    // ACT
    $resposta = $this->getJson(setembroDasVendas());

    // ASSERT
    expect($resposta->json('linhas'))->toHaveCount(2)
        ->and($resposta->json('truncado'))->toBeTrue()
        ->and($resposta->json('totais.vendido'))->toBe('60.00');
});
