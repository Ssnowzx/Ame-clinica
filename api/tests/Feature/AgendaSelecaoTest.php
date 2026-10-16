<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\Feriado;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Clinica\ResumoDoPaciente;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\Models\Role;

/**
 * Catálogos do formulário sob a permissão da AGENDA (T-aes-08 / P-01) e o
 * tamanho REAL da série (T-aes-03 / P-02).
 */

/** Usuário que só marca: agenda.*, sem pacientes.ver/tratamentos.ver/status. */
function usuarioSoDaAgenda(): Usuario
{
    $adminDaClinica = admin();
    $recepcao = Role::create(['name' => 'Recepção Fictícia']);
    // `agenda.ver_todos` (D11): a recepção é um papel EXISTENTE — o backfill (SEC-VP-02) concede a
    // flag a todo papel, então ela segue PLANA (vê a agenda inteira). Sem a flag,
    // um papel novo/esquecido sem vínculo cairia no fail-closed, que não é o caso da recepção.
    $recepcao->givePermissionTo(['agenda.ver', 'agenda.criar', 'agenda.editar', 'agenda.excluir', 'agenda.ver_todos']);
    $usuario = Usuario::factory()->create();
    $usuario->syncRoles([$recepcao]);

    return $usuario;
}

/** Troca de identidade autenticada dentro do mesmo teste. */
function comoRecepcao(): Usuario
{
    $usuario = usuarioSoDaAgenda();
    test()->flushSession();
    app('auth')->forgetGuards();

    return $usuario;
}

// ── Permissão (P-01) ────────────────────────────────────────────────────────

it('deve entregar os catálogos do formulário a quem só tem permissão de agenda', function () {
    // ARRANGE — sem pacientes.ver, sem tratamentos.ver, sem status_agendamento.ver
    $recepcao = comoRecepcao();

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao');

    // ASSERT — marcar não pode exigir a permissão do cadastro de pacientes
    $resposta->assertOk()
        ->assertJsonStructure(['profissionais', 'especialidades', 'salas', 'equipamentos', 'medicos', 'status']);
});

it('deve entregar à GRADE o que ela precisa desenhar, só com agenda.ver', function () {
    // ARRANGE — o NÍVEL MÍNIMO: `agenda.ver` e mais nada. É o teste que o admin nunca faz — e
    // por isso o defeito nasceu: a grade buscava `/profissionais`, `/especialidades` e
    // `/feriados`, cada um atrás da permissão do SEU módulo, e este usuário levava três 403 e
    // via "Não foi possível carregar a agenda".
    admin();
    $soVeAgenda = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Só Vê Agenda'); // papel existente = plano (backfill D11)
    $especialidade = Especialidade::factory()->create(['cor' => '#A85550']);
    $profissional = Profissional::factory()
        ->comHorarios([1 => [['inicio' => '08:00', 'fim' => '12:00']]])
        ->create(['obs' => 'Atende só pela manhã']);
    $profissional->especialidades()->attach($especialidade->id);
    $feriado = Feriado::factory()->create();
    // um profissional DESLIGADO não desenha coluna nenhuma — e essa garantia passou a ser do
    // SERVIDOR: a grade não filtra mais (um filtro que nunca filtra é código morto que mente
    // sobre o que garante). A promessa não sumiu — MUDOU DE CAMADA, e é provada aqui.
    $desligado = Profissional::factory()->create(['ativo' => false]);

    // ACT
    $resposta = $this->actingAs($soVeAgenda)->getJson('/api/agenda/selecao');

    // ASSERT — tudo o que a grade PINTA vem sob a permissão da agenda
    $resposta->assertOk();
    expect(collect($resposta->json('profissionais'))->firstWhere('id', $desligado->id))->toBeNull();
    $daGrade = collect($resposta->json('profissionais'))->firstWhere('id', $profissional->id);
    expect($daGrade['horarios'])->toBe(['1' => [['inicio' => '08:00', 'fim' => '12:00']]])
        ->and($daGrade['obs'])->toBe('Atende só pela manhã')            // a linha da lista lateral
        ->and($daGrade['especialidades'][0]['id'])->toBe($especialidade->id)
        ->and(collect($resposta->json('especialidades'))->firstWhere('id', $especialidade->id)['cor'])
        ->toBe('#A85550')                                                // a cor do card
        ->and(collect($resposta->json('feriados'))->firstWhere('id', $feriado->id))->not->toBeNull();
});

it('deve manter o feriado DESATIVADO fora da seleção', function () {
    // ARRANGE — a promessa "feriado desativado não pinta dia" MUDOU DE CAMADA nesta change (a
    // grade não filtra mais; quem filtra é o servidor). Quando a promessa muda de camada, a
    // guarda muda junto — senão a garantia some em silêncio. O gate pegou justamente isto: o
    // profissional ganhou o teste do `$desligado`; o feriado não ganhou nada.
    admin();
    $soVeAgenda = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Só Vê Agenda'); // papel existente = plano (backfill D11)
    $vigente = Feriado::factory()->create(['nome' => 'Feriado Fictício Vigente']);
    $desativado = Feriado::factory()->create(['nome' => 'Feriado Fictício Desativado', 'ativo' => false]);

    // ACT
    $resposta = $this->actingAs($soVeAgenda)->getJson('/api/agenda/selecao');

    // ASSERT
    $resposta->assertOk();
    $feriados = collect($resposta->json('feriados'));
    expect($feriados->firstWhere('id', $vigente->id))->not->toBeNull()
        ->and($feriados->firstWhere('id', $desativado->id))->toBeNull();
});

