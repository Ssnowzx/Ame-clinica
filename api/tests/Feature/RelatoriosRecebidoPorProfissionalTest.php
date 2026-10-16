<?php

use App\Models\Agendamento;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Convenio;
use App\Models\Fornecedor;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\TipoPagamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Relatorios\RecebidoPorProfissional;

/**
 * O relatório `recebido-por-profissional` (change `recebido-por-profissional`): o "demonstrativo"
 * que a clínica usa para fechar o mês de cada profissional. A regra é a das respostas da Mariana
 * (2026-09-24): conta o que a família PAGOU no período, sem percentual; a falta só conta se foi
 * paga; o pacote conta inteiro quando é pago.
 *
 * A cena é uma só: a Ana ATENDE uma sessão do pacote da Bia (reposição), e a Bia tem o pacote
 * pago adiantado. É o caso que separa "quem atendeu" de "dono do pacote" — uma atribuição que
 * olhasse só o tratamento daria a sessão da Ana para a Bia.
 *
 * LGPD: dados 100% fictícios.
 */

/** @return array{particular: Convenio, servico: Servico, ana: Profissional, bia: Profissional, crianca: Paciente, pacote: Tratamento, sessao: Agendamento} */
function cenaDoRecebido(): array
{
    $particular = Convenio::create(['nome' => 'Particular Fictício', 'particular' => true]);
    $servico = new Servico(['procedimento' => 'Psicologia Fictícia', 'valor' => '150.00']);
    $servico->convenio_id = $particular->id;
    $servico->save();

    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bia = Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia Um']);

    $pacote = Tratamento::factory()->create([
        'paciente_id' => $crianca->id,
        'convenio_id' => $particular->id,
        'servico_id' => $servico->id,
        'profissional_id' => $bia->id,
    ]);

    $sessao = Agendamento::factory()->create([
        'paciente_id' => $crianca->id,
        'profissional_id' => $ana->id,
        'inicio' => '2026-09-03 14:00:00',
        'fim' => '2026-09-03 14:40:00',
    ]);
    $sessao->forceFill(['tratamento_id' => $pacote->id])->save();

    return compact('particular', 'servico', 'ana', 'bia', 'crianca', 'pacote', 'sessao');
}

/**
 * Um lançamento no estado em que o caixa o deixa: `pago_em`, `agendamento_id` e `tratamento_id`
 * são do servidor, então entram por `forceFill`.
 *
 * @param  array<string, mixed>  $atributos  fillable a sobrescrever (tipo, interessado…)
 * @param  array<string, mixed>  $doServidor  pago_em, agendamento_id, tratamento_id
 */
function pagamentoRecebido(string $valor, array $atributos = [], array $doServidor = []): LancamentoCaixa
{
    $tipo = $atributos['tipo'] ?? 'receita';
    $lancamento = new LancamentoCaixa([
        'tipo' => $tipo,
        'competencia' => '2026-09-01',
        'vencimento' => '2026-09-01',
        'valor' => $valor,
        'contabil' => true,
        'categoria_id' => Categoria::firstOrCreate(['nome' => "Categoria Fictícia {$tipo}", 'tipo' => $tipo])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'PIX Fictício'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Caixa Fictício'])->id,
        ...$atributos,
    ]);
    $lancamento->forceFill(['pago_em' => '2026-09-10 09:00', ...$doServidor])->save();

    return $lancamento->refresh();
}

/** Setembro de 2026, a query string base do relatório. */
function setembroDoRecebido(string $extra = ''): string
{
    return '/api/relatorios/recebido-por-profissional?de=2026-09-01&ate=2026-09-30'.$extra;
}

/** A linha do analítico cujo campo `$campo` vale `$valor` (ou null). */
function linhaDoRecebido(array $linhas, string $campo, string $valor): ?array
{
    return collect($linhas)->firstWhere($campo, $valor);
}

