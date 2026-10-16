<?php

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Agenda\ConsumoSessaoService;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;

/**
 * Cenário coerente para consumo: paciente + especialidade + profissional
 * vinculado + tratamento em andamento. Agendamento HOJE 00:00 na parede da
 * clínica (retroativo ligado) — mesma data, nunca futura: a guarda D9/P1 não
 * interfere. O PUT da agenda exige o payload central (contrato da etapa 5).
 */
function cenarioDeConsumo(int $sessoesTotal = 10, string $hora = '00:00'): array
{
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);

    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);
    $paciente = Paciente::factory()->create();
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'especialidade_id' => $especialidade->id,
        'profissional_id' => $profissional->id,
        'sessoes_total' => $sessoesTotal,
    ]);

    return [[
        'paciente_id' => $paciente->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'tratamento_id' => $tratamento->id,
        'inicio' => agoraNaClinica()->format('Y-m-d').' '.$hora,
    ], $tratamento];
}

function statusPorNome(string $nome): StatusAgendamento
{
    return StatusAgendamento::where('nome', $nome)->firstOrFail();
}

it('deve consumir ao mudar para status que desconta e registrar o marcador e a trilha', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);
    $criado->assertCreated(); // status default "Em Aberto" não desconta
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(0);

    // ACT — transição para status descontante
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$payload, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertOk();

    // ASSERT — consumo + marcador na mesma transação; diff do tratamento em claro
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);
    expect(Agendamento::find($criado->json('id'))->sessao_consumida_em)->not->toBeNull();
    $diff = Auditoria::where('entidade', 'tratamentos')->where('acao', 'atualizou')
        ->latest('id')->firstOrFail()->diff_json;
    expect($diff['depois']['sessoes_realizadas'])->toBe(1);
});

it('deve estornar ao deixar de descontar e terminar +1 no ciclo desconta-não-desconta', function () {
    // ARRANGE — criação já descontante consome (registro retroativo da recepção)
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo();
    $id = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertCreated()->json('id');
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);

    // ACT + ASSERT — estorno (passa por 0) e novo consumo (idempotência do marcador)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$id}", [
        ...$payload, 'status_id' => statusPorNome('Falta Justificada')->id,
    ])->assertOk();
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(0);
    expect(Agendamento::find($id)->sessao_consumida_em)->toBeNull();

    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$id}", [
        ...$payload, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertOk();
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);
});

it('deve manter exatamente uma sessão com transições concorrentes do mesmo agendamento', function () {
    // ARRANGE — duas "requests" carregam o MESMO agendamento ANTES de qualquer
    // commit (gate r1, CR-01): o interleaving determinístico do lost update
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo();
    $id = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload)
        ->assertCreated()->json('id');
    $finalizado = statusPorNome('Finalizado')->id;

    $requisicaoA = Agendamento::find($id);
    $requisicaoB = Agendamento::find($id); // stale após a request A commitar
    $servico = app(ConsumoSessaoService::class);

    // ACT — cada request na sua transação, como no controller
    foreach ([$requisicaoA, $requisicaoB] as $requisicao) {
        DB::transaction(function () use ($requisicao, $finalizado, $servico): void {
            $requisicao->update(['status_id' => $finalizado]);
            $servico->reconciliar($requisicao, $requisicao->tratamento_id);
        });
    }

    // ASSERT — o marcador é relido sob lock: exatamente +1
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);

    // e um segundo PUT idêntico via API também é no-op (SEC-ate-02)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$id}", [
        ...$payload, 'status_id' => $finalizado,
    ])->assertOk();
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);
});

it('deve manter a coerência do tratamento mesmo em agendamento consumido', function () {
    // ARRANGE — consumido do tratamento do paciente A (gate r1, CR-02)
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo();
    $id = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertCreated()->json('id');
    $pacienteB = Paciente::factory()->create();

    // ACT + ASSERT — trocar o paciente mantendo o tratamento do paciente A → 422
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$id}", [
        ...$payload, 'paciente_id' => $pacienteB->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');
    expect(Agendamento::find($id)->paciente_id)->toBe($payload['paciente_id']);
});

