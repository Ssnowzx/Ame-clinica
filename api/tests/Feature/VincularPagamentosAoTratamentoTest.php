<?php

use App\Exceptions\CorridaDoCicloException;
use App\Http\Controllers\LancamentoVinculoController;
use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Convenio;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\TipoPagamento;
use App\Models\Tratamento;
use App\Support\Financeiro\LancamentoCaixaService;
use App\Support\Financeiro\SugestaoDeTratamento;
use App\Support\Rbac\EscopoDoProfissional;
use Illuminate\Support\Facades\DB;

/**
 * O vínculo pagamento → tratamento CONDUZIDO (change `vincular-pagamentos-ao-tratamento`): a
 * sugestão (um só pacote particular em andamento), a lista do que ficou sem tratamento e o lote
 * tudo-ou-nada. Nasceu da contagem de setembro/2026 na produção: 29 de 33 receitas lançadas com a
 * criança e sem o tratamento — em "Sem profissional" no fechamento.
 *
 * LGPD: dados 100% fictícios.
 */

/** @return array{particular: Convenio, operadora: Convenio, ana: Profissional, bia: Profissional} */
function cenaDoLote(): array
{
    return [
        'particular' => Convenio::create(['nome' => 'Particular Fictício', 'particular' => true]),
        'operadora' => Convenio::create(['nome' => 'Operadora Fictícia']),
        'ana' => Profissional::factory()->create(['nome' => 'Ana Fictícia']),
        'bia' => Profissional::factory()->create(['nome' => 'Bia Fictícia']),
    ];
}

function pacoteDoLote(Paciente $crianca, Convenio $convenio, Profissional $profissional, string $status = 'andamento'): Tratamento
{
    return Tratamento::factory()->create([
        'paciente_id' => $crianca->id, 'convenio_id' => $convenio->id,
        'profissional_id' => $profissional->id, 'status' => $status,
    ]);
}

/** Receita da criança, paga em `$pagoEm`, sem sessão e sem tratamento — o formato de setembro. */
function pagamentoDoLote(Paciente $crianca, string $pagoEm = '2026-09-10 09:00', string $valor = '300.00'): LancamentoCaixa
{
    $lancamento = new LancamentoCaixa([
        'tipo' => 'receita', 'competencia' => '2026-09-01', 'vencimento' => '2026-09-01',
        'interessado_tipo' => 'paciente', 'interessado_id' => $crianca->id, 'valor' => $valor, 'contabil' => true,
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Receita Fictícia', 'tipo' => 'receita'])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'PIX Fictício'])->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Caixa Fictício'])->id,
    ]);
    $lancamento->forceFill(['pago_em' => $pagoEm])->save();

    return $lancamento->refresh();
}

function sugestaoPara(Paciente $crianca): mixed
{
    return test()->getJson("/api/lancamentos/sugestao-de-tratamento?paciente_id={$crianca->id}")->assertOk()->json('tratamento_id');
}

// ==================== a sugestão ====================

it('deve sugerir o único pacote particular em andamento, sem contar convênio nem encerrado', function () {
    // ARRANGE
    $this->actingAs(admin());
    $cena = cenaDoLote();
    $crianca = Paciente::factory()->create();
    $pacote = pacoteDoLote($crianca, $cena['particular'], $cena['ana']);
    pacoteDoLote($crianca, $cena['operadora'], $cena['bia']);
    pacoteDoLote($crianca, $cena['particular'], $cena['bia'], 'finalizado');

    // ACT + ASSERT
    expect(sugestaoPara($crianca))->toBe($pacote->id);
});

it('não deve sugerir quando há dois pacotes particulares em andamento, ou nenhum', function () {
    // ARRANGE — com dois, "o mais recente" erraria o dinheiro em silêncio
    $this->actingAs(admin());
    $cena = cenaDoLote();
    $comDois = Paciente::factory()->create();
    pacoteDoLote($comDois, $cena['particular'], $cena['ana']);
    pacoteDoLote($comDois, $cena['particular'], $cena['bia']);
    $semNenhum = Paciente::factory()->create();
    pacoteDoLote($semNenhum, $cena['operadora'], $cena['ana']);

    // ACT + ASSERT
    expect(sugestaoPara($comDois))->toBeNull()
        ->and(sugestaoPara($semNenhum))->toBeNull();
});

