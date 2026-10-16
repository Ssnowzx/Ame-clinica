<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;

/**
 * Agendamento passado do paciente num status — direto no banco (sem a validação
 * da agenda), com FKs FIXAS para não disparar as closures da factory.
 */
function comparecimentoDe(Paciente $paciente, StatusAgendamento $status, Carbon\Carbon $quando, array $extra = []): Agendamento
{
    return Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'status_id' => $status->id,
        'inicio' => $quando->copy()->setSeconds(0),
        'fim' => $quando->copy()->setSeconds(0)->addMinutes(40),
        ...$extra,
    ]);
}

// ── Feature 2 — comparecimento recente (90 dias) ─────────────────────────────

describe('comparecimento recente do paciente (90 dias)', function () {
    it('deve listar o comparecimento recente minimizado, do mais recente ao mais antigo', function () {
        // ARRANGE — dois atendimentos passados do paciente, um deles com obs clínica
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create(['nome' => 'Paciente Fictício']);
        $status = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
        $especialidade = Especialidade::factory()->create(['nome' => 'Fonoaudiologia', 'cor' => '#448247']);
        $profissional = Profissional::factory()->create(['nome' => 'Profissional Fictício']);

        comparecimentoDe($paciente, $status, agoraNaClinica()->subDays(20), [
            'especialidade_id' => $especialidade->id,
            'profissional_id' => $profissional->id,
            'obs' => 'Segredo clínico que não pode vazar.',
        ]);
        comparecimentoDe($paciente, $status, agoraNaClinica()->subDays(3), [
            'especialidade_id' => $especialidade->id,
            'profissional_id' => $profissional->id,
        ]);

        // ACT
        $resposta = $this->getJson("/api/pacientes/{$paciente->id}/comparecimento-recente");

        // ASSERT — ordenado desc, só a whitelist, e NADA de conteúdo clínico
        $resposta->assertOk();
        $itens = $resposta->json('itens');
        expect($itens)->toHaveCount(2)
            ->and($itens[0]['data'])->toBe(agoraNaClinica()->subDays(3)->format('Y-m-d'))
            ->and($itens[1]['data'])->toBe(agoraNaClinica()->subDays(20)->format('Y-m-d'))
            ->and($itens[0])->toHaveKeys(['id', 'data', 'especialidade', 'profissional', 'status'])
            ->and($itens[0])->not->toHaveKey('obs')
            ->and($itens[0]['especialidade'])->toEqual(['id' => $especialidade->id, 'nome' => 'Fonoaudiologia', 'cor' => '#448247'])
            ->and($itens[0]['profissional'])->toEqual(['id' => $profissional->id, 'nome' => 'Profissional Fictício'])
            ->and($itens[0]['status'])->toHaveKeys(['id', 'nome', 'cor', 'cor_borda', 'tipo']);
        semVazamento($resposta->json(), 'Segredo clínico');
    });

    it('deve trazer só os últimos 90 dias e nunca o futuro', function () {
        // ARRANGE — dentro (89d), fora por antiguidade (91d) e fora por ser futuro
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        comparecimentoDe($paciente, $status, agoraNaClinica()->subDays(89));
        comparecimentoDe($paciente, $status, agoraNaClinica()->subDays(91));
        comparecimentoDe($paciente, $status, agoraNaClinica()->addDays(2));

        // ACT
        $itens = $this->getJson("/api/pacientes/{$paciente->id}/comparecimento-recente")->json('itens');

        // ASSERT — só o de 89 dias
        expect($itens)->toHaveCount(1)
            ->and($itens[0]['data'])->toBe(agoraNaClinica()->subDays(89)->format('Y-m-d'));
    });

    it('deve limitar a lista a um teto de linhas', function () {
        // ARRANGE — mais que o teto, FKs fixas (nada de N models por linha)
        $this->actingAs(admin());
        $paciente = Paciente::factory()->create();
        $status = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        $especialidade = Especialidade::factory()->create();
        $profissional = Profissional::factory()->create();
        Agendamento::factory()->count(201)->sequence(fn ($seq) => [
            'inicio' => agoraNaClinica()->subHours($seq->index + 1)->setSeconds(0),
            'fim' => agoraNaClinica()->subHours($seq->index + 1)->setSeconds(0)->addMinutes(40),
        ])->create([
            'paciente_id' => $paciente->id,
            'status_id' => $status->id,
            'especialidade_id' => $especialidade->id,
            'profissional_id' => $profissional->id,
        ]);

        // ACT + ASSERT — a resposta é limitada (teto 200), nunca a agenda inteira
        $itens = $this->getJson("/api/pacientes/{$paciente->id}/comparecimento-recente")->json('itens');
        expect($itens)->toHaveCount(200);
    });

    it('deve exigir a permissão agenda.ver', function () {
        // ARRANGE — usuário sem agenda.ver
        $admin = admin();
        $paciente = Paciente::factory()->create();
        $semAgenda = usuarioCom(['pacientes.ver'], 'Sem Agenda');

        // ACT + ASSERT
        $this->actingAs($semAgenda)
            ->getJson("/api/pacientes/{$paciente->id}/comparecimento-recente")
            ->assertForbidden();
    });
});

