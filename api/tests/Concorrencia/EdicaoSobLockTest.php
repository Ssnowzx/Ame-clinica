<?php

use App\Models\Atendimento;
use App\Models\Evolucao;
use App\Models\Profissional;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * A CAMADA DO BANCO da corrida da evolução (SEC-OCC-01/C1 · task 2.7).
 *
 * Este teste prova a SEMÂNTICA DO MySQL de que o desenho depende: uma linha
 * travada com `lockForUpdate` BLOQUEIA a leitura-com-lock de outra conexão até o
 * commit (1205/1213 como prova). Ele NÃO exercita o controller — quem prova que
 * o PUT real trava e grava NA MESMA transação é o epoch-pin em
 * `ConcorrenciaOtimistaTest` ("o epoch-pin do lock"); e o desfecho 409 do token
 * velho após o destravamento é o teste sequencial de lá. Três camadas, cada uma
 * com um dono (correção B2 do gate).
 */
function segundaConexaoDaEdicao(): string
{
    config(['database.connections.segunda_edicao' => config('database.connections.mysql')]);
    DB::purge('segunda_edicao');

    return 'segunda_edicao';
}

it('deve BLOQUEAR a leitura de comparação da evolução enquanto outro PUT grava', function () {
    // ARRANGE — dados COMMITADOS (esta suíte não roda dentro de transação)
    admin();
    $atendimento = Atendimento::factory()->create();
    $autora = Profissional::factory()->create();
    $evolucao = new Evolucao([
        'profissional_id' => $autora->id,
        'conteudo' => 'Texto fictício original.',
    ]);
    $evolucao->atendimento_id = $atendimento->id;
    $evolucao->preenchida_em = now()->format('Y-m-d H:i');
    $evolucao->save();

    $segunda = segundaConexaoDaEdicao();
    DB::connection($segunda)->statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a conexão A é um PUT no meio do caminho: linha travada, gravação feita,
    // transação ainda aberta (exatamente o que EvolucaoController::update faz)
    DB::beginTransaction();
    DB::table('evolucoes')->where('id', $evolucao->id)->lockForUpdate()->get();
    DB::table('evolucoes')->where('id', $evolucao->id)->update(['updated_at' => now()->addSeconds(5)]);

    // ...e a conexão B é o SEGUNDO PUT tentando a leitura de comparação sob lock
    $bloqueou = false;
    try {
        DB::connection($segunda)
            ->table('evolucoes')->where('id', $evolucao->id)->lockForUpdate()->get();
    } catch (QueryException $excecao) {
        // 1205 = lock wait timeout · 1213 = deadlock — qualquer um PROVA a serialização
        $bloqueou = in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true);
    }

    DB::rollBack();

    // ASSERT — sem o lock, a leitura de B passaria na hora e compararia contra o
    // estado ANTIGO: os dois PUTs achariam o próprio token válido
    expect($bloqueou)->toBeTrue(
        'Uma linha de evolucoes travada com lockForUpdate NÃO bloqueou a leitura-com-lock '
        .'de outra conexão — a semântica de lock de que o C1 depende não vale neste banco/isolação.'
    );
});
