<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use Carbon\Carbon;

/**
 * O relatório `servicos` (change `area-de-relatorios`, task 2.8): 403 antes de 422; os dois
 * grupos (e a omissão do que não tem linha, `CRR-07`); o ranking por quantidade e por valor;
 * "Sem serviço" na soma; executados pelas FLAGS do status (desconta sessão E não é falta —
 * `CRR-02`/`CRR-06`); NENHUM nome de criança (numérico, AP-09); escopo D11 do eixo AGENDA
 * (`SEC-REL-01`).
 */

/** A query string de `de`/`ate` cobrindo `$dias` para trás a partir de hoje da clínica. */
function periodoDosServicos(int $dias = 7): string
{
    return 'de='.agoraNaClinica()->subDays($dias)->toDateString().'&ate='.agoraNaClinica()->toDateString();
}

/** Um serviço PRECIFICADO do convênio (`convenio_id` fora do fillable, como no formulário). */
function servicoDoRanking(int $convenioId, string $procedimento, string $valor): Servico
{
    $servico = new Servico(['procedimento' => $procedimento, 'valor' => $valor]);
    $servico->convenio_id = $convenioId;
    $servico->save();

    return $servico;
}

/** Um pacote aberto hoje na parede da clínica. */
function pacoteDoRanking(array $atributos = []): Tratamento
{
    return Tratamento::factory()->create([
        'data_inicio' => agoraNaClinica()->toDateString(),
        ...$atributos,
    ]);
}

/** Uma sessão de atendimento hoje (ou em `$data`) do pacote — ou avulsa, sem pacote — com o status dado. */
function sessaoDoRanking(?Tratamento $pacote, string $hora, StatusAgendamento $status, ?string $data = null): Agendamento
{
    $data ??= agoraNaClinica()->toDateString();
    $doPacote = $pacote === null ? [] : [
        'paciente_id' => $pacote->paciente_id,
        'profissional_id' => $pacote->profissional_id,
        'especialidade_id' => $pacote->especialidade_id,
        'tratamento_id' => $pacote->id,
    ];

    return Agendamento::factory()->create([
        ...$doPacote,
        'status_id' => $status->id,
        'inicio' => "{$data} {$hora}",
        'fim' => Carbon::parse("{$data} {$hora}")->addMinutes(40)->format('Y-m-d H:i'),
    ]);
}

/** Todas as chaves de string do JSON, em qualquer profundidade. */
function chavesDoJsonDosServicos(mixed $valor, array &$chaves): void
{
    if (! is_array($valor)) {
        return;
    }
    foreach ($valor as $chave => $filho) {
        if (is_string($chave)) {
            $chaves[] = $chave;
        }
        chavesDoJsonDosServicos($filho, $chaves);
    }
}

it('deve recusar com 403 quem não tem tratamentos.ver MESMO com período inválido (403 antes de 422)', function () {
    // ARRANGE
    admin();
    $semTratamentos = usuarioCom(['agenda.ver'], 'Sem tratamentos');

    // ACT + ASSERT
    $this->actingAs($semTratamentos)
        ->getJson('/api/relatorios/servicos?de=nao-e-data')
        ->assertForbidden();
});

