<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\Feriado;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/**
 * Produtividade do profissional (§11, change produtividade-do-profissional): a vista
 * `GET /api/indicadores/produtividade` sob as DUAS permissões (agenda.ver + atendimentos.ver),
 * escopo D11 pela interseção dos eixos, capacidade pela grade real e baldes por FLAG.
 * LGPD: dados 100% fictícios; a resposta nunca carrega paciente.
 *
 * Mês FIXO — setembro/2026: o dia 1º é TERÇA, então há 5 terças (1, 8, 15, 22, 29) e 4 quintas.
 * Um mês derivado de `now()` mudaria a contagem de dias da semana a cada virada e levaria a
 * asserção junto.
 */
const MES_DA_PRODUTIVIDADE = '2026-09';

/** Terça 08:00–12:00: 240 min × 5 terças = 1200 min na grade. */
const TERCA_DA_PRODUTIVIDADE = [2 => [['inicio' => '08:00', 'fim' => '12:00']]];

/** Profissional ATIVO com a especialidade principal (40 min) e, opcionalmente, horários por dia. */
function profissionalDaProdutividade(string $nome, array $horarios = []): Profissional
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->comHorarios($horarios)->create(['nome' => $nome]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return $profissional;
}

/** Status escolhido pelas FLAGS, nunca pelo nome (§13) — o próprio teste obedece à regra que prova. */
function statusDaProdutividade(bool $descontaSessao, bool $marcaFalta, bool $ocupaHorario): StatusAgendamento
{
    return StatusAgendamento::query()
        ->where('desconta_sessao', $descontaSessao)
        ->where('marca_falta', $marcaFalta)
        ->where('ocupa_horario', $ocupaHorario)
        ->orderBy('ordem')
        ->firstOrFail();
}

/** Agendamento de ATENDIMENTO do profissional, no status dado (parede da clínica). */
function atendimentoDaProdutividade(Profissional $profissional, string $inicio, StatusAgendamento $status, int $minutos = 40): Agendamento
{
    $comeco = Carbon::createFromFormat('Y-m-d H:i', $inicio);

    return Agendamento::factory()->create([
        'profissional_id' => $profissional->id,
        'status_id' => $status->id,
        'inicio' => $comeco->format('Y-m-d H:i'),
        'fim' => $comeco->copy()->addMinutes($minutos)->format('Y-m-d H:i'),
    ]);
}

/** BLOQUEIO de agenda do profissional — não é marcação, desconta a capacidade. */
function bloqueioDaProdutividade(Profissional $profissional, string $inicio, string $fim): Agendamento
{
    return Agendamento::factory()->create([
        'tipo' => 'bloqueio',
        'paciente_id' => null,
        'status_id' => null,
        'profissional_id' => $profissional->id,
        'inicio' => $inicio,
        'fim' => $fim,
    ]);
}

function vistaDaProdutividade(string $mes = MES_DA_PRODUTIVIDADE): TestResponse
{
    return test()->getJson("/api/indicadores/produtividade?mes={$mes}");
}

it('deve responder 403 a quem tem atendimentos.ver mas não agenda.ver', function () {
    // ARRANGE — só o eixo clínico
    admin();
    $soClinico = usuarioCom(['atendimentos.ver'], 'Só Clínico da Produtividade');

    // ACT + ASSERT
    $this->actingAs($soClinico);
    vistaDaProdutividade()->assertForbidden();
});

it('deve responder 403 a quem tem agenda.ver mas não atendimentos.ver — antes de validar o mês', function () {
    // ARRANGE — só o eixo da agenda
    admin();
    $soAgenda = usuarioCom(['agenda.ver'], 'Só Agenda da Produtividade');

    // ACT + ASSERT — a permissão decide ANTES do mês: com mês inválido continua 403, não 422
    $this->actingAs($soAgenda);
    vistaDaProdutividade()->assertForbidden();
    vistaDaProdutividade('2026-13')->assertForbidden();
});

it('deve responder 422 com mês ausente ou fora de YYYY-MM', function () {
    // ARRANGE
    $this->actingAs(admin());

    // ACT + ASSERT
    $this->getJson('/api/indicadores/produtividade')->assertUnprocessable();
    vistaDaProdutividade('2026-13')->assertUnprocessable();
    vistaDaProdutividade('09/2026')->assertUnprocessable();
});