it('não deve sugerir ao escopado o pacote de um colega', function () {
    // ARRANGE
    admin();
    $cena = cenaDoLote();
    $crianca = Paciente::factory()->create();
    pacoteDoLote($crianca, $cena['particular'], $cena['bia']);
    $ana = usuarioEscopadoEm($cena['ana'], ['tratamentos.ver']);

    // ACT
    $resposta = $this->actingAs($ana)->getJson("/api/lancamentos/sugestao-de-tratamento?paciente_id={$crianca->id}");

    // ASSERT
    $resposta->assertOk()->assertJsonPath('tratamento_id', null);
});

it('deve negar a sugestão a quem não vê tratamentos', function () {
    // ARRANGE
    admin();
    $crianca = Paciente::factory()->create();
    $quemLanca = usuarioCom(['lancamentos.ver', 'lancamentos.criar'], 'Lança sem tratamentos');

    // ACT + ASSERT
    $this->actingAs($quemLanca)->getJson("/api/lancamentos/sugestao-de-tratamento?paciente_id={$crianca->id}")->assertForbidden();
});

// ==================== a lista ====================

it('deve listar só as receitas pagas no período, da criança, sem sessão nem tratamento, com a sugestão', function () {
    // ARRANGE
    $this->actingAs(admin());
    $cena = cenaDoLote();
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia do Lote']);
    $pacote = pacoteDoLote($crianca, $cena['particular'], $cena['ana']);
    // CR-VPT-10: um pacote com os derivados FORA do trivial — 3 de 10 feitas, vencido, parado (não é
    // candidato à sugestão). Sem as colunas de onde saem, o rótulo do lote diria "0/10" e sem "vencido"
    $parado = Tratamento::factory()->create([
        'paciente_id' => $crianca->id, 'convenio_id' => $cena['particular']->id, 'profissional_id' => $cena['bia']->id,
        'sessoes_total' => 10, 'sessoes_realizadas' => 3, 'data_inicio' => '2020-01-01', 'validade_dias' => 30,
        'status' => 'parado',
    ]);
    $semTratamento = pagamentoDoLote($crianca);
    pagamentoDoLote($crianca, '2026-08-20 09:00');                                   // outro mês
    $jaVinculado = pagamentoDoLote($crianca);
    $jaVinculado->forceFill(['tratamento_id' => $pacote->id])->saveQuietly();        // já tem tratamento
    $emAberto = pagamentoDoLote($crianca);
    $emAberto->forceFill(['pago_em' => null])->saveQuietly();                        // não pago

    // ACT
    $resposta = $this->getJson('/api/lancamentos/sem-tratamento?de=2026-09-01&ate=2026-09-30');

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('data'))->toHaveCount(1)
        ->and($resposta->json('data.0'))->toMatchArray([
            'id' => $semTratamento->id,
            'liquido' => '300.00',
            'paciente' => ['id' => $crianca->id, 'nome' => 'Criança Fictícia do Lote'],
            'sugestao' => ['tratamento_id' => $pacote->id, 'especialidade' => $pacote->especialidade->nome, 'profissional' => 'Ana Fictícia', 'convenio' => 'Particular Fictício'],
        ])
        ->and($resposta->json('data.0.tratamentos_da_crianca'))->toBe([[
            'id' => $pacote->id,
            'especialidade_id' => $pacote->especialidade_id,
            'profissional_id' => $cena['ana']->id,
            'convenio_id' => $cena['particular']->id,
            'sessoes_total' => $pacote->fresh()->sessoes_total,
            'sessoes_saldo' => $pacote->fresh()->sessoes_saldo,
            'vencido' => $pacote->fresh()->vencido,
            'status' => 'andamento',
        ], [
            'id' => $parado->id,
            'especialidade_id' => $parado->especialidade_id,
            'profissional_id' => $cena['bia']->id,
            'convenio_id' => $cena['particular']->id,
            'sessoes_total' => 10,
            'sessoes_saldo' => 7,
            'vencido' => true,
            'status' => 'parado',
        ]]);
});

