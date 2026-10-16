<?php

use App\Models\Agendamento;
use App\Models\Convenio;
use App\Models\Especialidade;
use App\Models\ListaEspera;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\Tratamento;
use App\Models\Usuario;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Monolog\Handler\TestHandler;

/*
 * TRAVA DE VÍNCULO PRÉVIO (change `vinculo-previo-para-agendar`) — fecha o `SEC-CP-04`.
 *
 * Sem ela o escopo por vínculo se AUTO-CONCEDE: o predicado "é paciente dele" é EXISTS em
 * agendamentos ∪ tratamentos, e uma marcação satisfaz o próprio EXISTS. Medido no gate de
 * `conflito-do-paciente`: GET comparecimento-recente 403 → 1 POST /agendamentos 201 → o mesmo
 * GET 200, com data e nome do profissional.
 *
 * A clínica confirmou que a trava é a rotina dela (Mariana, 2026-08-31): *"Sempre passa pela
 * recepção, porque só agendamos após autorização dos convênios."*
 *
 * Dados 100% fictícios (LGPD, §13): nenhuma criança real entra aqui.
 */

/**
 * O escopado desta suíte: o helper compartilhado (`tests/Pest.php`) mais as permissões que ESTES
 * testes exercitam. `lista_espera.excluir` é exigida pela rota do encaixe — sem ela o teste morria
 * no middleware do Spatie e passava sem tocar a trava (achado 8.3 do gate).
 */
function usuarioSoDaPropriaAgenda(Profissional $prof): Usuario
{
    return usuarioEscopadoEm($prof, [
        'pacientes.ver',
        'lista_espera.ver', 'lista_espera.criar', 'lista_espera.excluir',
        // `tratamentos.excluir` é exigida pela rota do DELETE: sem ela o 403 vem do middleware do
        // Spatie e o teste passa sem tocar o portão — foi exatamente o que aconteceu na primeira
        // versão dos testes da quarta porta, e é o MESMO erro do encaixe na rodada 1.
        'tratamentos.ver', 'tratamentos.criar', 'tratamentos.editar', 'tratamentos.excluir',
    ]);
}

/** Especialidade atendida por `$prof`, para o payload passar da validação. */
function especialidadeDe(Profissional $prof): Especialidade
{
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $prof->id,
        'especialidade_id' => $especialidade->id,
    ]);

    return $especialidade;
}

/** @return array<string, mixed> */
function payloadDeAgendamento(Profissional $prof, Especialidade $esp, Paciente $paciente, int $emDias = 2): array
{
    return [
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'paciente_id' => $paciente->id,
        'inicio' => agoraNaClinica()->copy()->addDays($emDias)->setTime(9, 0)->format('Y-m-d H:i'),
    ];
}

it('deve recusar o escopado que marca criança sem vínculo prévio', function () {
    // ARRANGE — a criança existe na clínica, mas nunca passou pelo profissional
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $estranha = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT
    $resposta = $this->actingAs($usuario)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $estranha));

    // ASSERT — recusa, e NADA persistido
    $resposta->assertStatus(422)->assertJsonValidationErrors('paciente_id');
    expect(Agendamento::where('paciente_id', $estranha->id)->count())->toBe(0);
});

it('deve aceitar o escopado que marca criança já vinculada por AGENDAMENTO', function () {
    // ARRANGE — o vínculo nasce de um agendamento anterior (feito pela recepção)
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $paciente = Paciente::factory()->create();
    Agendamento::factory()->create([
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'especialidade_id' => $esp->id,
    ]);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT
    $resposta = $this->actingAs($usuario)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $paciente, 3));

    // ASSERT
    $resposta->assertCreated();
});

it('deve aceitar o escopado que marca criança vinculada só por TRATAMENTO', function () {
    // ARRANGE — contrato sem agenda ainda: é o caso do pacote recém-autorizado
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $paciente = Paciente::factory()->create();
    Tratamento::factory()->create([
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
    ]);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT
    $resposta = $this->actingAs($usuario)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $paciente));

    // ASSERT
    $resposta->assertCreated();
});

it('deve deixar a RECEPÇÃO marcar qualquer criança — a trava é só para o escopado', function () {
    // ARRANGE — é o caminho que a clínica opera: "primeiro passa pela recepção"
    $recepcao = admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $estranha = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($recepcao)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $estranha));

    // ASSERT
    $resposta->assertCreated();
});

it('deve recusar a SÉRIE inteira, sem deixar ocorrência órfã', function () {
    // ARRANGE
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $estranha = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT — recorrência semanal até um mês adiante
    $resposta = $this->actingAs($usuario)->postJson('/api/agendamentos', [
        ...payloadDeAgendamento($prof, $esp, $estranha),
        // `recorrencia.ate`, NÃO `recorrencia_ate`: chave desconhecida some no `validated()` e o
        // teste exercitava `criar()` em vez de `criarSerie()` — achado 8.5/SEC-VP-14
        'recorrencia' => ['ate' => agoraNaClinica()->copy()->addDays(30)->format('Y-m-d')],
    ]);

    // ASSERT — nem a primeira ocorrência nasce
    $resposta->assertStatus(422);
    expect(Agendamento::where('paciente_id', $estranha->id)->count())->toBe(0);
});

it('deve recusar criança ALHEIA exatamente como recusa criança INEXISTENTE', function () {
    // ARRANGE — o coração do SEC-CP-01 aplicado à escrita: a recusa não pode contar o que existe
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $estranha = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);
    $inexistente = Paciente::max('id') + 5000;

    // ACT — o mesmo payload, mudando só o id do paciente
    $alheia = $this->actingAs($usuario)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $estranha));
    $fantasma = $this->actingAs($usuario)->postJson('/api/agendamentos', [
        ...payloadDeAgendamento($prof, $esp, $estranha),
        'paciente_id' => $inexistente,
    ]);

    // ASSERT — código E corpo indistinguíveis; qualquer diferença é o oráculo de volta
    expect($alheia->status())->toBe($fantasma->status());
    expect($alheia->json('errors.paciente_id'))->toBe($fantasma->json('errors.paciente_id'));
    expect($alheia->json('message'))->toBe($fantasma->json('message'));
});

