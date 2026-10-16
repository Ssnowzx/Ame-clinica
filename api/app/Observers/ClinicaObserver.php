<?php

namespace App\Observers;

use App\Models\Clinica;
use App\Models\NivelPermissao;
use App\Support\Agenda\StatusAgendamentoDefaults;
use App\Support\Financeiro\CatalogoPadrao;
use App\Support\Rbac\PermissaoCatalogo;
use Spatie\Permission\Models\Permission;

/**
 * A clínica nasce operável: nível "Administrador" com o catálogo completo
 * (spec rbac) + conjunto default de status de agendamento (spec status-agendamento)
 * + catálogo mínimo do caixa, todos criados junto com a linha da clínica.
 */
class ClinicaObserver
{
    public function created(Clinica $clinica): void
    {
        PermissaoCatalogo::garantir();

        $administrador = NivelPermissao::findOrCreate('Administrador', 'web');
        $administrador->givePermissionTo(Permission::all());

        StatusAgendamentoDefaults::criar();

        // O catálogo do dinheiro é da mesma natureza dos status: sem conta, forma de
        // pagamento e categoria, o financeiro nasce impossível de usar. Fica AQUI, e não
        // no seeder, porque a clínica também nasce de factory e do importador da virada —
        // e todos precisam do mesmo mínimo (SEC-CFT-04).
        app(CatalogoPadrao::class)->aplicar();
    }
}
