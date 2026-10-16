<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\ListaEspera;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Sala;
use App\Models\StatusAgendamento;
use App\Support\Agenda\VerificadorDeConflitos;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/*
 * Eixos PROFISSIONAL e SALA do conflito, agora por CAPACIDADE (change atendimento-em-grupo).
 *
 * Pedido da clínica (2026-09-15): três profissionais atendem até 4 crianças no mesmo horário,
 * na mesma sala. O que muda é a pergunta da guarda — de "existe alguém?" para "quantos cabem?".
 *
 * Os primeiros casos batem na PRIMITIVA direto, sem HTTP, para que a falha aponte a consulta e
 * não a rota. Dados 100% fictícios (LGPD, §13): nenhuma criança real entra aqui.
 */

/**
 * A segunda-feira que vem, no relógio da clínica. Era a data fixa `2026-10-05`: no próprio dia, depois
 * das 09:00, o horário virou passado e a regra do agendamento retroativo recusava antes da capacidade.
 */
function diaDoAtendimentoEmGrupo(): string
{
    return agoraNaClinica()->next(Carbon::MONDAY)->format('Y-m-d');
}

/** Um profissional com capacidade declarada, já vinculado a uma especialidade de 40 min. */
function profissionalComCapacidade(int $capacidade): array
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create(['atendimentos_simultaneos' => $capacidade]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return [$profissional, $especialidade];
}

/** N atendimentos ocupantes sobrepostos na mesma faixa do profissional. */
function encherAgenda(Profissional $profissional, Especialidade $especialidade, int $quantos, ?Sala $sala = null): void
{
    foreach (range(1, $quantos) as $i) {
        Agendamento::factory()->create([
            'profissional_id' => $profissional->id,
            'especialidade_id' => $especialidade->id,
            'sala_id' => $sala?->id,
            'inicio' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:00'),
            'fim' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:40'),
        ]);
    }
}

function verificarNaFaixa(Profissional $profissional, int $capacidade, ?Sala $sala = null, int $capacidadeSala = 1): array
{
    return app(VerificadorDeConflitos::class)->verificar(
        $profissional->id,
        Carbon::parse(diaDoAtendimentoEmGrupo().' 09:00'),
        Carbon::parse(diaDoAtendimentoEmGrupo().' 09:40'),
        $sala?->id,
        null,
        null,
        [],
        'atendimento',
        true,
        $capacidade,
        $capacidadeSala,
    );
}

it('deve recusar o segundo atendimento quando o profissional atende um por vez', function () {
    // ARRANGE — o comportamento de sempre, que o default 1 tem de preservar
    admin();
    [$profissional, $especialidade] = profissionalComCapacidade(1);
    encherAgenda($profissional, $especialidade, 1);

    // ACT
    $conflitos = verificarNaFaixa($profissional, 1);

    // ASSERT
    expect($conflitos)->toHaveKey('profissional_id')
        ->and($conflitos['profissional_id']->causa)->toBe(VerificadorDeConflitos::CAUSA_CAPACIDADE)
        ->and($conflitos['profissional_id']->mensagem)->toBe('Horário ocupado do profissional.');
});

it('deve aceitar o quarto atendimento do profissional que atende quatro ao mesmo tempo', function () {
    // ARRANGE — a agenda da Margarete com três crianças e uma vaga
    admin();
    [$profissional, $especialidade] = profissionalComCapacidade(4);
    encherAgenda($profissional, $especialidade, 3);

    // ACT
    $conflitos = verificarNaFaixa($profissional, 4);

    // ASSERT
    expect($conflitos)->not->toHaveKey('profissional_id');
});

it('deve recusar o quinto nomeando o teto alcançado', function () {
    // ARRANGE
    admin();
    [$profissional, $especialidade] = profissionalComCapacidade(4);
    encherAgenda($profissional, $especialidade, 4);

    // ACT
    $conflitos = verificarNaFaixa($profissional, 4);

    // ASSERT — "horário ocupado" deixaria de ser verdade num recurso que aceita quatro. E o
    // número é a contagem REAL, não o teto: com o teto baixado depois, anunciar o teto mentiria
    expect($conflitos['profissional_id']->causa)->toBe(VerificadorDeConflitos::CAUSA_CAPACIDADE)
        ->and($conflitos['profissional_id']->mensagem)
        ->toBe('O profissional já tem 4 atendimentos neste horário (limite 4).');
});