it('deve deixar o escopado REMARCAR — a trava é sobre TROCAR a criança, não sobre mexer', function () {
    // ARRANGE — guarda contra zelo excessivo: barrar TODO update quebraria a rotina da clínica.
    // O título anterior dizia "a trava é sobre nascer", que é a premissa que o gate destruiu na r1:
    // `atualizar` ESTÁ na lista de entradas guardadas. O que este teste prova é o outro lado —
    // remarcar SEM trocar a criança não concede vínculo nenhum e por isso é isento.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $paciente = Paciente::factory()->create();
    $agendamento = Agendamento::factory()->create([
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'especialidade_id' => $esp->id,
    ]);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT — move o próprio horário. O PUT exige `If-Match` (concorrência otimista é
    // fail-closed: sem versão, 428) — não é parte desta change, mas sem o cabeçalho o teste
    // mediria o 428 e não a trava.
    $resposta = $this->actingAs($usuario)
        ->withHeader('If-Match', $agendamento->updated_at->toISOString())
        ->putJson("/api/agendamentos/{$agendamento->id}", [
            'profissional_id' => $prof->id,
            'especialidade_id' => $esp->id,
            'paciente_id' => $paciente->id,
            'inicio' => agoraNaClinica()->copy()->addDays(4)->setTime(14, 0)->format('Y-m-d H:i'),
        ]);

    // ASSERT
    $resposta->assertOk();
});

it('deve recusar o ENCAIXE da fila quando a criança não é do escopado', function () {
    // ARRANGE — a fila é, por definição, de quem ainda NÃO tem horário: é o caminho mais
    // provável de uma criança sem vínculo nenhum. Deixá-lo de fora manteria aberta exatamente
    // a porta que a trava existe para fechar.
    $recepcao = admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $naFila = Paciente::factory()->create();
    // o escopado nasce ANTES da requisição: uma chamada HTTP no meio reinicia o registro de
    // permissões do Spatie, e `usuarioCom` deixa de achar `agenda.ver`
    $usuario = usuarioSoDaPropriaAgenda($prof);
    $entradaId = $this->actingAs($recepcao)->postJson('/api/lista-espera', [
        'paciente_id' => $naFila->id, 'prioridade' => 0,
    ])->assertCreated()->json('id');
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    // ACT
    $resposta = $this->actingAs($usuario)->postJson("/api/lista-espera/{$entradaId}/encaixar", [
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'inicio' => agoraNaClinica()->copy()->addDays(2)->setTime(10, 0)->format('Y-m-d H:i'),
    ]);

    // ASSERT — 422 FIXO, nunca 403: um 403 ali é a resposta explicativa que a spec proíbe, e
    // `toBeIn([403, 422])` engolia justamente o caso em que o oráculo voltaria (achado 8.3/SEC-VP-15)
    $resposta->assertStatus(422)->assertJsonValidationErrors('paciente_id');
    expect(ListaEspera::whereKey($entradaId)->exists())->toBeTrue();
    expect(Agendamento::where('paciente_id', $naFila->id)->count())->toBe(0);
});

it('deve deixar a RECEPÇÃO encaixar normalmente — a fila é dela', function () {
    // ARRANGE — par de controle: sem ele o teste acima passaria num sistema que recusa tudo
    $recepcao = admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $naFila = Paciente::factory()->create();
    $entradaId = $this->actingAs($recepcao)->postJson('/api/lista-espera', [
        'paciente_id' => $naFila->id, 'prioridade' => 0,
    ])->assertCreated()->json('id');

    // ACT
    $resposta = $this->actingAs($recepcao)->postJson("/api/lista-espera/{$entradaId}/encaixar", [
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'inicio' => agoraNaClinica()->copy()->addDays(2)->setTime(10, 0)->format('Y-m-d H:i'),
    ]);

    // ASSERT — encaixa e sai da fila
    $resposta->assertCreated();
    expect(ListaEspera::whereKey($entradaId)->exists())->toBeFalse();
});

it('deve registrar a recusa no log de segurança, sem o id da criança', function () {
    // ARRANGE — a recusa é CEGA para quem a recebe; o que sobra é a varredura por insistência,
    // e ela precisa deixar rastro, senão ninguém nota que aconteceu.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $estranha = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);

    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT
    $this->actingAs($usuario)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $estranha))
        ->assertStatus(422);

    // ASSERT — um evento, com quem tentou...
    expect($handler->getRecords())->toHaveCount(1);
    $registro = $handler->getRecords()[0];
    expect($registro['message'])->toBe('vinculo_previo.bloqueado');
    $contexto = $registro['context'];
    expect($contexto['usuario_id'])->toBe($usuario->id)
        ->and($contexto['profissional_do_escopo_id'])->toBe($prof->id);

    // ...e o contexto é uma WHITELIST fechada. Vale mais que `not->toHaveKey('paciente_id')`:
    // qualquer campo novo — o id da criança inclusive — reprova aqui, sem alguém precisar
    // lembrar de proibi-lo. (Comparar VALORES não serviria: o id do paciente colide com outros
    // ids quando os sequenciais coincidem.)
    expect(array_keys($contexto))->toBe([
        'usuario_id', 'profissional_do_escopo_id', 'motivo', 'ip',
    ], 'Campo novo no log de segurança: dado de MENOR não entra aqui.');
});

it('NÃO deve registrar nada quando a criança é do próprio profissional', function () {
    // ARRANGE — par de controle: sem ele o teste acima passaria num sistema que loga TUDO
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $paciente = Paciente::factory()->create();
    Agendamento::factory()->create([
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'especialidade_id' => $esp->id,
    ]);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT
    $this->actingAs($usuario)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $paciente, 3))
        ->assertCreated();

    // ASSERT — marcação legítima não polui o log de segurança
    expect($handler->getRecords())->toBe([]);
});

/*
 * A SEQUÊNCIA DO GATILHO, nas TRÊS portas.
 *
 * O `SEC-CP-04` é medido por uma sequência, não por um status: `403 na ficha` → `escrita` →
 * `200 na ficha`. A rodada 1 do gate reprovou porque a change tinha testes de status e nenhum
 * teste da sequência — e foi exatamente por isso que duas portas passaram batido (o `PUT` do
 * agendamento e o `POST` do tratamento). Estes testes são o que faltava.
 */

/** As leituras da ficha que o vínculo destranca. @return list<int> */
function statusDasLeiturasDaFicha(Usuario $usuario, int $pacienteId): array
{
    return array_map(fn (string $rota) => test()->actingAs($usuario)->getJson($rota)->status(), [
        "/api/pacientes/{$pacienteId}/comparecimento-recente",
        "/api/pacientes/{$pacienteId}/resumo",
    ]);
}

it('NÃO deve destrancar a ficha por um POST de agendamento (porta 1)', function () {
    // ARRANGE
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $alheia = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT + ASSERT — a ficha começa trancada...
    expect(statusDasLeiturasDaFicha($usuario, $alheia->id))->each->toBe(403);

    // ...a escrita é recusada...
    $this->actingAs($usuario)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $alheia))
        ->assertStatus(422);

    // ...e continua trancada. Se algum dia abrir, o gatilho voltou.
    expect(statusDasLeiturasDaFicha($usuario, $alheia->id))->each->toBe(403);
});

it('NÃO deve destrancar a ficha por um PUT que TROCA o paciente (porta 2)', function () {
    // ARRANGE — a porta que a rodada 1 do gate achou aberta. O design dizia "no update o vínculo
    // já existe por construção"; é falso quando o campo trocado é o próprio paciente.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $meu = Paciente::factory()->create();
    $alheia = Paciente::factory()->create();
    $agendamento = Agendamento::factory()->create([
        'profissional_id' => $prof->id, 'paciente_id' => $meu->id, 'especialidade_id' => $esp->id,
    ]);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT + ASSERT
    expect(statusDasLeiturasDaFicha($usuario, $alheia->id))->each->toBe(403);

    $this->actingAs($usuario)
        ->withHeader('If-Match', $agendamento->fresh()->updated_at->toISOString())
        ->putJson("/api/agendamentos/{$agendamento->id}", [
            'profissional_id' => $prof->id,
            'especialidade_id' => $esp->id,
            'paciente_id' => $alheia->id,   // <- a troca
            'inicio' => agoraNaClinica()->copy()->addDays(5)->setTime(9, 0)->format('Y-m-d H:i'),
        ])->assertStatus(422)->assertJsonValidationErrors('paciente_id');

    expect(statusDasLeiturasDaFicha($usuario, $alheia->id))->each->toBe(403);
    expect((int) $agendamento->fresh()->paciente_id)->toBe($meu->id);
});

it('NÃO deve destrancar a ficha convertendo um BLOQUEIO em atendimento (porta 2b)', function () {
    // ARRANGE — a variante sem agendamento legítimo: bloqueio não tem paciente, logo é isento da
    // trava; bastava convertê-lo depois. A isenção passou a ser pelo TIPO justamente por isto.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $alheia = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);

    $bloqueio = $this->actingAs($usuario)->postJson('/api/agendamentos', [
        'profissional_id' => $prof->id,
        'tipo' => 'bloqueio',
        'inicio' => agoraNaClinica()->copy()->addDays(6)->setTime(8, 0)->format('Y-m-d H:i'),
        'fim' => agoraNaClinica()->copy()->addDays(6)->setTime(8, 40)->format('Y-m-d H:i'),
    ])->assertCreated()->json('id');

    // ACT + ASSERT
    expect(statusDasLeiturasDaFicha($usuario, $alheia->id))->each->toBe(403);

    $this->actingAs($usuario)
        ->withHeader('If-Match', Agendamento::findOrFail($bloqueio)->updated_at->toISOString())
        ->putJson("/api/agendamentos/{$bloqueio}", [
            'profissional_id' => $prof->id,
            'tipo' => 'atendimento',
            'especialidade_id' => $esp->id,
            'paciente_id' => $alheia->id,
            'inicio' => agoraNaClinica()->copy()->addDays(6)->setTime(8, 0)->format('Y-m-d H:i'),
        ])->assertStatus(422);

    expect(statusDasLeiturasDaFicha($usuario, $alheia->id))->each->toBe(403);
});

it('NÃO deve destrancar a ficha por um POST de tratamento (porta 3)', function () {
    // ARRANGE — a segunda perna do predicado: "é paciente dele" é agendamentos UNIÃO tratamentos,
    // e travar só a agenda deixava o repro do gatilho reproduzir trocando o endpoint.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $alheia = Paciente::factory()->create();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício da Trava']);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT + ASSERT
    expect(statusDasLeiturasDaFicha($usuario, $alheia->id))->each->toBe(403);

    $this->actingAs($usuario)->postJson('/api/tratamentos', [
        'paciente_id' => $alheia->id,
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'convenio_id' => $convenio->id,
        'sessoes_total' => 10,
    ])->assertStatus(422)->assertJsonValidationErrors('paciente_id');

    expect(statusDasLeiturasDaFicha($usuario, $alheia->id))->each->toBe(403);
    expect(Tratamento::where('paciente_id', $alheia->id)->count())->toBe(0);
});

