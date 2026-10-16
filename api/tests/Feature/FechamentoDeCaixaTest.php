<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\TipoPagamento;
use App\Support\Financeiro\AutorDaBaixaPelaAuditoria;
use Illuminate\Support\Facades\DB;

/**
 * Change `fechamento-de-caixa`: quem deu a baixa fica gravado, e o fechamento mostra as baixas a
 * quem vê o caixa da clínica (desde `financeiro-sem-faturamento-total`, só a ela). Dados 100%
 * fictícios.
 */

/** Uma receita da criança fictícia, em aberto, na clínica. */
function receitaDoFechamento(string $valor = '100.00', ?TipoPagamento $forma = null): LancamentoCaixa
{
    $lancamento = new LancamentoCaixa([
        'tipo' => 'receita', 'competencia' => agoraNaClinica()->toDateString(), 'vencimento' => agoraNaClinica()->toDateString(),
        'valor' => $valor, 'contabil' => true,
        'interessado_tipo' => 'paciente', 'interessado_id' => Paciente::factory()->create()->id,
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Receita do Fechamento', 'tipo' => 'receita'])->id,
        'tipo_pagamento_id' => ($forma ?? TipoPagamento::firstOrCreate(['nome' => 'Dinheiro Fictício']))->id,
        'conta_id' => Conta::firstOrCreate(['nome' => 'Gaveta Fictícia'])->id,
    ]);
    $lancamento->save();

    return $lancamento;
}

/** O fechamento de hoje, com parâmetros extras. */
function fechamentoDeHoje(array $extra = []): string
{
    $hoje = agoraNaClinica()->toDateString();

    return '/api/relatorios/fechamento-de-caixa?'.http_build_query(['de' => $hoje, 'ate' => $hoje, ...$extra]);
}

// ==================== quem deu a baixa ====================

it('deve gravar quem deu a baixa, e o estorno limpa', function () {
    // ARRANGE
    $admin = admin();
    $this->actingAs($admin);
    $receita = receitaDoFechamento();

    // ACT + ASSERT
    $this->postJson("/api/lancamentos/{$receita->id}/pagamento")->assertOk();
    expect($receita->fresh()->pago_por_id)->toBe($admin->id);
    $this->deleteJson("/api/lancamentos/{$receita->id}/pagamento")->assertOk();
    expect($receita->fresh()->pago_por_id)->toBeNull();
});

it('deve gravar quem registrou já pago, e ignorar o autor vindo do payload', function () {
    // ARRANGE
    $admin = admin();
    $outro = usuarioCom(['lancamentos.ver'], 'Outro fictício');
    $this->actingAs($admin);
    $modelo = receitaDoFechamento();

    // ACT
    $id = $this->postJson('/api/lancamentos', [
        'tipo' => 'receita', 'competencia' => agoraNaClinica()->toDateString(), 'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $modelo->categoria_id, 'valor' => '80.00', 'tipo_pagamento_id' => $modelo->tipo_pagamento_id,
        'conta_id' => $modelo->conta_id, 'pagar_agora' => true, 'pago_por_id' => $outro->id,
    ])->assertCreated()->json('id');

    // ASSERT
    expect(LancamentoCaixa::find($id)->pago_por_id)->toBe($admin->id);
});

it('deve preencher os pagamentos antigos pela auditoria, sem inventar autor', function () {
    // ARRANGE — dois pagamentos com a coluna vazia: um com autor na trilha, um sem (console)
    $admin = admin();
    $this->actingAs($admin);
    $comTrilha = receitaDoFechamento();
    $this->postJson("/api/lancamentos/{$comTrilha->id}/pagamento")->assertOk();
    $semTrilha = receitaDoFechamento();
    $semTrilha->forceFill(['pago_em' => agoraNaClinica()->format('Y-m-d H:i')])->saveQuietly();
    LancamentoCaixa::whereKey([$comTrilha->id, $semTrilha->id])->update(['pago_por_id' => null]);

    // ACT — a MESMA consulta que a migration roda
    $preenchidos = AutorDaBaixaPelaAuditoria::preencher();

    // ASSERT
    expect($preenchidos)->toBe(1)
        ->and($comTrilha->fresh()->pago_por_id)->toBe($admin->id)
        ->and($semTrilha->fresh()->pago_por_id)->toBeNull();
});

