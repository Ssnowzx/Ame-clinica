<?php

use App\Models\StatusAgendamento;
use Illuminate\Support\Facades\DB;

/**
 * Migration de BACKFILL do ícone (T-sag-13): ela roda uma vez em produção, mas
 * a rede de proteção é aqui — idempotência e respeito
 * à escolha da clínica.
 */

/** Reexecuta o `up()` da migration de backfill sobre o estado atual do banco. */
function rodarBackfill(): void
{
    $migration = require database_path('migrations/2026_07_11_090000_backfill_tipo_dos_status_default.php');
    $migration->up();
}

it('deve preencher o ícone dos status default que estavam sem tipo', function () {
    // ARRANGE — simula o estado pré-change: os defaults existem com tipo nulo
    admin();
    DB::table('status_agendamento')->update(['tipo' => null]);

    // ACT
    rodarBackfill();

    // ASSERT
    $status = StatusAgendamento::query()->pluck('tipo', 'nome');
    expect($status['Finalizado'])->toBe('check');
    expect($status['Reposição'])->toBe('rotate-ccw');
});

it('deve ser idempotente ao rodar duas vezes', function () {
    // ARRANGE
    admin();
    DB::table('status_agendamento')->update(['tipo' => null]);

    // ACT — a mesma migration duas vezes (reexecução, replay de deploy)
    rodarBackfill();
    $primeiraPassada = StatusAgendamento::query()->pluck('tipo', 'nome')->all();
    rodarBackfill();

    // ASSERT — nada muda na segunda passada
    expect(StatusAgendamento::query()->pluck('tipo', 'nome')->all())->toBe($primeiraPassada);
});

it('deve não sobrescrever o ícone escolhido pela clínica', function () {
    // ARRANGE — a clínica trocou o ícone de um status default
    admin();
    DB::table('status_agendamento')->update(['tipo' => null]);
    StatusAgendamento::query()->where('nome', 'Finalizado')->update(['tipo' => 'bookmark']);

    // ACT
    rodarBackfill();

    // ASSERT — escolha da clínica preservada (o backfill só toca o que está nulo)
    expect(StatusAgendamento::query()->where('nome', 'Finalizado')->value('tipo'))->toBe('bookmark');
});

it('deve reverter apenas o que escreveu, sem dropar a coluna', function () {
    // ARRANGE — a clínica tem um ícone próprio; o backfill preencheu o resto
    admin();
    DB::table('status_agendamento')->update(['tipo' => null]);
    StatusAgendamento::query()->where('nome', 'Consulta')->update(['tipo' => 'bookmark']);
    rodarBackfill();

    // ACT — rollback
    $migration = require database_path('migrations/2026_07_11_090000_backfill_tipo_dos_status_default.php');
    $migration->down();

    // ASSERT — a coluna continua existindo e a escolha da clínica sobrevive
    expect(Schema::hasColumn('status_agendamento', 'tipo'))->toBeTrue();
    expect(StatusAgendamento::query()->where('nome', 'Consulta')->value('tipo'))->toBe('bookmark');
    expect(StatusAgendamento::query()->where('nome', 'Finalizado')->value('tipo'))->toBeNull();
});