it('deve migrar o consumo quando a edição troca só o tratamento', function () {
    // ARRANGE — consumido do tratamento A; tratamento B coerente (mesmo paciente/especialidade)
    $adminDaClinica = admin();
    [$payload, $tratamentoA] = cenarioDeConsumo();
    $tratamentoB = Tratamento::factory()->create([
        'paciente_id' => $payload['paciente_id'],
        'especialidade_id' => $payload['especialidade_id'],
        'profissional_id' => $payload['profissional_id'],
        'sessoes_total' => 5,
    ]);
    $id = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertCreated()->json('id');

    // ACT — sem reenviar status: o estado final o preserva (lição da etapa 5)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$id}", [
        ...$payload, 'tratamento_id' => $tratamentoB->id,
    ])->assertOk();

    // ASSERT — estorna do antigo, consome do novo, na mesma transação
    expect($tratamentoA->refresh()->sessoes_realizadas)->toBe(0);
    expect($tratamentoB->refresh()->sessoes_realizadas)->toBe(1);
    expect(Agendamento::find($id)->sessao_consumida_em)->not->toBeNull();
});

it('deve estornar na conversão para bloqueio', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo();
    $id = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertCreated()->json('id');

    // ACT — conversão limpa vínculos clínicos no estado final (agenda B3)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$id}", [
        'tipo' => 'bloqueio',
        'inicio' => $payload['inicio'],
        'profissional_id' => $payload['profissional_id'],
    ])->assertOk();

    // ASSERT
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(0);
    expect(Agendamento::find($id)->sessao_consumida_em)->toBeNull();

    // com atendimento registrado a conversão é bloqueada (CR-04): bloqueio
    // nunca carrega vínculo clínico — e atendimento É vínculo clínico
    $outro = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => agoraNaClinica()->format('Y-m-d').' 02:00',
    ])->assertCreated()->json('id');
    $this->actingAs($adminDaClinica)->postJson("/api/agendamentos/{$outro}/atendimento", [])
        ->assertCreated();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$outro}", [
        'tipo' => 'bloqueio',
        'inicio' => agoraNaClinica()->format('Y-m-d').' 02:00',
        'profissional_id' => $payload['profissional_id'],
    ])->assertUnprocessable()->assertJsonValidationErrors('tipo');
});

it('deve rejeitar consumo sem saldo mantendo o agendamento intacto', function () {
    // ARRANGE — saldo 1 disputado por dois agendamentos (aproximação sequencial
    // do cenário concorrente: o saldo é revalidado SOB LOCK a cada consumo)
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo(1);
    $inicioDoSegundo = agoraNaClinica()->format('Y-m-d').' 01:00';
    $primeiro = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload)
        ->assertCreated()->json('id');
    $segundo = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $inicioDoSegundo,
    ])->assertCreated()->json('id');
    $finalizado = statusPorNome('Finalizado')->id;

    // ACT + ASSERT — exatamente um consome
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$primeiro}", [
        ...$payload, 'status_id' => $finalizado,
    ])->assertOk();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$segundo}", [
        ...$payload, 'inicio' => $inicioDoSegundo, 'status_id' => $finalizado,
    ])->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');

    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);
    // a mutação inteira foi rejeitada: o status do segundo não mudou
    expect(Agendamento::find($segundo)->status_id)->toBe(statusPorNome('Em Aberto')->id);
    expect(Agendamento::find($segundo)->sessao_consumida_em)->toBeNull();
});

it('deve ignorar flip da flag desconta_sessao sem retro-reconciliar e estornar pelo marcador', function () {
    // ARRANGE — consumido com "Finalizado"
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo();
    $id = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertCreated()->json('id');
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);

    // ACT — flip da flag DEPOIS do consumo (T-ate-14)
    statusPorNome('Finalizado')->update(['desconta_sessao' => false]);

    // ASSERT — nenhum recálculo retroativo
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);

    // e o estorno decide pelo MARCADOR, não pela flag nova: com a flag agora
    // falsa, o estado final deixa de "dever consumir" → estorna na próxima mutação
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$id}", $payload)
        ->assertOk();
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(0);
    expect(Agendamento::find($id)->sessao_consumida_em)->toBeNull();
});

it('deve rejeitar status descontante em data futura e aceitar no mesmo dia', function () {
    // ARRANGE — agendamento de AMANHÃ com tratamento
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo();
    $amanha = agoraNaClinica()->addDay()->format('Y-m-d').' 09:00';
    $futuro = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $amanha,
    ])->assertCreated()->json('id');

    // ACT + ASSERT — sessão não pode ter ocorrido no futuro (D9/P1)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$futuro}", [
        ...$payload, 'inicio' => $amanha, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('status_id');
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(0);

    // mesmo dia é permitido em qualquer horário (não trava a recepção)
    $hoje = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload)
        ->assertCreated()->json('id');
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$hoje}", [
        ...$payload, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertOk();
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(1);
});

