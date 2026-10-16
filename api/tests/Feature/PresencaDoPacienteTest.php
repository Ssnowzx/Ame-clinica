<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Agenda\ContadorDeFaltasConsecutivas;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\Carbon;

/**
 * GUARDA da assiduidade do paciente (change presenca-na-ficha) — a seção Presença.
 *
 * A classificação é por FLAG no servidor (§13 — regra é dado, nunca nome de
 * status): falta = `marca_falta` (com precedência sobre o consumo — falta cobrada
 * continua falta); compareceu = sessão consumida em status não-falta; outro = o
 * resto. Taxa com base compareceu+faltas (`outros` fora; base zero → null). A
 * sequência vem da FONTE ÚNICA `ContadorDeFaltasConsecutivas`. Portão por-id do
 * escopo D11 (mesma classe do comparecimento recente). LGPD: dados fictícios.
 */

/** Agendamento passado de $prof/$paciente em $status, $diasAtras dias atrás. */
function presencaOcorrencia(
    Profissional $prof,
    Paciente $paciente,
    StatusAgendamento $status,
    int $diasAtras,
    bool $consumida = false,
): Agendamento {
    return Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'status_id' => $status->id,
        'inicio' => agoraNaClinica()->copy()->subDays($diasAtras)->setTime(9, 0),
        'fim' => agoraNaClinica()->copy()->subDays($diasAtras)->setTime(9, 40),
        'sessao_consumida_em' => $consumida
            ? agoraNaClinica()->copy()->subDays($diasAtras)->setTime(10, 0)->format('Y-m-d H:i')
            : null,
    ]);
}

/** Agendamento de HOJE, daqui a `$horas`, com o desfecho que se quiser. */
function presencaHojeMaisTarde(
    Profissional $prof,
    Paciente $paciente,
    StatusAgendamento $status,
    int $horas = 3,
    bool $consumida = false,
): Agendamento {
    $quando = agoraNaClinica()->copy()->addHours($horas)->setSeconds(0);

    return Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'status_id' => $status->id,
        'inicio' => $quando->format('Y-m-d H:i'),
        'fim' => $quando->copy()->addMinutes(40)->format('Y-m-d H:i'),
        'sessao_consumida_em' => $consumida ? $quando->format('Y-m-d H:i') : null,
    ]);
}

it('deve classificar por FLAG — e renomear o status não muda a contagem', function () {
    // ARRANGE — 2 compareceu (consumida, status não-falta) · 1 falta · 1 outro
    $adminDaClinica = admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    presencaOcorrencia($prof, $paciente, $emAberto, 10, consumida: true);
    presencaOcorrencia($prof, $paciente, $emAberto, 8, consumida: true);
    presencaOcorrencia($prof, $paciente, $naoCompareceu, 6);
    presencaOcorrencia($prof, $paciente, $emAberto, 4); // sem consumo → outro

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT — totais por classe e taxa sobre compareceu+faltas (2/(2+1) = 66.7)
    $resposta->assertOk()
        ->assertJsonPath('totais.compareceu', 2)
        ->assertJsonPath('totais.faltas', 1)
        ->assertJsonPath('totais.outros', 1)
        ->assertJsonPath('totais.total', 4)
        ->assertJsonPath('taxa_comparecimento', '66.7');
    expect($resposta->json('faltas'))->toHaveCount(1);

    // ACT 2 — renomeia o status de falta: a regra vive na FLAG, não no nome
    $naoCompareceu->update(['nome' => 'Ausência Justificada Fictícia']);
    $depois = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT 2
    $depois->assertOk()->assertJsonPath('totais.faltas', 1);
});

it('deve contar falta-que-desconta como FALTA (precedência da flag)', function () {
    // ARRANGE — status com marca_falta E desconta_sessao, sessão consumida
    $adminDaClinica = admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $faltaCobrada = StatusAgendamento::create([
        'nome' => 'Falta Cobrada Fictícia',
        'cor' => '#aa3333',
        'desconta_sessao' => true,
        'ocupa_horario' => true,
        'marca_falta' => true,
        'ordem' => 90,
    ]);
    presencaOcorrencia($prof, $paciente, $faltaCobrada, 5, consumida: true);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT — falta, nunca compareceu (a cobrança é do financeiro; a ausência é fato)
    $resposta->assertOk()
        ->assertJsonPath('totais.faltas', 1)
        ->assertJsonPath('totais.compareceu', 0);
});

