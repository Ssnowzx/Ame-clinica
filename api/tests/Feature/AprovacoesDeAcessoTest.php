<?php

use App\Http\Controllers\AprovacaoDeAcessoController;
use App\Http\Controllers\AtribuicaoNivelController;
use App\Http\Controllers\ConfiguracaoController;
use App\Http\Controllers\NivelPermissaoController;
use App\Http\Controllers\UsuarioController;
use App\Models\AprovacaoDeAcesso;
use App\Models\Auditoria;
use App\Models\NivelPermissao;
use App\Models\Usuario;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

/**
 * Maker-checker das mutações de acesso (AP-13 · SEC-SD-01..12): com a dupla
 * ligada, editar nível / atribuir nível / desligar `seguranca.*` NÃO aplicam —
 * viram pendência 202 decidida por OUTRO administrador, revalidada contra o
 * estado ATUAL e aplicada serializada pela âncora da clínica.
 */

/**
 * Segundo administrador ATIVO, no nível Administrador de fábrica: desde a change
 * `trava-de-usuarios-e-niveis`, quem aprova precisa TER o acesso em jogo — um papel com só o
 * módulo de níveis não aprovaria nada além do que tem. O papel vai como MODELO, não por nome:
 * depois de qualquer request API o `auth:sanctum` troca o guard default (`shouldUse`), e a
 * busca por nome procuraria em `sanctum`.
 */
function segundoAdminDasAprovacoes(string $nome = 'Segundo Admin Fictício'): Usuario
{
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $usuario = Usuario::factory()->create(['nome' => $nome]);
    $usuario->syncRoles([$administrador]);

    test()->flushSession();
    app('auth')->forgetGuards();

    return $usuario;
}

/** Liga a aprovação dupla pelo caminho REAL (exige o quórum de 2 admins já criado). */
function ligarAprovacaoDupla(Usuario $admin): void
{
    test()->actingAs($admin)
        ->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])
        ->assertOk();
}

/** Um nível-alvo simples, criado direto (criação é INERTE — SEC-SD-04). */
function nivelAlvoDasAprovacoes(string $nome = 'Alvo Fictício'): NivelPermissao
{
    $id = test()->postJson('/api/niveis-permissao', [
        'nome' => $nome,
        'permissoes' => ['agenda.ver'],
    ])->assertCreated()->json('id');

    return NivelPermissao::query()->findOrFail($id);
}

it('deve exigir dois administradores ativos para ligar a aprovação dupla', function () {
    // ARRANGE — clínica com UM admin
    $adminDaClinica = admin();

    // ACT + ASSERT — com um só, ninguém aprovaria nada: 422
    $this->actingAs($adminDaClinica)
        ->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => true])
        ->assertUnprocessable();

    // com o segundo admin ATIVO, liga
    segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);
});

it('deve transformar edição de nível e atribuição em pendência 202, sem aplicar nada', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $nivel = nivelAlvoDasAprovacoes();
    $operadora = Usuario::factory()->create();
    segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);

    // ACT — edição de nível vira pendência com a versão-base (SEC-SD-02)
    $edicao = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício',
        'permissoes' => ['agenda.ver', 'pacientes.ver'],
    ]);

    // ASSERT — 202, estado do alvo INALTERADO, pendência registrada
    $edicao->assertStatus(202);
    expect($edicao->json('status'))->toBe('pendente')
        ->and($edicao->json('payload.base_versao'))->not->toBeEmpty()
        ->and($nivel->refresh()->permissions()->pluck('name')->all())->toBe(['agenda.ver']);

    // ACT + ASSERT — atribuição idem: 202 e o usuário segue SEM nível
    $atribuicao = $this->actingAs($adminDaClinica)
        ->putJson("/api/usuarios/{$operadora->id}/nivel-permissao", ['nivel_permissao_id' => $nivel->id]);
    $atribuicao->assertStatus(202);
    expect($operadora->refresh()->roles()->count())->toBe(0);

    // payload inválido NÃO vira pendência (validação roda ANTES)
    $antes = AprovacaoDeAcesso::count();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício',
        'permissoes' => ['permissao.inexistente'],
    ])->assertUnprocessable();
    expect(AprovacaoDeAcesso::count())->toBe($antes);
});

