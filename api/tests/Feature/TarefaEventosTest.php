<?php

use App\Models\Tarefa;
use App\Models\TarefaNotificacao;

/**
 * Eventos direcionados do mural (change alertas-do-mural): atribuição, mudança
 * de coluna e comentário viram aviso no bloco `tarefas` do sino, com lido por
 * usuário. Dedup na gravação (design D3): autor nunca; mencionado sem
 * `comentario`; mesma coluna sem `status`. Dados 100% fictícios (LGPD).
 */

/** Troca o usuário autenticado no meio do teste (convenção da suite). */
function comoUsuario($teste, $usuario)
{
    $teste->flushSession();
    app('auth')->forgetGuards();

    return $teste->actingAs($usuario);
}

it('deve avisar quem foi adicionado aos responsáveis e silenciar o autor', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $colega = usuarioCom(['tarefas.ver'], 'Nível Colega Fictícia');

    // ACT — admin cria a tarefa já atribuída à colega
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia atribuída na criação',
        'responsaveis' => [$colega->id],
    ])->assertCreated()->json();

    // ASSERT — colega tem o evento; o autor da ação não recebe nada
    $bloco = comoUsuario($this, $colega)->getJson('/api/notificacoes')->json('tarefas');
    expect($bloco['eventos'])->toHaveCount(1)
        ->and($bloco['eventos'][0]['tipo'])->toBe('atribuicao')
        ->and($bloco['eventos'][0]['tarefa_id'])->toBe($tarefa['id'])
        ->and($bloco['eventos'][0]['autor'])->toBe($adminDaClinica->nome);
    $doAutor = comoUsuario($this, $adminDaClinica)->getJson('/api/notificacoes')->json('tarefas');
    expect($doAutor['eventos'])->toBe([]);
});

it('deve avisar criador e demais responsáveis na troca de coluna, exceto quem moveu', function () {
    // ARRANGE — criador + duas responsáveis; uma delas move pelo LOTE (o
    // caminho do arrastar — sem esta cobertura o caminho principal ficaria mudo)
    $adminDaClinica = admin();
    $movedora = usuarioCom(['tarefas.ver', 'tarefas.editar'], 'Nível Movedora Fictícia');
    $observadora = usuarioCom(['tarefas.ver'], 'Nível Observadora Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia que vai andar',
        'responsaveis' => [$movedora->id, $observadora->id],
    ])->assertCreated()->json();

    // ACT
    comoUsuario($this, $movedora)->patchJson('/api/tarefas/ordem', ['itens' => [
        ['id' => $tarefa['id'], 'coluna' => 'em_andamento', 'posicao' => 0],
    ]])->assertNoContent();

    // ASSERT — criador e a outra responsável recebem origem→destino; quem
    // moveu, não (as responsáveis guardam também a `atribuicao` da criação —
    // por isso o filtro por tipo)
    $doCriador = comoUsuario($this, $adminDaClinica)->getJson('/api/notificacoes')->json('tarefas');
    expect($doCriador['eventos'])->toHaveCount(1)
        ->and($doCriador['eventos'][0]['tipo'])->toBe('status')
        ->and($doCriador['eventos'][0]['dados'])->toBe(['de' => 'a_fazer', 'para' => 'em_andamento']);
    $daObservadora = comoUsuario($this, $observadora)->getJson('/api/notificacoes')->json('tarefas');
    expect(collect($daObservadora['eventos'])->where('tipo', 'status'))->toHaveCount(1);
    $daMovedora = comoUsuario($this, $movedora)->getJson('/api/notificacoes')->json('tarefas');
    expect(collect($daMovedora['eventos'])->where('tipo', 'status'))->toHaveCount(0);
});

