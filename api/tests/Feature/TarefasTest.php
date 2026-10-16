<?php

use App\Models\Auditoria;
use App\Models\NivelPermissao;
use App\Models\Tarefa;
use App\Models\TarefaComentario;
use App\Models\Usuario;
use Database\Seeders\CatalogoPermissoesSeeder;
use Spatie\Permission\PermissionRegistrar;

/** Tarefa fictícia criada pela API (dados 100% inventados — LGPD). */
function tarefaFicticia(array $extras = []): array
{
    return test()->postJson('/api/tarefas', array_merge([
        'titulo' => 'Organizar arquivo fictício da recepção',
    ], $extras))->assertCreated()->json();
}

it('deve listar o quadro ordenado por coluna e posição, com contadores', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    tarefaFicticia(['titulo' => 'Primeira do a_fazer']);
    tarefaFicticia(['titulo' => 'Segunda do a_fazer']);
    tarefaFicticia(['titulo' => 'Do aguardando', 'coluna' => 'aguardando']);

    // ACT
    $quadro = $this->getJson('/api/tarefas');

    // ASSERT — plana, ordenada, com posição densa nascendo no FIM da coluna
    $quadro->assertOk();
    $doAFazer = collect($quadro->json())->where('coluna', 'a_fazer')->values();
    expect($doAFazer->pluck('titulo')->all())->toBe(['Primeira do a_fazer', 'Segunda do a_fazer'])
        ->and($doAFazer->pluck('posicao')->all())->toBe([0, 1])
        ->and($quadro->json('0'))->toHaveKeys([
            'id', 'titulo', 'coluna', 'prioridade', 'posicao', 'responsaveis',
            'comentarios_count', 'comentarios_nao_lidos_count', 'updated_at',
        ]);
});

it('deve negar o quadro a quem não tem tarefas.ver', function () {
    // ARRANGE
    admin();
    $semPermissao = usuarioCom([], 'Nível Sem Mural Fictício');

    // ACT + ASSERT
    $this->actingAs($semPermissao)->getJson('/api/tarefas')->assertForbidden();
});

it('deve recusar coluna e prioridade fora do domínio', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT + ASSERT — domínio é validação, nunca ENUM de banco (design D1)
    $this->postJson('/api/tarefas', ['titulo' => 'Tarefa fictícia', 'coluna' => 'revisao'])
        ->assertUnprocessable()->assertJsonValidationErrors('coluna');
    $this->postJson('/api/tarefas', ['titulo' => 'Tarefa fictícia', 'prioridade' => 'critica'])
        ->assertUnprocessable()->assertJsonValidationErrors('prioridade');
});

it('deve criar a tarefa mínima no fim da coluna com autor carimbado pelo servidor', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);

    // ACT
    $tarefa = tarefaFicticia();

    // ASSERT — defaults e server-set
    expect($tarefa['coluna'])->toBe('a_fazer')
        ->and($tarefa['prioridade'])->toBe('media')
        ->and($tarefa['posicao'])->toBe(0)
        ->and($tarefa['responsaveis'])->toBe([])
        ->and(Tarefa::find($tarefa['id'])->criado_por)->toBe($adminDaClinica->id);
});

it('deve recusar responsável inexistente ou inativo com 422', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $inativo = Usuario::factory()->create([
        'ativo' => false,
    ]);

    // ACT + ASSERT
    $this->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia', 'responsaveis' => [999999],
    ])->assertUnprocessable();
    $this->postJson('/api/tarefas', [
        'titulo' => 'Tarefa fictícia', 'responsaveis' => [$inativo->id],
    ])->assertUnprocessable();
    expect(Tarefa::count())->toBe(0);
});

