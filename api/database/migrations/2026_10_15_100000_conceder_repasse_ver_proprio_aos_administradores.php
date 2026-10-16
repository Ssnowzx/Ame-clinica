<?php

use Database\Seeders\CatalogoPermissoesSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * Deploy da change painel-do-profissional (spec rbac): `repasse.ver_proprio` entra no catálogo e é
 * ressincronizada SÓ nos níveis Administrador da clínica (o `CatalogoPermissoesSeeder` faz
 * `garantir()` + `syncPermissions(Permission::all())` do Administrador).
 *
 * Sem isto, a clínica que já existe não recebe a permissão: o `ClinicaObserver` concede o catálogo na
 * CRIAÇÃO da clínica, e o deploy roda `migrate --force`, não `db:seed`.
 *
 * DELIBERADO: nenhum backfill para outros níveis — nem para o dos profissionais. Ver o próprio
 * recebido na ficha é decisão da clínica (proposta, 2026-10-15), concedida pela grade de permissões
 * com o rosto de quem decidiu; o deploy não liga o dinheiro na ficha de ninguém.
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
