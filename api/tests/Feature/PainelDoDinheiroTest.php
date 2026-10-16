<?php

use App\Models\Agendamento;
use Carbon\CarbonImmutable;
use Illuminate\Testing\TestResponse;

/**
 * O painel do DINHEIRO (change indicadores-profissionais, D4/D9): `GET /api/indicadores/painel/dinheiro`
 * sob `fluxo_caixa.ver` — agregado da clínica, dinheiro como string decimal. Dados 100% fictícios.
 *
 * Relógio FIXO: segunda, 5 de outubro de 2026, 10h na parede da clínica. Período 1–5/10, comparado
 * 1–5/9. Os lançamentos nascem pelo `lancamentoNoCaixa()` (catálogo fictício da clínica).
 */
const MES_DO_PAINEL_DINHEIRO = '2026-10';

function relogioDoPainelDinheiro(): void
{
    test()->travelTo(CarbonImmutable::parse('2026-10-05 10:00:00', 'America/Sao_Paulo'));
}

/** Um atendimento agendado no dia: o histórico da clínica começa no mês dele. */
function historicoDoPainelDinheiro(string $dia = '2026-08-10'): Agendamento
{
    return Agendamento::factory()->create(['inicio' => "{$dia} 09:00", 'fim' => "{$dia} 09:40"]);
}

/** Receita PAGA no instante dado (o `pago_em` é do servidor). */
function recebidoDoPainelDinheiro(string $valor, string $pagoEm, array $atributos = []): void
{
    lancamentoNoCaixa($valor, $atributos, ['pago_em' => $pagoEm]);
}

/** Receita em ABERTO vencendo no dia dado. */
function aReceberDoPainelDinheiro(string $valor, string $vencimento, array $atributos = []): void
{
    lancamentoNoCaixa($valor, ['vencimento' => $vencimento, ...$atributos]);
}

/** O lançamento de uma sessão FATURADA (o faturamento grava o `agendamento_id`), competência = a data da sessão. */
function faturadoDoPainelDinheiro(string $valor, string $competencia): void
{
    lancamentoNoCaixa($valor, ['competencia' => $competencia], ['agendamento_id' => historicoDoPainelDinheiro($competencia)->id]);
}

function painelDoDinheiro(string $mes = MES_DO_PAINEL_DINHEIRO): TestResponse
{
    return test()->getJson("/api/indicadores/painel/dinheiro?mes={$mes}");
}

it('deve responder 403 a quem não tem fluxo_caixa.ver — antes de validar o mês', function () {
    // ARRANGE — vê lançamentos e agenda, mas não o caixa da clínica
    admin();
    $semCaixa = usuarioCom(['lancamentos.ver', 'agenda.ver', 'pacientes.ver'], 'Sem Caixa do Painel');

    // ACT + ASSERT
    $this->actingAs($semCaixa);
    painelDoDinheiro()->assertForbidden();
    painelDoDinheiro('2026-13')->assertForbidden();
});

it('deve responder 422 ao mês futuro da clínica', function () {
    // ARRANGE
    relogioDoPainelDinheiro();
    $this->actingAs(admin());

    // ACT + ASSERT
    painelDoDinheiro('2026-11')->assertUnprocessable()->assertJsonValidationErrors('mes');
});

it('deve comparar o recebido de 1 a 5 de outubro com o de 1 a 5 de setembro', function () {
    // ARRANGE — histórico desde agosto
    relogioDoPainelDinheiro();
    $this->actingAs(admin());
    historicoDoPainelDinheiro();
    recebidoDoPainelDinheiro('7000.00', '2026-10-02 11:00:00', ['juros' => '60.60']);
    recebidoDoPainelDinheiro('500.00', '2026-10-05 09:00:00');
    recebidoDoPainelDinheiro('6400.00', '2026-09-03 15:00:00');
    // fora: despesa paga no período, receita depois do 5 de setembro
    lancamentoNoCaixa('900.00', ['tipo' => 'despesa'], ['pago_em' => '2026-10-02 11:00:00']);
    recebidoDoPainelDinheiro('1000.00', '2026-09-20 10:00:00');

    // ACT
    $painel = painelDoDinheiro()->assertOk();

    // ASSERT — a fórmula do extrato (valor + juros + multa − desconto), em string
    expect($painel->json('recebido'))->toBe(['atual' => '7560.60', 'anterior' => '6400.00']);
});