it('deve rankear os vendidos por quantidade, omitir o grupo sem linha, somar "Sem serviço" e dar o valor em decimal', function () {
    // ARRANGE — Sessão A vendida 2× (150 × 10 cada), Sessão B 1× (200 × 5), um pacote sem
    // serviço; um pacote de B aberto há 30 dias fica FORA do período
    $this->actingAs(admin());
    $hoje = agoraNaClinica()->toDateString();
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $sessaoA = servicoDoRanking($operadora->id, 'Sessão A Fictícia', '150.00');
    $sessaoB = servicoDoRanking($operadora->id, 'Sessão B Fictícia', '200.00');
    pacoteDoRanking(['servico_id' => $sessaoA->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 10]);
    pacoteDoRanking(['servico_id' => $sessaoA->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 10]);
    pacoteDoRanking(['servico_id' => $sessaoB->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 5]);
    pacoteDoRanking(['sessoes_total' => 4]);
    pacoteDoRanking(['servico_id' => $sessaoB->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 5, 'data_inicio' => agoraNaClinica()->subDays(30)->toDateString()]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/servicos?'.periodoDosServicos())->assertOk();

    // ASSERT — o envelope: em grupos, e SÓ os que têm linha (`CRR-07`). Nada foi executado no
    // período, então o grupo "Executados" não sai — se saísse vazio, o envelope o contaria como
    // 1 linha (é o sintético por dimensão, onde o grupo É a linha) e a `contagem` mentiria
    $resposta->assertJsonPath('slug', 'servicos')
        ->assertJsonPath('titulo', 'Serviços')
        ->assertJsonPath('periodo.ate', $hoje)
        ->assertJsonPath('filtros_aplicados', [['rotulo' => 'Ordenado por', 'valor' => 'Quantidade']])
        ->assertJsonPath('linhas', [])
        ->assertJsonPath('totais', ['vendidos' => 4, 'executados' => 0, 'valor_vendido' => '4000.00'])
        // as 3 linhas vendidas, e só elas
        ->assertJsonPath('contagem', 3);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['servico', 'quantidade', 'valor'])
        ->and(collect($resposta->json('colunas'))->pluck('tipo')->all())->toBe(['texto', 'numero', 'dinheiro']);

    // ...o ranking: A (2) > B (1) = Sem serviço (1), desempate pelo valor
    $grupos = $resposta->json('grupos');
    expect(collect($grupos)->pluck('titulo')->all())->toBe(['Vendidos no período'])
        ->and($grupos[0]['linhas'])->toBe([
            ['servico' => 'Sessão A Fictícia (Operadora Fictícia)', 'quantidade' => 2, 'valor' => '3000.00'],
            ['servico' => 'Sessão B Fictícia (Operadora Fictícia)', 'quantidade' => 1, 'valor' => '1000.00'],
            ['servico' => 'Sem serviço', 'quantidade' => 1, 'valor' => '0.00'],
        ])
        ->and($grupos[0]['totais'])->toBe(['quantidade' => 4, 'valor' => '4000.00']);
});

it('deve rankear por valor quando pedido: o serviço caro sobe mesmo vendendo menos; ordenação desconhecida é 422', function () {
    // ARRANGE — barata 3× (50 × 10 = 1500 no total), cara 1× (400 × 10 = 4000)
    $this->actingAs(admin());
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $barata = servicoDoRanking($operadora->id, 'Sessão Barata Fictícia', '50.00');
    $cara = servicoDoRanking($operadora->id, 'Sessão Cara Fictícia', '400.00');
    foreach ([1, 2, 3] as $vez) {
        pacoteDoRanking(['servico_id' => $barata->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 10]);
    }
    pacoteDoRanking(['servico_id' => $cara->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 10]);
    $periodo = periodoDosServicos();

    // ACT
    $porQuantidade = $this->getJson("/api/relatorios/servicos?{$periodo}")->assertOk();
    $porValor = $this->getJson("/api/relatorios/servicos?{$periodo}&ordenar=valor")->assertOk();

    // ASSERT
    expect(collect($porQuantidade->json('grupos.0.linhas'))->pluck('servico')->all())
        ->toBe(['Sessão Barata Fictícia (Operadora Fictícia)', 'Sessão Cara Fictícia (Operadora Fictícia)'])
        ->and(collect($porValor->json('grupos.0.linhas'))->pluck('servico')->all())
        ->toBe(['Sessão Cara Fictícia (Operadora Fictícia)', 'Sessão Barata Fictícia (Operadora Fictícia)'])
        ->and($porValor->json('grupos.0.linhas.0.valor'))->toBe('4000.00')
        ->and($porValor->json('filtros_aplicados'))->toBe([['rotulo' => 'Ordenado por', 'valor' => 'Valor']])
        ->and($porValor->json('totais.valor_vendido'))->toBe('5500.00');
    $this->getJson("/api/relatorios/servicos?{$periodo}&ordenar=saldo")
        ->assertUnprocessable()->assertJsonValidationErrors(['ordenar']);
});