// ==================== o relatório ====================

it('deve recusar o fechamento a quem dá baixa mas não vê o caixa da clínica', function () {
    // ARRANGE — a recepção recebeu hoje; as baixas dela num período longo eram quase o faturamento
    // de particulares (change `financeiro-sem-faturamento-total`, D5)
    admin();
    $recepcao = usuarioCom(['lancamentos.ver', 'lancamentos.pagar', 'pacientes.ver'], 'Recepção fictícia');
    $this->actingAs($recepcao);
    $daRecepcao = receitaDoFechamento('120.00');
    $this->postJson("/api/lancamentos/{$daRecepcao->id}/pagamento")->assertOk();

    // ACT
    $analitico = $this->getJson(fechamentoDeHoje());
    $porQuemDeuBaixa = $this->getJson(fechamentoDeHoje(['resultado' => 'sintetico', 'dividir_por' => 'quem_deu_baixa']));

    // ASSERT
    $analitico->assertForbidden();
    $porQuemDeuBaixa->assertForbidden();
});

it('deve mostrar à gestora todas as baixas, divididas por quem deu', function () {
    // ARRANGE
    $gestora = admin();
    $recepcao = usuarioCom(['lancamentos.ver', 'lancamentos.pagar'], 'Recepção fictícia');
    $this->actingAs($gestora);
    $daGestora = receitaDoFechamento('300.00');
    $this->postJson("/api/lancamentos/{$daGestora->id}/pagamento")->assertOk();
    $daRecepcao = receitaDoFechamento('120.00');
    trocarDeUsuario();
    $this->actingAs($recepcao)->postJson("/api/lancamentos/{$daRecepcao->id}/pagamento")->assertOk();
    trocarDeUsuario();

    // ACT
    $resposta = $this->actingAs($gestora)->getJson(fechamentoDeHoje(['resultado' => 'sintetico', 'dividir_por' => 'quem_deu_baixa']));

    // ASSERT
    $resposta->assertOk();
    $porPessoa = collect($resposta->json('grupos'))->mapWithKeys(fn (array $g): array => [$g['titulo'] => $g['totais']['entradas']]);
    expect($porPessoa[$gestora->nome])->toBe('300.00')
        ->and($porPessoa[$recepcao->nome])->toBe('120.00')
        ->and($porPessoa)->toHaveCount(2)
        ->and($resposta->json('totais.entradas'))->toBe('420.00');
});

it('deve dividir por forma de pagamento com o líquido', function () {
    // ARRANGE — 100 + 10 de juros em dinheiro; 50 no PIX
    $this->actingAs(admin());
    $pix = TipoPagamento::firstOrCreate(['nome' => 'PIX Fictício']);
    $emDinheiro = receitaDoFechamento('100.00');
    $emDinheiro->forceFill(['juros' => '10.00'])->saveQuietly();
    $noPix = receitaDoFechamento('50.00', $pix);
    $this->postJson("/api/lancamentos/{$emDinheiro->id}/pagamento")->assertOk();
    $this->postJson("/api/lancamentos/{$noPix->id}/pagamento")->assertOk();

    // ACT
    $resposta = $this->getJson(fechamentoDeHoje(['resultado' => 'sintetico', 'dividir_por' => 'forma_de_pagamento']));

    // ASSERT
    $porForma = collect($resposta->json('grupos'))->mapWithKeys(fn (array $g): array => [$g['titulo'] => $g['totais']['entradas']]);
    expect($porForma['Dinheiro Fictício'])->toBe('110.00')
        ->and($porForma['PIX Fictício'])->toBe('50.00')
        ->and($resposta->json('totais.saldo'))->toBe('160.00');
});

