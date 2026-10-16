<?php

use App\Models\Agendamento;
use App\Models\Especialidade;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\Tratamento;
use App\Support\Clinica\PendenciasDeRetorno;
use App\Support\Clinica\ResumoDoPaciente;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * A REGRA da pendência de retorno (change protocolo-de-pendencias) — dados 100% fictícios.
 *
 * Testa a FONTE ÚNICA direto: o bloco do centro e a fila `/pendencias` a consomem, então é
 * aqui que a definição fica presa. O contrato de não-divergência entre as duas superfícies
 * tem teste próprio (NotificacoesTest).
 */

/** Paciente com tratamento em andamento e saldo. */
function pacientePendente(string $nome, array $tratamento = []): Paciente
{
    $paciente = Paciente::factory()->create(['nome' => $nome]);
    Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'sessoes_total' => 10,
        ...$tratamento,
    ]);

    return $paciente;
}

/** Agendamento direto no banco (sem o boundary da agenda), no status dado. */
function ocorrencia(Paciente $paciente, StatusAgendamento $status, int $diasRelativos, string $tipo = 'atendimento'): Agendamento
{
    $quando = agoraNaClinica()->addDays($diasRelativos);

    return Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'tipo' => $tipo,
        'status_id' => $status->id,
        'inicio' => $quando->copy()->setTime(9, 0),
        'fim' => $quando->copy()->setTime(9, 40),
    ]);
}

/** A fila como o produto a calcula, para o escopo dado (default: plano). */
function fila(?Escopo $escopo = null): Collection
{
    return app(PendenciasDeRetorno::class)
        ->consulta($escopo ?? Escopo::plano(), agoraNaClinica()->toDateString())
        ->get();
}

function ocupaHorario(): StatusAgendamento
{
    return StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();
}

function naoOcupaHorario(): StatusAgendamento
{
    return StatusAgendamento::where('nome', 'Desmarcado pelo Profissional')->firstOrFail();
}

it('deve listar o paciente sem próximo agendamento além da janela', function () {
    // ARRANGE — última sessão há 45 dias (janela default 30), nada marcado à frente
    admin();
    $esquecido = pacientePendente('Criança Fictícia Esquecida');
    ocorrencia($esquecido, ocupaHorario(), -45);

    // ACT
    $pendentes = fila();

    // ASSERT — entra, com os dias contados desde a última ocorrência
    expect($pendentes)->toHaveCount(1)
        ->and($pendentes->first()->id)->toBe($esquecido->id);

    $item = app(PendenciasDeRetorno::class)->item($pendentes->first(), agoraNaClinica()->toDateString());
    expect($item['dias_sem_agendamento'])->toBe(45)
        ->and($item['ultima_ocorrencia_em'])->toBe(agoraNaClinica()->subDays(45)->toDateString());
});

it('deve resolver a pendência quando o agendamento futuro nasce, sem nenhum outro gesto', function () {
    // ARRANGE — paciente pendente
    admin();
    $paciente = pacientePendente('Criança Fictícia Remarcada');
    ocorrencia($paciente, ocupaHorario(), -45);
    expect(fila())->toHaveCount(1);

    // ACT — só o agendamento; nada é marcado como resolvido
    ocorrencia($paciente, ocupaHorario(), 3);

    // ASSERT
    expect(fila())->toHaveCount(0);
});

it('não deve listar quem tem sessão futura que ocupa horário', function () {
    // ARRANGE
    admin();
    $paciente = pacientePendente('Criança Fictícia Agendada');
    ocorrencia($paciente, ocupaHorario(), -45);
    ocorrencia($paciente, ocupaHorario(), 10);

    // ACT + ASSERT
    expect(fila())->toHaveCount(0);
});

