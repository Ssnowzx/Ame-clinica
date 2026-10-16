<?php

use Database\Seeders\CatalogoPermissoesSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * Deploy da change mensageria-whatsapp (spec rbac): `mensagens.*` entra no catálogo e é
 * ressincronizada SÓ nos níveis Administrador da clínica (o `CatalogoPermissoesSeeder`
 * faz `garantir()` + `syncPermissions(Permission::all())` do Administrador) — sem isto, uma clínica
 * criada ANTES desta change ficaria sem o módulo novo, e a clínica não teria como sequer
 * conectar o próprio número.
 *
 * DELIBERADO: nenhum backfill para outros níveis. Quem responde a família e quem guarda a
 * credencial da Meta é decisão de administração — a clínica distribui `mensagens.ver`/
 * `mensagens.responder` para a recepção pela tela de níveis, com o rosto de quem decidiu.
 *
 * Idempotente; num banco novo (sem a clínica) é no-op além de garantir o catálogo.
 * `down()` é no-op deliberado: permissão é dado de RBAC, não schema.
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
