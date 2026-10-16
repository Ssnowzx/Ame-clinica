<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Paciente;
use App\Support\Agenda\AgendamentoService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Uma SEGUNDA conexão de verdade — não um segundo model, não um segundo objeto: outro PDO,
 * outra sessão do banco. É o único instrumento que responde à pergunta que importa:
 * *a linha BLOQUEIA, ou apenas fingimos que sim?*
 */
function segundaConexao(): string
{
    config(['database.connections.segunda' => config('database.connections.mysql')]);
    DB::purge('segunda');

    return 'segunda';
}

/**
 * A DECISÃO DE DESENHO DESTA CHANGE DEPENDE DESTE TESTE.
 *
 * A guarda do PAC-REP é CONDICIONAL ("pode trocar o paciente enquanto não há atendimento").
 * Condicional só é guarda se decidir sob lock: senão o atendimento nasce ENTRE a checagem e
 * a gravação, a guarda passa, e o prontuário de uma criança fica colado em outra — num
 * estado que NÃO TEM VOLTA (trocar de novo é recusado; a evolução não tem rota de exclusão;
 * o atendimento não se exclui com evolução; o agendamento não se exclui com atendimento).
 *
 * O lock que SUSTENTA a guarda é o X-lock na linha do AGENDAMENTO: o `INSERT` em
 * `atendimentos` precisa do S-lock da FK na linha PAI, e por isso ele BLOQUEIA. Isso vale em
 * REPEATABLE READ **e** em READ COMMITTED — é o que o torna a âncora, e não o reforço.
 *
 * Se este teste não passar, o parecer é explícito: a decisão cai para o fallback —
 * `paciente_id` IMUTÁVEL. Guarda que não se prova não é guarda.
 */
it('deve BLOQUEAR o nascimento de um atendimento enquanto o agendamento está travado', function () {
    // ARRANGE — dados COMMITADOS (esta suíte não roda dentro de transação)
    admin();
    $agendamento = Agendamento::factory()->create();
    $segunda = segundaConexao();

    // a conexão B desiste rápido: sem isto, o teste esperaria o timeout default (50s)
    DB::connection($segunda)->statement('SET SESSION innodb_lock_wait_timeout = 2');

    // ACT — a conexão A trava a linha do agendamento, como a guarda faz
    DB::beginTransaction();
    DB::table('agendamentos')->where('id', $agendamento->id)->lockForUpdate()->get();

    // ...e a conexão B tenta fazer nascer o atendimento (o outro lado da corrida)
    $bloqueou = false;
    try {
        DB::connection($segunda)->table('atendimentos')->insert([
            'agendamento_id' => $agendamento->id,
            'finalizado_em' => now()->format('Y-m-d H:i:s'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    } catch (QueryException $excecao) {
        // 1205 = lock wait timeout · 1213 = deadlock. Qualquer um PROVA que a linha travou:
        // sem o lock, o INSERT passaria na hora.
        $bloqueou = in_array($excecao->errorInfo[1] ?? null, [1205, 1213], true);
    }

    DB::rollBack();

    // ASSERT
    expect($bloqueou)->toBeTrue(
        'O INSERT em `atendimentos` NÃO bloqueou com o agendamento travado. '
        .'A guarda condicional do PAC-REP perde a âncora — caia para `paciente_id` imutável.'
    );
    expect(Atendimento::where('agendamento_id', $agendamento->id)->exists())->toBeFalse();
});

/**
 * O REFORÇO (gap lock no índice único `atendimentos.agendamento_id`) SÓ EXISTE em REPEATABLE
 * READ. Se alguém trocar o banco para READ COMMITTED, ele desaparece **em silêncio** — sem
 * uma linha de código mudar, sem um teste ficar vermelho.
 *
 * Este teste é o alarme: ele conta a história ANTES do incidente, não depois.
 * (A âncora — o X-lock na linha do agendamento — continua valendo nos dois níveis. É por
 * isso que ela é a âncora.)
 */
it('deve rodar em REPEATABLE READ — o reforço da guarda depende disso', function () {
    // ACT
    $isolamento = DB::selectOne('SELECT @@transaction_isolation AS nivel')->nivel;

    // ASSERT
    expect(str_replace('-', ' ', strtoupper($isolamento)))->toBe('REPEATABLE READ');
});

/**
 * A guarda decide sobre o estado RELIDO SOB LOCK, não sobre o model que o controller
 * carregou. Este é o interleaving determinístico do lost update: a "requisição" carrega o
 * agendamento ANTES de o atendimento existir — como aconteceria numa corrida real — e mesmo
 * assim a troca de paciente tem que ser recusada.
 *
 * Se a guarda consultasse o model em memória, este teste passaria batido.
 */
it('deve recusar a troca decidindo pelo estado RELIDO, não pelo model já carregado', function () {
    // ARRANGE — a "requisição" carrega o agendamento quando ele ainda não tem atendimento
    $adminDaClinica = admin();
    $agendamento = Agendamento::factory()->create();
    $donoOriginal = $agendamento->paciente_id;
    $outraCrianca = Paciente::factory()->create();

    $modelDaRequisicao = Agendamento::find($agendamento->id); // snapshot: sem atendimento

    // ...e SÓ ENTÃO o atendimento nasce (a corrida que a guarda tem que perder de vista)
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$agendamento->id}/atendimento", [])
        ->assertCreated();

    // ACT — o serviço recebe o model STALE, exatamente como o controller o entregaria
    $recusou = false;
    try {
        app(AgendamentoService::class)->atualizar(
            $modelDaRequisicao,
            [
                'inicio' => $modelDaRequisicao->inicio->format('Y-m-d H:i'),
                'profissional_id' => $modelDaRequisicao->profissional_id,
                'paciente_id' => $outraCrianca->id,
            ],
            false,
        );
    } catch (ValidationException $excecao) {
        $recusou = array_key_exists('paciente_id', $excecao->errors());
    }

    // ASSERT — a guarda releu o banco, não acreditou no model
    expect($recusou)->toBeTrue();
    expect($agendamento->fresh()->paciente_id)->toBe($donoOriginal);
});
