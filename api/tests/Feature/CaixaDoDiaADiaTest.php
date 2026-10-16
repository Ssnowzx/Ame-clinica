<?php

use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Servico;
use App\Models\StatusAgendamento;
use App\Models\TipoPagamento;
use App\Models\Transferencia;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Change `caixa-do-dia-a-dia`: registrar já pago (`pagar_agora`) no lançamento e no faturamento,
 * e ler uma transferência para editá-la. Dados 100% fictícios.
 */

/** O pedido de uma receita de criança, válido. */
function pedidoDeReceitaDoCaixa(array $sobrescritas = []): array
{
    return [
        'tipo' => 'receita',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'interessado_tipo' => 'paciente',
        'interessado_id' => Paciente::factory()->create()->id,
        'categoria_id' => Categoria::create(['nome' => 'Receita Fictícia '.fake()->unique()->numberBetween(1, 99999), 'tipo' => 'receita'])->id,
        'valor' => '450.00',
        'tipo_pagamento_id' => TipoPagamento::create(['nome' => 'PIX Fictício '.fake()->unique()->numberBetween(1, 99999)])->id,
        'conta_id' => Conta::create(['nome' => 'Caixa Fictício '.fake()->unique()->numberBetween(1, 99999)])->id,
        ...$sobrescritas,
    ];
}

// ==================== registrar já pago ====================

it('deve criar a receita já paga, com pago_em do servidor, numa criação só', function () {
    // ARRANGE — o `pago_em` do payload é outro dia: quem manda é o servidor (T-fin-07)
    $this->actingAs(admin());

    // ACT
    $resposta = $this->postJson('/api/lancamentos', pedidoDeReceitaDoCaixa([
        'pagar_agora' => true,
        'pago_em' => '2020-01-01 00:00',
    ]));

    // ASSERT — pago agora na parede da clínica; UMA criação auditada, nenhuma atualização
    $resposta->assertCreated();
    expect($resposta->json('pago_em'))->toStartWith(agoraNaClinica()->format('Y-m-d'))
        ->and(Auditoria::where('entidade', 'lancamentos_caixa')->where('acao', 'criou')->count())->toBe(1)
        ->and(Auditoria::where('entidade', 'lancamentos_caixa')->where('acao', 'atualizou')->count())->toBe(0);
});

it('deve criar em aberto quando pagar_agora é falso ou ausente', function (array $extra) {
    // ARRANGE
    $this->actingAs(admin());

    // ACT
    $resposta = $this->postJson('/api/lancamentos', pedidoDeReceitaDoCaixa($extra));

    // ASSERT
    $resposta->assertCreated();
    expect($resposta->json('pago_em'))->toBeNull();
})->with([
    'ausente' => [[]],
    'falso' => [['pagar_agora' => false]],
]);

it('deve negar o já pago a quem não dá baixa, antes da validação e sem criar nada', function () {
    // ARRANGE — lança, mas não recebe (a separação de `lancamentos.pagar`)
    admin();
    $pedido = pedidoDeReceitaDoCaixa(['pagar_agora' => true, 'valor' => 'não é número']);
    $quemLanca = usuarioCom(['lancamentos.ver', 'lancamentos.criar', 'pacientes.ver'], 'Lança sem baixa');

    // ACT
    $resposta = $this->actingAs($quemLanca)->postJson('/api/lancamentos', $pedido);

    // ASSERT — 403, e não o 422 do valor inválido: a autorização vem antes
    $resposta->assertForbidden();
    expect(LancamentoCaixa::count())->toBe(0);
});

it('deve deixar quem não dá baixa criar em aberto', function () {
    // ARRANGE
    admin();
    $pedido = pedidoDeReceitaDoCaixa();
    $quemLanca = usuarioCom(['lancamentos.ver', 'lancamentos.criar', 'pacientes.ver'], 'Lança sem baixa');

    // ACT + ASSERT
    $this->actingAs($quemLanca)->postJson('/api/lancamentos', $pedido)->assertCreated();
});

it('deve recusar o parcelado já pago sem criar nenhuma parcela', function (int $parcelas) {
    // ARRANGE — 2 é o limite (CR-CDD-03): `> 2` no lugar de `> 1` criaria 2 parcelas em aberto
    $this->actingAs(admin());

    // ACT
    $resposta = $this->postJson('/api/lancamentos', pedidoDeReceitaDoCaixa(['pagar_agora' => true, 'parcelas' => $parcelas]));

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('pagar_agora');
    expect(LancamentoCaixa::count())->toBe(0);
})->with([2, 3]);

