<?php

use App\Models\Agendamento;
use App\Models\Anamnese;
use App\Models\AnamneseModelo;
use App\Models\Atendimento;
use App\Models\Evolucao;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use Carbon\Carbon;

/**
 * GUARDA MECÂNICA do EIXO CLÍNICO do gatilho 🔴 D11 (parecer SEC-VP-01, matriz §6, células ⚠️/🔴).
 *
 * Companheira de EscopoProfissionalTest (eixo AGENDA): aqui é o prontuário — atendimento, evolução
 * e anamnese (dado de saúde de MENOR, art. 11) — mais o portão por-id de paciente (comparecimento,
 * resumo), a fila clínica, o centro de notificações e a produção por profissional. Regra
 * GATED-PELA-FLAG: papel COM `clinico.ver_todos`/`agenda.ver_todos` = PLANO; papel SEM a flag +
 * vínculo = ESCOPADO ao próprio; sem vínculo = FAIL-CLOSED. Toda a regra passa pela fonte única
 * `EscopoDoProfissional`. Abuse-cases AB-06/07/08 + SEC-VP-04/05. LGPD: dados 100% fictícios.
 */

/** Usuário escopado (SEM flags) com o leque clínico + agenda, vinculado a $prof. SEM `pacientes.ver`. */
function usuarioClinico(Profissional $prof): Usuario
{
    // O helper base traz o mínimo de agenda (`ver`, `criar`, `editar`); esta suíte só acrescenta
    // o clínico. `agenda.editar` NÃO fazia parte da lista original — entrou pelo helper e não
    // altera o que estes testes medem (eles não editam agendamento), mas fica dito para que a
    // diferença não seja descoberta por acidente numa falha futura.
    return usuarioEscopadoEm($prof, [
        'atendimentos.ver', 'atendimentos.criar', 'atendimentos.editar', 'atendimentos.excluir',
        'evolucoes.ver', 'evolucoes.criar', 'evolucoes.editar',
        'anamneses.ver', 'anamneses.criar', 'anamneses.editar',
    ]);
}

/** Agendamento de atendimento de $prof para $paciente (`$inicio` naive na parede da clínica). */
function agendaDeProf(Profissional $prof, Paciente $paciente, ?string $inicio = null): Agendamento
{
    $inicio ??= agoraNaClinica()->copy()->addDay()->setTime(9, 0)->format('Y-m-d H:i');
    $base = Carbon::createFromFormat('Y-m-d H:i', $inicio);

    return Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'inicio' => $base,
        'fim' => $base->copy()->addMinutes(40),
    ]);
}

/** Atendimento finalizado ligado a um agendamento de $prof (cria o agendamento e o paciente). */
function atendimentoDeProf(Profissional $prof, ?Paciente $paciente = null): Atendimento
{
    $paciente ??= Paciente::factory()->create();
    $agendamento = agendaDeProf($prof, $paciente, agoraNaClinica()->copy()->subDay()->setTime(9, 0)->format('Y-m-d H:i'));

    return Atendimento::factory()->create([
        'agendamento_id' => $agendamento->id,
        'finalizado_em' => agoraNaClinica()->copy()->subHour()->format('Y-m-d H:i'),
    ]);
}

/** Evolução (criação DIRETA, sem factory) de $autor sobre $atendimento; $rt opcional. */
function evolucaoNoAtendimento(Atendimento $atendimento, Profissional $autor, ?Profissional $rt = null): Evolucao
{
    $evolucao = new Evolucao([
        'profissional_id' => $autor->id,
        'responsavel_tecnico_id' => $rt?->id,
        'conteudo' => 'Evolução clínica fictícia da sessão.',
    ]);
    $evolucao->atendimento_id = $atendimento->id;
    $evolucao->preenchida_em = agoraNaClinica()->format('Y-m-d H:i');
    $evolucao->save();

    return $evolucao;
}

/** Modelo de anamnese mínimo (um campo texto opcional). */
function modeloClinico(): AnamneseModelo
{
    return AnamneseModelo::create([
        'titulo' => 'Ficha Fictícia '.fake()->unique()->numberBetween(1, 99999),
        'campos_json' => [['id' => 'queixa', 'tipo' => 'texto', 'rotulo' => 'Queixa', 'obrigatorio' => false]],
        'ativo' => true,
    ]);
}