it('deve atribuir a sessão particular paga a quem ATENDEU, com serviço, convênio e origem', function () {
    // ARRANGE — a sessão é do pacote da Bia, mas quem atendeu foi a Ana
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    pagamentoRecebido('150.00', ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id], [
        'agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id,
    ]);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido());

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('linhas'))->toHaveCount(1)
        ->and($resposta->json('linhas.0'))->toMatchArray([
            'data' => '2026-09-10',
            'paciente' => 'Criança Fictícia Um',
            'profissional' => 'Ana Fictícia',
            'servico' => 'Psicologia Fictícia',
            'convenio' => 'Particular Fictício',
            'origem' => 'Sessão de 03/09',
            'forma_de_pagamento' => 'PIX Fictício',
            'recebido' => '150.00',
        ])
        ->and($resposta->json('totais'))->toBe(['pagamentos' => 1, 'recebido' => '150.00']);
});

it('deve contar o pacote pago adiantado INTEIRO para o dono do tratamento, no mês do pagamento', function () {
    // ARRANGE — nenhuma sessão atendida ainda; o pagamento só tem o vínculo com o pacote
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    pagamentoRecebido('1200.00', ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id], [
        'tratamento_id' => $cena['pacote']->id,
    ]);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido());

    // ASSERT
    expect(linhaDoRecebido($resposta->json('linhas'), 'profissional', 'Bia Fictícia'))
        ->toMatchArray(['origem' => 'Pacote', 'recebido' => '1200.00']);
});

it('deve decidir o mês pela data do pagamento, nunca pela competência', function () {
    // ARRANGE — competência de agosto, pago em setembro
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    pagamentoRecebido('150.00', [
        'competencia' => '2026-08-20', 'vencimento' => '2026-08-20',
        'interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id,
    ], ['tratamento_id' => $cena['pacote']->id, 'pago_em' => '2026-09-02 08:00']);

    // ACT
    $setembro = $this->getJson(setembroDoRecebido());
    $agosto = $this->getJson('/api/relatorios/recebido-por-profissional?de=2026-08-01&ate=2026-08-31');

    // ASSERT
    expect($setembro->json('totais.recebido'))->toBe('150.00')
        ->and($agosto->json('totais.recebido'))->toBe('0.00');
});

it('deve deixar de fora o lançamento em aberto — a falta faturada e não paga não conta', function () {
    // ARRANGE
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    pagamentoRecebido('150.00', ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id], [
        'agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id, 'pago_em' => null,
    ]);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido());

    // ASSERT
    expect($resposta->json('linhas'))->toBe([])
        ->and($resposta->json('totais'))->toBe(['pagamentos' => 0, 'recebido' => '0.00']);
});

it('deve pôr o pagamento sem vínculo em "Sem profissional", sem sumir da soma', function () {
    // ARRANGE — receita da criança lançada à mão, sem sessão nem tratamento
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    pagamentoRecebido('90.00', ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id]);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido());

    // ASSERT
    expect($resposta->json('linhas.0'))->toMatchArray([
        'paciente' => 'Criança Fictícia Um',
        'profissional' => 'Sem profissional',
        'servico' => '—',
        'convenio' => '—',
        'origem' => 'Avulso',
    ])->and($resposta->json('totais.recebido'))->toBe('90.00');
});

it('deve deixar de fora a receita que não é de uma criança', function () {
    // ARRANGE — aluguel de sala recebido de um fornecedor, e uma receita sem interessado
    $this->actingAs(admin());
    pagamentoRecebido('500.00', [
        'interessado_tipo' => 'fornecedor',
        'interessado_id' => Fornecedor::create(['razao_social' => 'Fornecedor Fictício'])->id,
    ]);
    pagamentoRecebido('70.00');

    // ACT
    $resposta = $this->getJson(setembroDoRecebido());

    // ASSERT
    expect($resposta->json('totais'))->toBe(['pagamentos' => 0, 'recebido' => '0.00']);
});

