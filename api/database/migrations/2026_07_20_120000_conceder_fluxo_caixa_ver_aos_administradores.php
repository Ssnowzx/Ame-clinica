<?php

use Database\Seeders\CatalogoPermissoesSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * Deploy da change totais-do-caixa (D2): `fluxo_caixa.ver` — a permissão dos AGREGADOS
 * financeiros da clínica — entra no catálogo e é ressincronizada SÓ nos níveis
 * Administrador da clínica (o `CatalogoPermissoesSeeder` faz exatamente isso:
 * `garantir()` + `syncPermissions(Permission::all())` do Administrador; SEC-cb-01).
 *
 * DELIBERADO: NENHUM backfill para níveis que têm `lancamentos.ver` — o inverso do
 * precedente D11 (`EscopoProfissionalBackfillSeeder`, que preservava comportamento).
 * Aqui PERDER os totais é o objetivo (decisão da clínica 2026-07-19, perguntas 9-10):
 * recepção e faturista operam lançamento a lançamento, mas não veem o total recebido.
 * Nível customizado que precise dos agregados recebe `fluxo_caixa.ver` na tela de
 * Níveis (é DADO de RBAC, 1 clique) — nunca por backfill em massa.
 *
 * Idempotente (`findOrCreate` + `syncPermissions`); num banco novo (sem a clínica) é
 * no-op além de garantir o catálogo. `down()` é no-op deliberado: permissão é dado de
 * RBAC, não schema — a permissão órfã num rollback de release é inócua (design §Migration Plan).
 */
return new class extends Migration
{
    public function up(): void
    {
        (new CatalogoPermissoesSeeder)->run();
    }

    public function down(): void
    {
        // no-op: rollback é reverter a release; a permissão órfã no banco é inócua.
    }
};