it('deve classificar cada agendamento em UM balde pelas flags do status, nunca pelo nome', function () {
    // ARRANGE — o status com `marca_falta` RENOMEADO para "Ausente" (ele também desconta a
    // sessão, como o padrão "Não Compareceu" — e ainda assim é falta, não realizado); um
    // realizado, um liberado (não ocupa horário) e um em aberto
    $this->actingAs(admin());
    $falta = statusDaProdutividade(descontaSessao: true, marcaFalta: true, ocupaHorario: true);
    $falta->update(['nome' => 'Ausente']);
    $realizado = statusDaProdutividade(descontaSessao: true, marcaFalta: false, ocupaHorario: true);
    $liberado = statusDaProdutividade(descontaSessao: false, marcaFalta: false, ocupaHorario: false);
    $emAberto = statusDaProdutividade(descontaSessao: false, marcaFalta: false, ocupaHorario: true);
    $profissional = profissionalDaProdutividade('Profissional Fictícia dos Baldes', TERCA_DA_PRODUTIVIDADE);
    atendimentoDaProdutividade($profissional, '2026-09-01 08:00', $realizado);
    atendimentoDaProdutividade($profissional, '2026-09-01 08:40', $falta);
    atendimentoDaProdutividade($profissional, '2026-09-01 09:20', $liberado);
    atendimentoDaProdutividade($profissional, '2026-09-08 10:00', $emAberto);
    // fora do mês: não entra em balde nenhum
    atendimentoDaProdutividade($profissional, '2026-10-06 08:00', $realizado);

    // ACT
    $vista = vistaDaProdutividade();

    // ASSERT — o liberado devolveu o horário (não é marcado); percentuais inteiros sobre a grade
    $vista->assertOk()->assertJsonPath('mes', '2026-09')->assertJsonCount(1, 'linhas');
    $linha = $vista->json('linhas.0');
    expect($linha['realizados'])->toBe(1)
        ->and($linha['faltas'])->toBe(1)
        ->and($linha['liberados'])->toBe(1)
        ->and($linha['em_aberto'])->toBe(1)
        ->and($linha['marcados'])->toBe(3)
        ->and($linha['minutos_marcados'])->toBe(120)
        ->and($linha['minutos_realizados'])->toBe(40)
        ->and($linha['minutos_na_grade'])->toBe(1200)
        ->and($linha['minutos_ociosos'])->toBe(1080)
        ->and($linha['duracao_referencia_min'])->toBe(40)
        ->and($linha['capacidade_atendimentos'])->toBe(30)
        ->and($linha['ocupacao_pct'])->toBe(10)
        ->and($linha['produtividade_pct'])->toBe(3)
        ->and($linha['aproveitamento_pct'])->toBe(33);
    // os totais da clínica são a soma das linhas (aqui, uma) com percentuais sobre as somas
    expect($vista->json('totais'))->toBe([
        'minutos_na_grade' => 1200,
        // simultaneidade 1: a vaga é o próprio relógio (change atendimento-em-grupo)
        'minutos_de_vaga' => 1200,
        'minutos_marcados' => 120,
        'minutos_realizados' => 40,
        'minutos_ociosos' => 1080,
        'capacidade_atendimentos' => 30,
        'marcados' => 3,
        'realizados' => 1,
        'faltas' => 1,
        'liberados' => 1,
        'em_aberto' => 1,
        'ocupacao_pct' => 10,
        'produtividade_pct' => 3,
        'aproveitamento_pct' => 33,
    ]);
});

