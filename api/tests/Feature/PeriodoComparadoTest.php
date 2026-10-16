<?php

use App\Support\Indicadores\PeriodoComparado;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

/**
 * O período comparado dos painéis (change indicadores-profissionais, D2). Mora em `Feature` só
 * porque o 422 do mês futuro precisa do validador do framework; a conta em si é pura e o relógio é
 * sempre injetado — nenhum teste depende do dia em que roda.
 */
const FUSO_DO_PERIODO = 'America/Sao_Paulo';

/** O relógio na PAREDE da clínica ("Y-m-d H:i"). */
function relogioDoPeriodo(string $quando): CarbonImmutable
{
    return CarbonImmutable::createFromFormat('Y-m-d H:i', $quando, FUSO_DO_PERIODO);
}

it('deve comparar o dia 1 ao dia 5 com o dia 1 ao dia 5 do mês anterior no mês em curso', function () {
    // ARRANGE + ACT — 5 de outubro, 10h
    $periodo = PeriodoComparado::doMes('2026-10', FUSO_DO_PERIODO, relogioDoPeriodo('2026-10-05 10:00'));

    // ASSERT
    expect($periodo->paraResposta())->toBe([
        'mes' => '2026-10',
        'de' => '2026-10-01',
        'ate' => '2026-10-05',
        'parcial' => true,
        'comparado_de' => '2026-09-01',
        'comparado_ate' => '2026-09-05',
    ]);
});

it('deve limitar a comparação de 31 de março ao último dia de fevereiro', function () {
    // ARRANGE + ACT — 2026 não é bissexto
    $periodo = PeriodoComparado::doMes('2026-03', FUSO_DO_PERIODO, relogioDoPeriodo('2026-03-31 09:00'));

    // ASSERT
    expect($periodo->paraResposta()['comparado_de'])->toBe('2026-02-01')
        ->and($periodo->paraResposta()['comparado_ate'])->toBe('2026-02-28')
        ->and($periodo->paraResposta()['ate'])->toBe('2026-03-31')
        ->and($periodo->parcial)->toBeTrue();
});

it('deve comparar 31 de março com até 29 de fevereiro no ano bissexto', function () {
    // ARRANGE + ACT — 2028 é bissexto
    $periodo = PeriodoComparado::doMes('2028-03', FUSO_DO_PERIODO, relogioDoPeriodo('2028-03-31 09:00'));

    // ASSERT
    expect($periodo->paraResposta()['comparado_ate'])->toBe('2028-02-29');
});

it('deve comparar o mês fechado inteiro com o mês anterior inteiro', function () {
    // ARRANGE + ACT — setembro pedido em 5 de outubro
    $periodo = PeriodoComparado::doMes('2026-09', FUSO_DO_PERIODO, relogioDoPeriodo('2026-10-05 10:00'));

    // ASSERT
    expect($periodo->paraResposta())->toBe([
        'mes' => '2026-09',
        'de' => '2026-09-01',
        'ate' => '2026-09-30',
        'parcial' => false,
        'comparado_de' => '2026-08-01',
        'comparado_ate' => '2026-08-31',
    ]);
});

it('deve recusar o mês futuro com erro de validação no campo mes', function () {
    // ARRANGE + ACT
    $tentativa = fn () => PeriodoComparado::doMes('2026-11', FUSO_DO_PERIODO, relogioDoPeriodo('2026-10-05 10:00'));

    // ASSERT
    expect($tentativa)->toThrow(ValidationException::class);
    try {
        $tentativa();
    } catch (ValidationException $erro) {
        expect(array_keys($erro->errors()))->toBe(['mes']);
    }
});

it('deve usar o dia da clínica às 23h30, quando o UTC já virou o dia seguinte', function () {
    // ARRANGE — 6/10 02:30 UTC é 5/10 23:30 em Brasília
    $relogio = CarbonImmutable::parse('2026-10-06 02:30:00', 'UTC');

    // ACT
    $periodo = PeriodoComparado::doMes('2026-10', FUSO_DO_PERIODO, $relogio);

    // ASSERT — ainda é dia 5 na clínica
    expect($periodo->paraResposta()['ate'])->toBe('2026-10-05')
        ->and($periodo->paraResposta()['comparado_ate'])->toBe('2026-09-05')
        ->and($periodo->agoraNaParede())->toBe('2026-10-05 23:30:00');
});

