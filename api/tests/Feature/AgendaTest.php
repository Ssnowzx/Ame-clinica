<?php

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Convenio;
use App\Models\Equipamento;
use App\Models\Especialidade;
use App\Models\Medico;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Sala;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Configuracoes\ConfiguracaoService;

it('deve criar agendamento herdando duração e status default', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = baseDeAgenda();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);

    // ASSERT — fim = inicio + tempo_sessao; status de menor ordem ("Em Aberto")
    $resposta->assertCreated()->assertJsonPath('duracao_minutos', 40);
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    expect($resposta->json('status_id'))->toBe($emAberto->id);
});

it('deve rejeitar profissional que não atende a especialidade', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $outraEspecialidade = Especialidade::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'especialidade_id' => $outraEspecialidade->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('especialidade_id');
});

it('deve rejeitar horário ocupado do profissional e liberar quando o status não ocupa', function () {
    // ARRANGE — spec: conflito + ocupa_horario
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $primeiro = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);
    $primeiro->assertCreated();

    // ACT + ASSERT — sobreposição parcial → 422
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'paciente_id' => Paciente::factory()->create()->id,
        'inicio' => now()->addDay()->format('Y-m-d').' 09:20',
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');

    // desmarcar libera o slot (flag ocupa_horario do status — agenda D2)
    $desmarcado = StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail();
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$primeiro->json('id')}", [
        ...$payload, 'status_id' => $desmarcado->id,
    ])->assertOk();

    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'paciente_id' => Paciente::factory()->create()->id,
        'inicio' => now()->addDay()->format('Y-m-d').' 09:20',
    ])->assertCreated();
});

it('deve rejeitar sala ocupada e equipamento esgotado', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $sala = Sala::create(['nome' => 'Sala 1']);
    $equipamento = Equipamento::create(['nome' => 'Bola', 'quantidade_total' => 2]);

    // dois profissionais diferentes na mesma sala/equipamento
    $primeiro = baseDeAgenda();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$primeiro, 'sala_id' => $sala->id, 'equipamento_id' => $equipamento->id,
    ])->assertCreated();

    // ACT + ASSERT — sala ocupada por outro profissional no mesmo horário
    $segundo = baseDeAgenda();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$segundo, 'sala_id' => $sala->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('sala_id');

    // equipamento: 2ª unidade ok; 3ª esgota
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$segundo, 'equipamento_id' => $equipamento->id,
    ])->assertCreated();
    $terceiro = baseDeAgenda();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$terceiro, 'equipamento_id' => $equipamento->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('equipamento_id');
});

it('deve criar bloqueio sem paciente que ocupa o horário', function () {
    // ARRANGE — design D3
    $adminDaClinica = admin();
    $payload = baseDeAgenda();

    // ACT — bloqueio do profissional (reunião)
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'profissional_id' => $payload['profissional_id'],
        'inicio' => $payload['inicio'],
        'duracao_minutos' => 60,
        'obs' => 'Reunião de equipe',
    ])->assertCreated();

    // ASSERT — atendimento por cima → 422; bloqueio com paciente → 422
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload)
        ->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'paciente_id' => $payload['paciente_id'],
        'profissional_id' => $payload['profissional_id'],
        'inicio' => now()->addDays(2)->format('Y-m-d').' 09:00',
        'duracao_minutos' => 30,
    ])->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
});

it('deve validar o tratamento no agendamento', function () {
    // ARRANGE — abuse case 12 (D4): 4 incoerências
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $convenio = Convenio::create(['nome' => 'Particular']);

    $criarTratamento = function (array $extra) use ($payload, $convenio) {
        return Tratamento::create([
            'paciente_id' => $payload['paciente_id'],
            'convenio_id' => $convenio->id,
            'especialidade_id' => $payload['especialidade_id'],
            'profissional_id' => $payload['profissional_id'],
            'sessoes_total' => 10,
            ...$extra,
        ]);
    };

    // sem saldo
    $semSaldo = $criarTratamento([]);
    $semSaldo->forceFill(['sessoes_realizadas' => 10])->save();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'tratamento_id' => $semSaldo->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');

    // vencido
    $vencido = $criarTratamento(['data_inicio' => now()->subDays(60)->toDateString(), 'validade_dias' => 30]);
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'tratamento_id' => $vencido->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');

    // de outro paciente
    $deOutroPaciente = $criarTratamento(['paciente_id' => Paciente::factory()->create()->id]);
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'tratamento_id' => $deOutroPaciente->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');

    // válido passa
    $valido = $criarTratamento([]);
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'tratamento_id' => $valido->id,
    ])->assertCreated();
});

