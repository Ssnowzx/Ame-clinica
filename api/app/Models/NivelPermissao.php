<?php

namespace App\Models;

use App\Support\Auditoria\Auditavel;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;
use Spatie\Permission\Support\Config as ConfigSpatie;

/**
 * "Nível de permissão" da spec (§5/§12) = role do Spatie.
 * A tabela é `roles`; a nomenclatura da spec vive na API (design D3).
 */
class NivelPermissao extends Role
{
    use Auditavel;

    /**
     * O users() do pacote resolve o model pelo guard DEFAULT do runtime — que vira
     * "sanctum" (provider null) em request autenticada por auth:sanctum, quebrando
     * withCount('users'). Aqui o model é sempre Usuario.
     */
    public function users(): BelongsToMany
    {
        return $this->morphedByMany(
            Usuario::class,
            'model',
            ConfigSpatie::modelHasRolesTable(),
            app(PermissionRegistrar::class)->pivotRole,
            ConfigSpatie::morphKey()
        );
    }
}