it('deve devolver taxa NULL sem base — nunca um zero fabricado', function () {
    // ARRANGE — só "outros": cancelamento não é presença nem ausência
    $adminDaClinica = admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    presencaOcorrencia($prof, $paciente, $emAberto, 3);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT
    $resposta->assertOk()
        ->assertJsonPath('taxa_comparecimento', null)
        ->assertJsonPath('totais.outros', 1);
});

it('deve devolver a MESMA sequência da fonte única do alerta', function () {
    // ARRANGE — 3 faltas seguidas na ponta
    $adminDaClinica = admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    presencaOcorrencia($prof, $paciente, $naoCompareceu, 6);
    presencaOcorrencia($prof, $paciente, $naoCompareceu, 4);
    presencaOcorrencia($prof, $paciente, $naoCompareceu, 2);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT — o número da seção é o do contador (§13), nunca uma segunda conta
    $limite = (int) app(ConfiguracaoService::class)
        ->get('agenda.faltas_consecutivas_limite');
    $fonte = ContadorDeFaltasConsecutivas::doPaciente(
        $paciente->id,
        agoraNaClinica()->format('Y-m-d H:i'),
        $limite,
    );
    // `ultima_falta_em` NÃO entra aqui: ele é da JANELA e o `ultima_em` da fonte é da
    // SEQUÊNCIA — só coincidem com a sequência ativa (o caso divergente tem teste próprio)
    $resposta->assertOk()
        ->assertJsonPath('faltas_consecutivas.consecutivas', $fonte['consecutivas'])
        ->assertJsonPath('faltas_consecutivas.limite', $limite);
    expect($fonte['consecutivas'])->toBe(3);
});

it('deve barrar o escopado em paciente alheio (403)', function () {
    // ARRANGE — paciente atendido só por B; quem consulta é o escopado de A
    admin();
    $profA = Profissional::factory()->create();
    $profB = Profissional::factory()->create();
    $pacienteDeB = Paciente::factory()->create();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    presencaOcorrencia($profB, $pacienteDeB, $emAberto, 2, consumida: true);
    $escopadoDeA = usuarioCom(['agenda.ver'], 'Presença Escopada');
    $escopadoDeA->update(['profissional_id' => $profA->id]);

    // ACT + ASSERT — portão por-id (D4): 403 para alheio
    $this->actingAs($escopadoDeA)
        ->getJson("/api/pacientes/{$pacienteDeB->id}/presenca")
        ->assertForbidden();
});

it('deve itemizar as faltas até o TETO e manter o total real (SEC-PRES-01a)', function () {
    // ARRANGE — 51 faltas: a lista amostra, o contador não mente
    $adminDaClinica = admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    foreach (range(1, 51) as $dias) {
        presencaOcorrencia($prof, $paciente, $naoCompareceu, $dias);
    }

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT
    $resposta->assertOk()->assertJsonPath('totais.faltas', 51);
    expect($resposta->json('faltas'))->toHaveCount(50);
});

it('deve excluir da janela o antigo (>366d) e o FUTURO (SEC-PRES-01b)', function () {
    // ARRANGE — 1 falta dentro da janela; 1 além dos 366d; 1 agendamento futuro
    $adminDaClinica = admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    presencaOcorrencia($prof, $paciente, $naoCompareceu, 10);
    presencaOcorrencia($prof, $paciente, $naoCompareceu, 400); // fora da janela
    Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'status_id' => $naoCompareceu->id,
        'inicio' => agoraNaClinica()->copy()->addDays(3)->setTime(9, 0), // futuro não é histórico
        'fim' => agoraNaClinica()->copy()->addDays(3)->setTime(9, 40),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT — só a falta da janela conta
    $resposta->assertOk()
        ->assertJsonPath('totais.faltas', 1)
        ->assertJsonPath('totais.total', 1);
});