it('deve bloquear retroativo por padrão e permitir com a configuração', function () {
    // ARRANGE — design D8 (§13)
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $ontem = now()->subDay()->format('Y-m-d').' 09:00';

    // ACT + ASSERT — criar no passado → 422
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'inicio' => $ontem,
    ])->assertUnprocessable()->assertJsonValidationErrors('inicio');

    // mover para o passado → 422
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$payload, 'inicio' => $ontem,
    ])->assertUnprocessable()->assertJsonValidationErrors('inicio');

    // config ativa libera
    app(ConfiguracaoService::class)->set('agenda.permitir_retroativo', true);
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'paciente_id' => Paciente::factory()->create()->id,
        'inicio' => $ontem,
    ])->assertCreated();
});

it('deve mascarar obs no diff e manter horário e status em claro', function () {
    // ARRANGE — abuse case 9
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'obs' => 'Anotação sigilosa da família',
    ]);
    $criado->assertCreated();

    // ACT — muda obs e horário
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$payload,
        'inicio' => now()->addDays(3)->format('Y-m-d').' 10:00',
        'obs' => 'Outra anotação sigilosa',
    ])->assertOk();

    // ASSERT
    $registros = Auditoria::where('entidade', 'agendamentos')->get();
    expect($registros->pluck('acao'))->toContain('criou')->toContain('atualizou');
    foreach ($registros as $registro) {
        expect(json_encode($registro->diff_json))->not->toContain('sigilosa');
    }
    $update = $registros->firstWhere('acao', 'atualizou');
    expect($update->diff_json['depois'])->toHaveKey('inicio');
});

it('deve permitir agendamentos adjacentes sem conflito', function () {
    // ARRANGE — borda da primitiva D1 (gate r1, I4a): 09:00–09:40 e 09:40–10:20 coexistem
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload)->assertCreated();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'paciente_id' => Paciente::factory()->create()->id,
        'inicio' => now()->addDay()->format('Y-m-d').' 09:40',
    ])->assertCreated();
});

it('deve rejeitar tratamento de outra especialidade', function () {
    // ARRANGE — abuse case 12, 4º ramo (gate r1, I4b)
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $outraEspecialidade = Especialidade::factory()->create();
    $tratamento = Tratamento::create([
        'paciente_id' => $payload['paciente_id'],
        'convenio_id' => Convenio::create(['nome' => 'Particular'])->id,
        'especialidade_id' => $outraEspecialidade->id,
        'profissional_id' => $payload['profissional_id'],
        'sessoes_total' => 10,
    ]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'tratamento_id' => $tratamento->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('tratamento_id');
});

it('deve rejeitar bloqueio com fim antes ou igual ao início', function () {
    // ARRANGE — abuse case 8 (gate r1, I4c)
    $adminDaClinica = admin();
    $payload = baseDeAgenda();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'profissional_id' => $payload['profissional_id'],
        'inicio' => $payload['inicio'],
        'fim' => $payload['inicio'],
    ])->assertUnprocessable()->assertJsonValidationErrors('fim');
});

it('deve aceitar agendamento na próxima hora da parede da clínica', function () {
    // ARRANGE — gate r1 B1: parse fora do fuso da clínica rejeitava as próximas ~3h
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $fuso = app(ConfiguracaoService::class)->get('clinica.timezone');

    // ACT + ASSERT — 1h no futuro DA CLÍNICA é futuro, nunca retroativo
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'inicio' => now($fuso)->addHour()->format('Y-m-d H:i'),
    ])->assertCreated();

    // e 1h no passado da clínica continua retroativo
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload,
        'paciente_id' => Paciente::factory()->create()->id,
        'inicio' => now($fuso)->subHour()->format('Y-m-d H:i'),
    ])->assertUnprocessable()->assertJsonValidationErrors('inicio');
});

