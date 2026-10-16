<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;

/**
 * GUARDA MECÂNICA do gatilho NECESSIDADE-CARD (parecer SEC-NC-01).
 *
 * O painel expõe o marcador de "necessidade especial" (dado de saúde de MENOR, art. 11) a
 * partir de um sinal MINIMIZADO no `show` do agendamento — um BOOLEANO derivado
 * (`necessidade_especial`), sob demanda, per-agendamento. Estas guardas afirmam sobre a
 * RESPOSTA HTTP real (o produto, SEC-TR-18):
 *
 *  - POSITIVA de VALOR e FORMA: o `show` traz o booleano certo (true/false/null) E o payload
 *    NÃO contém a chave `necessidade` (enum cru) nem um objeto `paciente` — trava o corolário
 *    de alguém trocar `escalares()` por `toArray()` e ressuscitar o cadastro (SEC-NC-03/04a).
 *  - NEGATIVA: a GRADE (`periodo()/cartao()`, que roda para todos os agendamentos do dia) NÃO
 *    expõe `necessidade`/`necessidade_especial` — a exposição é só per-agendamento (SEC-NC-02).
 *
 * A 3ª guarda (WhitelistDoMenorTest permanece verde, provando que `ResumoDoPaciente::CAMPOS`
 * segue com id/nome/nome_social) vive no seu próprio arquivo de Arquitetura.
 */
function agendamentoComPaciente(Paciente $paciente): Agendamento
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();

    return Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'paciente_id' => $paciente->id,
        'especialidade_id' => $especialidade->id,
        'profissional_id' => $profissional->id,
        'status_id' => StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail()->id,
        'inicio' => agoraNaClinica()->copy()->addDay()->setTime(8, 0)->setSeconds(0),
        'fim' => agoraNaClinica()->copy()->addDay()->setTime(8, 40)->setSeconds(0),
    ]);
}

it('deve expor necessidade_especial=true no show, minimizado (sem enum cru, sem objeto paciente)', function () {
    // ARRANGE — paciente com necessidade especial (dado de saúde, art. 11)
    $admin = admin();
    $paciente = Paciente::factory()->create(['necessidade' => 'necessidades_especiais']);
    $agendamento = agendamentoComPaciente($paciente);

    // ACT
    $resposta = $this->actingAs($admin)->getJson("/api/agendamentos/{$agendamento->id}")->assertOk();

    // ASSERT — VALOR: o flag booleano
    expect($resposta->json('necessidade_especial'))->toBeTrue();
    // FORMA (SEC-NC-04a): nem o enum cru, nem um objeto paciente cruzam o payload
    expect($resposta->json('necessidade'))->toBeNull()
        ->and($resposta->json('paciente'))->toBeNull();
    expect($resposta->getContent())->not->toContain('necessidades_especiais');
});

it('deve expor necessidade_especial=false quando o paciente não tem necessidade especial', function () {
    // ARRANGE — 'outros' NÃO é a categoria marcada (só 'necessidades_especiais' é true)
    $admin = admin();
    $paciente = Paciente::factory()->create(['necessidade' => 'outros']);
    $agendamento = agendamentoComPaciente($paciente);

    // ACT + ASSERT
    $resposta = $this->actingAs($admin)->getJson("/api/agendamentos/{$agendamento->id}")->assertOk();
    expect($resposta->json('necessidade_especial'))->toBeFalse();
    // 'outros' também é categoria de saúde — não pode vazar em claro
    expect($resposta->getContent())->not->toContain('"necessidade"');
});

it('deve expor necessidade_especial=null para bloqueio (sem paciente)', function () {
    // ARRANGE — bloqueio de agenda não tem criança
    $admin = admin();
    $bloqueio = Agendamento::factory()->create(['tipo' => 'bloqueio', 'paciente_id' => null]);

    // ACT + ASSERT
    $resposta = $this->actingAs($admin)->getJson("/api/agendamentos/{$bloqueio->id}")->assertOk();
    expect($resposta->json('necessidade_especial'))->toBeNull();
});

it('deve NÃO expor necessidade no card da grade (só per-agendamento no show)', function () {
    // ARRANGE — paciente com necessidade especial, num agendamento visível na grade
    $admin = admin();
    $paciente = Paciente::factory()->create(['necessidade' => 'necessidades_especiais']);
    $agendamento = agendamentoComPaciente($paciente);
    $dia = $agendamento->inicio->format('Y-m-d');

    // ACT — a grade roda cartao() para TODOS os agendamentos do dia
    $resposta = $this->actingAs($admin)->getJson("/api/agenda?de={$dia}&ate={$dia}")->assertOk();

    // ASSERT — o card identifica o paciente (nome), mas NÃO carrega necessidade nem o flag,
    // e o valor de saúde não aparece em lugar nenhum do corpo
    $card = $resposta->json('0');
    expect($card['paciente'])->not->toBeNull();
    expect($card['paciente'])->not->toHaveKey('necessidade');
    expect($card)->not->toHaveKey('necessidade_especial');
    expect($resposta->getContent())->not->toContain('necessidades_especiais');
});