it('deve listar quem só tem sessão futura DESMARCADA — a flag decide, não o nome', function () {
    // ARRANGE — o caso mais comum do mundo real: desmarcaram e ninguém remarcou.
    // `ocupa_horario = false` ⇒ o horário está livre ⇒ ninguém vai atender.
    admin();
    $paciente = pacientePendente('Criança Fictícia Desmarcada');
    ocorrencia($paciente, ocupaHorario(), -45);
    ocorrencia($paciente, naoOcupaHorario(), 10);

    // ACT + ASSERT
    expect(fila()->pluck('id')->all())->toBe([$paciente->id]);
});

it('não deve contar bloqueio de agenda como próxima sessão', function () {
    // ARRANGE — o filtro `tipo = 'atendimento'` de `ocorrencias()`. A primeira versão criava o
    // bloqueio com `paciente_id = null` e era TAUTOLÓGICA (achado do gate, r1): sem paciente, a
    // relação `Paciente::agendamentos()` nunca o alcança, então apagar o filtro `tipo` deixava o
    // teste verde. Aqui o bloqueio é FORÇADO com paciente (contorna o boundary, que proíbe o
    // par) só para provar que é o FILTRO — e não a invariante do AgendamentoService — que o
    // descarta.
    admin();
    $paciente = pacientePendente('Criança Fictícia Com Bloqueio');
    ocorrencia($paciente, ocupaHorario(), -45);
    $bloqueio = Agendamento::factory()->create([
        'paciente_id' => null,
        'tipo' => 'bloqueio',
        'status_id' => ocupaHorario()->id,
        'inicio' => agoraNaClinica()->addDays(5)->setTime(9, 0),
        'fim' => agoraNaClinica()->addDays(5)->setTime(9, 40),
    ]);
    $bloqueio->forceFill(['paciente_id' => $paciente->id])->saveQuietly();

    // ACT + ASSERT — o bloqueio futuro NÃO protege: só atendimento conta como próxima sessão
    expect(fila()->pluck('id')->all())->toBe([$paciente->id]);
});

it('não deve alarmar por pacote recém-vendido MESMO a quem já teve sessão', function () {
    // ARRANGE — o caso assimétrico que o gate (r1) encontrou. Duas crianças com o MESMO sinal
    // de engajamento (pacote vendido ontem): a que nunca foi agendada saía da fila, a que teve
    // uma sessão há 200 dias entrava no TOPO dizendo "200 dias", porque o `or` da condição (3)
    // curto-circuitava a guarda do pacote novo. Vender um pacote é a família na recepção.
    admin();
    $jaTeveSessao = pacientePendente('Criança Fictícia Com Sessão Antiga', [
        'data_inicio' => agoraNaClinica()->subDays(200)->toDateString(),
    ]);
    ocorrencia($jaTeveSessao, ocupaHorario(), -200);
    Tratamento::factory()->create([
        'paciente_id' => $jaTeveSessao->id,
        'sessoes_total' => 10,
        'data_inicio' => agoraNaClinica()->subDay()->toDateString(),
    ]);

    // ACT + ASSERT — a guarda vale para os DOIS ramos da âncora, não só para o "nunca agendado"
    expect(fila())->toHaveCount(0);
});

it('não deve listar tratamento sem saldo nem tratamento vencido', function () {
    // ARRANGE — os dois deixaram de pedir sessão, por motivos diferentes
    admin();
    $semSaldo = pacientePendente('Criança Fictícia Sem Saldo');
    $semSaldo->tratamentos()->update(['sessoes_realizadas' => 10]);
    ocorrencia($semSaldo, ocupaHorario(), -45);

    $vencido = pacientePendente('Criança Fictícia Com Pacote Vencido', [
        'data_inicio' => agoraNaClinica()->subDays(100)->toDateString(),
        'validade_dias' => 30,
    ]);
    ocorrencia($vencido, ocupaHorario(), -45);

    // ACT + ASSERT
    expect(fila())->toHaveCount(0);
});

