<?php

use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Convenio;
use App\Models\LancamentoCaixa;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\TipoPagamento;
use App\Models\Tratamento;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * A ORDEM DE LOCKS entre `tratamentos` e `convenios`, nos DOIS caminhos que cruzam neles
 * (D8 · SEC-FC-12):
 *
 *     agendamentos → atendimentos → tratamentos → convenios → fechamentos_ciclo
 *
 * - **Caminho A** — `AgendamentoService::atualizar` (PUT de agendamento trocando
 *   `tratamento_id`): trava agendamentos → atendimentos, os tratamentos de origem/destino,
 *   e só então o convênio, via `GuardaDeCicloFechado`.
 * - **Caminho B** — `TratamentoController::update` (PUT de tratamento enviando
 *   `convenio_id`): trava o tratamento e só então o convênio, pela mesma guarda.
 *
 * **Por que este teste existe.** O caminho A tomava o X-lock de `convenios` ANTES do de
 * `tratamentos` — a guarda de ciclo trava o convênio mesmo sem achar fechamento algum, e o
 * lock do tratamento só nascia depois, lá no `ConsumoSessaoService`. Com B na ordem oposta, o
 * cruzamento era deadlock de verdade: A segurando C e esperando T, B segurando T e esperando
 * C. `DB::transaction` roda com `$attempts = 1` (sem retry) e o 1213 estourava no
 * `reconciliar`, **fora** do try/catch de `recusarCorridaDoCiclo` — o usuário via 500 onde o
 * desenho promete 409. Os dois testes de concorrência que já existiam medem convênio ×
 * convênio e nunca cruzaram os dois caminhos.
 *
 * **Por que a prova é uma SONDA, e não um deadlock encenado.** Reproduzir o 1213 exige que as
 * duas transações avancem ao mesmo tempo, e o PHP do teste é uma linha só de execução: quem
 * bloqueia primeiro trava o processo, e a outra metade nunca chega a pedir o seu lock. Então a
 * pergunta é feita no único instante em que ela decide tudo — **no momento exato em que o
 * caminho toma o lock do convênio, o tratamento JÁ está travado por ele?** `DB::listen` avisa
 * assim que o `for update` em `convenios` executa; nesse instante uma SEGUNDA CONEXÃO tenta
 * travar a linha do tratamento. Bloqueou ⇒ o tratamento veio antes ⇒ a ordem está certa.
 * Passou livre ⇒ o convênio veio primeiro ⇒ é o deadlock esperando um horário ruim.
 *
 * **Provados por MUTAÇÃO** (o aviso da casa: já pegamos aqui um teste de lock que passava sem
 * o lock, porque o S-lock de FK de um INSERT bloqueava por acidente): apagando o
 * `lockForUpdate` novo de `guardasClinicas`, o teste do caminho A fica VERMELHO — a sonda
 * atravessa a linha do tratamento sem esperar. Aqui não há INSERT nenhum antes da guarda, e
 * é por isso que a sonda mede o lock que o código pediu, não um efeito colateral.
 */
function segundaConexaoDaOrdemDeLocks(): string
{
    config(['database.connections.segunda_ordem_locks' => config('database.connections.mysql')]);
    DB::purge('segunda_ordem_locks');

    return 'segunda_ordem_locks';
}

/**
 * A linha do tratamento está travada NESTE instante?
 *
 * `FOR UPDATE` numa conexão que não segura nada: ou ela passa (linha livre) ou o motor a
 * derruba em 1s (1205/1213). Como a sonda não segura lock nenhum enquanto espera, ela não
 * pode causar o deadlock que veio medir — e o rollback imediato devolve a linha antes de o
 * caminho sob teste precisar dela.
 */
function tratamentoEstaTravado(string $conexao, int $tratamentoId): bool
{
    $segunda = DB::connection($conexao);
    $segunda->statement('SET SESSION innodb_lock_wait_timeout = 1');
    $segunda->beginTransaction();

    try {
        $segunda->select('SELECT id FROM tratamentos WHERE id = ? FOR UPDATE', [$tratamentoId]);

        return false; // livre: ninguém travou o tratamento até aqui
    } catch (QueryException $excecao) {
        // 1205 lock wait timeout · 1213 deadlock — os dois provam que a linha estava travada.
        // Qualquer OUTRO erro (conexão caída, tabela ausente) NÃO é "ordem invertida": engolir
        // aqui faria o teste falhar com um diagnóstico que aponta para o lugar errado.
        if (! in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true)) {
            throw $excecao;
        }

        return true;
    } finally {
        try {
            $segunda->rollBack();
        } catch (QueryException) {
            // 1213 já desfez a transação no motor; o ROLLBACK vira ruído, não falha
        }
    }
}

