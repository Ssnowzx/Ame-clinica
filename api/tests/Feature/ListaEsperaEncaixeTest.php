<?php

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Especialidade;
use App\Models\ListaEspera;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use Illuminate\Support\Facades\DB;

/**
 * Encaixe (§6): agendar e sair da fila são UMA operação (design D1/D2).
 * O agendamento é do AgendamentoService — aqui provamos a ATOMICIDADE, o RBAC
 * composto e que o paciente vem da FILA.
 */

/** Entrada na fila + os ids do slot que o encaixe vai usar. */
function filaComSlot(): array
{
    $base = baseDeAgenda(); // paciente, profissional, especialidade (N:M) e início
    $entrada = ListaEspera::create([
        'paciente_id' => $base['paciente_id'],
        'especialidade_id' => $base['especialidade_id'],
        'profissional_id' => $base['profissional_id'],
        'prioridade' => 5,
    ]);

    return [$entrada, $base];
}

it('deve criar o agendamento e remover a entrada da fila', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ]);

    // ASSERT — agendamento do paciente DA ENTRADA; a fila andou
    $resposta->assertCreated()
        ->assertJsonPath('paciente_id', $entrada->paciente_id)
        ->assertJsonPath('tipo', 'atendimento');
    expect(Agendamento::count())->toBe(1)
        ->and(ListaEspera::find($entrada->id))->toBeNull();
});

it('deve manter o paciente na fila quando o agendamento é recusado', function () {
    // ARRANGE — o horário do encaixe já está ocupado pelo profissional
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();
    $this->actingAs($adminDaClinica)->postJson('/api/agendamentos', [
        ...$base,
        'paciente_id' => Paciente::factory()->create()->id,
    ])->assertCreated();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ]);

    // ASSERT — a recusa derruba a transação INTEIRA: ninguém perde o lugar na fila
    $resposta->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
    expect(ListaEspera::find($entrada->id))->not->toBeNull()
        ->and(Agendamento::count())->toBe(1); // só o que já existia
});

it('deve manter o paciente na fila quando o encaixe é retroativo', function () {
    // ARRANGE — segunda recusa do domínio, por outro caminho (config §13)
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => agoraNaClinica()->subDay()->format('Y-m-d H:i'),
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('inicio');
    expect(ListaEspera::find($entrada->id))->not->toBeNull()
        ->and(Agendamento::count())->toBe(0);
});

it('deve manter o paciente na fila quando a recusa nasce DENTRO da transação', function () {
    // ARRANGE — a invariante que a change inteira sustenta (design D2/Risks).
    // As outras recusas (ocupado, retroativo) nascem ANTES da transação do
    // AgendamentoService: elas não provam o savepoint. O consumo de sessão nasce
    // DEPOIS do INSERT do agendamento, dentro da transação aninhada — é este
    // caminho que dirá, no dia em que o serviço passar a commitar por conta
    // própria, que o encaixe deixou de ser atômico (parecer SEC-LE-02).
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();
    $tratamento = Tratamento::factory()->create([
        'paciente_id' => $entrada->paciente_id,
        'especialidade_id' => $base['especialidade_id'],
        'status' => 'andamento',
    ]);
    $descontante = StatusAgendamento::where('desconta_sessao', true)->firstOrFail();

    // ACT — status que desconta sessão em data FUTURA: recusa do ConsumoSessaoService
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'tratamento_id' => $tratamento->id,
        'status_id' => $descontante->id,
    ]);

    // ASSERT — o INSERT do agendamento volta pelo savepoint; a fila não anda; e
    // nenhuma sessão do tratamento foi consumida
    $resposta->assertUnprocessable()->assertJsonValidationErrors('status_id');
    expect(ListaEspera::find($entrada->id))->not->toBeNull()
        ->and(Agendamento::count())->toBe(0)
        ->and($tratamento->fresh()->sessoes_realizadas)->toBe(0);
});

it('deve carimbar a origem do agendamento nascido de encaixe', function () {
    // ARRANGE — sem isto, o agendamento fica indistinguível de um marcado à mão
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('origem', 'encaixe');
});

it('deve recusar tipo e aplicar_na_serie no payload do encaixe', function () {
    // ARRANGE — encaixe é sempre atendimento, e nunca alcança uma série
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();
    $payload = [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ];

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)
        ->postJson("/api/lista-espera/{$entrada->id}/encaixar", [...$payload, 'tipo' => 'bloqueio'])
        ->assertUnprocessable()->assertJsonValidationErrors('tipo');
    $this->actingAs($adminDaClinica)
        ->postJson("/api/lista-espera/{$entrada->id}/encaixar", [...$payload, 'aplicar_na_serie' => true])
        ->assertUnprocessable()->assertJsonValidationErrors('aplicar_na_serie');
    expect(Agendamento::count())->toBe(0);
});

