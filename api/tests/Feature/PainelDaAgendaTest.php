<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\LembreteEnviado;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/**
 * O painel da AGENDA (change indicadores-profissionais, D4/D9): `GET /api/indicadores/painel/agenda`
 * sob `agenda.ver`, escopo D11 do eixo agenda. Cada número do D4 tem o seu teste, e cada teste cai
 * quando a regra muda. Dados 100% fictícios (LGPD); a resposta nunca carrega paciente.
 *
 * Relógio FIXO: segunda-feira, 5 de outubro de 2026, 10h na parede da clínica. O período é de 1 a 5
 * de outubro (quinta a segunda) e o comparado, de 1 a 5 de setembro (terça a sábado).
 */
const MES_DO_PAINEL_AGENDA = '2026-10';

/** Segunda e terça, 08:00–12:00: com sessão de 40 min, 6 sessões por dia. */
const GRADE_DO_PAINEL_AGENDA = [
    1 => [['inicio' => '08:00', 'fim' => '12:00']],
    2 => [['inicio' => '08:00', 'fim' => '12:00']],
];

function relogioDoPainelAgenda(): void
{
    test()->travelTo(CarbonImmutable::parse('2026-10-05 10:00:00', 'America/Sao_Paulo'));
}

/** Profissional ATIVO com uma especialidade de 40 min e, opcionalmente, a grade. */
function profissionalDoPainelAgenda(string $nome, array $horarios = [], array $atributos = []): Profissional
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->comHorarios($horarios)->create(['nome' => $nome, ...$atributos]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return $profissional;
}

/**
 * O status do cadastro padrão pelo PAPEL, escolhido pelas flags — nunca pelo nome: o próprio teste
 * obedece à regra que prova.
 */
function statusDoPainelAgenda(string $papel): StatusAgendamento
{
    $flags = match ($papel) {
        'realizada' => ['desconta_sessao' => true, 'marca_falta' => false, 'ocupa_horario' => true, 'marca_reserva' => false],
        'falta' => ['marca_falta' => true],
        'desmarque' => ['ocupa_horario' => false, 'marca_falta' => false, 'desconta_sessao' => false],
        'aberto' => ['em_aberto' => true],
        'reserva' => ['marca_reserva' => true],
        // ocupa o horário, não desconta, não é falta nem reserva nem "em aberto": a Falta Justificada
        'justificada' => ['desconta_sessao' => false, 'ocupa_horario' => true, 'marca_falta' => false, 'marca_reserva' => false, 'em_aberto' => false],
    };

    return StatusAgendamento::query()->where($flags)->orderBy('ordem')->orderBy('id')->firstOrFail();
}

/** Sessão de 40 min do profissional, no status dado (parede da clínica). */
function sessaoDoPainelAgenda(Profissional $profissional, string $inicio, StatusAgendamento $status, array $extra = []): Agendamento
{
    $comeco = Carbon::createFromFormat('Y-m-d H:i', $inicio);

    return Agendamento::factory()->create([
        'profissional_id' => $profissional->id,
        'especialidade_id' => DB::table('profissional_especialidade')->where('profissional_id', $profissional->id)->value('especialidade_id'),
        'paciente_id' => Paciente::query()->value('id') ?? Paciente::factory()->create()->id,
        'status_id' => $status->id,
        'inicio' => $comeco->format('Y-m-d H:i'),
        'fim' => $comeco->copy()->addMinutes(40)->format('Y-m-d H:i'),
        ...$extra,
    ]);
}

/** O histórico da clínica começa em agosto: o comparado de setembro tem com que comparar. */
function historicoDesdeAgostoDoPainelAgenda(Profissional $profissional): void
{
    sessaoDoPainelAgenda($profissional, '2026-08-10 09:00', statusDoPainelAgenda('realizada'));
}

/** O lembrete automático gravado para a sessão, como o disparo grava. */
function lembreteDoPainelAgenda(Agendamento $sessao, string $situacao = LembreteEnviado::ENVIADO, ?string $resposta = null): LembreteEnviado
{
    $lembrete = new LembreteEnviado([
        'agendamento_id' => $sessao->id,
        'paciente_id' => $sessao->paciente_id,
        'inicio_lembrado' => $sessao->inicio->format('Y-m-d H:i:s'),
        'tipo' => LembreteEnviado::TIPO_AGENDAMENTO,
        'competencia' => $sessao->inicio->toDateString(),
        'status' => $situacao,
    ]);
    // a resposta é do servidor (fora do fillable): o toque da família grava por fora
    $lembrete->forceFill(['resposta' => $resposta])->save();

    return $lembrete;
}

/** Um pacote fictício do convênio, para a sessão apontar. */
function pacoteDoPainelAgenda(Profissional $profissional, Convenio $convenio): Tratamento
{
    return Tratamento::factory()->create([
        'paciente_id' => Paciente::query()->value('id') ?? Paciente::factory()->create()->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => DB::table('profissional_especialidade')->where('profissional_id', $profissional->id)->value('especialidade_id'),
        'convenio_id' => $convenio->id,
    ]);
}

