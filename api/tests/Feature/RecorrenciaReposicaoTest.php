<?php

use App\Models\Agendamento;
use App\Models\Paciente;
use App\Models\StatusAgendamento;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\Carbon;

it('deve criar série semanal com grupo único', function () {
    // ARRANGE — design D6
    $adminDaClinica = admin();
    $payload = baseDeAgenda();

    // ACT — 4 semanas (1ª + 3 recorrências)
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['ate' => now()->addDay()->addWeeks(3)->toDateString()],
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('criados', 4);
    $grupo = $resposta->json('recorrencia_grupo_id');
    expect(Agendamento::where('recorrencia_grupo_id', $grupo)->count())->toBe(4);
});

it('deve rejeitar a série inteira quando uma ocorrência conflita', function () {
    // ARRANGE — abuse case 5: tudo-ou-nada com datas listadas
    $adminDaClinica = admin();
    $payload = baseDeAgenda();

    // ocupa a 3ª semana com o mesmo profissional
    $dataConflito = now()->addDay()->addWeeks(2)->format('Y-m-d');
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'paciente_id' => Paciente::factory()->create()->id,
        'inicio' => "{$dataConflito} 09:00",
    ])->assertCreated();
    $totalAntes = Agendamento::count();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['ate' => now()->addDay()->addWeeks(3)->toDateString()],
    ]);

    // ASSERT — 422 com a data em conflito e ZERO linhas novas
    $resposta->assertUnprocessable()->assertJsonValidationErrors('recorrencia');
    expect($resposta->json('errors.recorrencia.0'))
        ->toContain(Carbon::parse($dataConflito)->format('d/m/Y')) // dd/mm/aaaa: é assim que a recepção lê data
        ->and(Agendamento::count())->toBe($totalAntes);
});

it('deve rejeitar série acima de 52 ocorrências', function () {
    // ARRANGE — abuse case 5 (T-agd-03)
    $adminDaClinica = admin();
    $payload = baseDeAgenda();

    // ACT + ASSERT — 60 semanas
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['ate' => now()->addDay()->addWeeks(60)->toDateString()],
    ])->assertUnprocessable()->assertJsonValidationErrors('recorrencia');
    expect(Agendamento::count())->toBe(0);
});

it('deve excluir este e os futuros da série preservando os passados', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['ate' => now()->addDay()->addWeeks(3)->toDateString()],
    ]);
    $serie->assertCreated();
    $ids = collect($serie->json('agendamentos'))->pluck('id');

    // ACT — exclui a partir da 3ª ocorrência
    $this->actingAs($adminDaClinica)
        ->deleteJson("/api/agendamentos/{$ids[2]}?aplicar_na_serie=1")
        ->assertNoContent();

    // ASSERT — 1ª e 2ª permanecem; 3ª e 4ª saíram
    expect(Agendamento::whereKey($ids[0])->exists())->toBeTrue()
        ->and(Agendamento::whereKey($ids[1])->exists())->toBeTrue()
        ->and(Agendamento::whereKey($ids[2])->exists())->toBeFalse()
        ->and(Agendamento::whereKey($ids[3])->exists())->toBeFalse();
});

it('deve aplicar mudança de horário aos futuros da série', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['ate' => now()->addDay()->addWeeks(2)->toDateString()],
    ]);
    $serie->assertCreated();
    $ids = collect($serie->json('agendamentos'))->pluck('id');

    // ACT — move a 2ª ocorrência 1h para frente, aplicando na série
    $novaSegunda = now()->addDay()->addWeek()->format('Y-m-d').' 10:00';
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ids[1]}", [
        ...$payload,
        'inicio' => $novaSegunda,
        'aplicar_na_serie' => true,
    ])->assertOk();

    // ASSERT — 3ª ocorrência também deslocou 1h; a 1ª ficou
    $primeira = Agendamento::findOrFail($ids[0]);
    $terceira = Agendamento::findOrFail($ids[2]);
    expect($primeira->inicio->format('H:i'))->toBe('09:00')
        ->and($terceira->inicio->format('H:i'))->toBe('10:00');
});