it('deve negar a lista e o lote a quem não dá baixa', function () {
    // ARRANGE — trocar o vínculo do pago é de quem dá baixa (SEC-RPP-03)
    admin();
    $semBaixa = usuarioCom(['lancamentos.ver', 'lancamentos.editar', 'tratamentos.ver', 'agenda.ver_todos'], 'Edita sem baixa');

    // ACT + ASSERT
    $this->actingAs($semBaixa)->getJson('/api/lancamentos/sem-tratamento?de=2026-09-01&ate=2026-09-30')->assertForbidden();
    $this->actingAs($semBaixa)->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [['lancamento_id' => 1, 'tratamento_id' => 1]]])->assertForbidden();
});

// ==================== o lote ====================

it('deve vincular o lote inteiro, com auditoria e sem mexer na data do pagamento', function () {
    // ARRANGE
    $this->actingAs(admin());
    $cena = cenaDoLote();
    $pares = [];
    foreach (['Um', 'Dois', 'Três'] as $n) {
        $crianca = Paciente::factory()->create(['nome' => "Criança Fictícia {$n}"]);
        $pares[] = [pagamentoDoLote($crianca), pacoteDoLote($crianca, $cena['particular'], $cena['ana'])];
    }

    // ACT
    $resposta = $this->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => array_map(
        fn (array $par) => ['lancamento_id' => $par[0]->id, 'tratamento_id' => $par[1]->id], $pares,
    )]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('vinculados', 3);
    foreach ($pares as [$lancamento, $pacote]) {
        expect($lancamento->fresh()->tratamento_id)->toBe($pacote->id)
            ->and($lancamento->fresh()->pago_em->format('Y-m-d H:i'))->toBe('2026-09-10 09:00');
    }
    expect(Auditoria::where('entidade', 'lancamentos_caixa')->where('acao', 'atualizou')->count())->toBe(3);
});

it('deve recusar o lote inteiro quando um item aponta o tratamento de outra criança', function () {
    // ARRANGE
    $this->actingAs(admin());
    $cena = cenaDoLote();
    $uma = Paciente::factory()->create();
    $outra = Paciente::factory()->create();
    $certo = [pagamentoDoLote($uma), pacoteDoLote($uma, $cena['particular'], $cena['ana'])];
    $errado = [pagamentoDoLote($outra), pacoteDoLote($uma, $cena['particular'], $cena['bia'])];

    // ACT
    $resposta = $this->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [
        ['lancamento_id' => $certo[0]->id, 'tratamento_id' => $certo[1]->id],
        ['lancamento_id' => $errado[0]->id, 'tratamento_id' => $errado[1]->id],
    ]]);

    // ASSERT — o erro aponta a linha 1; a linha 0 (válida) não foi gravada, nem a auditoria dela
    $resposta->assertUnprocessable()->assertJsonValidationErrors('vinculos.1.tratamento_id');
    expect($certo[0]->fresh()->tratamento_id)->toBeNull()
        ->and($errado[0]->fresh()->tratamento_id)->toBeNull()
        ->and(Auditoria::where('entidade', 'lancamentos_caixa')->where('acao', 'atualizou')->count())->toBe(0);
});

