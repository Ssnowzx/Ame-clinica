<?php

use App\Support\Indicadores\CapacidadeDoMes;

/**
 * A conta da capacidade pela grade REAL (change produtividade-do-profissional, D1), em unidade —
 * a classe é pura, e cada teste prova UMA regra.
 *
 * Calendário fixo, para o teste não mudar de resposta com o mês corrente:
 *   setembro/2026 (30 dias): 1º é TERÇA → terça ×5 (1, 8, 15, 22, 29), quarta ×5, os outros ×4
 *   fevereiro/2026 (28 dias): todo dia da semana ×4
 *   março/2026 (31 dias): domingo, segunda e terça ×5; os outros ×4
 */
const TERCA_MANHA = [2 => [['inicio' => '08:00', 'fim' => '12:00']]]; // 240 min × 5 terças = 1200

it('deve somar as janelas do dia da semana em cada dia do mês', function () {
    // ARRANGE + ACT — só terças, 08:00–12:00, sem feriado nem bloqueio
    $capacidade = CapacidadeDoMes::calcular(2026, 9, TERCA_MANHA, [], []);

    // ASSERT — 5 terças × 240; a quebra por dia da semana tem as 7 entradas ISO e só a terça soma
    expect($capacidade['minutos_na_grade'])->toBe(1200)
        ->and($capacidade['minutos_em_feriados'])->toBe(0)
        ->and($capacidade['minutos_em_bloqueios'])->toBe(0)
        ->and($capacidade['por_dia_da_semana'])->toBe([1 => 0, 2 => 1200, 3 => 0, 4 => 0, 5 => 0, 6 => 0, 7 => 0]);
});

it('deve mandar os minutos do feriado fixo para minutos_em_feriados e tirá-los da grade', function () {
    // ARRANGE — 8/9/2026 é terça; o feriado fixo em outra data (uma quarta) não toca a grade
    $feriados = [
        ['data' => '2026-09-08', 'recorrente' => false],
        ['data' => '2026-09-09', 'recorrente' => false],
    ];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, TERCA_MANHA, $feriados, []);

    // ASSERT
    expect($capacidade['minutos_na_grade'])->toBe(960)
        ->and($capacidade['minutos_em_feriados'])->toBe(240)
        ->and($capacidade['por_dia_da_semana'][2])->toBe(960);
});

it('deve reconhecer o feriado recorrente pelo dia-mês de QUALQUER ano, e o fixo de outro ano não', function () {
    // ARRANGE — 15/9 recorrente cadastrado em 2020 vale em 2026 (terça); 22/9/2020 FIXO não vale
    // em 22/9/2026 — a mesma regra de `feriadoDoDia` no web
    $feriados = [
        ['data' => '2020-09-15', 'recorrente' => true],
        ['data' => '2020-09-22', 'recorrente' => false],
    ];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, TERCA_MANHA, $feriados, []);

    // ASSERT — só uma terça descontada
    expect($capacidade['minutos_na_grade'])->toBe(960)
        ->and($capacidade['minutos_em_feriados'])->toBe(240);
});

it('deve descontar do bloqueio só a interseção com a janela', function () {
    // ARRANGE — bloqueio 07:00–09:00 numa terça com janela 08:00–12:00: só 60 caem dentro
    $bloqueios = [['inicio' => '2026-09-01 07:00:00', 'fim' => '2026-09-01 09:00:00']];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, TERCA_MANHA, [], $bloqueios);

    // ASSERT
    expect($capacidade['minutos_em_bloqueios'])->toBe(60)
        ->and($capacidade['minutos_na_grade'])->toBe(1140)
        ->and($capacidade['por_dia_da_semana'][2])->toBe(1140);
});

it('deve ignorar o bloqueio fora da janela e o bloqueio em dia sem janela', function () {
    // ARRANGE — terça à tarde (fora da janela da manhã) e segunda (dia sem janela)
    $bloqueios = [
        ['inicio' => '2026-09-01 13:00:00', 'fim' => '2026-09-01 15:00:00'],
        ['inicio' => '2026-09-07 08:00:00', 'fim' => '2026-09-07 10:00:00'],
    ];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, TERCA_MANHA, [], $bloqueios);

    // ASSERT
    expect($capacidade['minutos_em_bloqueios'])->toBe(0)
        ->and($capacidade['minutos_na_grade'])->toBe(1200);
});

it('deve devolver zero em tudo sem janela configurada, com as 7 entradas da quebra', function () {
    // ARRANGE — sem janela; feriado e bloqueio não têm o que descontar
    $feriados = [['data' => '2026-09-08', 'recorrente' => false]];
    $bloqueios = [['inicio' => '2026-09-01 08:00:00', 'fim' => '2026-09-01 10:00:00']];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, [], $feriados, $bloqueios);

    // ASSERT
    expect($capacidade)->toBe([
        'minutos_na_grade' => 0,
        'minutos_em_feriados' => 0,
        'minutos_em_bloqueios' => 0,
        'por_dia_da_semana' => [1 => 0, 2 => 0, 3 => 0, 4 => 0, 5 => 0, 6 => 0, 7 => 0],
    ]);
});

