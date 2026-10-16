<?php

use App\Models\Profissional;
use Illuminate\Support\Facades\DB;

/**
 * GUARDA MECÂNICA da change horarios-por-dia-do-profissional (evolução de dias-de-atendimento).
 *
 * Horários por dia são DADO (§13): o boundary (`AgendamentoService`) RECUSA agendamento de
 * ATENDIMENTO cujo `inicio` caia FORA dos intervalos do dia — não é só o DIA, é dia + HORÁRIO. A
 * regra vive no servidor, não só na tela. SEM horários (nenhuma linha) = todos os dias/horas
 * (retrocompat). Bloqueio é isento (o profissional avisando ausência). Basta o `inicio` cair dentro
 * de algum intervalo (a sessão pode terminar após o fim do turno). Guardas sobre a resposta HTTP real.
 */

/** Define os horários do profissional-base (delete+insert direto no banco). */
function definirHorarios(int $profissionalId, array $mapa): void
{
    DB::table('profissional_horarios')->where('profissional_id', $profissionalId)->delete();

    $linhas = [];
    foreach ($mapa as $dia => $intervalos) {
        foreach ($intervalos as [$inicio, $fim]) {
            $linhas[] = [
                'profissional_id' => $profissionalId,
                'dia_semana' => $dia,
                'inicio' => $inicio,
                'fim' => $fim,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
    }
    if ($linhas !== []) {
        DB::table('profissional_horarios')->insert($linhas);
    }
}

/** Base de agenda com os horários do profissional setados. */
function baseComHorarios(array $mapa): array
{
    $base = baseDeAgenda();
    definirHorarios($base['profissional_id'], $mapa);

    return $base;
}

/** Próxima data (Y-m-d) no futuro cujo ISO weekday é `$iso` (1=segunda…7=domingo). */
function proximaDataNoDia(int $iso): string
{
    $data = agoraNaClinica()->addDay()->startOfDay();
    while ($data->isoWeekday() !== $iso) {
        $data->addDay();
    }

    return $data->format('Y-m-d');
}

it('deve recusar atendimento em dia que o profissional não atende', function () {
    // ARRANGE — atende terça (2) e quinta (4), dia inteiro; a recepção tenta uma segunda (1)
    $admin = admin();
    $base = baseComHorarios([2 => [['08:00', '19:00']], 4 => [['08:00', '19:00']]]);
    $base['inicio'] = proximaDataNoDia(1).' 09:00';

    // ACT + ASSERT
    $this->actingAs($admin)->postJson('/api/agendamentos', $base)
        ->assertUnprocessable()->assertJsonValidationErrors('inicio');
});

it('deve aceitar atendimento em dia e horário que o profissional atende', function () {
    // ARRANGE
    $admin = admin();
    $base = baseComHorarios([2 => [['08:00', '19:00']], 4 => [['08:00', '19:00']]]);
    $base['inicio'] = proximaDataNoDia(2).' 09:00'; // terça

    // ACT + ASSERT
    $this->actingAs($admin)->postJson('/api/agendamentos', $base)->assertCreated();
});

it('deve recusar atendimento num HORÁRIO fora dos intervalos do dia (almoço)', function () {
    // ARRANGE — terça 09:00–12:00 e 16:00–19:00; a recepção tenta 13:00 (no almoço)
    $admin = admin();
    $base = baseComHorarios([2 => [['09:00', '12:00'], ['16:00', '19:00']]]);
    $base['inicio'] = proximaDataNoDia(2).' 13:00';

    // ACT + ASSERT
    $this->actingAs($admin)->postJson('/api/agendamentos', $base)
        ->assertUnprocessable()->assertJsonValidationErrors('inicio');
});

it('deve aceitar atendimento no turno da tarde do dia com turno partido', function () {
    // ARRANGE — terça 09:00–12:00 e 16:00–19:00; 16:30 cai no turno da tarde
    $admin = admin();
    $base = baseComHorarios([2 => [['09:00', '12:00'], ['16:00', '19:00']]]);
    $base['inicio'] = proximaDataNoDia(2).' 16:30';

    // ACT + ASSERT
    $this->actingAs($admin)->postJson('/api/agendamentos', $base)->assertCreated();
});

it('deve recusar EDITAR um atendimento (não série) para um horário proibido', function () {
    // ARRANGE — criado numa terça válida, a recepção tenta mover para uma segunda (proibida)
    $admin = admin();
    $base = baseComHorarios([2 => [['08:00', '19:00']], 4 => [['08:00', '19:00']]]);
    $base['inicio'] = proximaDataNoDia(2).' 09:00';
    $id = $this->actingAs($admin)->postJson('/api/agendamentos', $base)->assertCreated()->json('id');

    // ACT + ASSERT
    $this->actingAs($admin)->putJsonComVersao("/api/agendamentos/{$id}", [
        'inicio' => proximaDataNoDia(1).' 09:00',
        'profissional_id' => $base['profissional_id'],
    ])->assertUnprocessable()->assertJsonValidationErrors('inicio');
});

it('deve aceitar qualquer dia e horário quando o profissional não tem horários (retrocompat)', function () {
    // ARRANGE — sem horários = todos os dias/horas abertos
    $admin = admin();
    $base = baseComHorarios([]);
    $base['inicio'] = proximaDataNoDia(1).' 09:00'; // segunda

    // ACT + ASSERT
    $this->actingAs($admin)->postJson('/api/agendamentos', $base)->assertCreated();
});

it('deve isentar o BLOQUEIO da regra de horários (o profissional avisa ausência)', function () {
    // ARRANGE — só terça e quinta; bloqueio numa segunda
    $admin = admin();
    $base = baseComHorarios([2 => [['08:00', '19:00']], 4 => [['08:00', '19:00']]]);

    // ACT + ASSERT
    $this->actingAs($admin)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'profissional_id' => $base['profissional_id'],
        'inicio' => proximaDataNoDia(1).' 09:00',
        'duracao_minutos' => 60,
        'obs' => 'Ausente nesta segunda',
    ])->assertCreated();
});

