<?php

use App\Models\Agendamento;
use App\Models\Auditoria;
use App\Models\Categoria;
use App\Models\Conta;
use App\Models\Especialidade;
use App\Models\Informativo;
use App\Models\Paciente;
use App\Models\Profissional;
use App\Models\StatusAgendamento;
use App\Models\TermoConsentimento;
use App\Models\TipoPagamento;
use App\Models\Tratamento;
use App\Models\Usuario;
use App\Support\Clinica\PacotesAcabando;
use App\Support\Configuracoes\ConfiguracaoService;
use App\Support\Rbac\Escopo;
use Carbon\Carbon;
use Spatie\Permission\Models\Role;

/** Agendamento PASSADO do paciente num status — direto no banco (sem validação de agenda). */
function agendamentoPassado(Paciente $paciente, StatusAgendamento $status, int $diasAtras): Agendamento
{
    return Agendamento::factory()->create([
        'paciente_id' => $paciente->id,
        'status_id' => $status->id,
        'inicio' => agoraNaClinica()->subDays($diasAtras)->setTime(9, 0),
        'fim' => agoraNaClinica()->subDays($diasAtras)->setTime(9, 40),
    ]);
}

it('deve montar o centro por permissão de bloco com payloads mínimos', function () {
    // ARRANGE — um dado para cada bloco
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $aniversariante = Paciente::factory()->create([
        'nome' => 'Aniversariante Fictício',
        'nascimento' => agoraNaClinica()->subYears(8)->format('Y-m-d'), // mês corrente
    ]);
    $conta = Conta::create(['nome' => 'Caixa Centro Fictício']);
    $categoria = Categoria::create(['nome' => 'Mensalidade Fictícia', 'tipo' => 'receita']);
    $tipoPagamento = TipoPagamento::create(['nome' => 'PIX Centro Fictício']);
    $this->postJson('/api/lancamentos', [
        'tipo' => 'receita',
        'competencia' => agoraNaClinica()->subDays(10)->toDateString(),
        'vencimento' => agoraNaClinica()->subDays(10)->toDateString(), // vencido, não pago
        'categoria_id' => $categoria->id,
        'valor' => '100.00',
        'tipo_pagamento_id' => $tipoPagamento->id,
        'conta_id' => $conta->id,
        'obs' => 'Observação fictícia que não pode vazar.',
    ])->assertCreated();
    Informativo::create(['titulo' => 'Aviso Fictício', 'corpo' => 'Reunião fictícia.', 'publicado' => true]);

    // ACT
    $centro = $this->getJson('/api/notificacoes');

    // ASSERT — admin vê o inventário COMPLETO de blocos; payloads mínimos (T-not-02/03).
    // Sem contagem no comentário: "os NOVE blocos" envelheceu calado quando a change
    // mensageria-whatsapp somou o décimo (a própria spec pede que o nome não conte).
    // Igualdade de CONJUNTO, não `toHaveKeys` (achado do gate, r1): subconjunto nunca reprova
    // por bloco a MAIS nem por bloco NOVO esquecido — o inventário ficou dois atrás do produto
    // (faltavam `pedidos_medicos`, da change limites-e-pedidos, e `pendencias_de_retorno`), e é
    // justamente este teste que existe para não depender das suítes específicas de cada bloco.
    $centro->assertOk();
    expect(array_keys($centro->json()))->toEqualCanonicalizing([
        'evolucoes_em_aberto', 'aniversariantes', 'termos_pendentes',
        'lancamentos_em_atraso', 'faltas_consecutivas', 'pendencias_de_retorno', 'pedidos_de_desmarque',
        'pedidos_medicos', 'pacotes_acabando', 'tarefas', 'mensagens', 'informativos',
        'cadastros_recebidos',
    ]);
    expect($centro->json('aniversariantes.total'))->toBe(1)
        ->and($centro->json('aniversariantes.itens.0'))->toHaveKeys(['id', 'nome', 'dia'])
        ->and($centro->json('aniversariantes.itens.0'))->not->toHaveKey('nascimento');
    expect($centro->json('lancamentos_em_atraso.total'))->toBe(1);
    semVazamento($centro->json('lancamentos_em_atraso'), 'Observação fictícia');

    // usuário sem permissões: blocos AUSENTES (nem contador), só informativos
    $semPermissao = Usuario::factory()->create();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $soInformativos = $this->actingAs($semPermissao)->getJson('/api/notificacoes');
    $soInformativos->assertOk();
    expect($soInformativos->json())->toHaveKey('informativos')
        ->and($soInformativos->json())->not->toHaveKeys([
            'evolucoes_em_aberto', 'aniversariantes', 'termos_pendentes',
            'lancamentos_em_atraso', 'faltas_consecutivas',
        ]);
    expect($soInformativos->json('informativos.itens.0.titulo'))->toBe('Aviso Fictício');
});