it('deve devolver capacidade zero e percentuais NULOS a quem não tem grade — nunca 0%', function () {
    // ARRANGE — um sem grade e sem marcação; outro sem grade mas com um horário marcado
    $this->actingAs(admin());
    $semGrade = profissionalDaProdutividade('Profissional Fictícia Sem Grade');
    $semGradeMarcado = profissionalDaProdutividade('Profissional Fictício Sem Grade Marcado');
    atendimentoDaProdutividade($semGradeMarcado, '2026-09-01 08:00', statusDaProdutividade(false, false, true));

    // ACT
    $vista = vistaDaProdutividade();

    // ASSERT — sem denominador não há percentual; o aproveitamento, que divide pelo MARCADO,
    // existe (0) quando há marcação
    $vista->assertOk();
    $linhas = collect($vista->json('linhas'))->keyBy('profissional.id');
    expect($linhas[$semGrade->id])->toMatchArray([
        'minutos_na_grade' => 0,
        'capacidade_atendimentos' => 0,
        'ocupacao_pct' => null,
        'produtividade_pct' => null,
        'aproveitamento_pct' => null,
    ]);
    expect($linhas[$semGradeMarcado->id])->toMatchArray([
        'minutos_na_grade' => 0,
        'marcados' => 1,
        'minutos_ociosos' => 0,
        'ocupacao_pct' => null,
        'produtividade_pct' => null,
        'aproveitamento_pct' => 0,
    ]);
    expect($vista->json('totais.ocupacao_pct'))->toBeNull()
        ->and($vista->json('totais.produtividade_pct'))->toBeNull();
});

it('deve descontar o feriado ativo (fixo e recorrente) e o bloqueio, e ignorar o feriado inativo', function () {
    // ARRANGE — feriado fixo numa terça, recorrente de 2019 que cai noutra terça, um INATIVO numa
    // terceira terça (não fecha a clínica) e um bloqueio 07:00–09:00 que só toca 60 min da janela
    $this->actingAs(admin());
    $profissional = profissionalDaProdutividade('Profissional Fictícia do Feriado', TERCA_DA_PRODUTIVIDADE);
    Feriado::factory()->create(['nome' => 'Feriado Fixo Fictício', 'data' => '2026-09-08']);
    Feriado::factory()->create(['nome' => 'Feriado Recorrente Fictício', 'data' => '2019-09-22', 'recorrente' => true]);
    Feriado::factory()->create(['nome' => 'Feriado Inativo Fictício', 'data' => '2026-09-15', 'ativo' => false]);
    bloqueioDaProdutividade($profissional, '2026-09-01 07:00', '2026-09-01 09:00');

    // ACT
    $vista = vistaDaProdutividade();

    // ASSERT — 1200 − 480 (dois feriados) − 60 (interseção do bloqueio); bloqueio NÃO é marcação
    $vista->assertOk()->assertJsonCount(1, 'linhas');
    $linha = $vista->json('linhas.0');
    expect($linha['minutos_em_feriados'])->toBe(480)
        ->and($linha['minutos_em_bloqueios'])->toBe(60)
        ->and($linha['minutos_na_grade'])->toBe(660)
        ->and($linha['marcados'])->toBe(0)
        ->and($linha['minutos_ociosos'])->toBe(660)
        ->and($linha['ocupacao_pct'])->toBe(0);
});

it('deve mostrar ao profissional escopado só a própria linha (D11)', function () {
    // ARRANGE — A e B com grade e movimento; usuário sem `ver_todos` vinculado a A
    admin();
    $profA = profissionalDaProdutividade('Profissional Fictícia A', TERCA_DA_PRODUTIVIDADE);
    $profB = profissionalDaProdutividade('Profissional Fictício B', TERCA_DA_PRODUTIVIDADE);
    $emAberto = statusDaProdutividade(false, false, true);
    atendimentoDaProdutividade($profA, '2026-09-01 08:00', $emAberto);
    atendimentoDaProdutividade($profB, '2026-09-01 08:00', $emAberto);
    atendimentoDaProdutividade($profB, '2026-09-01 09:00', $emAberto);
    $escopado = usuarioEscopadoEm($profA, ['atendimentos.ver']);

    // ACT
    $vista = $this->actingAs($escopado)->getJson('/api/indicadores/produtividade?mes='.MES_DA_PRODUTIVIDADE);

    // ASSERT — uma linha, a dele; os totais também só dele
    $vista->assertOk()
        ->assertJsonCount(1, 'linhas')
        ->assertJsonPath('linhas.0.profissional.id', $profA->id)
        ->assertJsonPath('totais.marcados', 1)
        ->assertJsonPath('totais.minutos_na_grade', 1200);
    semVazamento($vista->json(), 'Profissional Fictício B');
});

