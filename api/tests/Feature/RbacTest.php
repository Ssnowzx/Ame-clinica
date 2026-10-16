<?php

use App\Models\NivelPermissao;
use App\Models\Usuario;
use App\Support\Rbac\PermissaoCatalogo;
use Database\Seeders\CatalogoPermissoesSeeder;
use Spatie\Permission\PermissionRegistrar;

it('deve criar o nível Administrador com todo o catálogo ao criar a clínica', function () {
    // ARRANGE + ACT — a clínica do teste nasce pelo TestCase, e o observer cria o nível

    // ASSERT
    $administrador = NivelPermissao::query()->where('name', 'Administrador')->first();

    expect($administrador)->not->toBeNull()
        ->and($administrador->permissions()->count())->toBe(count(PermissaoCatalogo::PERMISSOES));
});

it('deve incluir os módulos de cadastros base no catálogo do Administrador', function () {
    // ARRANGE + ACT
    $adminDaClinica = admin();

    // ASSERT — extensões do catálogo (cadastros-base 2.1 + profissionais-pacientes 2.1)
    expect($adminDaClinica->can('especialidades.criar'))->toBeTrue()
        ->and($adminDaClinica->can('status_agendamento.editar'))->toBeTrue()
        ->and($adminDaClinica->can('medicos.excluir'))->toBeTrue()
        ->and($adminDaClinica->can('profissionais.criar'))->toBeTrue()
        ->and($adminDaClinica->can('pacientes.editar'))->toBeTrue()
        ->and($adminDaClinica->can('agenda.criar'))->toBeTrue()
        ->and($adminDaClinica->can('lista_espera.ver'))->toBeTrue();
});

it('deve ressincronizar o Administrador da clínica existente com o catálogo', function () {
    // ARRANGE — SEC-cb-01: clínica "antiga" cujo Administrador perdeu/nunca teve
    // permissões novas do catálogo
    $adminDaClinica = admin();
    $administrador = NivelPermissao::query()
        ->where('name', 'Administrador')->firstOrFail();
    $administrador->revokePermissionTo('especialidades.criar');
    app(PermissionRegistrar::class)->forgetCachedPermissions();
    expect($adminDaClinica->fresh()->can('especialidades.criar'))->toBeFalse();

    // ACT — o seeder do catálogo é retroativo
    $this->seed(CatalogoPermissoesSeeder::class);

    // ASSERT
    $usuarioRecarregado = $adminDaClinica->fresh()->unsetRelation('roles')->unsetRelation('permissions');
    expect($usuarioRecarregado->can('especialidades.criar'))->toBeTrue();
});

it('deve conceder ao usuário as permissões do seu nível', function () {
    // ARRANGE
    $usuario = Usuario::factory()->create();
    $usuario->syncRoles(['Administrador']);

    // ACT + ASSERT
    expect($usuario->can('niveis_permissao.criar'))->toBeTrue()
        ->and($usuario->can('configuracoes.editar'))->toBeTrue();
});

it('deve negar permissão a usuário sem nível atribuído', function () {
    // ARRANGE
    $usuario = Usuario::factory()->create();

    // ACT + ASSERT
    expect($usuario->can('niveis_permissao.criar'))->toBeFalse();
});