it('deve listar faltas consecutivas pela flag do status, nunca pelo nome', function () {
    // ARRANGE — 3 faltas seguidas (limite default 3); flag veio do default/backfill
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
    expect($naoCompareceu->marca_falta)->toBeTrue();
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $faltoso = Paciente::factory()->create(['nome' => 'Faltoso Fictício', 'nascimento' => '2018-01-15']);
    agendamentoPassado($faltoso, $naoCompareceu, 21);
    agendamentoPassado($faltoso, $naoCompareceu, 14);
    agendamentoPassado($faltoso, $naoCompareceu, 7);

    // ACT + ASSERT — no limite aparece, com payload mínimo
    $bloco = $this->getJson('/api/notificacoes')->json('faltas_consecutivas');
    expect($bloco['total'])->toBe(1)
        ->and($bloco['itens'][0]['paciente']['nome'])->toBe('Faltoso Fictício')
        ->and($bloco['itens'][0]['faltas_consecutivas'])->toBe(3);

    // renomear o status NÃO muda a semântica (flag decide — T-not-07)
    $naoCompareceu->update(['nome' => 'Ausente Sem Aviso']);
    expect($this->getJson('/api/notificacoes')->json('faltas_consecutivas.total'))->toBe(1);

    // um comparecimento MAIS RECENTE interrompe a sequência (P1)
    agendamentoPassado($faltoso, $emAberto, 1);
    expect($this->getJson('/api/notificacoes')->json('faltas_consecutivas.total'))->toBe(0);

    // três faltas novas reconstroem a sequência (asserção intermediária — CR-08:
    // horários firmemente no passado, nunca dependentes da hora da suite)
    foreach ([6, 4, 2] as $horasAtras) {
        Agendamento::factory()->create([
            'paciente_id' => $faltoso->id,
            'status_id' => $naoCompareceu->id,
            'inicio' => agoraNaClinica()->subHours($horasAtras),
            'fim' => agoraNaClinica()->subHours($horasAtras)->addMinutes(40),
        ]);
    }
    expect($this->getJson('/api/notificacoes')->json('faltas_consecutivas.total'))->toBe(1);

    // desligar a flag tira o status do alerta — dado, sem código; flip via API
    // com serialização provada (CR-02)
    $flip = $this->putJsonComVersao("/api/status-agendamento/{$naoCompareceu->id}", [
        'nome' => $naoCompareceu->nome, 'cor' => $naoCompareceu->cor,
        'ordem' => $naoCompareceu->ordem, 'desconta_sessao' => $naoCompareceu->desconta_sessao,
        'marca_falta' => false,
    ]);
    $flip->assertOk()->assertJsonPath('marca_falta', false);
    expect($this->getJson("/api/status-agendamento/{$naoCompareceu->id}")->json('marca_falta'))
        ->toBeFalse();
    $trilhaDoFlip = Auditoria::where('entidade', 'status_agendamento')
        ->where('acao', 'atualizou')->where('entidade_id', $naoCompareceu->id)
        ->latest('id')->firstOrFail();
    expect($trilhaDoFlip->diff_json['depois']['marca_falta'])->toBe(false);
    expect($this->getJson('/api/notificacoes')->json('faltas_consecutivas.total'))->toBe(0);
});