it('deve dizer "não registrado" quando não se sabe quem deu a baixa', function () {
    // ARRANGE — pagamento sem autor (importação)
    $this->actingAs(admin());
    $importado = receitaDoFechamento();
    $importado->forceFill(['pago_em' => agoraNaClinica()->format('Y-m-d H:i')])->saveQuietly();

    // ACT
    $linha = $this->getJson(fechamentoDeHoje())->json('linhas.0');

    // ASSERT
    expect($linha['quem_deu_baixa'])->toBe('Não registrado');
});

it('deve abrir a quem vê o caixa da clínica, mesmo sem dar baixa', function () {
    // ARRANGE — o fechamento é a conferência do caixa, não de quem recebe
    admin();
    $gestor = usuarioCom(['lancamentos.ver', 'fluxo_caixa.ver'], 'Gestor fictício');

    // ACT + ASSERT
    $this->actingAs($gestor)->getJson(fechamentoDeHoje())->assertOk();
});

// ==================== rodada 1 do gate de código (CR-API1) ====================

it('deve preencher pelo registro da criação já paga', function () {
    // ARRANGE — CR-API1-03 (F2): o ramo `criou` da trilha
    $admin = admin();
    $this->actingAs($admin);
    $modelo = receitaDoFechamento();
    $id = $this->postJson('/api/lancamentos', [
        'tipo' => 'receita', 'competencia' => agoraNaClinica()->toDateString(), 'vencimento' => agoraNaClinica()->toDateString(),
        'categoria_id' => $modelo->categoria_id, 'valor' => '80.00', 'tipo_pagamento_id' => $modelo->tipo_pagamento_id,
        'conta_id' => $modelo->conta_id, 'pagar_agora' => true,
    ])->assertCreated()->json('id');
    LancamentoCaixa::whereKey($id)->update(['pago_por_id' => null]);

    // ACT
    AutorDaBaixaPelaAuditoria::preencher();

    // ASSERT
    expect(LancamentoCaixa::find($id)->pago_por_id)->toBe($admin->id);
});

it('deve preencher com quem pagou por último, e deixar nulo se o último foi o sistema', function () {
    // ARRANGE — CR-API1-03 (F3) e CR-API1-07: A paga, estorna, B paga; e outro que A paga,
    // estorna e o sistema paga
    $gestora = admin();
    $recepcao = usuarioCom(['lancamentos.ver', 'lancamentos.pagar'], 'Recepção fictícia');
    $this->actingAs($gestora);
    $porUltimoB = receitaDoFechamento();
    $porUltimoSistema = receitaDoFechamento();
    foreach ([$porUltimoB, $porUltimoSistema] as $l) {
        $this->postJson("/api/lancamentos/{$l->id}/pagamento")->assertOk();
        $this->deleteJson("/api/lancamentos/{$l->id}/pagamento")->assertOk();
    }
    trocarDeUsuario();
    $this->actingAs($recepcao)->postJson("/api/lancamentos/{$porUltimoB->id}/pagamento")->assertOk();
    trocarDeUsuario();
    // o sistema paga: a trilha grava sem autor (fora de request)
    app('auth')->forgetGuards();
    DB::table('auditoria')->insert([
        'usuario_id' => null, 'autor_tipo' => 'sistema', 'entidade' => 'lancamentos_caixa',
        'entidade_id' => $porUltimoSistema->id, 'acao' => 'atualizou',
        'diff_json' => json_encode(['antes' => ['pago_em' => null], 'depois' => ['pago_em' => agoraNaClinica()->format('Y-m-d H:i')]]),
        'criado_em' => now(),
    ]);
    LancamentoCaixa::whereKey($porUltimoSistema->id)->update(['pago_em' => agoraNaClinica()->format('Y-m-d H:i')]);
    LancamentoCaixa::whereKey([$porUltimoB->id, $porUltimoSistema->id])->update(['pago_por_id' => null]);

    // ACT
    AutorDaBaixaPelaAuditoria::preencher();

    // ASSERT
    expect(LancamentoCaixa::find($porUltimoB->id)->pago_por_id)->toBe($recepcao->id)
        ->and(LancamentoCaixa::find($porUltimoSistema->id)->pago_por_id)->toBeNull();
});

