<?php

use App\Models\Atendimento;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Agenda\BaixaEmLote;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * A CAMADA DO BANCO da baixa em lote por status (change `baixa-em-lote-por-status`, D7/D10):
 * uma SEGUNDA conexão de verdade — outro PDO, outra sessão — é o único instrumento que responde
 * "a linha BLOQUEIA, ou apenas fingimos que sim?".
 *
 * O que se prova aqui: (1) com o alcance travado pelo `resolver(sobLock: true)`, um atendimento
 * não NASCE por baixo do lote — fecha, para a baixa e para o desmarque, a classe do gatilho
 * `DESMARQUE-ATENDIMENTO-SEM-LOCK`; (2) quando outra sessão segura uma linha do alcance, a
 * execução responde 409 `ciclo_em_alteracao`, nunca 500.
 */
function segundaConexaoDaBaixa(): string
{
    config(['database.connections.segunda_baixa' => config('database.connections.mysql')]);
    DB::purge('segunda_baixa');

    return 'segunda_baixa';
}

it('deve BLOQUEAR o nascimento de um atendimento enquanto o alcance da baixa está travado', function () {
    // ARRANGE — dados COMMITADOS (esta suíte não roda dentro de transação)
    admin();
    $base = baseDaBaixa();
    $agendamento = agendamentoDaBaixa($base, diaDaBaixa().' 09:00');
    $alvo = StatusAgendamento::findOrFail($base['status']['falta_justificada']);
    $segunda = segundaConexaoDaBaixa();
    DB::connection($segunda)->statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a conexão A trava o alcance como a execução faz (agendamentos → atendimentos)
    DB::beginTransaction();
    $resolvido = app(BaixaEmLote::class)->resolver(
        $base['profissional_id'], $alvo, diaDaBaixa(), diaDaBaixa(), CarbonImmutable::parse(diaDaBaixa().' 23:59'), sobLock: true,
    );

    // ...e a conexão B tenta registrar o atendimento no meio do lote (o outro lado da corrida)
    $bloqueou = false;
    try {
        DB::connection($segunda)->table('atendimentos')->insert([
            'agendamento_id' => $agendamento->id,
            'finalizado_em' => diaDaBaixa().' 09:40:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    } catch (QueryException $excecao) {
        // 1205 = lock wait timeout · 1213 = deadlock: qualquer um PROVA que travou
        $bloqueou = in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true);
    }
    DB::rollBack();

    // ASSERT — o lote viu a linha elegível, e o atendimento não nasceu por baixo dele
    expect($resolvido['contagens']['agendamentos'])->toBe(1)
        ->and($bloqueou)->toBeTrue('O INSERT em `atendimentos` NÃO bloqueou com o alcance travado: um atendimento registrado durante o lote viraria falta.')
        ->and(Atendimento::where('agendamento_id', $agendamento->id)->exists())->toBeFalse();
});

it('deve NÃO travar o agendamento de outro profissional enquanto o alcance da baixa está travado', function () {
    // ARRANGE — dois profissionais da mesma clínica; o lote é só do primeiro, com 20 linhas no
    // dia. Com `FOR UPDATE` direto na consulta de faixa (achado PERF-02 do gate), o plano do
    // otimizador dependia do tamanho da tabela: até ~10 linhas ia pelo índice do profissional;
    // de 12 a 15, varria a PK inteira; de 18 em diante, entrava pelo índice de `status_id` —
    // e nos dois últimos travava o agendamento EM ABERTO de qualquer outro profissional
    // pela duração do lote. A leitura travante agora é ancorada nos ids.
    admin();
    $base = baseDaBaixa();
    foreach (range(0, 19) as $i) {
        agendamentoDaBaixa($base, sprintf('%s %02d:%02d', diaDaBaixa(), 8 + intdiv($i * 40, 60), ($i * 40) % 60));
    }
    $outro = Profissional::factory()->create();
    $foraDoLote = agendamentoDaBaixa([...$base, 'profissional_id' => $outro->id], diaDaBaixa().' 09:00');
    $alvo = StatusAgendamento::findOrFail($base['status']['falta_justificada']);
    $segunda = segundaConexaoDaBaixa();
    DB::connection($segunda)->statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a conexão A trava o alcance como a execução faz; a B escreve na agenda do OUTRO
    DB::beginTransaction();
    $resolvido = app(BaixaEmLote::class)->resolver(
        $base['profissional_id'], $alvo, diaDaBaixa(), diaDaBaixa(), CarbonImmutable::parse(diaDaBaixa().' 23:59'), sobLock: true,
    );
    $bloqueou = false;
    try {
        DB::connection($segunda)->table('agendamentos')->where('id', $foraDoLote->id)->update(['obs' => 'anotação fictícia']);
    } catch (QueryException $excecao) {
        $bloqueou = in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true);
    }
    DB::rollBack();

    // ASSERT — o lote viu só as próprias linhas, e a agenda do colega não esperou por ele
    expect($resolvido['contagens']['agendamentos'])->toBe(20)
        ->and($bloqueou)->toBeFalse('O UPDATE de um agendamento FORA do lote esperou pelos locks da baixa: a leitura travante varreu a PK em vez de travar só o alcance.')
        ->and($foraDoLote->refresh()->obs)->toBe('anotação fictícia');
});

it('deve responder 409 ciclo_em_alteracao, nunca 500, quando outra sessão segura uma linha do alcance', function () {
    // ARRANGE — a prévia lida; a conexão B trava o agendamento (como um fechamento em curso travaria)
    $adminDaClinica = admin();
    $base = baseDaBaixa();
    $agendamento = agendamentoDaBaixa($base, diaDaBaixa().' 09:00');
    $alcance = alcanceDaBaixa($base, $base['status']['falta_justificada']);
    $previa = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote/previa', $alcance);
    $previa->assertOk();
    $payload = [...$alcance, 'assinatura' => $previa->json('assinatura'), 'referencia' => $previa->json('referencia')];

    $segunda = segundaConexaoDaBaixa();
    DB::connection($segunda)->beginTransaction();
    DB::connection($segunda)->table('agendamentos')->where('id', $agendamento->id)->lockForUpdate()->get();
    // a conexão da execução desiste rápido: sem isto o teste esperaria o timeout default (50s)
    DB::statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', $payload);
    DB::connection($segunda)->rollBack();

    // ASSERT — a corrida traduzida, nada gravado
    $resposta->assertStatus(409)->assertJsonPath('erro', 'ciclo_em_alteracao');
    expect($agendamento->refresh()->status_id)->toBe($base['status']['inicial']);
});