it('deve tratar o mês seguinte como futuro às 23h30 do último dia, quando o UTC já virou o mês', function () {
    // ARRANGE — 1/11 02:30 UTC é 31/10 23:30 em Brasília
    $relogio = CarbonImmutable::parse('2026-11-01 02:30:00', 'UTC');

    // ACT + ASSERT — novembro ainda não começou na clínica; outubro é o mês em curso
    expect(fn () => PeriodoComparado::doMes('2026-11', FUSO_DO_PERIODO, $relogio))->toThrow(ValidationException::class);
    expect(PeriodoComparado::doMes('2026-10', FUSO_DO_PERIODO, $relogio)->paraResposta()['ate'])->toBe('2026-10-31');
});

it('deve comparar o dia 1 com o dia 1 no primeiro dia do mês', function () {
    // ARRANGE + ACT
    $periodo = PeriodoComparado::doMes('2026-10', FUSO_DO_PERIODO, relogioDoPeriodo('2026-10-01 08:00'));

    // ASSERT
    expect($periodo->paraResposta()['de'])->toBe('2026-10-01')
        ->and($periodo->paraResposta()['ate'])->toBe('2026-10-01')
        ->and($periodo->paraResposta()['comparado_ate'])->toBe('2026-09-01');
});

it('deve converter os limites da parede para UTC nas colunas gravadas pelo framework', function () {
    // ARRANGE
    $periodo = PeriodoComparado::doMes('2026-10', FUSO_DO_PERIODO, relogioDoPeriodo('2026-10-05 10:00'));

    // ACT
    $utc = $periodo->emUtc($periodo->limites());

    // ASSERT — Brasília é UTC−3: meia-noite local é 03:00 UTC
    expect($periodo->limites())->toBe(['2026-10-01 00:00:00', '2026-10-05 23:59:59'])
        ->and($utc)->toBe(['2026-10-01 03:00:00', '2026-10-06 02:59:59']);
});

it('deve listar os seis meses da série terminando no mês pedido', function () {
    // ARRANGE
    $periodo = PeriodoComparado::doMes('2026-03', FUSO_DO_PERIODO, relogioDoPeriodo('2026-10-05 10:00'));

    // ACT + ASSERT — atravessa a virada do ano
    expect($periodo->mesesDaSerie())->toBe(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
});

it('deve recusar o mês fora do formato AAAA-MM', function () {
    // ARRANGE + ACT + ASSERT
    expect(fn () => PeriodoComparado::doMes('2026-13', FUSO_DO_PERIODO, relogioDoPeriodo('2026-10-05 10:00')))
        ->toThrow(ValidationException::class);
});

it('deve recusar o mês anterior a janeiro de 2000 com erro de validação no campo mes', function () {
    // ARRANGE + ACT — o ano 0001 levava a série e o mês anterior a datas que o banco não representa
    $tentativas = array_map(
        fn (string $mes): Closure => fn () => PeriodoComparado::doMes($mes, FUSO_DO_PERIODO, relogioDoPeriodo('2026-10-05 10:00')),
        ['1999-12', '0001-01', '0000-01'],
    );

    // ASSERT
    foreach ($tentativas as $tentativa) {
        expect($tentativa)->toThrow(ValidationException::class, 'Informe um mês a partir de janeiro de 2000.');
    }
});

it('deve aceitar janeiro de 2000, o primeiro mês que um painel mede', function () {
    // ARRANGE + ACT
    $periodo = PeriodoComparado::doMes('2000-01', FUSO_DO_PERIODO, relogioDoPeriodo('2026-10-05 10:00'));

    // ASSERT — mês fechado, contra dezembro de 1999 (que não tem histórico: a comparação some no painel)
    expect($periodo->paraResposta()['comparado_de'])->toBe('1999-12-01')
        ->and($periodo->parcial)->toBeFalse();
});

it('deve responder 422 nos quatro painéis ao mês anterior a 2000, e 200 a janeiro de 2000', function () {
    // ARRANGE
    $this->travelTo(relogioDoPeriodo('2026-10-05 10:00'));
    $this->actingAs(admin());

    foreach (['dinheiro', 'agenda', 'pacientes', 'equipe'] as $frente) {
        // ACT + ASSERT (SEC-IND-03)
        $this->getJson("/api/indicadores/painel/{$frente}?mes=1999-12")->assertUnprocessable()->assertJsonValidationErrors('mes');
        $this->getJson("/api/indicadores/painel/{$frente}?mes=0001-01")->assertUnprocessable()->assertJsonValidationErrors('mes');
        $this->getJson("/api/indicadores/painel/{$frente}?mes=2000-01")->assertOk();
    }
});