it('deve listar o pacote vendido e NUNCA agendado, contando desde o início do tratamento', function () {
    // ARRANGE — o esquecimento mais grave: sem histórico, seria invisível sem o fallback
    admin();
    $nuncaAgendado = pacientePendente('Criança Fictícia Nunca Agendada', [
        'data_inicio' => agoraNaClinica()->subDays(60)->toDateString(),
    ]);

    // ACT
    $pendentes = fila();

    // ASSERT
    expect($pendentes->pluck('id')->all())->toBe([$nuncaAgendado->id]);
    $item = app(PendenciasDeRetorno::class)->item($pendentes->first(), agoraNaClinica()->toDateString());
    expect($item['dias_sem_agendamento'])->toBe(60)
        ->and($item['ultima_ocorrencia_em'])->toBeNull()
        ->and($item['inicio_tratamento_em'])->toBe(agoraNaClinica()->subDays(60)->toDateString());
});

it('não deve alarmar por pacote recém-vendido a quem nunca foi agendado', function () {
    // ARRANGE — a âncora é o pacote MAIS RECENTE (D4): vender ontem é engajamento,
    // não esquecimento — mesmo havendo um pacote antigo aberto
    admin();
    $paciente = pacientePendente('Criança Fictícia Com Pacote Novo', [
        'data_inicio' => agoraNaClinica()->subDays(90)->toDateString(),
    ]);
    Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'sessoes_total' => 10,
        'data_inicio' => agoraNaClinica()->subDay()->toDateString(),
    ]);

    // ACT + ASSERT
    expect(fila())->toHaveCount(0);
});

it('não deve afirmar nada sobre paciente sem âncora nenhuma', function () {
    // ARRANGE — pacote sem data_inicio e sem nenhuma sessão: não há de quando contar,
    // e o silêncio é o erro conservador
    admin();
    pacientePendente('Criança Fictícia Sem Âncora', ['data_inicio' => null]);

    // ACT + ASSERT
    expect(fila())->toHaveCount(0);
});

it('deve mudar o resultado quando a clínica aperta a janela', function () {
    // ARRANGE — 20 dias sem sessão: fora da janela default (30), dentro de uma de 15
    admin();
    $paciente = pacientePendente('Criança Fictícia Recente');
    ocorrencia($paciente, ocupaHorario(), -20);
    expect(fila())->toHaveCount(0);

    // ACT — a janela é DADO (§13), não código
    app(ConfiguracaoService::class)->set('agenda.pendencia_retorno_dias', 15);

    // ASSERT
    expect(fila()->pluck('id')->all())->toBe([$paciente->id]);
});

it('deve clampar a janela na LEITURA, mesmo com valor fora da faixa gravado por fora', function () {
    // ARRANGE — a faixa do catálogo protege o PUT, não o banco
    admin();
    $regra = app(PendenciasDeRetorno::class);

    // ACT + ASSERT — abaixo e acima da faixa vão para a borda, nunca para o valor cru
    app(ConfiguracaoService::class)->set('agenda.pendencia_retorno_dias', 1);
    expect($regra->janelaDias())->toBe(7);

    app(ConfiguracaoService::class)->set('agenda.pendencia_retorno_dias', 9999);
    expect($regra->janelaDias())->toBe(180);
});

it('deve ordenar do paciente há mais tempo sem agendamento para o com menos', function () {
    // ARRANGE — a ordem de CRIAÇÃO é o inverso da esperada, de propósito (achado do gate, r1):
    // criando o mais esquecido por ÚLTIMO, o desempate `orderBy('id')` sozinho produz o
    // resultado ERRADO. Na primeira versão o mais antigo nascia primeiro, e apagar o
    // `orderByRaw` deixava este teste VERDE — a fila mostraria o menos esquecido primeiro e o
    // teto de 50 do bloco cortaria justamente quem está há mais tempo sem sessão.
    // O do meio ancora pelo INÍCIO DO TRATAMENTO (nunca agendado): sem ele, o ramo COALESCE
    // da ordenação não era exercitado por asserção nenhuma.
    admin();
    $recente = pacientePendente('Criança Fictícia Menos Antiga');
    ocorrencia($recente, ocupaHorario(), -40);
    $doMeio = pacientePendente('Criança Fictícia Nunca Agendada Do Meio', [
        'data_inicio' => agoraNaClinica()->subDays(80)->toDateString(),
    ]);
    $maisAntigo = pacientePendente('Criança Fictícia Antiga');
    ocorrencia($maisAntigo, ocupaHorario(), -120);

    // ACT + ASSERT — do mais esquecido para o menos, contra a ordem dos ids
    expect(fila()->pluck('id')->all())->toBe([$maisAntigo->id, $doMeio->id, $recente->id]);
});

