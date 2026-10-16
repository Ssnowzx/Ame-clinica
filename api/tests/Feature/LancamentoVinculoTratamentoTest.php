<?php

use App\Models\Auditoria;
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
use Illuminate\Support\Facades\DB;

/**
 * O VÍNCULO do lançamento manual com um tratamento (change `recebido-por-profissional`, spec
 * `lancamentos-caixa`). É por ele que o pacote pago adiantado chega ao profissional no relatório
 * "Recebido por profissional". Antes desta change, o lançamento manual não tinha como informá-lo.
 *
 * O que estes testes carregam de peso:
 *
 * - **Mesma criança:** o vínculo só vale para o tratamento da criança INTERESSADA, inclusive na
 *   edição parcial que troca só a criança e deixa o vínculo na outra.
 * - **O pago aceita o vínculo:** acertá-lo por estorno e novo pagamento empurraria o `pago_em`
 *   para hoje e tiraria o dinheiro do mês em que a família pagou.
 * - **A âncora do ciclo agora muda:** trocar ou desfazer o vínculo é outro jeito de arrastar um
 *   lançamento para fora de um ciclo já enviado, e vincular é outro jeito de empurrá-lo para dentro.
 */

/** Receita de uma criança com um pacote. */
function cenaDeVinculo(): array
{
    $tratamento = Tratamento::factory()->create();

    $payload = [
        'tipo' => 'receita',
        'competencia' => agoraNaClinica()->toDateString(),
        'vencimento' => agoraNaClinica()->toDateString(),
        'interessado_tipo' => 'paciente',
        'interessado_id' => $tratamento->paciente_id,
        'categoria_id' => Categoria::create([
            'nome' => 'Receita Fictícia '.fake()->unique()->numberBetween(1, 99999), 'tipo' => 'receita',
        ])->id,
        'valor' => '1200.00',
        'tipo_pagamento_id' => TipoPagamento::create([
            'nome' => 'Pgto Fictício '.fake()->unique()->numberBetween(1, 99999),
        ])->id,
        'conta_id' => Conta::create(['nome' => 'Caixa Fictício '.fake()->unique()->numberBetween(1, 99999)])->id,
    ];

    return [$payload, $tratamento];
}

it('deve criar receita vinculada ao pacote da criança interessada', function () {
    // ARRANGE
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();

    // ACT
    $resposta = $this->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $tratamento->id]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('tratamento_id', $tratamento->id);
    expect(LancamentoCaixa::find($resposta->json('id'))->tratamento_id)->toBe($tratamento->id);
});

it('deve vincular todas as parcelas do pacote parcelado ao tratamento', function () {
    // ARRANGE
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();

    // ACT
    $this->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $tratamento->id, 'parcelas' => 3])
        ->assertCreated();

    // ASSERT
    expect(LancamentoCaixa::whereNotNull('grupo_parcelamento')->pluck('tratamento_id')->unique()->all())
        ->toBe([$tratamento->id]);
});

it('deve recusar o tratamento de outra criança', function () {
    // ARRANGE
    $this->actingAs(admin());
    [$payload] = cenaDeVinculo();
    $deOutraCrianca = Tratamento::factory()->create();

    // ACT
    $resposta = $this->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $deOutraCrianca->id]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');
    expect(LancamentoCaixa::count())->toBe(0);
});

