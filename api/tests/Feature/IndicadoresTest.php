<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Conta;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Indicadores do dashboard (§11) — vistas agregadas por MÊS, cada uma sob a
 * permissão do módulo DONO (T-not-13, sem guarda-chuva), com escopo D11 nos
 * eixos agenda/clínico. LGPD: dados 100% fictícios; agregados nunca expõem
 * nome de paciente.
 */

/** Agendamento de atendimento ancorado no dia 10 do mês corrente (parede da clínica). */
function agendamentoDosIndicadores(array $atributos = []): Agendamento
{
    $inicio = agoraNaClinica()->startOfMonth()->addDays(9)->setTime(9, 0);

    return Agendamento::factory()->create($atributos + [
        'inicio' => $inicio->format('Y-m-d H:i'),
        'fim' => $inicio->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
}

/** Atendimento FINALIZADO no dia 10 do mês corrente, do agendamento dado. */
function atendimentoDosIndicadores(Agendamento $agendamento): Atendimento
{
    return Atendimento::factory()->create([
        'agendamento_id' => $agendamento->id,
        'finalizado_em' => agoraNaClinica()->startOfMonth()->addDays(9)->setTime(10, 0)->format('Y-m-d H:i'),
    ]);
}

it('deve escopar a vista do clínico ao próprio profissional (D11)', function () {
    // ARRANGE — movimento dos profissionais A e B no mês; usuário escopado a A
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $agendamentoDeA = agendamentoDosIndicadores(['profissional_id' => $profA->id]);
    $agendamentoDeB = agendamentoDosIndicadores(['profissional_id' => $profB->id]);
    atendimentoDosIndicadores($agendamentoDeA);
    atendimentoDosIndicadores($agendamentoDeB);
    $escopado = usuarioCom(['agenda.ver', 'atendimentos.ver'], 'Escopado dos Indicadores');
    $escopado->update(['profissional_id' => $profA->id]);
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $atendimentos = $this->actingAs($escopado)->getJson("/api/indicadores/atendimentos?mes={$mes}");

    // ASSERT — só o movimento do PRÓPRIO profissional entra na contagem
    $atendimentos->assertOk()->assertJsonPath('total', 1);
});

it('deve zerar a vista escopada para papel sem flag e usuário SEM vínculo (fail-closed)', function () {
    // ARRANGE — movimento real na clínica; papel novo SEM ver_todos; usuário SEM profissional:
    // o estado `nenhum` degrada para agregados ZERADOS, nunca para "plano" (SEC-VP-02)
    $this->actingAs(admin());
    $agendamento = agendamentoDosIndicadores();
    atendimentoDosIndicadores($agendamento);
    $semVinculo = usuarioCom(['agenda.ver', 'atendimentos.ver'], 'Sem Vínculo dos Indicadores');
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $atendimentos = $this->actingAs($semVinculo)->getJson("/api/indicadores/atendimentos?mes={$mes}");

    // ASSERT — fail-closed na vista escopada
    $atendimentos->assertOk()->assertJsonPath('total', 0);
});

it('deve consolidar os atendimentos do mês com quebras por especialidade e convênio', function () {
    // ARRANGE — finalizados no mês: 1 com convênio (esp. A) + 1 avulso sem convênio
    // (esp. B); 1 finalizado no mês ANTERIOR fica fora (`finalizado_em` é NOT NULL —
    // atendimento "em aberto" não existe como linha; a fronteira é o MÊS)
    $this->actingAs(admin());
    $especialidadeA = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $especialidadeB = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $tratamento = Tratamento::factory()->create();
    $comConvenio = agendamentoDosIndicadores(['especialidade_id' => $especialidadeA->id, 'tratamento_id' => $tratamento->id]);
    $semConvenio = agendamentoDosIndicadores(['especialidade_id' => $especialidadeB->id]);
    $segundoSemConvenio = agendamentoDosIndicadores(['especialidade_id' => $especialidadeB->id]);
    $deOutroMes = agendamentoDosIndicadores(['especialidade_id' => $especialidadeB->id]);
    atendimentoDosIndicadores($comConvenio);
    atendimentoDosIndicadores($semConvenio);
    atendimentoDosIndicadores($segundoSemConvenio);
    Atendimento::factory()->create([
        'agendamento_id' => $deOutroMes->id,
        'finalizado_em' => agoraNaClinica()->startOfMonth()->subMonth()->addDays(9)->setTime(11, 0)->format('Y-m-d H:i'),
    ]);
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $vista = $this->getJson("/api/indicadores/atendimentos?mes={$mes}");

    // ASSERT — total = soma das quebras; sem convênio é linha própria; quebras em
    // ordem de RELEVÂNCIA (total desc — em escala, nome afunda o que importa)
    $vista->assertOk()->assertJsonPath('total', 3);
    $porEspecialidade = collect($vista->json('por_especialidade'));
    expect($porEspecialidade->first()['especialidade']['id'])->toBe($especialidadeB->id)
        ->and($porEspecialidade->first()['total'])->toBe(2)
        ->and($porEspecialidade->last()['total'])->toBe(1);
    $porConvenio = collect($vista->json('por_convenio'));
    expect($porConvenio->first()['convenio'])->toBeNull()
        ->and($porConvenio->first()['total'])->toBe(2)
        ->and($porConvenio->firstWhere('convenio.id', $tratamento->convenio_id)['total'])->toBe(1)
        ->and(json_encode($vista->json()))->not->toContain('paciente');
});

it('deve contar pacientes ativos e novos no mês sem expor cadastro', function () {
    // ARRANGE — 1 antigo ativo, 1 novo ativo, 1 novo inativo
    $this->actingAs(admin());
    $antigo = Paciente::factory()->create(['nome' => 'Paciente Antigo Fictício']);
    DB::table('pacientes')->where('id', $antigo->id)->update([
        // `subMonthsNoOverflow`, NÃO `subMonths`: nos dias 29–31 o Carbon transborda para o mês
        // seguinte (31/08 - 2 meses = 01/07), e a série esperada usa `startOfMonth()->subMonths()`.
        // A suíte ficava vermelha três dias por mês, sempre por este teste — diagnóstico da
        // rodada 3 do gate. Não tem relação com a change que o achou.
        'created_at' => agoraNaClinica()->subMonthsNoOverflow(2)->format('Y-m-d H:i:s'),
    ]);
    Paciente::factory()->create(['nome' => 'Paciente Novo Fictício']);
    Paciente::factory()->create(['nome' => 'Paciente Inativo Fictício', 'ativo' => false]);
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $vista = $this->getJson("/api/indicadores/pacientes?mes={$mes}");

    // ASSERT — as contagens + a série de novos (sem buracos); nenhum nome de
    // paciente e SÓ as chaves agregadas do contrato (nunca campo de cadastro)
    $serieEsperada = collect(range(5, 0))->map(fn (int $i): array => [
        'mes' => agoraNaClinica()->startOfMonth()->subMonths($i)->format('Y-m'),
        'total' => match ($i) {
            2 => 1, 0 => 2, default => 0
        },
    ])->values()->all();
    $vista->assertOk()
        ->assertJsonPath('mes', $mes)
        ->assertJsonPath('ativos', 2)
        ->assertJsonPath('novos_no_mes', 2)
        ->assertJsonPath('serie', $serieEsperada);
    semVazamento($vista->json(), 'Paciente Antigo Fictício');
    semVazamento($vista->json(), 'Paciente Novo Fictício');
    expect(array_keys($vista->json()))->toBe([
        'mes', 'ativos', 'novos_no_mes', 'serie', 'por_sexo', 'por_faixa_etaria', 'por_indicacao', 'por_convenio',
    ]);
});

it('deve quebrar a base ATIVA por sexo e por faixa etária (soma = ativos, bandas fixas)', function () {
    // ARRANGE — idades ancoradas na parede da clínica: 4 e 7 anos (fem), 20 (masc,
    // adulto), 1 inativo (fora); boundary: nascido HÁ EXATOS 3 anos = banda 3-5, e
    // 1 dia a menos = banda 0-2
    $this->actingAs(admin());
    $nascimentoDe4 = agoraNaClinica()->subYears(4)->format('Y-m-d');
    Paciente::factory()->create(['sexo' => 'feminino', 'nascimento' => $nascimentoDe4]);
    Paciente::factory()->create(['sexo' => 'feminino', 'nascimento' => agoraNaClinica()->subYears(7)->format('Y-m-d')]);
    Paciente::factory()->create(['sexo' => 'masculino', 'nascimento' => agoraNaClinica()->subYears(20)->format('Y-m-d')]);
    Paciente::factory()->create(['sexo' => 'feminino', 'nascimento' => agoraNaClinica()->subYears(3)->format('Y-m-d')]);
    Paciente::factory()->create(['sexo' => 'feminino', 'nascimento' => agoraNaClinica()->subYears(3)->addDay()->format('Y-m-d')]);
    Paciente::factory()->create(['ativo' => false, 'sexo' => 'masculino', 'nascimento' => agoraNaClinica()->subYears(5)->format('Y-m-d')]);
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $vista = $this->getJson("/api/indicadores/pacientes?mes={$mes}");

    // ASSERT — 5 ativos; sexo soma 5 (fem 4 desc primeiro, masc 1); inativo fora
    $vista->assertOk()->assertJsonPath('ativos', 5);
    $porSexo = collect($vista->json('por_sexo'));
    expect($porSexo->firstWhere('sexo', 'feminino')['total'])->toBe(4)
        ->and($porSexo->firstWhere('sexo', 'masculino')['total'])->toBe(1)
        ->and($porSexo->first()['sexo'])->toBe('feminino')
        ->and($porSexo->sum('total'))->toBe(5);

    // faixa: 7 bandas em ordem, soma 5; 0-2=1, 3-5=2 (o de 4a + o de EXATOS 3a), 6-8=1, 18+=1
    $porFaixa = collect($vista->json('por_faixa_etaria'));
    expect($porFaixa->pluck('faixa')->all())->toBe(['0-2', '3-5', '6-8', '9-11', '12-14', '15-17', '18+'])
        ->and($porFaixa->sum('total'))->toBe(5)
        ->and($porFaixa->firstWhere('faixa', '0-2')['total'])->toBe(1)
        ->and($porFaixa->firstWhere('faixa', '3-5')['total'])->toBe(2)
        ->and($porFaixa->firstWhere('faixa', '6-8')['total'])->toBe(1)
        ->and($porFaixa->firstWhere('faixa', '18+')['total'])->toBe(1)
        ->and($porFaixa->firstWhere('faixa', '9-11')['total'])->toBe(0);

    // a data de nascimento é lida só para derivar a banda — NUNCA sai na resposta (minimização)
    semVazamento($vista->json(), $nascimentoDe4);
});

it('deve quebrar por indicação em total e mensal, com "não informado" (null)', function () {
    // ARRANGE — base ATIVA: 2 Google + 1 Indicação médica (antigos) + 1 sem indicação;
    // o NOVO do mês (Indicação médica) entra no mensal e no total
    $this->actingAs(admin());
    $antigos = Paciente::factory()->count(2)->create(['indicacao' => 'Google Fictício']);
    $antigos->push(Paciente::factory()->create(['indicacao' => 'Indicação Médica Fictícia']));
    $antigos->push(Paciente::factory()->create(['indicacao' => null]));
    DB::table('pacientes')->whereIn('id', $antigos->pluck('id'))->update([
        // `subMonthsNoOverflow`, NÃO `subMonths`: nos dias 29–31 o Carbon transborda para o mês
        // seguinte (31/08 - 2 meses = 01/07), e a série esperada usa `startOfMonth()->subMonths()`.
        // A suíte ficava vermelha três dias por mês, sempre por este teste — diagnóstico da
        // rodada 3 do gate. Não tem relação com a change que o achou.
        'created_at' => agoraNaClinica()->subMonthsNoOverflow(2)->format('Y-m-d H:i:s'),
    ]);
    Paciente::factory()->create(['indicacao' => 'Indicação Médica Fictícia']); // novo no mês
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $vista = $this->getJson("/api/indicadores/pacientes?mes={$mes}");

    // ASSERT — total soma ativos (5); Google 2, Indicação médica 2, null 1
    $vista->assertOk()->assertJsonPath('ativos', 5)->assertJsonPath('novos_no_mes', 1);
    $total = collect($vista->json('por_indicacao.total'));
    expect($total->sum('total'))->toBe(5)
        ->and($total->firstWhere('indicacao', 'Google Fictício')['total'])->toBe(2)
        ->and($total->firstWhere('indicacao', 'Indicação Médica Fictícia')['total'])->toBe(2)
        ->and($total->firstWhere('indicacao', null)['total'])->toBe(1);

    // mensal soma novos_no_mes (1): só o novo, por Indicação médica
    $mensal = collect($vista->json('por_indicacao.mensal'));
    expect($mensal->sum('total'))->toBe(1)
        ->and($mensal->firstWhere('indicacao', 'Indicação Médica Fictícia')['total'])->toBe(1);
});

it('não deve contar como novo do mês o paciente que veio da importação da virada', function () {
    // ARRANGE — 1 cadastrado de verdade no mês + 2 importados no mesmo mês (já eram da clínica). O
    // cartão Novos do painel não conta importados; a quebra "Por indicação (novos no mês)" contava, e a
    // aba Pacientes mostrava 38 novos ao lado de 278 "novos" por indicação (validação local de 05/10)
    $this->actingAs(admin());
    Paciente::factory()->create(['indicacao' => 'Indicação Médica Fictícia']);
    Paciente::factory()->count(2)->create(['indicacao' => 'Google Fictício', 'importado_clinicaagil_em' => now()]);
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $vista = $this->getJson("/api/indicadores/pacientes?mes={$mes}");

    // ASSERT — novos, série e indicação mensal dizem o mesmo número; o total (base ativa) inclui todos
    $vista->assertOk()->assertJsonPath('novos_no_mes', 1);
    expect(collect($vista->json('serie'))->last()['total'])->toBe(1)
        ->and(collect($vista->json('por_indicacao.mensal'))->sum('total'))->toBe(1)
        ->and(collect($vista->json('por_indicacao.mensal'))->firstWhere('indicacao', 'Google Fictício'))->toBeNull()
        ->and(collect($vista->json('por_indicacao.total'))->sum('total'))->toBe(3);
});

it('deve pôr no mês da clínica o cadastro das 22h do último dia, que no UTC já é o mês seguinte', function () {
    // ARRANGE — 30/09 22:00 em Brasília é 1/10 01:00 UTC (`created_at` grava UTC). Relógio fixo em 5/10:
    // a mesma regra do painel (PainelDosPacientes::emUtc), CR-IND-05
    $this->travelTo(CarbonImmutable::parse('2026-10-05 10:00:00', 'America/Sao_Paulo'));
    $this->actingAs(admin());
    Paciente::factory()->create([
        'indicacao' => 'Indicação Fictícia da Virada do Mês',
        'created_at' => '2026-10-01 01:00:00',
        'updated_at' => '2026-10-01 01:00:00',
    ]);

    // ACT
    $setembro = $this->getJson('/api/indicadores/pacientes?mes=2026-09')->assertOk();
    $outubro = $this->getJson('/api/indicadores/pacientes?mes=2026-10')->assertOk();

    // ASSERT — novos, série e indicação mensal: setembro, nunca outubro
    expect($setembro->json('novos_no_mes'))->toBe(1)
        ->and(collect($setembro->json('serie'))->firstWhere('mes', '2026-09')['total'])->toBe(1)
        ->and(collect($setembro->json('por_indicacao.mensal'))->sum('total'))->toBe(1)
        ->and($outubro->json('novos_no_mes'))->toBe(0)
        ->and(collect($outubro->json('serie'))->firstWhere('mes', '2026-09')['total'])->toBe(1)
        ->and(collect($outubro->json('serie'))->firstWhere('mes', '2026-10')['total'])->toBe(0)
        ->and(collect($outubro->json('por_indicacao.mensal'))->sum('total'))->toBe(0);
});

it('deve contar pacientes por convênio contando quem tem vários convênios em cada um', function () {
    // ARRANGE — P1: tratamentos em A, B e C (1 paciente, 3 linhas) · P2: só A ·
    // P4: ATIVO sem tratamento. ativos = 3, mas a soma das linhas = 4 (P1 conta em
    // três) — NÃO particiona; P4 não aparece em linha nenhuma
    $this->actingAs(admin());
    $convenioA = Convenio::create(['nome' => 'Convênio A Fictício']);
    $convenioB = Convenio::create(['nome' => 'Convênio B Fictício']);
    $convenioC = Convenio::create(['nome' => 'Convênio C Fictício']);
    $p1 = Paciente::factory()->create();
    $p2 = Paciente::factory()->create();
    Tratamento::factory()->create(['paciente_id' => $p1->id, 'convenio_id' => $convenioA->id]);
    Tratamento::factory()->create(['paciente_id' => $p1->id, 'convenio_id' => $convenioB->id]);
    Tratamento::factory()->create(['paciente_id' => $p1->id, 'convenio_id' => $convenioC->id]);
    Tratamento::factory()->create(['paciente_id' => $p2->id, 'convenio_id' => $convenioA->id]);
    Paciente::factory()->create(); // P4: ativo SEM tratamento — não aparece em linha nenhuma
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $vista = $this->getJson("/api/indicadores/pacientes?mes={$mes}");

    // ASSERT — 3 ativos; A=2 (P1,P2), B=1 (P1), C=1 (P1); soma 4 > ativos 3 (não particiona)
    $vista->assertOk()->assertJsonPath('ativos', 3);
    $porConvenio = collect($vista->json('por_convenio'));
    expect($porConvenio->firstWhere('convenio.id', $convenioA->id)['total'])->toBe(2)
        ->and($porConvenio->firstWhere('convenio.id', $convenioB->id)['total'])->toBe(1)
        ->and($porConvenio->firstWhere('convenio.id', $convenioC->id)['total'])->toBe(1)
        ->and($porConvenio->first()['convenio']['id'])->toBe($convenioA->id) // relevância desc
        ->and($porConvenio->first()['convenio']['nome'])->toBe('Convênio A Fictício')
        ->and($porConvenio->sum('total'))->toBe(4); // P1 conta em A, B e C — soma não particiona
});

it('deve exigir a permissão do módulo dono em cada vista e validar o mês', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $mes = agoraNaClinica()->format('Y-m');
    $semPermissao = usuarioCom([], 'Sem Nada dos Indicadores');

    // ACT + ASSERT — 403 nas duas vistas para quem não tem o módulo dono
    $this->actingAs($semPermissao);
    foreach (['atendimentos', 'pacientes'] as $vista) {
        $this->getJson("/api/indicadores/{$vista}?mes={$mes}")->assertForbidden();
    }

    // mês ausente ou inválido → 422 (com a permissão do dono)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica);
    $this->getJson('/api/indicadores/atendimentos')->assertUnprocessable();
    $this->getJson('/api/indicadores/atendimentos?mes=2026-13')->assertUnprocessable();
});

it('não deve mais responder as vistas antigas da agenda e do financeiro', function () {
    // ARRANGE — sem consumidor desde os painéis (IND-VISTAS-ORFAS): saíram em inicio-dos-indicadores
    $this->actingAs(admin());
    $mes = agoraNaClinica()->format('Y-m');

    // ACT + ASSERT — 404, e as rotas vizinhas que a tela usa continuam de pé
    $this->getJson("/api/indicadores/agenda?mes={$mes}")->assertNotFound();
    $this->getJson("/api/indicadores/financeiro?mes={$mes}")->assertNotFound();
    $this->getJson("/api/indicadores/financeiro/graficos?mes={$mes}")->assertOk();
    $this->getJson("/api/indicadores/painel/agenda?mes={$mes}")->assertOk();
});

it('deve listar os itens do status no mês com contexto, whitelist e sem bloqueios', function () {
    // ARRANGE — 2 do primeiro status (horários distintos) + 1 do segundo + 1 bloqueio
    // + 1 fora do mês; obs sigilosa que NÃO pode sair na lista
    $this->actingAs(admin());
    $primeiroStatus = StatusAgendamento::orderBy('ordem')->firstOrFail();
    $segundoStatus = StatusAgendamento::orderBy('ordem')->skip(1)->firstOrFail();
    $cedo = agendamentoDosIndicadores(['status_id' => $primeiroStatus->id, 'obs' => 'Observação Sigilosa do Menor']);
    $tardeInicio = agoraNaClinica()->startOfMonth()->addDays(9)->setTime(15, 0);
    $tarde = agendamentoDosIndicadores([
        'status_id' => $primeiroStatus->id,
        'inicio' => $tardeInicio->format('Y-m-d H:i'),
        'fim' => $tardeInicio->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
    agendamentoDosIndicadores(['status_id' => $segundoStatus->id]);
    agendamentoDosIndicadores(['tipo' => 'bloqueio', 'paciente_id' => null, 'status_id' => null]);
    $mesPassado = agoraNaClinica()->startOfMonth()->subMonth()->addDays(9)->setTime(9, 0);
    agendamentoDosIndicadores([
        'status_id' => $primeiroStatus->id,
        'inicio' => $mesPassado->format('Y-m-d H:i'),
        'fim' => $mesPassado->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $lista = $this->getJson("/api/indicadores/agenda/itens?mes={$mes}&status_id={$primeiroStatus->id}");

    // ASSERT — contexto com o rótulo do CADASTRO; itens desc por início; whitelist exata
    $lista->assertOk()
        ->assertJsonPath('contexto.rotulo', $primeiroStatus->nome)
        ->assertJsonPath('contexto.total', 2)
        ->assertJsonPath('per_page', 50)
        ->assertJsonPath('current_page', 1);
    $itens = collect($lista->json('data'));
    expect($itens)->toHaveCount(2)
        ->and($itens->first()['id'])->toBe($tarde->id)
        ->and($itens->last()['id'])->toBe($cedo->id)
        ->and(array_keys($itens->first()))->toBe(['id', 'inicio', 'paciente', 'profissional'])
        ->and(array_keys($itens->first()['paciente']))->toBe(['id', 'nome'])
        ->and($itens->first()['paciente']['nome'])->not->toBeNull();
    semVazamento($lista->json(), 'Observação Sigilosa do Menor');

    // página além do fim: vazia, nunca erro
    $alem = $this->getJson("/api/indicadores/agenda/itens?mes={$mes}&status_id={$primeiroStatus->id}&page=2");
    $alem->assertOk()->assertJsonPath('current_page', 2);
    expect($alem->json('data'))->toBeArray()->toBeEmpty();
});

it('deve escopar os itens da agenda ao próprio profissional (D11)', function () {
    // ARRANGE — agendamentos de A e de B no mesmo status; usuário escopado a A
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $status = StatusAgendamento::orderBy('ordem')->firstOrFail();
    $deA = agendamentoDosIndicadores(['profissional_id' => $profA->id, 'status_id' => $status->id]);
    agendamentoDosIndicadores(['profissional_id' => $profB->id, 'status_id' => $status->id]);
    $escopado = usuarioCom(['agenda.ver'], 'Escopado dos Itens da Agenda');
    $escopado->update(['profissional_id' => $profA->id]);
    $mes = agoraNaClinica()->format('Y-m');

    // ACT
    $lista = $this->actingAs($escopado)->getJson("/api/indicadores/agenda/itens?mes={$mes}&status_id={$status->id}");

    // ASSERT — só o item do PRÓPRIO profissional, e o contexto conta como a caixa
    $lista->assertOk()->assertJsonPath('contexto.total', 1);
    expect(collect($lista->json('data'))->pluck('id')->all())->toBe([$deA->id]);
});

it('deve recusar itens da agenda sem permissão, sem mês/status ou com status inexistente', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $status = StatusAgendamento::orderBy('ordem')->firstOrFail();
    $mes = agoraNaClinica()->format('Y-m');

    // ACT + ASSERT — 403 sem o módulo dono
    $semPermissao = usuarioCom([], 'Sem Nada dos Itens');
    $this->actingAs($semPermissao)
        ->getJson("/api/indicadores/agenda/itens?mes={$mes}&status_id={$status->id}")
        ->assertForbidden();

    // 422 sem mês ou sem status; 404 para status inexistente (âncora)
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica);
    $this->getJson("/api/indicadores/agenda/itens?status_id={$status->id}")->assertUnprocessable();
    $this->getJson("/api/indicadores/agenda/itens?mes={$mes}")->assertUnprocessable();
    $this->getJson("/api/indicadores/agenda/itens?mes={$mes}&status_id=99999999")->assertNotFound();
});

it('deve listar os atendimentos por dimensão, com o combo da clínica e o mês puro', function () {
    // ARRANGE — A/E1+convênio · A/E2 sem convênio · B/E1; observação clínica sigilosa
    $this->actingAs(admin());
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $especialidade1 = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $especialidade2 = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $tratamento = Tratamento::factory()->create();
    $deAComConvenio = agendamentoDosIndicadores([
        'profissional_id' => $profA->id,
        'especialidade_id' => $especialidade1->id,
        'tratamento_id' => $tratamento->id,
    ]);
    $deASemConvenio = agendamentoDosIndicadores([
        'profissional_id' => $profA->id,
        'especialidade_id' => $especialidade2->id,
    ]);
    $deB = agendamentoDosIndicadores([
        'profissional_id' => $profB->id,
        'especialidade_id' => $especialidade1->id,
    ]);
    atendimentoDosIndicadores($deAComConvenio);
    Atendimento::factory()->create([
        'agendamento_id' => $deASemConvenio->id,
        'finalizado_em' => agoraNaClinica()->startOfMonth()->addDays(9)->setTime(11, 0)->format('Y-m-d H:i'),
        'observacoes' => 'Observação Clínica Sigilosa',
    ]);
    atendimentoDosIndicadores($deB);
    $mes = agoraNaClinica()->format('Y-m');

    // ACT + ASSERT — por profissional: os 2 de A, contexto nomeando A
    $porProfissional = $this->getJson("/api/indicadores/atendimentos/itens?mes={$mes}&profissional_id={$profA->id}");
    $porProfissional->assertOk()
        ->assertJsonPath('contexto.rotulo', $profA->nome)
        ->assertJsonPath('contexto.total', 2);
    $itensDeA = collect($porProfissional->json('data'));
    expect(array_keys($itensDeA->first()))->toBe(['id', 'finalizado_em', 'paciente', 'profissional', 'especialidade', 'convenio'])
        ->and($itensDeA->firstWhere('especialidade.id', $especialidade2->id)['convenio'])->toBeNull()
        ->and($itensDeA->firstWhere('especialidade.id', $especialidade1->id)['convenio']['id'])->toBe($tratamento->convenio_id);
    semVazamento($porProfissional->json(), 'Observação Clínica Sigilosa');

    // combo profissional × especialidade (pedido da clínica): refina para 1
    $combo = $this->getJson("/api/indicadores/atendimentos/itens?mes={$mes}&profissional_id={$profA->id}&especialidade_id={$especialidade1->id}");
    $combo->assertOk()->assertJsonPath('contexto.total', 1);
    expect($combo->json('contexto.rotulo'))->toContain($profA->nome)
        ->and($combo->json('contexto.rotulo'))->toContain($especialidade1->nome);

    // por especialidade e por convênio
    $this->getJson("/api/indicadores/atendimentos/itens?mes={$mes}&especialidade_id={$especialidade1->id}")
        ->assertOk()->assertJsonPath('contexto.total', 2);
    $this->getJson("/api/indicadores/atendimentos/itens?mes={$mes}&convenio_id={$tratamento->convenio_id}")
        ->assertOk()->assertJsonPath('contexto.total', 1);

    // mês puro: a porta do TOTAL — todos os finalizados
    $total = $this->getJson("/api/indicadores/atendimentos/itens?mes={$mes}");
    $total->assertOk()
        ->assertJsonPath('contexto.rotulo', 'Atendimentos finalizados')
        ->assertJsonPath('contexto.total', 3);
});

it('deve recusar duas dimensões base nos itens de atendimentos', function () {
    // ARRANGE — TODOS os usuários nascem antes do 1º request (o guard troca depois dele)
    $adminDaClinica = admin();
    $semPermissao = usuarioCom([], 'Sem Nada dos Itens de Atendimento');
    $profissional = Profissional::factory()->create();
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $tratamento = Tratamento::factory()->create();
    $mes = agoraNaClinica()->format('Y-m');

    // ACT + ASSERT — pares proibidos (o combo profissional×especialidade é a única exceção)
    $this->actingAs($adminDaClinica);
    $this->getJson("/api/indicadores/atendimentos/itens?mes={$mes}&profissional_id={$profissional->id}&convenio_id={$tratamento->convenio_id}")
        ->assertUnprocessable();
    $this->getJson("/api/indicadores/atendimentos/itens?mes={$mes}&especialidade_id={$especialidade->id}&convenio_id={$tratamento->convenio_id}")
        ->assertUnprocessable();
    $this->getJson("/api/indicadores/atendimentos/itens?mes={$mes}&profissional_id={$profissional->id}&especialidade_id={$especialidade->id}&convenio_id={$tratamento->convenio_id}")
        ->assertUnprocessable();

    // 403 sem o módulo dono
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semPermissao)
        ->getJson("/api/indicadores/atendimentos/itens?mes={$mes}")
        ->assertForbidden();
});

it('deve escopar os itens de atendimentos (D11)', function () {
    // ARRANGE — A1/A2 com movimento e usuário escopado em A1
    admin();
    $profA1 = Profissional::factory()->create();
    $profA2 = Profissional::factory()->create();
    $deA1 = agendamentoDosIndicadores(['profissional_id' => $profA1->id]);
    $deA2 = agendamentoDosIndicadores(['profissional_id' => $profA2->id]);
    atendimentoDosIndicadores($deA1);
    atendimentoDosIndicadores($deA2);
    $escopado = usuarioCom(['atendimentos.ver'], 'Escopado dos Itens Clínicos');
    $escopado->update(['profissional_id' => $profA1->id]);
    $mes = agoraNaClinica()->format('Y-m');

    // ACT + ASSERT — escopado no mês puro: SÓ o próprio movimento
    $doEscopado = $this->actingAs($escopado)->getJson("/api/indicadores/atendimentos/itens?mes={$mes}");
    $doEscopado->assertOk()->assertJsonPath('contexto.total', 1);
    expect(collect($doEscopado->json('data'))->pluck('profissional.id')->unique()->all())->toBe([$profA1->id]);

    // escopado pedindo OUTRO profissional: resposta uniforme, lista vazia
    $this->actingAs($escopado)
        ->getJson("/api/indicadores/atendimentos/itens?mes={$mes}&profissional_id={$profA2->id}")
        ->assertOk()->assertJsonPath('contexto.total', 0);

    // âncora inexistente → 404 (o escopo nasce do model)
    $this->actingAs($escopado)
        ->getJson("/api/indicadores/atendimentos/itens?mes={$mes}&profissional_id=99999999")
        ->assertNotFound();
});