it('deve recusar o item que alguém vinculou depois de a lista ser carregada', function () {
    // ARRANGE
    $this->actingAs(admin());
    $cena = cenaDoLote();
    $crianca = Paciente::factory()->create();
    $pagamento = pagamentoDoLote($crianca);
    $pacoteDaAna = pacoteDoLote($crianca, $cena['particular'], $cena['ana']);
    $pacoteDaBia = pacoteDoLote($crianca, $cena['particular'], $cena['bia']);
    $pagamento->forceFill(['tratamento_id' => $pacoteDaBia->id])->saveQuietly(); // a outra pessoa escolheu a Bia

    // ACT
    $resposta = $this->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [
        ['lancamento_id' => $pagamento->id, 'tratamento_id' => $pacoteDaAna->id],
    ]]);

    // ASSERT — a escolha dela fica, e a tela diz o PORQUÊ (não um "alterado por outra pessoa" genérico)
    $resposta->assertUnprocessable()->assertJsonValidationErrors('vinculos.0.lancamento_id');
    expect($resposta->json('errors')['vinculos.0.lancamento_id'][0])->toContain('já foi vinculado')
        ->and($pagamento->fresh()->tratamento_id)->toBe($pacoteDaBia->id);
});

it('deve recusar vincular a tratamento cujo período está fechado, apontando a linha', function () {
    // ARRANGE — a trava de ciclo do vínculo um a um vale no lote
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $pagamento = pagamentoDoLote(Paciente::find($cena['tratamento']->paciente_id));
    $pagamento->forceFill(['competencia' => '2026-07-01'])->saveQuietly();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [
        ['lancamento_id' => $pagamento->id, 'tratamento_id' => $cena['tratamento']->id],
    ]]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('vinculos.0.ciclo_fechado');
    expect($pagamento->fresh()->tratamento_id)->toBeNull();
});

it('deve impedir o escopado de vincular ao pacote de um colega pelo lote', function () {
    // ARRANGE — a posse do vínculo um a um vale no lote
    admin();
    $cena = cenaDoLote();
    $crianca = Paciente::factory()->create();
    $pagamento = pagamentoDoLote($crianca);
    $doColega = pacoteDoLote($crianca, $cena['particular'], $cena['bia']);
    $ana = usuarioEscopadoEm($cena['ana'], ['lancamentos.ver', 'lancamentos.editar', 'lancamentos.pagar']);

    // ACT
    $resposta = $this->actingAs($ana)->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [
        ['lancamento_id' => $pagamento->id, 'tratamento_id' => $doColega->id],
    ]]);

    // ASSERT
    $resposta->assertForbidden();
    expect($pagamento->fresh()->tratamento_id)->toBeNull();
});

it('deve recusar lote vazio, acima de 200 ou com o mesmo lançamento duas vezes', function (array $vinculos, string $erro) {
    // ARRANGE
    $this->actingAs(admin());

    // ACT + ASSERT
    $this->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => $vinculos])
        ->assertUnprocessable()->assertJsonValidationErrors($erro);
})->with([
    'vazio' => [[], 'vinculos'],
    'acima de 200' => [array_fill(0, 201, ['lancamento_id' => 1, 'tratamento_id' => 1]), 'vinculos'],
    'repetido' => [[['lancamento_id' => 7, 'tratamento_id' => 1], ['lancamento_id' => 7, 'tratamento_id' => 1]], 'vinculos.0.lancamento_id'],
]);

// ==================== o que o gate da change pediu (CR-VPT · SEC-VPT) ====================

it('deve dar ao escopado o mesmo 403 para tratamento inexistente e para o do colega no lote', function () {
    // ARRANGE — CR-VPT-02: com `exists` antes da posse, 422 (não existe) × 403 (é do colega)
    // enumerava os tratamentos da clínica
    admin();
    $cena = cenaDoLote();
    $crianca = Paciente::factory()->create();
    $pagamento = pagamentoDoLote($crianca);
    $doColega = pacoteDoLote($crianca, $cena['particular'], $cena['bia']);
    $ana = usuarioEscopadoEm($cena['ana'], ['lancamentos.ver', 'lancamentos.editar', 'lancamentos.pagar']);

    // ACT
    $inexistente = $this->actingAs($ana)->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [
        ['lancamento_id' => $pagamento->id, 'tratamento_id' => 99999999],
    ]]);
    $alheio = $this->actingAs($ana)->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [
        ['lancamento_id' => $pagamento->id, 'tratamento_id' => $doColega->id],
    ]]);

    // ASSERT
    $inexistente->assertForbidden();
    $alheio->assertForbidden();
});