it('deve recusar vínculo em lançamento que não é de uma criança', function (Closure $interessado) {
    // ARRANGE
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();

    // ACT
    $resposta = $this->postJson('/api/lancamentos', [
        ...$payload, ...$interessado(), 'tratamento_id' => $tratamento->id,
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');
})->with([
    'fornecedor' => fn () => [
        'interessado_tipo' => 'fornecedor',
        'interessado_id' => Fornecedor::create(['razao_social' => 'Fornecedor Fictício'])->id,
    ],
    'sem interessado' => fn () => ['interessado_tipo' => null, 'interessado_id' => null],
]);

it('deve recusar a edição que troca só a criança e deixa o vínculo na outra', function () {
    // ARRANGE
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();
    $id = $this->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $tratamento->id])
        ->assertCreated()->json('id');
    $outraCrianca = Paciente::factory()->create();

    // ACT — PUT parcial: o vínculo continua no tratamento da primeira criança
    $resposta = $this->putJsonComVersao("/api/lancamentos/{$id}", ['interessado_id' => $outraCrianca->id]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');
    expect(LancamentoCaixa::find($id)->interessado_id)->toBe($tratamento->paciente_id);
});

it('deve desfazer o vínculo de um lançamento manual em aberto', function () {
    // ARRANGE
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();
    $id = $this->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $tratamento->id])
        ->assertCreated()->json('id');

    // ACT
    $resposta = $this->putJsonComVersao("/api/lancamentos/{$id}", ['tratamento_id' => null]);

    // ASSERT
    $resposta->assertOk();
    expect(LancamentoCaixa::find($id)->tratamento_id)->toBeNull();
});

it('deve manter o vínculo do faturamento pela agenda', function () {
    // ARRANGE — o estado de um lançamento faturado: os dois vínculos gravados pelo servidor
    $adminDaClinica = admin();
    $cena = cenaDeCiclo('2026-07-01 10:00');
    $faturado = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-20');
    $faturado->forceFill([
        'agendamento_id' => $cena['agendamento']->id,
        'interessado_tipo' => 'paciente',
        'interessado_id' => $cena['agendamento']->paciente_id,
    ])->saveQuietly();
    $outro = Tratamento::factory()->create(['paciente_id' => $cena['agendamento']->paciente_id]);
    $this->actingAs($adminDaClinica);

    // ACT + ASSERT — trocar e desfazer são recusados
    $this->putJsonComVersao("/api/lancamentos/{$faturado->id}", ['tratamento_id' => $outro->id])
        ->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');
    $this->putJsonComVersao("/api/lancamentos/{$faturado->id}", ['tratamento_id' => null])
        ->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');
    expect($faturado->fresh()->tratamento_id)->toBe($cena['tratamento']->id);

    // reenviar o MESMO vínculo passa: a recusa é da troca, não da chave
    $this->putJsonComVersao("/api/lancamentos/{$faturado->id}", [
        'tratamento_id' => $cena['tratamento']->id, 'obs' => 'Nota fictícia.',
    ])->assertOk();
});

it('deve vincular lançamento pago sem mexer na data do pagamento, no valor nem na conta', function () {
    // ARRANGE — o pacote pago em setembro, lançado antes desta change, sem vínculo
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();
    $id = $this->postJson('/api/lancamentos', $payload)->assertCreated()->json('id');
    LancamentoCaixa::whereKey($id)->update(['pago_em' => '2026-09-05 10:00']);
    $antes = LancamentoCaixa::find($id);

    // ACT
    $resposta = $this->putJsonComVersao("/api/lancamentos/{$id}", ['tratamento_id' => $tratamento->id]);

    // ASSERT — vínculo gravado; o documento contábil intacto
    $resposta->assertOk();
    $depois = LancamentoCaixa::find($id);
    expect($depois->tratamento_id)->toBe($tratamento->id)
        ->and($depois->pago_em->format('Y-m-d H:i'))->toBe('2026-09-05 10:00')
        ->and($depois->valor)->toBe($antes->valor)
        ->and($depois->conta_id)->toBe($antes->conta_id);

    // e a troca ficou na trilha, com o antes e o depois
    $registro = Auditoria::where('entidade', 'lancamentos_caixa')->where('acao', 'atualizou')
        ->latest('id')->firstOrFail();
    expect($registro->diff_json['depois']['tratamento_id'])->toBe($tratamento->id)
        ->and($registro->diff_json['antes']['tratamento_id'])->toBeNull();
});

