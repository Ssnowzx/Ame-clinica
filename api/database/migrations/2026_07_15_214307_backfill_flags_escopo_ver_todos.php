<?php

use Database\Seeders\EscopoProfissionalBackfillSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * Backfill de DEPLOY do escopo por vínculo (D11 · parecer SEC-VP-13/P1 · SEC-VP-02).
 *
 * As flags aditivas `agenda.ver_todos`/`clinico.ver_todos` nascem AUSENTES. Pela regra
 * gated-pela-flag, um papel SEM a flag torna seus usuários escopados/fail-closed — o default
 * seguro para papéis NOVOS, mas uma REGRESSÃO para os EXISTENTES: sem este backfill, recepção e
 * financeiro ficariam CEGOS no deploy. Esta migration concede as duas flags a TODOS os papéis já
 * existentes da clínica, preservando o comportamento PLANO de hoje — e roda
 * automaticamente no deploy (o seeder isolado dependia de invocação manual).
 *
 * Idempotente (`givePermissionTo` não duplica); num banco novo (sem papéis) é no-op.
 * `down()` é no-op deliberado: as flags são DADO de RBAC (do papel), não schema — revertê-las
 * cegaria os papéis que este backfill acabou de preservar.
 */
return new class extends Migration
{
    public function up(): void
    {
        (new EscopoProfissionalBackfillSeeder)->run();
    }

    public function down(): void
    {
        // no-op: as flags são configuração de papel (RBAC), não schema — não se reverte.
    }
};