/**
 * A cena da pendência de termo: especialidade que exige, paciente em tratamento.
 * Devolve o paciente para o teste manipular o consentimento.
 */
function pacienteEmTratamentoQueExigeTermo(string $nome = 'Sem Termo Fictício'): Paciente
{
    $especialidade = Especialidade::factory()->create(['exige_termo' => true]);
    $paciente = Paciente::factory()->create(['nome' => $nome, 'consentimentos_json' => []]);
    Tratamento::factory()->create([
        'paciente_id' => $paciente->id,
        'especialidade_id' => $especialidade->id,
        'status' => 'andamento',
    ]);

    return $paciente;
}

/** Um aceite como o servidor o grava, para a versão dada (dados FICTÍCIOS). */
function aceiteDaVersao(TermoConsentimento $termo, int $usuarioId): array
{
    return [[
        'termo_id' => $termo->id, 'versao' => $termo->versao, 'termo' => $termo->titulo,
        'responsavel' => 'Mãe Fictícia', 'forma' => 'papel',
        'registrado_por' => $usuarioId, 'aceito_em' => '2026-01-01T10:00:00-03:00',
    ]];
}

it('deve apontar termos pendentes só para quem exige termo e não consentiu', function () {
    // ARRANGE — especialidade exige termo; paciente sem consentimentos (D9/P6)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $vigente = termoVigente();
    $pendente = pacienteEmTratamentoQueExigeTermo();

    // ACT + ASSERT
    $bloco = $this->getJson('/api/notificacoes')->json('termos_pendentes');
    expect($bloco['total'])->toBe(1)
        ->and($bloco['itens'][0]['nome'])->toBe('Sem Termo Fictício');

    // com o aceite da versão VIGENTE registrado, sai da lista
    $pendente->update(['consentimentos_json' => aceiteDaVersao($vigente, $adminDaClinica->id)]);
    expect($this->getJson('/api/notificacoes')->json('termos_pendentes.total'))->toBe(0);
});

it('deve voltar a apontar pendência quando uma versão NOVA entra em vigor', function () {
    // ARRANGE — quem aceitou a v1 não aceitou a v2: a régua mudou (FA-08)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $v1 = termoVigente();
    $pendente = pacienteEmTratamentoQueExigeTermo();
    $pendente->update(['consentimentos_json' => aceiteDaVersao($v1, $adminDaClinica->id)]);
    expect($this->getJson('/api/notificacoes')->json('termos_pendentes.total'))->toBe(0);

    // ACT — a clínica publica a v2
    termoVigente();

    // ASSERT
    expect($this->getJson('/api/notificacoes')->json('termos_pendentes.total'))->toBe(1);
});

it('não deve aceitar consentimento antigo de texto livre como aceite do termo vigente', function () {
    // ARRANGE — a régua velha ("a lista não está vazia") era zerada por QUALQUER texto
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    termoVigente();
    $pendente = pacienteEmTratamentoQueExigeTermo();

    // ACT — o consentimento anterior à change, sem vínculo com versão
    $pendente->update(['consentimentos_json' => [[
        'termo' => 'Termo fictício antigo', 'aceito_em' => '2026-01-01T10:00:00-03:00',
        'responsavel' => 'Mãe Fictícia',
    ]]]);

    // ASSERT — continua pendente: ninguém registrou o aceite do Regulamento em vigor
    expect($this->getJson('/api/notificacoes')->json('termos_pendentes.total'))->toBe(1);
});