it('deve manter o BLOQUEIO como veto absoluto, sem dividir vaga com a capacidade', function () {
    // ARRANGE — o defeito que esta ordem existe para impedir: com uma contagem única, uma folga
    // declarada de quem tem teto 4 aceitaria TRÊS atendimentos por cima
    admin();
    [$profissional] = profissionalComCapacidade(4);
    Agendamento::factory()->create([
        'tipo' => 'bloqueio',
        'profissional_id' => $profissional->id,
        'paciente_id' => null,
        'especialidade_id' => null,
        'status_id' => null,
        'inicio' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:00'),
        'fim' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:40'),
    ]);

    // ACT — nenhum atendimento na faixa: a contagem sozinha diria "0 de 4, pode entrar"
    $conflitos = verificarNaFaixa($profissional, 4);

    // ASSERT — e a causa é BLOQUEIO, não capacidade: é ela que impede o serviço de relevar
    expect($conflitos)->toHaveKey('profissional_id')
        ->and($conflitos['profissional_id']->causa)->toBe(VerificadorDeConflitos::CAUSA_BLOQUEIO)
        ->and($conflitos['profissional_id']->mensagem)->toBe('Este horário do profissional está bloqueado.');
});

it('deve comportar o grupo inteiro na mesma sala e recusar quem passa do teto dela', function () {
    // ARRANGE — o grupo da clínica é NA MESMA SALA: sem capacidade aqui, a recusa só trocaria
    // de eixo
    admin();
    [$profissional, $especialidade] = profissionalComCapacidade(4);
    $sala = Sala::create(['nome' => 'Sala do grupo', 'capacidade' => 4]);
    encherAgenda($profissional, $especialidade, 3, $sala);

    // ACT — a quarta cabe
    $comVaga = verificarNaFaixa($profissional, 4, $sala, 4);

    // ASSERT
    expect($comVaga)->toBe([]);

    // ACT — a quinta não
    encherAgenda($profissional, $especialidade, 1, $sala);
    $cheia = verificarNaFaixa($profissional, 4, $sala, 4);

    // ASSERT — a frase da sala NÃO diz o número: `salas.capacidade` não sai em
    // `/agenda/selecao`, e dizê-la aqui publicaria o cadastro a quem não tem `salas.ver`
    expect($cheia)->toHaveKey('sala_id')
        ->and($cheia['sala_id']->mensagem)->toBe('A sala não tem mais vaga neste horário.');
});

it('deve calar o intervalo ocupado enquanto o profissional ainda tem vaga', function () {
    // ARRANGE — a frase da recusa da série aponta "já há atendimento das X às Y" para dizer
    // PARA ONDE mover; com vaga sobrando ela mandaria mover uma sessão que cabia
    admin();
    [$profissional, $especialidade] = profissionalComCapacidade(4);
    encherAgenda($profissional, $especialidade, 2);

    // ACT
    $comVaga = app(VerificadorDeConflitos::class)->intervaloOcupadoDoProfissional(
        $profissional->id,
        Carbon::parse(diaDoAtendimentoEmGrupo().' 09:00'),
        Carbon::parse(diaDoAtendimentoEmGrupo().' 09:40'),
        [],
        'atendimento',
        true,
        4,
    );

    // ASSERT
    expect($comVaga)->toBeNull();

    // ACT — lotado, ele volta a falar
    encherAgenda($profissional, $especialidade, 2);
    $lotado = app(VerificadorDeConflitos::class)->intervaloOcupadoDoProfissional(
        $profissional->id,
        Carbon::parse(diaDoAtendimentoEmGrupo().' 09:00'),
        Carbon::parse(diaDoAtendimentoEmGrupo().' 09:40'),
        [],
        'atendimento',
        true,
        4,
    );

    // ASSERT
    expect($lotado)->toBe(['inicio' => '09:00', 'fim' => '09:40']);
});

