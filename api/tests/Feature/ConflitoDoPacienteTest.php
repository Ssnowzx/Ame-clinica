<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\ListaEspera;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Support\Agenda\VerificadorDeConflitos;
use App\Support\Configuracoes\ConfiguracaoService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/*
 * Eixo PACIENTE do conflito (change conflito-do-paciente).
 *
 * Mora numa suíte de Feature, e não em tests/Unit, porque a primitiva consulta o banco e só
 * `Feature` recebe RefreshDatabase + a clínica do teste (tests/Pest.php). Os primeiros casos
 * exercitam a PRIMITIVA direto — sem HTTP — para que a falha aponte a consulta, não a rota.
 *
 * Dados 100% fictícios (LGPD, §13): nenhuma criança real entra aqui.
 */

it('deve enxergar o paciente ocupado por OUTRO profissional na mesma faixa', function () {
    // ARRANGE — o caso que passava batido: nada de recurso é disputado
    admin();
    $paciente = Paciente::factory()->create();
    Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'inicio' => Carbon::parse('2026-09-01 09:00'),
        'fim' => Carbon::parse('2026-09-01 09:50'),
    ]);

    // ACT — outro profissional (a factory cria o seu), outra sala, mesma criança
    $ocupado = app(VerificadorDeConflitos::class)->pacienteOcupado(
        $paciente->id,
        Carbon::parse('2026-09-01 09:00'),
        Carbon::parse('2026-09-01 09:50'),
    );

    // ASSERT
    expect($ocupado)->toBeTrue();
});

it('deve tratar sobreposição PARCIAL como ocupação, e encaixe perfeito como livre', function () {
    // ARRANGE
    admin();
    $paciente = Paciente::factory()->create();
    Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'inicio' => Carbon::parse('2026-09-01 09:00'),
        'fim' => Carbon::parse('2026-09-01 09:50'),
    ]);
    $verificador = app(VerificadorDeConflitos::class);

    // ACT + ASSERT — 10 minutos de encavalamento bastam
    expect($verificador->pacienteOcupado(
        $paciente->id,
        Carbon::parse('2026-09-01 09:40'),
        Carbon::parse('2026-09-01 10:30'),
    ))->toBeTrue();

    // ...e o intervalo é semiaberto: quem começa quando o outro termina está livre
    expect($verificador->pacienteOcupado(
        $paciente->id,
        Carbon::parse('2026-09-01 09:50'),
        Carbon::parse('2026-09-01 10:40'),
    ))->toBeFalse();

    // ...assim como quem termina quando o outro começa
    expect($verificador->pacienteOcupado(
        $paciente->id,
        Carbon::parse('2026-09-01 08:10'),
        Carbon::parse('2026-09-01 09:00'),
    ))->toBeFalse();
});

it('deve ignorar quem não ocupa o horário: status que libera, outro paciente e o próprio id', function () {
    // ARRANGE
    admin();
    $paciente = Paciente::factory()->create();
    $desmarcado = StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail();
    $liberado = Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'status_id' => $desmarcado->id,
        'inicio' => Carbon::parse('2026-09-01 09:00'),
        'fim' => Carbon::parse('2026-09-01 09:50'),
    ]);
    $verificador = app(VerificadorDeConflitos::class);

    // ACT + ASSERT — status com ocupa_horario falso abre o slot, como nos outros eixos
    expect($verificador->pacienteOcupado(
        $paciente->id,
        Carbon::parse('2026-09-01 09:00'),
        Carbon::parse('2026-09-01 09:50'),
    ))->toBeFalse();

    // o agendamento de OUTRA criança na mesma faixa não é dela
    $ocupante = Agendamento::factory()->create([
        'inicio' => Carbon::parse('2026-09-01 09:00'),
        'fim' => Carbon::parse('2026-09-01 09:50'),
    ]);
    expect($verificador->pacienteOcupado(
        $paciente->id,
        Carbon::parse('2026-09-01 09:00'),
        Carbon::parse('2026-09-01 09:50'),
    ))->toBeFalse()
        ->and($ocupante->paciente_id)->not->toBe($paciente->id);

    // e o próprio registro sob edição nunca conflita consigo mesmo
    $proprio = Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'inicio' => Carbon::parse('2026-09-01 09:00'),
        'fim' => Carbon::parse('2026-09-01 09:50'),
    ]);
    expect($verificador->pacienteOcupado(
        $paciente->id,
        Carbon::parse('2026-09-01 09:00'),
        Carbon::parse('2026-09-01 09:50'),
        [$proprio->id],
    ))->toBeFalse()
        ->and($liberado->status_id)->toBe($desmarcado->id);
});