it('deve contar os executados pelo status que DESCONTA SESSÃO (flag), por serviço do pacote, com valor 0,00', function () {
    // ARRANGE — pacote aberto há 30 dias (NÃO vendido no período) com duas sessões realizadas
    // hoje, uma não realizada e uma realizada há 30 dias; uma sessão AVULSA realizada (sem pacote)
    $this->actingAs(admin());
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $sessaoA = servicoDoRanking($operadora->id, 'Sessão A Fictícia', '150.00');
    $pacote = pacoteDoRanking(['servico_id' => $sessaoA->id, 'convenio_id' => $operadora->id, 'data_inicio' => agoraNaClinica()->subDays(30)->toDateString()]);
    $realizado = StatusAgendamento::where('desconta_sessao', true)->orderBy('ordem')->firstOrFail();
    $naoRealizado = StatusAgendamento::where('desconta_sessao', false)->orderBy('ordem')->firstOrFail();
    sessaoDoRanking($pacote, '08:00', $realizado);
    sessaoDoRanking($pacote, '09:00', $realizado);
    sessaoDoRanking($pacote, '10:00', $naoRealizado);
    sessaoDoRanking($pacote, '08:00', $realizado, agoraNaClinica()->subDays(30)->toDateString());
    sessaoDoRanking(null, '11:00', $realizado);

    // ACT
    $resposta = $this->getJson('/api/relatorios/servicos?'.periodoDosServicos())->assertOk();

    // ASSERT — 2 do serviço + 1 avulsa em "Sem serviço"; nada vendido no período, então
    // "Vendidos" é omitido (`CRR-07`) e "Executados" é o ÚNICO grupo
    $grupos = $resposta->json('grupos');
    expect(collect($grupos)->pluck('titulo')->all())->toBe(['Executados no período'])
        ->and($grupos[0]['linhas'])->toBe([
            ['servico' => 'Sessão A Fictícia (Operadora Fictícia)', 'quantidade' => 2, 'valor' => '0.00'],
            ['servico' => 'Sem serviço', 'quantidade' => 1, 'valor' => '0.00'],
        ])
        ->and($grupos[0]['totais'])->toBe(['quantidade' => 3, 'valor' => '0.00'])
        ->and($resposta->json('contagem'))->toBe(2)
        ->and($resposta->json('totais'))->toBe(['vendidos' => 0, 'executados' => 3, 'valor_vendido' => '0.00']);
});

it('deve NÃO contar falta cobrada como execução, batendo com o relatório atendimentos no mesmo período (CRR-02/CRR-06)', function () {
    // ARRANGE — três sessões do mesmo pacote, hoje: uma finalizada, uma "Não Compareceu" (que no
    // catálogo padrão tem AS DUAS flags — desconta a sessão E marca falta) e uma em aberto.
    // `atendimentos` já usava o helper canônico; `servicos` filtrava só por `desconta_sessao` e
    // contava a falta cobrada como execução — os dois relatórios do mesmo período divergiam.
    $this->actingAs(admin());
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $sessaoA = servicoDoRanking($operadora->id, 'Sessão A Fictícia', '150.00');
    $pacote = pacoteDoRanking(['servico_id' => $sessaoA->id, 'convenio_id' => $operadora->id]);
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    $faltaCobrada = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    expect([$faltaCobrada->desconta_sessao, $faltaCobrada->marca_falta])->toBe([true, true]);
    sessaoDoRanking($pacote, '08:00', $finalizado);
    sessaoDoRanking($pacote, '09:00', $faltaCobrada);
    sessaoDoRanking($pacote, '10:00', $emAberto);
    $periodo = periodoDosServicos();

    // ACT — o MESMO período nos dois relatórios
    $servicos = $this->getJson("/api/relatorios/servicos?{$periodo}")->assertOk();
    $atendimentos = $this->getJson("/api/relatorios/atendimentos?{$periodo}")->assertOk();

    // ASSERT — uma execução só, e o número é o mesmo dos dois lados
    expect($servicos->json('totais.executados'))->toBe(1)
        ->and($servicos->json('totais.executados'))->toBe($atendimentos->json('totais.quantidade'));
    expect(collect($servicos->json('grupos'))->firstWhere('titulo', 'Executados no período')['totais'])
        ->toBe(['quantidade' => 1, 'valor' => '0.00']);
});

