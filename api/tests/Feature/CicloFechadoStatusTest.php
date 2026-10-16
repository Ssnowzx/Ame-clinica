<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Str;

/**
 * O 6º CAMINHO da guarda de ciclo (change `trava-de-status-em-ciclo-fechado` — SEC-FC-20
 * fechado a pedido escrito da clínica, 3º formulário, pergunta 12, 2026-07-25): mudar o
 * status de um agendamento cuja produção está em período fechado é recusado com a MESMA
 * chave, pela MESMA fonte única e sobre a MESMA janela (16/06–15/07/2026) que congela os
 * outros cinco caminhos — usar `cenaDeCiclo()`/`fecharJanelaDeJulho()` é o que mantém a
 * prova CRUZADA: um período, seis recusas.
 *
 * Competência do agendamento = `inicio` (o dia da SESSÃO — design D1). Mudança REAL
 * decidida sob lock (reenviar o mesmo status não é mudança — idioma SEC-FC-13).
 */

/**
 * Nome PRÓPRIO (não `statusPorNome`): aquele vive em ConsumoSessaoTest.php e só existe
 * quando aquela suíte carrega no mesmo processo — no `--parallel`, este arquivo roda
 * sozinho e morreria com "undefined function" (a lição do docblock do `cenaDeCiclo`).
 */
function statusDoCiclo(string $nome): StatusAgendamento
{
    return StatusAgendamento::where('nome', $nome)->firstOrFail();
}

/** A cena com o `inicio` do agendamento DENTRO da janela 16/06–15/07 (a factory nasce em hoje). */
function cenaDeCicloComInicio(string $inicio = '2026-07-01 10:00'): array
{
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);
    $cena = cenaDeCiclo();
    $cena['agendamento']->forceFill([
        'inicio' => $inicio,
        'fim' => date('Y-m-d H:i:s', strtotime($inicio.' +40 minutes')),
    ])->save();

    return ['agendamento' => $cena['agendamento']->refresh(), ...array_diff_key($cena, ['agendamento' => 1])];
}

it('deve recusar mudar o status de agendamento com produção em período fechado', function () {
    // ARRANGE — sessão de 01/07 dentro da janela; o atendimento existe (o caso do balcão)
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $statusAnterior = $cena['agendamento']->status_id;

    // ACT — o fluxo do dia: trocar o status pelo card (mesmo PUT do formulário)
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        [
            'inicio' => '2026-07-01 10:00',
            'profissional_id' => $cena['agendamento']->profissional_id,
            'status_id' => statusDoCiclo('Finalizado')->id,
        ],
    );

    // ASSERT — a MESMA 422 dos outros cinco caminhos, e nada gravado
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($resposta->json('errors.ciclo_fechado.0'))->toContain('16/06/2026–15/07/2026');
    expect($cena['agendamento']->fresh()->status_id)->toBe($statusAnterior);
});

it('deve recusar também SEM atendimento — o consumo move produção sem ele', function () {
    // ARRANGE — mesma cena, mas o atendimento é apagado: sobra agendamento + tratamento de
    // convênio. `sessoes_realizadas` se move por status (desconta_sessao), não por atendimento.
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio();
    $cena['atendimento']->delete();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        [
            'inicio' => '2026-07-01 10:00',
            'profissional_id' => $cena['agendamento']->profissional_id,
            'status_id' => statusDoCiclo('Finalizado')->id,
        ],
    )->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
});

it('deve aceitar o PUT que reenvia o MESMO status — reenviar não é mudança', function () {
    // ARRANGE — idioma SEC-FC-13: o PUT completo reenvia tudo; recusá-lo congelaria a
    // edição INTEIRA do agendamento, que é mais do que a clínica decidiu. O status vai como
    // STRING de propósito (payload form-encoded chega assim — a comparação normaliza).
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT + ASSERT — mesmo status (string) + campo livre mudando
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        [
            'inicio' => '2026-07-01 10:00',
            'profissional_id' => $cena['agendamento']->profissional_id,
            'status_id' => (string) $cena['agendamento']->status_id,
            'obs' => 'Observação fictícia da recepção.',
        ],
    )->assertOk();

    expect($cena['agendamento']->fresh()->obs)->toBe('Observação fictícia da recepção.');
});