it('deve subtrair a devolução paga do que o profissional recebeu', function () {
    // ARRANGE — a Bia recebeu 500 do pacote e devolveu 100 à família
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('500.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('100.00', ['tipo' => 'despesa', ...$daCrianca], ['tratamento_id' => $cena['pacote']->id]);

    // ACT
    $sintetico = $this->getJson(setembroDoRecebido('&resultado=sintetico&dividir_por=profissional'));
    $analitico = $this->getJson(setembroDoRecebido());

    // ASSERT — a devolução subtrai do valor mas não é um pagamento da família (CR-RPP-10)
    expect($sintetico->json('grupos'))->toBe([[
        'titulo' => 'Bia Fictícia', 'linhas' => [], 'totais' => ['pagamentos' => 1, 'recebido' => '400.00'],
    ]]);
    // e no papel linha a linha a devolução sai NEGATIVA: a soma das linhas fecha com o total
    // (CR-RPP-03) — sem o sinal, a Mariana somaria 600 contra um total de 400
    $valores = collect($analitico->json('linhas'))->pluck('recebido');
    expect($valores->sort()->values()->all())->toBe(['-100.00', '500.00'])
        ->and($valores->reduce(fn (string $soma, string $v): string => bcadd($soma, $v, 2), '0.00'))
        ->toBe($analitico->json('totais.recebido'));
});

it('deve somar por profissional no sintético, com "Sem profissional" por último e o total do recorte', function () {
    // ARRANGE — Ana (sessão), Bia (pacote) e um avulso sem dono
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('150.00', $daCrianca, ['agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('90.00', $daCrianca);
    // "Tânia" vem DEPOIS de "Sem" no alfabeto: o "Sem profissional" por último é regra, não sorte
    $pacoteDaTania = Tratamento::factory()->create([
        'paciente_id' => $cena['crianca']->id,
        'profissional_id' => Profissional::factory()->create(['nome' => 'Tânia Fictícia'])->id,
    ]);
    pagamentoRecebido('60.00', $daCrianca, ['tratamento_id' => $pacoteDaTania->id]);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido('&resultado=sintetico&dividir_por=profissional'));

    // ASSERT
    $resposta->assertOk();
    expect(collect($resposta->json('grupos'))->map(fn (array $g) => [$g['titulo'], $g['totais']['recebido']])->all())
        ->toBe([['Ana Fictícia', '150.00'], ['Bia Fictícia', '1200.00'], ['Tânia Fictícia', '60.00'], ['Sem profissional', '90.00']])
        ->and($resposta->json('totais'))->toBe(['pagamentos' => 4, 'recebido' => '1500.00'])
        ->and(collect($resposta->json('filtros_aplicados'))->pluck('valor')->all())->toContain('Profissional');
});

it('deve filtrar pelo convênio Particular e pelo serviço, deixando de fora o que não tem tratamento', function () {
    // ARRANGE — um pagamento do particular, um de outra operadora (coparticipação) e um avulso
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    $deOperadora = Tratamento::factory()->create(['paciente_id' => $cena['crianca']->id, 'profissional_id' => $cena['ana']->id]);
    pagamentoRecebido('30.00', $daCrianca, ['tratamento_id' => $deOperadora->id]);
    pagamentoRecebido('90.00', $daCrianca);

    // ACT
    $porConvenio = $this->getJson(setembroDoRecebido("&convenio_id={$cena['particular']->id}"));
    $porServico = $this->getJson(setembroDoRecebido("&convenio_id={$cena['particular']->id}&servico_id={$cena['servico']->id}"));

    // ASSERT
    expect($porConvenio->json('totais'))->toBe(['pagamentos' => 1, 'recebido' => '1200.00'])
        ->and(collect($porConvenio->json('linhas'))->pluck('profissional')->all())->toBe(['Bia Fictícia'])
        ->and($porServico->json('totais.recebido'))->toBe('1200.00');
});

it('deve filtrar por profissional pela MESMA regra que atribui', function () {
    // ARRANGE — CR-RPP-01: filtrar pela coluna do tratamento daria à Bia a sessão que a Ana
    // atendeu; filtrar pela do agendamento tiraria da Bia o próprio pacote
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('150.00', $daCrianca, ['agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('90.00', $daCrianca);

    // ACT
    $daBia = $this->getJson(setembroDoRecebido("&profissional_id={$cena['bia']->id}"));
    $daAna = $this->getJson(setembroDoRecebido("&profissional_id={$cena['ana']->id}"));

    // ASSERT
    expect(collect($daBia->json('linhas'))->pluck('origem')->all())->toBe(['Pacote'])
        ->and($daBia->json('totais.recebido'))->toBe('1200.00')
        ->and(collect($daAna->json('linhas'))->pluck('origem')->all())->toBe(['Sessão de 03/09'])
        ->and($daAna->json('totais.recebido'))->toBe('150.00')
        ->and($daBia->json('filtros_aplicados'))->toContain(['rotulo' => 'Profissional', 'valor' => 'Bia Fictícia']);
});

it('deve filtrar só pelo serviço, separando dois serviços do mesmo convênio', function () {
    // ARRANGE — CR-RPP-02: dois serviços no MESMO Particular; o convênio sozinho não separa
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    $fono = new Servico(['procedimento' => 'Fono Fictícia', 'valor' => '120.00']);
    $fono->convenio_id = $cena['particular']->id;
    $fono->save();
    $pacoteDeFono = Tratamento::factory()->create([
        'paciente_id' => $cena['crianca']->id, 'convenio_id' => $cena['particular']->id,
        'servico_id' => $fono->id, 'profissional_id' => $cena['ana']->id,
    ]);
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('480.00', $daCrianca, ['tratamento_id' => $pacoteDeFono->id]);

    // ACT — sem `convenio_id`: é o serviço que tem de separar
    $resposta = $this->getJson(setembroDoRecebido("&servico_id={$cena['servico']->id}"));

    // ASSERT
    expect(collect($resposta->json('linhas'))->pluck('servico')->all())->toBe(['Psicologia Fictícia'])
        ->and($resposta->json('totais.recebido'))->toBe('1200.00');
});

it('deve somar por convênio e por serviço, com os grupos fechando no total', function (string $divisao, array $esperado) {
    // ARRANGE — CR-RPP-04: cada divisão com valor, e o nulo como grupo próprio
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('150.00', $daCrianca, ['agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('90.00', $daCrianca);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido("&resultado=sintetico&dividir_por={$divisao}"));

    // ASSERT
    $grupos = collect($resposta->json('grupos'));
    expect($grupos->map(fn (array $g) => [$g['titulo'], $g['totais']['pagamentos'], $g['totais']['recebido']])->all())
        ->toBe($esperado)
        ->and($grupos->reduce(fn (string $soma, array $g): string => bcadd($soma, $g['totais']['recebido'], 2), '0.00'))
        ->toBe($resposta->json('totais.recebido'));
})->with([
    'convênio' => ['convenio', [['Particular Fictício', 2, '1350.00'], ['Sem convênio', 1, '90.00']]],
    'serviço' => ['servico', [['Psicologia Fictícia (Particular Fictício)', 2, '1350.00'], ['Sem serviço', 1, '90.00']]],
]);

it('deve achar a criança pelo tratamento quando o lançamento não tem interessado', function () {
    // ARRANGE — CR-RPP-07: o formato legado (faturado cujo interessado foi apagado antes da
    // coerência nova): a base entra pelo vínculo, e o nome vem do dono do tratamento
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    pagamentoRecebido('1200.00', [], ['tratamento_id' => $cena['pacote']->id]);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido());

    // ASSERT
    expect($resposta->json('linhas.0'))->toMatchArray([
        'paciente' => 'Criança Fictícia Um', 'profissional' => 'Bia Fictícia', 'recebido' => '1200.00',
    ]);
});

it('deve recusar com 422 o serviço de outro convênio que o escolhido', function () {
    // ARRANGE
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    $outraOperadora = Convenio::create(['nome' => 'Operadora Fictícia']);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido("&convenio_id={$outraOperadora->id}&servico_id={$cena['servico']->id}"));

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('servico_id');
});

it('deve pôr o total recebido na coluna de dinheiro, nos dois resultados', function (string $extra) {
    // ARRANGE — achado na validação no navegador: a tela só desenha na linha de totais a chave
    // que também é coluna, e o analítico saía SEM o total do mês (coluna `valor`, total `recebido`)
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    pagamentoRecebido('150.00', ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id], [
        'tratamento_id' => $cena['pacote']->id,
    ]);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido($extra));

    // ASSERT — a coluna de dinheiro é a chave do total
    $colunaDoDinheiro = collect($resposta->json('colunas'))->firstWhere('tipo', 'dinheiro')['chave'];
    expect($resposta->json("totais.{$colunaDoDinheiro}"))->toBe('150.00');
})->with([
    'analítico' => [''],
    'sintético' => ['&resultado=sintetico&dividir_por=profissional'],
]);

it('deve pôr o recebido logo depois do nome no resumo, antes da contagem', function () {
    // ARRANGE — no celular (390 px) a última coluna fica atrás do véu de rolagem: tem de ser a
    // contagem, nunca o dinheiro que a clínica veio conferir
    $this->actingAs(admin());

    // ACT
    $resposta = $this->getJson(setembroDoRecebido('&resultado=sintetico&dividir_por=profissional'));

    // ASSERT
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['grupo', 'recebido', 'pagamentos']);
});

it('deve declarar a base no cabeçalho do papel', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT
    $resposta = $this->getJson(setembroDoRecebido());

    // ASSERT
    expect($resposta->json('filtros_aplicados.0'))
        ->toBe(['rotulo' => 'Base', 'valor' => 'Pagamentos recebidos no caixa da clínica']);
});