it('deve recusar o pagar_agora na edição', function () {
    // ARRANGE — na edição a baixa é a transição própria
    $this->actingAs(admin());
    $id = $this->postJson('/api/lancamentos', pedidoDeReceitaDoCaixa())->assertCreated()->json('id');

    // ACT
    $resposta = $this->putJsonComVersao("/api/lancamentos/{$id}", ['pagar_agora' => true]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('pagar_agora');
    expect(LancamentoCaixa::find($id)->pago_em)->toBeNull();
});

it('deve recusar criar já pago no período fechado, sem criar nada', function () {
    // ARRANGE — a receita vinculada ao pacote de um convênio com julho fechado
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $pedido = pedidoDeReceitaDoCaixa([
        'pagar_agora' => true,
        'competencia' => '2026-07-01',
        'interessado_id' => $cena['tratamento']->paciente_id,
        'tratamento_id' => $cena['tratamento']->id,
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/lancamentos', $pedido);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect(LancamentoCaixa::count())->toBe(0);
});

// ==================== faturar já pago ====================

it('deve faturar a sessão já paga, com o valor e o vínculo do servidor', function () {
    // ARRANGE — a família pagou na sessão
    $this->actingAs(admin());
    [$agendamento, $payload, $convenio, $tratamento] = cenarioDeFaturamento();
    $convenio->update(['particular' => true]);

    // ACT
    $resposta = $this->postJson("/api/agendamentos/{$agendamento}/faturamento", [...$payload, 'pagar_agora' => true]);

    // ASSERT
    $resposta->assertCreated();
    $lancamento = LancamentoCaixa::findOrFail($resposta->json('id'));
    expect($lancamento->pago_em?->format('Y-m-d'))->toBe(agoraNaClinica()->format('Y-m-d'))
        ->and($lancamento->agendamento_id)->toBe($agendamento)
        ->and($lancamento->tratamento_id)->toBe($tratamento->id)
        ->and((string) $lancamento->valor)->toBe('180.00');
});

it('deve negar faturar já pago a quem não dá baixa, sem faturar', function () {
    // ARRANGE — o admin monta a cena; quem fatura só cria. O nível nasce ANTES da cena: depois
    // de uma requisição, o registro de permissões do Spatie não enxerga o nível novo
    $adminDaClinica = admin();
    $quemFatura = usuarioCom(['lancamentos.ver', 'lancamentos.criar', 'agenda.ver', 'agenda.ver_todos'], 'Fatura sem baixa');
    $this->actingAs($adminDaClinica);
    [$agendamento, $payload, $convenio] = cenarioDeFaturamento();
    $convenio->update(['particular' => true]);
    trocarDeUsuario();

    // ACT
    // a categoria inválida: o 403 tem de vir ANTES do 422 (CR-CDD-02, design D3)
    $resposta = $this->actingAs($quemFatura)
        ->postJson("/api/agendamentos/{$agendamento}/faturamento", [...$payload, 'categoria_id' => 'x', 'pagar_agora' => true]);

    // ASSERT
    $resposta->assertForbidden();
    expect(LancamentoCaixa::count())->toBe(0);
});

/**
 * Uma sessão de 01/07/2026 JÁ consumida, num convênio com ciclo (corte no dia 15) — a cena do
 * faturamento em período fechado. Mora aqui: só este arquivo a usa.
 *
 * @return array{0: int, 1: array<string, int>, 2: Convenio}
 */
function faturamentoDeJulho(): array
{
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id, 'especialidade_id' => $especialidade->id,
    ]);
    $paciente = Paciente::factory()->create();
    $convenio = Convenio::create([
        'nome' => 'Convênio Fictício de Julho '.fake()->unique()->numberBetween(1, 99999),
        'ciclo_tipo_corte' => 'dia_fixo', 'ciclo_dia_corte' => 15, 'particular' => true,
    ]);
    $servico = new Servico(['procedimento' => 'Sessão Fictícia de Julho', 'valor' => '180.00']);
    $servico->convenio_id = $convenio->id;
    $servico->save();
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $paciente->id, 'especialidade_id' => $especialidade->id, 'profissional_id' => $profissional->id,
        'convenio_id' => $convenio->id, 'servico_id' => $servico->id, 'sessoes_total' => 10,
    ]);
    $agendamento = test()->postJson('/api/agendamentos', [
        'paciente_id' => $paciente->id, 'profissional_id' => $profissional->id, 'especialidade_id' => $especialidade->id,
        'tratamento_id' => $tratamento->id, 'inicio' => '2026-07-01 10:00',
        'status_id' => StatusAgendamento::where('nome', 'Finalizado')->firstOrFail()->id,
    ])->assertCreated()->json('id');

    return [$agendamento, [
        'categoria_id' => Categoria::create(['nome' => 'Receita Fictícia de Julho', 'tipo' => 'receita'])->id,
        'tipo_pagamento_id' => TipoPagamento::create(['nome' => 'PIX Fictício de Julho'])->id,
        'conta_id' => Conta::create(['nome' => 'Caixa Fictício de Julho'])->id,
    ], $convenio];
}