it('deve manter na fila quem NUNCA teve consentimento (coluna nula)', function () {
    // ARRANGE — `NOT JSON_CONTAINS(NULL, ...)` é NULL, não verdadeiro: sem a perna
    // explícita do `whereNull`, o paciente que a fila mais precisa achar sumiria dela
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    termoVigente();
    $pendente = pacienteEmTratamentoQueExigeTermo('Nunca Consentiu Fictício');
    $pendente->update(['consentimentos_json' => null]);

    // ACT + ASSERT
    $bloco = $this->getJson('/api/notificacoes')->json('termos_pendentes');
    expect($bloco['total'])->toBe(1)
        ->and($bloco['itens'][0]['nome'])->toBe('Nunca Consentiu Fictício');
});

it('deve deixar a fila de termos VAZIA quando nenhuma versão está vigente', function () {
    // ARRANGE — sem régua publicada não há o que cobrar; cobrar sem régua é ruído (D7)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    pacienteEmTratamentoQueExigeTermo();

    // ACT + ASSERT
    $bloco = $this->getJson('/api/notificacoes')->json('termos_pendentes');
    expect($bloco['total'])->toBe(0)->and($bloco['itens'])->toBe([]);
});

it('não deve trazer paciente inativo na fila de termos', function () {
    // ARRANGE — não-regressão do escopo (inativo não é pendência)
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    termoVigente();
    $inativo = pacienteEmTratamentoQueExigeTermo('Inativo Fictício');
    $inativo->update(['ativo' => false]);

    // ACT
    $bloco = $this->getJson('/api/notificacoes')->json('termos_pendentes');

    // ASSERT
    expect($bloco['total'])->toBe(0);
    semVazamento($bloco, 'Inativo Fictício');
});

it('deve gerir informativos com tetos, rascunho restrito e texto puro', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);

    // ACT + ASSERT — tetos (P7)
    $this->postJson('/api/informativos', ['titulo' => str_repeat('a', 151), 'corpo' => 'x'])
        ->assertUnprocessable()->assertJsonValidationErrors('titulo');
    $this->postJson('/api/informativos', ['titulo' => 'Ok', 'corpo' => str_repeat('a', 5001)])
        ->assertUnprocessable()->assertJsonValidationErrors('corpo');

    // script tag persiste como STRING (texto puro — T-not-05)
    $rascunho = $this->postJson('/api/informativos', [
        'titulo' => 'Rascunho Fictício', 'corpo' => '<script>alert(1)</script>',
    ])->assertCreated();
    expect($rascunho->json('corpo'))->toBe('<script>alert(1)</script>')
        ->and($rascunho->json('publicado'))->toBeFalse()
        ->and($rascunho->json('criado_por'))->toBe($adminDaClinica->id);

    // rascunho NÃO aparece no centro; publicado aparece
    expect($this->getJson('/api/notificacoes')->json('informativos.total'))->toBe(0);
    $this->putJsonComVersao('/api/informativos/'.$rascunho->json('id'), ['publicado' => true])->assertOk();
    expect($this->getJson('/api/notificacoes')->json('informativos.total'))->toBe(1);

    // 403 sem permissão de gestão
    $semPermissao = Usuario::factory()->create();
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $this->actingAs($semPermissao)->getJson('/api/informativos')->assertForbidden();
});

it('deve validar as configurações novas do centro e do encadeamento', function () {
    // ARRANGE
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica);
    $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
    $finalizado = StatusAgendamento::where('nome', 'Finalizado')->firstOrFail();

    // ACT + ASSERT — formato date (D8/P5)
    $this->putJsonComVersao('/api/configuracoes', [
        'chave' => 'notificacoes.a_partir_de', 'valor' => '31/12/2025',
    ])->assertUnprocessable()->assertJsonValidationErrors('valor');
    $this->putJsonComVersao('/api/configuracoes', [
        'chave' => 'notificacoes.a_partir_de', 'valor' => '2026-01-01',
    ])->assertOk();

    // alvo do encadeamento: descontante → 422; válido → OK (T-not-09/10a)
    $this->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.encadeamento_status_id', 'valor' => $finalizado->id,
    ])->assertUnprocessable()->assertJsonValidationErrors('valor');
    $this->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.encadeamento_status_id', 'valor' => $emAberto->id,
    ])->assertOk();

    // status inexistente → 422
    $this->putJsonComVersao('/api/configuracoes', [
        'chave' => 'agenda.encadeamento_status_id', 'valor' => 999999,
    ])->assertUnprocessable()->assertJsonValidationErrors('valor');
});