it('deve manter o conflito de sala em update parcial sem reenviar a sala', function () {
    // ARRANGE — gate r1 B2: estado final vale para sala/equipamento
    $adminDaClinica = admin();
    $sala = Sala::create(['nome' => 'Sala 1']);
    $dia = now()->addDay()->format('Y-m-d');

    // ocupa a sala às 14:00 com outro profissional
    $ocupante = baseDeAgenda();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$ocupante, 'sala_id' => $sala->id, 'inicio' => "{$dia} 14:00",
    ])->assertCreated();

    // agendamento COM a mesma sala às 09:00
    $payload = baseDeAgenda();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'sala_id' => $sala->id,
    ]);
    $criado->assertCreated();

    // ACT — move para as 14:00 SEM reenviar sala_id
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$payload, 'inicio' => "{$dia} 14:00",
    ]);

    // ASSERT — a sala mantida no estado final conflita
    $resposta->assertUnprocessable()->assertJsonValidationErrors('sala_id');
});

it('deve impedir bloqueio de ganhar paciente por update parcial', function () {
    // ARRANGE — gate r1 B3: invariante D3 no estado final
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $bloqueio = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'profissional_id' => $payload['profissional_id'],
        'inicio' => $payload['inicio'],
        'duracao_minutos' => 60,
        'obs' => 'Reunião',
    ]);
    $bloqueio->assertCreated();

    // ACT — PUT sem tipo tentando anexar paciente/status
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$bloqueio->json('id')}", [
        'profissional_id' => $payload['profissional_id'],
        'inicio' => $payload['inicio'],
        'duracao_minutos' => 60,
        'paciente_id' => $payload['paciente_id'],
    ]);

    // ASSERT — o tipo do registro prevalece e o payload proibido é rejeitado
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');

    // e mover o bloqueio sem reenviar tipo funciona (gate r1, I3)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$bloqueio->json('id')}", [
        'profissional_id' => $payload['profissional_id'],
        'inicio' => now()->addDays(2)->format('Y-m-d').' 09:00',
        'duracao_minutos' => 60,
    ])->assertOk();
});

it('deve manter atendimento sempre com status ao alternar tipo', function () {
    // ARRANGE — gate r1 B3: atendimento sem status seria slot fantasma
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $payload);
    $criado->assertCreated();

    // ACT — tenta zerar o status explicitamente
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$payload, 'status_id' => null,
    ]);

    // ASSERT — o default de menor ordem é reaplicado; nunca fica NULL
    $resposta->assertOk();
    expect($resposta->json('status_id'))->not->toBeNull();
});

it('deve zerar os vínculos clínicos ao converter atendimento em bloqueio', function () {
    // ARRANGE — gate r2: caminho de conversão via PUT com tipo explícito
    $adminDaClinica = admin();
    $payload = baseDeAgenda();
    $medico = Medico::create([
        'nome' => 'Dra. Fictícia', 'conselho' => 'CRM', 'uf_conselho' => 'SC', 'num_conselho' => '9',
    ]);
    $tratamento = Tratamento::create([
        'paciente_id' => $payload['paciente_id'],
        'convenio_id' => Convenio::create(['nome' => 'Particular'])->id,
        'especialidade_id' => $payload['especialidade_id'],
        'profissional_id' => $payload['profissional_id'],
        'sessoes_total' => 10,
    ]);
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'medico_id' => $medico->id, 'tratamento_id' => $tratamento->id,
    ]);
    $criado->assertCreated();
    expect(Agendamento::findOrFail($criado->json('id'))->tratamento_id)->not->toBeNull();

    // ACT — vira bloqueio (payload não pode trazer os campos proibidos)
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        'tipo' => 'bloqueio',
        'profissional_id' => $payload['profissional_id'],
        'inicio' => $payload['inicio'],
        'duracao_minutos' => 60,
        'obs' => 'Reunião',
    ])->assertOk();

    // ASSERT — nenhum resíduo clínico no banco (invariante D3)
    $bloqueio = Agendamento::findOrFail($criado->json('id'));
    expect($bloqueio->tipo)->toBe('bloqueio')
        ->and($bloqueio->paciente_id)->toBeNull()
        ->and($bloqueio->especialidade_id)->toBeNull()
        ->and($bloqueio->tratamento_id)->toBeNull()
        ->and($bloqueio->medico_id)->toBeNull()
        ->and($bloqueio->status_id)->toBeNull();
});