it('deve recusar mudar status remarcando para FORA do período no mesmo gesto', function () {
    // ARRANGE — dupla verificação origem→destino (SEC-FC-15): sem ela, "arrasta para fora
    // do ciclo e muda o status" seria o contorno de balcão em UM PUT.
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $statusAnterior = $cena['agendamento']->status_id;

    // ACT — destino 20/07 (aberto); origem 01/07 (fechada) — a origem trava
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        [
            'inicio' => '2026-07-20 10:00',
            'profissional_id' => $cena['agendamento']->profissional_id,
            'status_id' => statusDoCiclo('Finalizado')->id,
        ],
    );

    // ASSERT — recusa, e o agendamento não se moveu nem mudou de status
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    $fresco = $cena['agendamento']->fresh();
    expect($fresco->status_id)->toBe($statusAnterior);
    expect($fresco->inicio->format('Y-m-d'))->toBe('2026-07-01');
});

it('deve deixar o status livre fora do período e sem convênio alcançável (fail-open do D5)', function () {
    // ARRANGE — o atendimento FICA na cena, com `finalizado_em` 01/07 DENTRO da janela:
    // é a prova executável do D1 nesta direção — a competência do status é o `inicio`
    // (20/07, fora), não o `finalizado_em`. Se a guarda decidisse pelo registro clínico,
    // este assertOk reprovaria.
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio('2026-07-20 10:00'); // sessão FORA da janela (16/06–15/07)
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT + ASSERT — com convênio (e atendimento finalizado DENTRO), sessão fora: muda
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        [
            'inicio' => '2026-07-20 10:00',
            'profissional_id' => $cena['agendamento']->profissional_id,
            'status_id' => statusDoCiclo('Finalizado')->id,
        ],
    )->assertOk();

    // ...SEM tratamento, dentro do período: também muda (dinheiro sem operadora não tem calendário)
    $solto = Agendamento::factory()->create();
    $solto->forceFill(['inicio' => '2026-07-01 09:00', 'fim' => '2026-07-01 09:40'])->save();
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$solto->id}",
        [
            'inicio' => '2026-07-01 09:00',
            'profissional_id' => $solto->profissional_id,
            'status_id' => statusDoCiclo('Falta Justificada')->id,
        ],
    )->assertOk();

    // ...e tratamento PARTICULAR, dentro do período: idem — o convênio-particular não
    // tem calendário de ciclo (o "fechado" aqui é da OPERADORA da cena, não dele)
    $particular = Agendamento::factory()->create();
    $convenioParticular = Convenio::create([
        'nome' => 'Particular Fictício '.fake()->unique()->word(),
        'particular' => true,
    ]);
    $tratamentoParticular = Tratamento::factory()->create([
        'convenio_id' => $convenioParticular->id,
        'paciente_id' => $particular->paciente_id,
        'especialidade_id' => $particular->especialidade_id,
        'profissional_id' => $particular->profissional_id,
    ]);
    $particular->forceFill([
        'inicio' => '2026-07-01 11:00',
        'fim' => '2026-07-01 11:40',
        'tratamento_id' => $tratamentoParticular->id,
    ])->save();
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$particular->id}",
        [
            'inicio' => '2026-07-01 11:00',
            'profissional_id' => $particular->profissional_id,
            'status_id' => statusDoCiclo('Falta Justificada')->id,
        ],
    )->assertOk();
});

it('deve recusar pelo `inicio` mesmo com o atendimento finalizado FORA do período', function () {
    // ARRANGE — a outra direção do D1: sessão DENTRO (01/07), registro clínico FORA
    // (20/07). Se a guarda decidisse por `finalizado_em`, esta mudança passaria — e a
    // produção do ciclo enviado mudaria de status.
    $adminDaClinica = admin();
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);
    $cena = cenaDeCiclo('2026-07-20 10:00'); // finalizado FORA da janela
    $cena['agendamento']->forceFill([
        'inicio' => '2026-07-01 10:00',
        'fim' => '2026-07-01 10:40',
    ])->save();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $statusAnterior = $cena['agendamento']->status_id;

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        [
            'inicio' => '2026-07-01 10:00',
            'profissional_id' => $cena['agendamento']->profissional_id,
            'status_id' => statusDoCiclo('Falta Justificada')->id,
        ],
    );

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['agendamento']->fresh()->status_id)->toBe($statusAnterior);
});

