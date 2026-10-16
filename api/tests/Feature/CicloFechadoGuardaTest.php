<?php

use App\Models\Profissional;
use App\Support\Ciclos\GuardaDeCicloFechado;
use Illuminate\Support\Facades\DB;

/**
 * A GUARDA em si (task 3.1) e o que ela pode dizer (task 4.4 · SEC-FC-07/08/09).
 *
 * Os cortes: com `dia_fixo` 15 o período é 16→15. O que este arquivo prova é que a decisão
 * sai do INTERVALO PERSISTIDO (SEC-FC-17) — nunca re-derivada do calendário atual, senão
 * `convenios.editar` moveria a fronteira de um período já enviado sem `ciclos.reabrir`, sem
 * motivo digitado e sem trilha —, que o fail-open do D5 só vale para quem não alcança
 * convênio, e que a 422 tem TETO: período + estado + caminho, com o nome da operadora
 * reservado a quem tem `convenios.ver`.
 */

// ==================== 3.1 · os cortes e o fail-safe ====================

it('deve tratar como fechado exatamente os dias do período persistido, e nenhum outro', function () {
    // ARRANGE — janela 16/06–15/07; as fronteiras são inclusivas dos dois lados
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $guarda = app(GuardaDeCicloFechado::class);
    $tratamento = $cena['tratamento']->id;

    // ACT + ASSERT — véspera aberta · primeiro dia fechado · último dia fechado · seguinte aberto
    expect($guarda->emCicloFechado($tratamento, '2026-06-15'))->toBeFalse();
    expect($guarda->emCicloFechado($tratamento, '2026-06-16'))->toBeTrue();
    expect($guarda->emCicloFechado($tratamento, '2026-07-15'))->toBeTrue();
    expect($guarda->emCicloFechado($tratamento, '2026-07-16'))->toBeFalse();

    // e a hora não desloca o dia: 23:59 do último dia ainda é o último dia (parede da clínica)
    expect($guarda->emCicloFechado($tratamento, '2026-07-15 23:59'))->toBeTrue();
});

it('deve deixar passar o registro que não alcança convênio algum (fail-open do D5)', function () {
    // ARRANGE — lançamento manual, despesa e agendamento sem tratamento não têm operadora e
    // não têm calendário. O recorte do SEC-FC-16 (isto vale como AUSÊNCIA de vínculo, jamais
    // como REMOÇÃO) é sustentado pelas guardas do CicloFechadoVinculoTest, não por aqui.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $guarda = app(GuardaDeCicloFechado::class);

    // ACT + ASSERT — sem tratamento, e tratamento inexistente
    expect($guarda->emCicloFechado(null, '2026-07-01'))->toBeFalse();
    expect($guarda->emCicloFechado(999_999, '2026-07-01'))->toBeFalse();
    // ...e sem competência não há dia a comparar
    expect($guarda->emCicloFechado($cena['tratamento']->id, null))->toBeFalse();
});

it('deve ignorar fechamento REABERTO ao decidir', function () {
    // ARRANGE — a linha reaberta é HISTÓRICO (append-only, SEC-FC-02), não congelamento
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $fechamento = fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $guarda = app(GuardaDeCicloFechado::class);
    expect($guarda->emCicloFechado($cena['tratamento']->id, '2026-07-01'))->toBeTrue();

    // ACT
    $this->actingAs($adminDaClinica)->postJson(
        "/api/convenios/{$cena['convenio']->id}/ciclos/{$fechamento->id}/reabertura",
        ['motivo' => 'Correção fictícia acordada com a operadora.'],
    )->assertOk();

    // ASSERT — a linha continua lá, e não trava mais
    expect(app(GuardaDeCicloFechado::class)->emCicloFechado($cena['tratamento']->id, '2026-07-01'))
        ->toBeFalse();
    expect($fechamento->fresh()->exists)->toBeTrue();
});

it('deve decidir pelo intervalo persistido, e não pelo calendário atual do convênio', function () {
    // ARRANGE — SEC-FC-17. O fechamento nasce com `dia_fixo` 15 (janela 16/06–15/07). O
    // calendário é então trocado para `ultimo_dia` POR FORA da API (a recusa do boundary é o
    // SEC-FC-18, testado em ConvenioCalendarioCicloTest — aqui a pergunta é outra: se ele
    // MUDASSE, a fronteira do que já foi enviado se moveria?).
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    $cena['convenio']->forceFill([
        'ciclo_tipo_corte' => 'ultimo_dia',
        'ciclo_dia_corte' => null,
    ])->saveQuietly();

    // ACT + ASSERT — sob `ultimo_dia`, a janela de julho seria 01/07–31/07: 20/07 cairia
    // dentro e 16/06 ficaria fora. As duas asserções abaixo INVERTEM se a guarda re-derivar.
    $guarda = app(GuardaDeCicloFechado::class);
    expect($guarda->emCicloFechado($cena['tratamento']->id, '2026-06-16'))->toBeTrue();
    expect($guarda->emCicloFechado($cena['tratamento']->id, '2026-07-20'))->toBeFalse();
});