it('deve exigir especialidade no encaixe de entrada sem desejo', function () {
    // ARRANGE — a entrada pode não ter especialidade; o AGENDAMENTO sempre tem
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $entrada = ListaEspera::create(['paciente_id' => $base['paciente_id']]);

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
    ])->assertUnprocessable()->assertJsonValidationErrors('especialidade_id');
});

it('deve encaixar com profissional diferente do desejado', function () {
    // ARRANGE — "abriu com outro profissional da mesma especialidade" é o encaixe
    // mais comum da recepção (design D3): a regra não pode endurecer sem quebrar
    // este teste
    $adminDaClinica = admin();
    $base = baseDeAgenda();
    $outroProfissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $outroProfissional->id,
        'especialidade_id' => $base['especialidade_id'],
    ]);
    $entrada = ListaEspera::create([
        'paciente_id' => $base['paciente_id'],
        'especialidade_id' => $base['especialidade_id'],
        'profissional_id' => $base['profissional_id'], // desejava ESTE
    ]);

    // ACT — encaixa no horário que abriu, com o OUTRO
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $outroProfissional->id,
        'especialidade_id' => $base['especialidade_id'],
    ]);

    // ASSERT
    $resposta->assertCreated()->assertJsonPath('profissional_id', $outroProfissional->id);
    expect(ListaEspera::find($entrada->id))->toBeNull();
});

it('deve recusar paciente_id no payload do encaixe', function () {
    // ARRANGE — abuse case: a rota da fila viraria um segundo caminho para criar
    // agendamento arbitrário, com o RBAC do encaixe e não o da agenda
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();
    $outroPaciente = Paciente::factory()->create();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'paciente_id' => $outroPaciente->id,
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('paciente_id');
    expect(Agendamento::count())->toBe(0)
        ->and(ListaEspera::find($entrada->id))->not->toBeNull();
});

it('deve recusar recorrência no encaixe', function () {
    // ARRANGE — encaixe é um horário que abriu, não uma série
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
        'recorrencia' => ['ate' => agoraNaClinica()->addMonth()->format('Y-m-d')],
    ])->assertUnprocessable()->assertJsonValidationErrors('recorrencia');
    expect(Agendamento::count())->toBe(0);
});

it('deve recusar a chave NULA nos campos que o encaixe não aceita', function () {
    // ARRANGE — gatilho PROHIBITED-NULL. `prohibited` = "ausente OU VAZIO": a chave nula
    // PASSAVA a validação e o `validated()` a carregava adiante. Aqui o `paciente_id` do
    // encaixe vem da FILA — um null que passasse chegaria ao serviço como "sem paciente",
    // que é o bloqueio de agenda. A regra imutável recusa a PRESENÇA, não o valor.
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();

    // ACT + ASSERT — os quatro campos imutáveis do encaixe, todos com null
    foreach (['paciente_id', 'tipo', 'recorrencia', 'aplicar_na_serie'] as $campo) {
        $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
            'inicio' => $base['inicio'],
            'profissional_id' => $base['profissional_id'],
            'especialidade_id' => $base['especialidade_id'],
            $campo => null,
        ])->assertUnprocessable()->assertJsonValidationErrors($campo);
    }

    expect(Agendamento::count())->toBe(0);
});

it('deve negar o encaixe a quem só sabe agendar', function () {
    // ARRANGE — agenda.criar sem lista_espera.excluir: não esvazia a fila
    admin();
    [$entrada, $base] = filaComSlot();
    $soAgenda = usuarioCom(['agenda.ver', 'agenda.criar'], 'Só Agenda');

    // ACT + ASSERT
    $this->actingAs($soAgenda)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ])->assertForbidden();
    expect(Agendamento::count())->toBe(0)
        ->and(ListaEspera::find($entrada->id))->not->toBeNull();
});