/** A Faturista da matriz de níveis (AP-10, adendo 2026-07-27) com o `repasse.ver` que a clínica concede. */
function faturistaDoRepasse(): Usuario
{
    return usuarioCom([
        'pacientes.ver', 'tratamentos.ver', 'tratamentos.criar', 'tratamentos.editar',
        'lancamentos.ver', 'lancamentos.criar', 'lancamentos.editar', 'lancamentos.pagar',
        'convenios.ver', 'servicos.ver', 'agenda.ver_todos', 'repasse.ver',
    ], 'Faturista Fictícia');
}

it('deve negar com 403, antes de validar, à recepção, que lança mas não monta o repasse', function () {
    // ARRANGE — a Secretaria da matriz: vê a agenda de todos e lança/dá baixa, sem `repasse.ver`
    admin();
    $recepcao = usuarioCom([
        'agenda.ver', 'agenda.criar', 'agenda.editar', 'agenda.ver_todos', 'pacientes.ver',
        'tratamentos.ver', 'lancamentos.ver', 'lancamentos.criar', 'lancamentos.pagar',
    ], 'Recepção Fictícia');

    // ACT — período inválido: o 403 vem antes do 422
    $resposta = $this->actingAs($recepcao)->getJson('/api/relatorios/recebido-por-profissional?de=nada');

    // ASSERT
    $resposta->assertForbidden();
});

