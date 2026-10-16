<?php

use App\Support\Ciclos\CalendarioDoCiclo;
use Carbon\CarbonImmutable;

/**
 * A derivação do período do ciclo (task 1.2 · D1).
 *
 * O teste que carrega o peso aqui é o de PARTIÇÃO (SEC-FC-21): ele é a prova de que o
 * domínio 1..28 está certo. Sem ele, "1..28" é uma opinião no docblock.
 */
it('deve derivar o período do corte em dia fixo — 15 dá 16→15', function () {
    // ARRANGE — o calendário da Unimed (decisão da clínica 2026-07-19)
    $tipo = CalendarioDoCiclo::TIPO_DIA_FIXO;

    // ACT — uma data DEPOIS do corte cai no período que termina no corte SEGUINTE
    $depoisDoCorte = CalendarioDoCiclo::janelaQueContem($tipo, 15, CarbonImmutable::parse('2026-07-20'));
    // ...e uma data ATÉ o corte (inclusive) cai no período que termina nele
    $ateOCorte = CalendarioDoCiclo::janelaQueContem($tipo, 15, CarbonImmutable::parse('2026-07-10'));
    $noProprioCorte = CalendarioDoCiclo::janelaQueContem($tipo, 15, CarbonImmutable::parse('2026-07-15'));

    // ASSERT
    expect($depoisDoCorte)->toBe(['periodo_inicio' => '2026-07-16', 'periodo_fim' => '2026-08-15']);
    expect($ateOCorte)->toBe(['periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15']);
    expect($noProprioCorte)->toBe(['periodo_inicio' => '2026-06-16', 'periodo_fim' => '2026-07-15']);
});

it('deve derivar o mês calendário no corte de último dia', function () {
    // ARRANGE — o calendário da SC Saúde
    $tipo = CalendarioDoCiclo::TIPO_ULTIMO_DIA;

    // ACT — fevereiro de ano NÃO bissexto é a fronteira que quebra derivação ingênua
    $fevereiro = CalendarioDoCiclo::janelaQueContem($tipo, null, CarbonImmutable::parse('2026-02-10'));
    $fevereiroBissexto = CalendarioDoCiclo::janelaQueContem($tipo, null, CarbonImmutable::parse('2028-02-10'));

    // ASSERT
    expect($fevereiro)->toBe(['periodo_inicio' => '2026-02-01', 'periodo_fim' => '2026-02-28']);
    expect($fevereiroBissexto)->toBe(['periodo_inicio' => '2028-02-01', 'periodo_fim' => '2028-02-29']);
});

it('deve atravessar fevereiro no corte 28 sem inventar 29 de fevereiro', function () {
    // ARRANGE — 28 é o teto do domínio, e é onde a aritmética ingênua "D+1" morre:
    // ela derivaria início em 29/02, que em 2026 não existe
    $tipo = CalendarioDoCiclo::TIPO_DIA_FIXO;

    // ACT
    $ateFevereiro = CalendarioDoCiclo::janelaQueContem($tipo, 28, CarbonImmutable::parse('2026-02-10'));
    $marco = CalendarioDoCiclo::janelaQueContem($tipo, 28, CarbonImmutable::parse('2026-03-10'));
    // ...e em ano bissexto o 29/02 EXISTE e é o início legítimo
    $marcoBissexto = CalendarioDoCiclo::janelaQueContem($tipo, 28, CarbonImmutable::parse('2028-03-10'));

    // ASSERT — 28/02 e 01/03 são consecutivos: nenhum dia fica de fora
    expect($ateFevereiro)->toBe(['periodo_inicio' => '2026-01-29', 'periodo_fim' => '2026-02-28']);
    expect($marco)->toBe(['periodo_inicio' => '2026-03-01', 'periodo_fim' => '2026-03-28']);
    expect($marcoBissexto)->toBe(['periodo_inicio' => '2028-02-29', 'periodo_fim' => '2028-03-28']);
});