it('deve avisar na troca de coluna pelo PATCH da tarefa', function () {
    // ARRANGE — o SEGUNDO caminho de mover (o lote é o do arrasto; este é o do
    // modal) — o delta exige evento nos DOIS (B1)
    $adminDaClinica = admin();
    $movedora = usuarioCom(['tarefas.ver', 'tarefas.editar'], 'Nível Editora Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia editada no modal',
        'responsaveis' => [$movedora->id],
    ])->assertCreated()->json();

    // ACT — a responsável conclui pelo PATCH unitário (If-Match da leitura)
    comoUsuario($this, $movedora)
        ->withHeader('If-Match', Tarefa::find($tarefa['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/{$tarefa['id']}", ['coluna' => 'concluida'])
        ->assertOk();

    // ASSERT — criador recebe origem→destino; quem moveu, não
    $doCriador = comoUsuario($this, $adminDaClinica)->getJson('/api/notificacoes')->json('tarefas');
    $eventosDeStatus = collect($doCriador['eventos'])->where('tipo', 'status')->values();
    expect($eventosDeStatus)->toHaveCount(1)
        ->and($eventosDeStatus[0]['dados'])->toBe(['de' => 'a_fazer', 'para' => 'concluida']);
    expect(TarefaNotificacao::where('usuario_id', $movedora->id)
        ->where('tipo', 'status')->count())->toBe(0);
});

it('deve dar só atribuição a quem entra na mesma edição que troca a coluna', function () {
    // ARRANGE — o evento de coluna dispara ANTES do sync de responsáveis
    // (decisão do design): quem entra agora não recebe `status` de graça
    $adminDaClinica = admin();
    $movedora = usuarioCom(['tarefas.ver', 'tarefas.editar'], 'Nível Movente Fictícia');
    $novata = usuarioCom(['tarefas.ver'], 'Nível Novata Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia que anda e ganha gente',
        'responsaveis' => [$movedora->id],
    ])->assertCreated()->json();

    // ACT — uma edição só: troca a coluna E adiciona a novata
    comoUsuario($this, $movedora)
        ->withHeader('If-Match', Tarefa::find($tarefa['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/{$tarefa['id']}", [
            'coluna' => 'em_andamento',
            'responsaveis' => [$movedora->id, $novata->id],
        ])->assertOk();

    // ASSERT — novata: SÓ `atribuicao`; criador: o `status`
    $daNovata = TarefaNotificacao::where('usuario_id', $novata->id)->pluck('tipo');
    expect($daNovata->all())->toBe(['atribuicao']);
    expect(TarefaNotificacao::where('usuario_id', $adminDaClinica->id)
        ->where('tipo', 'status')->count())->toBe(1);
});

it('não deve auto-notificar quando o payload manda o próprio id como string', function () {
    // ARRANGE — a regra `integer` aceita numeric-string: "7" chega string do
    // validated() e a comparação estrita deixaria o autor se auto-avisar (I1)
    $adminDaClinica = admin();
    $editora = usuarioCom(['tarefas.ver', 'tarefas.editar'], 'Nível Autônoma Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Demanda fictícia auto-assumida por edição',
    ])->assertCreated()->json();

    // ACT — a editora se adiciona mandando o PRÓPRIO id como string
    comoUsuario($this, $editora)
        ->withHeader('If-Match', Tarefa::find($tarefa['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/{$tarefa['id']}", [
            'responsaveis' => [(string) $editora->id],
        ])->assertOk();

    // ASSERT — quem se adiciona a si mesmo não é notificado
    expect(TarefaNotificacao::where('usuario_id', $editora->id)->count())->toBe(0);
});

it('deve levar os eventos junto ao excluir a tarefa', function () {
    // ARRANGE — atribuição gera evento pendente
    $adminDaClinica = admin();
    $responsavel = usuarioCom(['tarefas.ver'], 'Nível Efêmera Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia de vida curta', 'responsaveis' => [$responsavel->id],
    ])->assertCreated()->json();
    expect(TarefaNotificacao::query()
        ->where('tarefa_id', $tarefa['id'])->count())->toBe(1);

    // ACT
    $this->deleteJson("/api/tarefas/{$tarefa['id']}")->assertNoContent();

    // ASSERT — cascade provado no schema aplicado, não só declarado
    expect(TarefaNotificacao::query()
        ->where('tarefa_id', $tarefa['id'])->count())->toBe(0);
});

it('deve gerar evento no lote só para tarefa que trocou de coluna', function () {
    // ARRANGE — duas tarefas do criador, atribuídas à mesma responsável
    // (usuarioCom descarta a sessão — actingAs SEMPRE depois dele)
    $adminDaClinica = admin();
    $responsavel = usuarioCom(['tarefas.ver'], 'Nível Ocupada Fictícia');
    $this->actingAs($adminDaClinica);
    $anda = $this->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia que troca de coluna', 'responsaveis' => [$responsavel->id],
    ])->assertCreated()->json();
    $fica = $this->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia que só reposiciona', 'responsaveis' => [$responsavel->id],
    ])->assertCreated()->json();

    // ACT — lote misto: uma troca de coluna, outra só de posição
    $this->patchJson('/api/tarefas/ordem', ['itens' => [
        ['id' => $anda['id'], 'coluna' => 'aguardando', 'posicao' => 0],
        ['id' => $fica['id'], 'coluna' => 'a_fazer', 'posicao' => 0],
    ]])->assertNoContent();

    // ASSERT — um único evento, da tarefa que ANDOU (mesma coluna não é evento)
    $bloco = comoUsuario($this, $responsavel)->getJson('/api/notificacoes')->json('tarefas');
    $eventosDeStatus = collect($bloco['eventos'])->where('tipo', 'status')->values();
    expect($eventosDeStatus)->toHaveCount(1)
        ->and($eventosDeStatus[0]['tarefa_id'])->toBe($anda['id']);
});

