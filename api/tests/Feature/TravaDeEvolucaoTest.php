<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Evolucao;
use App\Models\Profissional;
use App\Models\Usuario;
use App\Support\Clinica\EvolucoesEmAberto;
use App\Support\Configuracoes\ConfiguracaoService;

/**
 * A TRAVA da evolução vencida (change trava-de-evolucao — FA-10, decisão da clínica
 * 2026-07-19): a escrita da evolução nunca é recusada por atraso; quem coage é o
 * FINALIZAR — profissional com evolução vencida há mais de `trava_carencia_dias` além
 * do prazo não registra novas sessões até quitar. Guarda (D1), aviso computado (D3) e
 * o teste CRUZADO que prende os dois no mesmo dia. Regra é DADO (§13): prazo e
 * carência entram por configuração. LGPD: dados 100% fictícios.
 */

/** Liga prazo/carência do cenário — regra é DADO, o teste a escreve como a clínica. */
function configurarTrava(int $prazoDias, int $carenciaDias): void
{
    app(ConfiguracaoService::class)->set('evolucoes.prazo_dias', $prazoDias);
    app(ConfiguracaoService::class)->set('evolucoes.trava_carencia_dias', $carenciaDias);
}

/** Pendência: atendimento SEM evolução de $prof, finalizado há $diasAtras dias (parede da clínica). */
function pendenciaVencivelDe(Profissional $prof, int $diasAtras): Atendimento
{
    $inicio = agoraNaClinica()->subDays($diasAtras)->setTime(9, 0);
    $agendamento = Agendamento::factory()->create([
        'profissional_id' => $prof->id,
        'inicio' => $inicio,
        'fim' => $inicio->copy()->addMinutes(40),
    ]);

    return Atendimento::factory()->create([
        'agendamento_id' => $agendamento->id,
        'finalizado_em' => $inicio->copy()->addMinutes(40)->format('Y-m-d H:i'),
    ]);
}

/** Agendamento novo de $prof pronto para FINALIZAR (registrar o atendimento). */
function sessaoParaFinalizarDe(Profissional $prof): Agendamento
{
    return Agendamento::factory()->create(['profissional_id' => $prof->id]);
}

/** Quita a pendência direto no banco (evolução assinada pelo próprio profissional). */
function quitarPendenciaDe(Atendimento $atendimento, Profissional $autor): void
{
    $evolucao = new Evolucao([
        'profissional_id' => $autor->id,
        'conteudo' => 'Evolução clínica fictícia da sessão.',
    ]);
    $evolucao->atendimento_id = $atendimento->id;
    $evolucao->preenchida_em = agoraNaClinica()->format('Y-m-d H:i');
    $evolucao->save();
}

/**
 * Usuário ESCOPADO ao profissional (sem flags ver_todos), com o leque da trava.
 * Chame ANTES de qualquer request do teste: a primeira request autenticada troca o
 * guard default para sanctum, e um nível criado depois nasce no guard errado.
 */
function escopadoDaTrava(Profissional $prof, string $nivel): Usuario
{
    $usuario = usuarioCom(['atendimentos.criar', 'evolucoes.ver', 'evolucoes.criar'], $nivel);
    $usuario->update(['profissional_id' => $prof->id]);

    return $usuario;
}

// ============================ O CORTE (task 2.2 — fonte única, D1) ============================

it('deve cortar as vencidas além da carência exatamente em prazo+carência, inclusivo no dia-limite', function () {
    // ARRANGE — prazo 6 + carência 3 (o cenário do go-live), via config
    admin();
    configurarTrava(6, 3);
    $prof = Profissional::factory()->create();
    $outroProf = Profissional::factory()->create();
    $noDiaLimite = pendenciaVencivelDe($prof, 9);       // prazo+carência exatos: ainda NÃO conta
    $alemDaCarencia = pendenciaVencivelDe($prof, 10);   // um dia além: conta
    $quitada = pendenciaVencivelDe($prof, 12);          // além, mas evoluída: não é pendência
    quitarPendenciaDe($quitada, $prof);
    $deOutro = pendenciaVencivelDe($outroProf, 10);     // além, mas de OUTRO profissional

    // ACT — a consulta canônica da trava
    $ids = app(EvolucoesEmAberto::class)->vencidasAlemDaCarencia($prof->id)->pluck('id');

    // ASSERT — o corte é exato, por profissional, e evolução registrada quita
    expect($ids)->toContain($alemDaCarencia->id)
        ->not->toContain($noDiaLimite->id)
        ->not->toContain($quitada->id)
        ->not->toContain($deOutro->id);
});