it('deve negar com 403 quem tem o repasse mas não vê tratamentos', function () {
    // ARRANGE — SEC-RPP-10: a linha diz o serviço, o convênio e a terapeuta de cada criança; um
    // nível montado na tela com repasse + lançamentos, sem tratamentos, não lê esse vínculo
    admin();
    $semTratamentos = usuarioCom(['repasse.ver', 'lancamentos.ver', 'fluxo_caixa.ver'], 'Sem tratamentos');

    // ACT
    $resposta = $this->actingAs($semTratamentos)->getJson(setembroDoRecebido());

    // ASSERT
    $resposta->assertForbidden();
});

it('deve exigir o profissional da faturista, que monta o repasse mas não vê o total da clínica', function () {
    // ARRANGE — a decisão de 2026-07-19: a faturista monta os valores POR PROFISSIONAL e informa ao
    // administrador, mas não vê o total recebido. A primeira versão exigia `fluxo_caixa.ver` e
    // `agenda.ver` — ela não tem nenhuma das duas, e ficava sem a ferramenta que é função dela
    admin();
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('150.00', $daCrianca, ['agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('90.00', $daCrianca);
    $faturista = faturistaDoRepasse();

    // ACT
    $semProfissional = $this->actingAs($faturista)->getJson(setembroDoRecebido('&resultado=sintetico&dividir_por=profissional'));
    $daBia = $this->actingAs($faturista)->getJson(setembroDoRecebido("&profissional_id={$cena['bia']->id}"));

    // ASSERT — todos juntos (e o total da clínica) não; um profissional por vez, sim
    $semProfissional->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
    $daBia->assertOk();
    expect(collect($daBia->json('linhas'))->pluck('profissional')->unique()->all())->toBe(['Bia Fictícia'])
        ->and($daBia->json('totais.recebido'))->toBe('1200.00');
});

it('deve deixar a faturista listar os profissionais para escolher o do fechamento', function () {
    // ARRANGE — sem permissão de agenda nenhuma (matriz AP-10), a faturista não tinha de onde
    // tirar a lista de profissionais do filtro; a seleção da agenda é whitelist de nomes
    admin();
    Profissional::factory()->create(['nome' => 'Bia Fictícia']);
    $faturista = faturistaDoRepasse();
    $semRepasse = usuarioCom(['lancamentos.ver', 'pacientes.ver'], 'Sem repasse');

    // ACT
    $comRepasse = $this->actingAs($faturista)->getJson('/api/agenda/selecao');
    trocarDeUsuario();
    $semPermissao = $this->actingAs($semRepasse)->getJson('/api/agenda/selecao');

    // ASSERT
    $comRepasse->assertOk();
    expect(collect($comRepasse->json('profissionais'))->pluck('nome')->all())->toContain('Bia Fictícia');
    $semPermissao->assertForbidden();
});

it('deve oferecer à faturista a profissional desligada, e só a pedido e com o repasse', function () {
    // ARRANGE — CR-RPP-25: o último mês de quem saiu é um repasse a fazer, e a lista da seleção só
    // trazia ativos. A grade e a fila continuam sem os desligados
    admin();
    Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    Profissional::factory()->create(['nome' => 'Bia Fictícia Desligada', 'ativo' => false]);
    $faturista = faturistaDoRepasse();
    $daAgenda = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Agenda Fictícia');

    // ACT
    $comDesligados = $this->actingAs($faturista)->getJson('/api/agenda/selecao?com_desligados=1');
    $semPedir = $this->actingAs($faturista)->getJson('/api/agenda/selecao');
    trocarDeUsuario();
    $semRepasse = $this->actingAs($daAgenda)->getJson('/api/agenda/selecao?com_desligados=1');

    // ASSERT
    expect(collect($comDesligados->json('profissionais'))->mapWithKeys(fn (array $p) => [$p['nome'] => $p['ativo']])->all())
        ->toBe(['Ana Fictícia' => true, 'Bia Fictícia Desligada' => false])
        ->and(collect($semPedir->json('profissionais'))->pluck('nome')->all())->toBe(['Ana Fictícia'])
        ->and(collect($semRepasse->json('profissionais'))->pluck('nome')->all())->toBe(['Ana Fictícia']);
});

it('deve devolver só id, nome e ativo na seleção com desligados, mesmo a quem vê a agenda', function () {
    // ARRANGE — SEC-RPP-11: com `agenda.ver` + `repasse.ver`, o pedido de desligados trazia a
    // projeção da GRADE (`obs`, horários) de quem saiu; a `obs` costuma dizer o porquê da saída
    admin();
    Profissional::factory()->create(['nome' => 'Bia Fictícia Desligada', 'ativo' => false, 'obs' => 'Afastamento interno fictício']);
    $agendaComRepasse = usuarioCom(['agenda.ver', 'agenda.ver_todos', 'repasse.ver'], 'Agenda com repasse');

    // ACT
    $resposta = $this->actingAs($agendaComRepasse)->getJson('/api/agenda/selecao?com_desligados=1');

    // ASSERT
    $resposta->assertOk();
    expect($resposta->getContent())->not->toContain('Afastamento interno fictício')
        ->and(array_keys($resposta->json('profissionais.0')))->toBe(['id', 'nome', 'ativo', 'foto_versao', 'especialidades']);
});

it('deve avisar a faturista de quantos pagamentos estão sem profissional, sem dizer o valor', function () {
    // ARRANGE — CR-RPP-26: um profissional por vez esconde o grupo "Sem profissional", e a
    // faturista fecharia o mês faltando o pacote pago sem vínculo sem nada na tela apontar
    admin();
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('777.00', $daCrianca);
    $faturista = faturistaDoRepasse();

    // ACT
    $resposta = $this->actingAs($faturista)->getJson(setembroDoRecebido("&profissional_id={$cena['bia']->id}"));

    // ASSERT — a contagem, nunca o valor; e em `avisos`, não entre os filtros
    $resposta->assertOk();
    expect($resposta->json('avisos'))
        ->toBe(['1 pagamento do período está sem profissional — vincule-o ao tratamento em Financeiro.'])
        ->and(collect($resposta->json('filtros_aplicados'))->pluck('valor')->implode(' '))->not->toContain('sem profissional')
        ->and($resposta->getContent())->not->toContain('777');
});

it('deve avisar também no resumo, que é por onde a faturista fecha no celular', function () {
    // ARRANGE — CR-RPP-35: o manual orienta o Sintético no celular
    admin();
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('777.00', $daCrianca);
    $faturista = faturistaDoRepasse();

    // ACT
    $resposta = $this->actingAs($faturista)->getJson(setembroDoRecebido(
        "&profissional_id={$cena['bia']->id}&resultado=sintetico&dividir_por=convenio"
    ));

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('avisos'))
        ->toBe(['1 pagamento do período está sem profissional — vincule-o ao tratamento em Financeiro.']);
});

it('deve contar no aviso só os pagamentos sem profissional DO PERÍODO', function () {
    // ARRANGE — CR-RPP-30: um sem vínculo pago em agosto não é problema do fechamento de setembro
    admin();
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('50.00', $daCrianca, ['pago_em' => '2026-08-20 10:00']);
    $faturista = faturistaDoRepasse();

    // ACT
    $resposta = $this->actingAs($faturista)->getJson(setembroDoRecebido("&profissional_id={$cena['bia']->id}"));

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('avisos'))->toBe([]);
});