/**
 * Sonda a cada `for update` em `convenios` do caminho sob teste e devolve os veredictos.
 *
 * @return list<bool> um por lock de convênio tomado — `true` = tratamento já travado
 */
function sondarOrdemDosLocks(string $segunda, int $tratamentoId, Closure $caminho): array
{
    $veredictos = [];

    DB::listen(function ($consulta) use (&$veredictos, $segunda, $tratamentoId): void {
        if ($consulta->connectionName === $segunda) {
            return; // as consultas da própria sonda
        }
        if (! str_contains($consulta->sql, '`convenios`') || ! str_contains($consulta->sql, 'for update')) {
            return;
        }
        $veredictos[] = tratamentoEstaTravado($segunda, $tratamentoId);
    });

    $caminho();

    return $veredictos;
}

it('deve travar o tratamento ANTES do convênio no PUT de agendamento que troca o vínculo', function () {
    // ARRANGE — o caminho A no seu gatilho mais caro: troca de `tratamento_id` num
    // agendamento com sessão CONSUMIDA, que é o que dispara o estorno e faz o
    // `ConsumoSessaoService` querer a linha do tratamento lá adiante. Origem e destino no
    // MESMO convênio: é o par (tratamento, convênio) que o caminho B também disputa.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo(); // sem fechamento: a guarda toma o lock do convênio e libera
    $origem = $cena['tratamento'];
    $destino = Tratamento::factory()->create([
        'convenio_id' => $cena['convenio']->id,
        'paciente_id' => $cena['agendamento']->paciente_id,
        'especialidade_id' => $cena['agendamento']->especialidade_id,
        'profissional_id' => $cena['agendamento']->profissional_id,
    ]);

    // a sessão já consumida da origem (estado, não caminho — idiom do `cenaDeCiclo`)
    $cena['agendamento']->forceFill(['sessao_consumida_em' => '2026-07-01 11:00'])->save();
    $origem->forceFill(['sessoes_realizadas' => 1])->save();

    $segunda = segundaConexaoDaOrdemDeLocks();

    // ACT
    $veredictos = sondarOrdemDosLocks($segunda, (int) $origem->id, function () use ($adminDaClinica, $cena, $destino): void {
        $this->actingAs($adminDaClinica)->putJsonComVersao(
            "/api/agendamentos/{$cena['agendamento']->id}",
            [
                'inicio' => $cena['agendamento']->inicio->format('Y-m-d H:i'),
                'profissional_id' => $cena['agendamento']->profissional_id,
                'tratamento_id' => $destino->id,
            ],
        )->assertOk();
    });

    // ASSERT — sem nenhum lock de convênio não há o que medir: o teste não pode passar por
    // não ter chegado lá (a guarda não teria sido exercida)
    expect($veredictos)->not->toBeEmpty(
        'O PUT não tomou lock de convênio nenhum: a guarda de ciclo não foi exercida e este '
        .'teste não mediu ordem de lock alguma.'
    );
    expect($veredictos)->each->toBeTrue(
        'O caminho do AGENDAMENTO travou `convenios` com a linha do tratamento ainda LIVRE — '
        .'a ordem do D8/SEC-FC-12 (tratamentos → convenios) está invertida. Cruzando com o '
        .'PUT de tratamento, que trava na ordem certa, isso é deadlock 1213 estourando fora '
        .'do try/catch da guarda: 500 no lugar do 409.'
    );
});