it('deve NEGAR a observação do profissional a quem só administra a FILA', function () {
    // ARRANGE — a `obs` é da GRADE ("Atende só pela manhã"), mas é TEXTO LIVRE da clínica
    // ("em licença até março"). Ela caía do lado errado do `if` e saía de brinde para quem só
    // administra a fila — o privilege creep que o docblock desta classe (SEC-LE-07) proíbe.
    admin();
    $daFila = usuarioCom(['lista_espera.criar', 'agenda.ver_todos'], 'Só a Fila'); // papel existente = plano (backfill D11)
    Profissional::factory()->create(['obs' => 'Em licença até março']);

    // ACT
    $resposta = $this->actingAs($daFila)->getJson('/api/agenda/selecao');

    // ASSERT — ele escolhe o profissional (id, nome, janela), mas não lê a observação
    $resposta->assertOk();
    $profissional = $resposta->json('profissionais.0');
    expect($profissional)->toHaveKey('nome')
        ->and($profissional)->not->toHaveKey('obs')
        // `horarios` cruza sob o MESMO `if ($daAgenda)` da `obs`: pinar aqui garante que a fila
        // nunca o receba se aquele portão erodir
        ->and($profissional)->not->toHaveKey('horarios')
        // JSON_UNESCAPED_UNICODE, senão `licença` vira `licen\u00e7a` e o assert NUNCA falha —
        // teatro de cobertura no ponto exato do achado (re-review r10). O padrão veio do teste do
        // conselho (`12345`), que só funciona porque é ASCII.
        ->and(json_encode($resposta->json(), JSON_UNESCAPED_UNICODE))->not->toContain('licença');
});

it('deve NEGAR o cadastro do profissional pela porta da agenda', function () {
    // ARRANGE — a seleção é a porta da EXIBIÇÃO. Se ela entregasse o cadastro, `agenda.ver`
    // viraria `profissionais.ver` de brinde — privilege creep contra o princípio que abriu a rota.
    admin();
    $soVeAgenda = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Só Vê Agenda'); // papel existente = plano (backfill D11)
    Profissional::factory()->create(['conselho' => 'CRFa', 'num_conselho' => '12345']);

    // ACT
    $resposta = $this->actingAs($soVeAgenda)->getJson('/api/agenda/selecao');

    // ASSERT — nem conselho, nem CBO, nem contato
    $resposta->assertOk();
    $profissional = $resposta->json('profissionais.0');
    expect($profissional)->not->toHaveKey('conselho')
        ->and($profissional)->not->toHaveKey('num_conselho')
        ->and($profissional)->not->toHaveKey('cbos_id')
        ->and(json_encode($resposta->json('profissionais')))->not->toContain('12345');
});

it('deve entregar a flag desconta_sessao junto do status', function () {
    // ARRANGE — sem a flag, a tela não sabe quando confirmar (§2) e adivinhar
    // seria pior do que não oferecer
    $recepcao = comoRecepcao();

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao');

    // ASSERT
    $finalizado = collect($resposta->json('status'))->firstWhere('nome', 'Finalizado');
    expect($finalizado['desconta_sessao'])->toBeTrue();
    expect($finalizado['tipo'])->toBe('check');
});

it('deve entregar a flag marca_falta junto do status', function () {
    // ARRANGE — o painel deriva dela que um status de falta não oferece "Iniciar
    // atendimento" (Decisão 2b): a regra é DADO (§13), não if/else de tela.
    // "Não Compareceu" é um default semeado com marca_falta = true.
    $recepcao = comoRecepcao();

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao');

    // ASSERT
    $naoCompareceu = collect($resposta->json('status'))->firstWhere('nome', 'Não Compareceu');
    expect($naoCompareceu['marca_falta'])->toBeTrue();
    // um status comum não marca falta — a flag distingue, não é constante
    $emAberto = collect($resposta->json('status'))->firstWhere('nome', 'Em Aberto');
    expect($emAberto['marca_falta'])->toBeFalse();
});

it('deve negar os catálogos a quem não tem permissão de agenda', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $semNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semNivel)->getJson('/api/agenda/selecao')->assertForbidden();
});

// ── Busca de paciente: só o nome (LGPD) ─────────────────────────────────────

it('deve buscar paciente pelo nome sem vazar dado do cadastro', function () {
    // ARRANGE
    $recepcao = comoRecepcao();
    $paciente = Paciente::factory()->create(['nome' => 'Paciente Fictício Especial']);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?busca=Especial');

    // ASSERT — id + nome e NADA MAIS: nem nascimento, nem necessidade (saúde),
    // nem cpf/responsáveis/contatos
    $resposta->assertOk()->assertJsonCount(1);
    expect(array_keys($resposta->json('0')))->toBe(['id', 'nome', 'nome_social']);
    expect($resposta->json('0.id'))->toBe($paciente->id);
});