it('deve recusar via curl/aba-velha igual à tela (regra no boundary, §13)', function () {
    // ARRANGE — a recusa não depende do filtro do front: o servidor DECIDE
    $admin = admin();
    $base = baseComHorarios([2 => [['08:00', '19:00']], 4 => [['08:00', '19:00']]]);
    $base['inicio'] = proximaDataNoDia(3).' 09:00'; // quarta

    // ACT + ASSERT
    $this->actingAs($admin)->postJson('/api/agendamentos', $base)
        ->assertUnprocessable()->assertJsonValidationErrors('inicio');
});

it('deve entregar os horários na leitura de exibição da grade sob agenda.ver', function () {
    // ARRANGE
    $admin = admin();
    $prof = Profissional::factory()->create(['ativo' => true]);
    definirHorarios($prof->id, [2 => [['09:00', '12:00'], ['16:00', '19:00']], 4 => [['08:00', '18:00']]]);

    // ACT
    $resposta = $this->actingAs($admin)->getJson('/api/agenda/selecao')->assertOk();

    // ASSERT — a grade recebe o mapa de horários para pintar o indisponível
    $daGrade = collect($resposta->json('profissionais'))->firstWhere('id', $prof->id);
    expect($daGrade['horarios'])->toBe([
        '2' => [['inicio' => '09:00', 'fim' => '12:00'], ['inicio' => '16:00', 'fim' => '19:00']],
        '4' => [['inicio' => '08:00', 'fim' => '18:00']],
    ]);
});

it('deve barrar, no apply-na-série, a irmã que o delta levaria a um dia proibido', function () {
    // ARRANGE — as irmãs são gravadas por `$futuro->update()`, que PULA `validarDominio`. Prof
    // atende terça(2) e quarta(3), dia inteiro; série semanal às terças.
    $admin = admin();
    $base = baseComHorarios([2 => [['08:00', '19:00']], 3 => [['08:00', '19:00']]]);
    $terca1 = Carbon\Carbon::parse(proximaDataNoDia(2).' 09:00');
    $terca2 = $terca1->copy()->addWeek();  // terça da semana 2
    $quarta1 = $terca1->copy()->addDay();  // quarta da semana 1 (válido)
    $quarta2 = $terca2->copy()->addDay();  // quarta da semana 2 (válido)

    $criacao = $this->actingAs($admin)->postJson('/api/agendamentos', [
        ...$base,
        'inicio' => $terca1->format('Y-m-d H:i'),
        'recorrencia' => ['ate' => $terca2->format('Y-m-d')],
    ])->assertCreated();
    $ids = collect($criacao->json('agendamentos'))->pluck('id');
    expect($ids)->toHaveCount(2);

    // torna o grupo HETEROGÊNEO: move a irmã (terça2) para a quarta2 individualmente (válido)
    $this->actingAs($admin)->putJsonComVersao("/api/agendamentos/{$ids[1]}", [
        'inicio' => $quarta2->format('Y-m-d H:i'),
        'profissional_id' => $base['profissional_id'],
        'aplicar_na_serie' => false,
    ])->assertOk();

    // ACT — apply-na-série movendo a base terça1 → quarta1 (+1 dia, válido); o delta desloca a
    // irmã (quarta2) +1 dia → quinta2 (4), um dia em que o profissional NÃO atende
    // ASSERT — a guarda dentro da transação recusa e nada é gravado
    $this->actingAs($admin)->putJsonComVersao("/api/agendamentos/{$ids[0]}", [
        'inicio' => $quarta1->format('Y-m-d H:i'),
        'profissional_id' => $base['profissional_id'],
        'aplicar_na_serie' => true,
    ])->assertUnprocessable()->assertJsonValidationErrors('inicio');
});
