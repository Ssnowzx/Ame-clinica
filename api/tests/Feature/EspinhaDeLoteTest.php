<?php

use App\Models\Agendamento;
use App\Models\Atendimento;
use App\Models\Auditoria;
use App\Models\Paciente;
use App\Models\StatusAgendamento;
use App\Support\Agenda\AgendamentoService;
use App\Support\Auditoria\ContextoDoLote;
use App\Support\Configuracoes\ConfiguracaoService;
use Illuminate\Support\Str;

/*
 * A espinha partilhada das operações em lote (change `baixa-em-lote-por-status`, grupo 3): o
 * desmarque passou a delegar em `AlcanceEmLote` + `AplicadorDeStatusEmLote` + o trait
 * `AlcanceEmLoteRequest`, e ganhou o rastro de lote (D11). O que a suíte do desmarque já provava
 * continua lá, intocado; aqui entra o que a extração ACRESCENTOU — trilha com `lote_id`, linha-mãe
 * com o motivo, e a supressão do encadeamento por parâmetro (D9).
 */

/** Dois atendimentos da MESMA criança hoje (parede da clínica), com o encadeamento ligado. */
function cenarioDeLoteComEncadeamento(): array
{
    $base = baseDaBaixa();
    $hoje = agoraNaClinica()->format('Y-m-d');
    $primeiro = agendamentoDaBaixa($base, "{$hoje} 09:00");
    $segundo = agendamentoDaBaixa($base, "{$hoje} 10:00");

    $alvo = StatusAgendamento::where('em_aberto', true)->whereKeyNot($base['status']['inicial'])
        ->orderBy('ordem')->firstOrFail();
    app(ConfiguracaoService::class)->set('agenda.encadeamento_ativo', true);
    app(ConfiguracaoService::class)->set('agenda.encadeamento_status_id', $alvo->id);

    return [$base, $primeiro, $segundo, $alvo];
}

/** O mesmo payload que o `AplicadorDeStatusEmLote` monta: status + `inicio` e profissional atuais. */
function payloadDeStatus(Agendamento $agendamento, int $statusId): array
{
    return [
        'status_id' => $statusId,
        'inicio' => $agendamento->inicio->format('Y-m-d H:i'),
        'profissional_id' => $agendamento->profissional_id,
    ];
}

it('deve gravar a trilha do desmarque com lote_id e a linha-mãe com o motivo', function () {
    // ARRANGE — duas crianças fictícias desmarcáveis e uma sessão já atendida (recusada)
    $adminDaClinica = admin();
    $base = baseDoDesmarque();
    $outraCrianca = Paciente::factory()->create()->id;
    $primeiro = agendamentoDoDesmarque($base, '2026-09-14 14:00');
    $segundo = agendamentoDoDesmarque($base, '2026-09-14 15:00', ['paciente_id' => $outraCrianca]);
    $atendido = agendamentoDoDesmarque($base, '2026-09-14 16:00');
    $atendimento = new Atendimento(['iniciado_em' => '2026-09-14 16:00', 'finalizado_em' => '2026-09-14 16:40']);
    $atendimento->agendamento_id = $atendido->id;
    $atendimento->save();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'tarde',
        'motivo' => 'Consulta médica do profissional',
    ]);

    // ASSERT — a resposta de sempre, com `lote_id` a mais
    $resposta->assertOk()->assertJsonPath('desmarcados', 2);
    expect(array_keys($resposta->json()))->toBe(['desmarcados', 'recusados', 'avisados', 'nao_avisados', 'lote_id']);
    $loteId = $resposta->json('lote_id');
    expect(Str::isUuid($loteId))->toBeTrue();

    // as duas linhas dos agendamentos desmarcados carregam o lote; o `criou` de antes, não
    $linhas = Auditoria::where('lote_id', $loteId)->get();
    expect($linhas)->toHaveCount(3)
        ->and($linhas->where('entidade', 'agendamentos')->where('acao', 'atualizou')->pluck('entidade_id')->sort()->values()->all())
        ->toBe(collect([$primeiro->id, $segundo->id])->sort()->values()->all())
        ->and(Auditoria::where('entidade', 'agendamentos')->where('acao', 'criou')->whereNotNull('lote_id')->count())->toBe(0);

    // a linha-mãe: no profissional, com motivo, período, intervalo, contagens e recusados — sem criança
    $mae = $linhas->firstWhere('acao', 'desmarque_em_lote');
    $statusDoDesmarque = StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail();
    expect($mae)->not->toBeNull()
        ->and($mae->entidade)->toBe('profissionais')
        ->and((int) $mae->entidade_id)->toBe($base['profissional_id'])
        ->and($mae->diff_json['depois'])->toBe([
            'status_id' => $statusDoDesmarque->id,
            'status_nome' => 'Desmarcado pelo Profissional',
            'de' => '2026-09-14',
            'ate' => '2026-09-14',
            'periodo' => 'tarde',
            'motivo' => 'Consulta médica do profissional',
            'desmarcados' => 2,
            'criancas' => 2,
            'recusados' => [['agendamento_id' => $atendido->id, 'motivo' => 'atendimento_registrado']],
        ])
        ->and(json_encode($mae->diff_json, JSON_UNESCAPED_UNICODE))->not->toContain('paciente');

    // o contexto fechou com o lote: a escrita seguinte da requisição nasce sem lote
    expect(app(ContextoDoLote::class)->id())->toBeNull();
});

it('deve não puxar o próximo do dia quando encadear é false', function () {
    // ARRANGE — o encadeamento ligado e uma transição para status DESCONTANTE (o gatilho dele)
    admin();
    [$base, $primeiro, $segundo, $alvo] = cenarioDeLoteComEncadeamento();

    // ACT — o caminho do lote (D9): supressão por parâmetro explícito
    app(AgendamentoService::class)->atualizar(
        $primeiro, payloadDeStatus($primeiro, $base['status']['finalizado']), aplicarNaSerie: false, encadear: false
    );

    // ASSERT — o primeiro mudou; o segundo ficou onde nasceu, e não no alvo do encadeamento
    expect($primeiro->refresh()->status_id)->toBe($base['status']['finalizado'])
        ->and($segundo->refresh()->status_id)->toBe($base['status']['inicial'])
        ->and($segundo->status_id)->not->toBe($alvo->id);
});

it('deve puxar o próximo do dia pelo caminho individual, com o mesmo serviço', function () {
    // ARRANGE — a mesma cena; a diferença é só o parâmetro
    admin();
    [$base, $primeiro, $segundo, $alvo] = cenarioDeLoteComEncadeamento();

    // ACT — o caminho do chip do card: `encadear` no default
    app(AgendamentoService::class)->atualizar($primeiro, payloadDeStatus($primeiro, $base['status']['finalizado']));

    // ASSERT
    expect($segundo->refresh()->status_id)->toBe($alvo->id);
});