it('NÃO deve deixar o escopado LER nem ROUBAR o pacote do colega', function () {
    // ARRANGE — o escopo D11 nunca alcançou o show/update de tratamento: o escopado lia o pacote
    // do colega (matrícula do convênio inclusive) e transferia a posse para si, porque o guard de
    // identidade protege paciente_id e especialidade_id, nunca profissional_id.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $doColega = Tratamento::factory()->create(['profissional_id' => $colega->id]);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT + ASSERT — não lê...
    $this->actingAs($usuario)->getJson("/api/tratamentos/{$doColega->id}")->assertForbidden();

    // ...e não rouba
    $this->actingAs($usuario)
        ->withHeader('If-Match', $doColega->updated_at->toISOString())
        ->putJson("/api/tratamentos/{$doColega->id}", [
            'paciente_id' => $doColega->paciente_id,
            'profissional_id' => $prof->id,          // <- o roubo
            'especialidade_id' => $doColega->especialidade_id,
            'convenio_id' => $doColega->convenio_id,
            'sessoes_total' => $doColega->sessoes_total,
        ])->assertForbidden();
    expect((int) $doColega->fresh()->profissional_id)->toBe($colega->id);
});

/*
 * O ORÁCULO COMPOSTO (`SEC-VP-13`) — o vetor que sobrevivia à cegueira da recusa.
 *
 * A indistinguibilidade só valia com o resto do payload VÁLIDO. Com um segundo campo inválido de
 * propósito, as duas recusas se separavam sozinhas, porque nasciam em pontos diferentes do
 * pipeline: a da inexistência na validação, a do vínculo depois dela. Enumeração perfeita da base,
 * sem escrever nada — e, pior, sem registro nenhum, porque a trava do serviço nem chegava a rodar.
 */

it('deve recusar IGUAL mesmo com outro erro no payload (oráculo composto)', function () {
    // ARRANGE
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $alheia = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);
    $inexistente = Paciente::max('id') + 5000;

    // ACT — MESMO payload quebrado (`inicio` inválido), mudando só o id do paciente
    $quebrado = fn (int $pacienteId) => [
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'paciente_id' => $pacienteId,
        'inicio' => 'nao-e-uma-data',
    ];
    $comAlheia = $this->actingAs($usuario)->postJson('/api/agendamentos', $quebrado($alheia->id));
    $comFantasma = $this->actingAs($usuario)->postJson('/api/agendamentos', $quebrado($inexistente));

    // ASSERT — o CONJUNTO DE CAMPOS com erro tem de ser idêntico. Era aqui que vazava: a criança
    // alheia devolvia só ["inicio"], e o id inexistente ["inicio","paciente_id"].
    $camposComErro = function ($resposta) {
        $campos = array_keys($resposta->json('errors') ?? []);
        sort($campos);

        return $campos;
    };
    expect($camposComErro($comAlheia))->toBe($camposComErro($comFantasma))
        ->and($camposComErro($comAlheia))->toContain('paciente_id');
    expect($comAlheia->json('errors.paciente_id'))->toBe($comFantasma->json('errors.paciente_id'));
    expect($comAlheia->status())->toBe($comFantasma->status());
});

it('deve registrar no log de segurança também o vetor composto', function () {
    // ARRANGE — a outra metade do achado: o vetor que funcionava não deixava rastro nenhum,
    // porque a trava do serviço nem era alcançada.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $alheia = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);

    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT — payload com segundo erro, que antes escapava da trava
    $this->actingAs($usuario)->postJson('/api/agendamentos', [
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'paciente_id' => $alheia->id,
        'inicio' => 'nao-e-uma-data',
    ])->assertStatus(422);

    // ASSERT — a sondagem deixa rastro, com a mesma whitelist fechada
    expect($handler->getRecords())->toHaveCount(1);
    expect($handler->getRecords()[0]['message'])->toBe('vinculo_previo.bloqueado');
    expect(array_keys($handler->getRecords()[0]['context']))->toBe([
        'usuario_id', 'profissional_do_escopo_id', 'motivo', 'ip',
    ]);
});

it('NÃO deve registrar quando o id simplesmente não existe (typo do ESCOPADO)', function () {
    // ARRANGE — par de controle, CORRIGIDO na rodada 2. Ele usava `admin()`: um usuário plano,
    // para quem a regra retorna `true` na primeira linha e nunca loga. Passava por duas razões
    // independentes, nenhuma delas sendo "a regra distingue typo de sondagem" — e o ruído que
    // existia de verdade (o typo do ESCOPADO gerava registro) ficava invisível.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $recepcao = usuarioSoDaPropriaAgenda($prof);

    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT
    $this->actingAs($recepcao)->postJson('/api/agendamentos', [
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'paciente_id' => Paciente::max('id') + 5000,
        'inicio' => agoraNaClinica()->copy()->addDays(2)->setTime(9, 0)->format('Y-m-d H:i'),
    ])->assertStatus(422);

    // ASSERT
    expect($handler->getRecords())->toBe([]);
});

/*
 * SEC-VP-20 e SEC-VP-21 — os dois achados que a RODADA 2 encontrou, e que a correção da rodada 1
 * tinha criado ou deixado passar. O primeiro é o mais instrutivo da change inteira: fechar um
 * oráculo criou outro, num lugar que ninguém olhava.
 */

it('deve recusar IGUAL ao chutar o paciente de um agendamento do COLEGA (SEC-VP-20)', function () {
    // ARRANGE — o agendamento é do colega; o escopado chuta o `paciente_id` no PUT.
    //
    // Antes do conserto: palpite ERRADO → 422 (a regra de vínculo recusava), palpite CERTO → 403
    // (a regra tem early-return quando o paciente não muda, e o pedido chegava ao controller).
    // O status dizia qual criança é do colega. Pior: o acerto era o ÚNICO que não deixava
    // registro. A posse passou a ser decidida em `authorize()`, antes da validação.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $doColega = Agendamento::factory()->create(['profissional_id' => $colega->id]);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    $chute = fn (int $pacienteId) => $this->actingAs($usuario)
        ->withHeader('If-Match', $doColega->fresh()->updated_at->toISOString())
        ->putJson("/api/agendamentos/{$doColega->id}", [
            'profissional_id' => $prof->id,
            'especialidade_id' => $esp->id,
            'paciente_id' => $pacienteId,
            'inicio' => agoraNaClinica()->copy()->addDays(7)->setTime(9, 0)->format('Y-m-d H:i'),
        ]);

    // ACT — o palpite CERTO (o paciente real do agendamento do colega) e cinco errados
    $certo = $chute((int) $doColega->paciente_id);
    $errados = array_map(fn () => $chute(Paciente::factory()->create()->id), range(1, 5));

    // ASSERT — todos idênticos: o acerto não pode se destacar
    foreach ($errados as $i => $errado) {
        expect($errado->status())->toBe($certo->status(), "O palpite errado #{$i} destoou do certo.");
    }
    expect($certo->status())->toBe(403);
});

it('NÃO deve criar pacote em nome do COLEGA (SEC-VP-21 i)', function () {
    // ARRANGE — criar pacote para o colega CONCEDE A ELE o vínculo clínico com aquela criança,
    // unilateralmente. O `store` de tratamento não tinha posse nenhuma.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $minha = Paciente::factory()->create();
    Agendamento::factory()->create([
        'profissional_id' => $prof->id, 'paciente_id' => $minha->id, 'especialidade_id' => $esp->id,
    ]);
    $convenio = Convenio::create(['nome' => 'Convênio Fictício SEC-VP-21']);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT — criança dele, mas o pacote pendurado no colega
    $resposta = $this->actingAs($usuario)->postJson('/api/tratamentos', [
        'paciente_id' => $minha->id,
        'profissional_id' => $colega->id,
        'especialidade_id' => $esp->id,
        'convenio_id' => $convenio->id,
        'sessoes_total' => 10,
    ]);

    // ASSERT
    $resposta->assertForbidden();
    expect(Tratamento::where('profissional_id', $colega->id)->count())->toBe(0);
});