it('deve deixar o BLOQUEIO de fora do eixo, sem precisar de if', function () {
    // ARRANGE — bloqueio marca ausência do profissional e não tem paciente (design D2)
    admin();
    $paciente = Paciente::factory()->create();
    Agendamento::factory()->create([
        'tipo' => 'bloqueio',
        'paciente_id' => null,
        // profissional explícito: sem especialidade, a closure da factory não tem o que vincular
        'profissional_id' => Profissional::factory()->create()->id,
        'especialidade_id' => null,
        'status_id' => null,
        'inicio' => Carbon::parse('2026-09-01 09:00'),
        'fim' => Carbon::parse('2026-09-01 09:50'),
    ]);

    // ACT
    $ocupado = app(VerificadorDeConflitos::class)->pacienteOcupado(
        $paciente->id,
        Carbon::parse('2026-09-01 09:00'),
        Carbon::parse('2026-09-01 09:50'),
    );

    // ASSERT — o bloqueio ocupa o PROFISSIONAL; a criança segue livre
    expect($ocupado)->toBeFalse();
});

/*
 * Daqui para baixo: a AÇÃO configurada pela clínica (§13) pelos caminhos de escrita de verdade.
 */

it('deve recusar a segunda marcação da mesma criança, com a configuração default', function () {
    // ARRANGE — o caso que motivou a change: fono às 09:00 e TO às 09:00, salas diferentes
    $adminDaClinica = admin();
    $primeiro = baseDeAgenda();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $primeiro)->assertCreated();

    // ACT — outro profissional e outra especialidade, MESMA criança e MESMO horário
    $segundo = baseDeAgenda();
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$segundo,
        'paciente_id' => $primeiro['paciente_id'],
    ]);

    // ASSERT — a recusa aponta o campo do paciente, e nada foi criado
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
    expect($resposta->json('errors.paciente_id.0'))->toContain('outro atendimento neste horário')
        ->and(Agendamento::count())->toBe(1);
});

it('deve aceitar e AVISAR quando a clínica escolhe avisar, sem persistir o aviso', function () {
    // ARRANGE — sessão conjunta (fono + TO na mesma criança) é a razão da saída existir
    $adminDaClinica = admin();
    app(ConfiguracaoService::class)->set('agenda.conflito_paciente', 'avisar');
    $primeiro = baseDeAgenda();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $primeiro)->assertCreated();

    // ACT
    $segundo = baseDeAgenda();
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$segundo,
        'paciente_id' => $primeiro['paciente_id'],
    ]);

    // ASSERT — criado, com a data do choque na resposta
    $resposta->assertCreated()
        ->assertJsonPath('alerta_paciente', [substr((string) $segundo['inicio'], 0, 10)]);
    expect(Agendamento::count())->toBe(2);

    // ...e o aviso não tem porta de persistência: relendo o agendamento, ele não existe
    $this->actingAs($adminDaClinica)->getJson("/api/agendamentos/{$resposta->json('id')}")
        ->assertOk()
        ->assertJsonMissingPath('alerta_paciente');
});

it('deve nem consultar o eixo quando a clínica escolhe permitir', function () {
    // ARRANGE
    $adminDaClinica = admin();
    app(ConfiguracaoService::class)->set('agenda.conflito_paciente', 'permitir');
    $primeiro = baseDeAgenda();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $primeiro)->assertCreated();

    // ACT
    $segundo = baseDeAgenda();
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$segundo,
        'paciente_id' => $primeiro['paciente_id'],
    ]);

    // ASSERT — nem 422 nem aviso
    $resposta->assertCreated()->assertJsonMissingPath('alerta_paciente');
    expect(Agendamento::count())->toBe(2);
});