it('deve contar as segundas de um mês de 28 dias e de um mês de 31 dias', function () {
    // ARRANGE — segunda 09:00–10:00 (60 min); fevereiro/2026 tem 4 segundas, março/2026 tem 5
    $segunda = [1 => [['inicio' => '09:00', 'fim' => '10:00']]];

    // ACT
    $fevereiro = CapacidadeDoMes::calcular(2026, 2, $segunda, [], []);
    $marco = CapacidadeDoMes::calcular(2026, 3, $segunda, [], []);

    // ASSERT
    expect($fevereiro['minutos_na_grade'])->toBe(240)
        ->and($marco['minutos_na_grade'])->toBe(300);
});

it('deve somar dois turnos no mesmo dia e descontar um bloqueio que atravessa os dois', function () {
    // ARRANGE — terça 08:00–12:00 e 13:00–17:00 (480 × 5 = 2400); bloqueio 11:00–14:00 numa
    // terça: 60 no primeiro turno + 60 no segundo, e o almoço (12:00–13:00) não é grade
    $turnos = [2 => [
        ['inicio' => '08:00', 'fim' => '12:00'],
        ['inicio' => '13:00', 'fim' => '17:00'],
    ]];
    $bloqueios = [['inicio' => '2026-09-01 11:00:00', 'fim' => '2026-09-01 14:00:00']];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, $turnos, [], $bloqueios);

    // ASSERT
    expect($capacidade['minutos_em_bloqueios'])->toBe(120)
        ->and($capacidade['minutos_na_grade'])->toBe(2280);
});

it('deve descontar o dia de feriado uma vez só, mesmo com bloqueio nele', function () {
    // ARRANGE — feriado na terça 8/9 E um bloqueio dentro da janela desse dia
    $feriados = [['data' => '2026-09-08', 'recorrente' => false]];
    $bloqueios = [['inicio' => '2026-09-08 08:00:00', 'fim' => '2026-09-08 10:00:00']];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, TERCA_MANHA, $feriados, $bloqueios);

    // ASSERT — 240 em feriados, 0 em bloqueios, e a grade desconta 240 e não 360
    expect($capacidade['minutos_em_feriados'])->toBe(240)
        ->and($capacidade['minutos_em_bloqueios'])->toBe(0)
        ->and($capacidade['minutos_na_grade'])->toBe(960);
});

it('deve contar bloqueios sobrepostos uma vez só', function () {
    // ARRANGE — 08:00–10:00 e 09:00–11:00 na mesma terça cobrem 08:00–11:00 = 180, não 240
    $bloqueios = [
        ['inicio' => '2026-09-01 09:00:00', 'fim' => '2026-09-01 11:00:00'],
        ['inicio' => '2026-09-01 08:00:00', 'fim' => '2026-09-01 10:00:00'],
    ];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, TERCA_MANHA, [], $bloqueios);

    // ASSERT
    expect($capacidade['minutos_em_bloqueios'])->toBe(180)
        ->and($capacidade['minutos_na_grade'])->toBe(1020);
});

it('deve descontar de cada dia a parte de um bloqueio de vários dias', function () {
    // ARRANGE — bloqueio de segunda 7/9 08:00 a quarta 9/9 19:00 cobre a terça 8/9 inteira
    $bloqueios = [['inicio' => '2026-09-07 08:00:00', 'fim' => '2026-09-09 19:00:00']];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, TERCA_MANHA, [], $bloqueios);

    // ASSERT
    expect($capacidade['minutos_em_bloqueios'])->toBe(240)
        ->and($capacidade['minutos_na_grade'])->toBe(960);
});

it('deve manter a soma da quebra por dia da semana igual aos minutos na grade', function () {
    // ARRANGE — terça e quinta, com feriado numa terça e bloqueio numa quinta
    $janelas = [
        2 => [['inicio' => '08:00', 'fim' => '12:00']],
        4 => [['inicio' => '14:00', 'fim' => '18:00']],
    ];
    $feriados = [['data' => '2026-09-08', 'recorrente' => false]];
    $bloqueios = [['inicio' => '2026-09-03 14:00:00', 'fim' => '2026-09-03 15:00:00']];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, $janelas, $feriados, $bloqueios);

    // ASSERT — terça: 4 × 240 = 960; quinta: 4 × 240 − 60 = 900
    expect(array_keys($capacidade['por_dia_da_semana']))->toBe([1, 2, 3, 4, 5, 6, 7])
        ->and($capacidade['por_dia_da_semana'][2])->toBe(960)
        ->and($capacidade['por_dia_da_semana'][4])->toBe(900)
        ->and(array_sum($capacidade['por_dia_da_semana']))->toBe($capacidade['minutos_na_grade'])
        ->and($capacidade['minutos_na_grade'])->toBe(1860);
});