it('deve falhar alto quando o caminho de escrita chama a guarda sem transação aberta', function () {
    // ARRANGE — `comLockDoConvenio` abre a própria transação: chamado de fora de qualquer
    // uma, ele COMITA ao voltar e solta o lock ANTES da gravação que deveria proteger. Todos
    // os testes de recusa continuariam verdes (recusa sequencial não depende de lock), e o
    // TOCTOU do SEC-FC-10 voltaria inteiro. Por isso a guarda falha com nome, e não em
    // silêncio.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $guarda = app(GuardaDeCicloFechado::class);
    // pela porta do CONVÊNIO, não do tratamento: a checagem tem de disparar ANTES de
    // qualquer ida ao banco — resolver o tratamento primeiro faria o teste depender de dados
    // que o rollback abaixo leva embora, e a guarda sairia por "sem convênio alcançável"
    // (fail-open) em vez de pela exceção que este teste existe para provar
    $pares = [[$cena['convenio']->id, '2026-07-01']];

    // ACT — saímos da transação do RefreshDatabase de propósito: é o estado exato de um
    // caminho de escrita que esqueceu o `DB::transaction`
    $niveis = DB::transactionLevel();
    while (DB::transactionLevel() > 0) {
        DB::rollBack();
    }
    $erro = null;
    try {
        $guarda->assegurarPorConvenio($pares);
    } catch (LogicException $excecao) {
        $erro = $excecao;
    }
    // devolve a transação ao teardown do RefreshDatabase
    for ($i = 0; $i < $niveis; $i++) {
        DB::beginTransaction();
    }

    // ASSERT
    expect($erro)->toBeInstanceOf(LogicException::class);
    expect($erro->getMessage())->toContain('SEC-FC-10');
});

// ==================== 4.4 · SEC-FC-07 (o teto da mensagem) ====================

it('deve nomear o convênio na 422 só para quem tem convenios.ver', function () {
    // ARRANGE — SEC-FC-07/D7b: quem tem `lancamentos.editar` não tem, por construção,
    // `convenios.ver`/`tratamentos.ver`. Nomear a operadora ali ensinaria o vínculo
    // paciente↔convênio: dado pessoal de MENOR e proxy de condição de saúde.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-01');
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $nomeDaOperadora = $cena['convenio']->nome;

    $semConvenios = usuarioCom(['lancamentos.ver', 'lancamentos.editar'], 'Financeiro Restrito');
    $comConvenios = usuarioCom(
        ['lancamentos.ver', 'lancamentos.editar', 'convenios.ver'],
        'Financeiro com Convênios',
    );

    // ACT
    $restrito = $this->actingAs($semConvenios)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['valor' => '999.00']);

    // trocar de ator no MEIO do teste exige soltar o guard já resolvido — senão o segundo
    // `actingAs` cai em 401 e o teste "passaria" sem nunca ter comparado as duas mensagens
    $this->flushSession();
    app('auth')->forgetGuards();

    $amplo = $this->actingAs($comConvenios)
        ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['valor' => '999.00']);

    // ASSERT — os dois recusam; só um aprende o nome da operadora
    $restrito->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    $amplo->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    semVazamento($restrito->json(), $nomeDaOperadora);
    expect($amplo->json('errors.ciclo_fechado.0'))->toContain($nomeDaOperadora);

    // ...e o teto vale para os DOIS: período + estado + caminho, nunca quem fechou nem quando
    foreach ([$restrito, $amplo] as $resposta) {
        $mensagem = $resposta->json('errors.ciclo_fechado.0');
        expect($mensagem)->toContain('16/06/2026–15/07/2026');
        expect($mensagem)->toContain('reabertura é do administrador');
        semVazamento($resposta->json(), $adminDaClinica->nome); // quem fechou não circula
    }
});

// ==================== 4.4 · SEC-FC-08 (a ordem dos gates) ====================

it('deve responder 403 (nunca 422) para registro de OUTRO profissional em ciclo fechado', function () {
    // ARRANGE — a ordem é imutável: findOrFail → posse/escopo (403/404) → concorrência
    // (409/428) → ciclo (422). Se a 422 viesse antes, ela viraria oráculo: quem não pode
    // sequer ver o registro aprenderia que ele existe E em que período ele cai.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // um profissional ESCOPADO que não é o dono do agendamento-mãe
    $outroProfissional = Profissional::factory()->create();
    $intruso = usuarioCom(['atendimentos.ver', 'atendimentos.editar', 'atendimentos.excluir'], 'Escopado Alheio');
    $intruso->update(['profissional_id' => $outroProfissional->id]);

    // ACT
    $edicao = $this->actingAs($intruso)->putJsonComVersao(
        "/api/atendimentos/{$cena['atendimento']->id}",
        ['observacoes' => 'Fictício.'],
    );
    $exclusao = $this->actingAs($intruso)
        ->deleteJson("/api/atendimentos/{$cena['atendimento']->id}");

    // ASSERT — 403, e NENHUMA palavra sobre o período
    $edicao->assertForbidden();
    $exclusao->assertForbidden();
    semVazamento($edicao->json(), '16/06/2026');
    semVazamento($exclusao->json(), '16/06/2026');
});