it('deve deslocar a série uma semana inteira sem falso conflito', function () {
    // ARRANGE — gate r1 I1: o slot antigo da irmã não é conflito real
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['ate' => now()->addDay()->addWeeks(3)->toDateString()],
    ]);
    $serie->assertCreated();
    $ids = collect($serie->json('agendamentos'))->pluck('id');

    // ACT — empurra TUDO uma semana (a 1ª cai exatamente no slot antigo da 2ª)
    $novaPrimeira = now()->addDay()->addWeek()->format('Y-m-d').' 09:00';
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ids[0]}", [
        ...$payload,
        'inicio' => $novaPrimeira,
        'aplicar_na_serie' => true,
    ]);

    // ASSERT — operação válida passa; última ocorrência também deslocou
    $resposta->assertOk();
    $ultima = Agendamento::findOrFail($ids[3]);
    expect($ultima->inicio->toDateString())
        ->toBe(now()->addDay()->addWeeks(4)->toDateString());
});

it('deve preservar o status próprio das irmãs ao deslocar a série', function () {
    // ARRANGE — gate r2: irmã cancelada não pode ressuscitar ocupando slot
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['ate' => now()->addDay()->addWeeks(2)->toDateString()],
    ]);
    $serie->assertCreated();
    $ids = collect($serie->json('agendamentos'))->pluck('id');

    // a 3ª ocorrência é desmarcada individualmente (libera o horário)
    $desmarcado = StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')
        ->firstOrFail();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ids[2]}", [
        ...$payload,
        'inicio' => now()->addDay()->addWeeks(2)->format('Y-m-d').' 09:00',
        'status_id' => $desmarcado->id,
    ])->assertOk();

    // ACT — move a série 1h para frente SEM enviar status_id
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ids[0]}", [
        ...$payload,
        'inicio' => now()->addDay()->format('Y-m-d').' 10:00',
        'aplicar_na_serie' => true,
    ])->assertOk();

    // ASSERT — a 3ª deslocou mas CONTINUA desmarcada (não herdou o status da cabeça)
    $terceira = Agendamento::findOrFail($ids[2]);
    expect($terceira->inicio->format('H:i'))->toBe('10:00')
        ->and($terceira->status_id)->toBe($desmarcado->id);
});

it('deve rejeitar conversão de tipo aplicada na série', function () {
    // ARRANGE — gate r3: converter em massa deixaria irmãs incoerentes
    // (bloqueio com paciente, ou atendimento sem status = slot fantasma)
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['ate' => now()->addDay()->addWeeks(2)->toDateString()],
    ]);
    $serie->assertCreated();
    $ids = collect($serie->json('agendamentos'))->pluck('id');

    // ACT — tenta virar bloqueio aplicando na série
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$ids[0]}", [
        'tipo' => 'bloqueio',
        'profissional_id' => $payload['profissional_id'],
        'inicio' => $payload['inicio'],
        'duracao_minutos' => 40,
        'aplicar_na_serie' => true,
    ]);

    // ASSERT — rejeitado; as irmãs continuam atendimentos íntegros
    $resposta->assertUnprocessable()->assertJsonValidationErrors('aplicar_na_serie');
    $terceira = Agendamento::findOrFail($ids[2]);
    expect($terceira->tipo)->toBe('atendimento')
        ->and($terceira->paciente_id)->not->toBeNull()
        ->and($terceira->status_id)->not->toBeNull();
});

it('deve rejeitar recorrência de evento com sete dias ou mais', function () {
    // ARRANGE — gate r1 I2: ocorrências se sobreporiam entre si
    $adminDaClinica = admin();
    $payload = baseDeAgenda();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'profissional_id' => $payload['profissional_id'],
        'inicio' => $payload['inicio'],
        'fim' => now()->addDays(9)->format('Y-m-d').' 09:00',
        'recorrencia' => ['ate' => now()->addWeeks(8)->toDateString()],
    ])->assertUnprocessable()->assertJsonValidationErrors('recorrencia');
    expect(Agendamento::count())->toBe(0);
});

it('deve proibir recorrência no update', function () {
    // ARRANGE — nit do gate: o contrato não pode mentir
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);
    $criado->assertCreated();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$payload,
        'recorrencia' => ['ate' => now()->addWeeks(4)->toDateString()],
    ])->assertUnprocessable()->assertJsonValidationErrors('recorrencia');
});