it('deve continuar recusando mexer no dinheiro do lançamento pago junto com o vínculo', function () {
    // ARRANGE — a exceção é do vínculo, não uma porta para o valor
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();
    $id = $this->postJson('/api/lancamentos', $payload)->assertCreated()->json('id');
    LancamentoCaixa::whereKey($id)->update(['pago_em' => '2026-09-05 10:00']);

    // ACT
    $resposta = $this->putJsonComVersao("/api/lancamentos/{$id}", [
        'tratamento_id' => $tratamento->id, 'valor' => '1.00',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('lancamento');
    expect(LancamentoCaixa::find($id)->tratamento_id)->toBeNull();
});

// ==================== ciclo fechado: a âncora agora muda ====================

/** Receita manual da criança da cena, com competência dada, e (opcionalmente) já vinculada. */
function receitaDaCriancaDaCena(array $cena, string $competencia, bool $vinculada): LancamentoCaixa
{
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, $competencia);
    $lancamento->forceFill([
        'interessado_tipo' => 'paciente',
        'interessado_id' => $cena['tratamento']->paciente_id,
        'tratamento_id' => $vinculada ? $cena['tratamento']->id : null,
    ])->saveQuietly();

    return $lancamento->refresh();
}

it('deve recusar desfazer o vínculo de lançamento de período fechado', function () {
    // ARRANGE — "arrastar para fora" pelo vínculo: sem tratamento, o lançamento deixaria de
    // alcançar o convênio, e a produção já enviada perderia a linha sem reabrir nada
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $lancamento = receitaDaCriancaDaCena($cena, '2026-07-01', vinculada: true);
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['tratamento_id' => null]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($lancamento->fresh()->tratamento_id)->toBe($cena['tratamento']->id);
});

it('deve recusar vincular a tratamento cujo convênio tem o período fechado', function () {
    // ARRANGE — "empurrar para dentro" pelo vínculo: a ORIGEM (sem tratamento) não alcança
    // convênio nenhum, então só a checagem do DESTINO recusa
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $lancamento = receitaDaCriancaDaCena($cena, '2026-07-01', vinculada: false);
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['tratamento_id' => $cena['tratamento']->id]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($lancamento->fresh()->tratamento_id)->toBeNull();
});

it('deve permitir vincular quando a competência cai fora do período fechado', function () {
    // ARRANGE — o controle dos dois acima: sem ele, uma guarda que recusasse todo vínculo
    // passaria nos testes de recusa
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $lancamento = receitaDaCriancaDaCena($cena, '2026-07-16', vinculada: false);
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['tratamento_id' => $cena['tratamento']->id]);

    // ASSERT
    $resposta->assertOk();
    expect($lancamento->fresh()->tratamento_id)->toBe($cena['tratamento']->id);
});

// ==================== o que o gate da change pediu (código CR-RPP · segurança SEC-RPP) ====================

it('deve recusar vínculo de fornecedor mesmo quando o id dele coincide com o da criança', function () {
    // ARRANGE — CR-RPP-05: ids são autoincremento por tabela e coincidem o tempo todo. Sem o ramo
    // "não é paciente", a receita do fornecedor #12 se ligaria ao pacote da criança #12
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();
    $fornecedor = new Fornecedor(['razao_social' => 'Fornecedor Fictício Gêmeo']);
    $fornecedor->forceFill(['id' => $tratamento->paciente_id])->save();

    // ACT
    $resposta = $this->postJson('/api/lancamentos', [
        ...$payload, 'interessado_tipo' => 'fornecedor', 'interessado_id' => $fornecedor->id,
        'tratamento_id' => $tratamento->id,
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');
});

it('deve recusar trocar só o TIPO do interessado para fornecedor com o vínculo mantido', function () {
    // ARRANGE — CR-RPP-05 (b): o PUT parcial com a chave `interessado_tipo` sozinha também dispara
    // a coerência; o id do fornecedor é o mesmo da criança
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();
    $id = $this->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $tratamento->id])
        ->assertCreated()->json('id');
    (new Fornecedor(['razao_social' => 'Fornecedor Fictício Gêmeo']))
        ->forceFill(['id' => $tratamento->paciente_id])->save();

    // ACT
    $resposta = $this->putJsonComVersao("/api/lancamentos/{$id}", ['interessado_tipo' => 'fornecedor']);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');
    expect(LancamentoCaixa::find($id)->interessado_tipo)->toBe('paciente');
});