it('deve manter a camada 1 da minimização: o cadastro do menor nunca entra na memória', function () {
    // ARRANGE — a guarda que faltava (achado do gate, r1). O `semVazamento` do item asserta a
    // camada 2 (app→HTTP); apagar o `->select(ResumoDoPaciente::CAMPOS)` da consulta deixava as
    // 886 verdes e passava a hidratar cpf/nascimento/necessidade (art. 11) de TODO menor da fila
    // — de onde vaza para log, dump e payload de exceção. É o buraco SEC-TR-18 que o docblock do
    // ResumoDoPaciente descreve: assertar só no JSON fica verde com UMA das duas camadas de pé.
    // A `WhitelistDoMenorTest` não alcança este caso: ela casa `with('paciente')` (relação), e
    // aqui o menor é a RAIZ da consulta — classe nova de superfície.
    admin();
    $paciente = pacientePendente('Criança Fictícia Minimizada');
    ocorrencia($paciente, ocupaHorario(), -45);

    // ACT — o MODEL como voltou do banco, não o JSON
    $atributos = array_keys(fila()->first()->getAttributes());

    // ASSERT — as três colunas da whitelist + os dois agregados da consulta, nada mais
    expect($atributos)->toBe([...ResumoDoPaciente::CAMPOS, 'ultima_ocorrencia', 'inicio_tratamento']);
});

it('não deve listar paciente inativado, ainda que com pacote aberto', function () {
    // ARRANGE — a condição 0 (`ativo = true`) só existia no código: apagá-la num refactor não
    // deixava teste nenhum vermelho, e a fila passaria a ligar para famílias de cadastros
    // inativados (duplicados, desligamentos)
    admin();
    $inativado = pacientePendente('Criança Fictícia Inativada');
    ocorrencia($inativado, ocupaHorario(), -45);
    $inativado->update(['ativo' => false]);

    // ACT + ASSERT
    expect(fila())->toHaveCount(0);
});

it('deve escopar a fila pelo vínculo do profissional nos três estados do D11', function () {
    // ARRANGE — dois pacientes, tratamentos de profissionais diferentes
    admin();
    $meu = Profissional::factory()->create();
    $doColega = Profissional::factory()->create();

    $pacienteDoMeu = pacientePendente('Criança Fictícia Do Vínculo', ['profissional_id' => $meu->id]);
    ocorrencia($pacienteDoMeu, ocupaHorario(), -45);
    $pacienteDoColega = pacientePendente('Criança Fictícia Do Colega', ['profissional_id' => $doColega->id]);
    ocorrencia($pacienteDoColega, ocupaHorario(), -45);

    // ACT + ASSERT — plano vê os dois; escopado vê só os seus; sem vínculo não vê nada
    expect(fila(Escopo::plano()))->toHaveCount(2);
    expect(fila(Escopo::de($meu->id))->pluck('id')->all())->toBe([$pacienteDoMeu->id]);
    expect(fila(Escopo::nenhum()))->toHaveCount(0);
});

