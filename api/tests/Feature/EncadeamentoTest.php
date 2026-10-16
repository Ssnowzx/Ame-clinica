<?php

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Facades\DB;

/**
 * Três agendamentos do MESMO paciente HOJE (09h/10h/11h) no status inicial,
 * criados pela API (retroativo ligado). Devolve payload base + ids.
 */
function cenarioDeEncadeamento(): array
{
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);

    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);
    $paciente = Paciente::factory()->create();

    $payload = [
        'paciente_id' => $paciente->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ];
    $ids = collect(['09:00', '10:00', '11:00'])->map(
        fn (string $hora) => test()->postJson('/api/agendamentos', [
            ...$payload, 'inicio' => agoraNaClinica()->format('Y-m-d')." {$hora}",
        ])->assertCreated()->json('id')
    )->all();

    return [$payload, $ids];
}

function ligarEncadeamento(): StatusAgendamento
{
    $alvo = StatusAgendamento::where('nome', 'Aguardando Atendimento')->firstOrFail();
    app(ConfiguracaoService::class)->set('agenda.encadeamento_ativo', true);
    app(ConfiguracaoService::class)->set('agenda.encadeamento_status_id', $alvo->id);

    return $alvo;
}

it('deve encadear só o próximo do dia com trilha do usuário causal', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload, [$primeiro, $segundo, $terceiro]] = cenarioDeEncadeamento();
    $alvo = ligarEncadeamento();
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();

    // ACT — transição para status descontante dispara a automação (P2)
    $this->putJsonComVersao("/api/agendamentos/{$primeiro}", [
        ...$payload,
        'inicio' => agoraNaClinica()->format('Y-m-d').' 09:00',
        'status_id' => $finalizado->id,
    ])->assertOk();

    // ASSERT — profundidade 1: SÓ o segundo muda; trilha com o autor causal
    expect(Agendamento::find($segundo)->status_id)->toBe($alvo->id)
        ->and(Agendamento::find($terceiro)->status_id)->toBe($emAberto->id);
    $trilha = Auditoria::where('entidade', 'agendamentos')->where('acao', 'atualizou')
        ->where('entidade_id', $segundo)->latest('id')->firstOrFail();
    expect($trilha->usuario_id)->toBe($adminDaClinica->id)
        ->and($trilha->diff_json['depois']['status_id'])->toBe($alvo->id);
});

it('deve ficar inerte com a configuração desligada ou encadeado não-virgem', function () {
    // ARRANGE — default OFF
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload, [$primeiro, $segundo]] = cenarioDeEncadeamento();
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $corpo = fn (int $id, string $hora) => [
        ...$payload, 'inicio' => agoraNaClinica()->format('Y-m-d')." {$hora}",
        'status_id' => $finalizado->id,
    ];

    // ACT + ASSERT — desligado, nada muda
    $this->putJsonComVersao("/api/agendamentos/{$primeiro}", $corpo($primeiro, '09:00'))->assertOk();
    expect(Agendamento::find($segundo)->status_id)->toBe($emAberto->id);

    // ligado, mas encadeado NÃO-virgem (consumido) → skip silencioso (T-not-10b)
    ligarEncadeamento();
    Agendamento::find($segundo)->forceFill([
        'sessao_consumida_em' => agoraNaClinica()->format('Y-m-d H:i'),
    ])->save();
    $this->putJsonComVersao("/api/agendamentos/{$primeiro}", [
        ...$corpo($primeiro, '09:00'), 'obs' => 'reforço fictício',
    ])->assertOk(); // sem transição de status → nem dispara
    $this->putJsonComVersao("/api/agendamentos/{$primeiro}", [
        ...$payload, 'inicio' => agoraNaClinica()->format('Y-m-d').' 09:00',
        'status_id' => $emAberto->id,
    ])->assertOk();
    $this->putJsonComVersao("/api/agendamentos/{$primeiro}", $corpo($primeiro, '09:00'))->assertOk();
    expect(Agendamento::find($segundo)->status->nome)->not->toBe('Aguardando Atendimento');
});

it('deve ficar inerte quando o alvo flipou depois da configuração', function () {
    // ARRANGE — config válida gravada; DEPOIS o status-alvo vira descontante
    // (abuse case 12/SEC-not-03: releitura fail-closed, nunca 500)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload, [$primeiro, $segundo]] = cenarioDeEncadeamento();
    $alvo = ligarEncadeamento();
    $alvo->update(['desconta_sessao' => true]); // flip pós-config
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();

    // ACT — a mutação origem conclui normalmente (200), automação inerte
    $this->putJsonComVersao("/api/agendamentos/{$primeiro}", [
        ...$payload, 'inicio' => agoraNaClinica()->format('Y-m-d').' 09:00',
        'status_id' => $finalizado->id,
    ])->assertOk();

    // ASSERT — encadeado intacto; nenhum saldo tocado na clínica
    expect(Agendamento::find($segundo)->status_id)->toBe($emAberto->id)
        ->and((int) Tratamento::sum('sessoes_realizadas'))->toBe(0);
});

it('deve encadear sem jamais tocar o saldo de sessões', function () {
    // ARRANGE — o SEGUNDO agendamento tem tratamento; alvo não desconta (T-not-10)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    [$payload, [$primeiro, $segundo]] = cenarioDeEncadeamento();
    $alvo = ligarEncadeamento();
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $payload['paciente_id'],
        'especialidade_id' => $payload['especialidade_id'],
        'profissional_id' => $payload['profissional_id'],
        'sessoes_total' => 10,
    ]);
    $this->putJsonComVersao("/api/agendamentos/{$segundo}", [
        ...$payload, 'inicio' => agoraNaClinica()->format('Y-m-d').' 10:00',
        'tratamento_id' => $tratamento->id,
    ])->assertOk();

    // ACT — finalizar o primeiro encadeia o segundo (que tem tratamento)
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
    $this->putJsonComVersao("/api/agendamentos/{$primeiro}", [
        ...$payload, 'inicio' => agoraNaClinica()->format('Y-m-d').' 09:00',
        'status_id' => $finalizado->id,
    ])->assertOk();

    // ASSERT — status mudou; saldo INTACTO (a automação nunca consome/estorna)
    expect(Agendamento::find($segundo)->status_id)->toBe($alvo->id)
        ->and($tratamento->refresh()->sessoes_realizadas)->toBe(0);
});