it('deve recusar a série inteira quando UMA irmã tem produção em período fechado', function () {
    // ARRANGE — o clicado (10/06, ANTES da janela, sem tratamento) está livre; a irmã
    // (01/07, tratamento do convênio) está congelada. A trava é POR IRMÃ, tudo-ou-nada —
    // as irmãs são gravadas por `$futuro->update()`, fora do resolver (a cena é o ESTADO).
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio();
    $grupo = (string) Str::uuid();
    $clicado = Agendamento::factory()->create();
    $clicado->forceFill([
        'inicio' => '2026-06-10 10:00',
        'fim' => '2026-06-10 10:40',
        'recorrencia_grupo_id' => $grupo,
    ])->save();
    $cena['agendamento']->forceFill(['recorrencia_grupo_id' => $grupo])->save();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $statusDoClicado = $clicado->status_id;
    $statusDaIrma = $cena['agendamento']->fresh()->status_id;

    // ACT — aplicar na série propagando o status (delta zero: mesmo horário)
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$clicado->id}",
        [
            'inicio' => '2026-06-10 10:00',
            'profissional_id' => $clicado->profissional_id,
            'status_id' => statusDoCiclo('Falta Justificada')->id,
            'aplicar_na_serie' => true,
        ],
    );

    // ASSERT — 422 e NADA do lote gravou (nem o clicado, que sozinho estaria livre)
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($clicado->fresh()->status_id)->toBe($statusDoClicado);
    expect($cena['agendamento']->fresh()->status_id)->toBe($statusDaIrma);
});

it('deve recusar a série quando o DELTA desloca uma irmã para dentro do período fechado', function () {
    // ARRANGE — a dupla verificação POR IRMÃ (D4/D5): o clicado (16/07, sem tratamento)
    // está livre em origem e destino; a irmã (17/07, tratamento do convênio) tem origem
    // livre — mas o delta de −2 dias a leva para 15/07, o último dia da janela FECHADA.
    // Um bug no mapa de destinos por irmã passaria verde no teste de delta zero.
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio('2026-07-17 10:00'); // a irmã, com tratamento do convênio
    $cena['atendimento']->delete();
    $grupo = (string) Str::uuid();
    $clicado = Agendamento::factory()->create();
    $clicado->forceFill([
        'inicio' => '2026-07-16 10:00',
        'fim' => '2026-07-16 10:40',
        'recorrencia_grupo_id' => $grupo,
    ])->save();
    $cena['agendamento']->forceFill(['recorrencia_grupo_id' => $grupo])->save();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);
    $statusDaIrma = $cena['agendamento']->fresh()->status_id;

    // ACT — remarca o clicado para 14/07 (delta −2 dias) propagando status novo na série
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$clicado->id}",
        [
            'inicio' => '2026-07-14 10:00',
            'profissional_id' => $clicado->profissional_id,
            'status_id' => statusDoCiclo('Falta Justificada')->id,
            'aplicar_na_serie' => true,
        ],
    );

    // ASSERT — 422 pela IRMÃ (destino 15/07 dentro da janela) e nada gravou
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    $irma = $cena['agendamento']->fresh();
    expect($irma->inicio->format('Y-m-d'))->toBe('2026-07-17');
    expect($irma->status_id)->toBe($statusDaIrma);
    expect($clicado->fresh()->inicio->format('Y-m-d'))->toBe('2026-07-16');
});

it('deve recusar tirar o VÍNCULO de agendamento consumido em período fechado, mesmo sem atendimento', function () {
    // ARRANGE — SEC-TS-02 (parecer): o loop do SEC-FC-13 só enxerga linhas COM atendimento;
    // sem esta perna, `tratamento_id: null` num agendamento CONSUMIDO estornaria a produção
    // congelada em UM gesto (o `reconciliar` estorna quando o vínculo some). O status vai
    // REENVIADO igual — a recusa tem de vir da perna de vínculo, não da de status.
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio();
    $cena['atendimento']->delete();
    $cena['agendamento']->forceFill(['sessao_consumida_em' => '2026-07-01 10:40:00'])->save();
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT — desvincular (null) e trocar para outro tratamento do MESMO convênio
    $desvincular = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        [
            'inicio' => '2026-07-01 10:00',
            'profissional_id' => $cena['agendamento']->profissional_id,
            'status_id' => (string) $cena['agendamento']->status_id,
            'tratamento_id' => null,
        ],
    );

    // ASSERT — 422 na MESMA chave, e o vínculo (e o consumo) permanecem
    $desvincular->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    $fresco = $cena['agendamento']->fresh();
    expect($fresco->tratamento_id)->toBe($cena['tratamento']->id);
    expect($fresco->sessao_consumida_em)->not->toBeNull();
});

