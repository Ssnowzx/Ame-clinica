<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Especialidade;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/**
 * O painel do mês de UM profissional (change painel-do-profissional): `GET /api/profissionais/{id}/painel`.
 * A porta é a da ficha (`profissionais.ver` OU o próprio vinculado); cada bloco vem só com a permissão do
 * módulo dono E o eixo do escopo de quem pede; a série de seis meses respeita o início dos indicadores.
 *
 * Relógio FIXO: quinta, 15 de outubro de 2026, 10h na parede da clínica. Período 1–15/10, comparado
 * 1–15/09. Dados 100% fictícios (LGPD: menores).
 */
const GRADE_DO_PAINEL_PROF = [
    1 => [['inicio' => '08:00', 'fim' => '12:00']],
    2 => [['inicio' => '08:00', 'fim' => '12:00']],
    3 => [['inicio' => '08:00', 'fim' => '12:00']],
    4 => [['inicio' => '08:00', 'fim' => '12:00']],
    5 => [['inicio' => '08:00', 'fim' => '12:00']],
];

/** As chaves de bloco que a resposta pode ter. */
const BLOCOS_DO_PAINEL_PROF = ['agenda', 'produtividade', 'equipe', 'pacientes', 'serie', 'financeiro'];

function relogioDoPainelProf(): void
{
    test()->travelTo(CarbonImmutable::parse('2026-10-15 10:00:00', 'America/Sao_Paulo'));
}

