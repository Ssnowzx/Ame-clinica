<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/**
 * O escopo D11 nos painéis de indicadores (change indicadores-profissionais, rodada 1 do gate:
 * SEC-IND-02). Cada consulta de um painel é uma porta: a quebra por convênio, o total sem evolução
 * e os pacotes no fim são consultas SEPARADAS da base, e cada uma tem de aplicar o escopo de quem
 * pede — senão a escopada lê, por soma, a agenda da colega.
 *
 * Duas profissionais fictícias, cada uma com o próprio convênio, pacote no fim e atendimentos sem
 * evolução. Relógio FIXO: segunda, 5 de outubro de 2026, 10h na parede da clínica. Dados 100%
 * fictícios (LGPD).
 */
function relogioDoEscopoDoPainel(): void
{
    test()->travelTo(CarbonImmutable::parse('2026-10-05 10:00:00', 'America/Sao_Paulo'));
}

function statusDoEscopoDoPainel(string $papel): StatusAgendamento
{
    $flags = match ($papel) {
        'realizada' => ['desconta_sessao' => true, 'marca_falta' => false, 'ocupa_horario' => true, 'marca_reserva' => false],
        'falta' => ['marca_falta' => true],
        'desmarque' => ['ocupa_horario' => false, 'marca_falta' => false, 'desconta_sessao' => false],
    };

    return StatusAgendamento::query()->where($flags)->orderBy('ordem')->orderBy('id')->firstOrFail();
}

/** A profissional, a especialidade dela (40 min, grade na segunda) e o pacote no fim, no convênio dela. */
function profissionalDoEscopoDoPainel(string $nome, string $convenio): array
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->comHorarios([1 => [['inicio' => '08:00', 'fim' => '12:00']]])->create(['nome' => $nome]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);
    $pacote = Tratamento::factory()->create([
        'paciente_id' => Paciente::factory()->create()->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'convenio_id' => Convenio::create(['nome' => $convenio])->id,
        'sessoes_total' => 10,
        'sessoes_realizadas' => 9,
        'status' => 'andamento',
    ]);

    return ['profissional' => $profissional, 'pacote' => $pacote];
}