it('deve manter o conflito de equipamento em update parcial sem reenviá-lo', function () {
    // ARRANGE — gate r2 (nit): espelho do teste da sala
    $adminDaClinica = admin();
    $equipamento = Equipamento::create(['nome' => 'Esteira', 'quantidade_total' => 1]);
    $dia = now()->addDay()->format('Y-m-d');

    $ocupante = baseDeAgenda();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$ocupante, 'equipamento_id' => $equipamento->id, 'inicio' => "{$dia} 15:00",
    ])->assertCreated();

    $payload = baseDeAgenda();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'equipamento_id' => $equipamento->id,
    ]);
    $criado->assertCreated();

    // ACT — move para as 15:00 sem reenviar equipamento_id
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$payload, 'inicio' => "{$dia} 15:00",
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('equipamento_id');
});

it('deve responder 403 sem permissão', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/agenda?de=2026-07-01&ate=2026-07-07')
        ->assertForbidden();
});

/**
 * O VEREDITO do fim de pacote no payload do card (change alerta-de-fim-de-pacote, §13).
 *
 * Este contrato não tinha cenário: trocar o veredito por `'nenhum'` fixo no controller passava
 * com a suíte inteira verde, e a agenda ficava sem realce nenhum em produção.
 */
it('deve mandar o veredito do fim de pacote no card, decidido pelo limiar da clínica', function () {
    // ARRANGE — um pacote no fim e um longe do fim, no mesmo dia
    $adminDaClinica = admin();
    $profissional = Profissional::factory()->create();
    $especialidade = Especialidade::factory()->create();
    $profissional->especialidades()->attach($especialidade->id);

    $noFim = Tratamento::factory()->create([
        'paciente_id' => Paciente::factory()->create()->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'sessoes_total' => 10,
        'sessoes_realizadas' => 8, // saldo 2
        'status' => 'andamento',
    ]);
    $agendamento = Agendamento::factory()->create([
        'paciente_id' => $noFim->paciente_id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'tratamento_id' => $noFim->id,
        'inicio' => '2026-07-01 09:00:00',
        'fim' => '2026-07-01 09:40:00',
    ]);

    // ACT
    $grade = $this->actingAs($adminDaClinica)->getJson('/api/agenda?de=2026-07-01&ate=2026-07-01');

    // ASSERT — âmbar: ainda dá para atender, e é hora de cobrar
    $grade->assertOk();
    $card = collect($grade->json())->firstWhere('id', $agendamento->id);
    expect($card['tratamento_realce'])->toBe('acabando');

    // ACT — o pacote zera. `forceFill` porque `sessoes_realizadas` é guardado do mass
    // assignment de propósito (só o consumo de sessão o move); um `update()` aqui seria um
    // no-op SILENCIOSO e o cenário passaria sem provar nada.
    $noFim->forceFill(['sessoes_realizadas' => 10])->save();
    $depois = $this->actingAs($adminDaClinica)->getJson('/api/agenda?de=2026-07-01&ate=2026-07-01');

    // ASSERT — vermelho: outro fato, e a tela precisa saber qual é
    expect(collect($depois->json())->firstWhere('id', $agendamento->id)['tratamento_realce'])
        ->toBe('sem-saldo');

    // ACT — e o pacote PARADO, que era o cenário que o front não conseguia ver: o card recebia
    // saldo e total, e não o status
    $noFim->forceFill(['sessoes_realizadas' => 9, 'status' => 'parado'])->save();
    $parado = $this->actingAs($adminDaClinica)->getJson('/api/agenda?de=2026-07-01&ate=2026-07-01');

    // ASSERT
    expect(collect($parado->json())->firstWhere('id', $agendamento->id)['tratamento_realce'])
        ->toBe('nenhum');
});