it('deve manter a última falta da JANELA mesmo com comparecimento depois (SEC-PRES-01c)', function () {
    // ARRANGE — falta antiga + comparecimento recente: a sequência zera, a falta não some
    $adminDaClinica = admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $falta = presencaOcorrencia($prof, $paciente, $naoCompareceu, 10);
    presencaOcorrencia($prof, $paciente, $emAberto, 5, consumida: true);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT — "compareceu depois não apaga a última falta"; a sequência é da PONTA
    $resposta->assertOk()
        ->assertJsonPath('ultima_falta_em', $falta->inicio->format('Y-m-d'))
        ->assertJsonPath('faltas_consecutivas.consecutivas', 0);
});

it('deve negar sem `agenda.ver` (SEC-PRES-02)', function () {
    // ARRANGE
    admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    presencaOcorrencia($prof, $paciente, StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail(), 2);
    $semAgenda = usuarioCom(['pacientes.ver'], 'Sem Agenda Presença');

    // ACT + ASSERT
    $this->actingAs($semAgenda)
        ->getJson("/api/pacientes/{$paciente->id}/presenca")
        ->assertForbidden();
});

it('deve minimizar o payload: nome de MENOR e obs nunca; profissional SÓ na quebra', function () {
    // ARRANGE — a obs existe no agendamento; a assiduidade não pode carregá-la. Desde a
    // change ficha-sessoes-por-profissional a QUEBRA carrega nome de PROFISSIONAL (dado
    // de equipe, pedido da clínica) — mas só de quem tem FINALIZADA: o profissional da
    // falta continua fora do payload.
    $adminDaClinica = admin();
    $profDaFalta = Profissional::factory()->create(['nome' => 'Profissional Fictício Presença']);
    $profDaSessao = Profissional::factory()->create(['nome' => 'Profissional Fictício da Sessão Feita']);
    $paciente = Paciente::factory()->create(['nome' => 'Paciente Fictício Presença']);
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    $falta = presencaOcorrencia($profDaFalta, $paciente, $naoCompareceu, 2);
    $falta->update(['obs' => 'Segredo operacional fictício da recepção.']);
    presencaOcorrencia($profDaSessao, $paciente, $emAberto, 4, consumida: true);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT — nome de menor e obs: NUNCA (semVazamento fura o escape); o nome de
    // profissional aparece EXATAMENTE onde a quebra o coloca, e só o de quem finalizou
    $resposta->assertOk();
    semVazamento($resposta->json(), 'Paciente Fictício Presença');
    semVazamento($resposta->json(), 'Segredo operacional fictício');
    semVazamento($resposta->json(), 'Profissional Fictício Presença');
    expect(collect($resposta->json('sessoes_por_profissional'))->pluck('profissional.nome')->all())
        ->toBe(['Profissional Fictício da Sessão Feita']);
    // "SÓ na quebra" pela metade seria guarda pela metade (SEC-FS-02): fora dela,
    // nem o nome de quem FINALIZOU pode aparecer — regressão futura cai aqui
    $foraDaQuebra = $resposta->json();
    unset($foraDaQuebra['sessoes_por_profissional']);
    semVazamento($foraDaQuebra, 'Profissional Fictício da Sessão Feita');
});

