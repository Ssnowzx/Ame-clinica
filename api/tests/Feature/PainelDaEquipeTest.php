<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Especialidade;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Clinica\EvolucoesEmAberto;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/**
 * O painel da EQUIPE (change indicadores-profissionais, D4/D9): `GET /api/indicadores/painel/equipe`
 * sob `agenda.ver` E `atendimentos.ver`, escopo D11 pela interseção dos eixos. Substitui a aba de
 * produtividade. Dados 100% fictícios; a resposta nunca carrega paciente.
 *
 * Relógio FIXO: segunda, 5 de outubro de 2026, 10h na parede da clínica. Período 1–5/10, comparado
 * 1–5/9.
 */
const MES_DO_PAINEL_EQUIPE = '2026-10';

/** Segunda e terça 08:00–12:00: 6 sessões de 40 min por dia. */
const GRADE_DO_PAINEL_EQUIPE = [
    1 => [['inicio' => '08:00', 'fim' => '12:00']],
    2 => [['inicio' => '08:00', 'fim' => '12:00']],
];

function relogioDoPainelEquipe(): void
{
    test()->travelTo(CarbonImmutable::parse('2026-10-05 10:00:00', 'America/Sao_Paulo'));
}

function profissionalDoPainelEquipe(string $nome, array $horarios = [], string $especialidade = 'Fonoaudiologia Fictícia', array $atributos = []): Profissional
{
    // o nome é único na clínica: duas profissionais da mesma especialidade a compartilham
    $daEspecialidade = Especialidade::query()->where('nome', $especialidade)->first()
        ?? Especialidade::factory()->create(['nome' => $especialidade, 'tempo_sessao' => 40]);
    $profissional = Profissional::factory()->comHorarios($horarios)->create(['nome' => $nome, ...$atributos]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $daEspecialidade->id,
    ]);

    return $profissional;
}

/** O status pelo PAPEL, escolhido pelas flags (nunca pelo nome). */
function statusDoPainelEquipe(string $papel): StatusAgendamento
{
    $flags = match ($papel) {
        'realizada' => ['desconta_sessao' => true, 'marca_falta' => false, 'ocupa_horario' => true, 'marca_reserva' => false],
        'falta' => ['marca_falta' => true],
        'aberto' => ['em_aberto' => true],
    };

    return StatusAgendamento::query()->where($flags)->orderBy('ordem')->orderBy('id')->firstOrFail();
}