// ============================ A GUARDA DO FINALIZAR (task 2.3 — D1/D5) ============================

it('deve travar o finalizar do profissional com evolução vencida além da carência', function () {
    // ARRANGE — pendência um dia além da carência; o próprio profissional tenta finalizar
    admin();
    configurarTrava(6, 3);
    $prof = Profissional::factory()->create();
    pendenciaVencivelDe($prof, 10);
    $sessaoNova = sessaoParaFinalizarDe($prof);
    $escopado = escopadoDaTrava($prof, 'Profissional Travado Fictício');

    // ACT
    $resposta = $this->actingAs($escopado)
        ->postJson("/api/agendamentos/{$sessaoNova->id}/atendimento", []);

    // ASSERT — 422 legível com a contagem, e NADA gravado
    $resposta->assertUnprocessable()->assertJsonValidationErrors('evolucoes_vencidas');
    expect($resposta->json('errors.evolucoes_vencidas.0'))
        ->toContain('1 evolução vencida')
        ->toContain('registre as evoluções pendentes');
    expect(Atendimento::where('agendamento_id', $sessaoNova->id)->exists())->toBeFalse();
});

it('deve recusar igualmente quando a recepção finaliza pelo profissional travado', function () {
    // ARRANGE — a trava é do profissional do AGENDAMENTO, nunca de quem clica (D5):
    // o admin (plano, sem pendência própria) não contorna a trava de ninguém
    $adminDaClinica = admin();
    configurarTrava(6, 3);
    $prof = Profissional::factory()->create();
    pendenciaVencivelDe($prof, 10);
    pendenciaVencivelDe($prof, 15);
    $sessaoNova = sessaoParaFinalizarDe($prof);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$sessaoNova->id}/atendimento", []);

    // ASSERT — o mesmo 422, com a contagem no plural
    $resposta->assertUnprocessable()->assertJsonValidationErrors('evolucoes_vencidas');
    expect($resposta->json('errors.evolucoes_vencidas.0'))->toContain('2 evoluções vencidas');
});

it('deve finalizar normalmente dentro da carência — a coação ainda é o aviso', function () {
    // ARRANGE — vencidas há ≤ carência (inclusive o dia-limite exato) não travam
    $adminDaClinica = admin();
    configurarTrava(6, 3);
    $prof = Profissional::factory()->create();
    pendenciaVencivelDe($prof, 7); // vencida há 1 dia (dentro da carência)
    pendenciaVencivelDe($prof, 9); // o dia-limite exato de prazo+carência
    $sessaoNova = sessaoParaFinalizarDe($prof);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$sessaoNova->id}/atendimento", [])
        ->assertCreated();
});

it('deve destravar o finalizar imediatamente quando as vencidas são quitadas', function () {
    // ARRANGE — travado; a evolução ATRASADA é aceita (D2) e é o que destrava
    $adminDaClinica = admin();
    configurarTrava(6, 3);
    $prof = Profissional::factory()->create();
    $pendencia = pendenciaVencivelDe($prof, 10);
    $sessaoNova = sessaoParaFinalizarDe($prof);
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$sessaoNova->id}/atendimento", [])
        ->assertUnprocessable();

    // ACT — registrar a evolução vencida (a escrita nunca é recusada por atraso)
    $this->actingAs($adminDaClinica)
        ->postJson("/api/atendimentos/{$pendencia->id}/evolucao", [
            'profissional_id' => $prof->id,
            'conteudo' => 'Evolução fictícia registrada com atraso.',
            'motivo_assinatura' => 'Registro administrativo em teste.',
        ])->assertCreated();

    // ASSERT — quitou, finalizou
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$sessaoNova->id}/atendimento", [])
        ->assertCreated();
});