it('deve avisar o criador quando a demanda aberta é assumida', function () {
    // ARRANGE — demanda sem responsável
    $adminDaClinica = admin();
    $voluntaria = usuarioCom(['tarefas.ver'], 'Nível Voluntária Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Demanda aberta fictícia',
    ])->assertCreated()->json();

    // ACT
    comoUsuario($this, $voluntaria)->postJson("/api/tarefas/{$tarefa['id']}/assumir")->assertOk();

    // ASSERT — criador sabe quem assumiu; quem assumiu não se auto-avisa
    $doCriador = comoUsuario($this, $adminDaClinica)->getJson('/api/notificacoes')->json('tarefas');
    expect($doCriador['eventos'])->toHaveCount(1)
        ->and($doCriador['eventos'][0]['tipo'])->toBe('atribuicao')
        ->and($doCriador['eventos'][0]['dados'])->toBe(['assumida' => true])
        ->and($doCriador['eventos'][0]['autor'])->toBe($voluntaria->nome);
    expect(TarefaNotificacao::where('usuario_id', $voluntaria->id)->count())->toBe(0);
});

it('não deve gerar evento quando o criador assume a própria demanda', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $tarefa = $this->postJson('/api/tarefas', ['titulo' => 'Demanda própria fictícia'])
        ->assertCreated()->json();

    // ACT
    $this->postJson("/api/tarefas/{$tarefa['id']}/assumir")->assertOk();

    // ASSERT
    expect(TarefaNotificacao::count())->toBe(0);
});

it('deve avisar envolvidos do comentário sem menção, poupando autor e mencionada', function () {
    // ARRANGE — criador + duas responsáveis
    $adminDaClinica = admin();
    $comentarista = usuarioCom(['tarefas.ver'], 'Nível Comentarista Fictícia');
    $mencionada = usuarioCom(['tarefas.ver'], 'Nível Marcada Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia com conversa',
        'responsaveis' => [$comentarista->id, $mencionada->id],
    ])->assertCreated()->json();

    // ACT — a comentarista escreve mencionando a colega
    comoUsuario($this, $comentarista)->postJson("/api/tarefas/{$tarefa['id']}/comentarios", [
        'corpo' => 'Comentário fictício da conversa.', 'mencoes' => [$mencionada->id],
    ])->assertCreated();

    // ASSERT — criador recebe `comentario`; a mencionada fica com a MENÇÃO
    // (evento duplicado é ruído); a autora nada
    $doCriador = comoUsuario($this, $adminDaClinica)->getJson('/api/notificacoes')->json('tarefas');
    $tiposDoCriador = collect($doCriador['eventos'])->pluck('tipo');
    expect($tiposDoCriador->filter(fn ($t) => $t === 'comentario'))->toHaveCount(1);
    $daMencionada = comoUsuario($this, $mencionada)->getJson('/api/notificacoes')->json('tarefas');
    expect(collect($daMencionada['eventos'])->where('tipo', 'comentario'))->toHaveCount(0)
        ->and($daMencionada['mencoes'])->toHaveCount(1);
    expect(TarefaNotificacao::where('usuario_id', $comentarista->id)
        ->where('tipo', 'comentario')->count())->toBe(0);
});

