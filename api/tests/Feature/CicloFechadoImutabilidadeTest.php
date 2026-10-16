<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Evolucao;
use App\Models\FechamentoCiclo;
use App\Models\LancamentoCaixa;
use App\Models\StatusAgendamento;
use App\Models\TipoPagamento;
use App\Support\Ciclos\FechamentoDeCiclo;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Str;

/**
 * A IMUTABILIDADE DE EDIÇÃO nos três módulos (tasks 3.2/3.3/3.4 · specs atendimentos,
 * evolucoes e lancamentos-caixa).
 *
 * O que estes testes carregam de peso:
 *
 * - **SEC-TE-01** — "arrastar para FORA" recusado. É o resíduo registrado: a trava de
 *   evolução vencida era contornável movendo a data. Travar só o destino deixaria o
 *   contorno vivo com outro nome.
 * - **SEC-FC-15** — a mesma dupla verificação no lançamento, onde `competencia` é editável
 *   enquanto o lançamento não foi pago.
 * - **A assimetria deliberada:** CRIAR retroativo segue permitido nos três. A clínica
 *   registra o que aconteceu; o que já foi enviado à operadora é que não muda. Um teste por
 *   módulo prova que a guarda não virou "recusa tudo" — sem eles, uma guarda quebrada que
 *   recusasse toda escrita passaria em todos os testes de recusa acima.
 */

// ==================== 3.2 · atendimento ====================

it('deve recusar editar atendimento cujo finalizado_em cai em período fechado', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT — edição que nem toca na data: o registro inteiro está congelado
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/atendimentos/{$cena['atendimento']->id}",
        ['observacoes' => 'Correção fictícia depois do envio à operadora.'],
    );

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['atendimento']->fresh()->observacoes)->toBeNull();
});

it('deve recusar arrastar o finalizado_em para FORA do período fechado', function () {
    // ARRANGE — SEC-TE-01: o contorno registrado. Checar só o destino (16/07, aberto)
    // deixaria esta edição passar, e a produção enviada sairia do ciclo sem reabrir nada.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/atendimentos/{$cena['atendimento']->id}",
        ['finalizado_em' => '2026-07-16 10:00'], // primeiro dia da janela SEGUINTE
    );

    // ASSERT — a data permanece a original
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['atendimento']->fresh()->finalizado_em->format('Y-m-d H:i'))->toBe('2026-07-01 10:00');
});

it('deve recusar arrastar o finalizado_em para DENTRO do período fechado', function () {
    // ARRANGE — a direção oposta: sujar um ciclo já enviado com produção que não estava lá.
    // O atendimento nasce FORA (16/07), na janela seguinte.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo('2026-07-16 10:00');
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/atendimentos/{$cena['atendimento']->id}",
        ['finalizado_em' => '2026-07-01 10:00'],
    );

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['atendimento']->fresh()->finalizado_em->format('Y-m-d H:i'))->toBe('2026-07-16 10:00');
});

it('deve recusar excluir atendimento de período fechado', function () {
    // ARRANGE — excluir é a forma mais completa de editar
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->deleteJson("/api/atendimentos/{$cena['atendimento']->id}");

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect(Atendimento::whereKey($cena['atendimento']->id)->exists())->toBeTrue();
});

it('deve permitir registrar atendimento retroativo dentro do período fechado', function () {
    // ARRANGE — a assimetria deliberada da spec: criar é registrar o que aconteceu. Sem
    // este teste, uma guarda que recusasse TODA escrita passaria nos quatro acima.
    // O relógio fica PRESO logo depois do fechamento: a sessão de 01/07 da cena não tem
    // evolução e, com o relógio real, vence o prazo (100 dias) + a carência (3) em 13/10/2026 —
    // e a trava de evolução, que não é o assunto aqui, passava a responder 422.
    $this->travelTo('2026-07-20 10:00');
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // outro agendamento do MESMO tratamento (o da cena já tem atendimento — é 1:1)
    $outro = Agendamento::factory()->create([
        'paciente_id' => $cena['agendamento']->paciente_id,
        'especialidade_id' => $cena['agendamento']->especialidade_id,
        'profissional_id' => $cena['agendamento']->profissional_id,
    ]);
    $outro->forceFill(['tratamento_id' => $cena['tratamento']->id])->save();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$outro->id}/atendimento", [
            'finalizado_em' => '2026-07-02 09:00', // DENTRO do período fechado
        ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('finalizado_em', '2026-07-02 09:00');
});

// ==================== 3.3 · evolução ====================

