<?php

use App\Models\Agendamento;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Subcategoria;
use App\Models\TipoPagamento;

/**
 * O relatório `extrato-do-paciente` (change `area-de-relatorios`, task 2.9): as DUAS permissões
 * (`lancamentos.ver` E `agenda.ver`) e o PORTÃO por-id do eixo agenda (`SEC-REL-02`/`CRR-05`);
 * `paciente_id` obrigatório e existente (403 antes, 422 sem id ou id inexistente); os lançamentos da
 * criança pelo VENCIMENTO no período; situação Pago / Em aberto / Vencido; totais pago · em
 * aberto · saldo somados no banco (cenário da spec: 300 pagos, 100 em aberto → saldo 100);
 * descrição derivada, categoria › subcategoria, despesa negativa.
 *
 * LGPD: dados 100% fictícios.
 */

/**
 * Um lançamento em nome da criança (o vínculo é o INTERESSADO, como o faturamento grava).
 *
 * @param  array<string, mixed>  $extras  campos fillable a sobrescrever
 * @param  array<string, mixed>  $serverSet  campos fora do fillable (pago_em, parcela…)
 */
function lancamentoDaCrianca(Paciente $crianca, string $vencimento, string $valor, array $extras = [], array $serverSet = []): LancamentoCaixa
{
    $lancamento = new LancamentoCaixa([
        'tipo' => 'receita',
        'competencia' => $vencimento,
        'vencimento' => $vencimento,
        'interessado_tipo' => 'paciente',
        'interessado_id' => $crianca->id,
        'valor' => $valor,
        'contabil' => true,
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Sessões Fictícias', 'tipo' => 'receita'])->id,
        'tipo_pagamento_id' => TipoPagamento::create(['nome' => 'Pgto Fictício '.fake()->unique()->numberBetween(1, 99999)])->id,
        'conta_id' => Conta::create(['nome' => 'Caixa Fictício '.fake()->unique()->numberBetween(1, 99999)])->id,
        ...$extras,
    ]);
    $lancamento->forceFill($serverSet)->save();

    return $lancamento->refresh();
}

/** A query string do período: 30 dias para trás e 10 para a frente de hoje da clínica. */
function periodoDoExtrato(): string
{
    return 'de='.agoraNaClinica()->subDays(30)->toDateString().'&ate='.agoraNaClinica()->addDays(10)->toDateString();
}

it('deve exigir lancamentos.ver E agenda.ver antes de tudo e um paciente_id que exista', function () {
    // ARRANGE — um sem `lancamentos.ver`, um sem `agenda.ver`
    $adminDoA = admin();
    $semCaixa = usuarioCom(['pacientes.ver'], 'Sem caixa');
    $semAgenda = usuarioCom(['lancamentos.ver'], 'Sem agenda');
    trocarDeUsuario();

    // ACT + ASSERT — 403 antes de reclamar do parâmetro que falta
    $this->actingAs($semCaixa)->getJson('/api/relatorios/extrato-do-paciente?'.periodoDoExtrato())->assertForbidden();
    trocarDeUsuario();
    // ...e `lancamentos.ver` sozinha não basta (`SEC-REL-02`/`CRR-05`): a busca de paciente
    // desta tela depende de `agenda.ver`, e é o eixo agenda que decide o portão por-id
    $this->actingAs($semAgenda)->getJson('/api/relatorios/extrato-do-paciente?'.periodoDoExtrato())->assertForbidden();
    trocarDeUsuario();

    // ...sem id, 422; id inexistente, 422
    $this->actingAs($adminDoA)->getJson('/api/relatorios/extrato-do-paciente?'.periodoDoExtrato())
        ->assertUnprocessable()->assertJsonValidationErrors(['paciente_id']);
    $this->getJson('/api/relatorios/extrato-do-paciente?'.periodoDoExtrato().'&paciente_id=999999')
        ->assertUnprocessable()->assertJsonValidationErrors(['paciente_id']);
});

