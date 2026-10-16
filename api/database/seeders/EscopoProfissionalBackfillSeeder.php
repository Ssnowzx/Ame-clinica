<?php

namespace Database\Seeders;

use App\Models\NivelPermissao;
use App\Support\Rbac\PermissaoCatalogo;
use Illuminate\Database\Seeder;
use Spatie\Permission\PermissionRegistrar;

/**
 * Backfill do escopo por vínculo (D11 · parecer SEC-VP-01 §1.2/SEC-VP-02).
 *
 * As flags `agenda.ver_todos`/`clinico.ver_todos` são ADITIVAS e nascem AUSENTES em todo papel.
 * Pela regra gated-pela-flag, um papel SEM a flag torna seus usuários escopados/fail-closed — o
 * que é o default seguro para papéis NOVOS, mas seria uma REGRESSÃO para os EXISTENTES (recepção,
 * financeiro… ficariam cegos no deploy). Este seeder concede as duas flags a TODOS os papéis já
 * existentes da clínica, preservando o comportamento PLANO de hoje. Papéis criados
 * DEPOIS (ex.: "Prof. e Agenda") nascem sem as flags → escopados por padrão.
 *
 * Idempotente (`givePermissionTo` não duplica). Roda UMA vez no deploy desta change.
 */
class EscopoProfissionalBackfillSeeder extends Seeder
{
    public function run(): void
    {
        PermissaoCatalogo::garantir();

        NivelPermissao::all()->each(fn (NivelPermissao $nivel) => $nivel->givePermissionTo([
            'agenda.ver_todos',
            'clinico.ver_todos',
        ]));

        app(PermissionRegistrar::class)->forgetCachedPermissions();
    }
}