/** Anamnese (criação DIRETA, sem factory) de $paciente. */
function anamneseDePaciente(Paciente $paciente): Anamnese
{
    $anamnese = new Anamnese(['modelo_id' => modeloClinico()->id, 'respostas_json' => ['queixa' => 'Fictícia.']]);
    $anamnese->paciente_id = $paciente->id;
    $anamnese->preenchida_em = agoraNaClinica()->format('Y-m-d H:i');
    $anamnese->save();

    return $anamnese;
}

/** Falta passada de $prof para $paciente, $diasAtras dias atrás, no status `marca_falta`. */
function faltaDeProf(Profissional $prof, Paciente $paciente, StatusAgendamento $status, int $diasAtras): Agendamento
{
    return Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'status_id' => $status->id,
        'inicio' => agoraNaClinica()->copy()->subDays($diasAtras)->setTime(9, 0),
        'fim' => agoraNaClinica()->copy()->subDays($diasAtras)->setTime(9, 40),
    ]);
}

// ============================ LEITURA CLÍNICA POR-ID (AB-06, art. 11) ============================

it('deve recusar (403/404) ler atendimento/evolução/anamnese de outro profissional (AB-06)', function () {
    // ARRANGE — A escopado; prontuário de B
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $atendimentoB = atendimentoDeProf($profB);
    $evolucaoB = evolucaoNoAtendimento($atendimentoB, $profB);
    $anamneseB = anamneseDePaciente(Paciente::factory()->create()); // paciente não é de A
    $usuario = usuarioClinico($profA);

    // ACT + ASSERT — nenhum caminho de leitura clínica de B abre para A
    $this->actingAs($usuario)->getJson("/api/atendimentos/{$atendimentoB->id}")->assertForbidden();
    $this->actingAs($usuario)->getJson("/api/evolucoes/{$evolucaoB->id}")->assertForbidden();
    $this->actingAs($usuario)->getJson("/api/anamneses/{$anamneseB->id}")->assertForbidden();
});

it('deve recusar (403) editar/excluir atendimento e editar evolução/anamnese de outro (AB-06)', function () {
    // ARRANGE
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $atendimentoB = atendimentoDeProf($profB);
    $evolucaoB = evolucaoNoAtendimento($atendimentoB, $profB);
    $anamneseB = anamneseDePaciente(Paciente::factory()->create());
    $usuario = usuarioClinico($profA);

    // ACT + ASSERT — mutações sobre o prontuário de B → 403
    $this->actingAs($usuario)->putJsonComVersao("/api/atendimentos/{$atendimentoB->id}", [
        'finalizado_em' => agoraNaClinica()->copy()->subHour()->format('Y-m-d H:i'),
    ])->assertForbidden();
    $this->actingAs($usuario)->deleteJson("/api/atendimentos/{$atendimentoB->id}")->assertForbidden();
    $this->actingAs($usuario)->putJsonComVersao("/api/evolucoes/{$evolucaoB->id}", [
        'conteudo' => 'Tentativa fictícia.',
    ])->assertForbidden();
    $this->actingAs($usuario)->putJsonComVersao("/api/anamneses/{$anamneseB->id}", [
        'respostas_json' => ['queixa' => 'Tentativa fictícia.'],
    ])->assertForbidden();
});

// ============================ ESCRITA CLÍNICA SÓ NO PRÓPRIO ============================

it('deve deixar o escopado registrar atendimento SÓ no próprio agendamento (403 senão)', function () {
    // ARRANGE
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $agA = agendaDeProf($profA, Paciente::factory()->create(), agoraNaClinica()->copy()->subDay()->setTime(9, 0)->format('Y-m-d H:i'));
    $agB = agendaDeProf($profB, Paciente::factory()->create(), agoraNaClinica()->copy()->subDay()->setTime(9, 0)->format('Y-m-d H:i'));
    $usuario = usuarioClinico($profA);
    $payload = ['finalizado_em' => agoraNaClinica()->copy()->subHour()->format('Y-m-d H:i')];

    // ACT + ASSERT — no agendamento de B → 403; no próprio → 201
    $this->actingAs($usuario)->postJson("/api/agendamentos/{$agB->id}/atendimento", $payload)->assertForbidden();
    $this->actingAs($usuario)->postJson("/api/agendamentos/{$agA->id}/atendimento", $payload)->assertCreated();
});