it('deve somar no recebido do mês fechado o MESMO que o gráfico da aba Financeiro mostra', function () {
    // ARRANGE — setembro inteiro (mês fechado em 5/10)
    relogioDoPainelDinheiro();
    $this->actingAs(admin());
    historicoDoPainelDinheiro();
    recebidoDoPainelDinheiro('100.00', '2026-09-01 08:00:00');
    recebidoDoPainelDinheiro('250.50', '2026-09-30 22:00:00', ['desconto' => '0.50']);
    lancamentoNoCaixa('80.00', ['tipo' => 'despesa'], ['pago_em' => '2026-09-15 10:00:00']);

    // ACT — a aba Financeiro desenha `serie_do_ano` dos gráficos (CR-IND-10), não a série de 6 meses
    // da vista antiga `/indicadores/financeiro`, que nenhuma tela consome
    $painel = painelDoDinheiro('2026-09')->assertOk();
    $graficos = $this->getJson('/api/indicadores/financeiro/graficos?mes=2026-09')->assertOk();

    // ASSERT — o cartão, a série do painel e o gráfico da aba dizem o mesmo número
    expect($painel->json('recebido.atual'))->toBe('350.00')
        ->and($painel->json('serie_recebido.5.valor'))->toBe('350.00')
        ->and(collect($graficos->json('serie_do_ano'))->firstWhere('mes', '2026-09')['recebidas'])->toBe('350.00');
});

it('deve somar a receber só o que vence de hoje até o fim do mês e ainda não foi pago', function () {
    // ARRANGE
    relogioDoPainelDinheiro();
    $this->actingAs(admin());
    aReceberDoPainelDinheiro('100.00', '2026-10-05');
    aReceberDoPainelDinheiro('200.00', '2026-10-31');
    // fora: vence no mês seguinte, já venceu (é atraso), é despesa, já foi pago
    aReceberDoPainelDinheiro('400.00', '2026-11-01');
    aReceberDoPainelDinheiro('800.00', '2026-10-04');
    aReceberDoPainelDinheiro('300.00', '2026-10-20', ['tipo' => 'despesa']);
    lancamentoNoCaixa('50.00', ['vencimento' => '2026-10-20'], ['pago_em' => '2026-10-01 10:00:00']);

    // ACT + ASSERT — e no mês fechado não há mais o que receber nele
    expect(painelDoDinheiro()->assertOk()->json('a_receber_no_mes'))->toBe('300.00')
        ->and(painelDoDinheiro('2026-09')->assertOk()->json('a_receber_no_mes'))->toBe('0.00');
});

it('deve contar em atraso as RECEITAS pela mesma regra do sino, que também lista as despesas', function () {
    // ARRANGE — duas receitas vencidas; uma vence hoje (não está atrasada); uma despesa vencida;
    // uma receita vencida antes da janela do centro (366 dias)
    relogioDoPainelDinheiro();
    $this->actingAs(admin());
    aReceberDoPainelDinheiro('100.00', '2026-10-04');
    aReceberDoPainelDinheiro('50.50', '2026-09-01');
    aReceberDoPainelDinheiro('70.00', '2026-10-05');
    aReceberDoPainelDinheiro('999.00', '2026-10-01', ['tipo' => 'despesa']);
    aReceberDoPainelDinheiro('333.00', '2025-09-01');

    // ACT
    $painel = painelDoDinheiro()->assertOk();
    $sino = $this->getJson('/api/notificacoes')->assertOk();

    // ASSERT — o mesmo predicado: o sino conta 3 (as duas receitas e a despesa), o painel as 2 receitas
    expect($painel->json('em_atraso'))->toBe(['valor' => '150.50', 'quantidade' => 2])
        ->and($sino->json('lancamentos_em_atraso.total'))->toBe(3);
});

it('deve calcular o valor médio das sessões faturadas no período, arredondando o meio centavo para cima', function () {
    // ARRANGE — duas sessões de outubro (10,00 e 10,01); uma de setembro (80,00); fora: competência
    // depois do dia 5 e lançamento de pacote, sem sessão
    relogioDoPainelDinheiro();
    $this->actingAs(admin());
    historicoDoPainelDinheiro();
    faturadoDoPainelDinheiro('10.00', '2026-10-01');
    faturadoDoPainelDinheiro('10.01', '2026-10-02');
    faturadoDoPainelDinheiro('80.00', '2026-09-02');
    faturadoDoPainelDinheiro('500.00', '2026-10-20');
    lancamentoNoCaixa('900.00', ['competencia' => '2026-10-01']);

    // ACT
    $painel = painelDoDinheiro()->assertOk();

    // ASSERT — 20,01 ÷ 2 = 10,005 → 10,01
    expect($painel->json('valor_medio_sessao'))->toBe(['atual' => '10.01', 'anterior' => '80.00']);
});