it('deve travar o tratamento ANTES do convênio no PUT de tratamento que troca o convênio', function () {
    // ARRANGE — a outra metade do cruzamento. Aqui NADA foi consumido de propósito: a cerca
    // de identidade (`sessoes_realizadas > 0`) recusaria a troca antes da guarda de ciclo, e
    // o teste mediria uma 422 em vez da ordem dos locks.
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $outroConvenio = Convenio::create(['nome' => 'Operadora Fictícia '.fake()->unique()->word()]);
    $segunda = segundaConexaoDaOrdemDeLocks();

    // ACT
    $veredictos = sondarOrdemDosLocks($segunda, (int) $cena['tratamento']->id, function () use ($adminDaClinica, $cena, $outroConvenio): void {
        $this->actingAs($adminDaClinica)->putJsonComVersao(
            "/api/tratamentos/{$cena['tratamento']->id}",
            [
                'paciente_id' => $cena['tratamento']->paciente_id,
                'convenio_id' => $outroConvenio->id,
                'especialidade_id' => $cena['tratamento']->especialidade_id,
                'profissional_id' => $cena['tratamento']->profissional_id,
                'sessoes_total' => $cena['tratamento']->sessoes_total,
            ],
        )->assertOk();
    });

    // ASSERT — o lado que já estava certo, medido pela MESMA régua: é a comparação dos dois
    // veredictos que transforma "cada caminho trava alguma coisa" em "os dois travam na
    // mesma ordem", que é a única formulação que impede deadlock.
    expect($veredictos)->not->toBeEmpty(
        'O PUT de tratamento não tomou lock de convênio nenhum: a troca não chegou à guarda.'
    );
    expect($veredictos)->each->toBeTrue(
        'O caminho do TRATAMENTO travou `convenios` com a linha do tratamento ainda LIVRE.'
    );
});

/** Receita da criança do pacote, fora de qualquer janela fechada (a guarda trava e libera). */
function payloadDoLancamentoDaOrdemDeLocks(array $cena): array
{
    return [
        'tipo' => 'receita',
        'competencia' => '2026-08-01',
        'vencimento' => '2026-08-01',
        'interessado_tipo' => 'paciente',
        'interessado_id' => $cena['tratamento']->paciente_id,
        'categoria_id' => Categoria::create(['nome' => 'Receita Fictícia '.fake()->unique()->numberBetween(1, 999999), 'tipo' => 'receita'])->id,
        'valor' => '1200.00',
        'tipo_pagamento_id' => TipoPagamento::create(['nome' => 'Pgto Fictício '.fake()->unique()->numberBetween(1, 999999)])->id,
        'conta_id' => Conta::create(['nome' => 'Caixa Fictício '.fake()->unique()->numberBetween(1, 999999)])->id,
    ];
}

it('deve travar o tratamento ANTES do convênio ao criar lançamento vinculado', function () {
    // ARRANGE — caminho C (change `recebido-por-profissional`, CR-RPP-15): a guarda de ciclo da
    // criação vinculada travava o convênio com o tratamento livre, e o S-lock da FK do INSERT só
    // vinha depois — o cruzamento com o caminho A era o deadlock que a casa já consertou lá
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $payload = payloadDoLancamentoDaOrdemDeLocks($cena);
    $segunda = segundaConexaoDaOrdemDeLocks();

    // ACT
    $veredictos = sondarOrdemDosLocks($segunda, (int) $cena['tratamento']->id, function () use ($adminDaClinica, $cena, $payload): void {
        $this->actingAs($adminDaClinica)
            ->postJson('/api/lancamentos', [...$payload, 'tratamento_id' => $cena['tratamento']->id])
            ->assertCreated();
    });

    // ASSERT
    expect($veredictos)->not->toBeEmpty('A criação vinculada não passou pela guarda de ciclo.');
    expect($veredictos)->each->toBeTrue(
        'A criação vinculada travou `convenios` com o tratamento LIVRE — ordem invertida (D8/SEC-FC-12).'
    );
});

