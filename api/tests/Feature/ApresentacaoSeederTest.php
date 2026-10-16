<?php

use App\Models\Evolucao;
use Database\Seeders\ApresentacaoSeeder;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Support\Facades\DB;

/** Base de apresentação com histórico curto — as regras são as mesmas do ano inteiro. */
function semearApresentacao(int $meses = 2): void
{
    test()->seed(DatabaseSeeder::class);
    $seeder = new ApresentacaoSeeder($meses);
    $seeder->setContainer(app());
    $seeder->__invoke();
}

it('deve registrar atendimento para toda sessão realizada e nenhum para falta', function () {
    // ARRANGE + ACT
    semearApresentacao();

    // ASSERT — a régua canônica (T-not-15): realizada = desconta sem marcar falta
    $semAtendimento = DB::table('agendamentos as a')
        ->join('status_agendamento as s', 's.id', '=', 'a.status_id')
        ->leftJoin('atendimentos as t', 't.agendamento_id', '=', 'a.id')
        ->where('s.desconta_sessao', true)->where('s.marca_falta', false)
        ->where('a.fim', '<=', now('America/Sao_Paulo')->format('Y-m-d H:i:s'))
        ->whereNull('t.id')->count();
    $faltaComAtendimento = DB::table('agendamentos as a')
        ->join('status_agendamento as s', 's.id', '=', 'a.status_id')
        ->join('atendimentos as t', 't.agendamento_id', '=', 'a.id')
        ->where('s.marca_falta', true)->count();

    expect(DB::table('atendimentos')->count())->toBeGreaterThan(100)
        ->and($semAtendimento)->toBe(0)
        ->and($faltaComAtendimento)->toBe(0);
});

it('deve marcar cada sessão dentro do horário de trabalho do profissional', function () {
    // ARRANGE + ACT
    semearApresentacao();

    // ASSERT — guarda do bug do locale: `startOfWeek()` em pt-BR começa no DOMINGO e
    // jogava toda sessão um dia antes do expediente (e sumia com as de segunda)
    $foraDoExpediente = DB::table('agendamentos as a')
        ->where('a.tipo', 'atendimento')
        ->whereNotExists(fn ($q) => $q->from('profissional_horarios as h')
            ->whereColumn('h.profissional_id', 'a.profissional_id')
            ->whereRaw('h.dia_semana = WEEKDAY(a.inicio) + 1')
            ->whereRaw('h.inicio <= TIME(a.inicio)')
            ->whereRaw('h.fim >= TIME(a.fim)'))
        ->count();
    $diasDaSemana = DB::table('agendamentos')->where('tipo', 'atendimento')
        ->selectRaw('DISTINCT WEEKDAY(inicio) + 1 AS dia')->pluck('dia')->sort()->values()->all();

    expect($foraDoExpediente)->toBe(0)
        ->and($diasDaSemana)->toBe([1, 2, 3, 4, 5]);
});

it('deve deixar em atraso só a dívida antiga, nunca a sessão da semana', function () {
    // ARRANGE + ACT
    semearApresentacao();

    // ASSERT — o "em atraso" é argumento de venda: numa clínica saudável ele é pequeno
    $hoje = now('America/Sao_Paulo')->startOfDay();
    $vencidas = DB::table('lancamentos_caixa')->where('tipo', 'receita')->whereNull('pago_em')
        ->where('vencimento', '<', $hoje->toDateString());

    expect((clone $vencidas)->where('vencimento', '>=', $hoje->subDays(45)->toDateString())->count())->toBe(0)
        ->and(DB::table('lancamentos_caixa')->whereNotNull('pago_em')->whereNull('pago_por_id')->count())->toBe(0);
});

it('deve gravar a evolução cifrada e legível pelo model', function () {
    // ARRANGE + ACT
    semearApresentacao();

    // ASSERT — o seeder cifra à mão (insert em lote); o cast do model tem de abrir
    $cru = DB::table('evolucoes')->value('conteudo');
    $evolucao = Evolucao::query()->firstOrFail();

    expect($cru)->not->toBe($evolucao->conteudo)
        ->and($evolucao->conteudo)->toBeString()->not->toBeEmpty();
});

it('deve recusar uma base que já tem pacientes', function () {
    // ARRANGE
    semearApresentacao(1);

    // ACT + ASSERT
    $seeder = new ApresentacaoSeeder(1);
    $seeder->setContainer(app());

    expect(fn () => $seeder->__invoke())->toThrow(RuntimeException::class, 'migrate:fresh');
});