it('deve carimbar concluida_em ao concluir e limpar ao voltar', function () {
    // ARRANGE
    $this->actingAs(admin());
    $tarefa = tarefaFicticia();

    // ACT — concluir
    $concluida = $this->withHeader('If-Match', Tarefa::find($tarefa['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/{$tarefa['id']}", ['coluna' => 'concluida']);

    // ASSERT
    $concluida->assertOk();
    expect($concluida->json('concluida_em'))->not->toBeNull();

    // ACT — voltar para o quadro limpa o carimbo
    $reaberta = $this->withHeader('If-Match', Tarefa::find($tarefa['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/{$tarefa['id']}", ['coluna' => 'em_andamento']);
    $reaberta->assertOk();
    expect($reaberta->json('concluida_em'))->toBeNull();
});

it('deve limpar responsáveis com lista vazia e preservar com chave ausente', function () {
    // ARRANGE — correção consciente do original (spec tarefas)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $colega = Usuario::factory()->create();
    $tarefa = tarefaFicticia(['responsaveis' => [$colega->id]]);
    expect(collect($tarefa['responsaveis'])->pluck('id')->all())->toBe([$colega->id]);

    // ACT — chave AUSENTE preserva
    $semAChave = $this->withHeader('If-Match', Tarefa::find($tarefa['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/{$tarefa['id']}", ['titulo' => 'Título fictício editado']);
    expect(collect($semAChave->json('responsaveis'))->pluck('id')->all())->toBe([$colega->id]);

    // ACT — lista VAZIA limpa (vira demanda aberta)
    $limpa = $this->withHeader('If-Match', Tarefa::find($tarefa['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/{$tarefa['id']}", ['responsaveis' => []]);
    expect($limpa->json('responsaveis'))->toBe([]);
});

it('deve exigir If-Match na edição de tarefa', function () {
    // ARRANGE
    $this->actingAs(admin());
    $tarefa = tarefaFicticia();

    // ACT + ASSERT — sem token 428; token divergente 409 (SEC-OCC)
    $this->patchJson("/api/tarefas/{$tarefa['id']}", ['titulo' => 'Sem versão fictícia'])
        ->assertStatus(428);
    $this->withHeader('If-Match', '2020-01-01T00:00:00.000000Z')
        ->patchJson("/api/tarefas/{$tarefa['id']}", ['titulo' => 'Versão velha fictícia'])
        ->assertStatus(409);
});

it('deve reordenar em lote com posições densas e recusar id estranho atomicamente', function () {
    // ARRANGE — 3 cartões em a_fazer
    $this->actingAs(admin());
    $a = tarefaFicticia(['titulo' => 'Cartão A fictício']);
    $b = tarefaFicticia(['titulo' => 'Cartão B fictício']);
    $c = tarefaFicticia(['titulo' => 'Cartão C fictício']);

    // ACT — B vai para o topo; C muda de coluna
    $this->patchJson('/api/tarefas/ordem', ['itens' => [
        ['id' => $b['id'], 'coluna' => 'a_fazer', 'posicao' => 0],
        ['id' => $a['id'], 'coluna' => 'a_fazer', 'posicao' => 1],
        ['id' => $c['id'], 'coluna' => 'em_andamento', 'posicao' => 0],
    ]])->assertNoContent();

    // ASSERT — denso 0..n-1 por coluna
    expect(Tarefa::find($b['id'])->posicao)->toBe(0)
        ->and(Tarefa::find($a['id'])->posicao)->toBe(1)
        ->and(Tarefa::find($c['id'])->only(['coluna', 'posicao']))
        ->toBe(['coluna' => 'em_andamento', 'posicao' => 0]);

    // ACT + ASSERT — id inexistente: 422 e NADA muda
    $this->patchJson('/api/tarefas/ordem', ['itens' => [
        ['id' => $a['id'], 'coluna' => 'aguardando', 'posicao' => 0],
        ['id' => 999999, 'coluna' => 'a_fazer', 'posicao' => 0],
    ]])->assertUnprocessable();
    expect(Tarefa::find($a['id'])->coluna)->toBe('a_fazer');
});

it('deve deixar a movimentação de coluna na trilha de auditoria', function () {
    // ARRANGE
    $this->actingAs(admin());
    $tarefa = tarefaFicticia();

    // ACT — mover pela reordenação em lote (o caminho do arrasto)
    $this->patchJson('/api/tarefas/ordem', ['itens' => [
        ['id' => $tarefa['id'], 'coluna' => 'aguardando', 'posicao' => 0],
    ]])->assertNoContent();

    // ASSERT — diff coluna antes → depois na trilha
    $registro = Auditoria::where('entidade', 'tarefas')
        ->where('entidade_id', $tarefa['id'])->where('acao', 'atualizou')->latest('id')->first();
    expect($registro)->not->toBeNull()
        ->and($registro->diff_json['antes']['coluna'])->toBe('a_fazer')
        ->and($registro->diff_json['depois']['coluna'])->toBe('aguardando');
});

it('deve permitir assumir demanda aberta só com tarefas.ver, de forma idempotente', function () {
    // ARRANGE — demanda aberta criada pelo admin; quem assume só tem tarefas.ver
    $adminDaClinica = admin();
    $participante = usuarioCom(['tarefas.ver'], 'Nível Participante Fictício');
    $this->actingAs($adminDaClinica);
    $tarefa = tarefaFicticia();

    // ACT — assumir 2× (idempotente)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $primeira = $this->actingAs($participante)->postJson("/api/tarefas/{$tarefa['id']}/assumir");
    $segunda = $this->postJson("/api/tarefas/{$tarefa['id']}/assumir");

    // ASSERT — vira responsável UMA vez
    $primeira->assertOk();
    $segunda->assertOk();
    expect(collect($segunda->json('responsaveis'))->pluck('id')->all())->toBe([$participante->id]);
});

it('deve recusar assumir demanda que já tem dono e tarefa arquivada', function () {
    // ARRANGE — tarefa com dono (o admin) e uma arquivada
    $adminDaClinica = admin();
    $participante = usuarioCom(['tarefas.ver'], 'Nível Segundo Fictício');
    $this->actingAs($adminDaClinica);
    $comDono = tarefaFicticia(['responsaveis' => [$adminDaClinica->id]]);
    $arquivada = tarefaFicticia(['coluna' => 'concluida']);
    $this->postJson("/api/tarefas/{$arquivada['id']}/arquivar")->assertOk();

    // ACT + ASSERT — juntar-se é edição de responsáveis, não assumir (SEC-KB-01)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($participante)
        ->postJson("/api/tarefas/{$comDono['id']}/assumir")->assertUnprocessable();
    $this->postJson("/api/tarefas/{$arquivada['id']}/assumir")->assertUnprocessable();
    expect(collect($this->getJson("/api/tarefas/{$comDono['id']}")->json('responsaveis'))
        ->pluck('id')->all())->toBe([$adminDaClinica->id]);
});

it('deve versionar a tarefa no assumir — edição concorrente leva 409', function () {
    // ARRANGE — o admin abre o formulário (lê o token) ANTES do assumir da colega
    $adminDaClinica = admin();
    $participante = usuarioCom(['tarefas.ver'], 'Nível Concorrente Fictícia');
    $this->actingAs($adminDaClinica);
    $tarefa = tarefaFicticia();
    $tokenAntigo = Tarefa::find($tarefa['id'])->updated_at->toJSON();

    // updated_at tem precisão de SEGUNDO: sem atravessar a fronteira, o touch
    // do assumir cai no mesmo instante e o token ainda confere (resíduo de
    // precisão que vale para o produto inteiro — formulário real leva minutos)
    $this->travel(2)->seconds();

    // ACT — a colega assume no meio da edição
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($participante)->postJson("/api/tarefas/{$tarefa['id']}/assumir")->assertOk();

    // ASSERT — salvar por cima com o token velho é 409, e a atribuição sobrevive
    // (CR-KB-02: sem o touch, este PATCH apagaria a colega em silêncio)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)
        ->withHeader('If-Match', $tokenAntigo)
        ->patchJson("/api/tarefas/{$tarefa['id']}", ['responsaveis' => []])
        ->assertStatus(409);
    expect(collect(Tarefa::find($tarefa['id'])->responsaveis()->pluck('usuarios.id'))->all())
        ->toBe([$participante->id]);
});

it('deve recusar edição de tarefa arquivada', function () {
    // ARRANGE — arquivada implica concluída; editar coluna quebraria o invariante
    $this->actingAs(admin());
    $tarefa = tarefaFicticia(['coluna' => 'concluida']);
    $this->postJson("/api/tarefas/{$tarefa['id']}/arquivar")->assertOk();

    // ACT + ASSERT (CR-KB-07)
    $this->withHeader('If-Match', Tarefa::find($tarefa['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/{$tarefa['id']}", ['coluna' => 'a_fazer'])
        ->assertUnprocessable();
    expect(Tarefa::find($tarefa['id'])->coluna)->toBe('concluida');
});

it('deve arquivar apenas concluída, tirar do quadro e voltar ao desarquivar', function () {
    // ARRANGE
    $this->actingAs(admin());
    $tarefa = tarefaFicticia();

    // ACT + ASSERT — fora de concluida é 422
    $this->postJson("/api/tarefas/{$tarefa['id']}/arquivar")->assertUnprocessable();

    // concluir e arquivar
    $this->withHeader('If-Match', Tarefa::find($tarefa['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/{$tarefa['id']}", ['coluna' => 'concluida'])->assertOk();
    $this->postJson("/api/tarefas/{$tarefa['id']}/arquivar")->assertOk();

    // some da listagem padrão; aparece só em ?arquivadas=1
    expect(collect($this->getJson('/api/tarefas')->json())->pluck('id'))->not->toContain($tarefa['id']);
    expect(collect($this->getJson('/api/tarefas?arquivadas=1')->json())->pluck('id'))->toContain($tarefa['id']);

    // desarquivar devolve a concluida
    $deVolta = $this->postJson("/api/tarefas/{$tarefa['id']}/desarquivar");
    $deVolta->assertOk();
    expect($deVolta->json('coluna'))->toBe('concluida')
        ->and($deVolta->json('arquivada_em'))->toBeNull();
});

it('deve excluir a tarefa com os comentários e deixar trilha', function () {
    // ARRANGE
    $this->actingAs(admin());
    $tarefa = tarefaFicticia();
    $this->postJson("/api/tarefas/{$tarefa['id']}/comentarios", [
        'corpo' => 'Comentário fictício que cai junto.',
    ])->assertCreated();

    // ACT
    $this->deleteJson("/api/tarefas/{$tarefa['id']}")->assertNoContent();

    // ASSERT — dependentes caem e a exclusão fica na trilha
    expect(Tarefa::find($tarefa['id']))->toBeNull()
        ->and(TarefaComentario::where('tarefa_id', $tarefa['id'])->count())->toBe(0)
        ->and(Auditoria::where('entidade', 'tarefas')
            ->where('entidade_id', $tarefa['id'])->where('acao', 'excluiu')->exists())->toBeTrue();
});

it('deve gravar menção válida, descartar id estranho e ignorar auto-menção', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $colega = Usuario::factory()->create([
        'nome' => 'Colega Fictícia',
    ]);
    $tarefa = tarefaFicticia();

    // ACT — menção ao colega + a si mesmo + a um id que não existe
    $comentario = $this->postJson("/api/tarefas/{$tarefa['id']}/comentarios", [
        'corpo' => 'Chamando @Colega Fictícia para esta tarefa fictícia.',
        'mencoes' => [$colega->id, $adminDaClinica->id, 999999],
    ]);

    // ASSERT — só a menção válida sobrevive (descarte em silêncio — spec)
    $comentario->assertCreated();
    expect(collect($comentario->json('mencionados'))->pluck('id')->all())->toBe([$colega->id]);
});

it('deve zerar os não lidos de quem lê, sem afetar os demais', function () {
    // ARRANGE — autor comenta; a colega ainda não leu
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $colega = usuarioCom(['tarefas.ver'], 'Nível Leitora Fictícia');
    $this->actingAs($adminDaClinica);
    $tarefa = tarefaFicticia();
    $this->actingAs($adminDaClinica)->postJson("/api/tarefas/{$tarefa['id']}/comentarios", [
        'corpo' => 'Novidade fictícia no mural.',
    ])->assertCreated();

    // o AUTOR não conta o próprio comentário como não lido
    $doAutor = collect($this->getJson('/api/tarefas')->json())->firstWhere('id', $tarefa['id']);
    expect($doAutor['comentarios_nao_lidos_count'])->toBe(0);

    // a colega vê 1 não lido…
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $daColega = collect($this->actingAs($colega)->getJson('/api/tarefas')->json())
        ->firstWhere('id', $tarefa['id']);
    expect($daColega['comentarios_nao_lidos_count'])->toBe(1);

    // ACT — abrir os comentários carimba a leitura DELA
    $this->getJson("/api/tarefas/{$tarefa['id']}/comentarios")->assertOk();

    // ASSERT
    $depoisDeLer = collect($this->getJson('/api/tarefas')->json())->firstWhere('id', $tarefa['id']);
    expect($depoisDeLer['comentarios_nao_lidos_count'])->toBe(0);
});

it('deve deixar editar comentário só ao autor e moderar exclusão pelo tarefas.excluir', function () {
    // ARRANGE — comentário da participante; admin tenta editar (403) e exclui (modera)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $participante = usuarioCom(['tarefas.ver'], 'Nível Comentarista Fictício');
    $this->actingAs($adminDaClinica);
    $tarefa = tarefaFicticia();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $comentario = $this->actingAs($participante)
        ->postJson("/api/tarefas/{$tarefa['id']}/comentarios", ['corpo' => 'Fala fictícia da autora.'])
        ->assertCreated()->json();

    // ACT + ASSERT — editar de terceiro é SEMPRE 403 (mesmo com tarefas.excluir)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)
        ->withHeader('If-Match', TarefaComentario::find($comentario['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/comentarios/{$comentario['id']}", ['corpo' => 'Reescrita indevida.'])
        ->assertForbidden();

    // o autor edita o próprio
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($participante)
        ->withHeader('If-Match', TarefaComentario::find($comentario['id'])->updated_at->toJSON())
        ->patchJson("/api/tarefas/comentarios/{$comentario['id']}", ['corpo' => 'Fala fictícia corrigida.'])
        ->assertOk();

    // participante sem tarefas.excluir não apaga comentário alheio
    $doAdmin = $this->actingAs($adminDaClinica)
        ->postJson("/api/tarefas/{$tarefa['id']}/comentarios", ['corpo' => 'Comentário fictício do admin.'])
        ->json();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($participante)
        ->deleteJson("/api/tarefas/comentarios/{$doAdmin['id']}")->assertForbidden();

    // moderação: admin (tarefas.excluir) apaga o de terceiro
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/tarefas/comentarios/{$comentario['id']}")->assertNoContent();
});

it('deve listar participantes com payload mínimo e sem inativos', function () {
    // ARRANGE — quem lista NÃO tem usuarios.ver
    $adminDaClinica = admin();
    Usuario::factory()->create([
        'nome' => 'Ativa Fictícia',
    ]);
    Usuario::factory()->create([
        'nome' => 'Inativa Fictícia', 'ativo' => false,
    ]);
    $participante = usuarioCom(['tarefas.ver'], 'Nível Só Mural Fictício');

    // ACT
    $lista = $this->actingAs($participante)->getJson('/api/tarefas/usuarios');

    // ASSERT — id+nome apenas; inativa fora
    $lista->assertOk();
    expect(collect($lista->json())->pluck('nome'))->toContain('Ativa Fictícia')
        ->and(collect($lista->json())->pluck('nome'))->not->toContain('Inativa Fictícia')
        ->and(array_keys($lista->json('0')))->toBe(['id', 'nome']);
    semVazamento($lista->json(), '@'); // nenhum e-mail no payload
});

it('deve incluir o módulo tarefas no catálogo e ressincronizar a clínica existente', function () {
    // ARRANGE — clínica "antiga" cujo Administrador perdeu o módulo (delta rbac)
    $adminDaClinica = admin();
    $administrador = NivelPermissao::query()
        ->where('name', 'Administrador')->firstOrFail();
    $administrador->revokePermissionTo('tarefas.ver');
    app(PermissionRegistrar::class)->forgetCachedPermissions();
    expect($adminDaClinica->fresh()->can('tarefas.ver'))->toBeFalse();

    // ACT
    $this->seed(CatalogoPermissoesSeeder::class);

    // ASSERT — as quatro permissões do módulo, de volta
    $recarregado = $adminDaClinica->fresh()->unsetRelation('roles')->unsetRelation('permissions');
    foreach (['tarefas.ver', 'tarefas.criar', 'tarefas.editar', 'tarefas.excluir'] as $permissao) {
        expect($recarregado->can($permissao))->toBeTrue();
    }
});