it('deve recusar segunda pendência ativa para o mesmo alvo', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $nivel = nivelAlvoDasAprovacoes();
    segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício', 'permissoes' => ['agenda.ver', 'pacientes.ver'],
    ])->assertStatus(202);

    // ACT + ASSERT — o mesmo alvo com pendência ATIVA → 422 apontando a pendência
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício', 'permissoes' => ['agenda.ver'],
    ])->assertUnprocessable();
});

it('deve exigir OUTRO administrador para decidir, aplicar na aprovação e referenciar a pendência na trilha', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $nivel = nivelAlvoDasAprovacoes();
    $segundo = segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);
    $pendenciaId = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício', 'permissoes' => ['agenda.ver', 'pacientes.ver'],
    ])->assertStatus(202)->json('id');

    // ACT + ASSERT — o SOLICITANTE não decide (422); nada aplicou
    $this->actingAs($adminDaClinica)
        ->postJson("/api/aprovacoes-de-acesso/{$pendenciaId}/aprovar")
        ->assertUnprocessable();
    expect($nivel->refresh()->permissions()->pluck('name')->all())->toBe(['agenda.ver']);

    // o SEGUNDO admin aprova → aplica, flip com decisor, trilha referencia a pendência
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $aprovacao = $this->actingAs($segundo)->postJson("/api/aprovacoes-de-acesso/{$pendenciaId}/aprovar");
    $aprovacao->assertOk()->assertJsonPath('status', 'aprovada');
    expect($aprovacao->json('decidido_por.id'))->toBe($segundo->id)
        ->and($nivel->refresh()->permissions()->pluck('name')->sort()->values()->all())
        ->toBe(['agenda.ver', 'pacientes.ver']);

    $evento = Auditoria::where('acao', 'alterou_permissoes')->orderByDesc('id')->firstOrFail();
    expect($evento->diff_json['aprovacao']['pendencia_id'] ?? null)->toBe($pendenciaId)
        ->and($evento->diff_json['aprovacao']['solicitante_id'] ?? null)->toBe($adminDaClinica->id)
        ->and($evento->diff_json['aprovacao']['decidido_por_id'] ?? null)->toBe($segundo->id);
});

it('deve recusar pendência OBSOLETA quando o nível mudou no intervalo (OCC no vão assíncrono)', function () {
    // ARRANGE — pendência criada; depois o MUNDO muda (drift direto no banco, com
    // updated_at futuro — a precisão de 1s do timestamp esconderia o drift no mesmo segundo)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $nivel = nivelAlvoDasAprovacoes();
    $segundo = segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);
    $pendenciaId = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício', 'permissoes' => ['agenda.ver', 'pacientes.ver'],
    ])->assertStatus(202)->json('id');
    DB::table('roles')->where('id', $nivel->id)
        ->update(['updated_at' => now()->addSeconds(5)->format('Y-m-d H:i:s')]);

    // ACT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $resposta = $this->actingAs($segundo)->postJson("/api/aprovacoes-de-acesso/{$pendenciaId}/aprovar");

    // ASSERT — 422 obsoleta; NADA aplicou; a pendência PERMANECE pendente
    $resposta->assertUnprocessable();
    expect($nivel->refresh()->permissions()->pluck('name')->all())->toBe(['agenda.ver'])
        ->and(AprovacaoDeAcesso::findOrFail($pendenciaId)->status)->toBe('pendente');
});