it('deve recusar faturar já pago no período fechado, sem faturar', function () {
    // ARRANGE — CR-CDD-01: sem "já pago" a sessão fatura (criar em período fechado é permitido);
    // com ele, a régua única da baixa trava pelo ciclo. Sem esta rede, uma "segunda régua" que
    // gravasse o `pago_em` direto passaria em toda a suíte
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$agendamento, $payload, $convenio] = faturamentoDeJulho();
    fecharJanelaDeJulho($convenio, $adminDaClinica);

    // ACT
    $resposta = $this->postJson("/api/agendamentos/{$agendamento}/faturamento", [...$payload, 'pagar_agora' => true]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect(LancamentoCaixa::count())->toBe(0);
});

// ==================== ler uma transferência ====================

/** Duas contas fictícias e uma transferência entre elas. */
function transferenciaDoCaixa(): Transferencia
{
    return Transferencia::create([
        'conta_origem_id' => Conta::create(['nome' => 'Gaveta Fictícia '.fake()->unique()->numberBetween(1, 99999)])->id,
        'conta_destino_id' => Conta::create(['nome' => 'Banco Fictício '.fake()->unique()->numberBetween(1, 99999)])->id,
        'valor' => '2000.00',
        'data' => '2026-09-25',
        'obs' => 'Depósito fictício da semana',
    ]);
}

it('deve ler a transferência com os campos da edição', function () {
    // ARRANGE
    $this->actingAs(admin());
    $transferencia = transferenciaDoCaixa();

    // ACT
    $resposta = $this->getJson("/api/transferencias/{$transferencia->id}");

    // ASSERT
    $resposta->assertOk()->assertJson([
        'id' => $transferencia->id,
        'conta_origem_id' => $transferencia->conta_origem_id,
        'conta_destino_id' => $transferencia->conta_destino_id,
        'valor' => '2000.00',
        'data' => '2026-09-25',
        'obs' => 'Depósito fictício da semana',
    ]);
    expect($resposta->json('updated_at'))->not->toBeNull()
        ->and($resposta->json())->not->toHaveKey('clinica_id');
});

it('deve negar a leitura da transferência sem transferencias.ver', function () {
    // ARRANGE
    admin();
    $transferencia = transferenciaDoCaixa();
    $semVer = usuarioCom(['lancamentos.ver'], 'Sem transferências');

    // ACT + ASSERT
    $this->actingAs($semVer)->getJson("/api/transferencias/{$transferencia->id}")->assertForbidden();
});

it('deve usar o fuso da clínica no pago_em da criação já paga', function () {
    // ARRANGE — CR-CDD-04: relógio parado e um fuso LONGE do padrão. 22:30 UTC de 25/09 já é
    // 12:30 de 26/09 em Kiritimati (UTC+14); com o fuso do servidor, o dia sairia errado
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('clinica.timezone', 'Pacific/Kiritimati');
    $this->travelTo(CarbonImmutable::parse('2026-09-25 22:30:00', 'UTC'));

    // ACT
    $resposta = $this->postJson('/api/lancamentos', pedidoDeReceitaDoCaixa(['pagar_agora' => true]));

    // ASSERT
    expect($resposta->json('pago_em'))->toBe('2026-09-26 12:30');
});

it('deve responder 404 a id que não é número inteiro nas rotas da tela', function (string $metodo, string $rota) {
    // ARRANGE — SEC-CDD-01: `PUT /transferencias/{id}.5` gravava na transferência `{id}`, e
    // `/fornecedores/abc` dava 500; a régua da casa é `whereNumber` (SEC-RPP-08)
    $this->actingAs(admin());
    $transferencia = transferenciaDoCaixa();
    $rota = str_replace('{id}', (string) $transferencia->id, $rota);

    // ACT
    $resposta = $this->json($metodo, $rota, ['valor' => '999.00']);

    // ASSERT
    $resposta->assertNotFound();
    expect((string) $transferencia->fresh()?->valor)->toBe('2000.00');
})->with([
    'PUT transferência fracionária' => ['PUT', '/api/transferencias/{id}.5'],
    'DELETE transferência fracionária' => ['DELETE', '/api/transferencias/{id}.9'],
    'GET fornecedor texto' => ['GET', '/api/fornecedores/abc'],
    'PUT fornecedor texto' => ['PUT', '/api/fornecedores/abc'],
    'DELETE fornecedor texto' => ['DELETE', '/api/fornecedores/abc'],
    'GET funcionário texto' => ['GET', '/api/funcionarios/abc'],
    'PUT funcionário texto' => ['PUT', '/api/funcionarios/abc'],
    'DELETE funcionário texto' => ['DELETE', '/api/funcionarios/abc'],
]);