it('deve marcar lidos por tarefa só do leitor, de forma idempotente', function () {
    // ARRANGE — duas responsáveis com o mesmo evento de conclusão
    $adminDaClinica = admin();
    $leitora = usuarioCom(['tarefas.ver'], 'Nível Leitora Fictícia');
    $desatenta = usuarioCom(['tarefas.ver'], 'Nível Desatenta Fictícia');
    $tarefa = $this->actingAs($adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia concluída em silêncio? Não mais.',
        'responsaveis' => [$leitora->id, $desatenta->id],
    ])->assertCreated()->json();
    $this->patchJson('/api/tarefas/ordem', ['itens' => [
        ['id' => $tarefa['id'], 'coluna' => 'concluida', 'posicao' => 0],
    ]])->assertNoContent();

    // ACT — a leitora abre a tarefa (duas vezes: idempotente)
    comoUsuario($this, $leitora)->postJson("/api/tarefas/{$tarefa['id']}/eventos/ler")->assertNoContent();
    $this->postJson("/api/tarefas/{$tarefa['id']}/eventos/ler")->assertNoContent();

    // ASSERT — só os eventos DELA zeram
    $daLeitora = $this->getJson('/api/notificacoes')->json('tarefas');
    expect(collect($daLeitora['eventos'])->where('tipo', 'status'))->toHaveCount(0);
    $daDesatenta = comoUsuario($this, $desatenta)->getJson('/api/notificacoes')->json('tarefas');
    expect(collect($daDesatenta['eventos'])->where('tipo', 'status'))->toHaveCount(1);
});

it('deve marcar todos os eventos do usuário no ler-todos', function () {
    // ARRANGE — eventos de duas tarefas para a mesma responsável
    $adminDaClinica = admin();
    $responsavel = usuarioCom(['tarefas.ver'], 'Nível Sobrecarregada Fictícia');
    $this->actingAs($adminDaClinica);
    foreach (['Primeira tarefa fictícia', 'Segunda tarefa fictícia'] as $titulo) {
        $this->postJson('/api/tarefas', [
            'titulo' => $titulo, 'responsaveis' => [$responsavel->id],
        ])->assertCreated();
    }

    // ACT
    comoUsuario($this, $responsavel)->postJson('/api/tarefas/eventos/ler-todos')->assertNoContent();

    // ASSERT — bloco sem eventos; as atribuições em aberto continuam (estado ≠ evento)
    $bloco = $this->getJson('/api/notificacoes')->json('tarefas');
    expect($bloco['eventos'])->toBe([])->and($bloco['minhas'])->toHaveCount(2);
});

it('deve responder 404 para eventos de tarefa inexistente e exigir tarefas.ver', function () {
    // ARRANGE — usuários TODOS antes de qualquer request: o middleware Sanctum
    // troca o guard default e o usuarioCom passa a falhar (GuardDoesNotMatch)
    $adminDaClinica = admin();
    $responsavel = usuarioCom(['tarefas.ver'], 'Nível Isolada Fictícia');
    $semMural = usuarioCom([], 'Nível Sem Mural Fictício');
    comoUsuario($this, $adminDaClinica)->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia', 'responsaveis' => [$responsavel->id],
    ])->assertCreated();

    // ACT + ASSERT — tarefa inexistente é 404; sem permissão, 403
    comoUsuario($this, $adminDaClinica)
        ->postJson('/api/tarefas/999999/eventos/ler')->assertNotFound();
    comoUsuario($this, $semMural)
        ->postJson('/api/tarefas/eventos/ler-todos')->assertForbidden();
    expect(TarefaNotificacao::query()
        ->where('usuario_id', $responsavel->id)->whereNull('lida_em')->count())->toBe(1);
});
