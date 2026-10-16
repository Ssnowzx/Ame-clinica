<?php

use App\Models\Convenio;
use App\Models\FechamentoCiclo;
use App\Support\Ciclos\FechamentoDeCiclo;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * O PONTO DE SERIALIZAÇÃO do ciclo (SEC-FC-10/11 · D8), provado com duas conexões.
 *
 * Travar a linha do registro editado não serializa edição-vs-**fechamento**: são tabelas
 * diferentes, e sob REPEATABLE READ a transação de edição não enxerga o fechamento que
 * outra sessão comitou depois de ela começar. O único ponto em comum é a linha do
 * CONVÊNIO — e "em comum" só é verdade se ela realmente BLOQUEAR. Só uma segunda sessão
 * do banco responde a isso; um segundo model responderia a outra pergunta.
 *
 * Estes dois testes são o alicerce que os caminhos de escrita (tasks 3.x) herdam: eles
 * usam o MESMO `comLockDoConvenio`, na mesma posição da ordem de locks da casa
 * (`agendamentos → atendimentos → tratamentos → convenios → fechamentos_ciclo`).
 */
function segundaConexaoDoCiclo(): string
{
    config(['database.connections.segunda_ciclo' => config('database.connections.mysql')]);
    DB::purge('segunda_ciclo');

    return 'segunda_ciclo';
}

function convenioCommitadoComCiclo(): Convenio
{
    return Convenio::create([
        'nome' => 'Operadora Fictícia '.fake()->unique()->word(),
        'ciclo_tipo_corte' => 'dia_fixo',
        'ciclo_dia_corte' => 15,
    ]);
}

it('deve BLOQUEAR quem entra em comLockDoConvenio com a linha do convênio travada', function () {
    // ARRANGE — dados COMMITADOS (esta suíte não roda dentro de transação)
    admin();
    $convenio = convenioCommitadoComCiclo();
    $segunda = segundaConexaoDoCiclo();

    // a conexão do código sob teste desiste rápido: sem isto, esperaríamos 50s
    DB::statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a conexão B é um fechamento no meio do caminho: linha do convênio travada,
    // transação ainda aberta (exatamente o que comLockDoConvenio faz)
    DB::connection($segunda)->beginTransaction();
    DB::connection($segunda)->table('convenios')->where('id', $convenio->id)->lockForUpdate()->get();

    // ...e a conexão A ENTRA no lock — com um callback que NÃO escreve nada.
    //
    // O callback é vazio de propósito. A primeira versão deste teste fechava um período
    // de verdade, e passava mesmo depois de eu APAGAR o `lockForUpdate`: o INSERT em
    // `fechamentos_ciclo` pede o S-lock da FK na linha PAI de `convenios`, e era ELE que
    // bloqueava. O teste media o lock errado — e o lock errado chega tarde demais, DEPOIS
    // da checagem de não-sobreposição já ter lido um banco sem o fechamento alheio.
    // Com o callback vazio, o único bloqueio possível é o `select ... for update` do
    // próprio comLockDoConvenio.
    $bloqueou = false;
    try {
        FechamentoDeCiclo::comLockDoConvenio($convenio->id, fn (Convenio $travado) => $travado->id);
    } catch (QueryException $excecao) {
        // 1205 = lock wait timeout · 1213 = deadlock — qualquer um PROVA a serialização
        $bloqueou = in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true);
    }

    DB::connection($segunda)->rollBack();

    // ASSERT — sem este lock, dois fechamentos rodariam a checagem de não-sobreposição em
    // paralelo, cada um vendo um banco sem o outro, e ambos gravariam
    expect($bloqueou)->toBeTrue(
        'comLockDoConvenio NÃO bloqueou com a linha do convênio travada por outra sessão — '
        .'o ponto de serialização comum do SEC-FC-10 não existe, e a guarda das tasks 3.x '
        .'herdaria um lock que não tranca nada.'
    );
    expect(FechamentoCiclo::where('convenio_id', $convenio->id)->count())->toBe(0);
});

it('deve recusar o fechamento sobreposto comitado por OUTRA conexão — um 201, um 422', function () {
    // ARRANGE — SEC-FC-11: o desfecho da corrida. A primeira sessão fecha e COMITA; a
    // segunda pede um período que intersecta. O índice único não pega isto (interseção
    // parcial, início diferente) — quem recusa é a checagem sob o lock.
    $adminDaClinica = admin();
    $convenio = convenioCommitadoComCiclo();
    $segunda = segundaConexaoDoCiclo();

    // ACT 1 — a conexão B fecha 16/06–15/07 e comita: o "201" da corrida
    DB::connection($segunda)->table('fechamentos_ciclo')->insert([
        'convenio_id' => $convenio->id,
        'periodo_inicio' => '2026-06-16',
        'periodo_fim' => '2026-07-15',
        'fechado_por' => $adminDaClinica->id,
        'fechado_em' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);

    // ACT 2 — a conexão A pede o MESMO período pelo caminho REAL: o "422" da corrida
    $recusou = false;
    try {
        FechamentoDeCiclo::comLockDoConvenio(
            $convenio->id,
            fn (Convenio $travado) => FechamentoDeCiclo::fechar(
                $travado, '2026-06-16', '2026-07-15', $adminDaClinica->id
            )
        );
    } catch (ValidationException $excecao) {
        $recusou = array_key_exists('periodo_inicio', $excecao->errors());
    }

    // ...e o CONTROLE: o período seguinte, que encosta sem intersectar, passa
    $adjacente = FechamentoDeCiclo::comLockDoConvenio(
        $convenio->id,
        fn (Convenio $travado) => FechamentoDeCiclo::fechar(
            $travado, '2026-07-16', '2026-08-15', $adminDaClinica->id
        )
    );

    // ASSERT — a recusa veio da GUARDA (422 legível), não de um 1062 do índice; e ela
    // enxergou o commit da outra sessão, em vez de decidir sobre um estado próprio
    expect($recusou)->toBeTrue(
        'O fechamento comitado por OUTRA conexão não foi enxergado: a checagem de '
        .'não-sobreposição está decidindo sobre um estado que não é o do banco.'
    );
    expect($adjacente->exists)->toBeTrue(
        'O período adjacente foi recusado — a guarda virou "recusa tudo" e o teste acima '
        .'não prova mais nada.'
    );
    expect(FechamentoCiclo::where('convenio_id', $convenio->id)->count())->toBe(2);
});