it('NÃO deve deixar o escopo NENHUM criar pacote (SEC-VP-21 ii)', function () {
    // ARRANGE — escopo `nenhum` é papel SEM as flags de alcance total E sem `profissional_id`.
    // A invariante escrita em Escopo.php diz "nenhum → mutações 403"; em tratamentos ela não
    // valia, e `POST /tratamentos` devolvia 201 enquanto `POST /agendamentos` dava 403.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $paciente = Paciente::factory()->create();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício Fail-Closed']);
    $semVinculo = usuarioCom(['agenda.ver', 'agenda.criar', 'tratamentos.criar'], 'Sem vínculo');

    $pacote = [
        'paciente_id' => $paciente->id,
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'convenio_id' => $convenio->id,
        'sessoes_total' => 10,
    ];

    // ACT + ASSERT — as duas mutações fecham igual; era o agendamento que fechava sozinho
    $this->actingAs($semVinculo)->postJson('/api/tratamentos', $pacote)->assertForbidden();
    $this->actingAs($semVinculo)->postJson('/api/agendamentos', [
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'paciente_id' => $paciente->id,
        'inicio' => agoraNaClinica()->copy()->addDays(2)->setTime(9, 0)->format('Y-m-d H:i'),
    ])->assertForbidden();
    expect(Tratamento::count())->toBe(0);
});

/*
 * O EIXO CLÍNICO — o conserto do `SEC-VP-12`, que ficou DUAS RODADAS sem teste.
 *
 * O code-review da r2 mediu: mutando `podeVincularPaciente` para um eixo só, os 1363 testes
 * continuavam verdes. E não por acaso — nenhum teste da casa constrói este usuário: todo mundo
 * com `agenda.ver_todos` ou é recepção sem `profissional_id`, ou é admin (plano nos dois eixos).
 * O cenário estava escrito na spec desta change e era estruturalmente inalcançável pela suíte.
 *
 * O que a mutação reabre é a escalada sobre dado clínico de MENOR (art. 11):
 * `/resumo` 403 → `POST /agendamentos` 201 → `/resumo` 200.
 */

/** Plano na AGENDA por decisão da clínica, escopado no CLÍNICO, e vinculado a um profissional. */
function planoNaAgendaEscopadoNoClinico(Profissional $prof): Usuario
{
    $usuario = usuarioCom(
        ['agenda.ver', 'agenda.criar', 'agenda.editar', 'agenda.ver_todos', 'pacientes.ver'],
        'Plano na agenda, escopado no clínico',
    );
    $usuario->update(['profissional_id' => $prof->id]);

    return $usuario;
}

it('NÃO deve destrancar a leitura CLÍNICA para quem é plano só na agenda (SEC-VP-12)', function () {
    // ARRANGE — as duas flags de alcance total são aditivas e INDEPENDENTES por desenho, e os
    // papéis são dado da clínica: nada impede esta combinação.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $alheia = Paciente::factory()->create();
    $usuario = planoNaAgendaEscopadoNoClinico($prof);
    // a leitura CLÍNICA de verdade (art. 11) é a anamnese: o resumo da ficha migrou para o eixo
    // agenda na rodada 4 (`SEC-VP-52`) porque o conteúdo dele é agenda + pacote, não prontuário
    $usuario->givePermissionTo('anamneses.ver');

    // ACT + ASSERT — a leitura clínica começa negada...
    $this->actingAs($usuario)->getJson("/api/pacientes/{$alheia->id}/anamneses")->assertForbidden();

    // ...a escrita na agenda é recusada, mesmo ele sendo PLANO na agenda...
    $this->actingAs($usuario)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $alheia))
        ->assertStatus(422)->assertJsonValidationErrors('paciente_id');

    // ...e continua negada. Consultar só o eixo da agenda deixava esta porta aberta.
    $this->actingAs($usuario)->getJson("/api/pacientes/{$alheia->id}/anamneses")->assertForbidden();
    expect(Agendamento::where('paciente_id', $alheia->id)->count())->toBe(0);
});

it('deve deixar o plano-na-agenda marcar a criança que É dele (o par de controle)', function () {
    // ARRANGE — sem este par, o teste acima passaria num sistema que simplesmente recusa tudo
    // para este papel, e a trava pareceria funcionar sendo apenas quebrada.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $minha = Paciente::factory()->create();
    Agendamento::factory()->create([
        'profissional_id' => $prof->id, 'paciente_id' => $minha->id, 'especialidade_id' => $esp->id,
    ]);
    $usuario = planoNaAgendaEscopadoNoClinico($prof);

    // ACT + ASSERT
    $this->actingAs($usuario)
        ->postJson('/api/agendamentos', payloadDeAgendamento($prof, $esp, $minha, 4))
        ->assertCreated();
});

it('deve recusar IGUAL no POST /tratamentos mesmo com outro erro no payload', function () {
    // ARRANGE — o code-review da r2 mediu que o oráculo composto estava fechado no `/tratamentos`
    // por ACIDENTE DE ORDEM, com zero testes: só o `/agendamentos` tinha os dois. Uma faxina de
    // "código redundante" reabriria a enumeração sem derrubar um único teste.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $alheia = Paciente::factory()->create();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício Composto']);
    $usuario = usuarioSoDaPropriaAgenda($prof);
    $inexistente = Paciente::max('id') + 5000;

    // ACT — `sessoes_total` inválido de propósito, mudando só o id do paciente
    $quebrado = fn (int $pacienteId) => [
        'paciente_id' => $pacienteId,
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'convenio_id' => $convenio->id,
        'sessoes_total' => -3,
    ];
    $comAlheia = $this->actingAs($usuario)->postJson('/api/tratamentos', $quebrado($alheia->id));
    $comFantasma = $this->actingAs($usuario)->postJson('/api/tratamentos', $quebrado($inexistente));

    // ASSERT — o conjunto de campos com erro tem de ser idêntico
    $campos = function ($r) {
        $c = array_keys($r->json('errors') ?? []);
        sort($c);

        return $c;
    };
    expect($campos($comAlheia))->toBe($campos($comFantasma))
        ->and($campos($comAlheia))->toContain('paciente_id');
    expect($comAlheia->json('errors.paciente_id'))->toBe($comFantasma->json('errors.paciente_id'));
});

it('NÃO deve deixar o escopado APAGAR o pacote do colega (a quarta porta)', function () {
    // ARRANGE — a rodada 3 do gate achou esta: `show` e `update` ganharam posse na r2, o `destroy`
    // não tinha nenhuma — e a lista de resíduos que eu escrevi dizia "show/update/index usam só o
    // eixo agenda", sem citar a quarta porta. Terceira vez que um registro meu declara a lista
    // completa com uma superfície aberta.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $doColega = Tratamento::factory()->create([
        'profissional_id' => $colega->id, 'sessoes_realizadas' => 0,
    ]);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT
    $resposta = $this->actingAs($usuario)->deleteJson("/api/tratamentos/{$doColega->id}");

    // ASSERT — negado, e o pacote continua lá
    $resposta->assertForbidden();
    expect(Tratamento::whereKey($doColega->id)->exists())->toBeTrue();
});

it('deve recusar o DELETE do colega IGUAL com e sem sessões realizadas', function () {
    // ARRANGE — a posse vem ANTES da regra das sessões de propósito: senão o pacote do colega COM
    // sessões responderia 422 e o SEM sessões 204, e a diferença contaria o que o escopado não
    // pode saber sobre a agenda do outro.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $semSessoes = Tratamento::factory()->create(['profissional_id' => $colega->id, 'sessoes_realizadas' => 0]);
    $comSessoes = Tratamento::factory()->create(['profissional_id' => $colega->id, 'sessoes_realizadas' => 3]);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT
    $a = $this->actingAs($usuario)->deleteJson("/api/tratamentos/{$semSessoes->id}");
    $b = $this->actingAs($usuario)->deleteJson("/api/tratamentos/{$comSessoes->id}");

    // ASSERT
    expect($a->status())->toBe($b->status())->toBe(403);
    expect(Tratamento::whereKey($semSessoes->id)->exists())->toBeTrue();
});

it('deve deixar a RECEPÇÃO apagar o pacote — o par de controle do DELETE', function () {
    // ARRANGE — sem ele o teste acima passaria num sistema que recusa todo DELETE
    $recepcao = admin();
    $prof = Profissional::factory()->create();
    $pacote = Tratamento::factory()->create(['profissional_id' => $prof->id, 'sessoes_realizadas' => 0]);

    // ACT + ASSERT
    $this->actingAs($recepcao)->deleteJson("/api/tratamentos/{$pacote->id}")->assertNoContent();
    expect(Tratamento::whereKey($pacote->id)->exists())->toBeFalse();
});