it('deve apontar a criança, não o vínculo, quando o faturado muda de criança', function () {
    // ARRANGE — CR-RPP-08: no faturado o vínculo é só leitura na tela; o erro tem de cair no
    // campo que a pessoa pode corrigir
    $adminDaClinica = admin();
    $cena = cenaDeCiclo('2026-07-01 10:00');
    $faturado = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-20');
    $faturado->forceFill([
        'agendamento_id' => $cena['agendamento']->id,
        'interessado_tipo' => 'paciente',
        'interessado_id' => $cena['agendamento']->paciente_id,
    ])->saveQuietly();
    $outraCrianca = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/lancamentos/{$faturado->id}", ['interessado_id' => $outraCrianca->id]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('interessado_id')
        ->assertJsonMissingValidationErrors('tratamento_id');
});

it('deve aceitar o mesmo vínculo do faturado reenviado como texto', function () {
    // ARRANGE — CR-RPP-12: o formulário pode mandar o id como string; é o mesmo vínculo
    $adminDaClinica = admin();
    $cena = cenaDeCiclo('2026-07-01 10:00');
    $faturado = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-20');
    $faturado->forceFill([
        'agendamento_id' => $cena['agendamento']->id,
        'interessado_tipo' => 'paciente',
        'interessado_id' => $cena['agendamento']->paciente_id,
    ])->saveQuietly();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/lancamentos/{$faturado->id}", [
        'tratamento_id' => (string) $cena['tratamento']->id, 'obs' => 'Nota fictícia.',
    ]);

    // ASSERT
    $resposta->assertOk();
});

it('deve recusar CRIAR já vinculado a tratamento de período fechado, e seguir aceitando sem vínculo', function () {
    // ARRANGE — SEC-RPP-01/CR-RPP-06: o lançamento nasceria sem poder ser pago, excluído nem
    // desvinculado. Sem vínculo, o retroativo segue livre (a assimetria da spec)
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    [$payload] = cenaDeVinculo();
    // competência DENTRO da janela e vencimento FORA (CR-RPP-19): a guarda decide pela competência
    $naJanelaFechada = [
        ...$payload, 'competencia' => '2026-07-01', 'vencimento' => '2026-08-10',
        'interessado_id' => $cena['tratamento']->paciente_id,
    ];

    // ACT
    $vinculado = $this->actingAs($adminDaClinica)->postJson('/api/lancamentos', [
        ...$naJanelaFechada, 'tratamento_id' => $cena['tratamento']->id,
    ]);
    $parcelado = $this->postJson('/api/lancamentos', [
        ...$naJanelaFechada, 'tratamento_id' => $cena['tratamento']->id, 'parcelas' => 2,
    ]);
    $semVinculo = $this->postJson('/api/lancamentos', $naJanelaFechada);

    // ASSERT
    $vinculado->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    $parcelado->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    $semVinculo->assertCreated();
    expect(LancamentoCaixa::whereNotNull('tratamento_id')->where('competencia', '2026-07-01')->count())->toBe(0);
});