it('não deve avisar quando não há pagamento sem profissional, nem ao escopado', function () {
    // ARRANGE
    admin();
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    $faturista = faturistaDoRepasse();
    $bia = usuarioEscopadoEm($cena['bia'], ['repasse.ver', 'lancamentos.ver', 'tratamentos.ver']);

    // ACT — sem pagamento sem dono
    $limpo = $this->actingAs($faturista)->getJson(setembroDoRecebido("&profissional_id={$cena['bia']->id}"));
    // e com um sem dono, para a escopada: "sem profissional" nunca é dela. A troca de usuário é
    // explícita (CR-RPP-29): sem ela a segunda chamada saía 401 e o teste passava sobre um erro
    pagamentoRecebido('90.00', $daCrianca);
    trocarDeUsuario();
    $escopada = $this->actingAs($bia)->getJson(setembroDoRecebido("&profissional_id={$cena['bia']->id}"));

    // ASSERT
    $limpo->assertOk();
    $escopada->assertOk();
    expect($limpo->json('avisos'))->toBe([])
        ->and($escopada->json('avisos'))->toBe([])
        ->and($escopada->json('totais.recebido'))->toBe('1200.00');
});

it('não deve avisar quando nenhum profissional foi escolhido — o grupo aparece na tabela', function () {
    // ARRANGE — CR-RPP-32: com "Todos", o aviso duplicaria o grupo "Sem profissional"
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    pagamentoRecebido('90.00', ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id]);

    // ACT
    $resposta = $this->getJson(setembroDoRecebido());

    // ASSERT
    expect($resposta->json('avisos'))->toBe([])
        ->and(collect($resposta->json('linhas'))->pluck('profissional')->all())->toBe(['Sem profissional']);
});