it('deve gravar quem faturou a sessão já paga', function () {
    // ARRANGE — CR-API1-03: a terceira porta do pagamento
    $admin = admin();
    $this->actingAs($admin);
    [$agendamento, $payload, $convenio] = cenarioDeFaturamento();
    $convenio->update(['particular' => true]);

    // ACT
    $id = $this->postJson("/api/agendamentos/{$agendamento}/faturamento", [...$payload, 'pagar_agora' => true])->assertCreated()->json('id');

    // ASSERT
    expect(LancamentoCaixa::find($id)->pago_por_id)->toBe($admin->id);
});

it('deve trazer só as saídas com Tipo "saidas"', function () {
    // ARRANGE — CR-API1-04 (F4)
    $this->actingAs(admin());
    $entrada = receitaDoFechamento('100.00');
    $saida = new LancamentoCaixa([
        'tipo' => 'despesa', 'competencia' => agoraNaClinica()->toDateString(), 'vencimento' => agoraNaClinica()->toDateString(),
        'valor' => '40.00', 'contabil' => true,
        'categoria_id' => Categoria::firstOrCreate(['nome' => 'Despesa do Fechamento', 'tipo' => 'despesa'])->id,
        'tipo_pagamento_id' => $entrada->tipo_pagamento_id, 'conta_id' => $entrada->conta_id,
    ]);
    $saida->save();
    $this->postJson("/api/lancamentos/{$entrada->id}/pagamento")->assertOk();
    $this->postJson("/api/lancamentos/{$saida->id}/pagamento")->assertOk();

    // ACT
    $resposta = $this->getJson(fechamentoDeHoje(['tipo' => 'saidas']));

    // ASSERT
    expect($resposta->json('linhas'))->toHaveCount(1)
        ->and($resposta->json('totais'))->toBe(['saidas' => '40.00']);
});

it('deve recusar categoria de outra natureza que o Tipo', function () {
    // ARRANGE — CR-API1-08: folha vazia calada vira 422, como nos outros relatórios do caixa
    $this->actingAs(admin());
    $despesa = Categoria::firstOrCreate(['nome' => 'Despesa do Fechamento', 'tipo' => 'despesa']);

    // ACT + ASSERT
    $this->getJson(fechamentoDeHoje(['tipo' => 'entradas', 'categoria_id' => $despesa->id]))
        ->assertUnprocessable()->assertJsonValidationErrors('categoria_id');
});

// ==================== rodada 2 do gate de código (CR-R2) ====================

it('deve deixar como está o autor que já foi gravado', function () {
    // ARRANGE — a migration pode rodar de novo (mutação D7d): quem já tem autor não é reescrito
    // pela trilha
    $admin = admin();
    $outra = usuarioCom(['lancamentos.pagar'], 'Outra recepcionista fictícia');
    $this->actingAs($admin);
    $pago = receitaDoFechamento();
    $this->postJson("/api/lancamentos/{$pago->id}/pagamento")->assertOk();
    LancamentoCaixa::whereKey($pago->id)->update(['pago_por_id' => $outra->id]);

    // ACT
    $preenchidos = AutorDaBaixaPelaAuditoria::preencher();

    // ASSERT
    expect($preenchidos)->toBe(0)
        ->and($pago->fresh()->pago_por_id)->toBe($outra->id);
});
