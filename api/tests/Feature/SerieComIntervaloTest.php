<?php

use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Usuario;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * A série ganhou INTERVALO e um segundo modo de término (change `repeticao-da-serie`).
 *
 * Pedido da clínica: semanal, quinzenal, e "agendar mais de uma sessão já" — que na cabeça de
 * quem marca é o número de sessões do pacote, não uma data final calculada de cabeça.
 *
 * O que estes testes fixam, e que a suíte não tinha como fixar antes:
 *   - o cursor anda o INTERVALO pedido, não uma semana fixa;
 *   - a série pode terminar por CONTAGEM, contando a primeira ocorrência;
 *   - os dois modos juntos (ou nenhum) são 422 — a exclusividade é do servidor;
 *   - a guarda de evento longo compara com o INTERVALO: dez dias sobrepõem em semanal e
 *     cabem em quinzenal;
 *   - o pedido ANTIGO (`{ate}` sozinho) continua criando série semanal.
 */

/**
 * Quem marca: recepção plana na agenda (a série é gesto de balcão).
 */
function recepcaoDaSerie(): Usuario
{
    admin();

    return usuarioCom(
        ['agenda.ver', 'agenda.criar', 'agenda.ver_todos', 'tratamentos.ver'],
        'Recepção da Série',
    );
}

/** Profissional ativo com especialidade de 40 min — o mínimo para marcar. */
function cenarioDaSerie(): array
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return [$profissional, $especialidade, Paciente::factory()->create()];
}

/** O payload base de uma criação; a recorrência entra por cima. */
function pedidoDaSerie(array $cenario, Carbon $inicio, array $recorrencia): array
{
    [$profissional, $especialidade, $paciente] = $cenario;

    return [
        'inicio' => $inicio->format('Y-m-d H:i'),
        'profissional_id' => $profissional->id,
        'paciente_id' => $paciente->id,
        'especialidade_id' => $especialidade->id,
        'recorrencia' => $recorrencia,
    ];
}

it('deve andar de DUAS em duas semanas na série quinzenal', function () {
    // ARRANGE — 8 semanas de janela: semanal daria 9 ocorrências, quinzenal dá 5
    $recepcao = recepcaoDaSerie();
    $cenario = cenarioDaSerie();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(8, 0);

    // ACT
    $resposta = $this->actingAs($recepcao)->postJson('/api/agendamentos', pedidoDaSerie($cenario, $inicio, [
        'intervalo_semanas' => 2,
        'ate' => $inicio->copy()->addWeeks(8)->format('Y-m-d'),
    ]))->assertCreated();

    // ASSERT — as datas caem de 14 em 14 dias, a partir da primeira
    expect($resposta->json('criados'))->toBe(5);
    $datas = array_map(
        fn (array $agendamento): string => substr($agendamento['inicio'], 0, 10),
        $resposta->json('agendamentos'),
    );
    expect($datas)->toBe([
        $inicio->format('Y-m-d'),
        $inicio->copy()->addWeeks(2)->format('Y-m-d'),
        $inicio->copy()->addWeeks(4)->format('Y-m-d'),
        $inicio->copy()->addWeeks(6)->format('Y-m-d'),
        $inicio->copy()->addWeeks(8)->format('Y-m-d'),
    ]);
});

it('deve criar exatamente N sessões quando o término é por CONTAGEM, contando a primeira', function () {
    // ARRANGE
    $recepcao = recepcaoDaSerie();
    $cenario = cenarioDaSerie();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(9, 0);

    // ACT — 8 sessões quinzenais, sem data nenhuma
    $resposta = $this->actingAs($recepcao)->postJson('/api/agendamentos', pedidoDaSerie($cenario, $inicio, [
        'intervalo_semanas' => 2,
        'ocorrencias' => 8,
    ]))->assertCreated();

    // ASSERT — 8, e a última é 14 semanas depois (7 saltos de 2)
    expect($resposta->json('criados'))->toBe(8);
    expect(substr($resposta->json('agendamentos.7.inicio'), 0, 10))
        ->toBe($inicio->copy()->addWeeks(14)->format('Y-m-d'));
});