it('deve aplicar a INTERSEÇÃO dos eixos: plano num eixo e escopado no outro vê só a própria linha', function () {
    // ARRANGE — um usuário por profissional (o vínculo é único no banco): plano só na agenda
    // vinculado a A, plano só no clínico vinculado a B, plano nos dois vinculado a C
    admin();
    $profA = profissionalDaProdutividade('Profissional Fictícia A', TERCA_DA_PRODUTIVIDADE);
    $profB = profissionalDaProdutividade('Profissional Fictício B', TERCA_DA_PRODUTIVIDADE);
    $profC = profissionalDaProdutividade('Profissional Fictícia C', TERCA_DA_PRODUTIVIDADE);
    $planoNaAgenda = usuarioCom(['agenda.ver', 'atendimentos.ver', 'agenda.ver_todos'], 'Plano na Agenda');
    $planoNaAgenda->update(['profissional_id' => $profA->id]);
    $planoNoClinico = usuarioCom(['agenda.ver', 'atendimentos.ver', 'clinico.ver_todos'], 'Plano no Clínico');
    $planoNoClinico->update(['profissional_id' => $profB->id]);
    $planoNosDois = usuarioCom(['agenda.ver', 'atendimentos.ver', 'agenda.ver_todos', 'clinico.ver_todos'], 'Plano nos Dois');
    $planoNosDois->update(['profissional_id' => $profC->id]);

    // ACT + ASSERT — o eixo mais restrito vence; só quem é plano nos DOIS vê a clínica inteira
    foreach ([[$planoNaAgenda, $profA], [$planoNoClinico, $profB]] as [$umEixoSo, $oProprio]) {
        trocarDeUsuario();
        $this->actingAs($umEixoSo)->getJson('/api/indicadores/produtividade?mes='.MES_DA_PRODUTIVIDADE)
            ->assertOk()
            ->assertJsonCount(1, 'linhas')
            ->assertJsonPath('linhas.0.profissional.id', $oProprio->id);
    }
    trocarDeUsuario();
    $this->actingAs($planoNosDois)->getJson('/api/indicadores/produtividade?mes='.MES_DA_PRODUTIVIDADE)
        ->assertOk()
        ->assertJsonCount(3, 'linhas');
});

it('deve devolver zero linhas ao papel sem ver_todos com usuário SEM vínculo (fail-closed)', function () {
    // ARRANGE — movimento real na clínica; papel sem as flags e usuário sem profissional
    $this->actingAs(admin());
    $profissional = profissionalDaProdutividade('Profissional Fictícia Visível', TERCA_DA_PRODUTIVIDADE);
    atendimentoDaProdutividade($profissional, '2026-09-01 08:00', statusDaProdutividade(true, false, true));
    $semVinculo = usuarioCom(['agenda.ver', 'atendimentos.ver'], 'Sem Vínculo da Produtividade');

    // ACT
    $vista = $this->actingAs($semVinculo)->getJson('/api/indicadores/produtividade?mes='.MES_DA_PRODUTIVIDADE);

    // ASSERT — `nenhum` degrada para lista vazia e totais zerados, nunca para "plano"
    $vista->assertOk()
        ->assertJsonCount(0, 'linhas')
        ->assertJsonPath('totais.minutos_na_grade', 0)
        ->assertJsonPath('totais.realizados', 0)
        ->assertJsonPath('totais.ocupacao_pct', null);
});

it('deve listar ao plano todos os profissionais ATIVOS ordenados por nome, mesmo sem grade', function () {
    // ARRANGE — três ativos fora de ordem (sem grade) e um inativo
    $this->actingAs(admin());
    profissionalDaProdutividade('Carla Fictícia');
    profissionalDaProdutividade('Ana Fictícia');
    profissionalDaProdutividade('Bruno Fictício');
    Profissional::factory()->create(['nome' => 'Zeca Fictício Inativo', 'ativo' => false]);

    // ACT
    $vista = vistaDaProdutividade();

    // ASSERT
    $vista->assertOk();
    expect(collect($vista->json('linhas'))->pluck('profissional.nome')->all())
        ->toBe(['Ana Fictícia', 'Bruno Fictício', 'Carla Fictícia']);
});