it('deve tocar o updated_at quando SÓ as permissões mudam — o OCC assíncrono não fica cego (CR B1)', function () {
    // ARRANGE — nível com updated_at NO PASSADO (a precisão de 1s esconderia o drift);
    // pendência P1 captura essa base
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $nivel = nivelAlvoDasAprovacoes();
    $segundo = segundoAdminDasAprovacoes();
    DB::table('roles')->where('id', $nivel->id)
        ->update(['updated_at' => now()->subSeconds(30)->format('Y-m-d H:i:s')]);
    ligarAprovacaoDupla($adminDaClinica);
    $pendenciaAntiga = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício', 'permissoes' => ['agenda.ver', 'pacientes.ver'],
    ])->assertStatus(202)->json('id');

    // ...a dupla é DESLIGADA por aprovação (o caminho real do contrato)...
    $pendenciaDoDesligar = $this->actingAs($adminDaClinica)
        ->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => false])
        ->assertStatus(202)->json('id');
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($segundo)->postJson("/api/aprovacoes-de-acesso/{$pendenciaDoDesligar}/aprovar")->assertOk();

    // ACT — edição DIRETA que muda SÓ as permissões (nome idêntico): syncPermissions
    // não toca a coluna — sem o touch, a base velha continuaria "válida"
    $baseAntiga = $nivel->refresh()->updated_at?->format('Y-m-d H:i:s');
    $this->actingAs($segundo)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício', 'permissoes' => ['agenda.ver', 'tratamentos.ver'],
    ])->assertOk();

    // ASSERT — o updated_at MUDOU; aprovar a pendência antiga recusa como obsoleta
    expect($nivel->refresh()->updated_at?->format('Y-m-d H:i:s'))->not->toBe($baseAntiga);
    $this->actingAs($segundo)
        ->postJson("/api/aprovacoes-de-acesso/{$pendenciaAntiga}/aprovar")
        ->assertUnprocessable();
    expect($nivel->refresh()->permissions()->pluck('name')->sort()->values()->all())
        ->toBe(['agenda.ver', 'tratamentos.ver']);
});

it('deve revalidar as regras INTEGRAIS na aprovação (nome único)', function () {
    // ARRANGE — a pendência quer um nome que OUTRO nível tomou no intervalo
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $nivel = nivelAlvoDasAprovacoes();
    $segundo = segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);
    $pendenciaId = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Nome Cobiçado Fictício', 'permissoes' => ['agenda.ver'],
    ])->assertStatus(202)->json('id');
    // criação é DIRETA (inerte) — toma o nome no intervalo sem tocar o nível-alvo
    $this->actingAs($adminDaClinica)->postJson('/api/niveis-permissao', [
        'nome' => 'Nome Cobiçado Fictício', 'permissoes' => [],
    ])->assertCreated();

    // ACT + ASSERT — sem a revalidação integral, o unique do Spatie seria um 500
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($segundo)
        ->postJson("/api/aprovacoes-de-acesso/{$pendenciaId}/aprovar")
        ->assertUnprocessable();
    expect(AprovacaoDeAcesso::findOrFail($pendenciaId)->status)->toBe('pendente');
});

it('deve interceptar o DESLIGAR da flag e decidir pendências mesmo com ela desligada', function () {
    // ARRANGE — pendência de edição aberta ANTES do desligamento
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $nivel = nivelAlvoDasAprovacoes();
    $segundo = segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);
    $pendenciaDaEdicao = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício', 'permissoes' => ['agenda.ver', 'pacientes.ver'],
    ])->assertStatus(202)->json('id');

    // ACT — desligar a dupla NÃO desliga: vira pendência (o bypass desliga-muta-religa)
    $pendenciaDoDesligar = $this->actingAs($adminDaClinica)
        ->putJson('/api/configuracoes', ['chave' => 'seguranca.aprovacao_dupla', 'valor' => false])
        ->assertStatus(202)->json('id');

    // o segundo admin aprova o desligamento → flag OFF
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($segundo)
        ->postJson("/api/aprovacoes-de-acesso/{$pendenciaDoDesligar}/aprovar")
        ->assertOk();
    $efetivas = collect($this->actingAs($segundo)->getJson('/api/configuracoes')->json('configuracoes'));
    expect($efetivas->firstWhere('chave', 'seguranca.aprovacao_dupla')['valor'])->toBeFalse();

    // ASSERT — a pendência ANTERIOR continua decidível com a flag desligada (o gate é da criação)
    $this->actingAs($segundo)
        ->postJson("/api/aprovacoes-de-acesso/{$pendenciaDaEdicao}/aprovar")
        ->assertOk();
    expect($nivel->refresh()->permissions()->pluck('name')->sort()->values()->all())
        ->toBe(['agenda.ver', 'pacientes.ver']);
});