it('não deve vazar cadastro nem dado clínico no item', function () {
    // ARRANGE — o cadastro inteiro preenchido; só três colunas do menor podem sair
    admin();
    $especialidade = Especialidade::factory()->create(['nome' => 'Fonoaudiologia Fictícia']);
    $paciente = Paciente::factory()->create([
        'nome' => 'Criança Fictícia Completa',
        'cpf' => '39053344705',
        'nascimento' => '2018-04-11',
        'necessidade' => 'Necessidade fictícia',
        'contatos_json' => [['tipo' => 'celular', 'valor' => '(11) 90000-0000']],
    ]);
    Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'especialidade_id' => $especialidade->id,
        'sessoes_total' => 10,
    ]);
    ocorrencia($paciente, ocupaHorario(), -45);

    // ACT
    $item = app(PendenciasDeRetorno::class)->item(fila()->first(), agoraNaClinica()->toDateString());

    // ASSERT — a especialidade orienta a ação; nada do cadastro do menor acompanha
    expect($item['especialidades'])->toBe([['id' => $especialidade->id, 'nome' => 'Fonoaudiologia Fictícia']])
        ->and(array_keys($item['paciente']))->toBe(['id', 'nome', 'nome_social']);
    semVazamento($item, 'Necessidade fictícia');
    semVazamento($item, '39053344705');
    semVazamento($item, '2018-04-11');
    semVazamento($item, '(11) 90000-0000');
});

/*
 * O ENDPOINT da fila (`GET /api/pendencias-de-retorno`) — a regra é a mesma de cima; aqui
 * o que se prova é o portão (permissão + escopo) e a forma da resposta.
 */

it('deve negar a fila a quem não tem agenda.ver', function () {
    // ARRANGE
    admin();
    $semAgenda = usuarioCom(['pacientes.ver'], 'Sem Agenda Fictício');

    // ACT + ASSERT
    $this->actingAs($semAgenda)->getJson('/api/pendencias-de-retorno')->assertForbidden();
});

it('deve entregar a fila paginada com a janela vigente a quem tem agenda.ver', function () {
    // ARRANGE
    admin();
    $paciente = pacientePendente('Criança Fictícia Da Fila');
    ocorrencia($paciente, ocupaHorario(), -45);
    $recepcao = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Recepção Fictícia');

    // ACT
    $resposta = $this->actingAs($recepcao)->getJson('/api/pendencias-de-retorno');

    // ASSERT — item minimizado + a janela para a tela explicar o critério
    $resposta->assertOk()
        ->assertJsonPath('total', 1)
        ->assertJsonPath('janela_dias', 30)
        ->assertJsonPath('data.0.paciente.nome', 'Criança Fictícia Da Fila')
        ->assertJsonPath('data.0.dias_sem_agendamento', 45);
    expect(array_keys($resposta->json('data.0')))->toBe([
        'paciente', 'dias_sem_agendamento', 'ultima_ocorrencia_em', 'inicio_tratamento_em', 'especialidades',
    ]);
});

it('deve escopar a fila do endpoint ao vínculo, e devolver vazia sem vínculo', function () {
    // ARRANGE — dois pacientes de profissionais diferentes. Os níveis restritos nascem
    // ANTES do tráfego HTTP (auth:sanctum troca o guard default — mesma cautela do gate
    // dos totais do caixa), senão o segundo `usuarioCom` não acha a permissão.
    admin();
    $meu = Profissional::factory()->create();
    $vinculado = usuarioCom(['agenda.ver'], 'Profissional Fictício');
    $vinculado->update(['profissional_id' => $meu->id]);
    $semVinculo = usuarioCom(['agenda.ver'], 'Sem Vínculo Fictício');

    $pacienteDoMeu = pacientePendente('Criança Fictícia Escopada', ['profissional_id' => $meu->id]);
    ocorrencia($pacienteDoMeu, ocupaHorario(), -45);
    $doColega = pacientePendente('Criança Fictícia Alheia', ['profissional_id' => Profissional::factory()->create()->id]);
    ocorrencia($doColega, ocupaHorario(), -45);

    // ACT + ASSERT — vinculado vê só o seu
    $resposta = $this->actingAs($vinculado)->getJson('/api/pendencias-de-retorno')->assertOk();
    expect($resposta->json('total'))->toBe(1)
        ->and($resposta->json('data.0.paciente.id'))->toBe($pacienteDoMeu->id);
    semVazamento($resposta->json(), 'Criança Fictícia Alheia');

    // sem vínculo e sem a flag: fila VAZIA, nunca a da clínica toda (fail-closed).
    // Trocar de usuário no meio do teste exige soltar o guard já resolvido.
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semVinculo)->getJson('/api/pendencias-de-retorno')
        ->assertOk()->assertJsonPath('total', 0);
});