// ── Feature 3 — alerta de faltas consecutivas ────────────────────────────────

describe('alerta de faltas consecutivas no detalhe do agendamento', function () {
    it('deve alertar ao atingir N faltas seguidas e reiniciar no comparecimento', function () {
        // ARRANGE — 3 faltas seguidas (N default 3)
        $this->actingAs(admin());
        $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
        expect($naoCompareceu->marca_falta)->toBeTrue();
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        $paciente = Paciente::factory()->create();
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(21));
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(14));
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(7));
        // o agendamento em VISTA é um futuro do mesmo paciente (não entra na contagem)
        $emVista = comparecimentoDe($paciente, $emAberto, agoraNaClinica()->addDays(2));

        // ACT + ASSERT — o alerta dispara, com N da clínica
        $alerta = $this->getJson("/api/agendamentos/{$emVista->id}")->json('alerta_faltas');
        expect($alerta)->toEqual(['consecutivas' => 3, 'limite' => 3]);

        // um comparecimento MAIS RECENTE reinicia a contagem — o alerta some
        comparecimentoDe($paciente, $emAberto, agoraNaClinica()->subDays(1));
        expect($this->getJson("/api/agendamentos/{$emVista->id}")->json('alerta_faltas'))->toBeNull();
    });

    it('deve reiniciar a contagem quando há um comparecimento no meio das faltas', function () {
        // ARRANGE — por recência: falta · compareceu · falta · falta
        $this->actingAs(admin());
        $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        $paciente = Paciente::factory()->create();
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(20));
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(15));
        comparecimentoDe($paciente, $emAberto, agoraNaClinica()->subDays(10)); // quebra
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(5));
        $emVista = comparecimentoDe($paciente, $emAberto, agoraNaClinica()->addDays(2));

        // ACT + ASSERT — só 1 falta consecutiva na ponta, abaixo do limite
        expect($this->getJson("/api/agendamentos/{$emVista->id}")->json('alerta_faltas'))->toBeNull();
    });

    it('deve respeitar o N configurado pela clínica (DADO, §13)', function () {
        // ARRANGE — a clínica baixa o limite para 2; 2 faltas passam a alertar
        $this->actingAs(admin());
        $this->putJsonComVersao('/api/configuracoes', [
            'chave' => 'agenda.faltas_consecutivas_limite',
            'valor' => 2,
        ])->assertOk();
        $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        $paciente = Paciente::factory()->create();
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(9));
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(4));
        $emVista = comparecimentoDe($paciente, $emAberto, agoraNaClinica()->addDays(2));

        // ACT + ASSERT — o limite da clínica (2) decide, nunca o default 3
        expect($this->getJson("/api/agendamentos/{$emVista->id}")->json('alerta_faltas'))
            ->toEqual(['consecutivas' => 2, 'limite' => 2]);
    });

    it('deve ignorar faltas fora da janela recente (mais de um ano)', function () {
        // ARRANGE — 3 faltas seguidas, mas TODAS há mais de um ano: não é "recente" (Decisão 3)
        $this->actingAs(admin());
        $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        $paciente = Paciente::factory()->create();
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(400));
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(395));
        comparecimentoDe($paciente, $naoCompareceu, agoraNaClinica()->subDays(390));
        $emVista = comparecimentoDe($paciente, $emAberto, agoraNaClinica()->addDays(2));

        // ACT + ASSERT — fora da janela, sem alerta
        expect($this->getJson("/api/agendamentos/{$emVista->id}")->json('alerta_faltas'))->toBeNull();
    });

    it('deve não trazer alerta para bloqueio (sem paciente)', function () {
        // ARRANGE — bloqueio de agenda não tem criança
        $this->actingAs(admin());
        $bloqueio = Agendamento::factory()->create(['tipo' => 'bloqueio', 'paciente_id' => null]);

        // ACT + ASSERT — a chave existe, mas é nula
        $resposta = $this->getJson("/api/agendamentos/{$bloqueio->id}");
        $resposta->assertOk();
        expect($resposta->json('alerta_faltas'))->toBeNull();
    });
});
