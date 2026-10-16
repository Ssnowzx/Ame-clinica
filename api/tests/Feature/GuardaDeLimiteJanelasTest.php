<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\RegraLimiteConvenio;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Agenda\GuardaDeLimiteDoConvenio;
use Carbon\Carbon;
use Carbon\CarbonInterface;

/**
 * O CORTE de cada janela (D2), provado direto no serviço: regra `avisar` com
 * limite 1 — sessão existente DENTRO da janela ⇒ aviso; FORA ⇒ null. Tudo na
 * parede da clínica (o `inicio` armazenado JÁ é parede — convenção da agenda).
 */
function cenarioDeJanela(string $periodo): array
{
    $base = baseDeAgenda();
    $convenio = Convenio::create(['nome' => 'Operadora Fictícia '.fake()->unique()->word()]);
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'convenio_id' => $convenio->id,
        'especialidade_id' => $base['especialidade_id'],
        'profissional_id' => $base['profissional_id'],
        'sessoes_total' => 100,
    ]);
    $regra = new RegraLimiteConvenio(['periodo' => $periodo, 'limite' => 1, 'acao' => 'avisar']);
    $regra->convenio_id = $convenio->id;
    $regra->save();

    return [$base, $tratamento];
}

/** Sessão existente direto no banco, no status inicial (ocupa) da clínica. */
function sessaoExistenteEm(array $base, Tratamento $tratamento, Carbon $inicio): Agendamento
{
    return Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'especialidade_id' => $base['especialidade_id'],
        'profissional_id' => $base['profissional_id'],
        'tratamento_id' => $tratamento->id,
        'status_id' => StatusAgendamento::inicialId(),
        'inicio' => $inicio->copy(),
        'fim' => $inicio->copy()->addMinutes(40),
    ]);
}

/** Avalia um candidato hipotético no serviço (leitura da regra `avisar`). */
function avaliarCandidatoEm(array $base, Tratamento $tratamento, Carbon $inicio): ?array
{
    return app(GuardaDeLimiteDoConvenio::class)->avaliar([
        'tipo' => 'atendimento',
        'paciente_id' => $base['paciente_id'],
        'especialidade_id' => $base['especialidade_id'],
        'status_id' => StatusAgendamento::inicialId(),
        'inicio' => $inicio,
    ], $tratamento->id);
}

it('deve cortar a janela do DIA na virada da meia-noite', function () {
    // ARRANGE — sessão às 23:00 do dia D
    admin();
    [$base, $tratamento] = cenarioDeJanela('dia');
    $dia = agoraNaClinica()->addDays(10)->setTime(23, 0)->setSeconds(0);
    sessaoExistenteEm($base, $tratamento, $dia);

    // ACT + ASSERT — mesmo dia conta; 00:30 do dia seguinte já é outra janela
    expect(avaliarCandidatoEm($base, $tratamento, $dia->copy()->setTime(8, 0)))->not->toBeNull()
        ->and(avaliarCandidatoEm($base, $tratamento, $dia->copy()->addDay()->setTime(0, 30)))->toBeNull();
});

it('deve cortar a janela da SEMANA no padrão ISO: segunda a domingo', function () {
    // ARRANGE — sessão na SEGUNDA da semana S
    admin();
    [$base, $tratamento] = cenarioDeJanela('semana');
    $segunda = agoraNaClinica()->addWeeks(3)->startOfWeek(CarbonInterface::MONDAY)->setTime(9, 0);
    sessaoExistenteEm($base, $tratamento, $segunda);

    // ACT + ASSERT — o DOMINGO da mesma semana ISO conta; a segunda seguinte não
    expect(avaliarCandidatoEm($base, $tratamento, $segunda->copy()->addDays(6)))->not->toBeNull()
        ->and(avaliarCandidatoEm($base, $tratamento, $segunda->copy()->addDays(7)))->toBeNull();
});

it('deve cortar a janela do MÊS no calendário', function () {
    // ARRANGE — sessão no ÚLTIMO dia do mês M
    admin();
    [$base, $tratamento] = cenarioDeJanela('mes');
    $ultimoDia = agoraNaClinica()->addMonths(2)->endOfMonth()->setTime(9, 0)->setSeconds(0);
    sessaoExistenteEm($base, $tratamento, $ultimoDia);

    // ACT + ASSERT — o dia 1º do MESMO mês conta; o 1º do mês seguinte não
    expect(avaliarCandidatoEm($base, $tratamento, $ultimoDia->copy()->startOfMonth()->setTime(9, 0)))->not->toBeNull()
        ->and(avaliarCandidatoEm($base, $tratamento, $ultimoDia->copy()->addDay()->setTime(9, 0)))->toBeNull();
});

it('deve devolver o aviso na leitura sem nunca lançar para regra bloquear', function () {
    // ARRANGE — leitura do painel (bloquear: false): regra `bloquear` excedida por
    // dado que mudou DEPOIS da escrita não pode derrubar o show em 422
    admin();
    [$base, $tratamento] = cenarioDeJanela('dia');
    $regraAvisar = RegraLimiteConvenio::firstOrFail();
    $regraAvisar->update(['acao' => 'bloquear']);
    $dia = agoraNaClinica()->addDays(10)->setTime(9, 0)->setSeconds(0);
    sessaoExistenteEm($base, $tratamento, $dia);
    $emVista = sessaoExistenteEm($base, $tratamento, $dia->copy()->setTime(11, 0));

    // ACT + ASSERT — a leitura não lança nem sinaliza (só `avisar` sinaliza no painel)
    expect(app(GuardaDeLimiteDoConvenio::class)->avisoNaLeitura($emVista))->toBeNull();

    // com a regra `avisar`, a MESMA leitura sinaliza
    $regraAvisar->update(['acao' => 'avisar']);
    expect(app(GuardaDeLimiteDoConvenio::class)->avisoNaLeitura($emVista))->not->toBeNull();
});