it('deve responder a sugestão igual para criança inexistente e alheia', function () {
    // ARRANGE — SEC-VPT-01: 422 × 200 enumerava as crianças por id
    admin();
    $cena = cenaDoLote();
    $alheia = Paciente::factory()->create();
    pacoteDoLote($alheia, $cena['particular'], $cena['bia']);
    $ana = usuarioEscopadoEm($cena['ana'], ['tratamentos.ver']);

    // ACT
    $inexistente = $this->actingAs($ana)->getJson('/api/lancamentos/sugestao-de-tratamento?paciente_id=99999999');
    $deOutra = $this->actingAs($ana)->getJson("/api/lancamentos/sugestao-de-tratamento?paciente_id={$alheia->id}");

    // ASSERT
    $inexistente->assertOk()->assertJsonPath('tratamento_id', null);
    $deOutra->assertOk()->assertJsonPath('tratamento_id', null);
});

it('deve exigir lancamentos.ver na lista e no lote', function () {
    // ARRANGE — SEC-VPT-02: a lista mostra criança e valor, o que a lista de lançamentos mostra
    admin();
    $semVer = usuarioCom(['lancamentos.editar', 'lancamentos.pagar', 'tratamentos.ver', 'agenda.ver_todos'], 'Edita sem ver');

    // ACT + ASSERT
    $this->actingAs($semVer)->getJson('/api/lancamentos/sem-tratamento?de=2026-09-01&ate=2026-09-30')->assertForbidden();
    $this->actingAs($semVer)->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [['lancamento_id' => 1, 'tratamento_id' => 1]]])->assertForbidden();
});

it('deve deixar a devolução fora da lista', function () {
    // ARRANGE — CR-VPT-04 (V3): só receita; a devolução (despesa) entraria com o líquido positivo
    $this->actingAs(admin());
    $crianca = Paciente::factory()->create();
    $devolucao = pagamentoDoLote($crianca);
    $devolucao->forceFill([
        'tipo' => 'despesa',
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Despesa Fictícia', 'tipo' => 'despesa'])->id,
    ])->saveQuietly();

    // ACT + ASSERT
    expect($this->getJson('/api/lancamentos/sem-tratamento?de=2026-09-01&ate=2026-09-30')->json('data'))->toBe([]);
});

it('deve mostrar ao escopado só a sugestão e os pacotes dele na lista', function () {
    // ARRANGE — CR-VPT-04 (V5/V14): a linha não pode trazer o pacote do colega
    admin();
    $cena = cenaDoLote();
    $crianca = Paciente::factory()->create();
    pacoteDoLote($crianca, $cena['particular'], $cena['bia']);
    pagamentoDoLote($crianca);
    $ana = usuarioEscopadoEm($cena['ana'], ['lancamentos.ver', 'lancamentos.editar', 'lancamentos.pagar', 'tratamentos.ver']);

    // ACT
    $linha = $this->actingAs($ana)->getJson('/api/lancamentos/sem-tratamento?de=2026-09-01&ate=2026-09-30')->json('data.0');

    // ASSERT
    expect($linha['sugestao'])->toBeNull()
        ->and($linha['tratamentos_da_crianca'])->toBe([]);
});

