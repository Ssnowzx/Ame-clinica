<?php

use Illuminate\Support\Facades\DB;

/**
 * Change tema-menta: a migração troca o valor `neurokids` por `menta` na configuração da clínica, e só
 * ele — o visual é o mesmo bloco de CSS, renomeado, e a clínica que usava o tema não percebe diferença.
 */
function migracaoDoTemaMenta(): object
{
    return require database_path('migrations/2026_10_15_120000_renomear_tema_neurokids_para_menta.php');
}

function gravarTema(string $tema): void
{
    DB::table('configuracoes')->insert([
        'chave' => 'clinica.tema', 'valor' => $tema,
        'created_at' => now(), 'updated_at' => now(),
    ]);
}

function temaGravado(): ?string
{
    return DB::table('configuracoes')->where('chave', 'clinica.tema')->value('valor');
}

it('deve trocar neurokids por menta', function () {
    // ARRANGE — a clínica no tema antigo
    gravarTema('neurokids');

    // ACT
    migracaoDoTemaMenta()->up();

    // ASSERT
    expect(temaGravado())->toBe('menta');
});

it('não deve tocar os outros temas', function () {
    // ARRANGE — a clínica no Xclinicas
    gravarTema('xclinicas');

    // ACT
    migracaoDoTemaMenta()->up();

    // ASSERT
    expect(temaGravado())->toBe('xclinicas');
});

it('deve desfazer no down, voltando menta a neurokids', function () {
    // ARRANGE
    gravarTema('menta');

    // ACT
    migracaoDoTemaMenta()->down();

    // ASSERT
    expect(temaGravado())->toBe('neurokids');
});