it('deve barrar com 403 o extrato de criança fora do escopo — inclusive a que não tem lançamento nenhum (SEC-REL-02)', function () {
    // ARRANGE — a Ana atende a Bruna; a Carla é de um colega e a Dora não é de ninguém. A Dora é
    // o caso que importa: SEM lançamento, o relatório respondia 200 com "Paciente: Dora" no
    // cabeçalho, e um id inexistente respondia 422 — a diferença entre as duas ENUMERAVA o
    // cadastro de menores por força bruta de id, devolvendo o NOME.
    admin();
    $ana = Profissional::factory()->create(['nome' => 'Ana Fictícia']);
    $bruna = Paciente::factory()->create(['nome' => 'Bruna Fictícia']);
    $carla = Paciente::factory()->create(['nome' => 'Carla Fictícia']);
    $dora = Paciente::factory()->create(['nome' => 'Dora Fictícia']);
    Agendamento::factory()->create([
        'paciente_id' => $bruna->id,
        'profissional_id' => $ana->id,
        'inicio' => agoraNaClinica()->toDateString().' 09:00',
        'fim' => agoraNaClinica()->toDateString().' 09:40',
    ]);
    lancamentoDaCrianca($bruna, agoraNaClinica()->toDateString(), '100.00');
    lancamentoDaCrianca($carla, agoraNaClinica()->toDateString(), '100.00');
    // sem as flags, vinculado à Ana: escopo `de(Ana)` no eixo agenda
    $escopado = usuarioEscopadoEm($ana, ['lancamentos.ver']);
    // o papel real do balcão (AP-10): `agenda.ver_todos`, sem vínculo — tem de continuar lendo
    $faturista = usuarioCom(['lancamentos.ver', 'agenda.ver', 'agenda.ver_todos'], 'Faturista Fictícia');
    // sem flag e sem vínculo: `nenhum`, fail-closed em qualquer criança
    $semVinculo = usuarioCom(['lancamentos.ver', 'agenda.ver'], 'Sem vínculo');
    $periodo = periodoDoExtrato();

    // ACT + ASSERT — a criança dele passa
    $this->actingAs($escopado)->getJson("/api/relatorios/extrato-do-paciente?{$periodo}&paciente_id={$bruna->id}")
        ->assertOk()->assertJsonPath('filtros_aplicados.0.valor', 'Bruna Fictícia');
    // ...a criança do colega, 403
    trocarDeUsuario();
    $this->actingAs($escopado)->getJson("/api/relatorios/extrato-do-paciente?{$periodo}&paciente_id={$carla->id}")
        ->assertForbidden();
    // ...e a criança SEM lançamento também é 403, não 200-com-o-nome
    trocarDeUsuario();
    $semLancamento = $this->actingAs($escopado)->getJson("/api/relatorios/extrato-do-paciente?{$periodo}&paciente_id={$dora->id}");
    $semLancamento->assertForbidden();
    semVazamento($semLancamento->json(), 'Dora Fictícia');

    // ...sem vínculo e sem flag, nem a criança que tem lançamento
    trocarDeUsuario();
    $this->actingAs($semVinculo)->getJson("/api/relatorios/extrato-do-paciente?{$periodo}&paciente_id={$bruna->id}")
        ->assertForbidden();

    // ...e o faturista do AP-10 continua lendo qualquer criança, que é o trabalho dele
    trocarDeUsuario();
    $this->actingAs($faturista)->getJson("/api/relatorios/extrato-do-paciente?{$periodo}&paciente_id={$carla->id}")
        ->assertOk()->assertJsonPath('filtros_aplicados.0.valor', 'Carla Fictícia');
    trocarDeUsuario();
    $this->actingAs($faturista)->getJson("/api/relatorios/extrato-do-paciente?{$periodo}&paciente_id={$dora->id}")
        ->assertOk()->assertJsonPath('totais.saldo', '0.00');
});