it('deve recusar no lote o faturado e o que não é pagamento de criança', function (Closure $forma) {
    // ARRANGE — o lote é o da LISTA (nit da segurança; a task 1.4 prometia o faturado)
    $this->actingAs(admin());
    $cena = cenaDoLote();
    $crianca = Paciente::factory()->create();
    $pacote = pacoteDoLote($crianca, $cena['particular'], $cena['ana']);
    $lancamento = pagamentoDoLote($crianca);
    $forma($lancamento, $crianca);

    // ACT
    $resposta = $this->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [
        ['lancamento_id' => $lancamento->id, 'tratamento_id' => $pacote->id],
    ]]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('vinculos.0.lancamento_id');
    expect($lancamento->fresh()->tratamento_id)->toBeNull();
})->with([
    'faturado pela agenda' => function (LancamentoCaixa $l, Paciente $c): void {
        $sessao = Agendamento::factory()->create(['paciente_id' => $c->id]);
        $l->forceFill(['agendamento_id' => $sessao->id])->saveQuietly();
    },
    'em aberto' => function (LancamentoCaixa $l): void {
        $l->forceFill(['pago_em' => null])->saveQuietly();
    },
    // CR-VPT-08 (G1a/G1b): mandados DIRETO ao lote, fora da lista
    'despesa da criança' => function (LancamentoCaixa $l): void {
        $l->forceFill([
            'tipo' => 'despesa',
            'categoria_id' => Categoria::firstOrCreate(['nome' => 'Despesa Fictícia', 'tipo' => 'despesa'])->id,
        ])->saveQuietly();
    },
    'interessado que não é criança' => function (LancamentoCaixa $l): void {
        $l->forceFill(['interessado_tipo' => 'fornecedor'])->saveQuietly();
    },
]);

it('deve recusar período acima de um ano na lista', function () {
    // ARRANGE — CR-VPT-05 (V6)
    $this->actingAs(admin());

    // ACT + ASSERT
    $this->getJson('/api/lancamentos/sem-tratamento?de=2025-09-01&ate=2026-09-02')
        ->assertUnprocessable()->assertJsonValidationErrors('ate');
});

it('deve cortar a lista no teto, avisando que há mais', function () {
    // ARRANGE — CR-VPT-05 (V11): teto injetado de 2; três pagamentos
    $this->actingAs(admin());
    $crianca = Paciente::factory()->create();
    foreach ([1, 2, 3] as $_) {
        pagamentoDoLote($crianca);
    }
    app()->bind(LancamentoVinculoController::class, fn () => new LancamentoVinculoController(
        app(SugestaoDeTratamento::class), app(EscopoDoProfissional::class), 2,
    ));

    $consultas = [];
    DB::listen(function ($consulta) use (&$consultas): void {
        $consultas[] = $consulta->sql;
    });

    // ACT
    $resposta = $this->getJson('/api/lancamentos/sem-tratamento?de=2026-09-01&ate=2026-09-30');

    // ASSERT — o corte é no BANCO (CR-VPT-08, V11): sem o `limit`, um ano inteiro ia para a memória
    expect($resposta->json('data'))->toHaveCount(2)
        ->and($resposta->json('truncado'))->toBeTrue()
        ->and(collect($consultas)->contains(
            fn (string $sql): bool => str_contains($sql, 'from `lancamentos_caixa`') && str_contains($sql, 'limit 3'),
        ))->toBeTrue();
});

it('deve devolver 409 "tente de novo" do lote inteiro quando o ciclo está em alteração', function () {
    // ARRANGE — CR-VPT-03: a corrida da guarda de ciclo é HttpException; o `catch` do item a
    // transformava em 422 na linha, como se o dado estivesse errado. A corrida é encenada no
    // serviço (a real exige duas transações avançando juntas — ver a pasta Concorrencia)
    $this->actingAs(admin());
    $cena = cenaDoLote();
    $crianca = Paciente::factory()->create();
    $pagamento = pagamentoDoLote($crianca);
    $pacote = pacoteDoLote($crianca, $cena['particular'], $cena['ana']);
    $this->mock(LancamentoCaixaService::class, fn ($servico) => $servico
        ->shouldReceive('atualizar')->andThrow(new CorridaDoCicloException));

    // ACT
    $resposta = $this->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => [
        ['lancamento_id' => $pagamento->id, 'tratamento_id' => $pacote->id],
    ]]);

    // ASSERT
    $resposta->assertStatus(409)->assertJsonMissingValidationErrors('vinculos.0.lancamento_id');
    expect($pagamento->fresh()->tratamento_id)->toBeNull();
});