it('deve controlar reposição e reposição de reposição por configuração', function () {
    // ARRANGE — abuse case 6 (T-agd-06)
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $original = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);
    $original->assertCreated();

    // reposição do original → ok
    $reposicao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => now()->addDays(2)->format('Y-m-d').' 09:00',
        'is_reposicao' => true,
        'reposicao_de_id' => $original->json('id'),
    ]);
    $reposicao->assertCreated();

    // ACT + ASSERT — reposição de reposição: default bloqueia
    $novaTentativa = [
        ...$payload,
        'inicio' => now()->addDays(3)->format('Y-m-d').' 09:00',
        'is_reposicao' => true,
        'reposicao_de_id' => $reposicao->json('id'),
    ];
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $novaTentativa)
        ->assertUnprocessable()->assertJsonValidationErrors('reposicao_de_id');

    // config ativa libera (regra é DADO — §13)
    app(ConfiguracaoService::class)->set('agenda.permitir_reposicao_de_reposicao', true);
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $novaTentativa)->assertCreated();
});

it('deve rejeitar agendamento repondo a si mesmo', function () {
    // ARRANGE — T-agd-06 (auto-referência via update)
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);
    $criado->assertCreated();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$payload,
        'is_reposicao' => true,
        'reposicao_de_id' => $criado->json('id'),
    ])->assertUnprocessable()->assertJsonValidationErrors('reposicao_de_id');
});

/*
 * A RECUSA DA SÉRIE PRECISA SER ACIONÁVEL (change `conflito-da-serie-diz-o-motivo`).
 *
 * Em produção a recepção recebeu 48 datas em formato de máquina e nenhuma pista do motivo: nem eu
 * nem outra sessão de IA acertamos a causa sem abrir o banco da clínica. Era uma sessão de 40 min
 * começando às 08:00 contra uma que já existia às 08:20.
 */
it('deve dizer o motivo e o horário já ocupado quando a série conflita', function () {
    // ARRANGE — o caso da clínica: a profissional já atende 08:20, a série quer 08:00 por 40 min
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $amanha = now()->addDay()->format('Y-m-d');
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'paciente_id' => Paciente::factory()->create()->id,
        'inicio' => now()->addDay()->addWeek()->format('Y-m-d').' 08:20',
    ])->assertCreated();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => "{$amanha} 08:00",
        'recorrencia' => ['ocorrencias' => 2],
    ]);

    // ASSERT
    $recusa = $resposta->assertUnprocessable()->json('errors.recorrencia.0');
    expect($recusa)
        ->toContain('Conflito em 1 de 2 datas')
        ->toContain('o horário do profissional já está ocupado')
        ->toContain('já há atendimento das 08:20 às 09:00')
        ->toContain('Nada foi criado');
});

it('deve recusar sem expor a criança que ocupa o horário', function () {
    // ARRANGE — nome fictício distinto, para aparecer no diff se vazar
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $ocupante = Paciente::factory()->create(['nome' => 'Zebedeu Fictício Improvável']);
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'paciente_id' => $ocupante->id,
        'inicio' => now()->addDay()->addWeek()->format('Y-m-d').' 08:20',
    ])->assertCreated();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => now()->addDay()->format('Y-m-d').' 08:00',
        'recorrencia' => ['ocorrencias' => 2],
    ]);

    // ASSERT — a agenda da outra família não entra na mensagem de quem está marcando
    $recusa = $resposta->assertUnprocessable()->json('errors.recorrencia.0');
    expect($recusa)
        ->not->toContain('Zebedeu')
        ->not->toContain((string) $ocupante->id);
});