it('deve trazer 7 entradas ISO em por_dia_da_semana cuja soma bate com a linha', function () {
    // ARRANGE — terça de manhã e quinta à tarde; marcações na terça, na quinta e num domingo
    // (fora da grade, mas marcado — conta no dia 7 com grade zero)
    $this->actingAs(admin());
    $profissional = profissionalDaProdutividade('Profissional Fictícia da Semana', [
        2 => [['inicio' => '08:00', 'fim' => '12:00']],
        4 => [['inicio' => '14:00', 'fim' => '18:00']],
    ]);
    $realizado = statusDaProdutividade(true, false, true);
    $emAberto = statusDaProdutividade(false, false, true);
    atendimentoDaProdutividade($profissional, '2026-09-01 08:00', $realizado);
    atendimentoDaProdutividade($profissional, '2026-09-03 14:00', $emAberto);
    atendimentoDaProdutividade($profissional, '2026-09-03 15:00', $realizado);
    atendimentoDaProdutividade($profissional, '2026-09-06 09:00', $emAberto);

    // ACT
    $vista = vistaDaProdutividade();

    // ASSERT — 5 terças × 240 + 4 quintas × 240 = 2160; a quebra soma a linha em cada medida
    $vista->assertOk();
    $linha = $vista->json('linhas.0');
    $porDia = collect($linha['por_dia_da_semana']);
    expect($porDia->pluck('dia')->all())->toBe([1, 2, 3, 4, 5, 6, 7])
        ->and($linha['minutos_na_grade'])->toBe(2160)
        ->and($porDia->sum('minutos_na_grade'))->toBe($linha['minutos_na_grade'])
        ->and($porDia->sum('marcados'))->toBe($linha['marcados'])
        ->and($porDia->sum('minutos_marcados'))->toBe($linha['minutos_marcados'])
        ->and($porDia->sum('realizados'))->toBe($linha['realizados'])
        ->and($porDia->sum('minutos_realizados'))->toBe($linha['minutos_realizados'])
        ->and($linha['marcados'])->toBe(4)
        ->and($linha['realizados'])->toBe(2)
        ->and($porDia->firstWhere('dia', 2))->toBe([
            'dia' => 2, 'minutos_na_grade' => 1200, 'marcados' => 1, 'minutos_marcados' => 40, 'realizados' => 1, 'minutos_realizados' => 40,
        ])
        ->and($porDia->firstWhere('dia', 4))->toBe([
            'dia' => 4, 'minutos_na_grade' => 960, 'marcados' => 2, 'minutos_marcados' => 80, 'realizados' => 1, 'minutos_realizados' => 40,
        ])
        ->and($porDia->firstWhere('dia', 7))->toBe([
            'dia' => 7, 'minutos_na_grade' => 0, 'marcados' => 1, 'minutos_marcados' => 40, 'realizados' => 0, 'minutos_realizados' => 0,
        ]);
});