/**
 * Um par sobreposto JÁ GRAVADO (legado, ou nascido no modo `avisar`) — a cena que o achado
 * BLOQUEANTE do gate expôs. O eixo só pode barrar a sobreposição NOVA; re-litigar a antiga a
 * cada escrita envenenava a operação: o par ficava mutuamente ineditável e o desmarque em lote
 * recusava a linha que ele existe para desmarcar.
 *
 * @return array{0: Agendamento, 1: Agendamento, 2: Carbon}
 */
function parSobrepostoJaGravado(int $pacienteId, string $quando = '2026-09-01 09:00'): array
{
    $inicio = Carbon::parse($quando);
    $comum = ['paciente_id' => $pacienteId, 'inicio' => $inicio, 'fim' => $inicio->copy()->addMinutes(40)];

    return [Agendamento::factory()->create($comum), Agendamento::factory()->create($comum), $inicio];
}

it('deve deixar EDITAR um par sobreposto que já estava no banco', function () {
    // ARRANGE — o eixo barra sobreposição NOVA; esta já existia
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    [, $segundo, $inicio] = parSobrepostoJaGravado($paciente->id);
    $outroStatus = StatusAgendamento::where('nome', 'Aguardando Atendimento')->firstOrFail();

    // ACT — avançar o status pelo card: mesmo horário, mesma criança
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$segundo->id}", [
        'inicio' => $inicio->format('Y-m-d H:i'),
        'profissional_id' => $segundo->profissional_id,
        'status_id' => $outroStatus->id,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($segundo->refresh()->status_id)->toBe($outroStatus->id);
});

it('deve deixar DESMARCAR um par sobreposto — a baixa devolve o slot, não o disputa', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    [$primeiro, , $inicio] = parSobrepostoJaGravado($paciente->id);
    $desmarcado = StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$primeiro->id}", [
        'inicio' => $inicio->format('Y-m-d H:i'),
        'profissional_id' => $primeiro->profissional_id,
        'status_id' => $desmarcado->id,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($primeiro->refresh()->status_id)->toBe($desmarcado->id);
});

it('deve recusar quando o agendamento PASSA A OCUPAR o horário da criança', function () {
    // ARRANGE — o buraco que a guarda de "sobreposição nova" poderia abrir: reativar um
    // desmarcado por cima de uma sessão da mesma criança CRIA a sobreposição
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $inicio = Carbon::parse('2026-09-01 09:00');
    $desmarcado = StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail();
    $liberado = Agendamento::factory()->create([
        'paciente_id' => $paciente->id, 'status_id' => $desmarcado->id,
        'inicio' => $inicio, 'fim' => $inicio->copy()->addMinutes(40),
    ]);
    Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'inicio' => $inicio, 'fim' => $inicio->copy()->addMinutes(40),
    ]);
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$liberado->id}", [
        'inicio' => $inicio->format('Y-m-d H:i'),
        'profissional_id' => $liberado->profissional_id,
        'status_id' => $emAberto->id,
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
    expect($liberado->refresh()->status_id)->toBe($desmarcado->id);
});

it('deve recusar quando o PUT TROCA a criança para uma que já está ocupada', function () {
    // ARRANGE — a proteção de estado final que continua valendo: trocar de criança CRIA
    // a sobreposição, mesmo sem mexer no horário
    $adminDaClinica = admin();
    $ocupada = Paciente::factory()->create();
    $inicio = Carbon::parse('2026-09-01 09:00');
    Agendamento::factory()->create([
        'paciente_id' => $ocupada->id,
        'inicio' => $inicio, 'fim' => $inicio->copy()->addMinutes(40),
    ]);
    $alvo = Agendamento::factory()->create([
        'inicio' => $inicio, 'fim' => $inicio->copy()->addMinutes(40),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$alvo->id}", [
        'inicio' => $inicio->format('Y-m-d H:i'),
        'profissional_id' => $alvo->profissional_id,
        'especialidade_id' => $alvo->especialidade_id,
        'paciente_id' => $ocupada->id,
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
    expect($alvo->refresh()->paciente_id)->not->toBe($ocupada->id);
});

it('não deve fazer o agendamento conflitar CONSIGO MESMO ao ser editado', function () {
    // ARRANGE — o defeito que a change `desmarque-do-profissional` teve de desfazer: o card
    // vira ineditável porque a validação encontra o próprio registro como ocupante
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $base)->assertCreated();
    $outroStatus = StatusAgendamento::where('nome', 'Aguardando Atendimento')->firstOrFail();

    // ACT — mesma faixa, só o status muda
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$base,
        'status_id' => $outroStatus->id,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect(Agendamento::findOrFail($criado->json('id'))->status_id)->toBe($outroStatus->id);
});