it('NÃO deve conceder prontuário a um COLEGA criando pacote em nome dele (SEC-VP-31)', function () {
    // ARRANGE — o achado ALTA da rodada 3. `TratamentoRequest::authorize()` perguntava ao eixo
    // AGENDA, e pacote é vínculo CLÍNICO: quem é plano na agenda e escopado no clínico criava
    // pacote em nome do colega e abria o prontuário da criança para ele — art. 11, sem passar
    // pela recepção, que é o controle que a clínica declarou.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $minha = Paciente::factory()->create();
    Agendamento::factory()->create([
        'profissional_id' => $prof->id, 'paciente_id' => $minha->id, 'especialidade_id' => $esp->id,
    ]);
    $convenio = Convenio::create(['nome' => 'Convênio Fictício SEC-VP-31']);

    $usuario = usuarioCom(
        ['agenda.ver', 'agenda.criar', 'agenda.ver_todos', 'pacientes.ver', 'tratamentos.criar'],
        'Plano na agenda, escopado no clínico',
    );
    $usuario->update(['profissional_id' => $prof->id]);

    // ACT — criança DELE, pacote pendurado no COLEGA
    $resposta = $this->actingAs($usuario)->postJson('/api/tratamentos', [
        'paciente_id' => $minha->id,
        'profissional_id' => $colega->id,
        'especialidade_id' => $esp->id,
        'convenio_id' => $convenio->id,
        'sessoes_total' => 10,
    ]);

    // ASSERT — negado, e o colega não ganhou vínculo com a criança
    $resposta->assertForbidden();
    expect(Tratamento::where('profissional_id', $colega->id)->count())->toBe(0);
});

it('deve deixar a RECEPÇÃO criar pacote — o par que a correção do SEC-VP-31 não pode quebrar', function () {
    // ARRANGE — a armadilha que o gate nomeou: trocar cru para o eixo clínico quebraria a
    // recepção, que é `nenhum` no clínico (sem `clinico.ver_todos` e sem vínculo). Este par existe
    // para que a correção não passe às custas de quebrar a clínica.
    admin();
    $prof = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $paciente = Paciente::factory()->create();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício Recepção']);
    $recepcao = usuarioCom(
        ['agenda.ver', 'agenda.criar', 'agenda.ver_todos', 'pacientes.ver', 'tratamentos.criar'],
        'Recepção sem vínculo',
    ); // SEM profissional_id: é `nenhum` no clínico

    // ACT + ASSERT
    $this->actingAs($recepcao)->postJson('/api/tratamentos', [
        'paciente_id' => $paciente->id,
        'profissional_id' => $prof->id,
        'especialidade_id' => $esp->id,
        'convenio_id' => $convenio->id,
        'sessoes_total' => 10,
    ])->assertCreated();
});

// ============================ SEC-VP-37 / SEC-VP-52 — a FATURISTA da matriz AP-10 ============================

/**
 * A coluna Faturista da matriz AP-10, DEPOIS da decisão da rodada 4 (`SEC-VP-37`): `tratamentos`
 * ver·criar·editar, `lancamentos` ver·criar·editar·pagar, `pacientes.ver` — e a flag
 * `agenda.ver_todos`, que é a flag OPERACIONAL (pacotes, faturamento, presença, avisos), não só a
 * grade. Sem `agenda.*`, sem `clinico.ver_todos`, sem `profissional_id`.
 */
function faturistaDaMatriz(bool $comAFlagOperacional = true): Usuario
{
    return usuarioCom([
        'pacientes.ver',
        'tratamentos.ver', 'tratamentos.criar', 'tratamentos.editar',
        'lancamentos.ver', 'lancamentos.criar', 'lancamentos.editar', 'lancamentos.pagar',
        ...($comAFlagOperacional ? ['agenda.ver_todos'] : []),
    ], 'Faturista'.($comAFlagOperacional ? '' : ' sem flag'));
}

/** Um pacote de `$prof` para `$paciente`, criado direto (a posse do cadastro não é o que se testa). */
function pacoteDoProfissional(Profissional $prof, Paciente $paciente): Tratamento
{
    return Tratamento::factory()->create([
        'profissional_id' => $prof->id,
        'paciente_id' => $paciente->id,
        'especialidade_id' => especialidadeDe($prof)->id,
    ]);
}

it('deve deixar a FATURISTA da matriz AP-10 cadastrar pacote (SEC-VP-37)', function () {
    // ARRANGE — a matriz antiga dizia "flags de escopo: SEM ambas" para ela, e o papel nascia
    // `Escopo::nenhum()` no eixo agenda: 403 em POST /tratamentos para QUALQUER criança. A decisão
    // (product-owner, rodada 4) foi corrigir a MATRIZ, não o código — a flag é operacional.
    admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    $convenio = Convenio::create(['nome' => 'Convênio Fictício Faturista']);
    $faturista = faturistaDaMatriz();

    // ACT
    $criacao = $this->actingAs($faturista)->postJson('/api/tratamentos', [
        'paciente_id' => $paciente->id,
        'profissional_id' => $prof->id,
        'especialidade_id' => especialidadeDe($prof)->id,
        'convenio_id' => $convenio->id,
        'sessoes_total' => 10,
    ]);

    // ASSERT
    $criacao->assertCreated();
    expect(Tratamento::where('paciente_id', $paciente->id)->where('profissional_id', $prof->id)->exists())->toBeTrue();
});

it('deve deixar a FATURISTA enxergar os pacotes da clínica inteira (SEC-VP-37, perna do index)', function () {
    // ARRANGE — a perna anterior (`8aaebc1`, alerta-de-fim-de-pacote): o index recorta pelo eixo
    // agenda, e o papel sem flag e sem vínculo via lista VAZIA apesar de `tratamentos.ver`.
    admin();
    $pacote = pacoteDoProfissional(Profissional::factory()->create(), Paciente::factory()->create());
    $faturista = faturistaDaMatriz();

    // ACT
    $lista = $this->actingAs($faturista)->getJson('/api/tratamentos');

    // ASSERT
    $lista->assertOk();
    expect($lista->json('total'))->toBeGreaterThan(0)
        ->and(collect($lista->json('data'))->pluck('id'))->toContain($pacote->id);
});

it('NÃO deve abrir a grade para a FATURISTA pela flag — a flag é escopo, não permissão (SEC-VP-37)', function () {
    // ARRANGE — o que a segurança mediu na rodada 4: com e sem a flag, as 14 rotas de `agenda.*`
    // respondem 403 para ela. A caixa "ver de todos" não abre tela nenhuma por si.
    admin();
    $faturista = faturistaDaMatriz();
    $hoje = agoraNaClinica()->format('Y-m-d');

    // ACT + ASSERT — barrada no middleware de permissão, que é a barreira certa aqui
    $this->actingAs($faturista)->getJson("/api/agenda?de={$hoje}&ate={$hoje}")->assertForbidden();
});

it('deve abrir o painel da ficha (resumo) para a FATURISTA e para a SECRETARIA (SEC-VP-52)', function () {
    // ARRANGE — o resumo decidia pelo eixo CLÍNICO, e o balcão (flag da agenda, sem a clínica,
    // sem vínculo) era `nenhum` ali: 403 para TODA criança, no dia 1. O conteúdo do resumo é
    // agenda + pacote (profissional atual, contrato, sessões) — nada de art. 11.
    admin();
    $paciente = Paciente::factory()->create();
    pacoteDoProfissional(Profissional::factory()->create(), $paciente);
    $faturista = faturistaDaMatriz();
    $secretaria = usuarioCom(
        ['pacientes.ver', 'pacientes.criar', 'pacientes.editar', 'agenda.ver', 'agenda.criar', 'agenda.editar', 'agenda.ver_todos', 'tratamentos.ver'],
        'Secretaria',
    );

    // ACT + ASSERT
    $this->actingAs($faturista)->getJson("/api/pacientes/{$paciente->id}/resumo")->assertOk();
    trocarDeUsuario();
    $this->actingAs($secretaria)->getJson("/api/pacientes/{$paciente->id}/resumo")->assertOk();
});

