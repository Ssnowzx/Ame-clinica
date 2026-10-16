<?php

use Database\Seeders\CargaDeTesteSeeder;

/**
 * A RÉGUA do piso (task 1.4 da change produtividade-do-profissional): 20 profissionais com a
 * grade cheia (`CargaDeTesteSeeder`, o piso do CLAUDE.md) e a rota respondendo em p95 < 300 ms
 * (o piso do perf-engineer). Não prova comportamento — mede — e por isso só roda quando pedida:
 *
 *     MEDIR_CARGA=1 php -d memory_limit=2G vendor/bin/pest tests/Feature/IndicadoresProdutividadeCargaTest.php
 *
 * O número medido fica registrado no commit da change, não aqui: a régua é para RE-medir quando
 * a conta mudar. A cena é 100% fictícia (LGPD) e nasce dentro da transação do teste.
 */
it('deve responder a produtividade de 20 profissionais em p95 abaixo de 300 ms', function () {
    // ARRANGE — a carga do piso na clínica do teste; o mês é o da carga (a partir de hoje)
    $this->actingAs(admin());
    $this->seed(CargaDeTesteSeeder::class);
    $mes = agoraNaClinica()->format('Y-m');
    $rota = "/api/indicadores/produtividade?mes={$mes}";

    // aquece (autoload, container, conexão) e confere que a cena é DENSA: 20 linhas e a grade
    // cheia (20 × ~16 slots × 5 dias úteis) — um número medido sobre agenda vazia não é piso
    $aquecimento = $this->getJson($rota)->assertOk()->assertJsonCount(20, 'linhas');
    expect($aquecimento->json('totais.marcados'))->toBeGreaterThan(1000);

    // ACT — 20 chamadas medidas pelo relógio monotônico
    $tempos = [];
    for ($i = 0; $i < 20; $i++) {
        $inicio = hrtime(true);
        $this->getJson($rota)->assertOk();
        $tempos[] = (hrtime(true) - $inicio) / 1e6;
    }
    sort($tempos);
    $p50 = $tempos[(int) floor(0.50 * count($tempos))];
    $p95 = $tempos[(int) ceil(0.95 * count($tempos)) - 1];

    // ASSERT — o número vai para a saída, para ser copiado no commit
    fwrite(STDERR, sprintf(
        "\nprodutividade · 20 profissionais · %s: p50 %.0f ms · p95 %.0f ms · max %.0f ms\n",
        $mes, $p50, $p95, max($tempos),
    ));
    expect($p95)->toBeLessThan(300);
})->skip(getenv('MEDIR_CARGA') !== '1', 'régua de carga — rode com MEDIR_CARGA=1');