it('deve tratar capacidade zero como um, e não como agenda travada', function () {
    // ARRANGE — banco adulterado ou coluna mal preenchida: `0 >= 0` lotaria o recurso com
    // NENHUM ocupante e derrubaria a agenda inteira do profissional
    admin();
    [$profissional] = profissionalComCapacidade(1);

    // ACT — faixa vazia, capacidade 0
    $conflitos = verificarNaFaixa($profissional, 0);

    // ASSERT
    expect($conflitos)->toBe([]);
});

it('deve marcar as quatro crianças do grupo pela API e recusar a quinta', function () {
    // ARRANGE — o caminho que a recepção percorre de verdade
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(4);
    $sala = Sala::create(['nome' => 'Sala do grupo', 'capacidade' => 4]);
    $payload = [
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'sala_id' => $sala->id,
        'inicio' => now()->addDay()->format('Y-m-d').' 09:00',
    ];

    // ACT + ASSERT — as quatro entram
    foreach (range(1, 4) as $i) {
        $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
            ...$payload, 'paciente_id' => Paciente::factory()->create()->id,
        ])->assertCreated();
    }

    // ACT + ASSERT — a quinta não
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$payload, 'paciente_id' => Paciente::factory()->create()->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
});

it('não deve trancar o que já está marcado quando a clínica BAIXA o teto', function () {
    // ARRANGE — quatro gravados, e alguém corrige o número para 2. Sem a guarda de ocupação
    // nova, os quatro ficariam mutuamente ineditáveis: nem avançar o status pelo card
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(4);
    encherAgenda($profissional, $especialidade, 4);
    $profissional->update(['atendimentos_simultaneos' => 2]);
    $alvo = Agendamento::where('profissional_id', $profissional->id)->firstOrFail();
    $outroStatus = StatusAgendamento::where('ocupa_horario', true)
        ->where('id', '!=', $alvo->status_id)->firstOrFail();

    // ACT — só o status muda; horário e profissional ficam onde estavam
    $resposta = $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/agendamentos/{$alvo->id}", [
            'paciente_id' => $alvo->paciente_id,
            'profissional_id' => $alvo->profissional_id,
            'especialidade_id' => $alvo->especialidade_id,
            'inicio' => $alvo->inicio->format('Y-m-d H:i'),
            'status_id' => $outroStatus->id,
        ]);

    // ASSERT
    $resposta->assertOk();
});

it('deve recusar mover um agendamento para dentro de um horário já lotado', function () {
    // ARRANGE — a contrapartida do caso acima: mudar de horário CRIA ocupação nova
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(2);
    encherAgenda($profissional, $especialidade, 2);
    $solto = Agendamento::factory()->create([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => Carbon::parse(diaDoAtendimentoEmGrupo().' 14:00'),
        'fim' => Carbon::parse(diaDoAtendimentoEmGrupo().' 14:40'),
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$solto->id}", [
        'paciente_id' => $solto->paciente_id,
        'profissional_id' => $solto->profissional_id,
        'especialidade_id' => $solto->especialidade_id,
        'inicio' => diaDoAtendimentoEmGrupo().' 09:00',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
});

it('deve devolver a capacidade do profissional na seleção da agenda, sem abrir o cadastro', function () {
    // ARRANGE — a grade decide COM esse número se a célula ainda convida a marcar
    $adminDaClinica = admin();
    [$profissional] = profissionalComCapacidade(4);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/agenda/selecao');

    // ASSERT
    $resposta->assertOk();
    $naLista = collect($resposta->json('profissionais'))->firstWhere('id', $profissional->id);
    expect($naLista['atendimentos_simultaneos'])->toBe(4)
        ->and($naLista)->not->toHaveKey('conselho')
        ->and($naLista)->not->toHaveKey('cbos_id');
});

it('deve recusar capacidade fora da faixa no cadastro do profissional e da sala', function () {
    // ARRANGE — a faixa vive no BOUNDARY: a tela filtra, mas quem decide é o servidor
    $adminDaClinica = admin();
    [$profissional] = profissionalComCapacidade(1);
    $sala = Sala::create(['nome' => 'Sala 1']);

    // ACT + ASSERT — zero não é capacidade
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/profissionais/{$profissional->id}", [
            'nome' => $profissional->nome, 'atendimentos_simultaneos' => 0,
        ])->assertUnprocessable()->assertJsonValidationErrors('atendimentos_simultaneos');

    // ACT + ASSERT — o engano de digitação que desligaria a guarda
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/profissionais/{$profissional->id}", [
            'nome' => $profissional->nome, 'atendimentos_simultaneos' => 40,
        ])->assertUnprocessable()->assertJsonValidationErrors('atendimentos_simultaneos');

    // ACT + ASSERT — a sala tem faixa própria
    $this->actingAs($adminDaClinica)
        ->putJsonComVersao("/api/salas/{$sala->id}", ['nome' => $sala->nome, 'capacidade' => 0])
        ->assertUnprocessable()->assertJsonValidationErrors('capacidade');
});