it('não deve fazer as IRMÃS da série conflitarem entre si no aplicar-na-série', function () {
    // ARRANGE — série semanal de 3; o grupo inteiro fica fora da contagem
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base,
        'recorrencia' => ['ate' => Carbon::parse($base['inicio'])->addWeeks(2)->format('Y-m-d')],
    ])->assertCreated();
    $primeira = $serie->json('agendamentos.0.id');
    $outroStatus = StatusAgendamento::where('nome', 'Aguardando Atendimento')->firstOrFail();

    // ACT — propaga o status para as futuras, sem mexer no horário
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$primeira}", [
        ...$base,
        'status_id' => $outroStatus->id,
        'aplicar_na_serie' => true,
    ]);

    // ASSERT
    $resposta->assertOk();
    expect(Agendamento::where('status_id', $outroStatus->id)->count())->toBe(3);
});

it('deve derrubar a SÉRIE inteira quando uma ocorrência acha a criança ocupada', function () {
    // ARRANGE — a criança já tem, na 2ª semana, atendimento com outro profissional
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $segundaSemana = Carbon::parse($base['inicio'])->addWeek();
    Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'inicio' => $segundaSemana,
        'fim' => $segundaSemana->copy()->addMinutes(40),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base,
        'recorrencia' => ['ate' => $segundaSemana->copy()->addWeek()->format('Y-m-d')],
    ]);

    // ASSERT — a data em choque é nomeada e NADA da série foi criado
    $resposta->assertUnprocessable()->assertJsonValidationErrors('recorrencia');
    // dd/mm/aaaa e o motivo por extenso (change `conflito-da-serie-diz-o-motivo`)
    expect($resposta->json('errors.recorrencia.0'))
        ->toContain($segundaSemana->format('d/m/Y'))
        ->toContain('a criança já tem outro atendimento neste horário')
        ->and(Agendamento::count())->toBe(1); // só o que a ARRANGE plantou
});

it('deve recusar o aplicar-na-série quando uma IRMÃ deslocada cai em cima da criança', function () {
    // ARRANGE — remarcar a série desloca todas pelo mesmo delta; a validação das irmãs roda no
    // ESTADO FINAL de cada uma, e o eixo do paciente entra ali por construção
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $serie = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base,
        'recorrencia' => ['ate' => Carbon::parse($base['inicio'])->addWeek()->format('Y-m-d')],
    ])->assertCreated();

    // a criança já tem, na 2ª semana, atendimento no horário PARA ONDE a irmã vai
    $destinoDaIrma = Carbon::parse($base['inicio'])->addWeek()->addHours(2);
    Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'inicio' => $destinoDaIrma,
        'fim' => $destinoDaIrma->copy()->addMinutes(40),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao(
        "/api/agendamentos/{$serie->json('agendamentos.0.id')}",
        [
            ...$base,
            'inicio' => Carbon::parse($base['inicio'])->addHours(2)->format('Y-m-d H:i'),
            'aplicar_na_serie' => true,
        ],
    );

    // ASSERT — nomeia a data e NADA da série se moveu
    $resposta->assertUnprocessable()->assertJsonValidationErrors('recorrencia');
    expect($resposta->json('errors.recorrencia.0'))->toContain($destinoDaIrma->format('Y-m-d'))
        ->and(Agendamento::whereKey($serie->json('agendamentos.0.id'))->value('inicio')->format('H:i'))
        ->toBe(Carbon::parse($base['inicio'])->format('H:i'));
});