// ==================== 4.4 · SEC-FC-09 (o booleano derivado) ====================

it('deve expor em_ciclo_fechado no DETALHE dos três módulos, e nunca a lista de fechamentos', function () {
    // ARRANGE — D7b: o front recebe um booleano POR REGISTRO para sumir com as afordâncias.
    // A lista de fechamentos e o calendário ficam atrás de `ciclos.fechar`/`convenios.ver`;
    // aqui a afordância não pode virar oráculo do cadastro de convênios.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $evolucao = $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$cena['atendimento']->id}/evolucao", [
            'profissional_id' => $cena['agendamento']->profissional_id,
            'motivo_assinatura' => 'Registro fictício pela coordenação, para teste.',
            'conteudo' => 'Evolução fictícia.',
        ])->assertCreated()->json('id');
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, '2026-07-01');

    // ACT + ASSERT — antes de fechar, os três dizem false
    $this->actingAs($adminDaClinica);
    $this->getJson("/api/atendimentos/{$cena['atendimento']->id}")
        ->assertOk()->assertJsonPath('em_ciclo_fechado', false);
    $this->getJson("/api/evolucoes/{$evolucao}")->assertOk()->assertJsonPath('em_ciclo_fechado', false);
    $this->getJson("/api/lancamentos/{$lancamento->id}")
        ->assertOk()->assertJsonPath('em_ciclo_fechado', false);

    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ...e depois, true nos três — pelas três competências distintas do D3
    $detalheAtendimento = $this->getJson("/api/atendimentos/{$cena['atendimento']->id}")->assertOk();
    $detalheAtendimento->assertJsonPath('em_ciclo_fechado', true);
    $this->getJson("/api/evolucoes/{$evolucao}")->assertOk()->assertJsonPath('em_ciclo_fechado', true);
    $this->getJson("/api/lancamentos/{$lancamento->id}")->assertOk()->assertJsonPath('em_ciclo_fechado', true);

    // o payload NÃO carrega o período, o calendário nem os fechamentos: só o veredito
    $detalheAtendimento->assertJsonMissingPath('periodo_inicio')
        ->assertJsonMissingPath('fechamentos')
        ->assertJsonMissingPath('ciclo_dia_corte');

    // ...e a LISTAGEM não o carrega (nem tem as ações que ele governa)
    $this->getJson("/api/atendimentos?agendamento_id={$cena['agendamento']->id}")
        ->assertOk()->assertJsonMissingPath('data.0.em_ciclo_fechado');
});

// ==================== 3.7 · o lock na MESMA transação da gravação ====================

it('deve travar a linha do convênio na MESMA transação em que grava o atendimento', function () {
    // ARRANGE — gatilho TEST-LOCK-EPOCH. Que a guarda RECUSE não prova nada sobre lock:
    // recusa sequencial funciona sem lock nenhum. O que precisa ser provado é que o
    // `select ... from convenios ... for update` e o `update atendimentos` rodam na MESMA
    // transação — travar numa transação curta e gravar noutra soltaria o lock no commit da
    // primeira e reabriria a janela do SEC-FC-10 entre os dois commits.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo(); // sem fechamento: o PUT precisa CHEGAR à gravação

    $capturar = capturarConsultasComEpoch();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/atendimentos/{$cena['atendimento']->id}",
        ['observacoes' => 'Observação fictícia.'],
    )->assertOk();

    // ASSERT
    $consultas = $capturar();
    $epochDoLock = epochDaConsulta($consultas, ['from `convenios`', 'for update']);
    $epochDaGravacao = epochDaConsulta($consultas, ['update `atendimentos` set']);

    expect($epochDoLock)->toBe(
        $epochDaGravacao,
        'O lock do convênio e a gravação do atendimento rodaram em transações DIFERENTES: o '
        .'lock cai no commit da primeira e a janela do SEC-FC-10 reabre entre os dois commits.'
    );

    // e a leitura dos fechamentos é TRAVANTE (sem isso o snapshot de REPEATABLE READ
    // esconderia o fechamento comitado por outra sessão — ver o docblock da guarda)
    expect(epochDaConsulta($consultas, ['from `fechamentos_ciclo`', 'for update']))
        ->toBe($epochDaGravacao);
});