it('deve responder pela criança, e não pelo ciclo, ao tratamento de outra criança', function () {
    // ARRANGE — SEC-RPP-04: rodando o ciclo primeiro, o 422 nomeava a operadora do tratamento
    // de OUTRA criança — um oráculo tratamento → convênio
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $outraCrianca = Paciente::factory()->create();
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-01');
    $lancamento->forceFill([
        'interessado_tipo' => 'paciente', 'interessado_id' => $outraCrianca->id, 'tratamento_id' => null,
    ])->saveQuietly();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['tratamento_id' => $cena['tratamento']->id]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('tratamento_id')
        ->assertJsonMissingValidationErrors('ciclo_fechado');
    expect($resposta->getContent())->not->toContain($cena['convenio']->nome);
});

it('deve exigir a permissão de dar baixa para trocar o vínculo de lançamento pago', function () {
    // ARRANGE — SEC-RPP-03: trocar o vínculo do pago move dinheiro recebido entre profissionais;
    // até esta change, só quem dá baixa e estorna mexia em lançamento pago
    admin();
    [$payload, $tratamento] = cenaDeVinculo();
    $outroPacote = Tratamento::factory()->create(['paciente_id' => $tratamento->paciente_id]);
    $pago = new LancamentoCaixa([...$payload, 'contabil' => true]);
    $pago->tratamento_id = $tratamento->id;
    $pago->forceFill(['pago_em' => '2026-09-05 10:00'])->save();
    $quemEdita = usuarioCom(['lancamentos.ver', 'lancamentos.editar', 'agenda.ver', 'agenda.ver_todos'], 'Edita sem baixa');

    // ACT
    $troca = $this->actingAs($quemEdita)
        ->putJsonComVersao("/api/lancamentos/{$pago->id}", ['tratamento_id' => $outroPacote->id]);
    $mesmo = $this->actingAs($quemEdita)
        ->putJsonComVersao("/api/lancamentos/{$pago->id}", ['tratamento_id' => $tratamento->id, 'obs' => 'Nota fictícia.']);
    // o mesmo vínculo como TEXTO também não é mexer (CR-RPP-20)
    $mesmoComoTexto = $this->actingAs($quemEdita)
        ->putJsonComVersao("/api/lancamentos/{$pago->id}", ['tratamento_id' => (string) $tratamento->id, 'obs' => 'Outra nota fictícia.']);

    // ASSERT — a troca é recusada; reenviar o MESMO vínculo (o formulário manda sempre) passa
    $troca->assertForbidden();
    $mesmo->assertOk();
    $mesmoComoTexto->assertOk();
    expect($pago->fresh()->tratamento_id)->toBe($tratamento->id);
});

it('deve impedir o profissional escopado de ligar o pagamento ao pacote de um colega', function () {
    // ARRANGE — SEC-RPP-03 (D11): a mesma régua de posse do faturamento, pelo eixo agenda
    admin();
    [$payload, $doColega] = cenaDeVinculo();
    $ana = Profissional::factory()->create();
    $daAna = Tratamento::factory()->create(['paciente_id' => $doColega->paciente_id, 'profissional_id' => $ana->id]);
    $escopado = usuarioEscopadoEm($ana, ['lancamentos.ver', 'lancamentos.criar']);

    // ACT
    $noColega = $this->actingAs($escopado)->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $doColega->id]);
    $noProprio = $this->actingAs($escopado)->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $daAna->id]);

    // ASSERT
    $noColega->assertForbidden();
    $noProprio->assertCreated();
});