it('deve entregar só o bloco da única permissão do usuário', function () {
    // ARRANGE — nível com SOMENTE lancamentos.ver (T-not-01/SEC-not-02)
    $adminDaClinica = admin();
    $financeiro = Role::create(['name' => 'Financeiro Fictício']);
    $financeiro->givePermissionTo('lancamentos.ver');
    $usuarioFinanceiro = Usuario::factory()->create();
    $usuarioFinanceiro->syncRoles([$financeiro]);

    // ACT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $centro = $this->actingAs($usuarioFinanceiro)->getJson('/api/notificacoes');

    // ASSERT — só o bloco do dinheiro (+ informativos, que é broadcast)
    $centro->assertOk();
    expect($centro->json())->toHaveKeys(['lancamentos_em_atraso', 'informativos'])
        ->and($centro->json())->not->toHaveKeys([
            'evolucoes_em_aberto', 'aniversariantes', 'termos_pendentes', 'faltas_consecutivas',
        ]);
});

// ── Pacotes acabando (change alerta-de-fim-de-pacote) ───────────────────────

/** Um pacote fictício da clínica, com o saldo que o teste quiser. */
function pacoteComSaldo(int $total, int $realizadas, string $status = 'andamento', ?int $profissionalId = null): Tratamento
{
    return Tratamento::factory()->create([
        'paciente_id' => Paciente::factory()->create()->id,
        'profissional_id' => $profissionalId ?? Profissional::factory()->create()->id,
        'especialidade_id' => Especialidade::factory()->create()->id,
        'sessoes_total' => $total,
        'sessoes_realizadas' => $realizadas,
        'status' => $status,
    ]);
}

it('deve listar o pacote que chegou ao fim', function () {
    /*
     * ARRANGE — a clínica esquece de cobrar quando o pacote termina, e o realce do card só
     * funciona se alguém estiver olhando aquele card naquele dia.
     */
    $adminDaClinica = admin();
    pacoteComSaldo(10, 8); // saldo 2 — penúltima

    // ACT
    $centro = $this->actingAs($adminDaClinica)->getJson('/api/notificacoes');

    // ASSERT
    $centro->assertOk();
    expect($centro->json('pacotes_acabando.total'))->toBe(1)
        ->and($centro->json('pacotes_acabando.itens.0.sessoes_saldo'))->toBe(2)
        ->and($centro->json('pacotes_acabando.itens.0.sessoes_total'))->toBe(10);
});

it('deve seguir o limiar da CLÍNICA, e não um número fixo no código', function () {
    /*
     * ARRANGE — §13: o limiar era constante em DOIS runtimes, guardado por um teste do front
     * que abria este arquivo `.php` e comparava por regex. Virou `tratamentos.saldo_alerta_
     * sessoes`; a clínica que quiser 4 muda na tela, sem deploy.
     */
    $adminDaClinica = admin();
    pacoteComSaldo(10, 6); // saldo 4 — fora do limiar padrão (2)

    // ACT + ASSERT — antes
    $centro = $this->actingAs($adminDaClinica)->getJson('/api/notificacoes');
    expect($centro->json('pacotes_acabando.total'))->toBe(0);

    // ACT — a clínica alarga o alerta
    app(ConfiguracaoService::class)
        ->set('tratamentos.saldo_alerta_sessoes', 4);

    // ASSERT — o MESMO pacote passa a entrar na fila de cobrança
    $depois = $this->actingAs($adminDaClinica)->getJson('/api/notificacoes');
    expect($depois->json('pacotes_acabando.total'))->toBe(1);
});