it('deve exigir dois caracteres na busca', function () {
    // ARRANGE — `?busca=a` viraria varredura do cadastro de menores
    $recepcao = comoRecepcao();

    // ACT + ASSERT
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?busca=a')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes')->assertStatus(422);
});

// ── Modo LISTA e RECENTES: escolher sem digitar (change busca-de-paciente-com-lista) ──

it('deve listar pacientes ativos por página, sem termo nenhum', function () {
    // ARRANGE — reconhecer numa lista é mais barato que lembrar um nome
    $recepcao = comoRecepcao();
    Paciente::factory()->create(['nome' => 'Ana Fictícia']);
    Paciente::factory()->create(['nome' => 'Bruno Fictício']);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=1');

    // ASSERT — mesma minimização da busca: id + nome e nada mais
    $resposta->assertOk();
    expect($resposta->json())->not->toBeEmpty();
    expect(array_keys($resposta->json('0')))->toBe(['id', 'nome', 'nome_social']);
    expect($resposta->json('0.nome'))->toBe('Ana Fictícia'); // ordem alfabética
});

it('deve paginar a lista sem repetir nem pular homônimo', function () {
    // ARRANGE — o teto por página é 20; homônimos existem nesta clínica, e sem desempate
    // estável o offset repete uma criança numa página e some com outra na seguinte
    $recepcao = comoRecepcao();
    Paciente::query()->delete();
    Paciente::factory()->count(25)->create(['nome' => 'Homônimo Fictício']);

    // ACT
    $primeira = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=1');
    $segunda = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=2');

    // ASSERT
    $primeira->assertOk()->assertJsonCount(20);
    $segunda->assertOk()->assertJsonCount(5);
    $ids = array_merge(array_column($primeira->json(), 'id'), array_column($segunda->json(), 'id'));
    expect($ids)->toHaveCount(25);
    expect(array_unique($ids))->toHaveCount(25);
});

it('deve manter o paciente INATIVO fora da lista', function () {
    // ARRANGE — rolar o catálogo não pode trazer de volta quem a clínica desligou
    $recepcao = comoRecepcao();
    Paciente::query()->delete();
    Paciente::factory()->create(['nome' => 'Desligada Fictícia', 'ativo' => false]);
    Paciente::factory()->create(['nome' => 'Ativa Fictícia', 'ativo' => true]);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=1');

    // ASSERT
    $resposta->assertOk()->assertJsonCount(1);
    expect($resposta->json('0.nome'))->toBe('Ativa Fictícia');
});

it('deve não vazar cadastro do menor nos modos lista e recentes', function () {
    // ARRANGE — a proteção não pode depender do modo pelo qual o nome foi pedido
    $recepcao = comoRecepcao();
    Paciente::query()->delete();
    $paciente = Paciente::factory()->create([
        'nome' => 'Sigilo Fictício',
        'cpf' => '52998224725',
        'necessidade' => 'sigilo-ficticio-x9',
    ]);
    Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'inicio' => now()->subDay(),
        'status_id' => StatusAgendamento::query()->value('id'),
    ]);

    // ACT
    $lista = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=1');
    $recentes = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=1');

    // ASSERT
    foreach ([$lista, $recentes] as $resposta) {
        $resposta->assertOk();
        expect(array_keys($resposta->json('0')))->toBe(['id', 'nome', 'nome_social']);
        semVazamento($resposta->json(), 'sigilo-ficticio-x9');
        semVazamento($resposta->json(), '52998224725');
    }
});

it('deve ordenar os recentes pelo movimento, do mais novo para o mais antigo', function () {
    // ARRANGE — a seção existe para o caso "é a criança de agora há pouco"
    $recepcao = comoRecepcao();
    Paciente::query()->delete();
    $status = StatusAgendamento::query()->value('id');
    $antiga = Paciente::factory()->create(['nome' => 'Aaa Fictícia']);   // 1ª no alfabeto
    $recente = Paciente::factory()->create(['nome' => 'Zzz Fictícia']);  // última no alfabeto
    Agendamento::factory()->create(['paciente_id' => $antiga->id, 'inicio' => now()->subDays(30), 'status_id' => $status]);
    Agendamento::factory()->create(['paciente_id' => $recente->id, 'inicio' => now()->subHours(2), 'status_id' => $status]);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=1');

    // ASSERT — movimento manda, não o alfabeto
    $resposta->assertOk()->assertJsonCount(2);
    expect($resposta->json('0.nome'))->toBe('Zzz Fictícia');
    expect($resposta->json('1.nome'))->toBe('Aaa Fictícia');
});

it('deve deixar fora dos recentes quem não tem movimento na janela', function () {
    // ARRANGE — sem janela, a consulta agrupa a tabela inteira para devolver oito nomes
    $recepcao = comoRecepcao();
    Paciente::query()->delete();
    $status = StatusAgendamento::query()->value('id');
    $foraDaJanela = Paciente::factory()->create(['nome' => 'Antiga Fictícia']);
    $semAgenda = Paciente::factory()->create(['nome' => 'Nunca Fictícia']);
    Agendamento::factory()->create(['paciente_id' => $foraDaJanela->id, 'inicio' => now()->subDays(120), 'status_id' => $status]);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=1');

    // ASSERT
    $resposta->assertOk()->assertJsonCount(0);
    expect($semAgenda->exists)->toBeTrue(); // existe no cadastro; só não é "recente"
});

