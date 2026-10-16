<?php

/**
 * Bloco `tarefas` do centro (kanban-da-equipe, design D5): ESTADO ATUAL do
 * próprio usuário — minhas em aberto, menções não lidas, demandas abertas.
 */
it('deve contar minhas tarefas em aberto e tirar do bloco ao concluir', function () {
    // ARRANGE — tarefa atribuída à participante
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $participante = usuarioCom(['tarefas.ver'], 'Nível Responsável Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia atribuída', 'responsaveis' => [$participante->id],
    ])->assertCreated()->json();

    // ACT + ASSERT — aparece no bloco DELA com link para a tarefa
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $bloco = $this->actingAs($participante)->getJson('/api/notificacoes')->json('tarefas');
    // total = minhas (1) + evento `atribuicao` da criação (1) — alertas-do-mural
    expect(collect($bloco['minhas'])->pluck('id'))->toContain($tarefa['id'])
        ->and($bloco['total'])->toBe(2);

    // concluir tira de "minhas" — mas NÃO some em silêncio: vira evento não
    // lido (change alertas-do-mural)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)->patchJson('/api/tarefas/ordem', ['itens' => [
        ['id' => $tarefa['id'], 'coluna' => 'concluida', 'posicao' => 0],
    ]])->assertNoContent();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $depois = $this->actingAs($participante)->getJson('/api/notificacoes')->json('tarefas');
    expect($depois['minhas'])->toBe([])
        ->and(collect($depois['eventos'])->where('tipo', 'status'))->toHaveCount(1)
        ->and($depois['total'])->toBe(count($depois['eventos']));
});

it('deve contar menção não lida e zerar quando a mencionada lê', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $mencionada = usuarioCom(['tarefas.ver'], 'Nível Mencionada Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia com conversa',
    ])->assertCreated()->json();
    $this->postJson("/api/tarefas/{$tarefa['id']}/comentarios", [
        'corpo' => 'Chamando a colega fictícia.', 'mencoes' => [$mencionada->id],
    ])->assertCreated();

    // ACT + ASSERT — menção conta no bloco dela
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $bloco = $this->actingAs($mencionada)->getJson('/api/notificacoes')->json('tarefas');
    expect($bloco['mencoes'])->toHaveCount(1)
        ->and($bloco['mencoes'][0]['tarefa_id'])->toBe($tarefa['id']);

    // ler os comentários zera a menção (mesmo carimbo dos não lidos — D7)
    $this->getJson("/api/tarefas/{$tarefa['id']}/comentarios")->assertOk();
    $depois = $this->getJson('/api/notificacoes')->json('tarefas');
    expect($depois['mencoes'])->toBe([]);
});

it('deve mostrar demanda aberta a todos com tarefas.ver até alguém assumir', function () {
    // ARRANGE — demanda sem responsável
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $participante = usuarioCom(['tarefas.ver'], 'Nível Vigilante Fictício');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Demanda aberta fictícia',
    ])->assertCreated()->json();

    // ACT + ASSERT — conta para outro usuário da clínica
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $bloco = $this->actingAs($participante)->getJson('/api/notificacoes')->json('tarefas');
    expect(collect($bloco['demandas_abertas'])->pluck('id'))->toContain($tarefa['id']);

    // assumir move de demanda para "minhas"
    $this->postJson("/api/tarefas/{$tarefa['id']}/assumir")->assertOk();
    $depois = $this->getJson('/api/notificacoes')->json('tarefas');
    expect($depois['demandas_abertas'])->toBe([])
        ->and(collect($depois['minhas'])->pluck('id'))->toContain($tarefa['id']);
});

it('deve omitir o bloco tarefas sem a permissão do módulo', function () {
    // ARRANGE — bloco AUSENTE, nunca zerado (T-not-01)
    admin();
    $semMural = usuarioCom([], 'Nível Sem Tarefas Fictício');

    // ACT + ASSERT
    $centro = $this->actingAs($semMural)->getJson('/api/notificacoes');
    $centro->assertOk();
    expect($centro->json())->not->toHaveKey('tarefas');
});