it('deve negar o encaixe a quem só administra a fila', function () {
    // ARRANGE — lista_espera.* sem agenda.criar: não cria agendamento
    admin();
    [$entrada, $base] = filaComSlot();
    $soFila = usuarioCom(
        ['lista_espera.ver', 'lista_espera.criar', 'lista_espera.editar', 'lista_espera.excluir'],
        'Só Fila'
    );

    // ACT + ASSERT
    $this->actingAs($soFila)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ])->assertForbidden();
    expect(Agendamento::count())->toBe(0)
        ->and(ListaEspera::find($entrada->id))->not->toBeNull();
});

it('deve responder 404 quando a entrada já foi encaixada', function () {
    // ARRANGE — a corrida das duas recepcionistas: a segunda chega e a fila andou
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();
    $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ])->assertCreated();

    // ACT + ASSERT — outro horário livre, mesma entrada
    $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => agoraNaClinica()->addDay()->format('Y-m-d').' 15:00',
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ])->assertNotFound();
    expect(Agendamento::count())->toBe(1);
});

it('deve auditar a saída da fila pelo encaixe', function () {
    // ARRANGE
    $adminDaClinica = admin();
    [$entrada, $base] = filaComSlot();

    // ACT
    $this->actingAs($adminDaClinica)->postJson("/api/lista-espera/{$entrada->id}/encaixar", [
        'inicio' => $base['inicio'],
        'profissional_id' => $base['profissional_id'],
        'especialidade_id' => $base['especialidade_id'],
    ])->assertCreated();

    // ASSERT — quem tirou da fila, e quando
    $registro = Auditoria::where('entidade', 'lista_espera')
        ->where('acao', 'excluiu')
        ->where('entidade_id', $entrada->id)
        ->firstOrFail();
    expect($registro->usuario_id)->toBe($adminDaClinica->id);
});

it('deve devolver especialidade e profissional com nome na fila', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create(['cpf' => '52998224725']);
    ListaEspera::create([
        'paciente_id' => $paciente->id,
        'especialidade_id' => Especialidade::factory()->create(['nome' => 'Fonoaudiologia'])->id,
        'profissional_id' => Profissional::factory()->create(['nome' => 'Ana Fictícia'])->id,
    ]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/lista-espera');

    // ASSERT — a tela recebe os nomes; o cadastro do menor continua fora
    $resposta->assertOk()
        ->assertJsonPath('0.especialidade.nome', 'Fonoaudiologia')
        ->assertJsonPath('0.profissional.nome', 'Ana Fictícia');
    expect($resposta->json('0.paciente'))->toHaveKeys(['id', 'nome'])
        ->and($resposta->getContent())->not->toContain('52998224725')
        ->not->toContain('responsaveis_json');
    expect($resposta->json('0.created_at'))->not->toBeNull();
});

it('deve entregar a quem só administra a fila apenas os catálogos do formulário dela', function () {
    // ARRANGE — a rota da seleção também atende a fila (D5). Entregar a ela salas,
    // equipamentos, médicos e status seria dar de brinde quatro catálogos que ela
    // não tem permissão de ver (parecer SEC-LE-07)
    admin();
    $soFila = usuarioCom(['lista_espera.ver', 'lista_espera.criar'], 'Fila sem Agenda');

    // ACT
    $resposta = $this->actingAs($soFila)->getJson('/api/agenda/selecao');

    // ASSERT
    $resposta->assertOk()->assertJsonStructure(['profissionais', 'especialidades']);
    expect($resposta->json())->not->toHaveKey('salas')
        ->and($resposta->json())->not->toHaveKey('equipamentos')
        ->and($resposta->json())->not->toHaveKey('medicos')
        ->and($resposta->json())->not->toHaveKey('status');
});

it('deve permitir escolher paciente a quem administra a fila sem permissão de agenda', function () {
    // ARRANGE — entrar na fila exige escolher paciente; a alternativa seria
    // pacientes.ver, que entrega CPF/responsáveis/endereço de menor (design D5).
    // A recepção da fila é BALCÃO: sem vínculo, precisa da flag operacional `agenda.ver_todos`
    // (rodada 4 de `vinculo-previo-para-agendar`, `SEC-VP-36`/`SEC-VP-37`) — é a mesma caixa
    // da Secretaria na matriz AP-10. Sem ela e sem vínculo, o catálogo é vazio (fail-closed).
    admin();
    Paciente::factory()->create(['nome' => 'Paciente Fictício']);
    $soFila = usuarioCom(['lista_espera.ver', 'lista_espera.criar', 'agenda.ver_todos'], 'Recepção da Fila');
    $semAFlag = usuarioCom(['lista_espera.ver', 'lista_espera.criar'], 'Fila sem a flag');

    // ACT
    $resposta = $this->actingAs($soFila)->getJson('/api/agenda/selecao/pacientes?busca=Fict');
    trocarDeUsuario();
    $cego = $this->actingAs($semAFlag)->getJson('/api/agenda/selecao/pacientes?busca=Fict');

    // ASSERT — só o nome, nunca o cadastro; e sem a flag, nada
    $resposta->assertOk();
    expect($resposta->json('0'))->toHaveKeys(['id', 'nome'])
        ->and($resposta->json('0'))->not->toHaveKey('cpf');
    $cego->assertOk()->assertJsonCount(0);
});