it('deve deixar o escopado evoluir SÓ no próprio atendimento (403 senão)', function () {
    // ARRANGE
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $atendimentoA = atendimentoDeProf($profA);
    $atendimentoB = atendimentoDeProf($profB);
    $usuario = usuarioClinico($profA);

    // ACT + ASSERT — evolução no atendimento de B → 403; no próprio, assinando como si → 201
    $this->actingAs($usuario)->postJson("/api/atendimentos/{$atendimentoB->id}/evolucao", [
        'profissional_id' => $profA->id, // ainda que assine em nome próprio, o atendimento é de B
        'conteudo' => 'Evolução fictícia.',
    ])->assertForbidden();
    $this->actingAs($usuario)->postJson("/api/atendimentos/{$atendimentoA->id}/evolucao", [
        'profissional_id' => $profA->id,
        'conteudo' => 'Evolução fictícia.',
    ])->assertCreated();
});

it('deve deixar o escopado anamnesar SÓ o próprio paciente (403 senão)', function () {
    // ARRANGE
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $pacienteA = Paciente::factory()->create();
    agendaDeProf($profA, $pacienteA); // marca A com o paciente
    $pacienteB = Paciente::factory()->create();
    agendaDeProf($profB, $pacienteB);
    $usuario = usuarioClinico($profA);
    $payload = ['modelo_id' => modeloClinico()->id, 'respostas_json' => ['queixa' => 'Fictícia.']];

    // ACT + ASSERT — paciente de B → 403; o próprio → 201
    $this->actingAs($usuario)->postJson("/api/pacientes/{$pacienteB->id}/anamneses", $payload)->assertForbidden();
    $this->actingAs($usuario)->postJson("/api/pacientes/{$pacienteA->id}/anamneses", $payload)->assertCreated();
});

// ============================ LEITURA POR {AUTOR, RT, ATENDENTE} (SEC-VP-05) ============================

it('deve alcançar a evolução por QUALQUER dono: autor, RT ou atendente do agendamento (SEC-VP-05)', function () {
    // ARRANGE
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();

    // (i) A é o ATENDENTE: agendamento de A, evolução assinada por B → A alcança
    $atendimentoDeA = atendimentoDeProf($profA);
    $evolucaoAssinadaPorB = evolucaoNoAtendimento($atendimentoDeA, $profB);
    // (ii) A é o RT: atendimento de B, autor B, responsável técnico A → A alcança
    $atendimentoDeB = atendimentoDeProf($profB);
    $evolucaoComRtA = evolucaoNoAtendimento($atendimentoDeB, $profB, $profA);
    // (iii) totalmente de B (autor B, sem RT, agendamento de B) → A NÃO alcança
    $atendimentoDeBOutro = atendimentoDeProf($profB);
    $evolucaoSoDeB = evolucaoNoAtendimento($atendimentoDeBOutro, $profB);

    $usuario = usuarioClinico($profA);

    // ACT + ASSERT
    $this->actingAs($usuario)->getJson("/api/evolucoes/{$evolucaoAssinadaPorB->id}")->assertOk();
    $this->actingAs($usuario)->getJson("/api/evolucoes/{$evolucaoComRtA->id}")->assertOk();
    $this->actingAs($usuario)->getJson("/api/evolucoes/{$evolucaoSoDeB->id}")->assertForbidden();
});

// ============================ FILA CLÍNICA (só o próprio) ============================

it('deve escopar a fila de atendimentos e de evoluções-em-aberto ao próprio profissional', function () {
    // ARRANGE — um atendimento SEM evolução de cada profissional
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $atendimentoA = atendimentoDeProf($profA);
    $atendimentoB = atendimentoDeProf($profB);
    $usuario = usuarioClinico($profA);

    // ACT — as duas filas clínicas
    $atendimentos = collect($this->actingAs($usuario)->getJson('/api/atendimentos')->assertOk()->json('data'))
        ->pluck('id');
    $emAberto = collect($this->actingAs($usuario)->getJson('/api/evolucoes/em-aberto')->assertOk()->json('data'))
        ->pluck('atendimento_id');

    // ASSERT — só os do próprio (A); nunca os de B
    expect($atendimentos)->toContain($atendimentoA->id)->not->toContain($atendimentoB->id);
    expect($emAberto)->toContain($atendimentoA->id)->not->toContain($atendimentoB->id);
});

it('deve forçar o próprio na fila mesmo quando o cliente pede o profissional_id de outro', function () {
    // ARRANGE
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $atendimentoA = atendimentoDeProf($profA);
    $atendimentoB = atendimentoDeProf($profB);
    $usuario = usuarioClinico($profA);

    // ACT — o escopado tenta ver a fila de B; o servidor força o próprio (A)
    $emAberto = collect($this->actingAs($usuario)
        ->getJson("/api/evolucoes/em-aberto?profissional_id={$profB->id}")->assertOk()->json('data'))
        ->pluck('atendimento_id');

    // ASSERT
    expect($emAberto)->toContain($atendimentoA->id)->not->toContain($atendimentoB->id);
});