it('deve recusar os DOIS modos de término juntos, e a ausência dos dois', function () {
    // ARRANGE
    $recepcao = recepcaoDaSerie();
    $cenario = cenarioDaSerie();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(10, 0);

    // ACT + ASSERT — os dois
    $this->actingAs($recepcao)->postJson('/api/agendamentos', pedidoDaSerie($cenario, $inicio, [
        'ate' => $inicio->copy()->addWeeks(4)->format('Y-m-d'),
        'ocorrencias' => 4,
    ]))->assertStatus(422)->assertJsonValidationErrors('recorrencia.ate');

    // ACT + ASSERT — nenhum (só o intervalo não diz onde a série termina)
    $this->actingAs($recepcao)->postJson('/api/agendamentos', pedidoDaSerie($cenario, $inicio, [
        'intervalo_semanas' => 2,
    ]))->assertStatus(422)->assertJsonValidationErrors('recorrencia.ate');
});

it('deve recusar evento longo em série SEMANAL e aceitar o mesmo em QUINZENAL', function () {
    // ARRANGE — um bloqueio de 10 dias: em semanal as ocorrências se sobreporiam
    $recepcao = recepcaoDaSerie();
    [$profissional] = cenarioDaSerie();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(8, 0);
    $bloqueioDeDezDias = [
        'tipo' => 'bloqueio',
        'inicio' => $inicio->format('Y-m-d H:i'),
        'fim' => $inicio->copy()->addDays(10)->format('Y-m-d H:i'),
        'profissional_id' => $profissional->id,
        'obs' => 'Bloqueio Fictício Longo',
    ];

    // ACT + ASSERT — semanal recusa
    $this->actingAs($recepcao)->postJson('/api/agendamentos', [
        ...$bloqueioDeDezDias,
        'recorrencia' => ['intervalo_semanas' => 1, 'ocorrencias' => 3],
    ])->assertStatus(422)->assertJsonValidationErrors('recorrencia');

    // ACT + ASSERT — quinzenal aceita: 14 dias de intervalo cabem os 10 do evento
    $this->actingAs($recepcao)->postJson('/api/agendamentos', [
        ...$bloqueioDeDezDias,
        'recorrencia' => ['intervalo_semanas' => 2, 'ocorrencias' => 3],
    ])->assertCreated();
});

it('deve manter o pedido ANTIGO válido — só a data, série semanal', function () {
    // ARRANGE — sem `intervalo_semanas`, como a tela mandava antes desta change
    $recepcao = recepcaoDaSerie();
    $cenario = cenarioDaSerie();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(11, 0);

    // ACT
    $resposta = $this->actingAs($recepcao)->postJson('/api/agendamentos', pedidoDaSerie($cenario, $inicio, [
        'ate' => $inicio->copy()->addWeeks(3)->format('Y-m-d'),
    ]))->assertCreated();

    // ASSERT — 4 ocorrências, de 7 em 7 dias
    expect($resposta->json('criados'))->toBe(4);
    expect(substr($resposta->json('agendamentos.1.inicio'), 0, 10))
        ->toBe($inicio->copy()->addWeek()->format('Y-m-d'));
});

it('deve recusar contagem acima do teto e intervalo fora da faixa', function () {
    // ARRANGE
    $recepcao = recepcaoDaSerie();
    $cenario = cenarioDaSerie();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(14, 0);

    // ACT + ASSERT — 53 sessões (o teto é 52)
    $this->actingAs($recepcao)->postJson('/api/agendamentos', pedidoDaSerie($cenario, $inicio, [
        'ocorrencias' => 53,
    ]))->assertStatus(422)->assertJsonValidationErrors('recorrencia.ocorrencias');

    // ACT + ASSERT — a cada 9 semanas (a faixa é 1..8)
    $this->actingAs($recepcao)->postJson('/api/agendamentos', pedidoDaSerie($cenario, $inicio, [
        'intervalo_semanas' => 9,
        'ocorrencias' => 3,
    ]))->assertStatus(422)->assertJsonValidationErrors('recorrencia.intervalo_semanas');
});