it('deve nascer com um atendimento por vez em profissional e sala novos', function () {
    // ARRANGE — o default É o comportamento de hoje; nada muda pela migration
    $adminDaClinica = admin();

    // ACT
    $profissional = $this->actingAs($adminDaClinica)
        ->postJson('/api/profissionais', ['nome' => 'Profissional de teste']);
    $sala = $this->actingAs($adminDaClinica)->postJson('/api/salas', ['nome' => 'Sala nova']);

    // ASSERT
    expect($profissional->json('atendimentos_simultaneos'))->toBe(1)
        ->and($sala->json('capacidade'))->toBe(1);
});

it('deve herdar a capacidade na SÉRIE, sem caminho próprio', function () {
    // ARRANGE — a série valida TODAS as ocorrências antes; a capacidade tem de valer em cada uma
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(2);
    $base = [
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => now()->addDay()->format('Y-m-d').' 09:00',
    ];

    // duas crianças já ocupam a PRIMEIRA data da série — o teto é 2
    foreach (range(1, 2) as $i) {
        $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
            ...$base, 'paciente_id' => Paciente::factory()->create()->id,
        ])->assertCreated();
    }

    // ACT — série semanal de 3 ocorrências partindo daquela data
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base,
        'paciente_id' => Paciente::factory()->create()->id,
        'recorrencia' => ['intervalo_semanas' => 1, 'ocorrencias' => 3],
    ]);

    // ASSERT — tudo-ou-nada: a série inteira cai, e nada é criado
    $resposta->assertUnprocessable();
    expect(Agendamento::where('profissional_id', $profissional->id)->count())->toBe(2);
});

it('deve herdar a capacidade no ENCAIXE da fila de espera', function () {
    // ARRANGE — o encaixe usa o mesmo serviço; um caminho próprio aqui seria um buraco
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(2);
    encherAgenda($profissional, $especialidade, 2);
    $entrada = ListaEspera::create([
        'paciente_id' => Paciente::factory()->create()->id,
        'especialidade_id' => $especialidade->id,
        'profissional_id' => $profissional->id,
        'prioridade' => 5,
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => diaDoAtendimentoEmGrupo().' 09:00',
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);

    // ASSERT — recusa, e a entrada continua na fila
    $resposta->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
    expect(ListaEspera::find($entrada->id))->not->toBeNull();
});

it('deve ler a capacidade UMA vez por escrita, mesmo numa série longa', function () {
    // ARRANGE — a série pergunta por ocorrência e o profissional é constante nas 52: sem memo,
    // um SELECT por data (o N+1 que `horariosPorProfissional` já evita ali ao lado)
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(4);
    DB::enableQueryLog();

    // ACT — 12 ocorrências semanais
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'paciente_id' => Paciente::factory()->create()->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => now()->addDay()->format('Y-m-d').' 09:00',
        'recorrencia' => ['intervalo_semanas' => 1, 'ocorrencias' => 12],
    ])->assertCreated();

    // ASSERT — a leitura da coluna acontece uma vez, não doze
    $leituras = collect(DB::getQueryLog())
        ->filter(fn (array $q) => str_contains($q['query'], 'atendimentos_simultaneos')
            && str_contains($q['query'], 'select'))
        ->count();
    DB::disableQueryLog();
    expect($leituras)->toBe(1);
});