it('deve recusar editar evolução cujo atendimento-mãe está em período fechado', function () {
    // ARRANGE — a evolução não tem competência própria (D3): quem decide é o
    // `finalizado_em` do atendimento
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $evolucao = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$cena['atendimento']->id}/evolucao", [
            'profissional_id' => $cena['agendamento']->profissional_id,
            'motivo_assinatura' => 'Registro fictício pela coordenação, para teste.',
            'conteudo' => 'Evolução fictícia original.',
        ])->assertCreated()->json('id');

    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$evolucao}", [
        'conteudo' => 'Reescrita fictícia depois do envio.',
    ]);

    // ASSERT — o conteúdo permanece o mesmo
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect(Evolucao::find($evolucao)->conteudo)->toBe('Evolução fictícia original.');
});

it('deve permitir registrar evolução para atendimento de período fechado', function () {
    // ARRANGE — NUNCA no `store` (spec evolucoes): é a mesma razão pela qual a escrita da
    // evolução nunca é recusada por atraso — o prontuário atrasado é melhor que o em branco
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$cena['atendimento']->id}/evolucao", [
            'profissional_id' => $cena['agendamento']->profissional_id,
            'motivo_assinatura' => 'Registro fictício pela coordenação, para teste.',
            'conteudo' => 'Evolução fictícia registrada depois do fechamento.',
        ]);

    // ASSERT
    $resposta->assertCreated();
});

it('deve voltar a aceitar a edição da evolução depois de o ciclo ser reaberto', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $evolucao = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$cena['atendimento']->id}/evolucao", [
            'profissional_id' => $cena['agendamento']->profissional_id,
            'motivo_assinatura' => 'Registro fictício pela coordenação, para teste.',
            'conteudo' => 'Evolução fictícia original.',
        ])->assertCreated()->json('id');

    $fechamento = fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$evolucao}", [
        'conteudo' => 'Tentativa fictícia com o ciclo fechado.',
    ])->assertUnprocessable();

    // ACT — a reabertura pelo caminho REAL, com motivo (SEC-FC-06)
    $this->actingAs($adminDaClinica)->postJson(
        "/api/convenios/{$cena['convenio']->id}/ciclos/{$fechamento->id}/reabertura",
        ['motivo' => 'Correção fictícia acordada com a operadora.'],
    )->assertOk();

    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/evolucoes/{$evolucao}", [
        'conteudo' => 'Evolução fictícia corrigida com o ciclo reaberto.',
    ]);

    // ASSERT — linha reaberta é histórico, não congelamento
    $resposta->assertOk();
    expect(Evolucao::find($evolucao)->conteudo)->toBe('Evolução fictícia corrigida com o ciclo reaberto.');
});

// ==================== 3.4 · lançamento ====================

/**
 * As QUATRO operações da spec, **uma por teste** (dataset).
 *
 * Elas viviam num `it` só, encadeadas: quebrar o primeiro ACT escondia os outros três — o
 * teste ficava vermelho por `atualizar` e ninguém descobria que `pagar`, `excluir` e
 * `estornar` também tinham parado de recusar. Um comportamento por teste; o nome do caso do
 * dataset entra no nome do teste, e a suíte diz QUAL das quatro caiu.
 *
 * As quatro deslocam a linha do período no extrato, e o fechamento existe para segurar o
 * número enviado à operadora.
 */
it('deve recusar a operação no lançamento de período fechado', function (Closure $acao, Closure $verificar, bool $pagoAntes) {
    // ARRANGE
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-01');
    if ($pagoAntes) {
        // o lançamento é pago POR FORA da API (o pagar já está travado), senão a recusa do
        // estorno seria só o eco da recusa anterior
        $lancamento->forceFill(['pago_em' => '2026-07-02 10:00'])->saveQuietly();
    }
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $acao($this->actingAs($adminDaClinica), $lancamento);

    // ASSERT — a recusa E o estado intocado (a 422 sozinha não prova que nada foi gravado)
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    $verificar($lancamento);
})->with([
    'atualizar' => [
        fn ($caso, LancamentoCaixa $l) => $caso->putJsonComVersao("/api/lancamentos/{$l->id}", ['valor' => '999.00']),
        fn (LancamentoCaixa $l) => expect($l->fresh()->valor)->toBe('150.00'),
        false,
    ],
    'pagar' => [
        fn ($caso, LancamentoCaixa $l) => $caso->postJson("/api/lancamentos/{$l->id}/pagamento"),
        fn (LancamentoCaixa $l) => expect($l->fresh()->pago_em)->toBeNull(),
        false,
    ],
    'excluir' => [
        fn ($caso, LancamentoCaixa $l) => $caso->deleteJson("/api/lancamentos/{$l->id}"),
        fn (LancamentoCaixa $l) => expect(LancamentoCaixa::whereKey($l->id)->exists())->toBeTrue(),
        false,
    ],
    'estornar o pagamento' => [
        fn ($caso, LancamentoCaixa $l) => $caso->deleteJson("/api/lancamentos/{$l->id}/pagamento"),
        fn (LancamentoCaixa $l) => expect($l->fresh()->pago_em)->not->toBeNull(),
        true,
    ],
]);