it('deve ignorar bloqueios e agendamentos sem atendimento na contagem da trava', function () {
    // ARRANGE — pendência é atendimento SEM evolução (D5): agendamento antigo nunca
    // atendido e bloqueio de agenda não entram na conta
    $adminDaClinica = admin();
    configurarTrava(6, 3);
    $prof = Profissional::factory()->create();
    $inicioAntigo = agoraNaClinica()->subDays(150)->setTime(9, 0);
    Agendamento::factory()->create([
        'profissional_id' => $prof->id,
        'inicio' => $inicioAntigo,
        'fim' => $inicioAntigo->copy()->addMinutes(40),
    ]);
    Agendamento::factory()->create([
        'tipo' => 'bloqueio', 'paciente_id' => null,
        'especialidade_id' => null, 'status_id' => null,
        'profissional_id' => $prof->id,
        'inicio' => $inicioAntigo->copy()->addHours(2),
        'fim' => $inicioAntigo->copy()->addHours(3),
    ]);
    $sessaoNova = sessaoParaFinalizarDe($prof);

    // ACT + ASSERT — nada disso trava o finalizar
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$sessaoNova->id}/atendimento", [])
        ->assertCreated();
});

it('deve travar já no dia seguinte ao vencimento quando a carência é zero', function () {
    // ARRANGE — D4: carência 0 = trava logo após o próprio vencimento
    $adminDaClinica = admin();
    configurarTrava(6, 0);
    $prof = Profissional::factory()->create();
    pendenciaVencivelDe($prof, 7); // vencida há 1 dia — já além da carência zero
    $sessaoNova = sessaoParaFinalizarDe($prof);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->postJson("/api/agendamentos/{$sessaoNova->id}/atendimento", [])
        ->assertUnprocessable()->assertJsonValidationErrors('evolucoes_vencidas');
});

// ============================ O AVISO DO CENTRO (task 2.4 — D3) ============================

it('deve avisar o escopado com a contagem de vencidas e os dias até a trava', function () {
    // ARRANGE — o cenário verbatim da spec (e da clínica): vencida há 1 dia com
    // carência de 3 → "será bloqueado em 3 dias" (prazo 6; finalizado há 7 dias)
    admin();
    configurarTrava(6, 3);
    $prof = Profissional::factory()->create();
    pendenciaVencivelDe($prof, 7);
    pendenciaVencivelDe($prof, 2); // em aberto DENTRO do prazo: conta no total, não no aviso
    $escopado = escopadoDaTrava($prof, 'Profissional Avisado Fictício');

    // ACT
    $bloco = $this->actingAs($escopado)->getJson('/api/notificacoes')
        ->assertOk()->json('evolucoes_em_aberto');

    // ASSERT — vencidas é o subconjunto vencido; os dias contam até o primeiro dia travado
    expect($bloco['total'])->toBe(2)
        ->and($bloco['vencidas'])->toBe(1)
        ->and($bloco['bloqueio_em_dias'])->toBe(3);
});

it('deve avisar zero dias quando o finalizar já está travado', function () {
    // ARRANGE — vencida além da carência: o aviso vira "travado até quitar"
    admin();
    configurarTrava(6, 3);
    $prof = Profissional::factory()->create();
    pendenciaVencivelDe($prof, 10);
    $escopado = escopadoDaTrava($prof, 'Profissional Já Travado Fictício');

    // ACT
    $bloco = $this->actingAs($escopado)->getJson('/api/notificacoes')
        ->assertOk()->json('evolucoes_em_aberto');

    // ASSERT — piso 0, nunca negativo
    expect($bloco['vencidas'])->toBe(1)
        ->and($bloco['bloqueio_em_dias'])->toBe(0);
});

it('deve não alarmar o escopado sem evolução vencida', function () {
    // ARRANGE — pendências só DENTRO do prazo: nada pode sugerir bloqueio
    admin();
    configurarTrava(6, 3);
    $prof = Profissional::factory()->create();
    pendenciaVencivelDe($prof, 2);
    $escopado = escopadoDaTrava($prof, 'Profissional Em Dia Fictício');

    // ACT
    $bloco = $this->actingAs($escopado)->getJson('/api/notificacoes')
        ->assertOk()->json('evolucoes_em_aberto');

    // ASSERT — o total em aberto segue; o aviso não existe (null, não 0 dias)
    expect($bloco['total'])->toBe(1)
        ->and($bloco['vencidas'])->toBe(0)
        ->and($bloco['bloqueio_em_dias'])->toBeNull();
});