// ============================ CRITÉRIO PACIENTE (SEC-VP-04) ============================

it('deve permitir o paciente MARCADO-mas-não-atendido e barrar o não-vinculado (SEC-VP-04)', function () {
    // ARRANGE — pacienteMarcado tem só um agendamento FUTURO de A (nenhum atendimento ainda)
    admin();
    $profA = Profissional::factory()->create();
    $pacienteMarcado = Paciente::factory()->create();
    agendaDeProf($profA, $pacienteMarcado); // futuro, sem atendimento
    $pacienteAlheio = Paciente::factory()->create(); // nenhum vínculo com A
    $usuario = usuarioClinico($profA);

    // ACT + ASSERT — marcado (EXISTS agendamentos) libera; alheio → 403
    $this->actingAs($usuario)->getJson("/api/pacientes/{$pacienteMarcado->id}/anamneses")->assertOk();
    $this->actingAs($usuario)->getJson("/api/pacientes/{$pacienteAlheio->id}/anamneses")->assertForbidden();
});

it('deve reconhecer o paciente do profissional também por TRATAMENTO sem agenda (SEC-VP-04)', function () {
    // ARRANGE — vínculo só por tratamento (contrato sem agendamento)
    admin();
    $profA = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    Tratamento::factory()->create(['profissional_id' => $profA->id, 'paciente_id' => $paciente->id]);
    $usuario = usuarioClinico($profA);

    // ACT + ASSERT — o tratamento basta para "é meu paciente"
    $this->actingAs($usuario)->getJson("/api/pacientes/{$paciente->id}/anamneses")->assertOk();
});

// ============================ COMPARECIMENTO: PORTÃO + CONTEÚDO DE TODOS (#8, decisão do usuário) ============================

it('deve barrar o comparecimento de paciente alheio e, no próprio, mostrar TODOS os profissionais (#8)', function () {
    // ARRANGE — pacienteMeu é de A; mas teve uma sessão PASSADA com B também
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $pacienteMeu = Paciente::factory()->create();
    agendaDeProf($profA, $pacienteMeu); // futuro: firma o vínculo de A
    $sessaoComB = agendaDeProf($profB, $pacienteMeu, agoraNaClinica()->copy()->subDays(10)->setTime(9, 0)->format('Y-m-d H:i'));
    $pacienteAlheio = Paciente::factory()->create();
    $usuario = usuarioClinico($profA);

    // ACT — paciente alheio (403) e paciente meu (200)
    $this->actingAs($usuario)->getJson("/api/pacientes/{$pacienteAlheio->id}/comparecimento-recente")->assertForbidden();
    $itens = collect($this->actingAs($usuario)
        ->getJson("/api/pacientes/{$pacienteMeu->id}/comparecimento-recente")->assertOk()->json('itens'));

    // ASSERT — o acesso passa pelo portão, mas o CONTEÚDO inclui a sessão com B (todos os profissionais)
    expect($itens->pluck('id'))->toContain($sessaoComB->id);
    expect($itens->pluck('profissional.id'))->toContain($profB->id);
});

// ============================ RESUMO (#26, defesa em profundidade) ============================

it('deve escopar o resumo do paciente pelo eixo AGENDA (403 para não-vinculado) (#26)', function () {
    // ARRANGE — usuário escopado COM pacientes.ver (não é o papel de referência; é o defense-in-depth).
    // O eixo é o da AGENDA desde a rodada 4 de `vinculo-previo-para-agendar` (`SEC-VP-52`): o
    // conteúdo é profissional atual, contrato e sessões — dado de agenda e pacote, nada de art. 11.
    admin();
    $profA = Profissional::factory()->create();
    $pacienteMeu = Paciente::factory()->create();
    agendaDeProf($profA, $pacienteMeu);
    $pacienteAlheio = Paciente::factory()->create();
    $usuario = usuarioCom(['pacientes.ver'], 'Prof. com cadastro');
    $usuario->update(['profissional_id' => $profA->id]);

    // ACT + ASSERT — o próprio 200, o alheio 403 (mesmo com pacientes.ver liberando o middleware)
    $this->actingAs($usuario)->getJson("/api/pacientes/{$pacienteMeu->id}/resumo")->assertOk();
    $this->actingAs($usuario)->getJson("/api/pacientes/{$pacienteAlheio->id}/resumo")->assertForbidden();
});