it('deve quebrar as finalizadas por profissional×especialidade com soma IGUAL ao total', function () {
    // ARRANGE — A/Fono: 2 finalizadas · B/Psico: 1 finalizada · 1 falta de A (fora da
    // quebra) · 1 consumida-mas-falta (precedência: fora da quebra E do compareceu)
    $adminDaClinica = admin();
    $fono = Especialidade::factory()->create(['nome' => 'Fono da Quebra', 'tempo_sessao' => 40]);
    $psico = Especialidade::factory()->create(['nome' => 'Psico da Quebra', 'tempo_sessao' => 40]);
    $profA = Profissional::factory()->create(['nome' => 'Profissional Fictício A da Quebra']);
    $profB = Profissional::factory()->create(['nome' => 'Profissional Fictício B da Quebra']);
    $paciente = Paciente::factory()->create();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    presencaOcorrencia($profA, $paciente, $emAberto, 10, consumida: true)->update(['especialidade_id' => $fono->id]);
    presencaOcorrencia($profA, $paciente, $emAberto, 8, consumida: true)->update(['especialidade_id' => $fono->id]);
    presencaOcorrencia($profB, $paciente, $emAberto, 6, consumida: true)->update(['especialidade_id' => $psico->id]);
    presencaOcorrencia($profA, $paciente, $naoCompareceu, 4)->update(['especialidade_id' => $fono->id]);
    presencaOcorrencia($profA, $paciente, $naoCompareceu, 2, consumida: true)->update(['especialidade_id' => $fono->id]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT — uma régua só: a soma da quebra é o PRÓPRIO "compareceu"
    $resposta->assertOk()->assertJsonPath('totais.compareceu', 3);
    $quebra = collect($resposta->json('sessoes_por_profissional'));
    expect($quebra->sum('finalizadas'))->toBe(3)
        ->and($quebra)->toHaveCount(2)
        // relevância: quem mais atendeu primeiro
        ->and($quebra->first()['profissional']['nome'])->toBe('Profissional Fictício A da Quebra')
        ->and($quebra->first()['especialidade']['nome'])->toBe('Fono da Quebra')
        ->and($quebra->first()['finalizadas'])->toBe(2)
        ->and($quebra->last()['profissional']['nome'])->toBe('Profissional Fictício B da Quebra')
        ->and($quebra->last()['finalizadas'])->toBe(1)
        // whitelist da linha: id+nome, nada além
        ->and(array_keys($quebra->first()))->toBe(['profissional', 'especialidade', 'finalizadas'])
        ->and(array_keys($quebra->first()['profissional']))->toBe(['id', 'nome']);
});

it('deve separar as ESPECIALIDADES de um mesmo profissional em linhas próprias', function () {
    // ARRANGE — o mesmo profissional atende a criança em DUAS especialidades
    $adminDaClinica = admin();
    $fono = Especialidade::factory()->create(['nome' => 'Fono do Multi', 'tempo_sessao' => 40]);
    $psico = Especialidade::factory()->create(['nome' => 'Psico do Multi', 'tempo_sessao' => 40]);
    $prof = Profissional::factory()->create(['nome' => 'Profissional Fictício Multi']);
    $paciente = Paciente::factory()->create();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    presencaOcorrencia($prof, $paciente, $emAberto, 9, consumida: true)->update(['especialidade_id' => $fono->id]);
    presencaOcorrencia($prof, $paciente, $emAberto, 7, consumida: true)->update(['especialidade_id' => $psico->id]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->getJson("/api/pacientes/{$paciente->id}/presenca");

    // ASSERT — duas linhas (é o que permite o filtro por especialidade na tela)
    $quebra = collect($resposta->json('sessoes_por_profissional'));
    expect($quebra)->toHaveCount(2)
        ->and($quebra->pluck('especialidade.nome')->sort()->values()->all())
        ->toBe(['Fono do Multi', 'Psico do Multi'])
        ->and($quebra->sum('finalizadas'))->toBe(2);
});

// ── O desfecho de HOJE (change agendamentos-na-ficha, D5) ────────────────────

/**
 * RELÓGIO CONGELADO (achado bloqueante do gate): `presencaHojeMaisTarde` soma horas ao "agora",
 * e das 21h em diante `agora+3h` cai em AMANHÃ — os dois testes que provam a change viravam
 * vermelhos, e o terceiro passava pelo motivo errado (era de amanhã, não "em aberto").
 */
describe('desfecho de hoje na assiduidade', function () {
    // CHAMADA de função, dentro do describe — a forma encadeada `})->beforeEach(...)` é NO-OP no
    // Pest 4 (a chain resolve para a função global DEPOIS de a classe do teste ser construída),
    // e foi assim que o bloqueante da rodada 1 voltou vivo na rodada 2.
    beforeEach(fn () => Carbon::setTestNow(Carbon::parse('2026-09-08 09:00:00', 'America/Sao_Paulo')));
    afterEach(fn () => Carbon::setTestNow());

    it('deve rodar com o relógio CONGELADO (autoguarda do hook)', function () {
        // sem isto, quebrar o hook volta a ser silencioso fora da janela das 21h (`SEC-SE-13`)
        expect(agoraNaClinica()->format('Y-m-d H:i'))->toBe('2026-09-08 09:00');
    });

    /**
     * A fronteira nova: a assiduidade conta o que já começou E o de hoje cujo desfecho a
     * clínica já lançou. Nasceu do caso real de 2026-09-08 — presença registrada de manhã
     * para a sessão da tarde, e a ficha dizia que não havia nada. O que segue EM ABERTO
     * hoje continua fora: nada de inflar "outros" com sessão que não aconteceu.
     */
    it('deve contar a sessão de HOJE já finalizada, sem esperar o relógio', function () {
        // ARRANGE — sessão de hoje mais tarde, presença lançada (consumida, status não-falta)
        $adminDaClinica = admin();
        $prof = Profissional::factory()->create();
        $paciente = Paciente::factory()->create();
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        presencaHojeMaisTarde($prof, $paciente, $emAberto, consumida: true);

        // ACT
        $resposta = $this->actingAs($adminDaClinica)->getJson("/api/pacientes/{$paciente->id}/presenca");

        // ASSERT — conta como compareceu no MESMO dia
        $resposta->assertOk()
            ->assertJsonPath('totais.compareceu', 1)
            ->assertJsonPath('totais.total', 1)
            ->assertJsonPath('taxa_comparecimento', '100.0');
    });

    it('deve manter fora a sessão de hoje ainda EM ABERTO', function () {
        // ARRANGE — mesma sessão de hoje mais tarde, sem desfecho lançado
        $adminDaClinica = admin();
        $prof = Profissional::factory()->create();
        $paciente = Paciente::factory()->create();
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        presencaHojeMaisTarde($prof, $paciente, $emAberto);

        // ACT
        $resposta = $this->actingAs($adminDaClinica)->getJson("/api/pacientes/{$paciente->id}/presenca");

        // ASSERT — nenhuma classe recebe o que ainda não aconteceu, nem "outros"
        $resposta->assertOk()
            ->assertJsonPath('totais.total', 0)
            ->assertJsonPath('totais.outros', 0)
            ->assertJsonPath('taxa_comparecimento', null);
    });

    it('deve contar a FALTA lançada hoje na sequência consecutiva (fonte única)', function () {
        // ARRANGE — duas faltas passadas e a de hoje, marcada antes do horário
        $adminDaClinica = admin();
        $prof = Profissional::factory()->create();
        $paciente = Paciente::factory()->create();
        $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
        presencaOcorrencia($prof, $paciente, $naoCompareceu, 14);
        presencaOcorrencia($prof, $paciente, $naoCompareceu, 7);
        presencaHojeMaisTarde($prof, $paciente, $naoCompareceu);

        // ACT
        $resposta = $this->actingAs($adminDaClinica)->getJson("/api/pacientes/{$paciente->id}/presenca");

        // ASSERT — a falta de hoje entra nos totais E na sequência; o número da seção é o do alerta
        $resposta->assertOk()
            ->assertJsonPath('totais.faltas', 3)
            ->assertJsonPath('faltas_consecutivas.consecutivas', 3)
            ->assertJsonPath('ultima_falta_em', agoraNaClinica()->toDateString());
    });

    it('deve ignorar desfecho lançado para DEPOIS de hoje', function () {
        // ARRANGE — presença lançada por engano numa sessão de amanhã
        $adminDaClinica = admin();
        $prof = Profissional::factory()->create();
        $paciente = Paciente::factory()->create();
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        presencaHojeMaisTarde($prof, $paciente, $emAberto, horas: 30, consumida: true);

        // ACT
        $resposta = $this->actingAs($adminDaClinica)->getJson("/api/pacientes/{$paciente->id}/presenca");

        // ASSERT — o limite é o dia corrente: amanhã não conta hoje
        $resposta->assertOk()->assertJsonPath('totais.total', 0);
    });

});