function profissionalDoPainelProf(string $nome): Profissional
{
    $especialidade = Especialidade::query()->where('nome', 'Fonoaudiologia Fictícia')->first()
        ?? Especialidade::factory()->create(['nome' => 'Fonoaudiologia Fictícia', 'tempo_sessao' => 40]);
    $profissional = Profissional::factory()->comHorarios(GRADE_DO_PAINEL_PROF)->create(['nome' => $nome]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return $profissional;
}

/** O status pelo PAPEL, escolhido pelas flags (nunca pelo nome — §13). */
function statusDoPainelProf(string $papel): StatusAgendamento
{
    $flags = match ($papel) {
        'realizada' => ['desconta_sessao' => true, 'marca_falta' => false, 'ocupa_horario' => true, 'marca_reserva' => false],
        'falta' => ['marca_falta' => true],
        'desmarque' => ['desconta_sessao' => false, 'marca_falta' => false, 'ocupa_horario' => false],
        'aberto' => ['em_aberto' => true],
    };

    return StatusAgendamento::query()->where($flags)->orderBy('ordem')->orderBy('id')->firstOrFail();
}

function sessaoDoPainelProf(Profissional $profissional, string $inicio, string $papel, ?Paciente $paciente = null): Agendamento
{
    $comeco = Carbon::createFromFormat('Y-m-d H:i', $inicio);

    return Agendamento::factory()->create([
        'profissional_id' => $profissional->id,
        'especialidade_id' => DB::table('profissional_especialidade')->where('profissional_id', $profissional->id)->value('especialidade_id'),
        'paciente_id' => ($paciente ?? Paciente::factory()->create())->id,
        'status_id' => statusDoPainelProf($papel)->id,
        'inicio' => $comeco->format('Y-m-d H:i'),
        'fim' => $comeco->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
}

/** Uma sessão realizada com o atendimento registrado e, se pedido, a evolução escrita. */
function realizadaComAtendimentoDoPainelProf(Profissional $profissional, string $inicio, bool $comEvolucao, ?Paciente $paciente = null): void
{
    $sessao = sessaoDoPainelProf($profissional, $inicio, 'realizada', $paciente);
    $atendimento = Atendimento::factory()->create([
        'agendamento_id' => $sessao->id,
        'finalizado_em' => $sessao->inicio->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
    if ($comEvolucao) {
        $evolucao = new Evolucao(['profissional_id' => $profissional->id, 'conteudo' => 'Evolução clínica fictícia.']);
        $evolucao->atendimento_id = $atendimento->id;
        $evolucao->preenchida_em = $atendimento->finalizado_em->format('Y-m-d H:i');
        $evolucao->save();
    }
}

/**
 * A agenda de duas profissionais: a Ana com o mês variado (realizadas, falta, desmarque, em aberto,
 * futura) e histórico desde agosto; a Bia com outros números — a soma da clínica nunca é a da Ana.
 *
 * @return array{ana: Profissional, bia: Profissional}
 */
function agendaDoPainelProf(): array
{
    $ana = profissionalDoPainelProf('Ana Fictícia do Painel');
    $bia = profissionalDoPainelProf('Bia Fictícia do Painel');
    $crianca = Paciente::factory()->create(['nome' => 'Criança Fictícia do Painel']);

    // histórico: julho (o início da clínica — antes de 01/08, para "setembro × agosto" comparar o
    // mês inteiro), agosto e setembro
    sessaoDoPainelProf($ana, '2026-07-20 09:00', 'realizada', $crianca);
    sessaoDoPainelProf($ana, '2026-08-10 09:00', 'realizada', $crianca);
    sessaoDoPainelProf($ana, '2026-09-02 08:00', 'realizada', $crianca);
    sessaoDoPainelProf($ana, '2026-09-03 08:00', 'realizada', $crianca);
    sessaoDoPainelProf($ana, '2026-09-08 08:00', 'falta', $crianca);
    // outubro
    realizadaComAtendimentoDoPainelProf($ana, '2026-10-01 08:00', true, $crianca);
    realizadaComAtendimentoDoPainelProf($ana, '2026-10-02 08:00', false, $crianca);
    realizadaComAtendimentoDoPainelProf($ana, '2026-10-05 08:40', true, $crianca);
    sessaoDoPainelProf($ana, '2026-10-06 09:20', 'falta', $crianca);
    sessaoDoPainelProf($ana, '2026-10-07 10:00', 'desmarque', $crianca);
    sessaoDoPainelProf($ana, '2026-10-08 08:00', 'aberto', $crianca);
    sessaoDoPainelProf($ana, '2026-10-20 08:00', 'aberto', $crianca);

    realizadaComAtendimentoDoPainelProf($bia, '2026-10-01 09:00', true);
    realizadaComAtendimentoDoPainelProf($bia, '2026-10-02 09:00', true);
    sessaoDoPainelProf($bia, '2026-10-05 09:00', 'falta');
    sessaoDoPainelProf($bia, '2026-09-04 09:00', 'realizada');

    return compact('ana', 'bia');
}

function painelDoProf(int $id, string $mes = '2026-10'): TestResponse
{
    return test()->getJson("/api/profissionais/{$id}/painel?mes={$mes}");
}

/** As chaves de bloco presentes na resposta, na ordem do contrato. */
function blocosDoPainelProf(TestResponse $resposta): array
{
    return array_values(array_intersect(BLOCOS_DO_PAINEL_PROF, array_keys($resposta->json())));
}

/** Quem vê a clínica inteira nos dois eixos, sem o resto do Administrador. */
function gestorDoPainelProf(array $sem = [], array $mais = []): Usuario
{
    $permissoes = array_diff([
        'profissionais.ver', 'agenda.ver', 'atendimentos.ver', 'pacientes.ver', 'tratamentos.ver',
        'agenda.ver_todos', 'clinico.ver_todos', ...$mais,
    ], $sem);

    return usuarioCom(array_values($permissoes), 'Gestor do Painel '.md5(implode(',', $permissoes)));
}

// ─── A porta (D3) ──────────────────────────────────────────────────────────────────────────────

it('deve devolver ao gestor os blocos de agenda, clínico e pacientes, comparados com o mesmo período do mês anterior', function () {
    // ARRANGE — setembro é mês fechado: compara com agosto inteiro
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $gestor = gestorDoPainelProf();

    // ACT
    $resposta = $this->actingAs($gestor)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-09");

    // ASSERT
    $resposta->assertOk();
    expect(blocosDoPainelProf($resposta))->toBe(['agenda', 'produtividade', 'equipe', 'pacientes', 'serie'])
        ->and($resposta->json('profissional'))->toBe(['id' => $ana->id, 'nome' => 'Ana Fictícia do Painel', 'foto_versao' => null])
        ->and($resposta->json('periodo'))->toMatchArray([
            'mes' => '2026-09', 'de' => '2026-09-01', 'ate' => '2026-09-30', 'parcial' => false,
            'comparado_de' => '2026-08-01', 'comparado_ate' => '2026-08-31',
        ])
        ->and($resposta->json('agenda.realizadas'))->toBe(['atual' => 2, 'anterior' => 1])
        ->and($resposta->json('agenda.faltas.atual.quantidade'))->toBe(1)
        ->and($resposta->json('produtividade.realizados'))->toBe(2)
        ->and($resposta->json('equipe.profissionais.0.id'))->toBe($ana->id);
});

it('deve abrir o painel à própria profissional escopada, sem profissionais.ver', function () {
    // ARRANGE — vinculada à Ana, sem as flags de ver todos e sem o cadastro dos profissionais
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $propria = usuarioEscopadoEm($ana, ['atendimentos.ver', 'pacientes.ver', 'tratamentos.ver']);

    // ACT
    $resposta = $this->actingAs($propria)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    expect(blocosDoPainelProf($resposta))->toBe(['agenda', 'produtividade', 'equipe', 'pacientes', 'serie'])
        ->and($resposta->json('agenda.realizadas.atual'))->toBe(3);
});

it('deve responder 403 à escopada que pede o painel de um colega, com ou sem profissionais.ver', function (bool $veOCadastro) {
    // ARRANGE — os números do recorte dela, no painel da Bia, mentiriam como "zero"
    relogioDoPainelProf();
    admin();
    ['ana' => $ana, 'bia' => $bia] = agendaDoPainelProf();
    $propria = usuarioEscopadoEm($ana, ['atendimentos.ver', 'pacientes.ver', ...($veOCadastro ? ['profissionais.ver'] : [])]);

    // ACT
    $resposta = $this->actingAs($propria)->getJson("/api/profissionais/{$bia->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertForbidden();
})->with(['sem profissionais.ver' => false, 'com profissionais.ver' => true]);

it('deve responder 403, e não 422, a quem não pode ver o painel e manda um mês inválido', function (string $quem) {
    // ARRANGE — sem a porta da rota, ou com a porta e sem bloco nenhum
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $usuario = $quem === 'sem a porta'
        ? usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Recepção Sem Cadastro do Painel')
        : usuarioCom(['profissionais.ver'], 'Só o Cadastro do Painel');

    // ACT
    $resposta = $this->actingAs($usuario)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-13");

    // ASSERT
    $resposta->assertForbidden();
})->with(['sem a porta', 'com a porta e sem bloco']);

it('deve responder 422 ao mês inválido ou futuro de quem pode ver o painel', function (string $mes) {
    // ARRANGE
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $gestor = gestorDoPainelProf();

    // ACT
    $resposta = $this->actingAs($gestor)->getJson("/api/profissionais/{$ana->id}/painel?mes={$mes}");

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('mes');
})->with(['2026-13', '2026-11', '10/2026']);

it('deve usar o mês corrente da clínica quando o mês não vem', function () {
    // ARRANGE
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $gestor = gestorDoPainelProf();

    // ACT
    $resposta = $this->actingAs($gestor)->getJson("/api/profissionais/{$ana->id}/painel");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('periodo'))->toMatchArray(['mes' => '2026-10', 'ate' => '2026-10-15', 'parcial' => true]);
});

it('deve responder 404 ao id que não existe para quem vê o cadastro', function () {
    // ARRANGE
    relogioDoPainelProf();
    admin();
    $gestor = gestorDoPainelProf();

    // ACT + ASSERT
    $this->actingAs($gestor)->getJson('/api/profissionais/999999/painel?mes=2026-10')->assertNotFound();
});

// ─── Os blocos (D3/D7) ─────────────────────────────────────────────────────────────────────────

it('não deve trazer o bloco cuja permissão do módulo dono falta — nem zerado', function (string $sem, array $esperados) {
    // ARRANGE
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $gestor = gestorDoPainelProf(sem: [$sem]);

    // ACT
    $resposta = $this->actingAs($gestor)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    expect(blocosDoPainelProf($resposta))->toBe($esperados);
})->with([
    'sem pacientes.ver' => ['pacientes.ver', ['agenda', 'produtividade', 'equipe', 'serie']],
    'sem atendimentos.ver' => ['atendimentos.ver', ['agenda', 'pacientes']],
    'sem agenda.ver' => ['agenda.ver', ['pacientes']],
]);

it('deve omitir o bloco de pacientes sem tratamentos.ver — nunca um bloco vazio', function () {
    // ARRANGE — o bloco só tem os pacotes no fim, que são do módulo de tratamentos (gate r1, I2)
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $semPacotes = gestorDoPainelProf(sem: ['tratamentos.ver'], mais: ['lista_espera.ver']);

    // ACT
    $resposta = $this->actingAs($semPacotes)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    expect(blocosDoPainelProf($resposta))->toBe(['agenda', 'produtividade', 'equipe', 'serie']);
});

it('deve contar os pacotes no fim sem calcular o resto do painel de pacientes', function () {
    // ARRANGE — ativos, novos, saíram e a fila são da clínica e não vêm: nem a consulta deles roda
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $gestor = gestorDoPainelProf(mais: ['lista_espera.ver']);
    $consultas = [];
    DB::listen(function ($consulta) use (&$consultas): void {
        $consultas[] = $consulta->sql;
    });

    // ACT
    $resposta = $this->actingAs($gestor)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT — nem a contagem de pacientes da clínica, nem a trilha dos que saíram, nem a fila
    $resposta->assertOk();
    expect($resposta->json('pacientes'))->toBe(['pacotes_no_fim' => 0])
        ->and(collect($consultas)->filter(fn (string $sql): bool => str_contains($sql, 'from `pacientes`')
            || str_contains($sql, 'from `auditoria`') || str_contains($sql, 'from `lista_espera`'))->values()->all())->toBe([]);
});

it('não deve trazer no painel do profissional os números de pacientes da clínica inteira', function () {
    // ARRANGE — ativos/novos/saíram do painel de pacientes são da CLÍNICA: no painel dele mentiriam
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $gestor = gestorDoPainelProf(mais: ['lista_espera.ver']);

    // ACT
    $resposta = $this->actingAs($gestor)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT — só os pacotes no fim, que seguem o escopo do profissional
    $resposta->assertOk();
    expect(array_keys($resposta->json('pacientes')))->toBe(['pacotes_no_fim']);
});

it('deve omitir os blocos do eixo que não alcança o profissional pedido', function () {
    // ARRANGE — plana na agenda (`agenda.ver_todos`), escopada no clínico (vinculada à Ana): no painel
    // da Bia, a agenda e os pacientes vêm; a produção (agenda × clínico) não
    relogioDoPainelProf();
    admin();
    ['ana' => $ana, 'bia' => $bia] = agendaDoPainelProf();
    $mista = usuarioCom(
        ['profissionais.ver', 'agenda.ver', 'agenda.ver_todos', 'atendimentos.ver', 'pacientes.ver', 'tratamentos.ver'],
        'Plana na Agenda, Escopada no Clínico',
    );
    $mista->update(['profissional_id' => $ana->id]);

    // ACT
    $daBia = $this->actingAs($mista)->getJson("/api/profissionais/{$bia->id}/painel?mes=2026-10");
    $daAna = $this->actingAs($mista)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $daBia->assertOk();
    $daAna->assertOk();
    expect(blocosDoPainelProf($daBia))->toBe(['agenda', 'pacientes'])
        ->and(blocosDoPainelProf($daAna))->toBe(['agenda', 'produtividade', 'equipe', 'pacientes', 'serie']);
});

it('deve contar os pacotes no fim só do profissional, na régua do painel de pacientes', function () {
    // ARRANGE — um pacote no fim da Ana e dois da Bia. Ativos e novos seguem a régua do painel de
    // pacientes (D7): são da clínica, e a ficha não os lê como "da Ana"
    relogioDoPainelProf();
    $administradora = admin();
    $ana = profissionalDoPainelProf('Ana Fictícia do Painel');
    $bia = profissionalDoPainelProf('Bia Fictícia do Painel');
    // `sessoes_realizadas` é do servidor (fora do fillable): saldo 1, no limiar padrão
    $noFim = fn (Profissional $dono) => Tratamento::factory()->create([
        'profissional_id' => $dono->id,
        'paciente_id' => Paciente::factory()->create()->id,
        'especialidade_id' => DB::table('profissional_especialidade')->where('profissional_id', $dono->id)->value('especialidade_id'),
        'sessoes_total' => 10,
    ])->forceFill(['sessoes_realizadas' => 9])->save();
    $noFim($ana);
    $noFim($bia);
    $noFim($bia);

    // ACT
    $this->actingAs($administradora);
    $doPainel = painelDoProf($ana->id)->assertOk();
    $daClinica = $this->getJson('/api/indicadores/painel/pacientes?mes=2026-10')->assertOk();

    // ASSERT
    expect($doPainel->json('pacientes.pacotes_no_fim'))->toBe(1)
        ->and($daClinica->json('pacotes_no_fim'))->toBe(3)
        // o número da clínica fica no painel da clínica: no dele, não vem (integração, 2026-10-15)
        ->and($doPainel->json('pacientes'))->not->toHaveKey('ativos');
});

// ─── Paridade (task 2.2) ───────────────────────────────────────────────────────────────────────

it('deve dar na ficha os MESMOS números da linha do profissional em Indicadores', function () {
    // ARRANGE — a lição de "o mesmo número em duas telas": a ficha embute os painéis no recorte do id
    relogioDoPainelProf();
    $administradora = admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $aPropriaAna = usuarioEscopadoEm($ana);

    // ACT
    $this->actingAs($administradora);
    $painel = painelDoProf($ana->id)->assertOk();
    $produtividade = $this->getJson('/api/indicadores/produtividade?mes=2026-10')->assertOk();
    $equipe = $this->getJson('/api/indicadores/painel/equipe?mes=2026-10')->assertOk();
    $agendaDaClinica = $this->getJson('/api/indicadores/painel/agenda?mes=2026-10')->assertOk();
    trocarDeUsuario();
    $agendaDaAna = $this->actingAs($aPropriaAna)->getJson('/api/indicadores/painel/agenda?mes=2026-10')->assertOk();

    // ASSERT
    $linhaDaProdutividade = collect($produtividade->json('linhas'))->firstWhere('profissional.id', $ana->id);
    $linhaDaEquipe = collect($equipe->json('profissionais'))->firstWhere('id', $ana->id);
    $ultimoMes = $painel->json('serie.5');

    expect($painel->json('produtividade'))->toBe($linhaDaProdutividade)
        ->and($painel->json('equipe.profissionais'))->toBe([$linhaDaEquipe])
        ->and($painel->json('agenda'))->toBe($agendaDaAna->json())
        ->and([$ultimoMes['realizados'], $ultimoMes['faltas']])->toBe([$linhaDaProdutividade['realizados'], $linhaDaProdutividade['faltas']])
        // o recorte é de verdade: a clínica (Ana + Bia) tem mais realizadas que a Ana
        ->and($painel->json('agenda.realizadas.atual'))->toBe(3)
        ->and($agendaDaClinica->json('realizadas.atual'))->toBe(5);
});

// ─── A série de seis meses (task 2.3) ──────────────────────────────────────────────────────────

it('deve marcar sem dados os meses antes do início dos indicadores, e parcial o mês corrente', function () {
    // ARRANGE — a clínica tem agenda desde maio, mas os indicadores começam em 01/08/2026
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    sessaoDoPainelProf($ana, '2026-05-11 08:00', 'realizada');
    sessaoDoPainelProf($ana, '2026-06-15 08:00', 'falta');
    app(ConfiguracaoService::class)->set('indicadores.comparar_a_partir_de', '2026-08-01');
    $gestor = gestorDoPainelProf();

    // ACT
    $resposta = $this->actingAs($gestor)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT — o "Não Compareceu" desconta a sessão, mas conta como FALTA (a régua da produtividade)
    $resposta->assertOk();
    expect($resposta->json('serie'))->toBe([
        ['mes' => '2026-05', 'parcial' => false, 'sem_dados' => true, 'realizados' => null, 'faltas' => null],
        ['mes' => '2026-06', 'parcial' => false, 'sem_dados' => true, 'realizados' => null, 'faltas' => null],
        ['mes' => '2026-07', 'parcial' => false, 'sem_dados' => true, 'realizados' => null, 'faltas' => null],
        ['mes' => '2026-08', 'parcial' => false, 'sem_dados' => false, 'realizados' => 1, 'faltas' => 0],
        ['mes' => '2026-09', 'parcial' => false, 'sem_dados' => false, 'realizados' => 2, 'faltas' => 1],
        ['mes' => '2026-10', 'parcial' => true, 'sem_dados' => false, 'realizados' => 3, 'faltas' => 1],
    ]);
});

it('deve dar à série de um mês os mesmos realizados e faltas da produtividade daquele mês', function () {
    // ARRANGE — setembro fechado, pedido como mês do painel e lido na produtividade
    relogioDoPainelProf();
    $administradora = admin();
    ['ana' => $ana] = agendaDoPainelProf();

    // ACT
    $this->actingAs($administradora);
    $outubro = painelDoProf($ana->id)->assertOk();
    $setembro = collect($this->getJson('/api/indicadores/produtividade?mes=2026-09')->json('linhas'))->firstWhere('profissional.id', $ana->id);

    // ASSERT
    expect([$outubro->json('serie.4.realizados'), $outubro->json('serie.4.faltas')])
        ->toBe([$setembro['realizados'], $setembro['faltas']]);
});

it('deve dar ao mês corrente da série os mesmos realizados e faltas do cartão do mesmo quadro', function () {
    // ARRANGE — 10h de 15/10; a sessão das 16h JÁ finalizada pela recepção (baixa adiantada) não
    // "já passou": entrava na coluna de outubro e não no cartão (109 × 108 na integração)
    relogioDoPainelProf();
    $administradora = admin();
    ['ana' => $ana] = agendaDoPainelProf();
    sessaoDoPainelProf($ana, '2026-10-15 16:00', 'realizada');

    // ACT
    $this->actingAs($administradora);
    $resposta = painelDoProf($ana->id)->assertOk();

    // ASSERT — a última coluna (o mês corrente, parcial) diz o que o cartão diz
    expect($resposta->json('serie.5.parcial'))->toBeTrue()
        ->and($resposta->json('serie.5.realizados'))->toBe($resposta->json('agenda.realizadas.atual'))
        ->and($resposta->json('serie.5.faltas'))->toBe($resposta->json('agenda.faltas.atual.quantidade'));
});

it('não deve trazer o recebido na série a quem não vê o financeiro', function () {
    // ARRANGE
    relogioDoPainelProf();
    admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $gestor = gestorDoPainelProf();

    // ACT
    $resposta = $this->actingAs($gestor)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT
    $resposta->assertOk();
    expect(collect($resposta->json('serie'))->every(fn (array $mes): bool => ! array_key_exists('recebido', $mes)))->toBeTrue()
        ->and($resposta->json())->not->toHaveKey('financeiro');
});

// ─── Gate r1 ───────────────────────────────────────────────────────────────────────────────────

it('deve dar a mesma ocupação na ficha, na Equipe e na Agenda com sessão que não divide a grade', function () {
    // ARRANGE — B2: sessão de 50 min, grade 08–12 de segunda a sexta, 1–15/10 = 52,8 sessões de
    // capacidade. Arredondar por célula dava 54 (74%) na Agenda; arredondar o total, 53 (75%) na
    // Equipe. Uma régua só: 40 ÷ 52,8
    relogioDoPainelProf();
    $administradora = admin();
    $especialidade = Especialidade::factory()->create(['nome' => 'Psicomotricidade Fictícia', 'tempo_sessao' => 50]);
    $carla = Profissional::factory()->comHorarios(GRADE_DO_PAINEL_PROF)->create(['nome' => 'Carla Fictícia de 50 Minutos']);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $carla->id, 'especialidade_id' => $especialidade->id,
    ]);
    $crianca = Paciente::factory()->create();
    foreach (['01', '02', '05', '06', '07', '08', '09', '12', '13', '14'] as $dia) {
        foreach (['08:00', '08:50', '09:40', '10:30'] as $hora) {
            sessaoDoPainelProf($carla, "2026-10-{$dia} {$hora}", 'realizada', $crianca);
        }
    }
    $aPropriaCarla = usuarioEscopadoEm($carla);

    // ACT
    $this->actingAs($administradora);
    $painel = painelDoProf($carla->id)->assertOk();
    $daEquipe = collect($this->getJson('/api/indicadores/painel/equipe?mes=2026-10')->assertOk()->json('profissionais'))->firstWhere('id', $carla->id);
    trocarDeUsuario();
    $daAgenda = $this->actingAs($aPropriaCarla)->getJson('/api/indicadores/painel/agenda?mes=2026-10')->assertOk();

    // ASSERT
    expect([$painel->json('agenda.ocupacao.atual'), $painel->json('equipe.profissionais.0.ocupacao'), $daEquipe['ocupacao'], $daAgenda->json('ocupacao.atual')])
        ->toBe([0.7576, 0.7576, 0.7576, 0.7576]);
});

it('não deve contar a reserva como realizada na série nem na produtividade, como no cartão', function () {
    // ARRANGE — I1: um status de reserva que também desconta a sessão. A reserva NÃO é sessão
    // (`ClassificacaoDosStatus`): o cartão nunca a contou, e a série e a produtividade contavam
    relogioDoPainelProf();
    $administradora = admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $reserva = StatusAgendamento::query()->where('marca_reserva', true)->firstOrFail();
    $reserva->forceFill(['desconta_sessao' => true])->save();
    Agendamento::factory()->create([
        'profissional_id' => $ana->id,
        'especialidade_id' => DB::table('profissional_especialidade')->where('profissional_id', $ana->id)->value('especialidade_id'),
        'paciente_id' => Paciente::factory()->create()->id,
        'status_id' => $reserva->id,
        'inicio' => '2026-10-09 08:00',
        'fim' => '2026-10-09 08:40',
    ]);

    // ACT
    $resposta = $this->actingAs($administradora)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT — as três realizadas da Ana, nos três lugares; e a reserva continua SEGURANDO o horário na
    // produtividade (em aberto: as duas sessões abertas de outubro + a reserva), não vira hora ociosa
    $resposta->assertOk();
    expect([$resposta->json('agenda.realizadas.atual'), $resposta->json('serie.5.realizados'), $resposta->json('produtividade.realizados')])
        ->toBe([3, 3, 3])
        ->and($resposta->json('produtividade.em_aberto'))->toBe(3);
});

it('deve contar como liberada a reserva configurada para liberar o horário', function () {
    // ARRANGE — gate r2: o cadastro de status permite reserva com `ocupa_horario = false`. Ela devolve
    // o horário como qualquer status que libera: liberada, nunca marcada. Outubro da Ana: 1 desmarque
    // (liberado), 2 em aberto, 6 marcadas
    relogioDoPainelProf();
    $administradora = admin();
    ['ana' => $ana] = agendaDoPainelProf();
    $reserva = StatusAgendamento::query()->where('marca_reserva', true)->firstOrFail();
    $reserva->forceFill(['ocupa_horario' => false])->save();
    Agendamento::factory()->create([
        'profissional_id' => $ana->id,
        'especialidade_id' => DB::table('profissional_especialidade')->where('profissional_id', $ana->id)->value('especialidade_id'),
        'paciente_id' => Paciente::factory()->create()->id,
        'status_id' => $reserva->id,
        'inicio' => '2026-10-09 08:00',
        'fim' => '2026-10-09 08:40',
    ]);

    // ACT
    $resposta = $this->actingAs($administradora)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT — a reserva que libera soma ao desmarque; marcadas e em aberto não mudam
    $resposta->assertOk();
    expect([$resposta->json('produtividade.liberados'), $resposta->json('produtividade.em_aberto'), $resposta->json('produtividade.marcados')])
        ->toBe([2, 2, 6]);
});

it('deve limitar o painel a vinte pedidos por minuto por usuário', function () {
    // ARRANGE — SEC-PP-03: a leitura mais cara do produto tem balde próprio
    relogioDoPainelProf();
    admin();
    $ana = profissionalDoPainelProf('Ana Fictícia do Painel');
    $primeira = gestorDoPainelProf();
    $outra = gestorDoPainelProf(sem: ['tratamentos.ver']);

    // ACT
    $this->actingAs($primeira);
    $status = collect(range(1, 21))->map(fn (): int => painelDoProf($ana->id)->status())->all();
    trocarDeUsuario();
    $daOutra = $this->actingAs($outra)->getJson("/api/profissionais/{$ana->id}/painel?mes=2026-10");

    // ASSERT — o 21º do mesmo usuário cai; o balde é por usuário, e a outra segue
    expect(array_count_values($status))->toBe([200 => 20, 429 => 1])
        ->and($status[20])->toBe(429);
    $daOutra->assertOk();
});