it('deve mostrar tudo, inclusive "Sem profissional", a quem também vê o total da clínica', function () {
    // ARRANGE — a gestão (Paulo/Carol) com `fluxo_caixa.ver`; com `agenda.ver_todos` e sem
    // vínculo, o eixo agenda é PLANO, então fecha o mês de todos sem escolher profissional
    admin();
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('90.00', $daCrianca);
    $faturista = usuarioCom(['repasse.ver', 'lancamentos.ver', 'tratamentos.ver', 'agenda.ver_todos', 'fluxo_caixa.ver'], 'Gestão com Total');

    // ACT
    $resposta = $this->actingAs($faturista)->getJson(setembroDoRecebido('&resultado=sintetico&dividir_por=profissional'));

    // ASSERT
    expect(collect($resposta->json('grupos'))->pluck('titulo')->all())->toBe(['Bia Fictícia', 'Sem profissional'])
        ->and($resposta->json('totais.recebido'))->toBe('1290.00');
});

it('deve mostrar ao profissional escopado só o que é dele, e nunca "Sem profissional"', function () {
    // ARRANGE — a Ana só vê o seu; o pacote da Bia e o avulso somem para ela
    admin();
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('150.00', $daCrianca, ['agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('90.00', $daCrianca);
    $ana = usuarioEscopadoEm($cena['ana'], ['repasse.ver', 'lancamentos.ver', 'tratamentos.ver', 'fluxo_caixa.ver']);

    // ACT
    $analitico = $this->actingAs($ana)->getJson(setembroDoRecebido());
    $sintetico = $this->actingAs($ana)->getJson(setembroDoRecebido('&resultado=sintetico&dividir_por=profissional'));

    // ASSERT
    expect(collect($analitico->json('linhas'))->pluck('profissional')->all())->toBe(['Ana Fictícia'])
        ->and($analitico->json('totais.recebido'))->toBe('150.00')
        ->and(collect($sintetico->json('grupos'))->pluck('titulo')->all())->toBe(['Ana Fictícia']);
});

it('deve mostrar à dona do pacote o pacote pago, e não a sessão que outra pessoa atendeu', function () {
    // ARRANGE — o caso que separa as duas alternativas recusadas (design D3): escopar pela
    // coluna do AGENDAMENTO esconderia da Bia o próprio pacote; escopar pela do TRATAMENTO lhe
    // entregaria a sessão que a Ana atendeu. Só a expressão que atribui acerta os dois.
    admin();
    $cena = cenaDoRecebido();
    $daCrianca = ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id];
    pagamentoRecebido('150.00', $daCrianca, ['agendamento_id' => $cena['sessao']->id, 'tratamento_id' => $cena['pacote']->id]);
    pagamentoRecebido('1200.00', $daCrianca, ['tratamento_id' => $cena['pacote']->id]);
    $bia = usuarioEscopadoEm($cena['bia'], ['repasse.ver', 'lancamentos.ver', 'tratamentos.ver', 'fluxo_caixa.ver']);

    // ACT
    $resposta = $this->actingAs($bia)->getJson(setembroDoRecebido());

    // ASSERT
    expect(collect($resposta->json('linhas'))->map(fn (array $l) => [$l['profissional'], $l['origem']])->all())
        ->toBe([['Bia Fictícia', 'Pacote']])
        ->and($resposta->json('totais.recebido'))->toBe('1200.00');
});

it('deve cortar o analítico no limite, com o total do recorte inteiro', function () {
    // ARRANGE — limite injetado de 2 linhas; 3 pagamentos
    $this->actingAs(admin());
    $cena = cenaDoRecebido();
    foreach (['10.00', '20.00', '30.00'] as $valor) {
        pagamentoRecebido($valor, ['interessado_tipo' => 'paciente', 'interessado_id' => $cena['crianca']->id]);
    }
    app()->bind(RecebidoPorProfissional::class, fn () => new RecebidoPorProfissional(limiteDeLinhas: 2));

    // ACT
    $resposta = $this->getJson(setembroDoRecebido());

    // ASSERT
    expect($resposta->json('linhas'))->toHaveCount(2)
        ->and($resposta->json('truncado'))->toBeTrue()
        ->and($resposta->json('totais'))->toBe(['pagamentos' => 3, 'recebido' => '60.00']);
});