it('deve tirar o pacote de "sem lançamento" só com RECEITA vinculada', function () {
    // ARRANGE — SEC-RPP-02: uma despesa de R$ 0,01 amarrada ao pacote desligava a lista de
    // quem a clínica esqueceu de cobrar
    $this->actingAs(admin());
    [$payload, $tratamento] = cenaDeVinculo();
    $tratamento->update(['data_inicio' => agoraNaClinica()->toDateString()]);
    $periodo = 'de='.agoraNaClinica()->toDateString().'&ate='.agoraNaClinica()->toDateString();
    $despesa = Categoria::create(['nome' => 'Despesa Fictícia '.fake()->unique()->numberBetween(1, 99999), 'tipo' => 'despesa']);

    // ACT + ASSERT — a despesa simbólica não tira
    $this->postJson('/api/lancamentos', [
        ...$payload, 'tipo' => 'despesa', 'categoria_id' => $despesa->id, 'valor' => '0.01',
        'tratamento_id' => $tratamento->id,
    ])->assertCreated();
    expect($this->getJson("/api/relatorios/tratamentos-sem-lancamento?{$periodo}")->json('totais.quantidade'))->toBe(1);

    // ...a receita do pacote tira
    $this->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $tratamento->id])->assertCreated();
    expect($this->getJson("/api/relatorios/tratamentos-sem-lancamento?{$periodo}")->json('totais.quantidade'))->toBe(0);
});

it('deve proteger o pacote com pagamento vinculado de exclusão e de troca de convênio', function () {
    // ARRANGE — CR-RPP-09: efeitos do vínculo que já existiam para o faturado e agora valem para
    // o pagamento manual: dinheiro atribuído ao pacote não perde o pacote nem muda de regra
    $this->actingAs(admin());
    [$payload] = cenaDeVinculo();
    $doPacote = payloadDeTratamento();
    $tratamento = Tratamento::find($this->postJson('/api/tratamentos', $doPacote)->assertCreated()->json('id'));
    $this->postJson('/api/lancamentos', [
        ...$payload, 'interessado_id' => $tratamento->paciente_id, 'tratamento_id' => $tratamento->id,
    ])->assertCreated();
    // o convênio novo com serviço próprio: a recusa só pode vir do lançamento vinculado
    $outroConvenio = Convenio::create(['nome' => 'Operadora Fictícia Nova']);
    $servicoNovo = new Servico(['procedimento' => 'Sessão Fictícia Nova', 'valor' => 90]);
    $servicoNovo->convenio_id = $outroConvenio->id;
    $servicoNovo->save();

    // ACT
    $trocarConvenio = $this->putJsonComVersao("/api/tratamentos/{$tratamento->id}", [
        ...$doPacote, 'convenio_id' => $outroConvenio->id, 'servico_id' => $servicoNovo->id,
    ]);
    $excluir = $this->deleteJson("/api/tratamentos/{$tratamento->id}");

    // ASSERT
    $excluir->assertUnprocessable();
    $trocarConvenio->assertUnprocessable()->assertJsonValidationErrors('convenio_id');
    expect(Tratamento::find($tratamento->id)->convenio_id)->toBe($tratamento->convenio_id);
});

it('deve impedir o escopado de tirar o pagamento do pacote de um colega', function () {
    // ARRANGE — CR-RPP-16: a posse da ORIGEM. Sem ela, a Ana religa ao próprio pacote o pagamento
    // do pacote da Bia (mesma criança), ou o desvincula — e o dinheiro muda de profissional
    admin();
    [$payload, $daBia] = cenaDeVinculo();
    $ana = Profissional::factory()->create();
    $daAna = Tratamento::factory()->create(['paciente_id' => $daBia->paciente_id, 'profissional_id' => $ana->id]);
    $lancamento = new LancamentoCaixa([...$payload, 'contabil' => true]);
    $lancamento->tratamento_id = $daBia->id;
    $lancamento->save();
    $escopada = usuarioEscopadoEm($ana, ['lancamentos.ver', 'lancamentos.editar']);

    // ACT
    $paraSi = $this->actingAs($escopada)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['tratamento_id' => $daAna->id]);
    $desvincular = $this->actingAs($escopada)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['tratamento_id' => null]);

    // ASSERT
    $paraSi->assertForbidden();
    $desvincular->assertForbidden();
    expect($lancamento->fresh()->tratamento_id)->toBe($daBia->id);
});