/*
 * O VETO DO BLOQUEIO, pela ROTA — as quatro sondas do achado bloqueante da rodada 1.
 *
 * A rede tinha um teste só do veto, e ele batia na PRIMITIVA, onde o `unset` do serviço não
 * existe. Por isso 131 testes e 638 asserções ficaram verdes enquanto três recusas viravam
 * 201. A guarda tem de ser provada pelo predicado de PRODUÇÃO — a rota — e não pela unidade
 * isolada (lição `a-rede-precisa-pegar-o-caso-que-a-motivou`).
 *
 * Tudo aqui vale com capacidade 1, o default: não depende de ninguém ter digitado 4.
 */

/** Um bloqueio do profissional na faixa, com sala opcional. */
function bloqueioNaFaixa(Profissional $profissional, ?Sala $sala = null): Agendamento
{
    return Agendamento::factory()->create([
        'tipo' => 'bloqueio',
        'profissional_id' => $profissional->id,
        'paciente_id' => null,
        'especialidade_id' => null,
        'status_id' => null,
        'sala_id' => $sala?->id,
        'inicio' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:00'),
        'fim' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:40'),
    ]);
}

it('deve recusar pela ROTA um atendimento cujo status NÃO ocupa, criado sobre um bloqueio', function () {
    // ARRANGE — a sonda 1: status que libera o horário fazia `criaOcupacaoNova` devolver falso,
    // e o `unset` jogava fora o veto do bloqueio junto com a recusa por lotação
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(1);
    bloqueioNaFaixa($profissional);
    $liberado = StatusAgendamento::where('ocupa_horario', false)->firstOrFail();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'paciente_id' => Paciente::factory()->create()->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => diaDoAtendimentoEmGrupo().' 09:00',
        'status_id' => $liberado->id,
    ]);

    // ASSERT — sem isto, bastavam DUAS requisições (criar assim e promover o status) para
    // existir um atendimento ocupando o horário por cima de uma folga declarada
    $resposta->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
});

it('deve recusar pela ROTA um BLOQUEIO criado sobre uma sala já ocupada', function () {
    // ARRANGE — a sonda 2, a mais corriqueira: interditar uma sala que tem sessões marcadas
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(1);
    $sala = Sala::create(['nome' => 'Sala Fictícia Interditada']);
    encherAgenda($profissional, $especialidade, 1, $sala);
    [$outro] = profissionalComCapacidade(1);

    // ACT — bloqueio de OUTRO profissional na mesma sala e faixa
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'profissional_id' => $outro->id,
        'sala_id' => $sala->id,
        'inicio' => diaDoAtendimentoEmGrupo().' 09:00',
        'fim' => diaDoAtendimentoEmGrupo().' 09:40',
        'obs' => 'Manutenção fictícia',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('sala_id');
});

it('deve recusar pela ROTA um bloqueio sobre outro bloqueio do mesmo profissional', function () {
    // ARRANGE — a sonda 3: alvo bloqueio nunca "cria ocupação" (não tem status), então caía no
    // `unset` por acidente semântico
    $adminDaClinica = admin();
    [$profissional] = profissionalComCapacidade(1);
    bloqueioNaFaixa($profissional);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        'tipo' => 'bloqueio',
        'profissional_id' => $profissional->id,
        'inicio' => diaDoAtendimentoEmGrupo().' 09:00',
        'fim' => diaDoAtendimentoEmGrupo().' 09:40',
        'obs' => 'Reunião fictícia',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
});

it('deve recusar transferir um atendimento para um profissional BLOQUEADO no mesmo horário', function () {
    // ARRANGE — a sonda 5 (SEC-AG-04): enquanto "mover" era só o relógio, chegar na agenda de
    // outra pessoa não contava como movimento, e o bloqueio do destino não era visto. É o
    // arrasto lateral entre colunas da Visão Geral.
    $adminDaClinica = admin();
    [$origem, $especialidade] = profissionalComCapacidade(1);
    [$destino] = profissionalComCapacidade(1);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $destino->id,
        'especialidade_id' => $especialidade->id,
    ]);
    bloqueioNaFaixa($destino);
    $alvo = Agendamento::factory()->create([
        'profissional_id' => $origem->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:00'),
        'fim' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:40'),
    ]);

    // ACT — mesmo horário, outro profissional
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$alvo->id}", [
        'paciente_id' => $alvo->paciente_id,
        'profissional_id' => $destino->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => diaDoAtendimentoEmGrupo().' 09:00',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
});