it('deve recusar o ARRASTO para um horário em que a criança já está ocupada', function () {
    // ARRANGE — remarcar (arrastar o card) é PUT com horário novo
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $base)->assertCreated();
    $destino = Carbon::parse($base['inicio'])->addHours(2);
    Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'inicio' => $destino,
        'fim' => $destino->copy()->addMinutes(40),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$base,
        'inicio' => $destino->format('Y-m-d H:i'),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
    expect(Agendamento::findOrFail($criado->json('id'))->inicio->format('H:i'))
        ->toBe(Carbon::parse($base['inicio'])->format('H:i'));
});

it('deve manter a entrada na FILA quando o encaixe acha a criança ocupada', function () {
    // ARRANGE — o horário está livre para o profissional; quem está ocupada é a criança
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $entrada = ListaEspera::create([
        'paciente_id' => $base['paciente_id'],
        'especialidade_id' => $base['especialidade_id'],
        'profissional_id' => $base['profissional_id'],
        'prioridade' => 5,
    ]);
    $inicio = Carbon::parse($base['inicio']);
    Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'inicio' => $inicio,
        'fim' => $inicio->copy()->addMinutes(40),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ]);

    // ASSERT — recusa no campo do paciente E a fila não andou
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
    expect(ListaEspera::find($entrada->id))->not->toBeNull()
        ->and(Agendamento::count())->toBe(1);
});

it('não deve atrapalhar o desmarque em lote, que só cria BLOQUEIO', function () {
    // ARRANGE — guarda de regressão: a mesma criança em dois horários do dia, e a baixa em
    // massa cria bloqueios (sem paciente) sobre eles. O eixo não pode derrubar o lote.
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    app(ConfiguracaoService::class)->set(
        'agenda.status_desmarque_id',
        StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail()->id
    );
    foreach (['2026-09-14 09:00', '2026-09-14 14:00'] as $quando) {
        Agendamento::factory()->create([
            'paciente_id' => $base['paciente_id'],
            'profissional_id' => $base['profissional_id'],
            'especialidade_id' => $base['especialidade_id'],
            'inicio' => Carbon::parse($quando),
            'fim' => Carbon::parse($quando)->addMinutes(40),
        ]);
    }

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'dia',
    ]);

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json('desmarcados'))->toBe(2);
});

it('deve desmarcar em lote o par SOBREPOSTO, com a prévia e a execução concordando', function () {
    // ARRANGE — o cenário do achado BLOQUEANTE do gate, e o que o teste anterior NÃO cobria:
    // a mesma criança às 09:00 com DOIS profissionais. A recepção dá baixa no dia de um deles.
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    app(ConfiguracaoService::class)->set(
        'agenda.status_desmarque_id',
        StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail()->id
    );
    $quando = Carbon::parse('2026-09-14 09:00');
    Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'inicio' => $quando, 'fim' => $quando->copy()->addMinutes(40),
    ]);
    Agendamento::factory()->create([ // o outro profissional, mesma criança, mesmo horário
        'paciente_id' => $base['paciente_id'],
        'inicio' => $quando, 'fim' => $quando->copy()->addMinutes(40),
    ]);
    $alcance = [
        'profissional_id' => $base['profissional_id'],
        'de' => '2026-09-14', 'ate' => '2026-09-14', 'periodo' => 'dia',
    ];

    // ACT
    $previa = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote/previa', $alcance);
    $execucao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/desmarque-em-lote', $alcance);

    // ASSERT — a prévia PROMETE e a execução ENTREGA o mesmo número; nada recusado
    $previa->assertOk();
    $execucao->assertOk();
    expect($execucao->json('desmarcados'))->toBe($previa->json('contagens.agendamentos'))
        ->and($execucao->json('recusados'))->toBe([])
        ->and($previa->json('recusados'))->toBe([]);
});

/*
 * O modo `avisar` nos três caminhos que NÃO são o POST simples. Um `it` por caminho (padrão AAA):
 * encadeados num teste só, a falha do primeiro escondia a cobertura dos outros dois.
 */