it('deve dar ao escopado o mesmo 403 para tratamento inexistente e para o do colega', function () {
    // ARRANGE — CR-RPP-17/SEC-RPP-05: a posse no `authorize()` roda antes do `exists`; com ela no
    // controller, 422 (não existe) × 403 (é do colega) enumerava os tratamentos da clínica
    admin();
    [$payload, $doColega] = cenaDeVinculo();
    $escopado = usuarioEscopadoEm(Profissional::factory()->create(), ['lancamentos.ver', 'lancamentos.criar']);

    // ACT
    $inexistente = $this->actingAs($escopado)->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => 99999999]);
    $doOutro = $this->actingAs($escopado)->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $doColega->id]);

    // ASSERT
    $inexistente->assertForbidden();
    $doOutro->assertForbidden();
});

it('deve recusar com 409 o vínculo decidido sobre um lançamento que foi pago no meio do caminho', function () {
    // ARRANGE — CR-RPP-18/SEC-RPP-06: a autorização lê sem lock. Entre a leitura dela e o lock do
    // serviço, outra pessoa dá baixa; quem não dá baixa trocaria o vínculo de um lançamento pago.
    // A intercalação é encenada no SEGUNDO `retrieved` (o do controller, depois do `authorize`)
    admin();
    [$payload, $tratamento] = cenaDeVinculo();
    $outroPacote = Tratamento::factory()->create(['paciente_id' => $tratamento->paciente_id]);
    $lancamento = new LancamentoCaixa([...$payload, 'contabil' => true]);
    $lancamento->tratamento_id = $tratamento->id;
    $lancamento->save();
    $quemEdita = usuarioCom(['lancamentos.ver', 'lancamentos.editar', 'agenda.ver', 'agenda.ver_todos'], 'Edita sem baixa');
    $leituras = 0;
    LancamentoCaixa::retrieved(function (LancamentoCaixa $lido) use (&$leituras, $lancamento): void {
        if ($lido->id === $lancamento->id && ++$leituras === 2) {
            DB::table('lancamentos_caixa')->where('id', $lancamento->id)->update(['pago_em' => '2026-09-24 10:00']);
        }
    });

    // ACT
    $resposta = $this->actingAs($quemEdita)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['tratamento_id' => $outroPacote->id]);

    // ASSERT
    $resposta->assertConflict();
    expect($lancamento->fresh()->tratamento_id)->toBe($tratamento->id);
});

it('deve recusar com 409 o vínculo decidido sobre um lançamento que outra pessoa religou', function () {
    // ARRANGE — CR-RPP-22: a escopada reenvia o vínculo que VIU (o pacote dela), e o `authorize`
    // pula a posse porque "é igual". No meio, alguém move o lançamento para o pacote da colega;
    // sem o 409, gravar "o mesmo" tiraria o dinheiro da colega sem posse nenhuma
    admin();
    [$payload, $daColega] = cenaDeVinculo();
    $ana = Profissional::factory()->create();
    $daAna = Tratamento::factory()->create(['paciente_id' => $daColega->paciente_id, 'profissional_id' => $ana->id]);
    $lancamento = new LancamentoCaixa([...$payload, 'contabil' => true]);
    $lancamento->tratamento_id = $daAna->id;
    $lancamento->save();
    $escopada = usuarioEscopadoEm($ana, ['lancamentos.ver', 'lancamentos.editar']);
    $leituras = 0;
    LancamentoCaixa::retrieved(function (LancamentoCaixa $lido) use (&$leituras, $lancamento, $daColega): void {
        if ($lido->id === $lancamento->id && ++$leituras === 2) {
            DB::table('lancamentos_caixa')->where('id', $lancamento->id)->update(['tratamento_id' => $daColega->id]);
        }
    });

    // ACT
    $resposta = $this->actingAs($escopada)->putJsonComVersao("/api/lancamentos/{$lancamento->id}", [
        'tratamento_id' => $daAna->id, 'obs' => 'Nota fictícia.',
    ]);

    // ASSERT — conflito, e o vínculo que a outra pessoa gravou fica
    $resposta->assertConflict();
    expect($lancamento->fresh()->tratamento_id)->toBe($daColega->id);
});