it('deve manter o FAIL-CLOSED para o nível sem a flag e sem vínculo — a forma que a matriz antiga prescrevia', function () {
    // ARRANGE — é a guarda NEGATIVA: o aviso da tela de níveis descreve exatamente este estado.
    // Um papel com `tratamentos.criar`, sem `agenda.ver_todos` e sem `profissional_id` não é
    // "plano por inferência" (o medo literal do SEC-VP-02) — é cego, de propósito.
    admin();
    $prof = Profissional::factory()->create();
    $paciente = Paciente::factory()->create();
    pacoteDoProfissional($prof, Paciente::factory()->create());
    $convenio = Convenio::create(['nome' => 'Convênio Fictício Sem Flag']);
    $semFlag = faturistaDaMatriz(comAFlagOperacional: false);

    // ACT
    $criacao = $this->actingAs($semFlag)->postJson('/api/tratamentos', [
        'paciente_id' => $paciente->id,
        'profissional_id' => $prof->id,
        'especialidade_id' => especialidadeDe($prof)->id,
        'convenio_id' => $convenio->id,
        'sessoes_total' => 10,
    ]);
    $lista = $this->actingAs($semFlag)->getJson('/api/tratamentos');

    // ASSERT
    $criacao->assertForbidden();
    $lista->assertOk();
    expect($lista->json('total'))->toBe(0);
});

it('deve responder IGUAL ao pacote do colega e ao pacote inexistente (SEC-VP-33)', function () {
    // ARRANGE — o `findOrFail` vinha antes da posse: 404 para id inexistente, 403 para o pacote do
    // colega. A diferença contava se a linha existe. Não é dado de art. 11 — é existência de linha,
    // e contradiz a doutrina da casa (SEC-OCC-02).
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $doColega = Tratamento::factory()->create(['profissional_id' => $colega->id, 'sessoes_realizadas' => 0]);
    $inexistente = Tratamento::max('id') + 5000;
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT + ASSERT — os três verbos, cada um com o par colega × inexistente
    foreach ([
        'GET' => fn (int $id) => $this->actingAs($usuario)->getJson("/api/tratamentos/{$id}"),
        'DELETE' => fn (int $id) => $this->actingAs($usuario)->deleteJson("/api/tratamentos/{$id}"),
    ] as $verbo => $chamar) {
        expect($chamar($doColega->id)->status())
            ->toBe($chamar($inexistente)->status(), "O verbo {$verbo} distingue colega de inexistente.");
    }
});

it('deve registrar a tentativa de escalada horizontal (SEC-VP-34)', function () {
    // ARRANGE — com a posse migrada para `authorize()`, o escopado que pede o profissional de um
    // colega passou a levar 403 do `Escopo`, e dali não saía registro nenhum: NENHUMA tentativa de
    // escalada horizontal aparecia no canal, só a recusa por vínculo.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $esp = especialidadeDe($colega);
    $paciente = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);

    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT — tenta marcar na agenda do COLEGA
    $this->actingAs($usuario)->postJson('/api/agendamentos', [
        'profissional_id' => $colega->id,
        'especialidade_id' => $esp->id,
        'paciente_id' => $paciente->id,
        'inicio' => agoraNaClinica()->copy()->addDays(2)->setTime(9, 0)->format('Y-m-d H:i'),
    ])->assertForbidden();

    // ASSERT — a tentativa deixa rastro, com o profissional tentado (id de PROFISSIONAL não é
    // dado de menor; o da criança continua fora)
    $eventos = array_filter($handler->getRecords(), fn ($r) => $r['message'] === 'escopo.posse_negada');
    expect($eventos)->toHaveCount(1);
    $contexto = array_values($eventos)[0]['context'];
    expect(array_keys($contexto))->toBe([
        'usuario_id', 'profissional_do_escopo_id', 'profissional_tentado_id', 'ip',
    ]);
    expect($contexto['profissional_tentado_id'])->toBe($colega->id);
});

it('deve recusar IGUAL o profissional do colega e o inexistente no ENCAIXE (SEC-VP-32)', function () {
    // ARRANGE — a doutrina "posse antes da validação" valia em 3 de 5 superfícies. Aqui a posse
    // vinha depois do `validated()`, e o par se separava por status: colega 403, inexistente 422
    // ("O valor escolhido em profissional não existe") — enumerando o quadro de profissionais.
    $recepcao = admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $naFila = Paciente::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);
    $entradaId = $this->actingAs($recepcao)->postJson('/api/lista-espera', [
        'paciente_id' => $naFila->id, 'prioridade' => 0,
    ])->assertCreated()->json('id');
    $this->flushSession();
    $this->app['auth']->forgetGuards();

    $encaixar = fn (int $profissionalId) => $this->actingAs($usuario)
        ->postJson("/api/lista-espera/{$entradaId}/encaixar", [
            'profissional_id' => $profissionalId,
            'especialidade_id' => $esp->id,
            'inicio' => agoraNaClinica()->copy()->addDays(2)->setTime(10, 0)->format('Y-m-d H:i'),
        ]);

    // ACT + ASSERT
    expect($encaixar($colega->id)->status())
        ->toBe($encaixar(Profissional::max('id') + 5000)->status())
        ->toBe(403);
});

it('deve recusar IGUAL no DESMARQUE EM LOTE (SEC-VP-32)', function () {
    // ARRANGE — a outra superfície com o mesmo defeito
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);

    $previa = fn (int $profissionalId) => $this->actingAs($usuario)
        ->postJson('/api/agendamentos/desmarque-em-lote/previa', [
            'profissional_id' => $profissionalId,
            'de' => agoraNaClinica()->copy()->addDays(2)->format('Y-m-d'),
            'ate' => agoraNaClinica()->copy()->addDays(2)->format('Y-m-d'),
            'periodo' => 'dia',
        ]);

    // ACT + ASSERT
    expect($previa($colega->id)->status())
        ->toBe($previa(Profissional::max('id') + 5000)->status())
        ->toBe(403);
});

it('deve responder IGUAL ao agendamento do colega e ao inexistente (SEC-VP-40)', function () {
    // ARRANGE — eu fechei isto no TRATAMENTO e declarei fechado "nas rotas sem FormRequest". Era
    // METADE: o `AgendamentoController` mantinha `findOrFail` antes da posse em quatro chamadas.
    // Quarta vez nesta change que o registro afirma mais do que o código faz — e sempre porque o
    // repro que eu usei definiu o escopo do conserto.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $doColega = Agendamento::factory()->create(['profissional_id' => $colega->id]);
    $inexistente = Agendamento::max('id') + 5000;
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT + ASSERT — os três verbos sem FormRequest
    foreach ([
        'GET detalhe' => fn (int $id) => $this->actingAs($usuario)->getJson("/api/agendamentos/{$id}"),
        'GET série' => fn (int $id) => $this->actingAs($usuario)->getJson("/api/agendamentos/{$id}/serie"),
        'DELETE' => fn (int $id) => $this->actingAs($usuario)->deleteJson("/api/agendamentos/{$id}"),
    ] as $rotulo => $chamar) {
        expect($chamar($doColega->id)->status())
            ->toBe($chamar($inexistente)->status(), "{$rotulo} distingue colega de inexistente.");
    }
});

it('deve registrar também a recusa do eixo CLÍNICO (SEC-VP-41)', function () {
    // ARRANGE — a perna da agenda já registrava; a clínica abortava cru. Ou seja: o caminho que a
    // rodada 3 acabou de fechar, o do art. 11, era justamente o que NÃO aparecia no canal.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $esp = especialidadeDe($prof);
    $minha = Paciente::factory()->create();
    Agendamento::factory()->create([
        'profissional_id' => $prof->id, 'paciente_id' => $minha->id, 'especialidade_id' => $esp->id,
    ]);
    $convenio = Convenio::create(['nome' => 'Convênio Fictício SEC-VP-41']);
    $usuario = usuarioCom(
        ['agenda.ver', 'agenda.criar', 'agenda.ver_todos', 'pacientes.ver', 'tratamentos.criar'],
        'Plano na agenda, escopado no clínico (log)',
    );
    $usuario->update(['profissional_id' => $prof->id]);

    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT — a recusa vem do eixo CLÍNICO (na agenda ele é plano)
    $this->actingAs($usuario)->postJson('/api/tratamentos', [
        'paciente_id' => $minha->id,
        'profissional_id' => $colega->id,
        'especialidade_id' => $esp->id,
        'convenio_id' => $convenio->id,
        'sessoes_total' => 10,
    ])->assertForbidden();

    // ASSERT
    $eventos = array_filter($handler->getRecords(), fn ($r) => $r['message'] === 'escopo.posse_negada');
    expect($eventos)->toHaveCount(1);
    expect(array_values($eventos)[0]['context']['profissional_tentado_id'])->toBe($colega->id);
});