it('deve ser numérico: nenhum nome de criança em chave nem em valor do payload (AP-09)', function () {
    // ARRANGE — uma criança fictícia com pacote vendido E sessão executada no período
    $this->actingAs(admin());
    $paciente = Paciente::factory()->create(['nome' => 'Criança Fictícia do Ranking']);
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $sessaoA = servicoDoRanking($operadora->id, 'Sessão A Fictícia', '150.00');
    $pacote = pacoteDoRanking(['paciente_id' => $paciente->id, 'servico_id' => $sessaoA->id, 'convenio_id' => $operadora->id]);
    sessaoDoRanking($pacote, '09:00', StatusAgendamento::where('desconta_sessao', true)->orderBy('ordem')->firstOrFail());

    // ACT
    $json = $this->getJson('/api/relatorios/servicos?'.periodoDosServicos())->assertOk()->json();

    // ASSERT — a cena atravessou (há linha nos dois grupos), e nada de criança
    expect($json['totais'])->toBe(['vendidos' => 1, 'executados' => 1, 'valor_vendido' => '1500.00']);
    $chaves = [];
    chavesDoJsonDosServicos($json, $chaves);
    expect(array_values(array_intersect(array_unique($chaves), ['paciente', 'nome', 'paciente_id'])))->toBe([]);
    semVazamento($json, 'Criança Fictícia do Ranking');
});

it('deve escopar pelo eixo AGENDA nos dois grupos: o vinculado vê só os seus e o sem vínculo vê nada', function () {
    // ARRANGE — pacote vendido e sessão realizada da Ana e do colega, no mesmo serviço
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $colega = Profissional::factory()->create(['nome' => 'Colega Fictício']);
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $sessaoA = servicoDoRanking($operadora->id, 'Sessão A Fictícia', '150.00');
    $realizado = StatusAgendamento::where('desconta_sessao', true)->orderBy('ordem')->firstOrFail();
    $daAna = pacoteDoRanking(['profissional_id' => $ana->id, 'servico_id' => $sessaoA->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 10]);
    $doColega = pacoteDoRanking(['profissional_id' => $colega->id, 'servico_id' => $sessaoA->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 10]);
    sessaoDoRanking($daAna, '09:00', $realizado);
    sessaoDoRanking($doColega, '10:00', $realizado);
    // com `fluxo_caixa.ver`: o valor vendido é a prova de que só o pacote da Ana entrou
    $escopado = usuarioEscopadoEm($ana, ['tratamentos.ver', 'fluxo_caixa.ver']);
    $semVinculo = usuarioCom(['tratamentos.ver', 'fluxo_caixa.ver'], 'Sem vínculo');
    $consulta = '/api/relatorios/servicos?'.periodoDosServicos();

    // ACT
    $doEscopado = $this->actingAs($escopado)->getJson($consulta);
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson($consulta);

    // ASSERT — 1 vendido e 1 executado (os da Ana); sem vínculo, os DOIS grupos somem e o
    // recorte vazio é explícito: `grupos: []` e `contagem: 0` (`CRR-07`)
    $doEscopado->assertOk()->assertJsonPath('totais', ['vendidos' => 1, 'executados' => 1, 'valor_vendido' => '1500.00']);
    $doSemVinculo->assertOk()
        ->assertJsonPath('totais', ['vendidos' => 0, 'executados' => 0, 'valor_vendido' => '0.00'])
        ->assertJsonPath('grupos', [])
        ->assertJsonPath('contagem', 0);
});