it('deve manter o bloqueio de agenda fora dos recentes', function () {
    // ARRANGE — bloqueio é evento SEM paciente; agrupar por null traria linha fantasma
    $recepcao = comoRecepcao();
    Paciente::query()->delete();
    Agendamento::factory()->create([
        'paciente_id' => null,
        'inicio' => now()->subHour(),
        'status_id' => StatusAgendamento::query()->value('id'),
    ]);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=1');

    // ASSERT
    $resposta->assertOk()->assertJsonCount(0);
});

it('deve escopar os recentes ao vínculo do profissional (D11)', function () {
    // ARRANGE — o Profissional da matriz AP-10 é ESCOPADO (sem `agenda.ver_todos`): ele lê
    // MOVIMENTO só das próprias crianças. Nome ele já alcança por 2 letras; "esteve na clínica
    // há menos tempo" é outra classe de dado (parecer SEC-BPL-01).
    $adminDaClinica = admin();
    $status = StatusAgendamento::query()->value('id');
    Paciente::query()->delete();
    $meuPaciente = Paciente::factory()->create(['nome' => 'Criança do Vínculo']);
    $pacienteDoColega = Paciente::factory()->create(['nome' => 'Criança do Colega']);

    $eu = Profissional::factory()->create();
    $colega = Profissional::factory()->create();
    Agendamento::factory()->create(['paciente_id' => $meuPaciente->id, 'profissional_id' => $eu->id, 'inicio' => now()->subDay(), 'status_id' => $status]);
    Agendamento::factory()->create(['paciente_id' => $pacienteDoColega->id, 'profissional_id' => $colega->id, 'inicio' => now()->subHour(), 'status_id' => $status]);

    $papel = Role::create(['name' => 'Profissional Fictício Escopado']);
    $papel->givePermissionTo(['agenda.ver', 'agenda.criar']); // SEM ver_todos
    $usuario = Usuario::factory()->create(['profissional_id' => $eu->id]);
    $usuario->syncRoles([$papel]);

    // ACT
    $resposta = $this->actingAs($usuario)->getJson('/api/agenda/selecao/pacientes?recentes=1');

    // ASSERT — só a criança do próprio vínculo, mesmo a do colega sendo MAIS recente
    $resposta->assertOk()->assertJsonCount(1);
    expect($resposta->json('0.nome'))->toBe('Criança do Vínculo');
});

it('deve devolver recentes VAZIO para papel escopado sem vínculo (fail-closed)', function () {
    // ARRANGE — a regra é GATED-PELA-FLAG: sem a flag e sem vínculo, `nenhum` (SEC-VP-02)
    $adminDaClinica = admin(); // idem: sem contexto, a factory não sabe de qual clínica é a linha
    Paciente::query()->delete();
    $paciente = Paciente::factory()->create(['nome' => 'Criança Qualquer']);
    Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'inicio' => now()->subHour(),
        'status_id' => StatusAgendamento::query()->value('id'),
    ]);

    $papel = Role::create(['name' => 'Escopado Sem Vínculo Fictício']);
    $papel->givePermissionTo(['agenda.ver']);
    $usuario = Usuario::factory()->create(['profissional_id' => null]);
    $usuario->syncRoles([$papel]);

    // ACT + ASSERT — os QUATRO modos fecham (rodada 4 de `vinculo-previo-para-agendar`, `SEC-VP-36`):
    // sem vínculo e sem flag, o catálogo é vazio — a busca por nome deixou de ser plana
    $this->actingAs($usuario)->getJson('/api/agenda/selecao/pacientes?recentes=1')->assertOk()->assertJsonCount(0);
    $this->actingAs($usuario)->getJson('/api/agenda/selecao/pacientes?busca=Criança')->assertOk()->assertJsonCount(0);
});

it('deve limitar os recentes ao teto da seção', function () {
    // ARRANGE — a seção é um ATALHO, não um segundo catálogo: sem teste, mexer no teto
    // (ou perdê-lo num refactor) não derrubaria nada (achado CR-BPL-05 item 4)
    $recepcao = comoRecepcao();
    $status = StatusAgendamento::query()->value('id');
    Paciente::query()->delete();
    foreach (range(1, 12) as $indice) {
        $paciente = Paciente::factory()->create(['nome' => "Recente Fictícia {$indice}"]);
        Agendamento::factory()->create(['paciente_id' => $paciente->id, 'inicio' => now()->subMinutes($indice), 'status_id' => $status]);
    }

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=1');

    // ASSERT — as 8 de movimento mais recente, e só elas
    $resposta->assertOk()->assertJsonCount(8);
    expect($resposta->json('0.nome'))->toBe('Recente Fictícia 1');
});

