<?php

use App\Models\Auditoria;
use App\Models\NivelPermissao;
use App\Models\Paciente;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use App\Support\Auditoria\RegistroDeAuditoria;
use App\Support\Auditoria\RotulosDeAuditoria;

it('deve auditar a criação com os valores novos', function () {
    // ACT
    $usuario = Usuario::factory()->create(['nome' => 'Operadora Fictícia']);

    // ASSERT
    $registro = Auditoria::where('entidade', 'usuarios')
        ->where('entidade_id', $usuario->id)
        ->where('acao', 'criou')
        ->firstOrFail();

    expect($registro->diff_json['depois']['nome'])->toBe('Operadora Fictícia');
});

it('deve auditar alteração apenas com os campos que mudaram', function () {
    // ARRANGE
    $usuario = Usuario::factory()->create(['nome' => 'Nome Antigo']);

    // ACT
    $usuario->update(['nome' => 'Nome Novo']);

    // ASSERT
    $registro = Auditoria::where('entidade', 'usuarios')
        ->where('entidade_id', $usuario->id)
        ->where('acao', 'atualizou')
        ->firstOrFail();

    expect($registro->diff_json['antes'])->toBe(['nome' => 'Nome Antigo'])
        ->and($registro->diff_json['depois'])->toBe(['nome' => 'Nome Novo']);
});

it('deve auditar exclusão com os valores antigos', function () {
    // ARRANGE
    $usuario = Usuario::factory()->create(['nome' => 'Quem Saiu']);

    // ACT
    $usuario->delete();

    // ASSERT
    $registro = Auditoria::where('entidade', 'usuarios')
        ->where('acao', 'excluiu')
        ->where('entidade_id', $usuario->id)
        ->firstOrFail();

    expect($registro->diff_json['antes']['nome'])->toBe('Quem Saiu');
});

it('deve registrar autor e ip em mutação via http', function () {
    // ARRANGE — abuse case: trilha sem autoria é buraco de repúdio (T-aud-03)
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/niveis-permissao', [
        'nome' => 'Recepção',
        'permissoes' => [],
    ])->assertCreated();

    // ASSERT
    $registro = Auditoria::where('entidade', 'roles')->where('acao', 'criou')
        ->orderByDesc('id')->firstOrFail();

    expect($registro->usuario_id)->toBe($adminDaClinica->id)
        ->and($registro->ip)->not->toBeNull();
});

it('deve mascarar a senha no diff de auditoria', function () {
    // ARRANGE — abuse case 12
    $usuario = Usuario::factory()->create();

    // ACT
    $usuario->update(['senha_hash' => 'senha-nova-456']);

    // ASSERT
    $registro = Auditoria::where('entidade', 'usuarios')
        ->where('entidade_id', $usuario->id)
        ->where('acao', 'atualizou')
        ->firstOrFail();

    expect($registro->diff_json['depois']['senha_hash'])->toBe('***')
        ->and($registro->diff_json['antes']['senha_hash'])->toBe('***')
        ->and(json_encode($registro->diff_json))->not->toContain('senha-nova-456');
});

it('deve registrar usuario e ip nulos fora de request http', function () {
    // ARRANGE — operação de "console": sem rota, sem usuário autenticado
    $usuario = Usuario::factory()->create();

    // ACT (a própria criação acima rodou fora de rota HTTP)
    $registro = Auditoria::where('entidade', 'usuarios')
        ->where('entidade_id', $usuario->id)
        ->where('acao', 'criou')
        ->firstOrFail();

    // ASSERT
    expect($registro->usuario_id)->toBeNull()
        ->and($registro->ip)->toBeNull();
});

it('deve auditar a atribuição de nível a usuário', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $colega = Usuario::factory()->create();
    $recepcao = NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);

    // ACT
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/usuarios/{$colega->id}/nivel-permissao", [
            'nivel_permissao_id' => $recepcao->id,
        ])->assertOk();

    // ASSERT
    $registro = Auditoria::where('acao', 'atribuiu_nivel')
        ->where('entidade_id', $colega->id)
        ->firstOrFail();

    expect($registro->diff_json['depois']['nivel_permissao'])->toBe('Recepção');
});

it('deve ser imutável via api', function () {
    // ARRANGE — abuse case 8
    $adminDaClinica = admin();
    Usuario::factory()->create();
    $registro = Auditoria::firstOrFail();

    // ACT + ASSERT — nenhuma rota de escrita existe
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/auditoria/{$registro->id}", ['acao' => 'adulterada'])
        ->assertNotFound();
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/auditoria/{$registro->id}")
        ->assertNotFound();
    $this->actingAs($adminDaClinica)
        ->postJson('/api/auditoria', [])
        ->assertStatus(405);

    expect(Auditoria::whereKey($registro->id)->where('acao', 'adulterada')->exists())->toBeFalse();
});