it('deve expor do profissional só id, nome e foto_versao — e nada de cadastro nem de paciente', function () {
    // ARRANGE — profissional com dados de cadastro preenchidos e uma criança marcada
    $this->actingAs(admin());
    $profissional = profissionalDaProdutividade('Profissional Fictícia da Whitelist', TERCA_DA_PRODUTIVIDADE);
    $profissional->update(['conselho' => 'CRFa', 'num_conselho' => '987654', 'obs' => 'Observação interna fictícia']);
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia da Whitelist']);
    Agendamento::factory()->create([
        'profissional_id' => $profissional->id,
        'paciente_id' => $crianca->id,
        'status_id' => statusDaProdutividade(true, false, true)->id,
        'inicio' => '2026-09-01 08:00',
        'fim' => '2026-09-01 08:40',
    ]);

    // ACT
    $vista = vistaDaProdutividade();

    // ASSERT — as chaves são EXATAMENTE as do contrato, na ordem; nenhum texto de cadastro vaza
    $vista->assertOk();
    expect(array_keys($vista->json()))->toBe(['mes', 'totais', 'linhas']);
    $linha = $vista->json('linhas.0');
    expect(array_keys($linha['profissional']))->toBe(['id', 'nome', 'foto_versao'])
        ->and(array_keys($linha['especialidade']))->toBe(['id', 'nome', 'cor'])
        ->and(array_keys($linha))->toBe([
            'profissional', 'especialidade', 'duracao_referencia_min',
            'minutos_na_grade', 'atendimentos_simultaneos', 'minutos_de_vaga',
            'minutos_em_feriados', 'minutos_em_bloqueios', 'capacidade_atendimentos',
            'marcados', 'minutos_marcados', 'realizados', 'minutos_realizados',
            'faltas', 'liberados', 'em_aberto', 'minutos_ociosos',
            'ocupacao_pct', 'produtividade_pct', 'aproveitamento_pct',
            'por_dia_da_semana',
        ])
        ->and(array_keys($linha['por_dia_da_semana'][0]))->toBe([
            'dia', 'minutos_na_grade', 'marcados', 'minutos_marcados', 'realizados', 'minutos_realizados',
        ])
        ->and(array_keys($vista->json('totais')))->toBe([
            'minutos_na_grade', 'minutos_de_vaga', 'minutos_marcados', 'minutos_realizados', 'minutos_ociosos',
            'capacidade_atendimentos', 'marcados', 'realizados', 'faltas', 'liberados', 'em_aberto',
            'ocupacao_pct', 'produtividade_pct', 'aproveitamento_pct',
        ]);
    semVazamento($vista->json(), 'Criança Fictícia da Whitelist');
    semVazamento($vista->json(), 'Observação interna fictícia');
    semVazamento($vista->json(), '987654');
    semVazamento($vista->json(), 'CRFa');
});

it('deve descontar o bloqueio que COMEÇA no mês anterior e entra neste', function () {
    // ARRANGE — a leitura dos bloqueios é por SOBREPOSIÇÃO com o mês, não por `inicio` dentro
    // dele; sem esta guarda, trocar a condição por `whereBetween('inicio', ...)` não derrubava
    // teste nenhum (achado CR-07). O bloqueio começa na segunda 31/08 e termina na terça 1º/09
    // às 10:00 — 120 min da janela 08:00–12:00 daquela terça.
    $this->actingAs(admin());
    $profissional = profissionalDaProdutividade('Profissional Fictício da Virada', TERCA_DA_PRODUTIVIDADE);
    bloqueioDaProdutividade($profissional, '2026-08-31 08:00', '2026-09-01 10:00');

    // ACT
    $resposta = vistaDaProdutividade();

    // ASSERT — 1200 − 120; o dia 31/08 é de outro mês e não entra na conta
    $linha = $resposta->assertOk()->json('linhas.0');
    expect($linha['minutos_em_bloqueios'])->toBe(120)
        ->and($linha['minutos_na_grade'])->toBe(1080);
});

it('deve recusar minutos negativos de um agendamento com fim antes do início', function () {
    // ARRANGE — impossível pela API (`after:inicio` na criação e na edição), possível por
    // escrita direta no banco. Sem o piso, a soma dava minutos negativos, o percentual ficava
    // negativo e o ocioso passava a ser MAIOR que a grade (achado SEC-PR-01 da auditoria).
    $this->actingAs(admin());
    $profissional = profissionalDaProdutividade('Profissional Fictício da Linha Torta', TERCA_DA_PRODUTIVIDADE);
    $realizado = statusDaProdutividade(descontaSessao: true, marcaFalta: false, ocupaHorario: true);
    $agendamento = atendimentoDaProdutividade($profissional, '2026-09-01 10:00', $realizado);
    DB::table('agendamentos')->where('id', $agendamento->id)->update(['fim' => '2026-09-01 08:00']);

    // ACT
    $linha = vistaDaProdutividade()->assertOk()->json('linhas.0');

    // ASSERT — a linha torta não vira minuto negativo, e nenhum percentual sai do intervalo
    expect($linha['minutos_realizados'])->toBe(0)
        ->and($linha['minutos_marcados'])->toBe(0)
        ->and($linha['minutos_ociosos'])->toBe(1200)
        ->and($linha['produtividade_pct'])->toBe(0)
        ->and($linha['ocupacao_pct'])->toBe(0);
});

