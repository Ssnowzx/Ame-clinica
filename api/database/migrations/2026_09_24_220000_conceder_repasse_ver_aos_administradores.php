<?php

use Database\Seeders\CatalogoPermissoesSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * Deploy do ajuste da change recebido-por-profissional: `repasse.ver` entra no catálogo e é
 * ressincronizada SÓ nos níveis Administrador da clínica.
 *
 * Sem isto, a clínica que já existe não recebe a permissão: o `ClinicaObserver` concede o catálogo
 * na CRIAÇÃO da clínica, e o deploy roda `migrate --force`, não `db:seed` — o relatório "Recebido
 * por profissional", que passa a exigi-la, sumiria até para o Administrador.
 *
 * DELIBERADO: nenhum backfill para outros níveis. Quem monta o fechamento por profissional é a
 * faturista (decisão da clínica 2026-07-19), e a clínica concede `repasse.ver` a ela pela tela de
 * níveis, com o rosto de quem decidiu — a recepção não a recebe.
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