it('deve aplicar consumo na série tudo-ou-nada', function () {
    // ARRANGE — série PASSADA de 3 ocorrências (D-14, D-7, hoje), saldo 2
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo(2);
    $inicioDaSerie = agoraNaClinica()->subDays(14)->format('Y-m-d').' 09:00';
    $criacao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $inicioDaSerie,
        'recorrencia' => ['ate' => agoraNaClinica()->format('Y-m-d')],
    ]);
    $criacao->assertCreated()->assertJsonPath('criados', 3);
    $primeiroDaSerie = $criacao->json('agendamentos.0.id');

    // ACT + ASSERT — 3 consumos contra saldo 2 → 422 e ZERO linhas alteradas
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$primeiroDaSerie}", [
        ...$payload,
        'inicio' => $inicioDaSerie,
        'status_id' => statusPorNome('Finalizado')->id,
        'aplicar_na_serie' => true,
    ])->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');

    expect($tratamento->refresh()->sessoes_realizadas)->toBe(0);
    expect(Agendamento::whereNotNull('sessao_consumida_em')->count())->toBe(0);

    // com saldo suficiente a série inteira consome
    $tratamento->update(['sessoes_total' => 3]);
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$primeiroDaSerie}", [
        ...$payload,
        'inicio' => $inicioDaSerie,
        'status_id' => statusPorNome('Finalizado')->id,
        'aplicar_na_serie' => true,
    ])->assertOk();
    expect($tratamento->refresh()->sessoes_realizadas)->toBe(3);
});

it('deve bloquear exclusão de agendamento consumido ou com atendimento, inclusive em série', function () {
    // ARRANGE — consumido
    $adminDaClinica = admin();
    [$payload, $tratamento] = cenarioDeConsumo();
    $consumido = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'status_id' => statusPorNome('Finalizado')->id,
    ])->assertCreated()->json('id');

    // ACT + ASSERT — consumido não some (T-ate-17): estorne primeiro
    $this->actingAs($adminDaClinica)->deleteJson("/api/agendamentos/{$consumido}")
        ->assertUnprocessable()->assertJsonValidationErrors('agendamento');
    expect(Agendamento::find($consumido))->not->toBeNull();

    // com atendimento registrado também não
    $comAtendimento = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => agoraNaClinica()->format('Y-m-d').' 01:00',
    ])->assertCreated()->json('id');
    $this->actingAs($adminDaClinica)->postJson("/api/agendamentos/{$comAtendimento}/atendimento", [])
        ->assertCreated();
    $this->actingAs($adminDaClinica)->deleteJson("/api/agendamentos/{$comAtendimento}")
        ->assertUnprocessable()->assertJsonValidationErrors('agendamento');

    // série passada com a ÚLTIMA linha consumida → exclusão em série rejeitada inteira
    $inicioDaSerie = agoraNaClinica()->subDays(7)->format('Y-m-d').' 03:00';
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => $inicioDaSerie,
        'recorrencia' => ['ate' => agoraNaClinica()->format('Y-m-d')],
    ])->assertCreated();
    $ultimaDaSerie = $serie->json('agendamentos.1.id');
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ultimaDaSerie}", [
        ...$payload,
        'inicio' => agoraNaClinica()->format('Y-m-d').' 03:00',
        'status_id' => statusPorNome('Finalizado')->id,
    ])->assertOk();

    $primeiraDaSerie = $serie->json('agendamentos.0.id');
    $this->actingAs($adminDaClinica)->deleteJson("/api/agendamentos/{$primeiraDaSerie}?aplicar_na_serie=1")
        ->assertUnprocessable();
    expect(Agendamento::find($primeiraDaSerie))->not->toBeNull();
    expect(Agendamento::find($ultimaDaSerie))->not->toBeNull();
});

it('deve ignorar sessao_consumida_em vindo do payload', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$payload] = cenarioDeConsumo();

    // ACT — payload tenta forjar o marcador (abuse case 19)
    $id = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'sessao_consumida_em' => '2020-01-01 00:00',
    ])->assertCreated()->json('id');

    // ASSERT — fora de $fillable: banco inalterado
    expect(Agendamento::find($id)->sessao_consumida_em)->toBeNull();
});
