<?php

use App\Models\Agendamento;
use App\Models\Categoria;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\StatusAgendamento;
use App\Models\Subcategoria;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;

it('deve faturar atendimento consumido com preço do servidor e fronteira liberada por flag', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$agendamento, $payload, $convenio] = cenarioDeFaturamento();

    // fronteira §14 fail-closed: convênio comum + config default → 422
    $this->postJson("/api/agendamentos/{$agendamento}/faturamento", $payload)
        ->assertUnprocessable()->assertJsonValidationErrors('agendamento_id');

    // ACT — flag particular libera (regra é DADO, T-fin-17); flip auditado (Auditavel)
    $convenio->update(['particular' => true]);
    $faturado = $this->postJson("/api/agendamentos/{$agendamento}/faturamento", $payload);

    // ASSERT — receita com valor do SERVIÇO, interessado = paciente
    $faturado->assertCreated()
        ->assertJsonPath('tipo', 'receita')
        ->assertJsonPath('valor', '180.00')
        ->assertJsonPath('interessado_tipo', 'paciente')
        ->assertJsonPath('agendamento_id', $agendamento);
    expect($faturado->json('competencia'))->toBe(agoraNaClinica()->toDateString());

    // valor contrabandeado no payload → 422 (T-fin-15, prohibited)
    [$outro, $payloadOutro, $convenioOutro] = cenarioDeFaturamento('01:00');
    $convenioOutro->update(['particular' => true]);
    $this->postJson("/api/agendamentos/{$outro}/faturamento", [
        ...$payloadOutro, 'valor' => '1.00',
    ])->assertUnprocessable()->assertJsonValidationErrors('valor');

    // ...e a chave NULA é presença, não ausência (gatilho PROHIBITED-NULL): `prohibited`
    // (= "ausente OU vazio") a deixava passar. O preço é do SERVIDOR — a chave do payload
    // é recusada com QUALQUER valor, inclusive nenhum.
    $this->postJson("/api/agendamentos/{$outro}/faturamento", [
        ...$payloadOutro, 'valor' => null,
    ])->assertUnprocessable()->assertJsonValidationErrors('valor');

    // duplo faturamento → 422 e UM lançamento (unique no banco, T-fin-13)
    $this->postJson("/api/agendamentos/{$agendamento}/faturamento", $payload)
        ->assertUnprocessable()->assertJsonValidationErrors('agendamento_id');
    expect(LancamentoCaixa::where('agendamento_id', $agendamento)->count())->toBe(1);

    // refaturar após excluir o lançamento em aberto → 201 (unique libera)
    $this->deleteJson('/api/lancamentos/'.$faturado->json('id'))->assertNoContent();
    $this->postJson("/api/agendamentos/{$agendamento}/faturamento", $payload)->assertCreated();
});

it('deve rejeitar faturar sem consumo, sem serviço e liberar pela configuração global', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$agendamento, $payload, $convenio, $tratamento] = cenarioDeFaturamento();

    // sem sessão consumida → 422 (T-fin-14): estorna o consumo primeiro
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $agendamentoModel = Agendamento::find($agendamento);
    $this->putJsonComVersao("/api/agendamentos/{$agendamento}", [
        'paciente_id' => $agendamentoModel->paciente_id,
        'profissional_id' => $agendamentoModel->profissional_id,
        'especialidade_id' => $agendamentoModel->especialidade_id,
        'tratamento_id' => $agendamentoModel->tratamento_id,
        'inicio' => $agendamentoModel->inicio->format('Y-m-d H:i'),
        'status_id' => $emAberto->id,
    ])->assertOk();
    $convenio->update(['particular' => true]);
    $this->postJson("/api/agendamentos/{$agendamento}/faturamento", $payload)
        ->assertUnprocessable()->assertJsonValidationErrors('agendamento_id');

    // tratamento sem serviço → 422
    [$semServico, $payloadSemServico, $convenioSemServico, $tratamentoSemServico] = cenarioDeFaturamento('01:00');
    $convenioSemServico->update(['particular' => true]);
    $tratamentoSemServico->update(['servico_id' => null]);
    $this->postJson("/api/agendamentos/{$semServico}/faturamento", $payloadSemServico)
        ->assertUnprocessable()->assertJsonValidationErrors('agendamento_id');

    // config global libera convênio comum (T-fin-17)
    [$porConfig, $payloadPorConfig] = cenarioDeFaturamento('02:00');
    app(ConfiguracaoService::class)->set('financeiro.lancar_convenio_no_caixa', true);
    $this->postJson("/api/agendamentos/{$porConfig}/faturamento", $payloadPorConfig)->assertCreated();
});

