<?php

use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\TipoPagamento;
use App\Models\Transferencia;

/**
 * Change `saldo-das-contas`: o saldo de cada conta numa data, a abertura e o extrato com saldo.
 * Dinheiro e nomes 100% fictícios.
 */

/** Uma conta fictícia, com abertura opcional. */
function contaDoSaldo(string $abertura = '0.00', ?string $em = null, bool $ativo = true): Conta
{
    $conta = Conta::create(['nome' => 'Conta Fictícia '.fake()->unique()->numberBetween(1, 99999), 'ativo' => $ativo]);
    $conta->forceFill(['saldo_inicial' => $abertura, 'saldo_inicial_em' => $em])->save();

    return $conta->refresh();
}

/** Um lançamento na conta, pago em `$pagoEm` (ou em aberto, com `null`). */
function movimentoDoSaldo(Conta $conta, string $tipo, string $valor, ?string $pagoEm, array $extra = []): LancamentoCaixa
{
    $lancamento = new LancamentoCaixa([
        'tipo' => $tipo,
        'competencia' => '2026-09-01',
        'vencimento' => '2026-09-01',
        'valor' => $valor,
        'contabil' => true,
        'categoria_id' => Categoria::firstOrCreate(['nome' => "Categoria Fictícia {$tipo}", 'tipo' => $tipo])->id,
        'tipo_pagamento_id' => TipoPagamento::firstOrCreate(['nome' => 'Forma Fictícia'])->id,
        'conta_id' => $conta->id,
        ...$extra,
    ]);
    $lancamento->pago_em = $pagoEm;
    $lancamento->save();

    return $lancamento;
}

function transferenciaDoSaldo(Conta $de, Conta $para, string $valor, string $data): Transferencia
{
    return Transferencia::create(['conta_origem_id' => $de->id, 'conta_destino_id' => $para->id, 'valor' => $valor, 'data' => $data]);
}

/** O saldo de uma conta na resposta de `/contas/saldos`. */
function saldoNaResposta($resposta, Conta $conta): ?string
{
    return collect($resposta->json('contas'))->firstWhere('id', $conta->id)['saldo'] ?? null;
}

// ==================== o saldo numa data ====================

it('deve somar a abertura e o líquido dos pagos, com juros, multa e desconto', function () {
    // ARRANGE — 100 + (200 + 10 juros) − (50 − 5 desconto) = 265
    $this->actingAs(admin());
    $conta = contaDoSaldo('100.00');
    movimentoDoSaldo($conta, 'receita', '200.00', '2026-09-10 10:00', ['juros' => '10.00']);
    movimentoDoSaldo($conta, 'despesa', '50.00', '2026-09-11 10:00', ['desconto' => '5.00']);
    movimentoDoSaldo($conta, 'receita', '999.00', null); // em aberto não conta

    // ACT
    $resposta = $this->getJson('/api/contas/saldos?em=2026-09-30');

    // ASSERT
    $resposta->assertOk();
    expect(saldoNaResposta($resposta, $conta))->toBe('265.00')
        ->and($resposta->json('total'))->toBe('265.00');
});

it('deve contar a multa do lançamento pago', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaDoSaldo();
    movimentoDoSaldo($conta, 'receita', '100.00', '2026-09-10 10:00', ['multa' => '2.50']);

    // ACT + ASSERT
    expect(saldoNaResposta($this->getJson('/api/contas/saldos?em=2026-09-30'), $conta))->toBe('102.50');
});

it('deve mover a transferência entre as contas sem mudar o total', function () {
    // ARRANGE
    $this->actingAs(admin());
    $gaveta = contaDoSaldo('500.00');
    $banco = contaDoSaldo('1000.00');
    transferenciaDoSaldo($gaveta, $banco, '300.00', '2026-09-12');

    // ACT
    $resposta = $this->getJson('/api/contas/saldos?em=2026-09-30');

    // ASSERT
    expect(saldoNaResposta($resposta, $gaveta))->toBe('200.00')
        ->and(saldoNaResposta($resposta, $banco))->toBe('1300.00')
        ->and($resposta->json('total'))->toBe('1500.00');
});

