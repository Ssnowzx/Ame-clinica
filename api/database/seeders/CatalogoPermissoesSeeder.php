<?php

namespace Database\Seeders;

use App\Models\NivelPermissao;
use App\Support\Rbac\PermissaoCatalogo;
use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Idempotente. Além de garantir o catálogo, RESSINCRONIZA o nível Administrador
 * — o ClinicaObserver só concede o catálogo na criação da clínica; sem isto,
 * changes novas deixariam a clínica existente sem os módulos novos (auditoria de
 * segurança, SEC-cb-01). Num banco novo (sem o nível) só garante o catálogo.
 */
class CatalogoPermissoesSeeder extends Seeder
{
    public function run(): void
    {
        PermissaoCatalogo::garantir();

        NivelPermissao::where('name', 'Administrador')
            ->first()
            ?->syncPermissions(Permission::all());

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