it('deve travar o tratamento de DESTINO antes do convênio no PUT que vincula o lançamento', function () {
    // ARRANGE — caminho D: o lançamento manual sem vínculo ganha o pacote
    $adminDaClinica = admin();
    $cena = cenaDeCiclo();
    $lancamento = lancamentoDoTratamento($cena['tratamento']->id, '2026-08-01');
    $lancamento->forceFill([
        'interessado_tipo' => 'paciente', 'interessado_id' => $cena['tratamento']->paciente_id, 'tratamento_id' => null,
    ])->saveQuietly();
    $segunda = segundaConexaoDaOrdemDeLocks();

    // ACT
    $veredictos = sondarOrdemDosLocks($segunda, (int) $cena['tratamento']->id, function () use ($adminDaClinica, $cena, $lancamento): void {
        $this->actingAs($adminDaClinica)
            ->putJsonComVersao("/api/lancamentos/{$lancamento->id}", ['tratamento_id' => $cena['tratamento']->id])
            ->assertOk();
    });

    // ASSERT
    expect($veredictos)->not->toBeEmpty('O PUT que vincula não passou pela guarda de ciclo.');
    expect($veredictos)->each->toBeTrue(
        'O PUT que vincula travou `convenios` com o tratamento de destino LIVRE — ordem invertida.'
    );
});

/** Uma linha qualquer está travada NESTE instante? (a mesma sonda, para tabela e id dados) */
function linhaDoLoteEstaTravada(string $conexao, string $tabela, int $id): bool
{
    $segunda = DB::connection($conexao);
    $segunda->statement('SET SESSION innodb_lock_wait_timeout = 1');
    $segunda->beginTransaction();

    try {
        $segunda->select("SELECT id FROM {$tabela} WHERE id = ? FOR UPDATE", [$id]);

        return false;
    } catch (QueryException $excecao) {
        if (! in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true)) {
            throw $excecao;
        }

        return true;
    } finally {
        try {
            $segunda->rollBack();
        } catch (QueryException) {
            // 1213 já desfez a transação no motor
        }
    }
}

it('deve travar os lançamentos e os tratamentos de TODOS os itens antes do convênio no lote', function () {
    // ARRANGE — caminho E (change `vincular-pagamentos-ao-tratamento`, CR-VPT-01/SEC-VPT-03): o lote
    // travava L1 → T1 → convênio e só depois L2/T2 — com o convênio Particular (UMA linha para todos
    // os pacotes) preso, cruzar com o PUT de agendamento de uma sessão de T2 era deadlock
    $adminDaClinica = admin();
    $particular = Convenio::create(['nome' => 'Particular Fictício '.fake()->unique()->word(), 'particular' => true]);
    $profissional = Profissional::factory()->create();
    $itens = [];
    foreach ([1, 2] as $_) {
        $crianca = Paciente::factory()->create();
        $pacote = Tratamento::factory()->create([
            'paciente_id' => $crianca->id, 'convenio_id' => $particular->id, 'profissional_id' => $profissional->id,
        ]);
        $pagamento = new LancamentoCaixa([
            ...payloadDoLancamentoDaOrdemDeLocks(['tratamento' => $pacote]),
            'competencia' => '2026-09-01', 'vencimento' => '2026-09-01', 'interessado_id' => $crianca->id,
        ]);
        $pagamento->forceFill(['pago_em' => '2026-09-10 09:00', 'contabil' => true])->save();
        $itens[] = [$pagamento, $pacote];
    }
    [$segundoPagamento, $segundoPacote] = $itens[1];
    config(['database.connections.segunda_do_lote' => config('database.connections.mysql')]);
    DB::purge('segunda_do_lote');
    $veredictos = [];
    DB::listen(function ($consulta) use (&$veredictos, $segundoPagamento, $segundoPacote): void {
        if ($consulta->connectionName === 'segunda_do_lote'
            || ! str_contains($consulta->sql, '`convenios`') || ! str_contains($consulta->sql, 'for update')) {
            return;
        }
        $veredictos[] = linhaDoLoteEstaTravada('segunda_do_lote', 'tratamentos', $segundoPacote->id)
            && linhaDoLoteEstaTravada('segunda_do_lote', 'lancamentos_caixa', $segundoPagamento->id);
    });

    // ACT
    $this->actingAs($adminDaClinica)->postJson('/api/lancamentos/vincular-tratamentos', ['vinculos' => array_map(
        fn (array $par) => ['lancamento_id' => $par[0]->id, 'tratamento_id' => $par[1]->id], $itens,
    )])->assertOk();

    // ASSERT
    expect($veredictos)->not->toBeEmpty('O lote não passou pela guarda de ciclo.');
    expect($veredictos)->each->toBeTrue(
        'O lote travou `convenios` com o tratamento ou o lançamento de um item seguinte LIVRE — ordem invertida.'
    );
});