it('deve deixar fora o que foi pago ou transferido antes da abertura', function () {
    // ARRANGE — a abertura de 01/10 já contém setembro
    $this->actingAs(admin());
    $conta = contaDoSaldo('1000.00', '2026-10-01');
    $outra = contaDoSaldo();
    movimentoDoSaldo($conta, 'receita', '400.00', '2026-09-30 18:00');
    transferenciaDoSaldo($outra, $conta, '50.00', '2026-09-30');
    movimentoDoSaldo($conta, 'receita', '70.00', '2026-10-01 08:00');

    // ACT + ASSERT
    expect(saldoNaResposta($this->getJson('/api/contas/saldos?em=2026-10-31'), $conta))->toBe('1070.00');
});

it('deve mostrar a abertura quando a data pedida é anterior a ela', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaDoSaldo('1000.00', '2026-10-01');
    movimentoDoSaldo($conta, 'receita', '70.00', '2026-10-02 08:00');

    // ACT + ASSERT
    expect(saldoNaResposta($this->getJson('/api/contas/saldos?em=2026-09-15'), $conta))->toBe('1000.00');
});

it('deve parar no fim do dia pedido', function () {
    // ARRANGE — o pagamento das 23:59 conta; o do dia seguinte, não
    $this->actingAs(admin());
    $conta = contaDoSaldo();
    movimentoDoSaldo($conta, 'receita', '10.00', '2026-09-10 23:59');
    movimentoDoSaldo($conta, 'receita', '20.00', '2026-09-11 00:00');

    // ACT + ASSERT
    expect(saldoNaResposta($this->getJson('/api/contas/saldos?em=2026-09-10'), $conta))->toBe('10.00');
});

it('deve aceitar abertura negativa', function () {
    // ARRANGE — conta no cheque especial
    $this->actingAs(admin());
    $conta = contaDoSaldo('-350.00');

    // ACT + ASSERT
    expect(saldoNaResposta($this->getJson('/api/contas/saldos?em=2026-09-30'), $conta))->toBe('-350.00');
});

it('deve mostrar a conta inativa só quando ela ainda tem dinheiro', function () {
    // ARRANGE
    $this->actingAs(admin());
    $comDinheiro = contaDoSaldo('80.00', ativo: false);
    $zerada = contaDoSaldo('0.00', ativo: false);

    // ACT
    $resposta = $this->getJson('/api/contas/saldos?em=2026-09-30');

    // ASSERT
    $ids = collect($resposta->json('contas'))->pluck('id');
    expect($ids)->toContain($comDinheiro->id)->not->toContain($zerada->id)
        ->and($resposta->json('total'))->toBe('80.00');
});

it('deve usar hoje no fuso da clínica quando a data não vem', function () {
    // ARRANGE
    $this->actingAs(admin());
    contaDoSaldo();

    // ACT + ASSERT
    expect($this->getJson('/api/contas/saldos')->json('em'))->toBe(agoraNaClinica()->toDateString());
});

it('deve negar o saldo a quem não vê o caixa da clínica', function () {
    // ARRANGE — decisão de 2026-07-19: recepção e faturista não veem o total
    admin();
    $recepcao = usuarioCom(['lancamentos.ver', 'contas.ver'], 'Recepção fictícia');

    // ACT + ASSERT
    $this->actingAs($recepcao)->getJson('/api/contas/saldos')->assertForbidden();
});

// ==================== a abertura ====================

it('deve definir a abertura, auditar e responder o valor gravado', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaDoSaldo();

    // ACT
    $resposta = $this->putJsonComVersao("/api/contas/{$conta->id}/saldo-de-abertura", [
        'saldo_inicial' => '1500.00', 'saldo_inicial_em' => '2026-10-01',
    ]);

    // ASSERT
    $resposta->assertOk()->assertJson(['saldo_inicial' => '1500.00', 'saldo_inicial_em' => '2026-10-01']);
    $registro = Auditoria::where('entidade', 'contas')->where('acao', 'atualizou')->latest('id')->firstOrFail();
    expect(json_encode($registro->diff_json))->toContain('1500');
});

