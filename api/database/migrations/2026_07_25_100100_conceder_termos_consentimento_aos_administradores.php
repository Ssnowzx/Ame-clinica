<?php

use Database\Seeders\CatalogoPermissoesSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * Deploy da change aceite-do-regulamento (spec rbac): `termos_consentimento.*` entra no
 * catálogo e é ressincronizada SÓ nos níveis Administrador da clínica (o
 * `CatalogoPermissoesSeeder` faz exatamente isso: `garantir()` + `syncPermissions(
 * Permission::all())` do Administrador; SEC-cb-01) — sem isto, uma clínica criada ANTES
 * desta change ficaria sem o módulo novo, e a clínica não teria como publicar o termo.
 *
 * DELIBERADO: nenhum backfill para outros níveis. Quem governa o TEXTO do contrato
 * terapêutico é decisão de administração — a recepção registra o aceite (isso é
 * `pacientes.editar`), não reescreve a régua.
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