it('deve devolver valor médio nulo quando não há sessão faturada no período', function () {
    // ARRANGE — histórico desde agosto, nenhuma sessão faturada
    relogioDoPainelDinheiro();
    $this->actingAs(admin());
    historicoDoPainelDinheiro();

    // ACT + ASSERT — nunca "0.00" por divisão
    expect(painelDoDinheiro()->assertOk()->json('valor_medio_sessao'))->toBe(['atual' => null, 'anterior' => null]);
});

it('deve trazer seis meses de recebido com NULO antes do início do histórico', function () {
    // ARRANGE — o histórico começa em agosto; houve recebimento em julho (antes do sistema)
    relogioDoPainelDinheiro();
    $this->actingAs(admin());
    historicoDoPainelDinheiro('2026-08-10');
    recebidoDoPainelDinheiro('300.00', '2026-07-15 10:00:00');
    recebidoDoPainelDinheiro('120.00', '2026-09-15 10:00:00');
    recebidoDoPainelDinheiro('45.00', '2026-10-01 10:00:00');

    // ACT
    $painel = painelDoDinheiro()->assertOk();

    // ASSERT — maio a julho ausentes (nunca zero); agosto sem movimento é "0.00"
    expect($painel->json('serie_recebido'))->toBe([
        ['mes' => '2026-05', 'valor' => null],
        ['mes' => '2026-06', 'valor' => null],
        ['mes' => '2026-07', 'valor' => null],
        ['mes' => '2026-08', 'valor' => '0.00'],
        ['mes' => '2026-09', 'valor' => '120.00'],
        ['mes' => '2026-10', 'valor' => '45.00'],
    ])
        ->and($painel->json('inicio_historico'))->toBe('2026-08');
});

it('deve anular as comparações quando o período comparado é anterior ao histórico', function () {
    // ARRANGE — o primeiro agendamento é de outubro
    relogioDoPainelDinheiro();
    $this->actingAs(admin());
    historicoDoPainelDinheiro('2026-10-01');
    recebidoDoPainelDinheiro('6400.00', '2026-09-03 15:00:00');

    // ACT
    $painel = painelDoDinheiro()->assertOk();

    // ASSERT
    expect($painel->json('recebido.anterior'))->toBeNull()
        ->and($painel->json('valor_medio_sessao.anterior'))->toBeNull();
});

it('deve devolver o formato EXATO do contrato D9, com dinheiro em string', function () {
    // ARRANGE — histórico desde agosto e movimento nos dois períodos
    relogioDoPainelDinheiro();
    $this->actingAs(admin());
    historicoDoPainelDinheiro();
    recebidoDoPainelDinheiro('10.00', '2026-10-02 10:00:00');
    recebidoDoPainelDinheiro('20.00', '2026-09-02 10:00:00');
    faturadoDoPainelDinheiro('85.00', '2026-10-01');
    faturadoDoPainelDinheiro('80.00', '2026-09-01');

    // ACT
    $painel = painelDoDinheiro()->assertOk();

    // ASSERT — as chaves exatas e o tipo de cada uma
    $painel->assertExactJsonStructure([
        'periodo' => ['mes', 'de', 'ate', 'parcial', 'comparado_de', 'comparado_ate'],
        'inicio_historico',
        'inicio_historico_dia',
        'recebido' => ['atual', 'anterior'],
        'a_receber_no_mes',
        'em_atraso' => ['valor', 'quantidade'],
        'valor_medio_sessao' => ['atual', 'anterior'],
        'serie_recebido' => ['*' => ['mes', 'valor']],
    ]);
    expect($painel->json('recebido.atual'))->toBeString()->toMatch('/^-?\d+\.\d{2}$/')
        ->and($painel->json('recebido.anterior'))->toBeString()
        ->and($painel->json('a_receber_no_mes'))->toBeString()
        ->and($painel->json('em_atraso.valor'))->toBeString()
        ->and($painel->json('em_atraso.quantidade'))->toBeInt()
        ->and($painel->json('valor_medio_sessao.atual'))->toBe('85.00')
        ->and($painel->json('serie_recebido'))->toHaveCount(6)
        ->and($painel->json('periodo.parcial'))->toBeTrue()
        ->and($painel->json('inicio_historico_dia'))->toBe('2026-08-10');
});