it('deve recusar esperar por especialidade que o profissional não atende', function () {
    // ARRANGE — a fila NÃO guarda um desejo que a clínica não pode realizar.
    //
    // "Psicologia com a Carla", quando a Carla é de Terapia Ocupacional, cria uma entrada que
    // o AGENDAMENTO sempre recusaria ("O profissional não atende a esta especialidade"). A
    // recepcionista só descobre na hora do encaixe — e tem de trocar em silêncio o que a
    // família pediu. É o botão que promete o que o servidor nega, um nível abaixo: aqui é o
    // DADO que promete.
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $profissional = Profissional::factory()->create();
    $especialidadeQueEleAtende = Especialidade::factory()->create();
    $especialidadeQueEleNaoAtende = Especialidade::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidadeQueEleAtende->id,
    ]);

    // ACT + ASSERT — o par impossível é recusado na chave que a tela mostra
    $this->actingAs($adminDaClinica)->postJson('/api/lista-espera', [
        'paciente_id' => $paciente->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidadeQueEleNaoAtende->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('especialidade_id');

    // ...e o par possível passa
    $this->actingAs($adminDaClinica)->postJson('/api/lista-espera', [
        'paciente_id' => $paciente->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidadeQueEleAtende->id,
    ])->assertCreated();
});

it('deve avaliar o par no ESTADO FINAL — o PUT parcial não burla', function () {
    // ARRANGE: trocar SÓ a especialidade num PUT parcial deixaria o profissional antigo
    // pendurado num par impossível se a checagem olhasse apenas o payload.
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $profissional = Profissional::factory()->create();
    $atende = Especialidade::factory()->create();
    $naoAtende = Especialidade::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $atende->id,
    ]);

    $id = $this->actingAs($adminDaClinica)->postJson('/api/lista-espera', [
        'paciente_id' => $paciente->id,
        'profissional_id' => $profissional->id,
        'especialidade_id' => $atende->id,
    ])->assertCreated()->json('id');

    // ACT + ASSERT — só a especialidade muda; o profissional vem do banco
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/lista-espera/{$id}", [
        'paciente_id' => $paciente->id,
        'especialidade_id' => $naoAtende->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('especialidade_id');
});

it('deve pousar a recusa do par impossível no campo que o usuário MEXEU', function () {
    // ARRANGE — re-review M-3 (rodada 3): a TELA manda sempre as duas chaves; a recusa
    // decidida por presença de chave pousava no campo intacto. Decide-se pelo que MUDOU.
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $quemAtende = Profissional::factory()->create();
    $quemNaoAtende = Profissional::factory()->create();
    $especialidade = Especialidade::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $quemAtende->id,
        'especialidade_id' => $especialidade->id,
    ]);

    $id = $this->actingAs($adminDaClinica)->postJson('/api/lista-espera', [
        'paciente_id' => $paciente->id,
        'profissional_id' => $quemAtende->id,
        'especialidade_id' => $especialidade->id,
    ])->assertCreated()->json('id');

    // ACT + ASSERT — payload no formato da TELA (as duas chaves), só o profissional muda:
    // o erro pousa no profissional, o campo que ele de fato mexeu
    $this->actingAs($adminDaClinica)->putJsonComVersao("/api/lista-espera/{$id}", [
        'paciente_id' => $paciente->id,
        'profissional_id' => $quemNaoAtende->id,
        'especialidade_id' => $especialidade->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('profissional_id');
});

it('deve aceitar espera SEM profissional — a fila é uma espera, não um agendamento', function () {
    // ARRANGE: "quero fonoaudiologia, com quem der" é o caso mais comum da fila
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $especialidade = Especialidade::factory()->create();

    // ACT + ASSERT
    $this->actingAs($adminDaClinica)->postJson('/api/lista-espera', [
        'paciente_id' => $paciente->id,
        'especialidade_id' => $especialidade->id,
    ])->assertCreated();
});