// ==================== change financeiro-sem-faturamento-total (D4) ====================

/**
 * Dois serviços com a MESMA quantidade vendida: o caro tem nome que vem DEPOIS na ordem
 * alfabética — o valor e o nome desempatam em sentidos opostos.
 */
function rankingDeDoisPrecos(): void
{
    $operadora = Convenio::create(['nome' => 'Operadora Fictícia']);
    $caro = servicoDoRanking($operadora->id, 'Zeta Sessão Cara', '300.00');
    $barato = servicoDoRanking($operadora->id, 'Alfa Sessão Barata', '50.00');
    pacoteDoRanking(['servico_id' => $caro->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 10]);
    pacoteDoRanking(['servico_id' => $barato->id, 'convenio_id' => $operadora->id, 'sessoes_total' => 10]);
}

it('deve tirar o valor do ranking de quem não vê o caixa: coluna, totais e desempate', function () {
    // ARRANGE
    admin();
    rankingDeDoisPrecos();
    $semCaixa = usuarioCom(['tratamentos.ver', 'agenda.ver_todos'], 'Sem o caixa');

    // ACT
    $resposta = $this->actingAs($semCaixa)->getJson('/api/relatorios/servicos?'.periodoDosServicos());

    // ASSERT — sem valor em lugar nenhum; entre iguais, o nome (o valor contaria o ranking)
    $resposta->assertOk();
    $chaves = [];
    chavesDoJsonDosServicos([$resposta->json('linhas'), $resposta->json('grupos'), $resposta->json('totais')], $chaves);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['servico', 'quantidade'])
        ->and($chaves)->not->toContain('valor')->not->toContain('valor_vendido')
        ->and($resposta->json('totais'))->toBe(['vendidos' => 2, 'executados' => 0])
        ->and(collect($resposta->json('grupos.0.linhas'))->pluck('servico')->all())
        ->toBe(['Alfa Sessão Barata (Operadora Fictícia)', 'Zeta Sessão Cara (Operadora Fictícia)']);
});

it('deve manter o valor, e o desempate por ele, a quem vê o caixa', function () {
    // ARRANGE
    admin();
    rankingDeDoisPrecos();
    $comCaixa = usuarioCom(['tratamentos.ver', 'agenda.ver_todos', 'fluxo_caixa.ver'], 'Com o caixa');

    // ACT
    $resposta = $this->actingAs($comCaixa)->getJson('/api/relatorios/servicos?'.periodoDosServicos());

    // ASSERT
    $resposta->assertOk()->assertJsonPath('totais.valor_vendido', '3500.00');
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())->toBe(['servico', 'quantidade', 'valor'])
        ->and(collect($resposta->json('grupos.0.linhas'))->pluck('servico')->all())
        ->toBe(['Zeta Sessão Cara (Operadora Fictícia)', 'Alfa Sessão Barata (Operadora Fictícia)']);
});

it('deve recusar ordenar por valor a quem não vê o caixa', function () {
    // ARRANGE
    admin();
    rankingDeDoisPrecos();
    $semCaixa = usuarioCom(['tratamentos.ver', 'agenda.ver_todos'], 'Sem o caixa');

    // ACT
    $resposta = $this->actingAs($semCaixa)->getJson('/api/relatorios/servicos?ordenar=valor&'.periodoDosServicos());

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ordenar')->assertJsonMissingPath('grupos');
});