/** Liga o modo `avisar` na clínica. */
function comAvisoDeSobreposicao(): void
{
    app(ConfiguracaoService::class)->set('agenda.conflito_paciente', 'avisar');
}

it('deve avisar no ENCAIXE da fila sem devolver o paciente para a fila', function () {
    // ARRANGE
    $adminDaClinica = admin();
    comAvisoDeSobreposicao();
    $daFila = baseDeAgenda();
    $entrada = ListaEspera::create([
        'paciente_id' => $daFila['paciente_id'],
        'especialidade_id' => $daFila['especialidade_id'],
        'profissional_id' => $daFila['profissional_id'],
        'prioridade' => 5,
    ]);
    $inicio = Carbon::parse($daFila['inicio']);
    Agendamento::factory()->create([
        'paciente_id' => $daFila['paciente_id'],
        'inicio' => $inicio, 'fim' => $inicio->copy()->addMinutes(40),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $daFila['inicio'],
        'profissional_id' => $daFila['profissional_id'],
        'especialidade_id' => $daFila['especialidade_id'],
    ]);

    // ASSERT — aviso, não recusa: a fila andou
    $resposta->assertCreated()->assertJsonPath('alerta_paciente', [$inicio->format('Y-m-d')]);
    expect(ListaEspera::find($entrada->id))->toBeNull();
});

it('deve avisar na SÉRIE com UMA DATA POR OCORRÊNCIA em choque', function () {
    // ARRANGE — "avisou em alguma das 52" não é informação com a qual dê para trabalhar
    $adminDaClinica = admin();
    comAvisoDeSobreposicao();
    $daSerie = baseDeAgenda();
    $primeira = Carbon::parse($daSerie['inicio']);
    foreach ([1, 2] as $semanas) {
        $emChoque = $primeira->copy()->addWeeks($semanas);
        Agendamento::factory()->create([
            'paciente_id' => $daSerie['paciente_id'],
            'inicio' => $emChoque, 'fim' => $emChoque->copy()->addMinutes(40),
        ]);
    }

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$daSerie,
        'recorrencia' => ['ate' => $primeira->copy()->addWeeks(2)->format('Y-m-d')],
    ]);

    // ASSERT
    $resposta->assertCreated()
        ->assertJsonPath('criados', 3)
        ->assertJsonPath('alerta_paciente', [
            $primeira->copy()->addWeek()->format('Y-m-d'),
            $primeira->copy()->addWeeks(2)->format('Y-m-d'),
        ]);
});

it('deve avisar no PUT que MOVE para cima de uma sessão da própria criança', function () {
    // ARRANGE
    $adminDaClinica = admin();
    comAvisoDeSobreposicao();
    $base = baseDeAgenda();
    $criado = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $base)->assertCreated();
    $destino = Carbon::parse($base['inicio'])->addHours(2);
    Agendamento::factory()->create([
        'paciente_id' => $base['paciente_id'],
        'inicio' => $destino, 'fim' => $destino->copy()->addMinutes(40),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$criado->json('id')}", [
        ...$base,
        'inicio' => $destino->format('Y-m-d H:i'),
    ]);

    // ASSERT
    $resposta->assertOk()->assertJsonPath('alerta_paciente', [$destino->format('Y-m-d')]);
});

/*
 * SEC-CP-01 — o eixo não pode virar oráculo da agenda alheia.
 *
 * O helper nasce AQUI (e não é importado de `EscopoProfissionalTest`) de propósito: função
 * definida dentro de um `*Test.php` só existe quando aquela suíte roda, e sob `--parallel` os
 * dois arquivos caem em workers diferentes. É o defeito que já deixa `DesmarqueAvisoTest`
 * vermelho no repo — não vou plantar o segundo.
 */

/** Profissional + especialidade vinculada + usuário escopado a ele (papel sem `agenda.ver_todos`). */
function escopadoComEspecialidade(): array
{
    $profissional = Profissional::factory()->create();
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return [usuarioEscopadoEm($profissional), $profissional, $especialidade];
}