it('deve omitir os campos de aviso para quem não é escopado a um profissional', function () {
    // ARRANGE — D3: o aviso é "o SEU finalizar será travado", não painel gerencial.
    // Plano (admin) e escopado SEM vínculo não ganham os campos — ausência, não zero.
    // Usuários nascem ANTES de qualquer request (a primeira request troca o guard
    // default para sanctum, e papel criado depois nasce no guard errado).
    $adminDaClinica = admin();
    configurarTrava(6, 3);
    pendenciaVencivelDe(Profissional::factory()->create(), 10);
    $semVinculo = usuarioCom(['evolucoes.ver'], 'Clínico Sem Vínculo Fictício');

    // ACT + ASSERT — plano vê a fila, sem os campos da trava
    $blocoDoPlano = $this->actingAs($adminDaClinica)->getJson('/api/notificacoes')
        ->assertOk()->json('evolucoes_em_aberto');
    expect($blocoDoPlano['total'])->toBe(1)
        ->and($blocoDoPlano)->not->toHaveKey('vencidas')
        ->and($blocoDoPlano)->not->toHaveKey('bloqueio_em_dias');

    // sem vínculo (fail-closed): fila vazia e nenhum aviso
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $blocoSemVinculo = $this->actingAs($semVinculo)->getJson('/api/notificacoes')
        ->assertOk()->json('evolucoes_em_aberto');
    expect($blocoSemVinculo['total'])->toBe(0)
        ->and($blocoSemVinculo)->not->toHaveKey('vencidas')
        ->and($blocoSemVinculo)->not->toHaveKey('bloqueio_em_dias');
});

// ============================ O TESTE CRUZADO (D1 × D3 — mesmo dia, mesma fonte) ============================

it('deve começar o 422 do finalizar exatamente no dia em que o aviso chega a zero', function () {
    // ARRANGE — dois profissionais simulam dois dias consecutivos da MESMA pendência:
    // no dia-limite (prazo+carência) o aviso diz 1 e o finalizar passa; um dia além,
    // o aviso diz 0 e o 422 começa. Aviso e guarda derivam da mesma fonte (D1/D3) —
    // este teste é o que impede as duas derivações de divergirem por um dia.
    admin();
    configurarTrava(6, 3);
    $profNoLimite = Profissional::factory()->create();
    pendenciaVencivelDe($profNoLimite, 9);
    $sessaoDoNoLimite = sessaoParaFinalizarDe($profNoLimite);
    $profTravado = Profissional::factory()->create();
    pendenciaVencivelDe($profTravado, 10);
    $sessaoDoTravado = sessaoParaFinalizarDe($profTravado);
    // os dois escopados nascem ANTES de qualquer request (a primeira request troca o
    // guard default para sanctum, e papel criado depois nasce no guard errado)
    $escopadoNoLimite = escopadoDaTrava($profNoLimite, 'Profissional Na Véspera Fictício');
    $escopadoTravado = escopadoDaTrava($profTravado, 'Profissional No Dia Zero Fictício');

    // ACT + ASSERT — véspera: aviso 1, finalizar aceito
    $blocoNoLimite = $this->actingAs($escopadoNoLimite)->getJson('/api/notificacoes')
        ->assertOk()->json('evolucoes_em_aberto');
    expect($blocoNoLimite['bloqueio_em_dias'])->toBe(1);
    $this->actingAs($escopadoNoLimite)
        ->postJson("/api/agendamentos/{$sessaoDoNoLimite->id}/atendimento", [])
        ->assertCreated();

    // dia seguinte: aviso 0, finalizar recusado
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $blocoTravado = $this->actingAs($escopadoTravado)->getJson('/api/notificacoes')
        ->assertOk()->json('evolucoes_em_aberto');
    expect($blocoTravado['bloqueio_em_dias'])->toBe(0);
    $this->actingAs($escopadoTravado)
        ->postJson("/api/agendamentos/{$sessaoDoTravado->id}/atendimento", [])
        ->assertUnprocessable()->assertJsonValidationErrors('evolucoes_vencidas');
});