it('deve escopar o bloco pelo vínculo do profissional nos três estados do D11', function () {
    /*
     * ARRANGE — este cenário FALTAVA, e a tarefa 3.3 já dizia que ele existia. O gate pegou:
     * os cinco cenários do bloco usavam `admin()` (escopo plano), e a guarda
     * `EscopoPorPadraoTest` não fecha isso — ela classifica por `Controller@metodo`, e
     * `NotificacaoController@index` já era `scoped` antes desta change. São onze blocos dentro
     * de um método, e ela enxerga um.
     *
     * Sem isto, um refactor que tire `$escopo->aplicar()` da fonte passa com a suíte verde, e
     * um profissional escopado lê nome + especialidade (dado de saúde, art. 11) de até 50
     * crianças de colegas.
     */
    admin();
    $meu = Profissional::factory()->create();
    $doColega = Profissional::factory()->create();
    $meuPacote = pacoteComSaldo(10, 8, 'andamento', $meu->id);
    pacoteComSaldo(10, 9, 'andamento', $doColega->id);

    $fonte = app(PacotesAcabando::class);

    // ACT + ASSERT — plano vê os dois; escopado vê só os seus; SEM VÍNCULO não vê nada
    expect($fonte->consulta(Escopo::plano())->count())->toBe(2);
    expect($fonte->consulta(Escopo::de($meu->id))->pluck('id')->all())->toBe([$meuPacote->id]);
    // fail-closed: quem não tem vínculo e não tem `ver_todos` recebe bloco VAZIO, nunca tudo
    expect($fonte->consulta(Escopo::nenhum())->count())->toBe(0);
});

it('NÃO deve listar tratamento de UMA sessão', function () {
    /*
     * ARRANGE — saldo 1 é `<= 2`, então a regra sem o recorte disparava aqui. Sessão única não
     * tem fim de pacote a anunciar, e alertá-la é ruído em cima de quem nunca comprou pacote.
     */
    $adminDaClinica = admin();
    pacoteComSaldo(1, 0);

    // ACT + ASSERT
    $centro = $this->actingAs($adminDaClinica)->getJson('/api/notificacoes');
    expect($centro->json('pacotes_acabando.total'))->toBe(0);
});

it('NÃO deve listar pacote finalizado', function () {
    // ARRANGE — o que se cobra é a renovação de quem SEGUE em atendimento
    $adminDaClinica = admin();
    pacoteComSaldo(10, 9, 'finalizado');

    // ACT + ASSERT
    $centro = $this->actingAs($adminDaClinica)->getJson('/api/notificacoes');
    expect($centro->json('pacotes_acabando.total'))->toBe(0);
});

it('NÃO deve entregar o bloco a quem não tem tratamentos.ver', function () {
    // ARRANGE — sem a permissão o bloco é AUSENTE, nem como contador
    $adminDaClinica = admin();
    pacoteComSaldo(10, 9);
    $recepcao = Role::create(['name' => 'Só Agenda Fictícia']);
    $recepcao->givePermissionTo('agenda.ver');
    $usuario = Usuario::factory()->create();
    $usuario->syncRoles([$recepcao]);

    // ACT
    $this->flushSession();
    $this->app['auth']->forgetGuards();
    $centro = $this->actingAs($usuario)->getJson('/api/notificacoes');

    // ASSERT
    $centro->assertOk();
    expect(array_keys($centro->json()))->not->toContain('pacotes_acabando');
});