it('deve abrir o resumo ao balcão (flag da agenda, sem a clínica, sem vínculo) e fechá-lo a quem só tem a flag clínica (#26)', function () {
    // ARRANGE — a forma da Secretaria/Faturista da AP-10 era `nenhum` no eixo clínico e o painel
    // da ficha respondia 403 para TODA criança (`SEC-VP-52`). O inverso — só `clinico.ver_todos`,
    // sem a flag da agenda e sem vínculo — não existe na AP-10 e fica fail-closed (risco aceito 5
    // do memorando da rodada 4).
    admin();
    $paciente = Paciente::factory()->create();
    $balcao = usuarioCom(['pacientes.ver', 'agenda.ver_todos'], 'Balcão');
    $soClinico = usuarioCom(['pacientes.ver', 'clinico.ver_todos'], 'Só clínico');

    // ACT + ASSERT
    $this->actingAs($balcao)->getJson("/api/pacientes/{$paciente->id}/resumo")->assertOk();
    trocarDeUsuario();
    $this->actingAs($soClinico)->getJson("/api/pacientes/{$paciente->id}/resumo")->assertForbidden();
});

// ============================ NOTIFICAÇÕES (AB-07) ============================

it('deve escopar a fila de evoluções-em-aberto do centro de notificações ao próprio (AB-07)', function () {
    // ARRANGE — um atendimento sem evolução de cada profissional
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $atendimentoA = atendimentoDeProf($profA);
    atendimentoDeProf($profB);
    $usuario = usuarioClinico($profA);

    // ACT
    $bloco = $this->actingAs($usuario)->getJson('/api/notificacoes')->assertOk()->json('evolucoes_em_aberto');

    // ASSERT — só o próprio na fila do centro
    expect($bloco['total'])->toBe(1)
        ->and(collect($bloco['itens'])->pluck('atendimento_id'))->toContain($atendimentoA->id);
});

it('deve escopar as faltas consecutivas do centro aos pacientes do próprio profissional (AB-07/#28)', function () {
    // ARRANGE — P (de A) e Q (de B), cada um com 3 faltas seguidas (limite default 3)
    $adminPlano = admin(); // Administrador tem as flags (Permission::all) → plano
    $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    expect($naoCompareceu->marca_falta)->toBeTrue();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $pacienteDeA = Paciente::factory()->create(['nome' => 'Faltoso de A Fictício']);
    $pacienteDeB = Paciente::factory()->create(['nome' => 'Faltoso de B Fictício']);
    foreach ([21, 14, 7] as $dias) {
        faltaDeProf($profA, $pacienteDeA, $naoCompareceu, $dias);
        faltaDeProf($profB, $pacienteDeB, $naoCompareceu, $dias);
    }
    $usuario = usuarioClinico($profA);

    // ACT — escopado A e admin plano; troca de usuário exige flush do guard sanctum
    $blocoEscopado = $this->actingAs($usuario)->getJson('/api/notificacoes')->assertOk()->json('faltas_consecutivas');
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $blocoAdmin = collect($this->actingAs($adminPlano)->getJson('/api/notificacoes')->assertOk()->json('faltas_consecutivas.itens'));

    // ASSERT — A vê só o próprio faltoso; o admin vê os dois
    expect($blocoEscopado['total'])->toBe(1)
        ->and(collect($blocoEscopado['itens'])->pluck('paciente.id'))
        ->toContain($pacienteDeA->id)->not->toContain($pacienteDeB->id);
    expect($blocoAdmin->pluck('paciente.id'))->toContain($pacienteDeA->id)->toContain($pacienteDeB->id);
});

// ============================ RELATÓRIO DE PRODUÇÃO (AB-08) ============================