it('deve devolver vazio ao papel de BALCÃO — plano na agenda, sem o clínico e sem vínculo', function () {
    // ARRANGE — é o papel real da recepção depois do backfill: tem `agenda.ver_todos` (opera a
    // agenda da clínica inteira), NÃO tem `clinico.ver_todos` e não é vinculado a profissional
    // nenhum. A interseção dos eixos degrada para `nenhum` — fail-closed, por desenho. Sem esta
    // guarda, afrouxar a interseção para "o eixo mais PERMISSIVO" não derrubava teste (CR-05).
    $this->actingAs(admin());
    $profissional = profissionalDaProdutividade('Profissional Fictícia do Balcão', TERCA_DA_PRODUTIVIDADE);
    atendimentoDaProdutividade($profissional, '2026-09-01 08:00', statusDaProdutividade(true, false, true));
    $balcao = usuarioCom(['agenda.ver', 'atendimentos.ver', 'agenda.ver_todos'], 'Recepção da Produtividade');

    // ACT
    trocarDeUsuario();
    $vista = $this->actingAs($balcao)->getJson('/api/indicadores/produtividade?mes='.MES_DA_PRODUTIVIDADE);

    // ASSERT — 200 com lista vazia (a tela explica o escopo), nunca a clínica inteira
    $vista->assertOk()->assertJsonCount(0, 'linhas');
    expect($vista->json('totais.minutos_na_grade'))->toBe(0)
        ->and($vista->json('totais.realizados'))->toBe(0);
});

it('deve medir quem atende em GRUPO contra as vagas, não contra o relógio', function () {
    // ARRANGE — sem isto, 4 sessões de 40 min num slot de 40 dariam 400%, clampados a 100: a
    // profissional apareceria LOTADA todo mês no indicador que decide contratação
    // (change atendimento-em-grupo, D6). Dados 100% fictícios.
    $this->actingAs(admin());
    $realizado = statusDaProdutividade(descontaSessao: true, marcaFalta: false, ocupaHorario: true);
    $profissional = profissionalDaProdutividade('Profissional Fictícia do Grupo', TERCA_DA_PRODUTIVIDADE);
    $profissional->update(['atendimentos_simultaneos' => 4]);
    // as quatro crianças do grupo, no MESMO horário
    foreach (range(1, 4) as $i) {
        atendimentoDaProdutividade($profissional, '2026-09-01 08:00', $realizado);
    }

    // ACT
    $linha = vistaDaProdutividade()->json('linhas.0');

    // ASSERT — 160 min marcados contra 1200 × 4 de vaga = 3%; o relógio continua 1200
    expect($linha['minutos_na_grade'])->toBe(1200)
        ->and($linha['atendimentos_simultaneos'])->toBe(4)
        ->and($linha['minutos_de_vaga'])->toBe(4800)
        ->and($linha['minutos_marcados'])->toBe(160)
        ->and($linha['ocupacao_pct'])->toBe(3)
        ->and($linha['capacidade_atendimentos'])->toBe(120); // 4800 ÷ 40
});

it('não deve mudar número nenhum de quem atende um por vez', function () {
    // ARRANGE — multiplicar por 1 não faz nada, e é o que garante que a mudança do
    // denominador não mexe em nenhum profissional da clínica hoje
    $this->actingAs(admin());
    $realizado = statusDaProdutividade(descontaSessao: true, marcaFalta: false, ocupaHorario: true);
    $profissional = profissionalDaProdutividade('Profissional Fictícia Solo', TERCA_DA_PRODUTIVIDADE);
    atendimentoDaProdutividade($profissional, '2026-09-01 08:00', $realizado);

    // ACT
    $linha = vistaDaProdutividade()->json('linhas.0');

    // ASSERT
    expect($linha['minutos_de_vaga'])->toBe($linha['minutos_na_grade'])
        ->and($linha['atendimentos_simultaneos'])->toBe(1)
        ->and($linha['capacidade_atendimentos'])->toBe(30);
});