/** Uma sessão que já passou; com `$semEvolucao`, o atendimento registrado e a evolução por escrever. */
function sessaoDoEscopoDoPainel(array $dona, string $inicio, string $papel, bool $comPacote, bool $semEvolucao = false): void
{
    $comeco = Carbon::createFromFormat('Y-m-d H:i', $inicio);
    $sessao = Agendamento::factory()->create([
        'profissional_id' => $dona['profissional']->id,
        'especialidade_id' => $dona['pacote']->especialidade_id,
        'paciente_id' => $dona['pacote']->paciente_id,
        'tratamento_id' => $comPacote ? $dona['pacote']->id : null,
        'status_id' => statusDoEscopoDoPainel($papel)->id,
        'inicio' => $comeco->format('Y-m-d H:i'),
        'fim' => $comeco->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
    if ($semEvolucao) {
        Atendimento::factory()->create(['agendamento_id' => $sessao->id, 'finalizado_em' => $comeco->copy()->addMinutes(40)->format('Y-m-d H:i')]);
    }
}

/**
 * A clínica: a Uma com 2 sessões que passaram (1 no convênio dela) e 1 sem evolução; a Dois com 3
 * (2 no convênio dela) e 2 sem evolução.
 *
 * @return array{uma: array, dois: array}
 */
function clinicaDoEscopoDoPainel(): array
{
    $uma = profissionalDoEscopoDoPainel('Profissional Fictícia Uma do Escopo', 'Convênio Fictício da Uma');
    $dois = profissionalDoEscopoDoPainel('Profissional Fictícia Dois do Escopo', 'Convênio Fictício da Dois');
    sessaoDoEscopoDoPainel($uma, '2026-10-01 08:00', 'realizada', comPacote: true, semEvolucao: true);
    sessaoDoEscopoDoPainel($uma, '2026-10-02 09:00', 'falta', comPacote: false);
    sessaoDoEscopoDoPainel($dois, '2026-10-01 08:00', 'realizada', comPacote: true, semEvolucao: true);
    sessaoDoEscopoDoPainel($dois, '2026-10-02 08:00', 'realizada', comPacote: true, semEvolucao: true);
    sessaoDoEscopoDoPainel($dois, '2026-10-01 09:00', 'desmarque', comPacote: false);

    return ['uma' => $uma, 'dois' => $dois];
}

function painelDoEscopo(Usuario $quem, string $frente): TestResponse
{
    trocarDeUsuario();

    return test()->actingAs($quem)->getJson("/api/indicadores/painel/{$frente}?mes=2026-10")->assertOk();
}

it('deve fechar na escopada a quebra por convênio, a situação e o sem evolução na agenda DELA', function () {
    // ARRANGE — a Uma, escopada nos dois eixos, com as permissões de todos os painéis e do sino
    relogioDoEscopoDoPainel();
    admin();
    $clinica = clinicaDoEscopoDoPainel();
    $escopada = usuarioEscopadoEm($clinica['uma']['profissional'], ['atendimentos.ver', 'evolucoes.ver', 'pacientes.ver', 'tratamentos.ver']);

    // ACT
    $agenda = painelDoEscopo($escopada, 'agenda');
    $equipe = painelDoEscopo($escopada, 'equipe');
    $pacientes = painelDoEscopo($escopada, 'pacientes');
    $sino = $this->actingAs($escopada)->getJson('/api/notificacoes')->assertOk();

    // ASSERT — a quebra por convênio é OUTRA consulta: soma o mesmo que a base dela, e o convênio da
    // colega não aparece; o sem evolução é o dela, o mesmo do sino dela; o pacote no fim, o dela
    expect($agenda->json('sessoes_passadas.atual'))->toBe(2)
        ->and(array_sum(array_column($agenda->json('por_convenio'), 'sessoes')))->toBe(2)
        ->and(array_sum(array_column($agenda->json('situacao'), 'quantidade')))->toBe(2)
        ->and(array_column($agenda->json('por_convenio'), 'nome'))->not->toContain('Convênio Fictício da Dois')
        ->and($equipe->json('evolucoes.sem_evolucao'))->toBe(1)
        ->and($sino->json('evolucoes_em_aberto.total'))->toBe(1)
        ->and($pacientes->json('pacotes_no_fim'))->toBe(1);
    semVazamento($equipe->json(), 'Dois do Escopo');
});

it('deve dar à agenda plana e clínico escopado a própria linha na equipe, e as duas na agenda', function () {
    // ARRANGE — `agenda.ver_todos` sem `clinico.ver_todos`, vinculada à Uma
    relogioDoEscopoDoPainel();
    admin();
    $clinica = clinicaDoEscopoDoPainel();
    $mista = usuarioCom(['agenda.ver', 'atendimentos.ver', 'pacientes.ver', 'agenda.ver_todos'], 'Mista Agenda Plana do Escopo');
    $mista->update(['profissional_id' => $clinica['uma']['profissional']->id]);

    // ACT
    $equipe = painelDoEscopo($mista, 'equipe');
    $agenda = painelDoEscopo($mista, 'agenda');

    // ASSERT — a equipe mistura dado clínico: vale a INTERSEÇÃO dos eixos
    expect(array_column($equipe->json('profissionais'), 'id'))->toBe([$clinica['uma']['profissional']->id])
        ->and($agenda->json('ocupacao.profissionais'))->toBe(2)
        ->and($agenda->json('sessoes_passadas.atual'))->toBe(5);
});

it('deve dar ao clínico plano sem vínculo a equipe vazia, com o sem evolução do sino dele', function () {
    // ARRANGE — `clinico.ver_todos`, sem `agenda.ver_todos` e sem vínculo: a agenda é fail-closed
    relogioDoEscopoDoPainel();
    admin();
    clinicaDoEscopoDoPainel();
    $mista = usuarioCom(['agenda.ver', 'atendimentos.ver', 'evolucoes.ver', 'clinico.ver_todos'], 'Mista Clínico Plano do Escopo');

    // ACT
    $equipe = painelDoEscopo($mista, 'equipe');
    $agenda = painelDoEscopo($mista, 'agenda');
    $sino = $this->actingAs($mista)->getJson('/api/notificacoes')->assertOk();

    // ASSERT — linhas e taxas na interseção (nenhuma); o sem evolução é o número do sino, no eixo
    // clínico (CR-IND-04 — o "i" diz "a mesma conta do aviso")
    expect($equipe->json('profissionais'))->toBe([])
        ->and($equipe->json('evolucoes.em_dia.atual'))->toBeNull()
        ->and($equipe->json('evolucoes.atrasadas'))->toBe(0)
        ->and($equipe->json('evolucoes.sem_evolucao'))->toBe($sino->json('evolucoes_em_aberto.total'))
        ->and($equipe->json('evolucoes.sem_evolucao'))->toBe(3)
        ->and($agenda->json('sessoes_passadas.atual'))->toBe(0);
});

it('deve entregar vazio, e nunca a clínica, a quem não tem a flag nem o vínculo', function () {
    // ARRANGE — todas as permissões de leitura, nenhuma flag `ver_todos`, nenhum vínculo
    relogioDoEscopoDoPainel();
    admin();
    clinicaDoEscopoDoPainel();
    $semVinculo = usuarioCom(['agenda.ver', 'atendimentos.ver', 'pacientes.ver', 'tratamentos.ver'], 'Sem Vínculo do Escopo');

    // ACT
    $agenda = painelDoEscopo($semVinculo, 'agenda');
    $equipe = painelDoEscopo($semVinculo, 'equipe');
    $pacientes = painelDoEscopo($semVinculo, 'pacientes');

    // ASSERT — fail-closed em cada consulta, inclusive nas separadas
    expect($agenda->json('sessoes_passadas.atual'))->toBe(0)
        ->and($agenda->json('realizadas.atual'))->toBe(0)
        ->and($agenda->json('ocupacao.atual'))->toBeNull()
        ->and($agenda->json('confirmadas.atual.enviados'))->toBe(0)
        ->and($agenda->json('por_convenio'))->toBe([])
        ->and($agenda->json('situacao'))->toBe([])
        ->and($agenda->json('faltas_por_dia_semana'))->toBe([])
        ->and($agenda->json('ocupacao_por_periodo'))->toBe([])
        ->and($equipe->json('profissionais'))->toBe([])
        ->and($equipe->json('evolucoes.sem_evolucao'))->toBe(0)
        ->and($equipe->json('evolucoes.atrasadas'))->toBe(0)
        ->and($pacientes->json('pacotes_no_fim'))->toBe(0);
});