it('deve não gastar slot dos recentes com criança desligada', function () {
    // ARRANGE — filtrar `ativo` DEPOIS do teto faria a desligada consumir vaga e sumir: a
    // seção encolheria sem explicação, e o tamanho dela contaria as altas (SEC-BPL-04)
    $recepcao = comoRecepcao();
    $status = StatusAgendamento::query()->value('id');
    Paciente::query()->delete();
    // 8 desligadas com movimento MAIS recente que a ativa — se o `ativo` viesse depois do
    // `limit(8)`, elas tomariam as oito vagas e a resposta viria vazia
    foreach (range(1, 8) as $indice) {
        $desligada = Paciente::factory()->create(['nome' => "Desligada Fictícia {$indice}", 'ativo' => false]);
        Agendamento::factory()->create(['paciente_id' => $desligada->id, 'inicio' => now()->subMinutes($indice), 'status_id' => $status]);
    }
    $ativa = Paciente::factory()->create(['nome' => 'Ativa Fictícia', 'ativo' => true]);
    Agendamento::factory()->create(['paciente_id' => $ativa->id, 'inicio' => now()->subDay(), 'status_id' => $status]);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=1');

    // ASSERT
    $resposta->assertOk()->assertJsonCount(1);
    expect($resposta->json('0.nome'))->toBe('Ativa Fictícia');
});

it('deve recusar modo ambíguo, vazio ou além do teto de páginas', function () {
    // ARRANGE — o modo é sempre EXPLÍCITO: nenhum default que o cliente descobre por acidente
    $recepcao = comoRecepcao();

    // ACT + ASSERT
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=1&busca=ana')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=1&recentes=1')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=1&id=5')->assertStatus(422);
    // presente-e-vazio não escolhe caminho (o invariante do CR-AR-01, agora com quatro modos)
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=')->assertStatus(422);
    // ...e a forma que ORIGINOU o CR-AR-01: modo VÁLIDO ao lado de um modo vazio. Quem barra é
    // o `filled`, não o `prohibits` (que só dispara com o outro campo preenchido) — sem estes
    // casos, trocar o `filled` amanhã não derrubaria teste nenhum (parecer SEC-BPL-08)
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?busca=an&pagina=')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?busca=an&recentes=')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?id=1&pagina=')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?id=1&recentes=')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=1&recentes=')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=1&pagina=')->assertStatus(422);
    // `?recentes=0` não é "me dê a lista" — é ambiguidade, e ambiguidade vira 422
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?recentes=0')->assertStatus(422);
    // OFFSET gigante é consulta cara para devolver nada
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=99999')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?pagina=0')->assertStatus(422);
});

it('deve exigir a permissão da rota também nos modos novos', function () {
    // ARRANGE — listar sem digitar não pode ser a porta dos fundos da rota
    $semNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($semNivel)->getJson('/api/agenda/selecao/pacientes?pagina=1')->assertForbidden();
    $this->actingAs($semNivel)->getJson('/api/agenda/selecao/pacientes?recentes=1')->assertForbidden();
});

it('deve tratar o curinga da busca como literal', function () {
    // ARRANGE
    $recepcao = comoRecepcao();
    Paciente::factory()->count(3)->create();

    // ACT — `%%` varreria tudo se o curinga não fosse escapado
    $resposta = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?busca=%%');

    // ASSERT
    $resposta->assertOk()->assertJsonCount(0);
});

// ── Leitura por id: NOMEAR quem a tela já conhece (modo retorno) ────────────

it('deve nomear o paciente por id sem vazar dado do cadastro', function () {
    // ARRANGE — a tela chegou com o id (o nome do menor não viaja na URL, gatilho LOG)
    $recepcao = comoRecepcao();
    $paciente = Paciente::factory()->create(['nome' => 'Paciente Fictício Por Id']);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson("/api/agenda/selecao/pacientes?id={$paciente->id}");

    // ASSERT — a MESMA whitelist da busca, e nada além dela
    $resposta->assertOk()->assertJsonCount(1);
    expect(array_keys($resposta->json('0')))->toBe(['id', 'nome', 'nome_social']);
    expect($resposta->json('0.id'))->toBe($paciente->id);
});

it('deve manter a camada 1 da minimização na leitura por id', function () {
    // ARRANGE — a asserção de whitelist acima olha o JSON, que é o PRODUTO das duas camadas:
    // apagar o `ResumoDoPaciente::CAMPOS` do `get()` a deixa verde, porque o serializador sozinho
    // ainda entrega 3 chaves — enquanto o cadastro INTEIRO do menor (cpf, nascimento,
    // `necessidade` — art. 11) passa a ser hidratado na memória do processo, de onde vaza para
    // log, dump e payload de exceção. É o buraco SEC-TR-18. A `WhitelistDoMenorTest` não alcança:
    // ela casa `with('paciente')`/`load('paciente')` (o menor como RELAÇÃO), e aqui ele é a RAIZ.
    $recepcao = comoRecepcao();
    $paciente = Paciente::factory()->create(['nome' => 'Paciente Fictício Minimizado']);
    $atributosHidratados = [];
    Paciente::retrieved(function (Paciente $model) use (&$atributosHidratados) {
        $atributosHidratados = array_keys($model->getAttributes());
    });

    // ACT
    $this->actingAs($recepcao)
        ->getJson("/api/agenda/selecao/pacientes?id={$paciente->id}")
        ->assertOk();

    // ASSERT — o MODEL que voltou do banco tem SÓ a whitelist, não o cadastro
    expect($atributosHidratados)->toBe(ResumoDoPaciente::CAMPOS);
});

it('deve responder vazio para paciente INATIVO lido por id', function () {
    // ARRANGE — link antigo para uma criança desligada: o nome não pode voltar à tela
    $recepcao = comoRecepcao();
    $desligado = Paciente::factory()->create(['nome' => 'Paciente Fictício Desligado', 'ativo' => false]);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson("/api/agenda/selecao/pacientes?id={$desligado->id}");

    // ASSERT
    $resposta->assertOk();
    expect($resposta->json())->toBe([]);
});