it('deve dar ao escopado SÓ a própria linha na produção por profissional (AB-08)', function () {
    // ARRANGE — um atendimento finalizado de cada profissional, no período
    $adminPlano = admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    atendimentoDeProf($profA);
    atendimentoDeProf($profB);
    $usuario = usuarioClinico($profA);
    $de = agoraNaClinica()->copy()->subDay()->toDateString();
    $ate = agoraNaClinica()->toDateString();

    // ACT — escopado e admin plano; troca de usuário exige flush do guard sanctum
    $idsEscopado = collect($this->actingAs($usuario)
        ->getJson("/api/relatorios/producao-por-profissional?de={$de}&ate={$ate}")->assertOk()->json('linhas'))
        ->pluck('profissional.id');
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $idsAdmin = collect($this->actingAs($adminPlano)
        ->getJson("/api/relatorios/producao-por-profissional?de={$de}&ate={$ate}")->assertOk()->json('linhas'))
        ->pluck('profissional.id');

    // ASSERT — A só a própria linha; o admin vê ambas
    expect($idsEscopado)->toContain($profA->id)->not->toContain($profB->id);
    expect($idsAdmin)->toContain($profA->id)->toContain($profB->id);
});

it('não deve dar ao escopado as sessões consumidas do colega na produção (AB-08)', function () {
    // ARRANGE — gate CR-PROD-03: a consulta dos consumos foi reescrita (producao-pelo-dia-da-sessao) e
    // o teste acima só cria atendimentos. Aqui o colega tem SÓ um consumo no período
    $adminPlano = admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    agendaDeProf($profB, Paciente::factory()->create(), agoraNaClinica()->copy()->subDay()->setTime(9, 0)->format('Y-m-d H:i'))
        ->forceFill(['sessao_consumida_em' => agoraNaClinica()->format('Y-m-d H:i')])->save();
    $usuario = usuarioClinico($profA);
    $de = agoraNaClinica()->copy()->subDays(2)->toDateString();
    $ate = agoraNaClinica()->toDateString();

    // ACT — escopado e admin plano; troca de usuário exige flush do guard sanctum
    $idsEscopado = collect($this->actingAs($usuario)
        ->getJson("/api/relatorios/producao-por-profissional?de={$de}&ate={$ate}")->assertOk()->json('linhas'))
        ->pluck('profissional.id');
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $idsAdmin = collect($this->actingAs($adminPlano)
        ->getJson("/api/relatorios/producao-por-profissional?de={$de}&ate={$ate}")->assertOk()->json('linhas'))
        ->pluck('profissional.id');

    // ASSERT — o consumo existe (o admin o vê), e não vaza para o escopado
    expect($idsAdmin)->toContain($profB->id);
    expect($idsEscopado)->not->toContain($profB->id);
});

// ============================ RETROCOMPAT (AB-13) e FAIL-CLOSED (AB-12) ============================

it('deve manter o ADMIN plano no clínico: alcança atendimento/evolução/anamnese de qualquer um (AB-13)', function () {
    // ARRANGE — admin (tem clinico.ver_todos via Permission::all()), vinculado a OUTRO profissional
    $admin = admin();
    $profOutro = Profissional::factory()->create();
    $atendimento = atendimentoDeProf($profOutro);
    $evolucao = evolucaoNoAtendimento($atendimento, $profOutro);
    $anamnese = anamneseDePaciente(Paciente::factory()->create());
    $admin->update(['profissional_id' => Profissional::factory()->create()->id]);

    // ACT + ASSERT — o plano lê o prontuário de qualquer profissional
    $this->actingAs($admin)->getJson("/api/atendimentos/{$atendimento->id}")->assertOk();
    $this->actingAs($admin)->getJson("/api/evolucoes/{$evolucao->id}")->assertOk();
    $this->actingAs($admin)->getJson("/api/anamneses/{$anamnese->id}")->assertOk();
});

it('deve FAIL-CLOSED no clínico: escopado sem vínculo vê fila vazia e recebe 403 no detalhe (AB-12)', function () {
    // ARRANGE — papel clínico SEM flags e usuário SEM profissional_id
    admin();
    $atendimento = atendimentoDeProf(Profissional::factory()->create());
    $evolucao = evolucaoNoAtendimento($atendimento, Profissional::factory()->create());
    $semVinculo = usuarioCom(['atendimentos.ver', 'evolucoes.ver'], 'Prof. e Agenda');

    // ACT + ASSERT — fila vazia (nunca a de todos) e detalhe barrado
    expect($this->actingAs($semVinculo)->getJson('/api/atendimentos')->assertOk()->json('data'))->toBe([]);
    expect($this->actingAs($semVinculo)->getJson('/api/evolucoes/em-aberto')->assertOk()->json('data'))->toBe([]);
    $this->actingAs($semVinculo)->getJson("/api/atendimentos/{$atendimento->id}")->assertForbidden();
    $this->actingAs($semVinculo)->getJson("/api/evolucoes/{$evolucao->id}")->assertForbidden();
});