it('NÃO deve registrar quando o id de profissional não existe (typo, SEC-VP-43)', function () {
    // ARRANGE — par de controle do ruído: depois do SEC-VP-40 o id inexistente devolve 403 igual
    // ao do colega, então quem digitou errado não está sondando dono nenhum. Registrar encheria o
    // canal com typo — o mesmo ruído que o outro log já tinha aprendido a evitar.
    admin();
    $prof = Profissional::factory()->create();
    $usuario = usuarioSoDaPropriaAgenda($prof);

    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT
    $this->actingAs($usuario)
        ->getJson('/api/agendamentos/'.(Agendamento::max('id') + 5000))
        ->assertForbidden();

    // ASSERT
    expect(array_filter($handler->getRecords(), fn ($r) => $r['message'] === 'escopo.posse_negada'))
        ->toBe([]);
});

// ============================ SEC-VP-44 — plano na agenda, escopado no clínico: remarcar ============================

/** Sessão futura de `$prof` com `$paciente`, criada direto (o que se testa é a edição dela). */
function sessaoFuturaDe(Profissional $prof, Paciente $paciente, int $emDias = 3): Agendamento
{
    $inicio = agoraNaClinica()->copy()->addDays($emDias)->setTime(9, 0);

    return Agendamento::factory()->create([
        'tipo' => 'atendimento',
        'profissional_id' => $prof->id,
        'especialidade_id' => especialidadeDe($prof)->id,
        'paciente_id' => $paciente->id,
        'inicio' => $inicio,
        'fim' => $inicio->copy()->addMinutes(40),
    ]);
}

it('deve deixar quem é PLANO na agenda e ESCOPADO no clínico REMARCAR a sessão do colega (SEC-VP-44)', function () {
    // ARRANGE — a rodada 3 aplicou os dois eixos também ao id da rota: a coordenadora-terapeuta
    // lia (200) e apagava (204) a sessão do colega, mas remarcar dava 403. Sobrava-lhe a pior das
    // escritas. Remarcar não concede vínculo a ninguém — é posse de registro, eixo da agenda.
    admin();
    $coordenadora = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $crianca = Paciente::factory()->create();
    $sessao = sessaoFuturaDe($colega, $crianca);
    $usuario = planoNaAgendaEscopadoNoClinico($coordenadora);

    // ACT — mesma criança, mesmo dono, outro horário (o PUT exige `If-Match`: concorrência otimista)
    $resposta = $this->actingAs($usuario)
        ->withHeader('If-Match', $sessao->fresh()->updated_at->toISOString())
        ->putJson("/api/agendamentos/{$sessao->id}", [
            'profissional_id' => $colega->id,
            'especialidade_id' => $sessao->especialidade_id,
            'paciente_id' => $crianca->id,
            'inicio' => agoraNaClinica()->copy()->addDays(4)->setTime(14, 0)->format('Y-m-d H:i'),
        ]);

    // ASSERT
    $resposta->assertOk();
    expect($sessao->fresh()->inicio->format('H:i'))->toBe('14:00');
});

it('deve deixar o mesmo perfil editar o pacote do colega sem trocar o dono (SEC-VP-44, pacote)', function () {
    // ARRANGE
    admin();
    $coordenadora = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $pacote = pacoteDoProfissional($colega, Paciente::factory()->create());
    $usuario = planoNaAgendaEscopadoNoClinico($coordenadora);
    $usuario->givePermissionTo(['tratamentos.ver', 'tratamentos.editar']);

    // ACT — ler e mudar o total; o dono continua o colega
    $leitura = $this->actingAs($usuario)->getJson("/api/tratamentos/{$pacote->id}");
    $edicao = $this->actingAs($usuario)
        ->withHeader('If-Match', $pacote->fresh()->updated_at->toJSON())
        ->putJson("/api/tratamentos/{$pacote->id}", [
            'paciente_id' => $pacote->paciente_id,
            'profissional_id' => $colega->id,
            'especialidade_id' => $pacote->especialidade_id,
            'convenio_id' => $pacote->convenio_id,
            'sessoes_total' => 12,
        ]);

    // ASSERT
    $leitura->assertOk();
    $edicao->assertOk();
    expect($pacote->fresh()->sessoes_total)->toBe(12);
});

it('NÃO deve deixar o mesmo perfil TROCAR a criança nem o dono da sessão do colega (SEC-VP-31 continua fechado)', function () {
    // ARRANGE — as três trocas criam vínculo: criança nova para o colega; dono novo para outro
    // colega; e o dono para SI MESMO com a mesma criança — este último a regra de vínculo prévio
    // pulava (a criança "não mudou"), e era o atalho pela trava que a rodada 4 achou ao consertar.
    admin();
    $coordenadora = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $outroColega = Profissional::factory()->create();
    $crianca = Paciente::factory()->create();
    $outraCrianca = Paciente::factory()->create();
    $sessao = sessaoFuturaDe($colega, $crianca);
    $usuario = planoNaAgendaEscopadoNoClinico($coordenadora);
    // A PROVA NA CONDIÇÃO CERTA (re-review da rodada 4, SEC-VP-54): sem `If-Match` o mutante
    // (trava removida) caía em 428, e sem a coordenadora ATENDER a especialidade caía na regra de
    // domínio — o teste ficava vermelho sem nunca exercitar a escalada. Com as duas condições, o
    // mutante devolve 200 e re-parenteia a sessão do colega para ela: é ISSO que a trava impede.
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $coordenadora->id,
        'especialidade_id' => $sessao->especialidade_id,
    ]);
    $base = [
        'especialidade_id' => $sessao->especialidade_id,
        'inicio' => agoraNaClinica()->copy()->addDays(4)->setTime(14, 0)->format('Y-m-d H:i'),
    ];
    $put = fn (array $payload) => $this->actingAs($usuario)
        ->withHeader('If-Match', $sessao->fresh()->updated_at->toISOString())
        ->putJson("/api/agendamentos/{$sessao->id}", [...$base, ...$payload]);

    // ACT
    $trocaDeCrianca = $put(['profissional_id' => $colega->id, 'paciente_id' => $outraCrianca->id]);
    $trocaDeDono = $put(['profissional_id' => $outroColega->id, 'paciente_id' => $crianca->id]);
    $paraSiMesma = $put(['profissional_id' => $coordenadora->id, 'paciente_id' => $crianca->id]);
    $paraSiMesmaSemMandarACrianca = $put(['profissional_id' => $coordenadora->id]);

    // ASSERT — nenhuma passa, e a sessão continua do colega com a criança original
    $trocaDeCrianca->assertForbidden();
    $trocaDeDono->assertForbidden();
    $paraSiMesma->assertForbidden();
    $paraSiMesmaSemMandarACrianca->assertForbidden();
    $fresca = $sessao->fresh();
    expect($fresca->profissional_id)->toBe($colega->id)
        ->and($fresca->paciente_id)->toBe($crianca->id);
});

it('NÃO deve deixar o mesmo perfil TROCAR O DONO do pacote do colega — nem para si (CR4b-01)', function () {
    // ARRANGE — a perna que o repro da rodada 4 não usou: `recusarMudancaDeIdentidade` protege a
    // criança e a especialidade, NUNCA o `profissional_id` (SEC-VP-11). Re-parentear o pacote do
    // colega para si com a mesma criança é vínculo novo (coordenadora × criança) sem passar pela
    // recepção — a classe exata do SEC-VP-31 — e a trava existia sem teste que caísse.
    admin();
    $coordenadora = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $outroColega = Profissional::factory()->create();
    $pacote = pacoteDoProfissional($colega, Paciente::factory()->create());
    $usuario = planoNaAgendaEscopadoNoClinico($coordenadora);
    $usuario->givePermissionTo(['tratamentos.ver', 'tratamentos.editar']);
    $payload = fn (int $dono): array => [
        'paciente_id' => $pacote->paciente_id,
        'profissional_id' => $dono,
        'especialidade_id' => $pacote->especialidade_id,
        'convenio_id' => $pacote->convenio_id,
        'sessoes_total' => $pacote->sessoes_total,
    ];

    // ACT
    $paraSiMesma = $this->actingAs($usuario)
        ->withHeader('If-Match', $pacote->fresh()->updated_at->toISOString())
        ->putJson("/api/tratamentos/{$pacote->id}", $payload($coordenadora->id));
    $paraOutroColega = $this->actingAs($usuario)
        ->withHeader('If-Match', $pacote->fresh()->updated_at->toISOString())
        ->putJson("/api/tratamentos/{$pacote->id}", $payload($outroColega->id));

    // ASSERT
    $paraSiMesma->assertForbidden();
    $paraOutroColega->assertForbidden();
    expect($pacote->fresh()->profissional_id)->toBe($colega->id);
});

