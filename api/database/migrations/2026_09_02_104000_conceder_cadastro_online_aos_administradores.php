<?php

use Database\Seeders\CatalogoPermissoesSeeder;
use Illuminate\Database\Migrations\Migration;

/**
 * Deploy da change cadastro-online-do-paciente (spec rbac): `cadastro_online.conferir` entra no
 * catálogo e é ressincronizada SÓ nos níveis Administrador da clínica.
 *
 * Sem isto, a clínica que já existe não recebe a ação:
 * o `ClinicaObserver` concede o catálogo na CRIAÇÃO da clínica, e o deploy roda `migrate --force`,
 * não `db:seed`. O efeito seria pior que "botão faltando": a clínica ligaria o link, as famílias
 * mandariam cadastro de MENOR para uma fila que ninguém consegue abrir (403), e em 30 dias o
 * expurgo apagaria tudo — coleta de dado de criança sem finalidade atendível, o oposto do que a
 * §12 exige. Foi o parecer PÓS-código quem pegou (SEC-CO-32).
 *
 * DELIBERADO: nenhum backfill para outros níveis. Quem confere cadastro de criança que veio de
 * fora é decisão de administração — a clínica distribui a ação para a recepção pela tela de
 * níveis, com o rosto de quem decidiu.
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