it('deve deixar cancelar SÓ o solicitante, sem aplicar nada', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $nivel = nivelAlvoDasAprovacoes();
    $segundo = segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);
    $pendenciaId = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Fictício', 'permissoes' => ['agenda.ver', 'pacientes.ver'],
    ])->assertStatus(202)->json('id');

    // ACT + ASSERT — outro admin não cancela (cancelar não é decisão)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($segundo)
        ->postJson("/api/aprovacoes-de-acesso/{$pendenciaId}/cancelar")
        ->assertUnprocessable();

    // o solicitante cancela; nada aplicou; decidir depois → 409
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)
        ->postJson("/api/aprovacoes-de-acesso/{$pendenciaId}/cancelar")
        ->assertOk()->assertJsonPath('status', 'cancelada');
    expect($nivel->refresh()->permissions()->pluck('name')->all())->toBe(['agenda.ver']);
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($segundo)
        ->postJson("/api/aprovacoes-de-acesso/{$pendenciaId}/aprovar")
        ->assertStatus(409);
});

it('deve manter criar-nível INERTE e a auto-atribuição gated (invariante SEC-SD-04)', function () {
    // ARRANGE — com a dupla LIGADA, criar um nível "Evil" é permitido (inerte)…
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);

    // ACT — cria direto (201) e tenta se AUTO-atribuir
    $evilId = $this->actingAs($adminDaClinica)->postJson('/api/niveis-permissao', [
        'nome' => 'Evil Fictício',
        'permissoes' => ['niveis_permissao.editar', 'evolucoes.assinar_por_outro'],
    ])->assertCreated()->json('id');
    $resposta = $this->actingAs($adminDaClinica)
        ->putJson("/api/usuarios/{$adminDaClinica->id}/nivel-permissao", ['nivel_permissao_id' => $evilId]);

    // ASSERT — a atribuição É gated: 202, e o admin segue no nível de antes
    $resposta->assertStatus(202);
    expect($adminDaClinica->refresh()->roles()->pluck('name')->all())->toBe(['Administrador']);
});

it('deve serializar decisão e desativação pela âncora da clínica (TEST-LOCK-EPOCH)', function () {
    // ARRANGE — pendência pronta para aprovar
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $nivel = nivelAlvoDasAprovacoes();
    $segundo = segundoAdminDasAprovacoes();
    ligarAprovacaoDupla($adminDaClinica);
    $pendenciaId = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Alvo Renomeado Fictício', 'permissoes' => ['agenda.ver', 'pacientes.ver'],
    ])->assertStatus(202)->json('id');
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    // ACT — aprovar com as consultas capturadas COM epoch
    $capturadas = capturarConsultasComEpoch();
    $this->actingAs($segundo)
        ->postJson("/api/aprovacoes-de-acesso/{$pendenciaId}/aprovar")
        ->assertOk();

    // ASSERT — a âncora (`clinica … for update`) e a GRAVAÇÃO comitam no MESMO epoch:
    // mover a aplicação para fora da transação ancorada reprova aqui (erodido)
    $consultas = $capturadas();
    $epochDaAncora = epochDaConsulta($consultas, ['from `clinica`', 'for update']);
    $epochDaGravacao = epochDaConsulta($consultas, ['update `roles`']);
    expect($epochDaGravacao)->toBe($epochDaAncora);

    // ...e a DESATIVAÇÃO de usuário também é ancorada (boundary 3 da guarda)
    $operadora = Usuario::factory()->create(['ativo' => true]);
    $capturadasDesativacao = capturarConsultasComEpoch();
    $this->actingAs($segundo)->putJsonComVersao("/api/usuarios/{$operadora->id}", ['ativo' => false])
        ->assertOk();
    $consultasDesativacao = $capturadasDesativacao();
    $epochAncoraDesativacao = epochDaConsulta($consultasDesativacao, ['from `clinica`', 'for update']);
    $epochUpdateUsuario = epochDaConsulta($consultasDesativacao, ['update `usuarios`']);
    expect($epochUpdateUsuario)->toBe($epochAncoraDesativacao);
});