function sessaoDoPainelEquipe(Profissional $profissional, string $inicio, string $papel): Agendamento
{
    $comeco = Carbon::createFromFormat('Y-m-d H:i', $inicio);

    return Agendamento::factory()->create([
        'profissional_id' => $profissional->id,
        'especialidade_id' => DB::table('profissional_especialidade')->where('profissional_id', $profissional->id)->value('especialidade_id'),
        'paciente_id' => Paciente::query()->value('id') ?? Paciente::factory()->create()->id,
        'status_id' => statusDoPainelEquipe($papel)->id,
        'inicio' => $comeco->format('Y-m-d H:i'),
        'fim' => $comeco->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
}

/** O atendimento registrado da sessão — e, se pedido, a evolução escrita sobre ele. */
function atendimentoDoPainelEquipe(Agendamento $sessao, bool $comEvolucao, ?string $finalizadoEm = null): Atendimento
{
    $atendimento = Atendimento::factory()->create([
        'agendamento_id' => $sessao->id,
        'finalizado_em' => $finalizadoEm ?? $sessao->inicio->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
    if ($comEvolucao) {
        $evolucao = new Evolucao(['profissional_id' => $sessao->profissional_id, 'conteudo' => 'Evolução clínica fictícia.']);
        $evolucao->atendimento_id = $atendimento->id;
        $evolucao->preenchida_em = $atendimento->finalizado_em->format('Y-m-d H:i');
        $evolucao->save();
    }

    return $atendimento;
}

/** Uma sessão REALIZADA que já passou, com atendimento e (ou não) evolução. */
function realizadaDoPainelEquipe(Profissional $profissional, string $inicio, bool $comEvolucao): void
{
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($profissional, $inicio, 'realizada'), $comEvolucao);
}

function painelDaEquipe(string $mes = MES_DO_PAINEL_EQUIPE): TestResponse
{
    return test()->getJson("/api/indicadores/painel/equipe?mes={$mes}");
}

it('deve responder 403 a quem tem atendimentos.ver mas não agenda.ver', function () {
    // ARRANGE — só o eixo clínico
    admin();
    $soClinico = usuarioCom(['atendimentos.ver', 'pacientes.ver'], 'Só Clínico da Equipe');

    // ACT + ASSERT
    $this->actingAs($soClinico);
    painelDaEquipe()->assertForbidden();
});

it('deve responder 403 a quem tem agenda.ver mas não atendimentos.ver — antes de validar o mês', function () {
    // ARRANGE — só o eixo da agenda
    admin();
    $soAgenda = usuarioCom(['agenda.ver', 'pacientes.ver'], 'Só Agenda da Equipe');

    // ACT + ASSERT
    $this->actingAs($soAgenda);
    painelDaEquipe()->assertForbidden();
    painelDaEquipe('2026-13')->assertForbidden();
});

it('deve responder 422 ao mês futuro da clínica', function () {
    // ARRANGE
    relogioDoPainelEquipe();
    $this->actingAs(admin());

    // ACT + ASSERT
    painelDaEquipe('2026-11')->assertUnprocessable()->assertJsonValidationErrors('mes');
});

it('deve medir as evoluções em dia sobre as sessões realizadas que já passaram', function () {
    // ARRANGE — histórico desde agosto; outubro: 4 realizadas, 3 com evolução; fora da base: a falta
    // e a realizada de mais tarde hoje. Setembro: 1 de 2
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelEquipe('Profissional Fictícia das Evoluções');
    realizadaDoPainelEquipe($profissional, '2026-08-10 09:00', true);
    realizadaDoPainelEquipe($profissional, '2026-10-01 08:00', true);
    realizadaDoPainelEquipe($profissional, '2026-10-01 08:40', true);
    realizadaDoPainelEquipe($profissional, '2026-10-02 08:00', true);
    realizadaDoPainelEquipe($profissional, '2026-10-02 08:40', false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($profissional, '2026-10-02 09:20', 'falta'), false);
    sessaoDoPainelEquipe($profissional, '2026-10-05 15:00', 'realizada');
    realizadaDoPainelEquipe($profissional, '2026-09-02 08:00', true);
    realizadaDoPainelEquipe($profissional, '2026-09-03 08:00', false);

    // ACT
    $painel = painelDaEquipe()->assertOk();

    // ASSERT
    expect($painel->json('evolucoes.em_dia'))->toBe(['atual' => 0.75, 'anterior' => 0.5])
        ->and($painel->json('profissionais.0.evolucoes_em_dia'))->toBe(0.75);
});

it('deve contar as evoluções atrasadas pelo prazo, no mesmo corte inclusivo da trava do finalizar', function () {
    // ARRANGE — prazo de 3 dias: em 5/10, vence quem foi finalizado antes de 2/10 (sem piso
    // configurado, a fila do aviso alcança as quatro e as contas coincidem com as da trava)
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('evolucoes.prazo_dias', 3);
    $uma = profissionalDoPainelEquipe('Profissional Fictícia Atrasada');
    $outra = profissionalDoPainelEquipe('Profissional Fictício Também Atrasado');
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($uma, '2026-09-20 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($uma, '2026-10-01 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($uma, '2026-10-02 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($uma, '2026-09-01 09:00', 'realizada'), true);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($outra, '2026-09-25 09:00', 'realizada'), false);

    // ACT
    $painel = painelDaEquipe()->assertOk();

    // ASSERT — 2 da primeira (a de 2/10 ainda está no prazo), 1 da segunda; o dia-limite é o mesmo
    // da trava do finalizar
    $linhas = collect($painel->json('profissionais'))->keyBy('id');
    expect($painel->json('evolucoes.atrasadas'))->toBe(3)
        ->and($painel->json('evolucoes.profissionais_com_atraso'))->toBe(2)
        ->and($linhas[$uma->id]['evolucoes_atrasadas'])->toBe(2)
        ->and($linhas[$outra->id]['evolucoes_atrasadas'])->toBe(1)
        ->and(app(EvolucoesEmAberto::class)->vencidas($uma->id)->count())->toBe(2);
});

it('deve contar as atrasadas DENTRO do sem evolução: a vencida anterior ao piso fica fora das duas', function () {
    // ARRANGE — o centro considera a partir de 15/09; prazo de 3 dias. A Antiga só tem uma vencida de
    // 1/09, abaixo do piso; a Recente tem uma vencida de 20/09 e uma de 3/10, ainda no prazo
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('evolucoes.prazo_dias', 3);
    app(ConfiguracaoService::class)->set('notificacoes.a_partir_de', '2026-09-15');
    $antiga = profissionalDoPainelEquipe('Profissional Fictícia da Vencida Antiga');
    $recente = profissionalDoPainelEquipe('Profissional Fictícia da Vencida Recente');
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($antiga, '2026-09-01 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($recente, '2026-09-20 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($recente, '2026-10-03 09:00', 'realizada'), false);

    // ACT
    $painel = painelDaEquipe()->assertOk();

    // ASSERT — 2 sem evolução, 1 passou do prazo: o subconjunto, no total, nos profissionais com
    // atraso e na coluna de cada linha. A trava do finalizar (sem piso) continua vendo a de 1/09
    $linhas = collect($painel->json('profissionais'))->keyBy('id');
    expect($painel->json('evolucoes.sem_evolucao'))->toBe(2)
        ->and($painel->json('evolucoes.atrasadas'))->toBe(1)
        ->and($painel->json('evolucoes.atrasadas'))->toBeLessThanOrEqual($painel->json('evolucoes.sem_evolucao'))
        ->and($painel->json('evolucoes.profissionais_com_atraso'))->toBe(1)
        ->and($linhas[$antiga->id]['evolucoes_atrasadas'])->toBe(0)
        ->and($linhas[$recente->id]['evolucoes_atrasadas'])->toBe(1)
        ->and(app(EvolucoesEmAberto::class)->vencidas($antiga->id)->count())->toBe(1);
});

it('deve devolver o total sem evolução e o prazo, além das atrasadas', function () {
    // ARRANGE — validação local de 05/10: "nenhuma atrasada" ao lado dos "255 sem evolução" do
    // "Pede atenção" parecia contradição; com o total e o prazo, a tela diz as duas coisas
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    app(ConfiguracaoService::class)->set('evolucoes.prazo_dias', 3);
    $profissional = profissionalDoPainelEquipe('Profissional Fictícia Sem Evolução');
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($profissional, '2026-09-20 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($profissional, '2026-10-03 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($profissional, '2026-10-04 09:00', 'realizada'), true);

    // ACT
    $painel = painelDaEquipe()->assertOk();

    // ASSERT
    expect($painel->json('evolucoes.sem_evolucao'))->toBe(2)
        ->and($painel->json('evolucoes.atrasadas'))->toBe(1)
        ->and($painel->json('evolucoes.prazo_dias'))->toBe(3);
});

it('deve montar a linha de cada profissional, sem grade com ocupação nula, em ordem de realizadas', function () {
    // ARRANGE — com grade: 4 marcadas na segunda (uma ainda por vir), 2 realizadas, 1 falta;
    // sem grade: 3 realizadas na quinta
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    $comGrade = profissionalDoPainelEquipe('Profissional Fictícia Com Grade', GRADE_DO_PAINEL_EQUIPE, 'Psicologia Fictícia');
    $semGrade = profissionalDoPainelEquipe('Profissional Fictício Sem Grade');
    sessaoDoPainelEquipe($comGrade, '2026-10-05 08:00', 'realizada');
    sessaoDoPainelEquipe($comGrade, '2026-10-05 08:40', 'realizada');
    sessaoDoPainelEquipe($comGrade, '2026-10-05 09:20', 'falta');
    sessaoDoPainelEquipe($comGrade, '2026-10-05 11:00', 'aberto');
    sessaoDoPainelEquipe($semGrade, '2026-10-01 08:00', 'realizada');
    sessaoDoPainelEquipe($semGrade, '2026-10-01 08:40', 'realizada');
    sessaoDoPainelEquipe($semGrade, '2026-10-01 09:20', 'realizada');

    // ACT
    $painel = painelDaEquipe()->assertOk();

    // ASSERT — sem atendimento registrado, nenhuma realizada tem evolução: 0 em dia
    expect($painel->json('profissionais'))->toBe([
        [
            'id' => $semGrade->id, 'nome' => 'Profissional Fictício Sem Grade', 'especialidades' => ['Fonoaudiologia Fictícia'],
            'tem_grade' => false, 'ocupacao' => null, 'marcadas' => 3, 'realizadas' => 3, 'faltas' => 0,
            'evolucoes_em_dia' => 0.0, 'evolucoes_atrasadas' => 0,
        ],
        [
            'id' => $comGrade->id, 'nome' => 'Profissional Fictícia Com Grade', 'especialidades' => ['Psicologia Fictícia'],
            'tem_grade' => true, 'ocupacao' => 0.6667, 'marcadas' => 4, 'realizadas' => 2, 'faltas' => 1,
            'evolucoes_em_dia' => 0.0, 'evolucoes_atrasadas' => 0,
        ],
    ]);
});

it('deve multiplicar a grade da linha pelos atendimentos simultâneos de quem atende em grupo', function () {
    // ARRANGE — grupo de até 4: segunda 5/10 tem 6 horários × 4 = 24 vagas; 4 crianças às 08:00
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    $emGrupo = profissionalDoPainelEquipe('Profissional Fictícia do Grupo', GRADE_DO_PAINEL_EQUIPE, atributos: ['atendimentos_simultaneos' => 4]);
    foreach (range(1, 4) as $crianca) {
        sessaoDoPainelEquipe($emGrupo, '2026-10-05 08:00', 'realizada');
    }

    // ACT
    $linha = painelDaEquipe()->assertOk()->json('profissionais.0');

    // ASSERT — 4 ÷ 24 (CR-IND-01)
    expect($linha['id'])->toBe($emGrupo->id)
        ->and($linha['marcadas'])->toBe(4)
        ->and($linha['ocupacao'])->toBe(0.1667);
});

it('deve marcar sem grade, com ocupação nula, quem tem horário mas nenhuma especialidade com duração', function () {
    // ARRANGE — horário na segunda, nenhuma especialidade vinculada: sem duração, a grade não vira sessões
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    $semDuracao = Profissional::factory()->comHorarios(GRADE_DO_PAINEL_EQUIPE)->create(['nome' => 'Profissional Fictício Sem Duração']);
    sessaoDoPainelEquipe($semDuracao, '2026-10-05 08:00', 'realizada');

    // ACT
    $linha = painelDaEquipe()->assertOk()->json('profissionais.0');

    // ASSERT — a pendência que a Equipe lista (CR-IND-14)
    expect($linha['id'])->toBe($semDuracao->id)
        ->and($linha['tem_grade'])->toBeFalse()
        ->and($linha['ocupacao'])->toBeNull()
        ->and($linha['marcadas'])->toBe(1);
});

it('deve contar em sem_evolucao o MESMO total do aviso do sino: o piso da janela e o eixo clínico', function () {
    // ARRANGE — o centro considera a partir de 15/09; a sem evolução de 1/09 fica abaixo do piso. Duas
    // profissionais com uma pendência cada acima do piso
    relogioDoPainelEquipe();
    $adminDaClinica = admin();
    app(ConfiguracaoService::class)->set('notificacoes.a_partir_de', '2026-09-15');
    $uma = profissionalDoPainelEquipe('Profissional Fictícia Uma do Sino');
    $outra = profissionalDoPainelEquipe('Profissional Fictícia Outra do Sino');
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($uma, '2026-09-01 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($uma, '2026-09-20 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($outra, '2026-10-02 09:00', 'realizada'), false);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($outra, '2026-09-25 09:00', 'realizada'), true);
    // agenda escopada na própria, clínico plano: o sino dela é o da clínica inteira
    $mista = usuarioCom(['agenda.ver', 'atendimentos.ver', 'evolucoes.ver', 'clinico.ver_todos'], 'Mista do Sino da Equipe');
    $mista->update(['profissional_id' => $uma->id]);

    // ACT
    $painelDoAdmin = $this->actingAs($adminDaClinica)->getJson('/api/indicadores/painel/equipe?mes='.MES_DO_PAINEL_EQUIPE)->assertOk();
    $sinoDoAdmin = $this->actingAs($adminDaClinica)->getJson('/api/notificacoes')->assertOk();
    trocarDeUsuario();
    $painelDaMista = $this->actingAs($mista)->getJson('/api/indicadores/painel/equipe?mes='.MES_DO_PAINEL_EQUIPE)->assertOk();
    $sinoDaMista = $this->actingAs($mista)->getJson('/api/notificacoes')->assertOk();

    // ASSERT — o mesmo número nos dois lugares, para os dois usuários (CR-IND-04); as linhas da mista
    // continuam na interseção dos eixos
    expect($sinoDoAdmin->json('evolucoes_em_aberto.total'))->toBe(2)
        ->and($painelDoAdmin->json('evolucoes.sem_evolucao'))->toBe(2)
        ->and($sinoDaMista->json('evolucoes_em_aberto.total'))->toBe(2)
        ->and($painelDaMista->json('evolucoes.sem_evolucao'))->toBe(2)
        ->and(array_column($painelDaMista->json('profissionais'), 'id'))->toBe([$uma->id]);
});

it('deve entregar à profissional escopada só a própria linha e as próprias evoluções', function () {
    // ARRANGE — a escopada com 1 realizada sem evolução; a colega com 2 com evolução e 1 atrasada
    relogioDoPainelEquipe();
    admin();
    app(ConfiguracaoService::class)->set('evolucoes.prazo_dias', 3);
    $propria = profissionalDoPainelEquipe('Profissional Fictícia Escopada');
    $colega = profissionalDoPainelEquipe('Profissional Fictícia Colega');
    realizadaDoPainelEquipe($propria, '2026-10-01 08:00', false);
    realizadaDoPainelEquipe($colega, '2026-10-01 08:00', true);
    realizadaDoPainelEquipe($colega, '2026-10-01 08:40', true);
    atendimentoDoPainelEquipe(sessaoDoPainelEquipe($colega, '2026-09-20 09:00', 'realizada'), false);
    $escopada = usuarioEscopadoEm($propria, ['atendimentos.ver']);

    // ACT
    $this->actingAs($escopada);
    $painel = painelDaEquipe()->assertOk();

    // ASSERT — a linha dela, e a clínica vira ela: 0 em dia e só a atrasada DELA (a de 1/10, com
    // prazo de 3 dias); a da colega não aparece
    expect(array_column($painel->json('profissionais'), 'id'))->toBe([$propria->id])
        ->and($painel->json('evolucoes.em_dia.atual'))->toBe(0.0)
        ->and($painel->json('evolucoes.atrasadas'))->toBe(1)
        ->and($painel->json('evolucoes.profissionais_com_atraso'))->toBe(1);
});

it('deve anular a comparação das evoluções antes do início do histórico', function () {
    // ARRANGE — o primeiro agendamento é de outubro
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelEquipe('Profissional Fictício da Virada');
    realizadaDoPainelEquipe($profissional, '2026-10-01 08:00', true);

    // ACT
    $painel = painelDaEquipe()->assertOk();

    // ASSERT
    expect($painel->json('evolucoes.em_dia'))->toBe(['atual' => 1.0, 'anterior' => null])
        ->and($painel->json('inicio_historico'))->toBe('2026-10');
});

it('deve devolver o formato EXATO do contrato D9, com os tipos de cada campo', function () {
    // ARRANGE — histórico desde agosto, movimento nos dois períodos
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    $profissional = profissionalDoPainelEquipe('Profissional Fictícia do Contrato', GRADE_DO_PAINEL_EQUIPE);
    realizadaDoPainelEquipe($profissional, '2026-08-10 09:00', false);
    realizadaDoPainelEquipe($profissional, '2026-10-05 08:00', true);
    realizadaDoPainelEquipe($profissional, '2026-09-01 08:00', true);

    // ACT
    $painel = painelDaEquipe()->assertOk();

    // ASSERT
    $painel->assertExactJsonStructure([
        'periodo' => ['mes', 'de', 'ate', 'parcial', 'comparado_de', 'comparado_ate'],
        'inicio_historico',
        'inicio_historico_dia',
        'evolucoes' => ['em_dia' => ['atual', 'anterior'], 'atrasadas', 'profissionais_com_atraso', 'sem_evolucao', 'prazo_dias'],
        'profissionais' => ['*' => [
            'id', 'nome', 'especialidades', 'tem_grade', 'ocupacao', 'marcadas', 'realizadas', 'faltas',
            'evolucoes_em_dia', 'evolucoes_atrasadas',
        ]],
    ]);
    expect($painel->json('inicio_historico_dia'))->toBe('2026-08-10')
        ->and($painel->json('evolucoes.em_dia.atual'))->toBeFloat()
        ->and($painel->json('evolucoes.em_dia.anterior'))->toBeFloat()
        ->and($painel->json('evolucoes.atrasadas'))->toBeInt()
        ->and($painel->json('profissionais.0.id'))->toBeInt()
        ->and($painel->json('profissionais.0.especialidades'))->toBe(['Fonoaudiologia Fictícia'])
        ->and($painel->json('profissionais.0.tem_grade'))->toBeTrue()
        ->and($painel->json('profissionais.0.ocupacao'))->toBeFloat()
        ->and($painel->json('profissionais.0.marcadas'))->toBeInt()
        ->and($painel->json('profissionais.0.evolucoes_em_dia'))->toBeFloat();
    semVazamento($painel->json(), 'Paciente Fictício');
});

it('deve responder com o MESMO número de consultas para 1 e para 20 profissionais', function () {
    // ARRANGE — cada profissional com grade, sessão realizada com evolução, falta e evolução atrasada
    relogioDoPainelEquipe();
    $this->actingAs(admin());
    $cena = function (int $primeiro, int $ultimo): void {
        for ($i = $primeiro; $i <= $ultimo; $i++) {
            $profissional = profissionalDoPainelEquipe("Profissional Fictício da Carga {$i}", GRADE_DO_PAINEL_EQUIPE, "Especialidade Fictícia {$i}");
            realizadaDoPainelEquipe($profissional, '2026-10-05 08:00', true);
            sessaoDoPainelEquipe($profissional, '2026-10-05 08:40', 'falta');
            realizadaDoPainelEquipe($profissional, '2026-09-01 08:00', false);
            atendimentoDoPainelEquipe(sessaoDoPainelEquipe($profissional, '2026-01-10 09:00', 'realizada'), false);
        }
    };
    $contar = function (): int {
        $consultas = 0;
        DB::listen(function () use (&$consultas): void {
            $consultas++;
        });
        painelDaEquipe()->assertOk();

        return $consultas;
    };

    // ACT — aquece e mede com 1, depois com 20
    $cena(1, 1);
    painelDaEquipe()->assertOk();
    $comUm = $contar();
    $cena(2, 20);
    $comVinte = $contar();

    // ASSERT
    expect(painelDaEquipe()->json('profissionais'))->toHaveCount(20)
        ->and($comVinte)->toBe($comUm);
});