it('NÃO deve vazar dado do menor além do mínimo no item', function () {
    /*
     * ARRANGE — quem vai cobrar precisa saber QUEM, de QUE pacote e quanto FALTA. Nascimento,
     * CPF e carteirinha estão na ficha, atrás da permissão dela. O bloco é a 16ª superfície de
     * leitura de nome de menor (gatilho ENUM) e não pode alargar o piso.
     */
    $adminDaClinica = admin();
    $tratamento = pacoteComSaldo(10, 9);
    $tratamento->paciente->update(['cpf' => '11144477735', 'carteirinha' => '99887766']);

    // ACT
    $centro = $this->actingAs($adminDaClinica)->getJson('/api/notificacoes');

    // ASSERT
    semVazamento($centro->json('pacotes_acabando'), '11144477735');
    semVazamento($centro->json('pacotes_acabando'), '99887766');
    expect($centro->json('pacotes_acabando.itens.0.paciente'))->not->toHaveKey('nascimento');
});

/**
 * A fronteira do "hoje" tem de ser a MESMA nas duas metades da regra (change
 * agendamentos-na-ficha, D5 · achado ALTO do gate): o `ContadorDeFaltasConsecutivas` passou a
 * contar a falta lançada hoje para mais tarde, e a seleção de CANDIDATOS deste centro cortava em
 * `agora`.
 *
 * O cenário tem de ser o que DISTINGUE as duas metades — a primeira versão deste teste passava
 * com e sem o conserto (a última ocorrência passada já era falta, então o paciente virava
 * candidato de qualquer jeito). Aqui a última ocorrência PASSADA **não** é falta: sem o
 * predicado único, o paciente jamais entra na lista de candidatos, e o centro fica calado
 * enquanto o painel e a ficha alertam. Limite 1 (o catálogo permite) isola a sequência de hoje.
 * Relógio congelado às 09:00 para `+3h` cair sempre no mesmo dia.
 */
describe('fronteira do hoje no centro de avisos', function () {
    // dentro do describe, e como CHAMADA: a forma `})->beforeEach(...)` não executa no Pest 4.
    // Um `beforeEach` solto no arquivo congelaria os 40+ testes vizinhos deste arquivo.
    beforeEach(fn () => Carbon::setTestNow(Carbon::parse('2026-09-08 09:00:00', 'America/Sao_Paulo')));
    afterEach(fn () => Carbon::setTestNow());

    it('deve rodar com o relógio CONGELADO (autoguarda do hook)', function () {
        expect(agoraNaClinica()->format('Y-m-d H:i'))->toBe('2026-09-08 09:00');
    });

    it('deve listar o paciente cuja falta de HOJE fecha a sequência', function () {
        // ARRANGE — limite 1; a última ocorrência PASSADA é um comparecimento, e a falta é de hoje
        $adminDaClinica = admin();
        $this->actingAs($adminDaClinica);
        $this->putJsonComVersao('/api/configuracoes', [
            'chave' => 'agenda.faltas_consecutivas_limite',
            'valor' => 1,
        ])->assertOk();
        $naoCompareceu = StatusAgendamento::where('nome', 'Não Compareceu')->firstOrFail();
        $emAberto = StatusAgendamento::where('nome', 'Em Aberto')->firstOrFail();
        $faltoso = Paciente::factory()->create(['nome' => 'Faltoso Fictício de Hoje']);
        agendamentoPassado($faltoso, $emAberto, 7); // passado, NÃO é falta
        $hojeMaisTarde = agoraNaClinica()->addHours(3)->setSeconds(0);
        Agendamento::factory()->create([
            'paciente_id' => $faltoso->id,
            'status_id' => $naoCompareceu->id,
            'inicio' => $hojeMaisTarde->format('Y-m-d H:i'),
            'fim' => $hojeMaisTarde->copy()->addMinutes(40)->format('Y-m-d H:i'),
        ]);

        // ACT
        $bloco = $this->getJson('/api/notificacoes')->json('faltas_consecutivas');

        // ASSERT — o centro concorda com o painel e com a ficha no MESMO dia
        expect($bloco['total'])->toBe(1)
            ->and($bloco['itens'][0]['paciente']['nome'])->toBe('Faltoso Fictício de Hoje')
            ->and($bloco['itens'][0]['faltas_consecutivas'])->toBe(1);
    });
});