it('deve manter editável o atendimento que já estava numa sala interditada DEPOIS', function () {
    // ARRANGE — a contrapartida, e é o que impede o envenenamento: uma sala bloqueada depois
    // não pode tornar o card ineditável (nem para desmarcar), como o bloqueio do profissional
    // chegou a fazer na change `desmarque-do-profissional`
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(1);
    $sala = Sala::create(['nome' => 'Sala Fictícia Bloqueada Depois']);
    $alvo = Agendamento::factory()->create([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'sala_id' => $sala->id,
        'inicio' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:00'),
        'fim' => Carbon::parse(diaDoAtendimentoEmGrupo().' 09:40'),
    ]);
    [$outro] = profissionalComCapacidade(1);
    bloqueioNaFaixa($outro, $sala);
    $outroStatus = StatusAgendamento::where('ocupa_horario', true)
        ->where('id', '!=', $alvo->status_id)->firstOrFail();

    // ACT — só o status muda; sala e horário ficam
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao("/api/agendamentos/{$alvo->id}", [
        'paciente_id' => $alvo->paciente_id,
        'profissional_id' => $alvo->profissional_id,
        'especialidade_id' => $alvo->especialidade_id,
        'sala_id' => $sala->id,
        'inicio' => diaDoAtendimentoEmGrupo().' 09:00',
        'status_id' => $outroStatus->id,
    ]);

    // ASSERT
    $resposta->assertOk();
});

it('deve deixar a BAIXA em lote passar pelo bloqueio que já estava na janela', function () {
    // ARRANGE — o lote reenvia `status_id` + `inicio` + `profissional_id` por linha: é o payload
    // que mais exercita o relevamento, e era o caminho sem teste nenhum (task 3.4).
    //
    // O bloqueio é do PRÓPRIO profissional e já estava ali — desmarcar/dar baixa no que ficou
    // embaixo dele não pode ser recusado, que é justamente o beco que a change
    // `desmarque-do-profissional` consertou (a prévia prometia N e a execução entregava 0).
    $adminDaClinica = admin();
    [$profissional, $especialidade] = profissionalComCapacidade(1);
    // a baixa só alcança o que JÁ ACONTECEU (D3 da change baixa-em-lote-por-status)
    $ontem = now()->subDay()->format('Y-m-d');
    $alvo = Agendamento::factory()->create([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
        'inicio' => Carbon::parse($ontem.' 09:00'),
        'fim' => Carbon::parse($ontem.' 09:40'),
    ]);
    Agendamento::factory()->create([
        'tipo' => 'bloqueio',
        'profissional_id' => $profissional->id,
        'paciente_id' => null,
        'especialidade_id' => null,
        'status_id' => null,
        'inicio' => Carbon::parse($ontem.' 09:00'),
        'fim' => Carbon::parse($ontem.' 09:40'),
    ]);
    $finalizado = StatusAgendamento::where('aplicavel_em_lote', true)
        ->where('desconta_sessao', true)->firstOrFail();
    $alcance = [
        'profissional_id' => $profissional->id,
        'de' => $ontem,
        'ate' => $ontem,
        'status_id' => $finalizado->id,
    ];

    // ACT — prévia e execução, como a tela faz
    $previa = $this->actingAs($adminDaClinica)
        ->postJson('/api/agendamentos/baixa-em-lote/previa', $alcance);
    $previa->assertOk();
    $resposta = $this->actingAs($adminDaClinica)->postJson('/api/agendamentos/baixa-em-lote', [
        ...$alcance,
        'assinatura' => $previa->json('assinatura'),
        'referencia' => $previa->json('referencia'),
    ]);

    // ASSERT — a execução entrega o que a prévia prometeu
    $resposta->assertOk();
    expect(Agendamento::find($alvo->id)->status_id)->toBe($finalizado->id);
});