it('deve reaplicar a coerência de subcategoria no faturamento', function () {
    // ARRANGE — subcategoria filha de categoria de DESPESA (gate r1, CR-01)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$agendamento, $payload, $convenio] = cenarioDeFaturamento();
    $convenio->update(['particular' => true]);
    $categoriaDespesa = Categoria::create(['nome' => 'Despesa Incoerente Fictícia', 'tipo' => 'despesa']);
    $subDaDespesa = Subcategoria::create([
        'categoria_id' => $categoriaDespesa->id, 'nome' => 'Sub Incoerente Fictícia',
    ]);

    // ACT + ASSERT — subcategoria de outra categoria → 422; da categoria certa → 201
    $this->postJson("/api/agendamentos/{$agendamento}/faturamento", [
        ...$payload, 'subcategoria_id' => $subDaDespesa->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('subcategoria_id');

    $subDaReceita = Subcategoria::create([
        'categoria_id' => $payload['categoria_id'], 'nome' => 'Sub Coerente Fictícia',
    ]);
    $this->postJson("/api/agendamentos/{$agendamento}/faturamento", [
        ...$payload, 'subcategoria_id' => $subDaReceita->id,
    ])->assertCreated();
});

it('deve aplicar o teto de desconto configurado no faturamento', function () {
    // ARRANGE — teto de 10% sobre 180.00 = 18.00 (T-fin-16; regra é DADO §13)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$agendamento, $payload, $convenio] = cenarioDeFaturamento();
    $convenio->update(['particular' => true]);
    app(ConfiguracaoService::class)->set('financeiro.desconto_maximo_pct', 10);

    // ACT + ASSERT — acima do teto → 422; no teto → 201 com líquido certo
    $this->postJson("/api/agendamentos/{$agendamento}/faturamento", [
        ...$payload, 'desconto' => '18.01',
    ])->assertUnprocessable()->assertJsonValidationErrors('desconto');
    $this->postJson("/api/agendamentos/{$agendamento}/faturamento", [
        ...$payload, 'desconto' => '18.00',
    ])->assertCreated()->assertJsonPath('liquido', '162.00');
});

it('deve proteger o consumo de agendamento faturado até o lançamento sair', function () {
    // ARRANGE — faturado (T-fin-18, decisão P5: fail-closed)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$agendamento, $payload, $convenio, $tratamento] = cenarioDeFaturamento();
    $convenio->update(['particular' => true]);
    $lancamento = $this->postJson("/api/agendamentos/{$agendamento}/faturamento", $payload)
        ->assertCreated()->json('id');

    // ACT + ASSERT — transição que estornaria o consumo → 422 com lançamento vivo
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $agendamentoModel = Agendamento::find($agendamento);
    $corpoDoPut = [
        'paciente_id' => $agendamentoModel->paciente_id,
        'profissional_id' => $agendamentoModel->profissional_id,
        'especialidade_id' => $agendamentoModel->especialidade_id,
        'tratamento_id' => $agendamentoModel->tratamento_id,
        'inicio' => $agendamentoModel->inicio->format('Y-m-d H:i'),
        'status_id' => $emAberto->id,
    ];
    $this->putJsonComVersao("/api/agendamentos/{$agendamento}", $corpoDoPut)
        ->assertUnprocessable()->assertJsonValidationErrors('status_id');
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);

    // excluído o lançamento (em aberto), o estorno volta a ser aceito
    $this->deleteJson("/api/lancamentos/{$lancamento}")->assertNoContent();
    $this->putJsonComVersao("/api/agendamentos/{$agendamento}", $corpoDoPut)->assertOk();
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(0);
});

it('deve responder 403 sem permissão de lançamentos', function () {
    // ARRANGE — a permissão do faturamento é do DINHEIRO (parecer §3)
    $this->actingAs(admin());
    [$agendamento, $payload] = cenarioDeFaturamento();
    $semPermissao = Usuario::factory()->create();
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    // ACT + ASSERT
    $this->actingAs($semPermissao)
        ->postJson("/api/agendamentos/{$agendamento}/faturamento", $payload)
        ->assertForbidden();
});
