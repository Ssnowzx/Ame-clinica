<?php

use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Rbac\GuardaUltimoAdmin;
use App\Support\Rbac\PermissaoCatalogo;
use Illuminate\Validation\ValidationException;

/**
 * Guarda do "último admin" (gatilho ADM, parecer SEC-ADM-01): nenhuma mutação de acesso
 * pode deixar a clínica sem ao menos um usuário ATIVO com `niveis_permissao.editar`.
 * Cobre os três vetores de lockout que o parecer verificou e os casos permitidos.
 */

/** Troca o usuário autenticado entre uma ACT e outra (padrão da base). */
function reautenticar(): void
{
    test()->flushSession();
    app('auth')->forgetGuards();
}

// ─── Boundary 1: atribuição de nível ────────────────────────────────────────────────

it('deve recusar rebaixar o único administrador por atribuição de nível', function () {
    // ARRANGE — só há um admin na clínica
    $adminUnico = admin();
    $recepcao = NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);

    // ACT — o admin tenta se dar um nível sem a permissão de administrar
    $resposta = $this->actingAs($adminUnico)
        ->putJsonComVersao("/api/usuarios/{$adminUnico->id}/nivel-permissao", [
            'nivel_permissao_id' => $recepcao->id,
        ]);

    // ASSERT — 422, e o nível continua sendo Administrador
    $resposta->assertUnprocessable()->assertJsonValidationErrors('nivel_permissao_id');
    expect($adminUnico->fresh()->hasRole('Administrador'))->toBeTrue();
});

it('deve permitir rebaixar um administrador quando outro permanece', function () {
    // ARRANGE — dois admins
    $adminA = admin();
    $adminB = Usuario::factory()->create();
    $adminB->syncRoles(['Administrador']);
    $recepcao = NivelPermissao::create(['name' => 'Recepção', 'guard_name' => 'web']);

    // ACT — A rebaixa B; A ainda administra
    $resposta = $this->actingAs($adminA)
        ->putJsonComVersao("/api/usuarios/{$adminB->id}/nivel-permissao", [
            'nivel_permissao_id' => $recepcao->id,
        ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('nivel_permissao', 'Recepção');
});

// ─── Boundary 2: edição das permissões de um nível ──────────────────────────────────

it('deve recusar esvaziar a permissão de administrar do único nível admin', function () {
    // ARRANGE — o Administrador é o único nível com niveis_permissao.editar
    $adminUnico = admin();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $semAdministrar = array_values(array_diff(
        PermissaoCatalogo::PERMISSOES,
        [GuardaUltimoAdmin::PERMISSAO],
    ));

    // ACT — tira a permissão de administrar do nível que o próprio autor carrega
    $resposta = $this->actingAs($adminUnico)
        ->putJsonComVersao("/api/niveis-permissao/{$administrador->id}", [
            'nome' => 'Administrador',
            'permissoes' => $semAdministrar,
        ]);

    // ASSERT — 422, e o nível segue com a permissão
    $resposta->assertUnprocessable()->assertJsonValidationErrors('permissoes');
    expect($administrador->fresh()->hasPermissionTo(GuardaUltimoAdmin::PERMISSAO))->toBeTrue();
});

it('deve permitir esvaziar um nível admin quando outro nível admin existe', function () {
    // ARRANGE — um segundo nível que também administra, com um usuário nele
    $adminA = admin();
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->firstOrFail();
    $coadmin = NivelPermissao::create(['name' => 'Coadministrador', 'guard_name' => 'web']);
    $coadmin->givePermissionTo(GuardaUltimoAdmin::PERMISSAO);
    $outro = Usuario::factory()->create();
    $outro->syncRoles([$coadmin]);

    // ACT — remove a permissão do Administrador; o Coadministrador ainda administra
    $resposta = $this->actingAs($adminA)
        ->putJsonComVersao("/api/niveis-permissao/{$administrador->id}", [
            'nome' => 'Administrador',
            'permissoes' => array_values(array_diff(
                PermissaoCatalogo::PERMISSOES,
                [GuardaUltimoAdmin::PERMISSAO],
            )),
        ]);

    // ASSERT
    $resposta->assertOk();
    expect($administrador->fresh()->hasPermissionTo(GuardaUltimoAdmin::PERMISSAO))->toBeFalse();
});

// ─── Boundary 3: desativação de usuário ─────────────────────────────────────────────

it('deve recusar a um gestor de usuários desativar o único administrador', function () {
    // ARRANGE — o vetor do parecer: um gestor de usuários (SEM administrar) desativa o
    // único admin. Desde `trava-de-usuarios-e-niveis`, a régua do acesso o barra ANTES da
    // guarda do último admin: ele não tem o que o administrador tem (403)
    $adminUnico = admin();
    $gestor = NivelPermissao::create(['name' => 'Gestor de Usuários', 'guard_name' => 'web']);
    $gestor->givePermissionTo(['usuarios.ver', 'usuarios.editar']);
    $operador = Usuario::factory()->create();
    $operador->syncRoles([$gestor]);

    // ACT
    reautenticar();
    $resposta = $this->actingAs($operador)
        ->putJsonComVersao("/api/usuarios/{$adminUnico->id}", ['ativo' => false]);

    // ASSERT — 403, e o admin permanece ativo
    $resposta->assertForbidden();
    expect($adminUnico->fresh()->ativo)->toBeTrue();
});

it('deve permitir desativar um administrador quando outro permanece ativo', function () {
    // ARRANGE — dois admins
    $adminA = admin();
    $adminB = Usuario::factory()->create();
    $adminB->syncRoles(['Administrador']);

    // ACT — A desativa B; A segue ativo e administrando
    $resposta = $this->actingAs($adminA)
        ->putJsonComVersao("/api/usuarios/{$adminB->id}", ['ativo' => false]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('ativo', false);
});

it('deve recusar, na própria guarda, desativar o único administrador ativo', function () {
    // ARRANGE — por HTTP a régua do acesso chega antes (trava-de-usuarios-e-niveis); a guarda fica
    // como defesa em profundidade e é provada aqui, direto (CR-TRV-03)
    $adminUnico = admin();

    // ACT + ASSERT
    expect(fn () => app(GuardaUltimoAdmin::class)->garantirDesativacao($adminUnico))
        ->toThrow(fn (ValidationException $recusa) => expect($recusa->errors())->toHaveKey('ativo'));
});