it('deve recusar a troca de vínculo pela competência da SESSÃO, não só pela do registro', function () {
    // ARRANGE — o espelho do cenário "Agendamento decide pelo dia da sessão": atendimento
    // FINALIZADO fora da janela (20/07), sessão DENTRO (01/07), consumida. A verificação
    // antiga (só `finalizado_em`) deixaria a troca passar movendo a contagem congelada.
    $adminDaClinica = admin();
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);
    $cena = cenaDeCiclo('2026-07-20 10:00'); // finalizado FORA da janela 16/06–15/07
    $cena['agendamento']->forceFill([
        'inicio' => '2026-07-01 10:00',
        'fim' => '2026-07-01 10:40',
        'sessao_consumida_em' => '2026-07-01 10:40:00',
    ])->save();
    $outroTratamento = Tratamento::factory()->create([
        'convenio_id' => $cena['convenio']->id,
        'paciente_id' => $cena['agendamento']->paciente_id,
        'especialidade_id' => $cena['agendamento']->especialidade_id,
        'profissional_id' => $cena['agendamento']->profissional_id,
    ]);
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        [
            'inicio' => '2026-07-01 10:00',
            'profissional_id' => $cena['agendamento']->profissional_id,
            'status_id' => (string) $cena['agendamento']->status_id,
            'tratamento_id' => $outroTratamento->id,
        ],
    );

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('ciclo_fechado');
    expect($cena['agendamento']->fresh()->tratamento_id)->toBe($cena['tratamento']->id);
});

it('deve deixar a troca de vínculo livre quando a linha não tem consumo nem atendimento', function () {
    // ARRANGE — sem consumo, nada faturável se move com a troca: o fail-open do D5 continua
    // valendo como AUSÊNCIA (a linha nunca entrou na produção do ciclo).
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio();
    $cena['atendimento']->delete(); // sem atendimento e sem consumo (a cena não consome)
    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$cena['agendamento']->id}",
        [
            'inicio' => '2026-07-01 10:00',
            'profissional_id' => $cena['agendamento']->profissional_id,
            'status_id' => (string) $cena['agendamento']->status_id,
            'tratamento_id' => null,
        ],
    )->assertOk();

    expect($cena['agendamento']->fresh()->tratamento_id)->toBeNull();
});

it('deve expor em_ciclo_fechado no DETALHE do agendamento, e nunca no card da grade', function () {
    // ARRANGE — SEC-FC-09, agora no 4º módulo: booleano DERIVADO por (tratamento, inicio),
    // só no `show` (a grade não paga por N leituras de fechamento e não vira oráculo).
    $adminDaClinica = admin();
    $cena = cenaDeCicloComInicio();

    // ACT + ASSERT — antes de fechar: false
    $this->actingAs($adminDaClinica)
        ->getJson("/api/agendamentos/{$cena['agendamento']->id}")
        ->assertOk()->assertJsonPath('em_ciclo_fechado', false);

    fecharJanelaDeJulho($cena['convenio'], $adminDaClinica);

    // depois: true — e o payload segue sem período, calendário ou fechamentos
    $detalhe = $this->actingAs($adminDaClinica)
        ->getJson("/api/agendamentos/{$cena['agendamento']->id}")->assertOk();
    $detalhe->assertJsonPath('em_ciclo_fechado', true);
    $detalhe->assertJsonMissingPath('periodo_inicio')->assertJsonMissingPath('fechamentos');

    // sem tratamento não há convênio: false mesmo com a janela fechada
    $solto = Agendamento::factory()->create();
    $solto->forceFill(['inicio' => '2026-07-01 09:00', 'fim' => '2026-07-01 09:40'])->save();
    $this->actingAs($adminDaClinica)->getJson("/api/agendamentos/{$solto->id}")
        ->assertOk()->assertJsonPath('em_ciclo_fechado', false);

    // ...e o card do PERÍODO (a grade) não carrega o booleano
    $cards = $this->actingAs($adminDaClinica)
        ->getJson('/api/agenda?de=2026-07-01&ate=2026-07-01')
        ->assertOk()->json();
    semVazamento($cards, 'em_ciclo_fechado');
});