it('deve recusar arrastar a competência do lançamento para FORA do período fechado', function () {
    // ARRANGE — SEC-FC-15, o mesmo contorno do atendimento
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-01');
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['competencia' => '2026-07-16']);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($lancamento->fresh()->competencia->format('Y-m-d'))->toBe('2026-07-01');
});

it('deve recusar empurrar a competência do lançamento para DENTRO do período fechado', function () {
    // ARRANGE — lançamento nasce FORA da janela fechada
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-16');
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['competencia' => '2026-07-01']);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($lancamento->fresh()->competencia->format('Y-m-d'))->toBe('2026-07-16');
});

it('deve decidir o ciclo do lançamento pela competência, nunca pelo pagamento', function () {
    // ARRANGE — D3: com `pago_em`, a MESMA sessão pularia de ciclo conforme o dia em que a
    // operadora pagasse. Competência DENTRO (01/07), pagamento FORA (20/07).
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-01');
    $lancamento->forceFill(['pago_em' => '2026-07-20 10:00'])->saveQuietly();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT — `obs` é editável em lançamento pago (T-fin-09), então uma recusa aqui só pode
    // vir da guarda de ciclo: as duas travas são independentes e ambas estão de pé
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['obs' => 'Nota fictícia.']);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
});

it('deve manter lançamento SEM tratamento intocado por qualquer ciclo fechado', function () {
    // ARRANGE — fail-open do D5: lançamento manual/despesa não alcança convênio e não tem
    // calendário. Travá-lo exigiria um "ciclo da casa" que a clínica não pediu.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    $manual = new LancamentoCaixa([
        'tipo' => 'despesa',
        'competencia' => '2026-07-01', // DENTRO da janela fechada
        'vencimento' => '2026-07-01',
        'valor' => '80.00',
        'contabil' => true,
        'categoria_id' => Categoria::create([
            'nome' => 'Despesa Fictícia '.fake()->unique()->numberBetween(1, 99999),
            'tipo' => 'despesa',
        ])->id,
        'tipo_pagamento_id' => TipoPagamento::create([
            'nome' => 'Pgto Fictício '.fake()->unique()->numberBetween(1, 99999),
        ])->id,
        'conta_id' => Conta::create([
            'nome' => 'Caixa Fictício '.fake()->unique()->numberBetween(1, 99999),
        ])->id,
    ]);
    $manual->save();

    // ACT + ASSERT — editar E excluir seguem livres
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/lancamentos/{$manual->id}", ['valor' => '90.00'])
        ->assertOk()->assertJsonPath('valor', '90.00');
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/lancamentos/{$manual->id}")->assertNoContent();
});

it('deve recusar excluir o GRUPO quando uma parcela cai em período fechado', function () {
    // ARRANGE — "aplicar no grupo" apaga linhas que o usuário não está olhando. Se a guarda
    // olhasse só a parcela clicada, o lote levaria junto uma competência congelada.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $grupo = (string) Str::uuid();

    $foraDoCiclo = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-16');
    $dentroDoCiclo = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-01');
    foreach ([$foraDoCiclo, $dentroDoCiclo] as $numero => $parcela) {
        $parcela->forceFill([
            'grupo_parcelamento' => $grupo,
            'parcela' => $numero + 1,
            'parcelas_total' => 2,
        ])->saveQuietly();
    }

    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT — clicando na parcela ABERTA, com aplicar_no_grupo
    $resposta = $this->actingAs($adminDaClinica)
        ->deleteJson("/api/lancamentos/{$foraDoCiclo->id}?aplicar_no_grupo=1");

    // ASSERT — tudo-ou-nada: nem a parcela aberta some
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect(LancamentoCaixa::where('grupo_parcelamento', $grupo)->count())->toBe(2);
});