it('deve manter TODA rota que muda acesso classificada: interceptada ou isenta com motivo (rede SEC-SD-12)', function () {
    // interceptada = com a dupla ligada vira pendência · isenta = motivo registrado.
    // Rota NOVA nestes controllers sem classificação REPROVA — o bypass do maker-checker
    // não nasce em silêncio (mesmo espírito do EscopoPorPadraoTest/SEC-VP-07).
    $classificacao = [
        'NivelPermissaoController@index' => 'isenta',      // leitura
        'NivelPermissaoController@show' => 'isenta',       // leitura
        'NivelPermissaoController@store' => 'isenta',      // criar é INERTE (SEC-SD-04)
        'NivelPermissaoController@update' => 'interceptada',
        'NivelPermissaoController@destroy' => 'isenta',    // só exclui nível SEM usuários — checagem ANCORADA (SD-N1)
        'AtribuicaoNivelController@atualizar' => 'interceptada',
        'UsuarioController@index' => 'isenta',             // leitura
        'UsuarioController@show' => 'isenta',              // leitura
        'UsuarioController@store' => 'isenta',             // nasce SEM nível — não concede acesso
        'UsuarioController@update' => 'isenta',            // não muda permissões; desativação ancorada (fronteira SEC-SD-10)
        'ConfiguracaoController@index' => 'isenta',        // leitura
        'ConfiguracaoController@agenda' => 'isenta',       // leitura
        'ConfiguracaoController@alvosEncadeamento' => 'isenta', // leitura
        'ConfiguracaoController@update' => 'interceptada', // transição true→false de seguranca.*
        'AprovacaoDeAcessoController@index' => 'isenta',   // leitura
        'AprovacaoDeAcessoController@aprovar' => 'isenta',  // o PRÓPRIO mecanismo (maker≠checker)
        'AprovacaoDeAcessoController@recusar' => 'isenta',  // idem
        'AprovacaoDeAcessoController@cancelar' => 'isenta', // idem (só o solicitante)
    ];
    $controladores = [
        class_basename(NivelPermissaoController::class),
        class_basename(AtribuicaoNivelController::class),
        class_basename(UsuarioController::class),
        class_basename(ConfiguracaoController::class),
        class_basename(AprovacaoDeAcessoController::class),
    ];

    $naoClassificadas = [];
    foreach (Route::getRoutes() as $rota) {
        $acao = $rota->getActionName();
        if (! str_contains($acao, '@')) {
            continue;
        }
        [$classeFqn, $metodo] = explode('@', $acao);
        $classe = class_basename($classeFqn);
        if (! in_array($classe, $controladores, true)) {
            continue;
        }
        if (! array_key_exists("{$classe}@{$metodo}", $classificacao)) {
            $naoClassificadas[] = "{$classe}@{$metodo}";
        }
    }

    expect($naoClassificadas)->toBe(
        [],
        'Rota(s) de mutação de acesso SEM classificação no maker-checker (SEC-SD-12): '
        .implode(', ', $naoClassificadas)
        .'. Interceptar (pendência com a dupla ligada) ou isentar COM MOTIVO aqui.',
    );
});
