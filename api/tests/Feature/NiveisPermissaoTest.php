<?php

use App\Models\NivelPermissao;
use App\Models\Usuario;

it('deve listar os níveis da clínica', function () {
    // ARRANGE
    NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/niveis-permissao');

    // ASSERT
    $resposta->assertOk();
    $nomes = collect($resposta->json())->pluck('nome');
    expect($nomes)->toContain('Administrador')
        ->toContain('Recepção');
});

it('deve criar nível com permissões do catálogo', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/niveis-permissao', [
        'nome' => 'Recepção',
        'permissoes' => ['niveis_permissao.ver', 'configuracoes.ver'],
    ]);

    // ASSERT
    $resposta->assertCreated()
        ->assertJsonPath('nome', 'Recepção')
        ->assertJsonPath('permissoes', ['configuracoes.ver', 'niveis_permissao.ver']);
});

it('deve rejeitar permissão que não existe no catálogo', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/niveis-permissao', [
        'nome' => 'Nível Fantasma',
        'permissoes' => ['modulo_fantasma.acao_fantasma'],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('permissoes.0');
});

it('deve rejeitar nome de nível duplicado', function () {
    // ARRANGE — sem a validação, o unique do Spatie viraria 500
    $adminDaClinica = admin();
    NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);

    // ACT
    $criar = $this->actingAs($adminDaClinica)->postJson('/api/niveis-permissao', [
        'nome' => 'Recepção',
        'permissoes' => [],
    ]);

    // ASSERT
    $criar->assertUnprocessable()->assertJsonValidationErrors('nome');
});

it('deve rejeitar renomear nível para nome de outro nível', function () {
    // ARRANGE
    $adminDaClinica = admin();
    NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);
    $financeiro = NivelPermissao::create(['name' => 'Financeiro', 'guard_name' => 'web']);

    // ACT — colidir com "Recepção"; manter o próprio nome deve continuar válido
    $colisao = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$financeiro->id}", [
        'nome' => 'Recepção',
        'permissoes' => [],
    ]);
    $proprioNome = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$financeiro->id}", [
        'nome' => 'Financeiro',
        'permissoes' => [],
    ]);

    // ASSERT
    $colisao->assertUnprocessable()->assertJsonValidationErrors('nome');
    $proprioNome->assertOk();
});

it('deve atualizar nome e permissões de um nível', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $nivel = NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);
    $nivel->syncPermissions(['configuracoes.ver']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$nivel->id}", [
        'nome' => 'Recepção e Agenda',
        'permissoes' => ['configuracoes.ver', 'auditoria.ver'],
    ]);

    // ASSERT
    $resposta->assertOk()
        ->assertJsonPath('nome', 'Recepção e Agenda')
        ->assertJsonPath('permissoes', ['auditoria.ver', 'configuracoes.ver']);
});

it('deve excluir nível sem usuários vinculados', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $nivel = NivelPermissao::create(['name' => 'Sem Uso', 'guard_name' => 'web']);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->deleteJson("/api/niveis-permissao/{$nivel->id}");

    // ASSERT
    $resposta->assertNoContent();
    expect(NivelPermissao::query()->where('name', 'Sem Uso')->exists())->toBeFalse();
});

it('deve bloquear exclusão de nível em uso', function () {
    // ARRANGE — o próprio admin usa o nível Administrador
    $adminDaClinica = admin();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->deleteJson("/api/niveis-permissao/{$administrador->id}");

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('nivel_permissao');
    expect(NivelPermissao::query()->where('name', 'Administrador')->exists())->toBeTrue();
});

it('deve substituir o nível anterior ao atribuir um novo', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $colega = Usuario::factory()->create();
    $recepcao = NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);
    $financeiro = NivelPermissao::create(['name' => 'Financeiro', 'guard_name' => 'web']);
    $colega->syncRoles([$recepcao]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/usuarios/{$colega->id}/nivel-permissao", [
            'nivel_permissao_id' => $financeiro->id,
        ]);

    // ASSERT — exatamente um nível, o novo
    $resposta->assertOk()
        ->assertJsonPath('nivel_permissao_id', $financeiro->id)
        ->assertJsonPath('nivel_permissao', 'Financeiro');
    expect($colega->fresh()->roles()->count())->toBe(1);
});

it('deve responder 403 para usuário sem permissão de gestão de níveis', function () {
    // ARRANGE — abuse case 2 (escalada vertical)
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/niveis-permissao')->assertForbidden();
    $this->actingAs($usuarioSemNivel)->postJson('/api/niveis-permissao', [
        'nome' => 'Golpe',
        'permissoes' => ['niveis_permissao.criar'],
    ])->assertForbidden();
});

it('deve invalidar o cache de permissões ao alterar um nível', function () {
    // ARRANGE — colega com nível que enxerga níveis
    $adminDaClinica = admin();
    $recepcao = NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);
    $recepcao->syncPermissions(['niveis_permissao.ver']);
    $colega = Usuario::factory()->create();
    $colega->syncRoles([$recepcao]);

    $this->actingAs($colega)->getJson('/api/niveis-permissao')->assertOk();

    // ACT — admin remove a permissão do nível (sessão/guards limpos ao trocar de ator)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/niveis-permissao/{$recepcao->id}", [
        'nome' => 'Recepção',
        'permissoes' => [],
    ])->assertOk();

    // ASSERT — efeito imediato (cache do Spatie invalidado — armadilha 3)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($colega->fresh())->getJson('/api/niveis-permissao')->assertForbidden();
});

it('deve expor o catálogo de permissões para quem gerencia níveis', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/permissoes');

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('permissoes'))->toContain('niveis_permissao.ver')
        ->toContain('configuracoes.editar');
});

it('deve retornar nível e permissões efetivas no me', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/me');

    // ASSERT
    $resposta->assertOk()->assertJsonPath('nivel_permissao', 'Administrador');
    expect($resposta->json('permissoes'))->toContain('niveis_permissao.criar');
});