it('NÃO deve contar ao profissional escopado que a criança do colega está ocupada (SEC-CP-01)', function () {
    // ARRANGE — reescrito pela change `vinculo-previo-para-agendar` (fecha o SEC-CP-04).
    //
    // ANTES desta change o escopado CRIAVA o agendamento da criança do colega — a versão
    // anterior deste teste terminava em `assertCreated()` — e o SEC-CP-01 se resolvia calando
    // o eixo. Era a auto-concessão em pessoa: a marcação satisfazia o próprio EXISTS e devolvia
    // a ficha inteira da criança. A clínica desmentiu o fluxo (Mariana, 2026-08-31: *"Sempre
    // passa pela recepção"*), e agora a criação é RECUSADA.
    //
    // O INVARIANTE não mudou: o escopado não pode descobrir se a criança alheia está ocupada.
    // O que mudou é como se prova. Trocar `assertCreated` por `assertStatus(422)` e manter o
    // `assertJsonMissingPath` seria prova na condição errada — sem criação não há alerta, e a
    // asserção não conseguiria falhar. O que AINDA pode falhar é a IDENTIDADE das respostas:
    // se a trava regredir, a criança ocupada e a livre passam a responder diferente.
    $adminDaClinica = admin();
    [$escopado, $profissional, $especialidade] = escopadoComEspecialidade();

    $ocupada = baseDeAgenda();   // criança do colega COM sessão no horário
    $livre = baseDeAgenda();     // criança do colega SEM nada no horário
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $ocupada)->assertCreated();

    $pedido = fn (int $pacienteId) => [
        'paciente_id' => $pacienteId,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => $ocupada['inicio'],
    ];

    // ACT — o escopado tenta as DUAS; a recepção plana serve de par de controle
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $sobreOcupada = $this->actingAs($escopado)->postJson('/api/agendamentos', $pedido($ocupada['paciente_id']));
    $sobreLivre = $this->actingAs($escopado)->postJson('/api/agendamentos', $pedido($livre['paciente_id']));

    // ASSERT — o escopado é recusado nas duas, e as respostas são INDISTINGUÍVEIS: é isso que
    // impede o oráculo. Uma diferença aqui é a informação vazando.
    $sobreOcupada->assertStatus(422)->assertJsonValidationErrors('paciente_id');
    expect($sobreLivre->status())->toBe($sobreOcupada->status());
    expect($sobreLivre->json('errors.paciente_id'))->toBe($sobreOcupada->json('errors.paciente_id'));
    expect($sobreLivre->json('message'))->toBe($sobreOcupada->json('message'));
    expect(Agendamento::where('profissional_id', $profissional->id)->count())->toBe(0);

    // ...e havia MESMO o que vazar: para a recepção (plana), as duas crianças respondem
    // DIFERENTE — a ocupada é recusada pelo eixo, a livre é criada. Sem este par, o teste
    // acima passaria num sistema que simplesmente recusa tudo.
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $pedido($ocupada['paciente_id']))
        ->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', $pedido($livre['paciente_id']))
        ->assertCreated();
});

