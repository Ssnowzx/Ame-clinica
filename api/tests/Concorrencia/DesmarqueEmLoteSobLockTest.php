<?php

use App\Models\StatusAgendamento;
use Illuminate\Support\Facades\DB;

/**
 * A CAMADA DO BANCO do desmarque em lote depois da espinha partilhada (change
 * `baixa-em-lote-por-status`, D1/D7): a execução passou a travar `agendamentos` → `atendimentos`
 * antes do loop, e a corrida nesses locks tem de ser 409 `ciclo_em_alteracao` — como na baixa —
 * e nunca 500. A tradução vivia só no controller da baixa (achado CR-06 do gate); agora mora na
 * espinha (`ContextoDoLote::executar` → `CorridaDoMotor`), e este teste é o que prova que o
 * desmarque a herdou. Uma SEGUNDA conexão de verdade é o único instrumento que responde.
 */
function segundaConexaoDoDesmarque(): string
{
    config(['database.connections.segunda_desmarque' => config('database.connections.mysql')]);
    DB::purge('segunda_desmarque');

    return 'segunda_desmarque';
}

it('deve responder 409 ciclo_em_alteracao, nunca 500, quando outra sessão segura uma linha do alcance do desmarque', function () {
    // ARRANGE — a conexão B trava o agendamento do alcance (como um fechamento em curso travaria)
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    $agendamento = agendamentoDoDesmarque($base, '2026-09-14 09:00');
    $payload = ['profissional_id' => $base['profissional_id'], 'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'dia'];

    $segunda = segundaConexaoDoDesmarque();
    DB::connection($segunda)->beginTransaction();
    DB::connection($segunda)->table('agendamentos')->where('id', $agendamento->id)->lockForUpdate()->get();
    // a conexão da execução desiste rápido: sem isto o teste esperaria o timeout default (50s)
    DB::statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', $payload);
    DB::connection($segunda)->rollBack();

    // ASSERT — a corrida traduzida (a chave é contrato, não a frase), nada gravado
    $resposta->assertStatus(409)->assertJsonPath('erro', 'ciclo_em_alteracao');
    expect($agendamento->refresh()->status_id)->toBe(StatusAgendamento::inicialId());
});