it('deve listar os lançamentos da criança pelo vencimento no período, com totais pago, em aberto e saldo', function () {
    // ARRANGE — cenário da spec: R$ 300 pagos (200 + 100) e R$ 100 em aberto (vencido ontem);
    // um lançamento fora do período e um de outra criança ficam de fora
    $this->actingAs(admin());
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia do Extrato']);
    $outra = Paciente::factory()->create(['nome' => 'Outra Criança Fictícia']);
    $ha5 = agoraNaClinica()->subDays(5)->toDateString();
    $ha3 = agoraNaClinica()->subDays(3)->toDateString();
    $ontem = agoraNaClinica()->subDay()->toDateString();
    lancamentoDaCrianca($crianca, $ha3, '100.00', [], ['pago_em' => "{$ha3} 10:00"]);
    lancamentoDaCrianca($crianca, $ha5, '200.00', [], ['pago_em' => "{$ha5} 10:00"]);
    lancamentoDaCrianca($crianca, $ontem, '100.00');
    lancamentoDaCrianca($crianca, agoraNaClinica()->subDays(40)->toDateString(), '999.00');
    lancamentoDaCrianca($outra, $ha3, '500.00');

    // ACT
    $resposta = $this->getJson('/api/relatorios/extrato-do-paciente?'.periodoDoExtrato()."&paciente_id={$crianca->id}")->assertOk();

    // ASSERT — o envelope com a criança no cabeçalho, as colunas e os totais em decimal
    $resposta->assertJsonPath('slug', 'extrato-do-paciente')
        ->assertJsonPath('titulo', 'Extrato do paciente')
        ->assertJsonPath('filtros_aplicados', [['rotulo' => 'Paciente', 'valor' => 'Criança Fictícia do Extrato']])
        ->assertJsonPath('grupos', null)
        ->assertJsonPath('totais', ['pago' => '300.00', 'em_aberto' => '100.00', 'saldo' => '100.00'])
        ->assertJsonPath('contagem', 3)
        ->assertJsonPath('truncado', false);
    expect(collect($resposta->json('colunas'))->pluck('chave')->all())
        ->toBe(['data', 'descricao', 'categoria', 'valor', 'situacao', 'pago_em'])
        ->and(collect($resposta->json('colunas'))->pluck('tipo')->all())
        ->toBe(['data', 'texto', 'texto', 'dinheiro', 'texto', 'data']);

    // ...as linhas em ordem de vencimento, com a situação e o pago_em
    expect($resposta->json('linhas'))->toBe([
        ['data' => $ha5, 'descricao' => 'Receita', 'categoria' => 'Sessões Fictícias', 'valor' => '200.00', 'situacao' => 'Pago', 'pago_em' => $ha5],
        ['data' => $ha3, 'descricao' => 'Receita', 'categoria' => 'Sessões Fictícias', 'valor' => '100.00', 'situacao' => 'Pago', 'pago_em' => $ha3],
        ['data' => $ontem, 'descricao' => 'Receita', 'categoria' => 'Sessões Fictícias', 'valor' => '100.00', 'situacao' => 'Vencido', 'pago_em' => ''],
    ]);
    semVazamento($resposta->json(), 'Outra Criança Fictícia');
});

it('deve descrever o lançamento pelo que ele é, mostrar categoria › subcategoria e entrar a despesa negativa no saldo', function () {
    // ARRANGE — uma sessão faturada (com agendamento), uma parcela com documento e subcategoria,
    // e uma despesa em nome da criança (devolução), tudo em aberto e ainda no prazo
    $this->actingAs(admin());
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia do Extrato']);
    $hoje = agoraNaClinica()->toDateString();
    $daqui3 = agoraNaClinica()->addDays(3)->toDateString();
    $ha2 = agoraNaClinica()->subDays(2)->toDateString();
    $sessao = Agendamento::factory()->create(['paciente_id' => $crianca->id, 'inicio' => "{$ha2} 09:00", 'fim' => "{$ha2} 09:40"]);
    lancamentoDaCrianca($crianca, $hoje, '150.00', ['competencia' => $ha2], ['agendamento_id' => $sessao->id]);
    $categoria = Categoria::create(['nome' => 'Mensalidade Fictícia', 'tipo' => 'receita']);
    lancamentoDaCrianca($crianca, $daqui3, '100.00', [
        'categoria_id' => $categoria->id,
        'subcategoria_id' => Subcategoria::create(['categoria_id' => $categoria->id, 'nome' => 'Setembro'])->id,
        'documento' => 'NF-7',
    ], ['parcela' => 2, 'parcelas_total' => 3, 'grupo_parcelamento' => fake()->uuid()]);
    lancamentoDaCrianca($crianca, $daqui3, '30.00', ['tipo' => 'despesa', 'categoria_id' => Categoria::create(['nome' => 'Devolução Fictícia', 'tipo' => 'despesa'])->id]);

    // ACT
    $resposta = $this->getJson('/api/relatorios/extrato-do-paciente?'.periodoDoExtrato()."&paciente_id={$crianca->id}")->assertOk();

    // ASSERT — a descrição derivada, a categoria composta, o sinal da despesa e o saldo líquido
    $linhas = collect($resposta->json('linhas'));
    expect($linhas->pluck('descricao')->all())->toBe(['Sessão de '.agoraNaClinica()->subDays(2)->format('d/m/Y'), 'Receita · Doc. NF-7 (2/3)', 'Despesa'])
        ->and($linhas->pluck('categoria')->all())->toBe(['Sessões Fictícias', 'Mensalidade Fictícia › Setembro', 'Devolução Fictícia'])
        ->and($linhas->pluck('valor')->all())->toBe(['150.00', '100.00', '-30.00'])
        ->and($linhas->pluck('situacao')->unique()->all())->toBe(['Em aberto'])
        ->and($resposta->json('totais'))->toBe(['pago' => '0.00', 'em_aberto' => '220.00', 'saldo' => '220.00']);
});
