<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Evolucao;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Database\Events\TransactionBeginning;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;

/*
 * A trava da evolução que finaliza a sessão (change evolucao-finaliza-a-sessao, gates SEC-EVO-01,
 * CR-EVO-R2-03 e SEC-EVO-R2-05). Com o bloqueio pós-status e a finalização ligados, a evolução só passa
 * porque a sessão VAI ser finalizada — então a sessão é travada ANTES das invariantes, e evolução e status
 * acontecem numa transação só. As mutações "sem a trava" e "sem a tradução do erro" passavam nos testes
 * de feature: só uma SEGUNDA conexão de verdade responde se a linha bloqueia. Dados 100% FICTÍCIOS.
 */

function segundaConexaoDaFinalizacao(): string
{
    config(['database.connections.segunda_finalizacao' => config('database.connections.mysql')]);
    DB::purge('segunda_finalizacao');

    return 'segunda_finalizacao';
}

/** A sessão de ontem, em aberto, com pacote de saldo, a finalização ligada e o bloqueio como pedido. */
function sessaoTravavel(bool $bloqueio = true): array
{
    $base = baseDaBaixa();
    $pacote = pacoteDaBaixa($base, 10);
    $sessao = agendamentoDaBaixa($base, agoraNaClinica()->subDay()->format('Y-m-d').' 14:00', ['tratamento_id' => $pacote->id]);
    app(ConfiguracaoService::class)->set('evolucoes.status_ao_salvar', $base['status']['finalizado']);
    app(ConfiguracaoService::class)->set('evolucoes.bloquear_apos_status', $bloqueio);

    return [$base, $sessao];
}

function corpoDaEvolucaoTravada(array $base): array
{
    return [
        'profissional_id' => $base['profissional_id'],
        'conteudo' => 'Evolução clínica fictícia da sessão.',
        'motivo_assinatura' => 'Registro administrativo em teste.',
    ];
}

afterEach(function (): void {
    // a conexão principal é reaproveitada pela suíte: o timeout curto não pode vazar
    DB::statement('SET SESSION innodb_lock_wait_timeout = 50');
});

it('deve responder 409 e não gravar nada quando outra escrita trava a sessão', function (bool $bloqueio) {
    // ARRANGE — a recepção (segunda conexão) segura a sessão; a evolução desiste em 1 s. Nos DOIS modos:
    // no padrão (bloqueio desligado) a corrida virava 500 (gate SEC-EVO-R3-02)
    $admin = admin();
    [$base, $sessao] = sessaoTravavel($bloqueio);
    $segunda = segundaConexaoDaFinalizacao();
    DB::connection($segunda)->beginTransaction();
    DB::connection($segunda)->table('agendamentos')->where('id', $sessao->id)->lockForUpdate()->get();
    DB::statement('SET SESSION innodb_lock_wait_timeout = 1');

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", corpoDaEvolucaoTravada($base));
    DB::connection($segunda)->rollBack();

    // ASSERT — "tente de novo" (409), nunca 500; e nada pela metade
    $resposta->assertStatus(409);
    expect(Atendimento::query()->where('agendamento_id', $sessao->id)->exists())->toBeFalse()
        ->and($sessao->refresh()->status_id)->toBe($base['status']['inicial']);
})->with(['bloqueio ligado' => [true], 'bloqueio desligado (o padrão)' => [false]]);

it('deve fazer a troca de status concorrente esperar a evolução, e não passar por cima dela', function () {
    // ARRANGE — a sessão já registrada (a rota de hoje). No instante em que a evolução nasce, a recepção
    // tenta desmarcar pela segunda conexão: com a trava, o UPDATE espera; sem ela, desmarcava e a
    // evolução aplicava o status final por cima do desmarque
    $admin = admin();
    [$base, $sessao] = sessaoTravavel();
    $atendimento = atendimentoRegistradoNaBaixa($base, $sessao->id, $sessao->fim->format('Y-m-d H:i'));
    $desmarcado = StatusAgendamento::query()->where('ocupa_horario', false)->firstOrFail();
    $segunda = segundaConexaoDaFinalizacao();
    DB::connection($segunda)->statement('SET SESSION innodb_lock_wait_timeout = 1');
    $esperou = null;
    // o ouvinte se DESLIGA depois do pedido: `flushEventListeners` levaria junto os observadores da
    // trilha do model, e os testes seguintes do mesmo processo ficariam sem auditoria
    $ligado = true;
    Evolucao::creating(function () use ($segunda, $sessao, $desmarcado, &$esperou, &$ligado): void {
        if (! $ligado) {
            return;
        }
        try {
            DB::connection($segunda)->table('agendamentos')->where('id', $sessao->id)->update(['status_id' => $desmarcado->id]);
            $esperou = false;
        } catch (QueryException $erro) {
            $esperou = in_array($erro->errorInfo[1] ?? null, [1205, 1213], true);
        }
    });

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/atendimentos/{$atendimento->id}/evolucao", corpoDaEvolucaoTravada($base));
    $ligado = false;

    // ASSERT — o desmarque esperou a trava; a sessão terminou finalizada pela evolução
    expect($esperou)->toBeTrue();
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', true);
    expect($sessao->refresh()->status_id)->toBe($base['status']['finalizado']);
});