function painelDaAgenda(string $mes = MES_DO_PAINEL_AGENDA): TestResponse
{
    return test()->getJson("/api/indicadores/painel/agenda?mes={$mes}");
}

it('deve responder 403 a quem não tem agenda.ver — antes de validar o mês', function () {
    // ARRANGE
    admin();
    $semAgenda = usuarioCom(['pacientes.ver', 'fluxo_caixa.ver', 'atendimentos.ver'], 'Sem Agenda do Painel');

    // ACT + ASSERT — mês inválido continua 403: a permissão decide primeiro
    $this->actingAs($semAgenda);
    painelDaAgenda()->assertForbidden();
    painelDaAgenda('2026-13')->assertForbidden();
});

it('deve responder 422 com mês ausente, fora do formato ou no futuro da clínica', function () {
    // ARRANGE
    relogioDoPainelAgenda();
    $this->actingAs(admin());

    // ACT + ASSERT
    $this->getJson('/api/indicadores/painel/agenda')->assertUnprocessable()->assertJsonValidationErrors('mes');
    painelDaAgenda('2026-13')->assertUnprocessable()->assertJsonValidationErrors('mes');
    painelDaAgenda('2026-11')->assertUnprocessable()->assertJsonValidationErrors('mes');
});

it('deve contar na taxa de faltas o status NOVO que a clínica marcou como falta, sem mudança de código', function () {
    // ARRANGE — um status criado pela clínica com `marca_falta`; a Falta Justificada NÃO tem a flag
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $ausencia = StatusAgendamento::create([
        'nome' => 'Ausência Fictícia', 'cor' => '#111111', 'tipo' => 'user-x', 'ordem' => 12,
        'desconta_sessao' => false, 'ocupa_horario' => true, 'marca_falta' => true,
    ]);
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia das Faltas');
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', $ausencia);
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:40', statusDoPainelAgenda('falta'));
    sessaoDoPainelAgenda($profissional, '2026-10-02 09:00', statusDoPainelAgenda('justificada'));
    sessaoDoPainelAgenda($profissional, '2026-10-02 09:40', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — 2 faltas sobre 4 que já passaram; o "i" lista os dois nomes, na ordem do cadastro
    expect($painel->json('faltas.atual'))->toBe(['quantidade' => 2, 'taxa' => 0.5])
        ->and($painel->json('sessoes_passadas.atual'))->toBe(4)
        ->and($painel->json('status_que_contam.falta'))->toBe(['Não Compareceu', 'Ausência Fictícia']);
});

it('deve deixar fora da base as sessões que ainda não aconteceram', function () {
    // ARRANGE — duas antes das 10h de hoje; duas mais tarde hoje (no período, ainda futuras) e uma amanhã
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictício do Relógio');
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:00', statusDoPainelAgenda('falta'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:40', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 14:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 15:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-06 09:00', statusDoPainelAgenda('aberto'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — a base são as 2 que passaram: falta de 1 em 2, e a situação não vê as futuras
    expect($painel->json('sessoes_passadas.atual'))->toBe(2)
        ->and($painel->json('faltas.atual'))->toBe(['quantidade' => 1, 'taxa' => 0.5])
        ->and($painel->json('realizadas.atual'))->toBe(1)
        ->and(collect($painel->json('situacao'))->sum('quantidade'))->toBe(2);
});

it('deve deixar a reserva de agenda fora de toda conta', function () {
    // ARRANGE — uma reserva e uma realizada, as duas no passado, no horário da grade
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia da Reserva', GRADE_DO_PAINEL_AGENDA);
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:00', statusDoPainelAgenda('reserva'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:40', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — nem base, nem situação, nem marcada no mapa
    $reserva = statusDoPainelAgenda('reserva');
    expect($painel->json('sessoes_passadas.atual'))->toBe(1)
        ->and(collect($painel->json('situacao'))->pluck('status_id')->all())->not->toContain($reserva->id)
        ->and($painel->json('ocupacao_por_periodo.0.marcadas'))->toBe(1);
});

it('deve contar como desmarque os status que liberam o horário, e listar os nomes deles', function () {
    // ARRANGE — os dois "Desmarcado" do cadastro padrão, uma realizada e uma falta
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictício dos Desmarques');
    $pacienteDesmarcou = StatusAgendamento::query()
        ->where('ocupa_horario', false)->where('id', '!=', statusDoPainelAgenda('desmarque')->id)->firstOrFail();
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', statusDoPainelAgenda('desmarque'));
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:40', $pacienteDesmarcou);
    sessaoDoPainelAgenda($profissional, '2026-10-02 09:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-02 09:40', statusDoPainelAgenda('falta'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT
    expect($painel->json('desmarques.atual'))->toBe(['quantidade' => 2, 'taxa' => 0.5])
        ->and($painel->json('status_que_contam.desmarque'))->toBe(['Desmarcado pelo Profissional', 'Desmarcado pelo Paciente']);
});

it('deve contar UMA vez, como falta, o status que marca falta e também libera o horário', function () {
    // ARRANGE — a clínica pode ligar as duas flags; as contagens continuam disjuntas (a falta vence,
    // como nos baldes da produtividade)
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $faltaQueLibera = StatusAgendamento::create([
        'nome' => 'Falta Que Libera Fictícia', 'cor' => '#222222', 'tipo' => 'user-x', 'ordem' => 13,
        'desconta_sessao' => false, 'ocupa_horario' => false, 'marca_falta' => true,
    ]);
    $profissional = profissionalDoPainelAgenda('Profissional Fictício da Precedência');
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', $faltaQueLibera);
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:40', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT
    expect($painel->json('faltas.atual'))->toBe(['quantidade' => 1, 'taxa' => 0.5])
        ->and($painel->json('desmarques.atual'))->toBe(['quantidade' => 0, 'taxa' => 0.0])
        ->and($painel->json('status_que_contam.desmarque'))->not->toContain('Falta Que Libera Fictícia');
});

it('deve contar como realizada a que desconta a sessão e não é falta', function () {
    // ARRANGE — duas realizadas (Finalizado e Finalizado com Evolução), uma falta que também desconta
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia das Realizadas');
    $comEvolucao = StatusAgendamento::query()
        ->where('desconta_sessao', true)->where('marca_falta', false)
        ->where('id', '!=', statusDoPainelAgenda('realizada')->id)->firstOrFail();
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:40', $comEvolucao);
    sessaoDoPainelAgenda($profissional, '2026-10-02 09:00', statusDoPainelAgenda('falta'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT
    expect($painel->json('realizadas.atual'))->toBe(2);
});

it('deve contar como realizada, e NÃO como desmarque, o status que desconta a sessão e libera o horário', function () {
    // ARRANGE — a clínica pode ligar as duas flags; a precedência realizada > desmarque mantém as
    // contagens disjuntas (CR-IND-08), como nos baldes da produtividade
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $realizadaQueLibera = StatusAgendamento::create([
        'nome' => 'Realizada Que Libera Fictícia', 'cor' => '#333333', 'tipo' => 'check', 'ordem' => 14,
        'desconta_sessao' => true, 'ocupa_horario' => false, 'marca_falta' => false,
    ]);
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia da Precedência da Realizada');
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', $realizadaQueLibera);
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:40', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT
    expect($painel->json('realizadas.atual'))->toBe(2)
        ->and($painel->json('desmarques.atual'))->toBe(['quantidade' => 0, 'taxa' => 0.0])
        ->and($painel->json('status_que_contam.desmarque'))->not->toContain('Realizada Que Libera Fictícia');
});

it('deve multiplicar a grade pelos atendimentos simultâneos de quem atende em grupo', function () {
    // ARRANGE — atendimento em grupo de até 4: na segunda 5/10 (08–12, sessão de 40 min) são 6 horários
    // × 4 crianças = 24 vagas; 4 crianças marcadas no MESMO horário das 08:00
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $emGrupo = profissionalDoPainelAgenda('Profissional Fictícia do Grupo', GRADE_DO_PAINEL_AGENDA, ['atendimentos_simultaneos' => 4]);
    foreach (range(1, 4) as $crianca) {
        sessaoDoPainelAgenda($emGrupo, '2026-10-05 08:00', statusDoPainelAgenda('realizada'), [
            'paciente_id' => Paciente::factory()->create()->id,
        ]);
    }

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — 4 ÷ 24, no cartão e na célula do mapa
    expect($painel->json('ocupacao.atual'))->toBe(0.1667)
        ->and($painel->json('ocupacao_por_periodo'))->toBe([
            ['dia' => 1, 'periodo' => 'manha', 'marcadas' => 4, 'capacidade' => 24, 'taxa' => 0.1667],
        ]);
});

it('deve partir o dia nas MESMAS fronteiras das 12h e das 18h para as sessões e para a grade', function () {
    // ARRANGE — grade de segunda 08–20 (6 vagas de manhã, 9 à tarde, 3 à noite); sessões nas bordas
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictício das Fronteiras', [1 => [['inicio' => '08:00', 'fim' => '20:00']]]);
    sessaoDoPainelAgenda($profissional, '2026-10-05 11:20', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 12:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 17:20', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 18:00', statusDoPainelAgenda('aberto'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — 12:00 já é tarde e 18:00 já é noite, no numerador E no denominador (CR-IND-13)
    expect($painel->json('ocupacao_por_periodo'))->toBe([
        ['dia' => 1, 'periodo' => 'manha', 'marcadas' => 1, 'capacidade' => 6, 'taxa' => 0.1667],
        ['dia' => 1, 'periodo' => 'tarde', 'marcadas' => 2, 'capacidade' => 9, 'taxa' => 0.2222],
        ['dia' => 1, 'periodo' => 'noite', 'marcadas' => 1, 'capacidade' => 3, 'taxa' => 0.3333],
    ]);
});

it('não deve contar como "com grade" quem tem horário mas nenhuma especialidade com duração', function () {
    // ARRANGE — as duas com horário na segunda; só uma tem especialidade (a duração da sessão)
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $comGrade = profissionalDoPainelAgenda('Profissional Fictícia Com Duração', GRADE_DO_PAINEL_AGENDA);
    $semDuracao = Profissional::factory()->comHorarios(GRADE_DO_PAINEL_AGENDA)->create(['nome' => 'Profissional Fictício Sem Duração']);
    sessaoDoPainelAgenda($comGrade, '2026-10-05 08:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($semDuracao, '2026-10-05 08:00', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — "1 de 2 com grade", e a marcada de quem não tem denominador fica fora da conta (CR-IND-14)
    expect($painel->json('ocupacao'))->toBe([
        'atual' => 0.1667,
        'anterior' => null,
        'profissionais_com_grade' => 1,
        'profissionais' => 2,
    ]);
});

it('deve listar só as sessões que já passaram quando a situação abre os itens com passadas=1', function () {
    // ARRANGE — duas finalizadas hoje: a das 08:00 já passou; a das 12:00 ainda não (às 10h da clínica,
    // mas já passou no relógio UTC do servidor — o corte é o da parede da clínica)
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia dos Itens');
    $realizada = statusDoPainelAgenda('realizada');
    $passou = sessaoDoPainelAgenda($profissional, '2026-10-05 08:00', $realizada);
    sessaoDoPainelAgenda($profissional, '2026-10-05 12:00', $realizada);

    // ACT
    $situacao = collect(painelDaAgenda()->assertOk()->json('situacao'))->firstWhere('status_id', $realizada->id);
    $soPassadas = $this->getJson("/api/indicadores/agenda/itens?mes=2026-10&status_id={$realizada->id}&passadas=1")->assertOk();
    $todas = $this->getJson("/api/indicadores/agenda/itens?mes=2026-10&status_id={$realizada->id}")->assertOk();

    // ASSERT — a lista da linha diz o MESMO número da linha (CR-IND-02); sem o filtro, o mês inteiro
    expect($situacao['quantidade'])->toBe(1)
        ->and($soPassadas->json('contexto.total'))->toBe(1)
        ->and(array_column($soPassadas->json('data'), 'id'))->toBe([$passou->id])
        ->and($todas->json('contexto.total'))->toBe(2);
});

it('deve recusar com 422 o filtro passadas que não é booleano', function () {
    // ARRANGE
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $realizada = statusDoPainelAgenda('realizada');

    // ACT + ASSERT
    $this->getJson("/api/indicadores/agenda/itens?mes=2026-10&status_id={$realizada->id}&passadas=talvez")
        ->assertUnprocessable()->assertJsonValidationErrors('passadas');
});

it('deve medir a ocupação só com quem tem grade e dizer de quantos profissionais com sessão', function () {
    // ARRANGE — grade de segunda e terça 08–12 (6 sessões/dia); o histórico vem de agosto
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $comGrade = profissionalDoPainelAgenda('Profissional Fictícia Com Grade', GRADE_DO_PAINEL_AGENDA);
    $semGrade = profissionalDoPainelAgenda('Profissional Fictício Sem Grade');
    historicoDesdeAgostoDoPainelAgenda($comGrade);
    // segunda 5/10: 4 marcadas (inclusive a das 11h, ainda por vir) e 1 desmarcada, que liberou o horário
    sessaoDoPainelAgenda($comGrade, '2026-10-05 08:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($comGrade, '2026-10-05 08:40', statusDoPainelAgenda('falta'));
    sessaoDoPainelAgenda($comGrade, '2026-10-05 09:20', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($comGrade, '2026-10-05 11:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($comGrade, '2026-10-05 10:20', statusDoPainelAgenda('desmarque'));
    // quem não tem grade não tem denominador — fica fora da conta, mas é contado entre os com sessão
    sessaoDoPainelAgenda($semGrade, '2026-10-05 08:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($semGrade, '2026-10-02 09:00', statusDoPainelAgenda('realizada'));
    // terça 1/9 (comparado): 2 marcadas sobre 6
    sessaoDoPainelAgenda($comGrade, '2026-09-01 08:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($comGrade, '2026-09-01 08:40', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — 4 ÷ 6 agora; 2 ÷ 6 no comparado; 1 dos 2 profissionais com sessão tem grade
    expect($painel->json('ocupacao'))->toBe([
        'atual' => 0.6667,
        'anterior' => 0.3333,
        'profissionais_com_grade' => 1,
        'profissionais' => 2,
    ]);
});

it('deve descontar da grade do período comparado o bloqueio que caiu nele', function () {
    // ARRANGE — terça 1/9 (comparado): 6 vagas, 2 horas bloqueadas (3 vagas a menos) e 2 marcadas
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia do Bloqueio Comparado', GRADE_DO_PAINEL_AGENDA);
    historicoDesdeAgostoDoPainelAgenda($profissional);
    Agendamento::factory()->create([
        'tipo' => 'bloqueio', 'paciente_id' => null, 'status_id' => null, 'profissional_id' => $profissional->id,
        'inicio' => '2026-09-01 08:00', 'fim' => '2026-09-01 10:00',
    ]);
    sessaoDoPainelAgenda($profissional, '2026-09-01 10:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-09-01 10:40', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — 2 ÷ 3: a carga dos bloqueios cobre o comparado quando há comparação (PERF-05)
    expect($painel->json('ocupacao.anterior'))->toBe(0.6667);
});

it('deve partir a ocupação por dia da semana e faixa do dia, com taxa nula sem capacidade', function () {
    // ARRANGE — grade só na segunda de manhã; uma sessão à tarde e outra na quinta à noite, fora dela
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictício do Mapa', [1 => [['inicio' => '08:00', 'fim' => '12:00']]]);
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:40', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 09:20', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 14:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-01 19:00', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — só as células com marcação ou capacidade, em ordem de dia e faixa
    expect($painel->json('ocupacao_por_periodo'))->toBe([
        ['dia' => 1, 'periodo' => 'manha', 'marcadas' => 3, 'capacidade' => 6, 'taxa' => 0.5],
        ['dia' => 1, 'periodo' => 'tarde', 'marcadas' => 1, 'capacidade' => 0, 'taxa' => null],
        ['dia' => 4, 'periodo' => 'noite', 'marcadas' => 1, 'capacidade' => 0, 'taxa' => null],
    ]);
});

it('deve medir as confirmadas pelo WhatsApp sobre os lembretes ENVIADOS do período', function () {
    // ARRANGE — histórico desde agosto, sem lembrete no comparado
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia dos Lembretes');
    historicoDesdeAgostoDoPainelAgenda($profissional);
    $aberto = statusDoPainelAgenda('aberto');
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', $aberto), resposta: LembreteEnviado::CONFIRMOU);
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-10-02 09:00', $aberto), resposta: LembreteEnviado::CONFIRMOU);
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-10-02 10:00', $aberto), resposta: LembreteEnviado::PEDIU_DESMARQUE);
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-10-05 14:00', $aberto));
    // não enviado não entra no denominador; o de amanhã está fora do período
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-10-05 15:00', $aberto), LembreteEnviado::NAO_ENVIADO);
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-10-06 09:00', $aberto), resposta: LembreteEnviado::CONFIRMOU);

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — 2 confirmações em 4 enviados; sem lembrete no comparado, não há comparação
    expect($painel->json('confirmadas'))->toBe([
        'atual' => ['confirmadas' => 2, 'enviados' => 4, 'taxa' => 0.5],
        'anterior' => null,
    ]);
});

it('deve comparar as confirmadas com os lembretes do período comparado', function () {
    // ARRANGE — histórico desde agosto; um lembrete confirmado em 2/9 e um enviado em 3/9
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictício da Comparação');
    historicoDesdeAgostoDoPainelAgenda($profissional);
    $realizada = statusDoPainelAgenda('realizada');
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-09-02 09:00', $realizada), resposta: LembreteEnviado::CONFIRMOU);
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-09-03 09:00', $realizada));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT
    expect($painel->json('confirmadas.anterior'))->toBe(['confirmadas' => 1, 'enviados' => 2, 'taxa' => 0.5])
        ->and($painel->json('confirmadas.atual'))->toBe(['confirmadas' => 0, 'enviados' => 0, 'taxa' => null]);
});

it('deve contar as faltas por dia da semana só nos dias com sessão que já passou', function () {
    // ARRANGE — quinta 1/10: uma falta e uma realizada; segunda 5/10: duas realizadas
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia dos Dias');
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', statusDoPainelAgenda('falta'));
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:40', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:40', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — dia ISO (1 = segunda, 4 = quinta)
    expect($painel->json('faltas_por_dia_semana'))->toBe([
        ['dia' => 1, 'sessoes' => 2, 'faltas' => 0, 'taxa' => 0.0],
        ['dia' => 4, 'sessoes' => 2, 'faltas' => 1, 'taxa' => 0.5],
    ]);
});

it('deve contar faltas e desmarques por convênio, com a flag de particular e a sessão sem pacote', function () {
    // ARRANGE — convênio A: realizada, falta e desmarque; o particular B: uma realizada; sem pacote: uma falta
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictício dos Convênios');
    $conveniado = pacoteDoPainelAgenda($profissional, Convenio::create(['nome' => 'Convênio Fictício A']));
    $particular = pacoteDoPainelAgenda($profissional, Convenio::create(['nome' => 'Particular Fictício', 'particular' => true]));
    sessaoDoPainelAgenda($profissional, '2026-10-01 08:00', statusDoPainelAgenda('realizada'), ['tratamento_id' => $conveniado->id]);
    sessaoDoPainelAgenda($profissional, '2026-10-01 08:40', statusDoPainelAgenda('falta'), ['tratamento_id' => $conveniado->id]);
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:20', statusDoPainelAgenda('desmarque'), ['tratamento_id' => $conveniado->id]);
    sessaoDoPainelAgenda($profissional, '2026-10-02 08:00', statusDoPainelAgenda('realizada'), ['tratamento_id' => $particular->id]);
    sessaoDoPainelAgenda($profissional, '2026-10-02 08:40', statusDoPainelAgenda('falta'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — maior volume primeiro; taxa = (faltas + desmarques) ÷ sessões
    expect($painel->json('por_convenio'))->toBe([
        ['nome' => 'Convênio Fictício A', 'particular' => false, 'sessoes' => 3, 'faltas' => 1, 'desmarques' => 1, 'taxa' => 0.6667],
        ['nome' => 'Particular Fictício', 'particular' => true, 'sessoes' => 1, 'faltas' => 0, 'desmarques' => 0, 'taxa' => 0.0],
        ['nome' => 'Sem convênio', 'particular' => false, 'sessoes' => 1, 'faltas' => 1, 'desmarques' => 0, 'taxa' => 1.0],
    ]);
});

it('deve mostrar os 8 convênios de maior volume e juntar o resto em Outros', function () {
    // ARRANGE — dez convênios: A com 3 sessões, B a G com 2, H a J com 1 (J com uma falta)
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia da Cauda');
    $volumes = ['A' => 3, 'B' => 2, 'C' => 2, 'D' => 2, 'E' => 2, 'F' => 2, 'G' => 2, 'H' => 1, 'I' => 1, 'J' => 1];
    $dia = 1;
    foreach ($volumes as $letra => $sessoes) {
        $pacote = pacoteDoPainelAgenda($profissional, Convenio::create(['nome' => "Convênio Fictício {$letra}"]));
        for ($i = 0; $i < $sessoes; $i++) {
            $papel = $letra === 'J' ? 'falta' : 'realizada';
            sessaoDoPainelAgenda($profissional, sprintf('2026-10-0%d %02d:00', $dia % 4 + 1, 7 + $i), statusDoPainelAgenda($papel), ['tratamento_id' => $pacote->id]);
        }
        $dia++;
    }

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — oito nomeados (empate de volume desempata pelo nome) e a cauda dizendo quantos juntou
    $porConvenio = $painel->json('por_convenio');
    expect(array_column($porConvenio, 'nome'))->toBe([
        'Convênio Fictício A', 'Convênio Fictício B', 'Convênio Fictício C', 'Convênio Fictício D',
        'Convênio Fictício E', 'Convênio Fictício F', 'Convênio Fictício G', 'Convênio Fictício H', 'Outros',
    ])
        ->and($porConvenio[8])->toBe([
            'nome' => 'Outros', 'outros' => 2, 'particular' => false,
            'sessoes' => 2, 'faltas' => 1, 'desmarques' => 0, 'taxa' => 0.5,
        ]);
});

it('deve contar a situação só das sessões que já passaram, na ordem do cadastro', function () {
    // ARRANGE — passadas: 2 realizadas, 1 falta, 1 ainda em aberto e 1 reserva; futura: 1 realizada
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictício da Situação');
    sessaoDoPainelAgenda($profissional, '2026-10-01 08:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-01 08:40', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:20', statusDoPainelAgenda('falta'));
    sessaoDoPainelAgenda($profissional, '2026-10-02 08:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-02 08:40', statusDoPainelAgenda('reserva'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 16:00', statusDoPainelAgenda('realizada'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — Em Aberto (ordem 1), Finalizado (3), Não Compareceu (5); a reserva e a futura não entram
    $esperado = collect(['aberto' => 1, 'realizada' => 2, 'falta' => 1])
        ->map(function (int $quantidade, string $papel): array {
            $status = statusDoPainelAgenda($papel);

            return ['status_id' => $status->id, 'nome' => $status->nome, 'cor' => $status->cor, 'quantidade' => $quantidade];
        })
        ->values()
        ->all();
    expect($painel->json('situacao'))->toBe($esperado);
});

it('deve entregar à profissional escopada só os números da própria agenda', function () {
    // ARRANGE — a escopada e uma colega, ambas com grade e sessões
    relogioDoPainelAgenda();
    admin();
    $propria = profissionalDoPainelAgenda('Profissional Fictícia Escopada', GRADE_DO_PAINEL_AGENDA);
    $colega = profissionalDoPainelAgenda('Profissional Fictícia Colega', GRADE_DO_PAINEL_AGENDA);
    sessaoDoPainelAgenda($propria, '2026-10-05 08:00', statusDoPainelAgenda('falta'));
    sessaoDoPainelAgenda($colega, '2026-10-05 08:00', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($colega, '2026-10-05 08:40', statusDoPainelAgenda('realizada'));
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($colega, '2026-10-05 09:20', statusDoPainelAgenda('aberto')), resposta: LembreteEnviado::CONFIRMOU);
    $escopada = usuarioEscopadoEm($propria);

    // ACT
    $this->actingAs($escopada);
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — 1 sessão, 1 falta, ocupação de 1 em 6, a colega não aparece em lugar nenhum
    expect($painel->json('sessoes_passadas.atual'))->toBe(1)
        ->and($painel->json('faltas.atual'))->toBe(['quantidade' => 1, 'taxa' => 1.0])
        ->and($painel->json('ocupacao.atual'))->toBe(0.1667)
        ->and($painel->json('ocupacao.profissionais'))->toBe(1)
        ->and($painel->json('confirmadas.atual.enviados'))->toBe(0);
});

it('deve devolver o início do histórico e anular toda comparação anterior a ele', function () {
    // ARRANGE — o primeiro agendamento da clínica é de 1/10: setembro não existiu no sistema
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia da Virada', GRADE_DO_PAINEL_AGENDA);
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', statusDoPainelAgenda('falta'));

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT
    expect($painel->json('inicio_historico'))->toBe('2026-10')
        ->and($painel->json('ocupacao.anterior'))->toBeNull()
        ->and($painel->json('realizadas.anterior'))->toBeNull()
        ->and($painel->json('sessoes_passadas.anterior'))->toBeNull()
        ->and($painel->json('faltas.anterior'))->toBeNull()
        ->and($painel->json('desmarques.anterior'))->toBeNull()
        ->and($painel->json('confirmadas.anterior'))->toBeNull();
});

// ── Sessões sem baixa (change inicio-dos-indicadores, D4) ─────────────────────────────────────────
// As que já passaram e seguem num status `em_aberto` — a flag da baixa em lote, nunca o nome.

it('deve contar como sem baixa só as sessões que já passaram em status em aberto', function () {
    // ARRANGE — hoje é 5/10 às 10h: duas em aberto que já passaram, uma em aberto mais tarde, uma
    // realizada e uma reserva (que não é sessão)
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia da Baixa', GRADE_DO_PAINEL_AGENDA);
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 11:20', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:40', statusDoPainelAgenda('realizada'));
    sessaoDoPainelAgenda($profissional, '2026-10-02 09:00', statusDoPainelAgenda('reserva'));
    // a Falta Justificada não é falta, nem realizada, nem desmarque — e TEM desfecho: derivar o "em
    // aberto" das outras flags a contaria (gate r1; lição de 02/10: conceito com flag não se deriva)
    sessaoDoPainelAgenda($profissional, '2026-10-02 10:00', statusDoPainelAgenda('justificada'));
    // o OUTRO status com a flag (no cadastro padrão, o "Aguardando Atendimento"): conta, sem ser o primeiro
    $outroEmAberto = StatusAgendamento::query()->where('em_aberto', true)->orderBy('ordem')->orderBy('id')->skip(1)->firstOrFail();
    sessaoDoPainelAgenda($profissional, '2026-10-02 10:40', $outroEmAberto);

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT
    expect($painel->json('sem_baixa'))->toBe(3);
});

it('deve continuar contando sem baixa o status em aberto que a clínica renomeou', function () {
    // ARRANGE — o nome é da clínica; a flag é o que conta
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictícia do Nome Novo', GRADE_DO_PAINEL_AGENDA);
    $emAberto = statusDoPainelAgenda('aberto');
    $emAberto->update(['nome' => 'Agendado']);
    sessaoDoPainelAgenda($profissional, '2026-10-01 09:00', $emAberto);

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT
    expect($painel->json('sem_baixa'))->toBe(1);
});

it('deve entregar à profissional escopada só as sessões sem baixa da própria agenda', function () {
    // ARRANGE
    relogioDoPainelAgenda();
    admin();
    $propria = profissionalDoPainelAgenda('Profissional Fictícia Escopada da Baixa', GRADE_DO_PAINEL_AGENDA);
    $colega = profissionalDoPainelAgenda('Profissional Fictícia Colega da Baixa', GRADE_DO_PAINEL_AGENDA);
    sessaoDoPainelAgenda($propria, '2026-10-01 09:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($colega, '2026-10-01 09:00', statusDoPainelAgenda('aberto'));
    sessaoDoPainelAgenda($colega, '2026-10-02 09:00', statusDoPainelAgenda('aberto'));

    // ACT
    $this->actingAs(usuarioEscopadoEm($propria));
    $painel = painelDaAgenda()->assertOk();

    // ASSERT
    expect($painel->json('sem_baixa'))->toBe(1);
});

it('deve devolver o formato EXATO do contrato D9, com os tipos de cada campo', function () {
    // ARRANGE — histórico desde agosto e movimento nos dois períodos, para nenhum par vir nulo
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelAgenda('Profissional Fictício do Contrato', GRADE_DO_PAINEL_AGENDA);
    historicoDesdeAgostoDoPainelAgenda($profissional);
    $pacote = pacoteDoPainelAgenda($profissional, Convenio::create(['nome' => 'Convênio Fictício do Contrato']));
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-10-05 08:00', statusDoPainelAgenda('falta'), ['tratamento_id' => $pacote->id]), resposta: LembreteEnviado::CONFIRMOU);
    sessaoDoPainelAgenda($profissional, '2026-10-05 08:40', statusDoPainelAgenda('realizada'), ['tratamento_id' => $pacote->id]);
    lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-09-01 08:00', statusDoPainelAgenda('realizada')), resposta: LembreteEnviado::CONFIRMOU);

    // ACT
    $painel = painelDaAgenda()->assertOk();

    // ASSERT — as chaves, nem uma a mais nem a menos
    $quantidadeETaxa = ['quantidade', 'taxa'];
    $confirmacao = ['confirmadas', 'enviados', 'taxa'];
    $painel->assertExactJsonStructure([
        'periodo' => ['mes', 'de', 'ate', 'parcial', 'comparado_de', 'comparado_ate'],
        'inicio_historico',
        'inicio_historico_dia',
        'ocupacao' => ['atual', 'anterior', 'profissionais_com_grade', 'profissionais'],
        'realizadas' => ['atual', 'anterior'],
        'sessoes_passadas' => ['atual', 'anterior'],
        'faltas' => ['atual' => $quantidadeETaxa, 'anterior' => $quantidadeETaxa],
        'desmarques' => ['atual' => $quantidadeETaxa, 'anterior' => $quantidadeETaxa],
        'sem_baixa',
        'confirmadas' => ['atual' => $confirmacao, 'anterior' => $confirmacao],
        'status_que_contam' => ['falta', 'desmarque'],
        'faltas_por_dia_semana' => ['*' => ['dia', 'sessoes', 'faltas', 'taxa']],
        'ocupacao_por_periodo' => ['*' => ['dia', 'periodo', 'marcadas', 'capacidade', 'taxa']],
        'por_convenio' => ['*' => ['nome', 'particular', 'sessoes', 'faltas', 'desmarques', 'taxa']],
        'situacao' => ['*' => ['status_id', 'nome', 'cor', 'quantidade']],
    ]);
    // ... e os tipos: porcentagem é float 0..1, contagem é inteiro, data é "Y-m-d"
    expect($painel->json('periodo'))->toBe([
        'mes' => '2026-10', 'de' => '2026-10-01', 'ate' => '2026-10-05', 'parcial' => true,
        'comparado_de' => '2026-09-01', 'comparado_ate' => '2026-09-05',
    ])
        ->and($painel->json('inicio_historico'))->toBe('2026-08')
        ->and($painel->json('inicio_historico_dia'))->toBe('2026-08-10')
        ->and($painel->json('ocupacao.atual'))->toBeFloat()
        ->and($painel->json('ocupacao.anterior'))->toBeFloat()
        ->and($painel->json('ocupacao.profissionais'))->toBeInt()
        ->and($painel->json('realizadas.atual'))->toBeInt()
        ->and($painel->json('sem_baixa'))->toBeInt()
        ->and($painel->json('sessoes_passadas.anterior'))->toBeInt()
        ->and($painel->json('faltas.atual.quantidade'))->toBeInt()
        ->and($painel->json('faltas.atual.taxa'))->toBeFloat()
        ->and($painel->json('desmarques.anterior.taxa'))->toBeFloat()
        ->and($painel->json('confirmadas.atual.taxa'))->toBeFloat()
        ->and($painel->json('faltas_por_dia_semana.0.dia'))->toBeInt()
        ->and($painel->json('ocupacao_por_periodo.0.periodo'))->toBeIn(['manha', 'tarde', 'noite'])
        ->and($painel->json('por_convenio.0.particular'))->toBeBool()
        ->and($painel->json('situacao.0.status_id'))->toBeInt()
        ->and($painel->json('status_que_contam.falta'))->each->toBeString();
    semVazamento($painel->json(), 'Paciente Fictício');
});

it('deve responder com o MESMO número de consultas para 1 e para 20 profissionais', function () {
    // ARRANGE — cada profissional com grade, sessões, pacote de convênio e lembrete
    relogioDoPainelAgenda();
    $this->actingAs(admin());
    $cena = function (int $primeiro, int $ultimo): void {
        for ($i = $primeiro; $i <= $ultimo; $i++) {
            $profissional = profissionalDoPainelAgenda("Profissional Fictício da Carga {$i}", GRADE_DO_PAINEL_AGENDA);
            $pacote = pacoteDoPainelAgenda($profissional, Convenio::create(['nome' => "Convênio Fictício da Carga {$i}"]));
            lembreteDoPainelAgenda(sessaoDoPainelAgenda($profissional, '2026-10-05 08:00', statusDoPainelAgenda('realizada'), ['tratamento_id' => $pacote->id]));
            sessaoDoPainelAgenda($profissional, '2026-09-01 08:00', statusDoPainelAgenda('falta'), ['tratamento_id' => $pacote->id]);
            sessaoDoPainelAgenda($profissional, '2026-08-10 08:00', statusDoPainelAgenda('desmarque'));
            Agendamento::factory()->create([
                'tipo' => 'bloqueio', 'paciente_id' => null, 'status_id' => null,
                'profissional_id' => $profissional->id, 'inicio' => '2026-10-05 11:00', 'fim' => '2026-10-05 12:00',
            ]);
        }
    };
    $contar = function (): int {
        $consultas = 0;
        DB::listen(function () use (&$consultas): void {
            $consultas++;
        });
        painelDaAgenda()->assertOk();

        return $consultas;
    };

    // ACT — aquece (sessão e permissões só custam na primeira vez) e mede com 1, depois com 20
    $cena(1, 1);
    painelDaAgenda()->assertOk();
    $comUm = $contar();
    $cena(2, 20);
    $comVinte = $contar();

    // ASSERT — 20× os profissionais, as MESMAS consultas (D8: sem N+1)
    expect(painelDaAgenda()->json('ocupacao.profissionais'))->toBe(20)
        ->and($comVinte)->toBe($comUm);
});