it('deve permitir criar lançamento retroativo com competência em período fechado', function () {
    // ARRANGE — a assimetria da spec, no módulo do dinheiro
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/lancamentos', [
        'tipo' => 'receita',
        'competencia' => '2026-07-01',
        'vencimento' => '2026-07-01',
        'valor' => '150.00',
        'contabil' => true,
        'categoria_id' => Categoria::create([
            'nome' => 'Receita Fictícia '.fake()->unique()->numberBetween(1, 99999),
            'tipo' => 'receita',
        ])->id,
        'tipo_pagamento_id' => TipoPagamento::create([
            'nome' => 'Pgto Fictício '.fake()->unique()->numberBetween(1, 99999),
        ])->id,
        'conta_id' => Conta::create([
            'nome' => 'Caixa Fictício '.fake()->unique()->numberBetween(1, 99999),
        ])->id,
    ]);

    // ASSERT
    $resposta->assertCreated();
});

// ==================== 3.8 · o teste CRUZADO ====================

it('deve recusar o MESMO período nos quatro caminhos, para o mesmo convênio', function () {
    // ARRANGE — a prova da FONTE ÚNICA (D3). Se um módulo tivesse regra própria, ele
    // divergiria aqui: mesma cena, mesmo convênio, mesma janela, quatro boundaries, e a
    // MESMA chave de erro (`ciclo_fechado`) — a chave é parte da prova, porque um módulo
    // com guarda própria teria inventado a sua. O 4º caminho é o STATUS do agendamento
    // (change `trava-de-status-em-ciclo-fechado`), cuja competência é o `inicio` (o dia da
    // SESSÃO) — por isso a cena o traz para DENTRO da janela.
    $adminDaClinica = admin();
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);
    $cena = cenaDeCiclo();
    $cena['agendamento']->forceFill([
        'inicio' => '2026-07-01 10:00',
        'fim' => '2026-07-01 10:40',
    ])->save();
    $evolucao = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$cena['atendimento']->id}/evolucao", [
            'profissional_id' => $cena['agendamento']->profissional_id,
            'motivo_assinatura' => 'Registro fictício pela coordenação, para teste.',
            'conteudo' => 'Evolução fictícia.',
        ])->assertCreated()->json('id');
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-01');
    $statusNovo = StatusAgendamento::where('nome', 'Falta Justificada')->firstOrFail();

    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $this->actingAs($adminDaClinica);

    // ACT — os quatro, com competências que caem na MESMA janela por caminhos diferentes:
    // o atendimento pelo seu `finalizado_em`, a evolução pelo do atendimento-mãe, o
    // lançamento pela sua `competencia`, o status do agendamento pelo `inicio` da sessão
    $noAtendimento = $this->putJsonComVersao("/api/atendimentos/{$cena['atendimento']->id}", [
        'observacoes' => 'Fictício.',
    ]);
    $naEvolucao = $this->putJsonComVersao("/api/evolucoes/{$evolucao}", ['conteudo' => 'Fictício.']);
    $noLancamento = $this->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['valor' => '1.00']);
    $noStatus = $this->putJsonComVersao("/api/agendamentos/{$cena['agendamento']->id}", [
        'inicio' => '2026-07-01 10:00',
        'profissional_id' => $cena['agendamento']->profissional_id,
        'status_id' => $statusNovo->id,
    ]);

    // ASSERT — os quatro recusam, na mesma chave e com a MESMA mensagem: o período é um só
    foreach ([$noAtendimento, $naEvolucao, $noLancamento, $noStatus] as $resposta) {
        $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    }
    $mensagens = collect([$noAtendimento, $naEvolucao, $noLancamento, $noStatus])
        ->map(fn ($r) => $r->json('errors.ciclo_fechado.0'))->unique();
    expect($mensagens)->toHaveCount(1, 'Os quatro caminhos deram mensagens diferentes para o MESMO '
        .'período: a fonte única do D3 virou guardas com regra própria.');

    // ...e o CONTROLE: reaberto o período, os quatro voltam a aceitar. Sem isto, uma guarda
    // que recusasse tudo passaria neste teste cruzado também.
    $fechamento = FechamentoCiclo::where('convenio_id', $cena['convenio']->id)->firstOrFail();
    FechamentoDeCiclo::comLockDoConvenio($cena['convenio']->id, function () use ($fechamento): void {
        $fechamento->forceFill(['reaberto_em' => now(), 'reaberto_por' => $fechamento->fechado_por])->save();
    });

    $this->putJsonComVersao("/api/atendimentos/{$cena['atendimento']->id}", ['observacoes' => 'Ok.'])
        ->assertOk();
    $this->putJsonComVersao("/api/evolucoes/{$evolucao}", ['conteudo' => 'Ok.'])->assertOk();
    $this->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['valor' => '1.00'])->assertOk();
    $this->putJsonComVersao("/api/agendamentos/{$cena['agendamento']->id}", [
        'inicio' => '2026-07-01 10:00',
        'profissional_id' => $cena['agendamento']->profissional_id,
        'status_id' => $statusNovo->id,
    ])->assertOk();
});