it('deve contar sábado e DOMINGO como 6 e 7 (ISO), não como 6 e 0', function () {
    // ARRANGE — a guarda que faltava: sem janela no dia 7, trocar `format('N')` por `format('w')`
    // (domingo 7 → 0) sobrevivia a toda a suíte, porque nenhum teste tinha o dia (achado CR-06).
    // Setembro/2026: 4 sábados (5, 12, 19, 26) e 4 domingos (6, 13, 20, 27).
    $fimDeSemana = [
        6 => [['inicio' => '09:00', 'fim' => '11:00']],  // 120 min × 4 = 480
        7 => [['inicio' => '14:00', 'fim' => '17:00']],  // 180 min × 4 = 720
    ];

    // ACT
    $capacidade = CapacidadeDoMes::calcular(2026, 9, $fimDeSemana, [], []);

    // ASSERT
    expect($capacidade['minutos_na_grade'])->toBe(1200)
        ->and($capacidade['por_dia_da_semana'][6])->toBe(480)
        ->and($capacidade['por_dia_da_semana'][7])->toBe(720)
        ->and($capacidade['por_dia_da_semana'][1])->toBe(0);
});

it('deve partir a janela que atravessa o meio-dia e as 18h nas três faixas do dia', function () {
    // ARRANGE — uma terça só (1/9/2026), 10:00–19:30: manhã 120, tarde 360, noite 90
    $janelas = [2 => [['inicio' => '10:00', 'fim' => '19:30']]];

    // ACT
    $porFaixa = CapacidadeDoMes::porFaixaDoDia('2026-09-01', '2026-09-01', $janelas, [], []);

    // ASSERT — as 7 entradas ISO, só a terça soma
    expect($porFaixa[2])->toBe(['manha' => 120, 'tarde' => 360, 'noite' => 90])
        ->and(array_keys($porFaixa))->toBe([1, 2, 3, 4, 5, 6, 7])
        ->and($porFaixa[3])->toBe(['manha' => 0, 'tarde' => 0, 'noite' => 0]);
});

it('deve recortar a capacidade por faixa aos dias do período, não ao mês', function () {
    // ARRANGE — terças 08:00–12:00; de 1 a 10/9/2026 há duas terças (1 e 8)
    // ACT
    $porFaixa = CapacidadeDoMes::porFaixaDoDia('2026-09-01', '2026-09-10', TERCA_MANHA, [], []);

    // ASSERT
    expect($porFaixa[2]['manha'])->toBe(480);
});

it('deve descontar feriado e bloqueio na faixa em que caem', function () {
    // ARRANGE — terças 08:00–17:00 em setembro/2026; feriado em 8/9; bloqueio 11:00–13:00 em 15/9
    $janelas = [2 => [['inicio' => '08:00', 'fim' => '17:00']]];
    $feriados = [['data' => '2026-09-08', 'recorrente' => false]];
    $bloqueios = [['inicio' => '2026-09-15 11:00:00', 'fim' => '2026-09-15 13:00:00']];

    // ACT
    $porFaixa = CapacidadeDoMes::porFaixaDoDia('2026-09-01', '2026-09-30', $janelas, $feriados, $bloqueios);

    // ASSERT — 4 terças úteis: manhã 4 × 240 − 60; tarde 4 × 300 − 60
    expect($porFaixa[2])->toBe(['manha' => 900, 'tarde' => 1140, 'noite' => 0]);
});

it('deve somar nas faixas do mês inteiro exatamente os minutos na grade do mês', function () {
    // ARRANGE — a mesma cena do teste da quebra por dia da semana: duas faixas, feriado e bloqueio
    $janelas = [
        2 => [['inicio' => '08:00', 'fim' => '12:00']],
        4 => [['inicio' => '11:00', 'fim' => '19:00']],
    ];
    $feriados = [['data' => '2026-09-08', 'recorrente' => false]];
    $bloqueios = [['inicio' => '2026-09-03 11:30:00', 'fim' => '2026-09-03 18:30:00']];

    // ACT
    $doMes = CapacidadeDoMes::calcular(2026, 9, $janelas, $feriados, $bloqueios);
    $porFaixa = CapacidadeDoMes::porFaixaDoDia('2026-09-01', '2026-09-30', $janelas, $feriados, $bloqueios);

    // ASSERT — as duas contas são a MESMA grade: a partição por faixa não perde nem ganha minuto
    expect(array_sum(array_map('array_sum', $porFaixa)))->toBe($doMes['minutos_na_grade']);
});