/*
 * O BLOCO do centro de notificações — o contrato que importa é a NÃO-DIVERGÊNCIA:
 * contador do bloco e total da fila saem da mesma fonte, então são o mesmo número.
 */

it('deve trazer o bloco de pendências no centro sob agenda.ver', function () {
    // ARRANGE
    admin();
    $paciente = pacientePendente('Criança Fictícia Do Bloco');
    ocorrencia($paciente, ocupaHorario(), -45);
    $recepcao = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Recepção do Bloco Fictícia');

    // ACT
    $centro = $this->actingAs($recepcao)->getJson('/api/notificacoes')->assertOk();

    // ASSERT
    expect($centro->json('pendencias_de_retorno.total'))->toBe(1)
        ->and($centro->json('pendencias_de_retorno.itens.0.paciente.nome'))->toBe('Criança Fictícia Do Bloco')
        ->and($centro->json('pendencias_de_retorno.itens.0.dias_sem_agendamento'))->toBe(45);
});

it('não deve trazer o bloco de pendências sem agenda.ver — ausente, nunca zerado', function () {
    // ARRANGE
    admin();
    $semAgenda = usuarioCom(['pacientes.ver'], 'Sem Agenda do Bloco Fictício');

    // ACT
    $centro = $this->actingAs($semAgenda)->getJson('/api/notificacoes')->assertOk();

    // ASSERT — a chave não existe (zero seria informação falsa)
    expect($centro->json())->not->toHaveKey('pendencias_de_retorno');
});

it('deve manter o contador do bloco igual ao total da fila para o mesmo usuário', function () {
    // ARRANGE — três pendentes e um protegido por sessão futura
    admin();
    foreach (['Criança Fictícia Um', 'Criança Fictícia Dois', 'Criança Fictícia Três'] as $nome) {
        ocorrencia(pacientePendente($nome), ocupaHorario(), -45);
    }
    $protegido = pacientePendente('Criança Fictícia Protegida');
    ocorrencia($protegido, ocupaHorario(), -45);
    ocorrencia($protegido, ocupaHorario(), 7);
    $recepcao = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Recepção Cruzada Fictícia');

    // ACT — as DUAS superfícies, mesmo usuário
    $this->actingAs($recepcao);
    $bloco = $this->getJson('/api/notificacoes')->assertOk()->json('pendencias_de_retorno.total');
    $fila = $this->getJson('/api/pendencias-de-retorno')->assertOk()->json('total');

    // ASSERT — a fonte única é o que impede a divergência
    expect($bloco)->toBe(3)->and($fila)->toBe($bloco);
});

it('deve esvaziar o bloco quando o agendamento futuro nasce', function () {
    // ARRANGE
    admin();
    $paciente = pacientePendente('Criança Fictícia Do Bloco Resolvida');
    ocorrencia($paciente, ocupaHorario(), -45);
    $recepcao = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Recepção Resolvida Fictícia');
    expect($this->actingAs($recepcao)->getJson('/api/notificacoes')->json('pendencias_de_retorno.total'))->toBe(1);

    // ACT
    ocorrencia($paciente, ocupaHorario(), 5);

    // ASSERT
    expect($this->getJson('/api/notificacoes')->json('pendencias_de_retorno.total'))->toBe(0);
});