it('deve consultar auditoria com filtro por entidade', function () {
    // ARRANGE — um usuário criado (trilha em `usuarios`) e um paciente (trilha em `pacientes`)
    $adminDaClinica = admin();
    $usuario = Usuario::factory()->create(['nome' => 'Operadora Fictícia da Trilha']);
    $paciente = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/auditoria?entidade=usuarios');

    // ASSERT — só a trilha da entidade pedida
    $resposta->assertOk();
    $linhas = collect($resposta->json('data'));
    expect($linhas->pluck('entidade_id'))->toContain($usuario->id)
        ->and($linhas->pluck('entidade')->unique()->values()->all())->toBe(['usuarios']);
});

it('deve negar consulta de auditoria sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/auditoria')->assertForbidden();
});

it('deve incluir o próprio dia no filtro ate', function () {
    // ARRANGE — registro criado agora (hoje)
    $adminDaClinica = admin();
    Usuario::factory()->create();
    $hoje = now()->toDateString();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/auditoria?entidade=usuarios&ate={$hoje}");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('total'))->toBeGreaterThan(0);
});

it('deve não auditar a própria auditoria', function () {
    // ARRANGE — a contagem é tirada DEPOIS de todo fixture: a asserção mede só a escrita
    // que o teste faz
    Usuario::factory()->create();
    $totalAntes = Auditoria::count();

    // ACT — criar um registro de auditoria não gera registro sobre auditoria
    Auditoria::create([
        // fixture fabricado à mão: `autor_tipo` é NOT NULL sem default de propósito, para que
        // uma escrita fora da fonte única (`RegistroDeAuditoria`) não passe em silêncio
        'autor_tipo' => 'sistema',
        'entidade' => 'itens_teste',
        'entidade_id' => 1,
        'acao' => 'criou',
        'diff_json' => ['depois' => []],
        'criado_em' => now(),
    ]);

    // ASSERT
    expect(Auditoria::where('entidade', 'auditoria')->count())->toBe(0)
        // exatamente UMA linha a mais: a que o ACT escreveu, e nenhuma sobre ela mesma
        ->and(Auditoria::count())->toBe($totalAntes + 1);
});

it('deve filtrar a trilha por entidade_id (a trilha de um registro só)', function () {
    // ARRANGE — dois registros da mesma entidade
    $adminDaClinica = admin();
    $alvo = Usuario::factory()->create();
    $outro = Usuario::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/auditoria?entidade=usuarios&entidade_id={$alvo->id}");

    // ASSERT — só o alvo; o outro não aparece
    $resposta->assertOk();
    $ids = collect($resposta->json('data'))->pluck('entidade_id')->unique()->all();
    expect($ids)->toBe([$alvo->id]);
    expect(collect($resposta->json('data'))->pluck('entidade_id'))->not->toContain($outro->id);
});

it('deve exigir entidade quando entidade_id é informado (senão o id casa entidades diferentes)', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — entidade_id sozinho é ambíguo (agendamento 42 vs paciente 42)
    $this->actingAs($adminDaClinica)
        ->getJson('/api/auditoria?entidade_id=42')
        ->assertStatus(422);
});

it('deve trazer o autor pelo nome, e "Sistema" quando não há autor', function () {
    // ARRANGE
    $adminDaClinica = admin();
    // console (sem request): autor nulo → "Sistema"
    Usuario::factory()->create();
    // http (com request): autor = nome do admin
    $this->actingAs($adminDaClinica)
        ->postJson('/api/niveis-permissao', ['nome' => 'Recepção', 'permissoes' => []])
        ->assertCreated();

    // ACT
    $usuarios = $this->actingAs($adminDaClinica)->getJson('/api/auditoria?entidade=usuarios');
    $roles = $this->actingAs($adminDaClinica)->getJson('/api/auditoria?entidade=roles');

    // ASSERT
    expect(collect($usuarios->json('data'))->pluck('autor'))->toContain('Sistema');
    expect(collect($roles->json('data'))->pluck('autor'))->toContain($adminDaClinica->nome);
});