it('não deve acusar conflito quando só a baixa mudou e o vínculo veio igual', function () {
    // ARRANGE — CR-RPP-23: o formulário reenvia o vínculo sempre; se alguém dá baixa no meio de
    // um PUT só de obs, a autorização não decidiu nada sobre o pago — não há o que recusar
    admin();
    [$payload, $tratamento] = cenaDeVinculo();
    $lancamento = new LancamentoCaixa([...$payload, 'contabil' => true]);
    $lancamento->tratamento_id = $tratamento->id;
    $lancamento->save();
    $quemEdita = usuarioCom(['lancamentos.ver', 'lancamentos.editar', 'agenda.ver', 'agenda.ver_todos'], 'Edita sem baixa');
    $leituras = 0;
    LancamentoCaixa::retrieved(function (LancamentoCaixa $lido) use (&$leituras, $lancamento): void {
        if ($lido->id === $lancamento->id && ++$leituras === 2) {
            DB::table('lancamentos_caixa')->where('id', $lancamento->id)->update(['pago_em' => '2026-09-24 10:00']);
        }
    });

    // ACT
    $resposta = $this->actingAs($quemEdita)->putJsonComVersao("/api/lancamentos/{$lancamento->id}", [
        'tratamento_id' => $tratamento->id, 'obs' => 'Nota fictícia.',
    ]);

    // ASSERT
    $resposta->assertOk();
});

it('deve recusar com 404 o id fracionário na rota, sem pular a autorização do vínculo', function () {
    // ARRANGE — SEC-RPP-08: `/lancamentos/N.5` não era achado pelo `authorize()` (que então pulava
    // posse e `pagar`) e o `int $id` do controller truncava para N: quem não dá baixa trocava o
    // vínculo de um lançamento pago
    admin();
    [$payload, $tratamento] = cenaDeVinculo();
    $outroPacote = Tratamento::factory()->create(['paciente_id' => $tratamento->paciente_id]);
    $pago = new LancamentoCaixa([...$payload, 'contabil' => true]);
    $pago->tratamento_id = $tratamento->id;
    $pago->forceFill(['pago_em' => '2026-09-05 10:00'])->save();
    $quemEdita = usuarioCom(['lancamentos.ver', 'lancamentos.editar', 'agenda.ver', 'agenda.ver_todos'], 'Edita sem baixa');

    // ACT
    $resposta = $this->actingAs($quemEdita)->putJson("/api/lancamentos/{$pago->id}.5", ['tratamento_id' => $outroPacote->id], [
        'If-Match' => $pago->fresh()->updated_at?->toJSON(),
    ]);

    // ASSERT
    $resposta->assertNotFound();
    expect($pago->fresh()->tratamento_id)->toBe($tratamento->id);
});

it('deve responder 404 ao lançamento inexistente antes de validar o tratamento', function () {
    // ARRANGE — SEC-RPP-09: com a validação antes do 404, `{tratamento_id: 99999999}` dava 422 e o
    // do colega dava 404 — o oráculo de existência de tratamento por outra porta
    admin();
    [, $doColega] = cenaDeVinculo();
    $escopada = usuarioEscopadoEm(Profissional::factory()->create(), ['lancamentos.ver', 'lancamentos.editar']);

    // ACT
    $inexistente = $this->actingAs($escopada)->putJson('/api/lancamentos/99999999', ['tratamento_id' => 99999999]);
    $doOutro = $this->actingAs($escopada)->putJson('/api/lancamentos/99999999', ['tratamento_id' => $doColega->id]);

    // ASSERT
    $inexistente->assertNotFound();
    $doOutro->assertNotFound();
});
