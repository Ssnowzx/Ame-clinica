<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use Illuminate\Support\Facades\DB;

/**
 * Os payloads REAIS que a tela monta (gate agenda-escrita, B-01..B-03).
 *
 * A suíte do frontend usa MSW e devolve 200 para qualquer PUT — foi por isso
 * que dois fluxos centrais ficaram quebrados com 206 testes verdes. Aqui os
 * mesmos corpos batem na API de verdade.
 */

/** Cenário: um agendamento de 90 min numa especialidade cujo padrão é 40. */
function agendamentoDeNoventaMinutos(): Agendamento
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(8, 0);

    return Agendamento::factory()->create([
        'paciente_id' => Paciente::factory()->create()->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'status_id' => StatusAgendamento::query()->where('nome', 'Em Aberto')->value('id'),
        'inicio' => $inicio,
        'fim' => $inicio->copy()->addMinutes(90),
    ]);
}

it('deve aceitar o payload que a tela manda ao trocar o status pelo card', function () {
    // ARRANGE — o corpo é exatamente o do MenuDeStatus: início e profissional
    // (que o PUT exige) + o status novo. Sem paciente, sem especialidade.
    $adminDaClinica = admin();
    $agendamento = agendamentoDeNoventaMinutos();
    $finalizado = StatusAgendamento::query()->where('nome', 'Aguardando Atendimento')->value('id');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$agendamento->id}", [
        'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
        'profissional_id' => $agendamento->profissional_id,
        'status_id' => $finalizado,
    ]);

    // ASSERT — o fluxo do dia inteiro dependia disto
    $resposta->assertOk();
    expect($resposta->json('status_id'))->toBe($finalizado);
});

it('deve preservar a duração quando a edição não fala de duração', function () {
    // ARRANGE — 90 min numa especialidade de 40: recalcular pela especialidade
    // encolheria a sessão em silêncio (B-03)
    $adminDaClinica = admin();
    $agendamento = agendamentoDeNoventaMinutos();

    // ACT — troca só o status
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$agendamento->id}", [
        'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
        'profissional_id' => $agendamento->profissional_id,
        'status_id' => StatusAgendamento::query()->where('nome', 'Aguardando Atendimento')->value('id'),
    ])->assertOk();

    // ASSERT — continua com 90 minutos
    expect($agendamento->fresh()->duracao_minutos)->toBe(90);
});

it('deve recusar recorrência na edição — inclusive a chave NULA', function () {
    // ARRANGE — gatilho PROHIBITED-NULL. Série se cria, não se edita: `recorrencia` é
    // IMUTÁVEL no PUT. Mas `prohibited` significa "ausente OU VAZIO" no Laravel 12, então a
    // chave NULA passava a validação — e a defesa que sobrava era o `except()` do
    // AgendamentoService, downstream. Proteção por coincidência, não por contrato: a
    // próxima Request que copiasse o idioma não herdaria o `except()`.
    $adminDaClinica = admin();
    $agendamento = agendamentoDeNoventaMinutos();
    $put = [
        'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
        'profissional_id' => $agendamento->profissional_id,
    ];

    // ACT + ASSERT — com valor E com null, a chave é recusada no BOUNDARY
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$agendamento->id}", [
        ...$put, 'recorrencia' => ['ate' => agoraNaClinica()->addMonth()->format('Y-m-d')],
    ])->assertUnprocessable()->assertJsonValidationErrors('recorrencia');

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$agendamento->id}", [
        ...$put, 'recorrencia' => null,
    ])->assertUnprocessable()->assertJsonValidationErrors('recorrencia');

    // e sem a chave, a edição segue normalmente (ausente ≠ nula)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$agendamento->id}", $put)
        ->assertOk();
});

it('deve preservar o paciente e a especialidade na edição parcial', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $agendamento = agendamentoDeNoventaMinutos();

    // ACT — reagenda só o horário
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$agendamento->id}", [
        'inicio' => $agendamento->inicio->copy()->addHour()->format('Y-m-d H:i'),
        'profissional_id' => $agendamento->profissional_id,
    ])->assertOk();

    // ASSERT — os vínculos clínicos ficam de pé (a invariante é do ESTADO FINAL)
    $fresco = $agendamento->fresh();
    expect($fresco->paciente_id)->toBe($agendamento->paciente_id);
    expect($fresco->especialidade_id)->toBe($agendamento->especialidade_id);
});

it('deve aceitar o payload de série que a tela manda, sem propagar status nem observação', function () {
    // ARRANGE — série de 4; a 2ª ocorrência é desmarcada e ganha observação
    // própria. O payload da tela leva só início/profissional/aplicar_na_serie.
    $adminDaClinica = admin();
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);
    $paciente = Paciente::factory()->create();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(8, 0);

    $criacao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'inicio' => $inicio->format('Y-m-d H:i'),
        'profissional_id' => $profissional->id,
        'paciente_id' => $paciente->id,
        'especialidade_id' => $especialidade->id,
        'recorrencia' => ['ate' => $inicio->copy()->addWeeks(3)->format('Y-m-d')],
    ])->assertCreated();

    $ids = collect($criacao->json('agendamentos'))->pluck('id');
    $desmarcado = StatusAgendamento::query()->where('nome', 'Desmarcado pelo Profissional')->value('id');
    Agendamento::whereKey($ids[1])->update(['status_id' => $desmarcado, 'obs' => 'Paciente avisou']);

    // ACT — reagenda a série uma hora depois (payload REAL da tela)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ids[0]}", [
        'inicio' => $inicio->copy()->addHour()->format('Y-m-d H:i'),
        'profissional_id' => $profissional->id,
        'aplicar_na_serie' => true,
    ])->assertOk();

    // ASSERT — as irmãs deslocam, mas a ocorrência desmarcada NÃO ressuscita
    $irma = Agendamento::findOrFail($ids[1]);
    expect($irma->inicio->format('H:i'))->toBe('09:00');
    expect($irma->status_id)->toBe($desmarcado);
    expect($irma->obs)->toBe('Paciente avisou');
});

it('deve continuar exigindo paciente e especialidade na CRIAÇÃO', function () {
    // ARRANGE — a flexibilização é só do update
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'inicio' => agoraNaClinica()->copy()->addDay()->setTime(8, 0)->format('Y-m-d H:i'),
        'profissional_id' => $profissional->id,
    ])->assertStatus(422)->assertJsonValidationErrors(['paciente_id', 'especialidade_id']);
});

it('deve continuar recusando atendimento que ficaria sem paciente', function () {
    // ARRANGE — a invariante do ESTADO FINAL segue de pé
    $adminDaClinica = admin();
    $agendamento = agendamentoDeNoventaMinutos();

    // ACT + ASSERT — mandar null explicitamente é diferente de omitir
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$agendamento->id}", [
        'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
        'profissional_id' => $agendamento->profissional_id,
        'paciente_id' => null,
    ])->assertStatus(422)->assertJsonValidationErrors(['paciente_id']);
});