it('deve exigir contas.editar e fluxo_caixa.ver para mudar a abertura', function (array $permissoes) {
    // ARRANGE
    admin();
    $conta = contaDoSaldo();
    $usuario = usuarioCom($permissoes, 'Meio acesso '.implode('-', $permissoes));

    // ACT
    $resposta = $this->actingAs($usuario)->putJsonComVersao("/api/contas/{$conta->id}/saldo-de-abertura", [
        'saldo_inicial' => '1.00', 'saldo_inicial_em' => null,
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect((string) $conta->fresh()->saldo_inicial)->toBe('0.00');
})->with([
    'só edita contas' => [['contas.ver', 'contas.editar']],
    'só vê o caixa' => [['contas.ver', 'fluxo_caixa.ver']],
]);

it('não deve expor a abertura no CRUD comum de contas', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaDoSaldo('1234.56', '2026-10-01');

    // ACT
    $lista = $this->getJson('/api/contas')->json();
    $uma = $this->getJson("/api/contas/{$conta->id}")->json();

    // ASSERT
    expect($lista[0])->not->toHaveKey('saldo_inicial')->not->toHaveKey('saldo_inicial_em')
        ->and($uma)->not->toHaveKey('saldo_inicial')->not->toHaveKey('saldo_inicial_em');
});

it('não deve mudar a abertura pelo PUT comum da conta', function () {
    // ARRANGE
    $this->actingAs(admin());
    $conta = contaDoSaldo('10.00');

    // ACT
    $this->putJsonComVersao("/api/contas/{$conta->id}", ['nome' => 'Conta Renomeada Fictícia', 'saldo_inicial' => '999.00'])
        ->assertOk();

    // ASSERT
    expect((string) $conta->fresh()->saldo_inicial)->toBe('10.00');
});

// ==================== o extrato com saldo ====================

it('deve dar ao extrato da conta o saldo anterior e o saldo de cada linha, em ordem', function () {
    // ARRANGE — abertura 100; antes do período entra 50; no período: transferência que sai (dia 10,
    // 00:00), receita das 09:00 do dia 10, despesa do dia 11
    $this->actingAs(admin());
    $conta = contaDoSaldo('100.00');
    $banco = contaDoSaldo();
    movimentoDoSaldo($conta, 'receita', '50.00', '2026-08-31 10:00');
    $receita = movimentoDoSaldo($conta, 'receita', '200.00', '2026-09-10 09:00');
    transferenciaDoSaldo($conta, $banco, '30.00', '2026-09-10');
    movimentoDoSaldo($conta, 'despesa', '20.00', '2026-09-11 15:00');

    // ACT
    $resposta = $this->getJson("/api/fluxo-caixa?de=2026-09-01&ate=2026-09-30&conta_id={$conta->id}");

    // ASSERT — 150 → −30 (transferência 00:00) → +200 → −20
    $resposta->assertOk();
    expect($resposta->json('saldo_anterior'))->toBe('150.00')
        ->and(collect($resposta->json('movimentos'))->pluck('saldo')->all())->toBe(['120.00', '320.00', '300.00'])
        ->and($resposta->json('movimentos.1.lancamento_id'))->toBe($receita->id);
});

it('deve fechar o extrato da clínica no mesmo número dos cartões', function () {
    // ARRANGE — sem conta: a transferência entre duas contas não mexe no saldo da clínica
    $this->actingAs(admin());
    $gaveta = contaDoSaldo('500.00');
    $banco = contaDoSaldo('1000.00', '2026-09-05');
    movimentoDoSaldo($banco, 'receita', '999.00', '2026-09-04 10:00'); // antes da abertura do banco
    movimentoDoSaldo($gaveta, 'receita', '80.00', '2026-09-06 10:00');
    transferenciaDoSaldo($gaveta, $banco, '300.00', '2026-09-07');

    // ACT
    $extrato = $this->getJson('/api/fluxo-caixa?de=2026-09-01&ate=2026-09-30');
    $cartoes = $this->getJson('/api/contas/saldos?em=2026-09-30');

    // ASSERT
    $saldos = collect($extrato->json('movimentos'))->pluck('saldo')->all();
    expect(end($saldos))->toBe($cartoes->json('total'))
        ->and($cartoes->json('total'))->toBe('1580.00');
});

it('deve mascarar o saldo de abertura na auditoria para quem não vê o caixa', function () {
    // ARRANGE — SEC-FIN-02: quem só audita lia o valor da abertura na trilha
    $admin = admin();
    $auditora = usuarioCom(['auditoria.ver'], 'Auditora fictícia');
    $this->actingAs($admin);
    $conta = contaDoSaldo();
    // a data mascarada é PASSADA de propósito: no dia em que ela fosse "hoje", o `created_at` da
    // própria trilha a conteria e a guarda reprovaria sem vazamento nenhum (caiu em 2026-10-01)
    $this->putJsonComVersao("/api/contas/{$conta->id}/saldo-de-abertura", ['saldo_inicial' => '98765.43', 'saldo_inicial_em' => '2026-07-14'])->assertOk();
    trocarDeUsuario();

    // ACT
    $daAuditora = json_encode($this->actingAs($auditora)->getJson('/api/auditoria?entidade=contas')->json());
    trocarDeUsuario();
    $daGestora = json_encode($this->actingAs($admin)->getJson('/api/auditoria?entidade=contas')->json());

    // ASSERT — a auditora vê QUE mudou; a gestora vê o valor
    expect($daAuditora)->not->toContain('98765.43')->not->toContain('2026-07-14')
        ->and($daGestora)->toContain('98765.43');
});

it('deve mascarar a abertura dos DOIS lados da trilha, também na exclusão da conta', function () {
    // ARRANGE — a 2ª troca carrega a 1ª no `antes`, e a exclusão carrega a última no `antes`
    // (CR-R2, mutações F2c e F2d)
    $admin = admin();
    $auditora = usuarioCom(['auditoria.ver'], 'Auditora fictícia dos dois lados');
    $this->actingAs($admin);
    $conta = contaDoSaldo();
    $this->putJsonComVersao("/api/contas/{$conta->id}/saldo-de-abertura", ['saldo_inicial' => '11111.11', 'saldo_inicial_em' => '2026-08-01'])->assertOk();
    $this->putJsonComVersao("/api/contas/{$conta->id}/saldo-de-abertura", ['saldo_inicial' => '22222.22', 'saldo_inicial_em' => '2026-08-02'])->assertOk();
    $this->deleteJson("/api/contas/{$conta->id}")->assertNoContent();
    trocarDeUsuario();

    // ACT
    $trilha = $this->actingAs($auditora)->getJson('/api/auditoria?entidade=contas')->json();

    // ASSERT — a trilha tem a exclusão, e nenhum dos valores aparece em lado nenhum
    expect(collect($trilha['data'])->pluck('acao'))->toContain('excluiu');
    foreach (['11111.11', '22222.22', '2026-08-01', '2026-08-02'] as $valor) {
        semVazamento($trilha, $valor);
    }
});

// ==================== os limites do corte (CR-API1-02) ====================

it('deve contar o pagamento e a transferência do próprio dia da abertura, e o extrato fechar no cartão', function () {
    // ARRANGE — abertura 100 em 01/10; no mesmo dia, +50 pago e +30 transferido para a conta
    $this->actingAs(admin());
    $conta = contaDoSaldo('100.00', '2026-10-01');
    $outra = contaDoSaldo();
    movimentoDoSaldo($conta, 'receita', '50.00', '2026-10-01 08:00');
    transferenciaDoSaldo($outra, $conta, '30.00', '2026-10-01');

    // ACT
    $cartao = saldoNaResposta($this->getJson('/api/contas/saldos?em=2026-10-31'), $conta);
    $extrato = $this->getJson("/api/fluxo-caixa?de=2026-10-01&ate=2026-10-31&conta_id={$conta->id}");

    // ASSERT
    $saldos = collect($extrato->json('movimentos'))->pluck('saldo')->all();
    expect($cartao)->toBe('180.00')
        ->and($extrato->json('saldo_anterior'))->toBe('100.00')
        ->and(end($saldos))->toBe($cartao);
});

it('não deve pôr no saldo anterior o que aconteceu no primeiro dia do período', function () {
    // ARRANGE — o saldo anterior é o do FIM do dia antes do período
    $this->actingAs(admin());
    $conta = contaDoSaldo('100.00');
    movimentoDoSaldo($conta, 'receita', '40.00', '2026-10-05 09:00');

    // ACT
    $extrato = $this->getJson("/api/fluxo-caixa?de=2026-10-05&ate=2026-10-31&conta_id={$conta->id}");

    // ASSERT
    expect($extrato->json('saldo_anterior'))->toBe('100.00')
        ->and($extrato->json('movimentos.0.saldo'))->toBe('140.00');
});