it('deve fazer a passagem da sessão à colega esperar a evolução também no modo padrão', function (string $rota) {
    // ARRANGE — gates SEC-EVO-R4-02 e CR-EVO-R4-01 (modelo do gate): com o bloqueio DESLIGADO, a recepção
    // passa a sessão à colega por uma segunda conexão no meio da escrita da dona. Pela rota de hoje
    // (atendimento já registrado), só a trava do `gravarEFinalizar` segura a linha
    admin();
    [$base, $sessao] = sessaoTravavel(bloqueio: false);
    $atendimento = $rota === 'de hoje' ? atendimentoRegistradoNaBaixa($base, $sessao->id, $sessao->fim->format('Y-m-d H:i')) : null;
    $dona = Profissional::query()->findOrFail($base['profissional_id']);
    $colega = Profissional::factory()->create();
    $escopado = usuarioEscopadoEm($dona, ['evolucoes.criar', 'atendimentos.criar', 'atendimentos.ver']);
    $segunda = segundaConexaoDaFinalizacao();
    DB::connection($segunda)->statement('SET SESSION innodb_lock_wait_timeout = 1');
    $esperou = null;
    $ligado = true;
    Evolucao::creating(function () use ($segunda, $sessao, $colega, &$esperou, &$ligado): void {
        if (! $ligado) {
            return;
        }
        try {
            DB::connection($segunda)->table('agendamentos')->where('id', $sessao->id)->update(['profissional_id' => $colega->id]);
            $esperou = false;
        } catch (QueryException $erro) {
            $esperou = in_array($erro->errorInfo[1] ?? null, [1205, 1213], true);
        }
    });

    // ACT
    $url = $rota === 'de hoje' ? "/api/atendimentos/{$atendimento->id}/evolucao" : "/api/agendamentos/{$sessao->id}/evolucao";
    $resposta = $this->actingAs($escopado)->postJson($url, ['profissional_id' => $dona->id, 'conteudo' => 'Evolução clínica fictícia da sessão.']);
    $ligado = false;

    // ASSERT — a passagem esperou a trava; a evolução da dona ficou na sessão DA DONA
    $resposta->assertCreated();
    expect($esperou)->toBeTrue()
        ->and(Agendamento::query()->find($sessao->id)->profissional_id)->toBe($dona->id);
})->with(['nova', 'de hoje']);

it('deve começar a finalização só com a evolução já gravada, no modo padrão (D2)', function () {
    // ARRANGE — gate CR-EVO-R4-02 (modelo do gate): a segunda conexão só enxerga o que foi COMMITADO.
    // Mover a finalização para dentro da transação da evolução faria um deadlock nela desfazer a evolução
    $admin = admin();
    [$base, $sessao] = sessaoTravavel(bloqueio: false);
    $segunda = segundaConexaoDaFinalizacao();
    $gravadaAoComecarAlgumaTransacao = false;
    Event::listen(TransactionBeginning::class, function () use ($segunda, $sessao, &$gravadaAoComecarAlgumaTransacao): void {
        $existe = DB::connection($segunda)->table('evolucoes')
            ->join('atendimentos', 'atendimentos.id', '=', 'evolucoes.atendimento_id')
            ->where('atendimentos.agendamento_id', $sessao->id)->exists();
        $gravadaAoComecarAlgumaTransacao = $gravadaAoComecarAlgumaTransacao || $existe;
    });

    // ACT
    $resposta = $this->actingAs($admin)->postJson("/api/agendamentos/{$sessao->id}/evolucao", corpoDaEvolucaoTravada($base));

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('sessao.finalizada', true);
    expect($gravadaAoComecarAlgumaTransacao)->toBeTrue();
});
