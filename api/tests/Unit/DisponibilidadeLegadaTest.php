<?php

use App\Support\Agenda\DisponibilidadeLegada;

/**
 * Rede de teste do BACKFILL da migration horarios-por-dia-do-profissional: exerce os RAMOS da
 * conversão da disponibilidade legada (janela+dias / janela+null-dias / null+null / janela padrão
 * da clínica / o `[]` inalcançável). A migration só faz o wiring de banco em cima disto (verificado
 * ao vivo na demo: 5 profissionais → 7 linhas cada, com sua janela).
 */
it('deve converter janela + dias específicos em uma linha por dia', function () {
    // ARRANGE + ACT
    $linhas = DisponibilidadeLegada::paraLinhas('09:00', '13:00', json_encode([2, 4]), '08:00', '19:00');

    // ASSERT
    expect($linhas)->toBe([
        ['dia_semana' => 2, 'inicio' => '09:00', 'fim' => '13:00'],
        ['dia_semana' => 4, 'inicio' => '09:00', 'fim' => '13:00'],
    ]);
});

it('deve converter janela SEM dias em sete linhas (todos os dias na janela)', function () {
    // ARRANGE + ACT
    $linhas = DisponibilidadeLegada::paraLinhas('08:00', '18:00', null, '08:00', '19:00');

    // ASSERT
    expect($linhas)->toHaveCount(7);
    expect(array_column($linhas, 'dia_semana'))->toBe([1, 2, 3, 4, 5, 6, 7]);
    expect($linhas[0])->toBe(['dia_semana' => 1, 'inicio' => '08:00', 'fim' => '18:00']);
});

it('deve devolver SEM linhas quando não há janela nem dias (= todos os dias na janela padrão)', function () {
    // ARRANGE + ACT
    $linhas = DisponibilidadeLegada::paraLinhas(null, null, null, '08:00', '19:00');

    // ASSERT
    expect($linhas)->toBe([]);
});

it('deve usar a janela padrão da clínica quando há dias mas não janela', function () {
    // ARRANGE + ACT — janela null, dias [1]; padrão da clínica 07:00–20:00
    $linhas = DisponibilidadeLegada::paraLinhas(null, null, json_encode([1]), '07:00', '20:00');

    // ASSERT
    expect($linhas)->toBe([
        ['dia_semana' => 1, 'inicio' => '07:00', 'fim' => '20:00'],
    ]);
});

it('deve tratar o array de dias vazio (inalcançável) como não-configurado, não como "nenhum dia"', function () {
    // ARRANGE + ACT — `[]` com janela: cai em "sem dias" → todos os dias na janela informada
    $comJanela = DisponibilidadeLegada::paraLinhas('08:00', '12:00', json_encode([]), '08:00', '19:00');
    // `[]` sem janela: nada configurado → sem linhas
    $semJanela = DisponibilidadeLegada::paraLinhas(null, null, json_encode([]), '08:00', '19:00');

    // ASSERT — nunca "atende em nenhum dia" (o modelo novo não representa isso)
    expect($comJanela)->toHaveCount(7);
    expect($semJanela)->toBe([]);
});