it('deve mostrar as primeiras datas e contar o resto quando são muitas', function () {
    // ARRANGE — um bloqueio semanal derruba TODAS as ocorrências seguintes
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    for ($semana = 1; $semana <= 8; $semana++) {
        $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
            ...$payload,
            'paciente_id' => Paciente::factory()->create()->id,
            'inicio' => now()->addDay()->addWeeks($semana)->format('Y-m-d').' 09:00',
        ])->assertCreated();
    }

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['ocorrencias' => 9],
    ]);

    // ASSERT — 5 datas escritas e as outras 3 contadas, não uma parede de 8
    $recusa = $resposta->assertUnprocessable()->json('errors.recorrencia.0');
    expect($recusa)
        ->toContain('Conflito em 8 de 9 datas')
        ->toContain('e mais 3.')
        ->and(substr_count($recusa, '/'))->toBe(12); // 6 datas em dd/mm/aaaa = 2 barras cada
});

/*
 * CADÊNCIA MENSAL (change `recorrencia-mensal`). Quatro semanas NÃO é um mês: a cada ciclo a data
 * anda para trás dentro do mês, e em um ano a sessão de "todo dia 15" vira outra coisa.
 */
it('deve repetir todo mês mantendo o dia do mês', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = baseDeAgenda();

    // ACT — dia 15 de um mês futuro, três ocorrências
    $quinze = now()->addMonth()->startOfMonth()->addDays(14)->format('Y-m-d');
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => "{$quinze} 09:00",
        'recorrencia' => ['intervalo_meses' => 1, 'ocorrencias' => 3],
    ]);

    // ASSERT — os três caem no dia 15, em meses consecutivos
    $resposta->assertCreated()->assertJsonPath('criados', 3);
    $grupo = $resposta->json('recorrencia_grupo_id');
    $dias = Agendamento::where('recorrencia_grupo_id', $grupo)->orderBy('inicio')->pluck('inicio')
        ->map(fn ($inicio) => (int) $inicio->format('d'))->all();
    expect($dias)->toBe([15, 15, 15]);
});

it('deve pousar no último dia do mês curto, sem transbordar para o mês seguinte', function () {
    // ARRANGE — 31 de janeiro: fevereiro não tem 31
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $trintaEUm = now()->addYear()->setMonth(1)->setDay(31)->format('Y-m-d');

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => "{$trintaEUm} 09:00",
        'recorrencia' => ['intervalo_meses' => 1, 'ocorrencias' => 3],
    ]);

    // ASSERT — fevereiro recebe o último dia dele, nunca março; e MARÇO VOLTA AO DIA 31:
    // o dia encurtado por um mês curto não pode ficar encurtado para sempre
    $resposta->assertCreated();
    $grupo = $resposta->json('recorrencia_grupo_id');
    $serie = Agendamento::where('recorrencia_grupo_id', $grupo)->orderBy('inicio')->get();
    $fevereiro = $serie[1];
    expect($fevereiro->inicio->format('m'))->toBe('02')
        ->and($fevereiro->inicio->format('d'))->toBe($fevereiro->inicio->copy()->endOfMonth()->format('d'))
        ->and($serie[2]->inicio->format('m-d'))->toBe('03-31');
});

it('deve recusar duas cadências na mesma chamada', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $totalAntes = Agendamento::count();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'recorrencia' => ['intervalo_semanas' => 2, 'intervalo_meses' => 1, 'ocorrencias' => 3],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('recorrencia.intervalo_meses');
    expect($resposta->json('errors.recorrencia\\.intervalo_meses.0') ?? $resposta->json('errors')['recorrencia.intervalo_meses'][0])
        ->toContain('uma cadência')
        ->and(Agendamento::count())->toBe($totalAntes);
});

it('deve medir o evento longo pelo mês mais CURTO na cadência mensal', function () {
    // ARRANGE — o piso é 28 dias, não 30: um bloqueio de 29 dias se sobrepõe em fevereiro,
    // e a série não pode depender do mês em que começou
    $adminDaClinica = admin();
    $payload = baseDeAgenda();

    // ACT + ASSERT — 29 dias numa cadência mensal é recusado
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'profissional_id' => $payload['profissional_id'],
        'inicio' => $payload['inicio'],
        'fim' => now()->addDays(30)->format('Y-m-d').' 09:00',
        'recorrencia' => ['intervalo_meses' => 1, 'ocorrencias' => 3],
    ])->assertUnprocessable()->assertJsonValidationErrors('recorrencia');
    expect(Agendamento::count())->toBe(0);
});
