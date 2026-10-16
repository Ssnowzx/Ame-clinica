<?php

use Database\Seeders\CatalogoPermissoesSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * Deploy da change fechamento-de-ciclo (spec rbac): `ciclos.fechar` e `ciclos.reabrir`
 * entram no catálogo e são ressincronizadas SÓ nos níveis Administrador da
 * clínica (o `CatalogoPermissoesSeeder` faz exatamente isso: `garantir()` +
 * `syncPermissions(Permission::all())` do Administrador; SEC-cb-01).
 *
 * DELIBERADO: NENHUM backfill para outros níveis. `ciclos.reabrir` é permissão de
 * EXCEÇÃO no molde do `evolucoes.assinar_por_outro` — quem a concede a mais alguém faz
 * isso pela tela de Níveis, deliberadamente, e a concessão fica na trilha. Um backfill
 * "para não quebrar ninguém" distribuiria a chave-mestra da produção congelada.
 *
 * Idempotente (`findOrCreate` + `syncPermissions`); num banco novo (sem a clínica) é no-op
 * além de garantir o catálogo. `down()` é no-op deliberado: permissão é dado de RBAC, não
 * schema — a permissão órfã num rollback de release é inócua.
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