it('deve deixar o mesmo perfil abrir a PRÉVIA do desmarque em lote do colega — não cria vínculo (CR4b-02)', function () {
    // ARRANGE — a Request do desmarque decidia pelos dois eixos uma operação que só muda status e
    // apaga: era o SEC-VP-44 numa superfície que o conserto não enumerou. O escopado de verdade
    // continua barrado (teste do SEC-VP-32, acima).
    admin();
    $coordenadora = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $usuario = planoNaAgendaEscopadoNoClinico($coordenadora);
    $usuario->givePermissionTo(['agenda.excluir']);
    $de = agoraNaClinica()->copy()->addDays(3)->format('Y-m-d');

    // ACT
    $previa = $this->actingAs($usuario)->postJson('/api/agendamentos/desmarque-em-lote/previa', [
        'profissional_id' => $colega->id, 'de' => $de, 'ate' => $de, 'periodo' => 'manha',
    ]);

    // ASSERT
    $previa->assertOk();
});

it('NÃO deve deixar um id PRESENTE mas não-inteiro pular a posse (SEC-VP-53)', function () {
    // ARRANGE — o furo que a re-review achou no conserto da rodada 4: `profissional_id: true` era
    // "ausente" para o `authorize()` (posse pulada) e `1` para a validação (`filter_var` coage
    // bool). A coordenadora — plano na agenda, escopada no clínico — criava agendamento E pacote em
    // nome do profissional #1, concedendo-lhe o prontuário de uma criança que ele não atende.
    admin();
    // `true` vira o profissional de id 1 — que NÃO pode ser a própria coordenadora, senão o 201
    // seria legítimo (agenda dela, criança dela) e o teste não mediria o furo. Rodado isolado, o
    // primeiro profissional criado é o 1; por isso o "profissional #1" nasce antes dela.
    $profissionalUm = Profissional::factory()->create();
    $coordenadora = Profissional::factory()->create();
    expect($coordenadora->id)->not->toBe(1);
    $esp = especialidadeDe($coordenadora);
    $crianca = Paciente::factory()->create();
    pacoteDoProfissional($coordenadora, $crianca); // a criança É dela: a trava de vínculo não é o que barra
    $convenio = Convenio::create(['nome' => 'Convênio Fictício SEC-VP-53']);
    $usuario = planoNaAgendaEscopadoNoClinico($coordenadora);
    $usuario->givePermissionTo(['tratamentos.ver', 'tratamentos.criar']);
    $antes = Agendamento::where('paciente_id', $crianca->id)->count();

    // ACT — `true`, `false`, array e lixo no campo do profissional
    $respostas = [];
    foreach ([true, false, ['x'], '2abc'] as $valor) {
        $respostas[] = $this->actingAs($usuario)->postJson('/api/agendamentos', [
            ...payloadDeAgendamento($coordenadora, $esp, $crianca), 'profissional_id' => $valor,
        ])->status();
        $respostas[] = $this->actingAs($usuario)->postJson('/api/tratamentos', [
            'paciente_id' => $crianca->id, 'profissional_id' => $valor, 'especialidade_id' => $esp->id,
            'convenio_id' => $convenio->id, 'sessoes_total' => 10,
        ])->status();
    }

    // ASSERT — nada nasce, e nenhuma resposta é 201: `true` vira 1 e cai na posse (403), o resto
    // é recusado na forma da validação (422) antes de qualquer gravação
    expect($respostas)->each->toBeIn([403, 422]);
    expect(Agendamento::where('paciente_id', $crianca->id)->count())->toBe($antes)
        ->and(Tratamento::where('paciente_id', $crianca->id)->where('profissional_id', '!=', $coordenadora->id)->exists())->toBeFalse()
        ->and(Agendamento::where('profissional_id', $profissionalUm->id)->exists())->toBeFalse();
});

it('NÃO deve registrar no canal o id de rota inexistente pela perna clínica (CR4-02)', function () {
    // ARRANGE — medido na rodada 4: `PUT /agendamentos/{inexistente}` pelo perfil plano-agenda/
    // escopado-clínico gravava `escopo.posse_negada` com `profissional_tentado_id: null`. Typo
    // virando "escalada horizontal". Com a posse do registro existente no eixo da agenda, o
    // inexistente é 404 para quem é plano ali — e o canal fica em silêncio.
    admin();
    $coordenadora = Profissional::factory()->create();
    $usuario = planoNaAgendaEscopadoNoClinico($coordenadora);
    $usuario->givePermissionTo(['tratamentos.ver', 'tratamentos.editar']);
    $handler = new TestHandler;
    Log::channel('seguranca')->getLogger()->pushHandler($handler);

    // ACT
    $put = $this->actingAs($usuario)->putJson('/api/agendamentos/987654321', [
        'profissional_id' => $coordenadora->id,
        'inicio' => agoraNaClinica()->copy()->addDays(4)->setTime(14, 0)->format('Y-m-d H:i'),
    ]);
    $get = $this->actingAs($usuario)->getJson('/api/tratamentos/987654321');

    // ASSERT
    $put->assertNotFound();
    $get->assertNotFound();
    expect($handler->getRecords())->toBe([]);
});

// ============================ SEC-VP-36 — a caixa de paciente só oferece o que o servidor aceita ============================

it('deve oferecer ao escopado, no catálogo TODOS, só as crianças que ele já atende (SEC-VP-36)', function () {
    // ARRANGE — a seção TODOS era plana: a caixa oferecia a Alice, e o servidor recusava a Alice
    // como "não existe". A cegueira estava certa; o convite é que estava errado.
    admin();
    $prof = Profissional::factory()->create();
    $bruno = Paciente::factory()->create(['nome' => 'Bruno Fictício']);
    $alice = Paciente::factory()->create(['nome' => 'Alice Fictícia']);
    pacoteDoProfissional($prof, $bruno);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT
    $catalogo = $this->actingAs($usuario)->getJson('/api/agenda/selecao/pacientes?pagina=1');
    $busca = $this->actingAs($usuario)->getJson('/api/agenda/selecao/pacientes?busca=Ali');
    $porId = $this->actingAs($usuario)->getJson("/api/agenda/selecao/pacientes?id={$alice->id}");

    // ASSERT — Bruno sim, Alice não, e a ausência é SILÊNCIO (200 vazio), nunca 403 (SEC-CP-01)
    $catalogo->assertOk();
    expect(collect($catalogo->json())->pluck('id'))->toContain($bruno->id)->not->toContain($alice->id);
    $busca->assertOk()->assertExactJson([]);
    $porId->assertOk()->assertExactJson([]);
});

it('deve manter o catálogo INTEIRO para a recepção e VAZIO para quem não tem vínculo nem flag (SEC-VP-36)', function () {
    // ARRANGE
    admin();
    $prof = Profissional::factory()->create();
    $bruno = Paciente::factory()->create(['nome' => 'Bruno Fictício']);
    $alice = Paciente::factory()->create(['nome' => 'Alice Fictícia']);
    pacoteDoProfissional($prof, $bruno);
    $recepcao = usuarioCom(['agenda.ver', 'agenda.criar', 'agenda.ver_todos'], 'Recepção');
    $semVinculo = usuarioCom(['agenda.ver', 'agenda.criar'], 'Sem vínculo e sem flag');

    // ACT
    $daRecepcao = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=1');
    trocarDeUsuario();
    $doSemVinculo = $this->actingAs($semVinculo)->getJson('/api/agenda/selecao/pacientes?pagina=1');

    // ASSERT
    expect(collect($daRecepcao->json())->pluck('id'))->toContain($bruno->id)->toContain($alice->id);
    $doSemVinculo->assertOk()->assertExactJson([]);
});

it('deve CALAR o catálogo de pacotes de criança fora do escopo, sem 403 (SEC-VP-36, tratamentos)', function () {
    // ARRANGE — o resíduo "plano" da mesma família: `/agenda/selecao/tratamentos?paciente_id=`
    // entregava `#8 · 16/20 sessões` da criança do colega.
    admin();
    $prof = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    $bruno = Paciente::factory()->create();
    $alice = Paciente::factory()->create();
    $pacoteDoBruno = pacoteDoProfissional($prof, $bruno);
    pacoteDoProfissional($colega, $alice);
    $usuario = usuarioSoDaPropriaAgenda($prof);

    // ACT
    $doBruno = $this->actingAs($usuario)->getJson("/api/agenda/selecao/tratamentos?paciente_id={$bruno->id}");
    $daAlice = $this->actingAs($usuario)->getJson("/api/agenda/selecao/tratamentos?paciente_id={$alice->id}");

    // ASSERT
    expect(collect($doBruno->json())->pluck('id'))->toContain($pacoteDoBruno->id);
    $daAlice->assertOk()->assertExactJson([]);
});