it('deve responder vazio por id para inexistente', function () {
    // ARRANGE
    $recepcao = comoRecepcao();

    // ACT
    $porInexistente = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?id=999999');

    // ASSERT — vazio, nunca 4xx (não é oráculo de existência)
    $porInexistente->assertOk();
    expect($porInexistente->json())->toBe([]);
});

it('deve recusar id e busca na mesma requisição', function () {
    // ARRANGE — rota que escolhe em silêncio qual dos dois vale é rota que ninguém audita
    $recepcao = comoRecepcao();
    $paciente = Paciente::factory()->create(['nome' => 'Paciente Fictício Ambíguo']);

    // ACT + ASSERT
    $this->actingAs($recepcao)
        ->getJson("/api/agenda/selecao/pacientes?id={$paciente->id}&busca=Ambíguo")
        ->assertStatus(422);
});

it('deve recusar id VAZIO ao lado de uma busca — sem escolher o caminho em silêncio', function () {
    // ARRANGE — esta é a guarda do CONTRATO HTTP: a requisição ambígua é recusada, ponto.
    //
    // O que ela NÃO prova (e por isso está escrito aqui): hoje o 422 vem do
    // `ConvertEmptyStringsToNull` do stack global + a regra `integer`, então ela fica verde com ou
    // sem o `filled` do controller. O `filled` é o CINTO — ele torna o invariante local, para o dia
    // em que alguém mexer no middleware global. Quem vier consertar isto não pode concluir daqui
    // que a regra do controller está prendida (achados CR-AR-01 e CR-AR-15 do gate).
    //
    // O defeito que a ambiguidade causaria, se passasse: `isset('')` é true, a ação abandonaria a
    // busca por nome e consultaria `whereKey('')` — 200 com lista vazia para uma criança que
    // EXISTE. A recepção leria "nenhum resultado" e cadastraria a mesma criança de novo.
    $recepcao = comoRecepcao();
    Paciente::factory()->create(['nome' => 'Paciente Fictício Ambíguo']);

    // ACT + ASSERT — a requisição ambígua é RECUSADA, nunca resolvida por um dos dois caminhos
    $this->actingAs($recepcao)
        ->getJson('/api/agenda/selecao/pacientes?busca=Ambíguo&id=')
        ->assertStatus(422);
    $this->actingAs($recepcao)
        ->getJson('/api/agenda/selecao/pacientes?busca=&id=5')
        ->assertStatus(422);
});

it('deve recusar id que não é identificador', function () {
    // ARRANGE
    $recepcao = comoRecepcao();

    // ACT + ASSERT — `abc` e `0` nunca chegam à consulta
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?id=abc')->assertStatus(422);
    $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?id=0')->assertStatus(422);
});

it('deve negar a leitura por id a quem não tem permissão da rota', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $paciente = Paciente::factory()->create();
    $semNivel = Usuario::factory()->create();

    // ACT + ASSERT — nomear é tão gated quanto buscar
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semNivel)
        ->getJson("/api/agenda/selecao/pacientes?id={$paciente->id}")
        ->assertForbidden();
});

it('deve entregar só os tratamentos do paciente pedido', function () {
    // ARRANGE
    $recepcao = comoRecepcao();
    $tratamento = Tratamento::factory()->create();
    Tratamento::factory()->create(); // de outro paciente

    // ACT
    $resposta = $this->actingAs($recepcao)
        ->getJson("/api/agenda/selecao/tratamentos?paciente_id={$tratamento->paciente_id}");

    // ASSERT — com o que o formulário precisa para escolher, sem valores
    $resposta->assertOk()->assertJsonCount(1);
    expect(array_keys($resposta->json('0')))
        ->toBe(['id', 'especialidade_id', 'status', 'sessoes_total', 'sessoes_saldo', 'vencido']);
});

// ── Tamanho REAL da série (P-02) ────────────────────────────────────────────

it('deve entregar o tamanho da série mesmo além da janela visível', function () {
    // ARRANGE — série de 20 semanas; a grade na visão Dia enxerga UMA ocorrência
    $recepcao = comoRecepcao();
    $especialidade = Especialidade::factory()->create(['tempo_sessao' => 40]);
    $profissional = Profissional::factory()->create();
    DB::table('profissional_especialidade')->insert([
        'profissional_id' => $profissional->id,
        'especialidade_id' => $especialidade->id,
    ]);
    $paciente = Paciente::factory()->create();
    $inicio = agoraNaClinica()->copy()->addDay()->setTime(8, 0);

    $criacao = $this->actingAs($recepcao)->postJson('/api/agendamentos', [
        'inicio' => $inicio->format('Y-m-d H:i'),
        'profissional_id' => $profissional->id,
        'paciente_id' => $paciente->id,
        'especialidade_id' => $especialidade->id,
        'recorrencia' => ['ate' => $inicio->copy()->addWeeks(19)->format('Y-m-d')],
    ])->assertCreated();

    expect($criacao->json('criados'))->toBe(20);
    $primeiro = $criacao->json('agendamentos.0.id');

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson("/api/agendamentos/{$primeiro}/serie");

    // ASSERT — o dialog precisa DESTE número: contar pela grade diria "0 seguintes"
    $resposta->assertOk();
    expect($resposta->json('em_serie'))->toBeTrue();
    expect($resposta->json('total'))->toBe(20);
    expect($resposta->json('a_partir_deste'))->toBe(20); // alcance do DELETE em série
    expect($resposta->json('futuros'))->toBe(19);        // alcance do aplicar_na_serie
});