it('deve particionar o calendário para todo corte de 1 a 28 — sem buraco e sem sobreposição', function () {
    // ARRANGE — SEC-FC-21, a prova do domínio. Percorre 24 meses consecutivos (dois anos
    // cheios, incluindo um fevereiro bissexto e um não bissexto) DIA A DIA e exige que
    // cada dia pertença a exatamente UM período derivado.
    //
    // Um buraco (dia que nenhum período contém) é um dia eternamente editável — o defeito
    // que o corte 30 com clamp produzia e que fez o domínio parar em 28. Uma sobreposição
    // é um dia em dois ciclos, e a não-sobreposição do fechamento viraria loteria.
    $inicio = CarbonImmutable::parse('2027-01-01');
    $fim = CarbonImmutable::parse('2028-12-31'); // 2028 é bissexto

    foreach (range(CalendarioDoCiclo::DIA_CORTE_MIN, CalendarioDoCiclo::DIA_CORTE_MAX) as $corte) {
        $janelasVistas = [];
        $diasCobertos = [];

        // ACT — deriva a janela de cada dia e acumula a cobertura
        for ($dia = $inicio; $dia->lessThanOrEqualTo($fim); $dia = $dia->addDay()) {
            $janela = CalendarioDoCiclo::janelaQueContem(
                CalendarioDoCiclo::TIPO_DIA_FIXO,
                $corte,
                $dia
            );

            // ASSERT (por dia) — o dia está DENTRO da janela que ele mesmo derivou
            expect($dia->format('Y-m-d'))
                ->toBeGreaterThanOrEqual($janela['periodo_inicio'], "corte {$corte}")
                ->toBeLessThanOrEqual($janela['periodo_fim'], "corte {$corte}");

            $chave = $janela['periodo_inicio'].'|'.$janela['periodo_fim'];
            $janelasVistas[$chave] = $janela;
            $diasCobertos[$dia->format('Y-m-d')] = ($diasCobertos[$dia->format('Y-m-d')] ?? 0) + 1;
        }

        // ASSERT — as janelas distintas, ordenadas, encaixam ponta a ponta: o início de
        // cada uma é EXATAMENTE o dia seguinte ao fim da anterior. Um `+2` seria buraco;
        // um `+0` seria sobreposição.
        $ordenadas = array_values($janelasVistas);
        usort($ordenadas, fn ($a, $b) => $a['periodo_inicio'] <=> $b['periodo_inicio']);

        foreach (array_slice($ordenadas, 1) as $indice => $janela) {
            $anterior = $ordenadas[$indice]; // array_slice reindexa: $indice aponta a anterior
            expect($janela['periodo_inicio'])->toBe(
                CarbonImmutable::parse($anterior['periodo_fim'])->addDay()->format('Y-m-d'),
                "corte {$corte}: as janelas {$anterior['periodo_inicio']}–{$anterior['periodo_fim']} e "
                ."{$janela['periodo_inicio']}–{$janela['periodo_fim']} não encaixam ponta a ponta"
            );
        }

        // ASSERT — e nenhum dia foi derivado para duas janelas diferentes
        expect(array_unique(array_values($diasCobertos)))->toBe([1], "corte {$corte}");
    }
});

it('deve reconhecer só a janela derivável do calendário como período fechável', function () {
    // ARRANGE — fechar um intervalo arbitrário congelaria produção fora de qualquer
    // ciclo que a operadora reconhece
    $tipo = CalendarioDoCiclo::TIPO_DIA_FIXO;

    // ACT + ASSERT
    expect(CalendarioDoCiclo::ehJanelaDerivavel($tipo, 15, '2026-06-16', '2026-07-15'))->toBeTrue();
    // fim deslocado em um dia
    expect(CalendarioDoCiclo::ehJanelaDerivavel($tipo, 15, '2026-06-16', '2026-07-16'))->toBeFalse();
    // início no dia do corte (e não no seguinte)
    expect(CalendarioDoCiclo::ehJanelaDerivavel($tipo, 15, '2026-06-15', '2026-07-15'))->toBeFalse();
    // mês calendário não é janela de dia_fixo
    expect(CalendarioDoCiclo::ehJanelaDerivavel($tipo, 15, '2026-07-01', '2026-07-31'))->toBeFalse();
    // ...mas é a janela de ultimo_dia
    expect(CalendarioDoCiclo::ehJanelaDerivavel(
        CalendarioDoCiclo::TIPO_ULTIMO_DIA, null, '2026-07-01', '2026-07-31'
    ))->toBeTrue();
});

it('deve considerar sem ciclo o convênio sem calendário configurado', function () {
    // ARRANGE + ACT + ASSERT — fail-safe do D1: `dia_fixo` sem dia não deriva nada
    expect(CalendarioDoCiclo::configurado(null, null))->toBeFalse();
    expect(CalendarioDoCiclo::configurado(CalendarioDoCiclo::TIPO_DIA_FIXO, null))->toBeFalse();
    expect(CalendarioDoCiclo::configurado(CalendarioDoCiclo::TIPO_DIA_FIXO, 29))->toBeFalse();
    expect(CalendarioDoCiclo::configurado(CalendarioDoCiclo::TIPO_DIA_FIXO, 15))->toBeTrue();
    expect(CalendarioDoCiclo::configurado(CalendarioDoCiclo::TIPO_ULTIMO_DIA, null))->toBeTrue();
});