it('deve paginar a fila com teto de per_page e ordem estável entre as páginas', function () {
    // ARRANGE — a task nomeava paginação e nada a exercitava (achado do gate, r1): as regras
    // `min:1|max:100` eram superfície de entrada não testada, e a estabilidade entre páginas
    // depende do desempate `orderBy('id')`.
    admin();
    $porDias = [];
    foreach ([90, 60, 45] as $dias) {
        $p = pacientePendente("Criança Fictícia De {$dias} Dias");
        ocorrencia($p, ocupaHorario(), -$dias);
        $porDias[$dias] = $p->id;
    }
    $recepcao = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Recepção Paginada Fictícia');
    $this->actingAs($recepcao);

    // ACT + ASSERT — página 1 traz os dois mais esquecidos, em ordem
    $primeira = $this->getJson('/api/pendencias-de-retorno?per_page=2')->assertOk();
    expect($primeira->json('total'))->toBe(3)
        ->and($primeira->json('last_page'))->toBe(2)
        ->and(array_column($primeira->json('data'), 'dias_sem_agendamento'))->toBe([90, 60]);

    // a página 2 traz o restante, sem repetir
    $segunda = $this->getJson('/api/pendencias-de-retorno?per_page=2&page=2')->assertOk();
    expect(array_column($segunda->json('data'), 'dias_sem_agendamento'))->toBe([45]);
    expect($segunda->json('data.0.paciente.id'))->toBe($porDias[45]);

    // teto e piso do per_page são do servidor, não do cliente
    foreach ([0, 101, 'abc'] as $invalido) {
        $this->getJson("/api/pendencias-de-retorno?per_page={$invalido}")
            ->assertUnprocessable()->assertJsonValidationErrors('per_page');
    }
});

it('deve custar um número CONSTANTE de consultas, independente do volume da fila', function () {
    // ARRANGE — a guarda que o design PROMETIA e não existia (achado do gate, r1: "alegação de
    // guarda inexistente é pior que guarda nenhuma"). O que ela prende é o N+1: `especialidades`
    // é carregada por eager load, então dobrar a fila NÃO pode dobrar o número de consultas.
    // (O custo POR consulta — varredura de `agendamentos` — é risco medido e aceito, registrado
    // como gatilho PEND-CUSTO em docs/GATILHOS.md; esta guarda não o cobre e não finge cobrir.)
    admin();
    $recepcao = usuarioCom(['agenda.ver', 'agenda.ver_todos'], 'Recepção do Custo Fictícia');
    $contar = function () {
        $sqls = [];
        DB::listen(function ($consulta) use (&$sqls) {
            $sqls[] = $consulta->sql;
        });
        $this->getJson('/api/pendencias-de-retorno')->assertOk();

        return count($sqls);
    };

    // ACT — mede com 1 pendente, depois com 6 (cada um com especialidade PRÓPRIA).
    // O primeiro request AQUECE (sessão e permissões custam consultas só na primeira vez);
    // medir sem aquecer compararia overhead de auth, não a fila.
    ocorrencia(pacientePendente('Criança Fictícia Do Custo 0'), ocupaHorario(), -45);
    $this->actingAs($recepcao);
    $this->getJson('/api/pendencias-de-retorno')->assertOk();
    $comUm = $contar();

    for ($i = 1; $i <= 5; $i++) {
        $paciente = pacientePendente("Criança Fictícia Do Custo {$i}", [
            'especialidade_id' => Especialidade::factory()->create(['nome' => "Especialidade Fictícia {$i}"])->id,
        ]);
        ocorrencia($paciente, ocupaHorario(), -45 - $i);
    }
    $comSeis = $contar();

    // ASSERT — 6× a fila, o MESMO número de consultas
    expect($this->getJson('/api/pendencias-de-retorno')->json('total'))->toBe(6)
        ->and($comSeis)->toBe($comUm);
});