it('deve reportar agendamento avulso como fora de série', function () {
    // ARRANGE
    $recepcao = comoRecepcao();
    $agendamento = Agendamento::factory()->create([
        'status_id' => StatusAgendamento::query()->value('id'),
    ]);

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson("/api/agendamentos/{$agendamento->id}/serie");

    // ASSERT
    expect($resposta->json('em_serie'))->toBeFalse();
    expect($resposta->json('a_partir_deste'))->toBe(1);
});

// ── Marcador de cadastro INATIVO (change paciente-inativo-com-saida) ────────

/**
 * Papel PLANO (`agenda.ver_todos`) com a permissão do cadastro — a Secretaria da matriz AP-10.
 *
 * Plano de propósito: com papel escopado, o marcador viria desligado pelo **D11**, não pela
 * permissão, e o teste de "sem `pacientes.ver`" passaria mesmo com o portão da permissão
 * arrancado do controller (parecer SEC-PIS-02).
 */
function usuarioDaAgendaComCadastro(): Usuario
{
    return usuarioCom(
        ['agenda.ver', 'agenda.criar', 'agenda.ver_todos', 'pacientes.ver'],
        'Secretaria Fictícia',
    );
}

it('deve sinalizar cadastro INATIVO que casa com o termo a quem tem pacientes.ver', function () {
    // ARRANGE — a criança desligada NÃO entra na lista; o que muda é a tela poder dizer por quê
    admin();
    $secretaria = usuarioDaAgendaComCadastro();
    Paciente::factory()->create(['nome' => 'Paciente Fictício Valmiro', 'ativo' => false]);

    // ACT
    $resposta = $this->actingAs($secretaria)->getJson('/api/agenda/selecao/pacientes?busca=Valmiro');

    // ASSERT — lista vazia + o marcador, que é um bit: sem nome, sem id, sem contagem
    $resposta->assertOk()->assertJsonCount(0)->assertHeader('X-Pacientes-Inativos', '1');
    expect($resposta->getContent())->not->toContain('Valmiro');
});

it('NÃO deve sinalizar quando a busca tem resultado', function () {
    // ARRANGE — a pergunta "por que não achei?" não existe quando se achou
    admin();
    $secretaria = usuarioDaAgendaComCadastro();
    Paciente::factory()->create(['nome' => 'Paciente Fictício Valmiro', 'ativo' => true]);
    Paciente::factory()->create(['nome' => 'Paciente Fictício Valmiro Irmão', 'ativo' => false]);

    // ACT
    $resposta = $this->actingAs($secretaria)->getJson('/api/agenda/selecao/pacientes?busca=Valmiro');

    // ASSERT
    $resposta->assertOk()->assertJsonCount(1)->assertHeaderMissing('X-Pacientes-Inativos');
});

it('NÃO deve sinalizar quando o termo não casa com ninguém', function () {
    // ARRANGE — o marcador é emitido SÓ no caso verdadeiro; nunca `: 0` (SEC-PIS-03)
    admin();
    $secretaria = usuarioDaAgendaComCadastro();
    Paciente::factory()->create(['nome' => 'Paciente Fictício Outro', 'ativo' => false]);

    // ACT
    $resposta = $this->actingAs($secretaria)->getJson('/api/agenda/selecao/pacientes?busca=Valmiro');

    // ASSERT
    $resposta->assertOk()->assertJsonCount(0)->assertHeaderMissing('X-Pacientes-Inativos');
});

it('deve responder a quem NÃO tem pacientes.ver exatamente como antes — corpo e cabeçalhos', function () {
    // ARRANGE — papel PLANO sem `pacientes.ver` (a recepção que só marca). Quem não pode abrir a
    // lista de inativos não pode descobrir, digitando nomes, que uma criança já foi paciente desta
    // clínica: "existe inativo com esse nome" tem de ser indistinguível de "não existe ninguém"
    // (SEC-VP-33).
    $recepcao = comoRecepcao();
    Paciente::factory()->create(['nome' => 'Paciente Fictício Valmiro', 'ativo' => false]);

    // ACT — o termo que casa com a criança desligada, e um que não casa com ninguém
    $comInativo = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?busca=Valmiro');
    $semNinguem = $this->actingAs($recepcao)->getJson('/api/agenda/selecao/pacientes?busca=Zzzzzz');

    // ASSERT — as duas respostas são IGUAIS entre si: corpo E conjunto de cabeçalhos. Comparar só
    // o corpo, ou só a ausência de UM cabeçalho, deixaria passar um marcador que viesse por outro
    // nome — e a promessa da spec é indistinguibilidade, não ausência de um header conhecido.
    // `Date` sai da comparação porque muda entre duas requisições por natureza.
    $comInativo->assertOk()->assertHeaderMissing('X-Pacientes-Inativos');
    $semNinguem->assertOk()->assertHeaderMissing('X-Pacientes-Inativos');
    expect($comInativo->getContent())->toBe($semNinguem->getContent());

    // `date`, `set-cookie` e o contador do rate limit variam entre DUAS requisições por natureza
    // (relógio, token de sessão cifrado, e um decremento que não depende do que foi buscado): o
    // NOME deles entra na comparação, o valor vira um marcador fixo. Assim o teste pega um
    // cabeçalho novo — com qualquer nome — sem falhar por ruído.
    $volateis = ['date', 'set-cookie', 'x-ratelimit-remaining'];
    $comparavel = fn ($resposta): array => collect($resposta->headers->all())
        ->map(fn (array $valores, string $nome): array => in_array($nome, $volateis, true)
            ? ['<varia entre requisições>']
            : $valores)
        ->sortKeys()
        ->all();
    expect($comparavel($comInativo))->toBe($comparavel($semNinguem));
});