it('deve emitir criado_em na parede da clínica (Y-m-d H:i:s, sem T/Z do UTC)', function () {
    // ARRANGE — o front recorta a string SEM `new Date()` (parede da clínica). Carbon
    // cru sairia "…T…Z" em UTC e o `split(' ')` do front descartaria a hora inteira.
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica)
        ->postJson('/api/niveis-permissao', ['nome' => 'Recepção', 'permissoes' => []])
        ->assertCreated();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/auditoria?entidade=roles');

    // ASSERT — formato exato ancorado: sem T, sem Z, sem microssegundos
    $criadoEm = collect($resposta->json('data'))->pluck('criado_em')->first();
    expect($criadoEm)->toMatch('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/');
});

it('deve mascarar o valor sensível e rotular o campo nas alteracoes', function () {
    // ARRANGE — mudança de campo mascarado (art. 11)
    $adminDaClinica = admin();
    $usuario = Usuario::factory()->create();
    $usuario->update(['senha_hash' => 'senha-super-secreta-999']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/auditoria?entidade=usuarios&entidade_id={$usuario->id}");

    // ASSERT — a alteração aparece com rótulo humano, valor mascarado, e o cru some do corpo
    $resposta->assertOk();
    $linha = collect($resposta->json('data'))->firstWhere('acao', 'atualizou');
    $alteracao = collect($linha['alteracoes'])->firstWhere('campo', 'Senha hash');
    expect($alteracao)->not->toBeNull();
    expect($alteracao['de'])->toBe('***')
        ->and($alteracao['para'])->toBe('***');
    expect($resposta->getContent())->not->toContain('senha-super-secreta-999');
});

it('deve rotular os campos do agendamento com nomes humanos, sem chave crua', function () {
    // ARRANGE + ACT — pura: o dicionário de rótulos por entidade
    $alteracoes = RotulosDeAuditoria::alteracoes('agendamentos', [
        'antes' => ['status_id' => 1, 'inicio' => '2026-07-14 08:00:00'],
        'depois' => ['status_id' => 3, 'inicio' => '2026-07-14 09:00:00'],
    ]);

    // ASSERT — rótulo humano no lugar da chave crua
    $campos = collect($alteracoes)->pluck('campo');
    expect($campos)->toContain('Status')->toContain('Horário');
    expect($campos)->not->toContain('status_id')->not->toContain('inicio');
    $status = collect($alteracoes)->firstWhere('campo', 'Status');
    expect($status['de'])->toBe(1)->and($status['para'])->toBe(3);
});

it('deve esconder os campos internos de banco nas alterações', function () {
    // ARRANGE + ACT — pura: id/timestamps não são "o que mudou"
    $alteracoes = RotulosDeAuditoria::alteracoes('agendamentos', [
        'antes' => ['status_id' => 1, 'id' => 69, 'created_at' => '2026-07-15 02:10:00'],
        'depois' => ['status_id' => 3, 'id' => 69, 'created_at' => '2026-07-15 02:10:00'],
    ]);

    // ASSERT
    $campos = collect($alteracoes)->pluck('campo')->all();
    expect($campos)->toContain('Status');
    expect($campos)->not->toContain('Id');
    expect($campos)->not->toContain('Created at');
});

it('deve resolver os valores do agendamento para nomes, datas e Sim/Não legíveis', function () {
    // ARRANGE — status default semeados; um paciente citado no diff (correção de criança)
    $admin = admin();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    $paciente = Paciente::factory()->create();

    Auditoria::create([
        'autor_tipo' => 'sistema',
        'usuario_id' => null,
        'entidade' => 'agendamentos',
        'entidade_id' => 777,
        'acao' => 'atualizou',
        'diff_json' => [
            'antes' => ['status_id' => $emAberto->id, 'inicio' => '2026-07-15 08:00:00', 'is_reposicao' => false, 'id' => 777],
            'depois' => ['status_id' => $finalizado->id, 'inicio' => '2026-07-15 09:00:00', 'is_reposicao' => true, 'paciente_id' => $paciente->id, 'sala_id' => 999999, 'obs' => '***'],
        ],
        'criado_em' => now(),
    ]);

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/auditoria?entidade=agendamentos&entidade_id=777');

    // ASSERT
    $resposta->assertOk();
    $linha = collect($resposta->json('data'))->firstWhere('acao', 'atualizou');
    $campos = collect($linha['alteracoes'])->keyBy('campo');

    // FK vira NOME
    expect($campos['Status']['de'])->toBe('Em Aberto')
        ->and($campos['Status']['para'])->toBe('Finalizado');
    expect($campos['Paciente']['para'])->toBe($paciente->nome_social ?? $paciente->nome);
    // null passa intacto pelo resolvedor (antes não tinha paciente)
    expect($campos['Paciente']['de'])->toBeNull();
    // FK apontando para registro inexistente → fallback "#id" (nunca inventa nome, nunca quebra)
    expect($campos['Sala']['para'])->toBe('#999999');
    // mascarado (art. 11) passa INTACTO pelo resolvedor — não se ressuscita o que foi escondido
    expect($campos['Observação']['para'])->toBe('***');
    // data na parede da clínica, booleano legível
    expect($campos['Horário']['de'])->toBe('15/07/2026 às 08:00')
        ->and($campos['Horário']['para'])->toBe('15/07/2026 às 09:00');
    expect($campos['Reposição']['de'])->toBe('Não')
        ->and($campos['Reposição']['para'])->toBe('Sim');
    // campos internos somem, o id cru NUNCA vira nome
    $rotulos = collect($linha['alteracoes'])->pluck('campo')->all();
    expect($rotulos)->not->toContain('Id');
});

it('deve deixar a trilha de OUTRA entidade com valor cru (resolução é só de agendamento)', function () {
    // ARRANGE — a mesma chave numérica noutra entidade não vira nome
    $admin = admin();
    Auditoria::create([
        'autor_tipo' => 'sistema',
        'usuario_id' => null,
        'entidade' => 'itens_teste',
        'entidade_id' => 5,
        'acao' => 'atualizou',
        'diff_json' => ['antes' => ['status_id' => 1], 'depois' => ['status_id' => 3]],
        'criado_em' => now(),
    ]);

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/auditoria?entidade=itens_teste&entidade_id=5');

    // ASSERT — sem resolvedor: o valor sai CRU (1 → 3)
    $linha = collect($resposta->json('data'))->firstWhere('acao', 'atualizou');
    $status = collect($linha['alteracoes'])->firstWhere('campo', 'Status');
    expect($status['de'])->toBe(1)->and($status['para'])->toBe(3);
});

it('deve filtrar a trilha por autor (usuario_id)', function () {
    // ARRANGE — duas autoras fictícias gravando na trilha via mutações reais
    $adminDaClinica = admin();
    $outraAdmin = Usuario::factory()->create();
    $outraAdmin->syncRoles(['Administrador']);
    $this->actingAs($adminDaClinica)->postJson('/api/informativos', [
        'titulo' => 'Aviso fictício da primeira autora', 'corpo' => 'x', 'publicado' => true,
    ])->assertCreated();
    $this->flushSession();
    app('auth')->forgetGuards();
    $this->actingAs($outraAdmin)->postJson('/api/informativos', [
        'titulo' => 'Aviso fictício da segunda autora', 'corpo' => 'x', 'publicado' => true,
    ])->assertCreated();

    // ACT
    $resposta = $this->getJson("/api/auditoria?usuario_id={$adminDaClinica->id}");

    // ASSERT — todas as linhas da resposta são da primeira autora (o payload
    // expõe o NOME do autor, não o id — spec da trilha)
    $resposta->assertOk();
    expect($resposta->json('total'))->toBeGreaterThan(0);
    $autores = collect($resposta->json('data'))->pluck('autor')->unique()->values()->all();
    expect($autores)->toBe([$adminDaClinica->nome]);
});

it('deve filtrar a trilha por ação combinada com entidade', function () {
    // ARRANGE — cria e exclui um informativo fictício (duas ações na trilha)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $id = $this->postJson('/api/informativos', [
        'titulo' => 'Aviso fictício efêmero', 'corpo' => 'x', 'publicado' => false,
    ])->assertCreated()->json('id');
    $this->deleteJson("/api/informativos/{$id}")->assertNoContent();

    // ACT
    $resposta = $this->getJson('/api/auditoria?entidade=informativos&acao=excluiu');

    // ASSERT — só exclusões de informativos
    $resposta->assertOk();
    expect($resposta->json('total'))->toBe(1);
    $linha = $resposta->json('data.0');
    expect($linha['acao'])->toBe('excluiu')->and($linha['entidade'])->toBe('informativos');
});

it('deve devolver página vazia 200 para filtro que não casa nada', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT + ASSERT — ação inexistente, autor estranho e o ZERO (falsy — o `when` truthy o
    // engoliria e devolveria TUDO, I3): vazio, nunca erro
    $this->actingAs($adminDaClinica)
        ->getJson('/api/auditoria?acao=acao_que_nao_existe')
        ->assertOk()->assertJsonPath('total', 0);
    $this->getJson('/api/auditoria?usuario_id=999999')
        ->assertOk()->assertJsonPath('total', 0);
    $this->getJson('/api/auditoria?usuario_id=0')
        ->assertOk()->assertJsonPath('total', 0);
    $this->getJson('/api/auditoria?acao=0')
        ->assertOk()->assertJsonPath('total', 0);
});