it('NÃO deve entregar ao escopado o MAPA da criança do colega no modo avisar (SEC-CP-03)', function () {
    // ARRANGE — o vetor de MAIOR rendimento do gate: o oráculo do 422 exigia 19 sondas para um
    // intervalo; uma série no modo `avisar` devolvia as datas da criança alheia numa requisição
    // só.
    //
    // Reescrito pela change `vinculo-previo-para-agendar`: o escopado não cria mais série sobre
    // criança alheia, então `assertJsonMissingPath('alerta_paciente')` deixou de poder falhar —
    // é a mesma armadilha que o comentário original desta suíte denunciava ("prova na condição
    // errada não é prova"), só que do outro lado. A prova que SOBREVIVE é a identidade: a
    // criança com três semanas de sessões e a criança sem nenhuma respondem igual ao escopado.
    $adminDaClinica = admin();
    app(ConfiguracaoService::class)->set('agenda.conflito_paciente', 'avisar');
    [$escopado, $profissional, $especialidade] = escopadoComEspecialidade();

    $doColega = baseDeAgenda();
    $semNada = baseDeAgenda();
    $primeira = Carbon::parse($doColega['inicio']);
    foreach ([0, 1, 2] as $semanas) {
        $quando = $primeira->copy()->addWeeks($semanas);
        Agendamento::factory()->create([
            'paciente_id' => $doColega['paciente_id'],
            'inicio' => $quando, 'fim' => $quando->copy()->addMinutes(40),
        ]);
    }

    // o ARRANJO é fixado ANTES do ACT: sem isto, deslocar as datas para fora da faixa deixaria
    // o teste verde COM o defeito presente — achado da rodada 3 do gate.
    $verificador = app(VerificadorDeConflitos::class);
    foreach ([0, 1, 2] as $semanas) {
        $quando = $primeira->copy()->addWeeks($semanas);
        expect($verificador->pacienteOcupado(
            $doColega['paciente_id'],
            $quando,
            $quando->copy()->addMinutes(40),
        ))->toBeTrue("A criança do colega precisa estar ocupada na semana {$semanas}.");
    }

    $serie = fn (int $pacienteId) => [
        'paciente_id' => $pacienteId,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => $doColega['inicio'],
        'recorrencia' => ['ate' => $primeira->copy()->addWeeks(2)->format('Y-m-d')],
    ];

    // ACT — o escopado pede a série sobre a criança CHEIA e sobre a VAZIA
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $sobreCheia = $this->actingAs($escopado)->postJson('/api/agendamentos', $serie($doColega['paciente_id']));
    $sobreVazia = $this->actingAs($escopado)->postJson('/api/agendamentos', $serie($semNada['paciente_id']));

    // ASSERT — recusadas as duas, e IDÊNTICAS: nem o mapa, nem a existência dele
    $sobreCheia->assertStatus(422);
    expect($sobreVazia->status())->toBe($sobreCheia->status());
    expect($sobreVazia->json('errors.paciente_id'))->toBe($sobreCheia->json('errors.paciente_id'));
    expect($sobreCheia->json('alerta_paciente'))->toBeNull();

    // ...e o mapa EXISTIA: a recepção plana, pedindo a mesma série, recebe as três datas. Sem
    // este par o teste acima passaria num sistema onde não houvesse nada a vazar.
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $terceiro = baseDeAgenda();
    $pelaRecepcao = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$serie($doColega['paciente_id']),
        'profissional_id' => $terceiro['profissional_id'],
        'especialidade_id' => $terceiro['especialidade_id'],
    ]);
    // AS TRÊS DATAS, não só "não é nulo": o par existe para provar QUE MAPA vazaria, e um
    // `not->toBeNull` passaria com um alerta vazio — o que esvaziaria a prova sem ninguém notar.
    expect($pelaRecepcao->json('alerta_paciente'))->toBe(
        array_map(fn (int $s) => $primeira->copy()->addWeeks($s)->format('Y-m-d'), [0, 1, 2]),
        'A recepção precisa receber as três datas — senão não havia mapa a vazar.'
    );
});

it('deve manter a trava para o escopado quando a criança É dele (SEC-CP-01)', function () {
    // ARRANGE — fechar o oráculo não pode desligar a regra onde ela é legítima: a criança já é
    // paciente dele, então ele enxerga a agenda dela e a sobreposição é informação que já tinha
    $adminDaClinica = admin();
    [$escopado, $profissional, $especialidade] = escopadoComEspecialidade();
    $paciente = Paciente::factory()->create();
    $amanha = agoraNaClinica()->copy()->addDay()->setTime(9, 0)->setSeconds(0);

    // vínculo: a criança já tem sessão COM ele (semana que vem)
    Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => $amanha->copy()->addWeek(),
        'fim' => $amanha->copy()->addWeek()->addMinutes(40),
    ]);
    // ...e uma sessão com OUTRO profissional amanhã 09:00
    Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'inicio' => $amanha, 'fim' => $amanha->copy()->addMinutes(40),
    ]);

    // ACT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $resposta = $this->actingAs($escopado)->postJson('/api/agendamentos', [
        'paciente_id' => $paciente->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => $amanha->format('Y-m-d H:i'),
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
});