it('NÃO deve nem consultar o inativo para quem não tem pacientes.ver (canal de tempo)', function () {
    // ARRANGE — a ORDEM das condições é a proteção: se o `EXISTS` roda antes da checagem de
    // permissão, o TEMPO de resposta passa a depender de o termo casar com uma criança desligada,
    // e a recusa cega vira oráculo pelo relógio (SEC-PIS-01). A prova é o número de consultas à
    // tabela de pacientes — as demais (sessão, permissões) variam com o aquecimento do cache e
    // não dizem nada sobre esta rota.
    $recepcao = comoRecepcao();
    Paciente::factory()->create(['nome' => 'Paciente Fictício Valmiro', 'ativo' => false]);

    $sqls = [];
    DB::listen(function ($consulta) use (&$sqls): void {
        $sqls[] = $consulta->sql;
    });

    $consultasDePaciente = function (string $termo) use ($recepcao, &$sqls): int {
        $sqls = [];
        $this->actingAs($recepcao)->getJson("/api/agenda/selecao/pacientes?busca={$termo}")->assertOk();

        return count(array_filter($sqls, fn (string $sql): bool => str_contains($sql, 'from `pacientes`')));
    };

    // aquece sessão e cache de permissões: sem isto a PRIMEIRA requisição do teste carrega o
    // usuário e as permissões, e a diferença medida seria o aquecimento, não o marcador
    $consultasDePaciente('Aquecimento');

    // ACT
    $comInativo = $consultasDePaciente('Valmiro');
    $semNinguem = $consultasDePaciente('Zzzzzz');

    // ASSERT — o mesmo trabalho nos dois casos, e é UMA consulta (a busca), não duas
    expect($comInativo)->toBe($semNinguem, "consultas em pacientes: com inativo={$comInativo}, sem ninguém={$semNinguem}");
    expect($comInativo)->toBe(1);
});

it('deve limitar o marcador ao escopo do vínculo (D11)', function () {
    // ARRANGE — profissional escopado COM `pacientes.ver`: só pode ser sinalizado sobre crianças
    // que ele já atende. A desligada aqui nunca passou por ele.
    $adminDaClinica = admin();
    Paciente::factory()->create(['nome' => 'Paciente Fictício Valmiro', 'ativo' => false]);
    $profissional = Profissional::factory()->create();
    $escopado = usuarioEscopadoEm($profissional, ['pacientes.ver']);

    // ACT
    $resposta = $this->actingAs($escopado)->getJson('/api/agenda/selecao/pacientes?busca=Valmiro');

    // ASSERT — como se a criança não existisse
    $resposta->assertOk()->assertJsonCount(0)->assertHeaderMissing('X-Pacientes-Inativos');
});

it('NÃO deve sinalizar nos modos que não são busca por texto', function () {
    // ARRANGE — o marcador responde à pergunta "por que a BUSCA não achou?"; ela não existe na
    // leitura por id, na lista paginada nem nos recentes
    admin();
    $secretaria = usuarioDaAgendaComCadastro();
    $inativo = Paciente::factory()->create(['nome' => 'Paciente Fictício Valmiro', 'ativo' => false]);

    // ACT + ASSERT
    $this->actingAs($secretaria)->getJson("/api/agenda/selecao/pacientes?id={$inativo->id}")
        ->assertOk()->assertHeaderMissing('X-Pacientes-Inativos');
    $this->actingAs($secretaria)->getJson('/api/agenda/selecao/pacientes?pagina=1')
        ->assertOk()->assertHeaderMissing('X-Pacientes-Inativos');
    $this->actingAs($secretaria)->getJson('/api/agenda/selecao/pacientes?recentes=1')
        ->assertOk()->assertHeaderMissing('X-Pacientes-Inativos');
});

it('deve manter a seleção de pacientes fora do cache de disco', function () {
    // ARRANGE — nome de MENOR não fica no cache de uma máquina de balcão compartilhada
    // (SEC-PIS-08), a mesma política do anexo da conversa
    admin();
    $secretaria = usuarioDaAgendaComCadastro();

    // ACT
    $resposta = $this->actingAs($secretaria)->getJson('/api/agenda/selecao/pacientes?busca=Valmiro');

    // ASSERT
    expect($resposta->headers->get('Cache-Control'))->toContain('no-store');
    expect($resposta->headers->get('Cache-Control'))->toContain('private');
});
