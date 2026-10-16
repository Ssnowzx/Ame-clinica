<?php

use App\Models\Auditoria;
use App\Models\Configuracao;
use App\Models\StatusAgendamento;
use App\Models\Usuario;
use App\Support\Configuracoes\CatalogoConfiguracoes;

afterEach(fn () => CatalogoConfiguracoes::limparExtensoes());

/** Localiza a entrada de uma chave na resposta do index. */
function configDaResposta(array $configuracoes, string $chave): ?array
{
    return collect($configuracoes)->firstWhere('chave', $chave);
}

it('deve retornar o default do catálogo quando não há override', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');

    // ASSERT
    $resposta->assertOk();
    $timezone = collect($resposta->json('configuracoes'))->firstWhere('chave', 'clinica.timezone');
    expect($timezone['valor'])->toBe('America/Sao_Paulo');
});

it('deve persistir override e retorná-lo nas leituras seguintes', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.nome',
        'valor' => 'Clínica Fictícia Nova',
    ])->assertOk();

    // ASSERT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');
    $nome = collect($resposta->json('configuracoes'))->firstWhere('chave', 'clinica.nome');
    expect($nome['valor'])->toBe('Clínica Fictícia Nova');
});

it('deve aplicar cast por tipo no valor efetivo', function () {
    // ARRANGE — chave bool registrada só para o teste (mecanismo de tipos)
    CatalogoConfiguracoes::estender([
        'clinica.flag_de_teste' => ['rotulo' => 'Bandeira de teste', 'secao' => 'clinica', 'tipo' => 'bool', 'default' => false],
    ]);
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.flag_de_teste',
        'valor' => true,
    ])->assertOk();

    // ASSERT — volta como booleano de verdade, não string
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');
    $flag = collect($resposta->json('configuracoes'))->firstWhere('chave', 'clinica.flag_de_teste');
    expect($flag['valor'])->toBeTrue();
});

it('deve rejeitar chave fora do catálogo sem persistir nada', function () {
    // ARRANGE — abuse case 11
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'chave.fantasma',
        'valor' => 'qualquer',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('chave');
    expect(Configuracao::count())->toBe(0);
});

it('deve rejeitar valor de tipo incompatível mantendo o anterior', function () {
    // ARRANGE
    CatalogoConfiguracoes::estender([
        'clinica.flag_de_teste' => ['rotulo' => 'Bandeira de teste', 'secao' => 'clinica', 'tipo' => 'bool', 'default' => false],
    ]);
    $adminDaClinica = admin();
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.flag_de_teste',
        'valor' => true,
    ])->assertOk();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.flag_de_teste',
        'valor' => 'não-sou-booleano',
    ]);

    // ASSERT
    $resposta->assertUnprocessable()->assertJsonValidationErrors('valor');
    $leitura = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');
    $flag = collect($leitura->json('configuracoes'))->firstWhere('chave', 'clinica.flag_de_teste');
    expect($flag['valor'])->toBeTrue();
});

it('deve aplicar a faixa do catálogo em configuração inteira', function () {
    // ARRANGE — evolucoes.prazo_dias tem faixa 1..3650 (parecer P4, CR-06)
    $adminDaClinica = admin();

    // ACT + ASSERT — fora da faixa → 422; bordas aceitas
    foreach ([0, 3651] as $foraDaFaixa) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'evolucoes.prazo_dias',
            'valor' => $foraDaFaixa,
        ])->assertUnprocessable()->assertJsonValidationErrors('valor');
    }
    foreach ([1, 3650] as $naBorda) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'evolucoes.prazo_dias',
            'valor' => $naBorda,
        ])->assertOk();
    }
});

it('deve registrar a carência da trava de evolução como DADO: default 3, faixa 0..365', function () {
    // ARRANGE — §13 (change trava-de-evolucao, D4): a carência da trava do finalizar é
    // catálogo, nunca if hardcoded; e NÃO é chave de exibição da agenda (D3 — o aviso
    // chega pronto ao front pelo centro de notificações)
    $adminDaClinica = admin();

    // ASSERT — default tipado no catálogo, fora da whitelist de exibição
    expect(CatalogoConfiguracoes::tipo('evolucoes.trava_carencia_dias'))->toBe('int')
        ->and(CatalogoConfiguracoes::default('evolucoes.trava_carencia_dias'))->toBe(3)
        ->and(CatalogoConfiguracoes::CHAVES_EXIBICAO_AGENDA)
        ->not->toContain('evolucoes.trava_carencia_dias');

    // ACT + ASSERT — bordas aceitas (0 = trava logo após o próprio vencimento)
    foreach ([0, 365] as $naBorda) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'evolucoes.trava_carencia_dias',
            'valor' => $naBorda,
        ])->assertOk();
    }

    // fora da faixa e fora do tipo → 422, sem persistir
    foreach ([366, -1, 'três', 2.5] as $invalido) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'evolucoes.trava_carencia_dias',
            'valor' => $invalido,
        ])->assertUnprocessable()->assertJsonValidationErrors('valor');
    }
});

it('deve registrar a janela da pendência de retorno como DADO: default 30, faixa 7..180', function () {
    // ARRANGE — §13 (change protocolo-de-pendencias, D5): o ">1 mês" que a clínica
    // relatou é catálogo, nunca if hardcoded; não é chave de exibição da agenda (a
    // fila chega pronta ao front, como o aviso da trava)
    $adminDaClinica = admin();

    // ASSERT — default tipado no catálogo, fora da whitelist de exibição
    expect(CatalogoConfiguracoes::tipo('agenda.pendencia_retorno_dias'))->toBe('int')
        ->and(CatalogoConfiguracoes::default('agenda.pendencia_retorno_dias'))->toBe(30)
        ->and(CatalogoConfiguracoes::CHAVES_EXIBICAO_AGENDA)
        ->not->toContain('agenda.pendencia_retorno_dias');

    // ACT + ASSERT — bordas aceitas
    foreach ([7, 180] as $naBorda) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'agenda.pendencia_retorno_dias',
            'valor' => $naBorda,
        ])->assertOk();
    }

    // fora da faixa e fora do tipo → 422, sem persistir
    foreach ([6, 181, -1, 'trinta', 2.5] as $invalido) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'agenda.pendencia_retorno_dias',
            'valor' => $invalido,
        ])->assertUnprocessable()->assertJsonValidationErrors('valor');
    }
});

it('deve registrar a ação do conflito de paciente como DADO: default bloquear, enum de 3', function () {
    // ARRANGE — §13 (change conflito-do-paciente, D5): a mesma criança em dois atendimentos
    // sobrepostos é recusada por default, mas a sessão CONJUNTA existe em clínica
    // multidisciplinar — a saída é dado da clínica, nunca um if. E NÃO é chave de exibição:
    // quem decide é o servidor, a grade não redesenha por ela.
    $adminDaClinica = admin();

    // ASSERT — default tipado no catálogo, fora da whitelist de exibição
    expect(CatalogoConfiguracoes::tipo('agenda.conflito_paciente'))->toBe('string')
        ->and(CatalogoConfiguracoes::default('agenda.conflito_paciente'))->toBe('bloquear')
        ->and(CatalogoConfiguracoes::CHAVES_EXIBICAO_AGENDA)
        ->not->toContain('agenda.conflito_paciente');

    // a whitelist chega à tela — sem ela o seletor não tem o que oferecer
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');
    $acao = configDaResposta($resposta->json('configuracoes'), 'agenda.conflito_paciente');
    expect($acao['valor'])->toBe('bloquear')
        ->and($acao['opcoes'])->toBe(['bloquear', 'avisar', 'permitir'])
        ->and($acao['secao'])->toBe('agenda');

    // ACT + ASSERT — as três saídas são aceitas
    foreach (['avisar', 'permitir', 'bloquear'] as $valida) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'agenda.conflito_paciente',
            'valor' => $valida,
        ])->assertOk();
    }

    // fora do enumerado → 422, sem persistir
    foreach (['barrar', '', 'BLOQUEAR', 1] as $invalido) {
        $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
            'chave' => 'agenda.conflito_paciente',
            'valor' => $invalido,
        ])->assertUnprocessable()->assertJsonValidationErrors('valor');
    }

    $depois = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');
    expect(configDaResposta($depois->json('configuracoes'), 'agenda.conflito_paciente')['valor'])
        ->toBe('bloquear');
});

it('deve auditar toda escrita de configuração', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $this->actingAs($adminDaClinica)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.nome',
        'valor' => 'Clínica Auditada',
    ])->assertOk();

    // ASSERT
    $registro = Auditoria::where('entidade', 'configuracoes')->where('acao', 'criou')->firstOrFail();
    expect($registro->diff_json['depois']['chave'])->toBe('clinica.nome')
        ->and($registro->usuario_id)->toBe($adminDaClinica->id);
});

it('deve negar leitura e escrita sem as permissões de configurações', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)->getJson('/api/configuracoes')->assertForbidden();
    $this->actingAs($usuarioSemNivel)->putJsonComVersao('/api/configuracoes', [
        'chave' => 'clinica.nome',
        'valor' => 'x',
    ])->assertForbidden();
    expect(Configuracao::withoutGlobalScopes()->count())->toBe(0);
});

// ─── Metadados de widget na leitura (SEC-ADM-06) ────────────────────────────────────

it('deve expor min e max de uma chave com faixa na leitura', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');

    // ASSERT — granularidade tem faixa 5..120 no catálogo
    $granularidade = configDaResposta($resposta->json('configuracoes'), 'agenda.granularidade_min');
    expect($granularidade['min'])->toBe(5)
        ->and($granularidade['max'])->toBe(120);
});

it('deve expor a whitelist de opções de uma chave enumerada', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');

    // ASSERT
    $fimDeSemana = configDaResposta($resposta->json('configuracoes'), 'agenda.fim_de_semana');
    expect($fimDeSemana['opcoes'])->toBe(['nenhum', 'sabado', 'domingo', 'ambos']);
});

it('não deve inventar campos de metadado numa chave sem eles', function () {
    // ARRANGE — clinica.nome é string pura, sem min/max/opcoes/formato
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');

    // ASSERT
    $nome = configDaResposta($resposta->json('configuracoes'), 'clinica.nome');
    expect($nome)->not->toHaveKey('min')
        ->and($nome)->not->toHaveKey('max')
        ->and($nome)->not->toHaveKey('opcoes')
        ->and($nome)->not->toHaveKey('formato');
});

// ─── Alvos de encadeamento (SEC-ADM-05 / CONFIG-SEM-FK) ─────────────────────────────

it('deve listar como alvos apenas os status que não descontam sessão', function () {
    // ARRANGE — a clínica nasce com os status default (uns descontam, outros não)
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes/alvos-encadeamento');

    // ASSERT — todo id devolvido é de status não-descontante; nenhum descontante entra
    $resposta->assertOk();
    $idsDevolvidos = collect($resposta->json('alvos'))->pluck('id')->sort()->values();
    $idsNaoDescontam = StatusAgendamento::where('desconta_sessao', false)->orderBy('id')->pluck('id');
    expect($idsDevolvidos->all())->toBe($idsNaoDescontam->all())
        ->and($resposta->json('alvos.0'))->toHaveKeys(['id', 'nome']);

    // e a whitelist é fechada: id, nome e se o status libera o horário — a flag que a lista do
    // desmarque pela família filtra (lembrete-com-botoes-de-resposta); nada além de configuração
    expect(array_keys($resposta->json('alvos.0')))->toBe(['id', 'nome', 'ocupa_horario']);
});

it('deve negar os alvos de encadeamento sem configuracoes.ver', function () {
    // ARRANGE
    $usuarioSemNivel = Usuario::factory()->create();

    // ACT + ASSERT
    $this->actingAs($usuarioSemNivel)
        ->getJson('/api/configuracoes/alvos-encadeamento')
        ->assertForbidden();
});

/**
 * RÓTULO E SEÇÃO NA LEITURA (change secoes-das-configuracoes).
 *
 * O que estes testes protegem: a tela não mantém lista própria de rótulos nem de abas.
 * Enquanto mantinha, as duas listas divergiram do catálogo em produção e a administradora
 * da clínica viu `whatsapp.limite_mensal` cru na tela (validação de 2026-08-21).
 */
it('deve trazer rótulo e seção em TODA entrada da leitura', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');

    // ASSERT
    $configuracoes = $resposta->json('configuracoes');
    $semApresentacao = collect($configuracoes)
        ->filter(fn (array $c): bool => ! isset($c['rotulo'], $c['secao']))
        ->pluck('chave')
        ->all();

    expect($configuracoes)->not->toBeEmpty()
        ->and($semApresentacao)->toBe([]);
});

it('deve trazer o BLOCO em toda entrada, e a lista de blocos na ordem', function () {
    /*
     * ARRANGE — o contrato que esta change inventou e que não tinha um único teste: apagar
     * `'bloco' => …` do catálogo OU `'blocos' => …` do controller deixava as duas suítes
     * verdes e matava a tela em produção — sem `blocos` a página morre no render, sem `bloco`
     * toda aba renderiza com ZERO campos, em silêncio (bloqueante CR-B1).
     */
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');
    $configuracoes = $resposta->json('configuracoes');

    // ASSERT — toda entrada tem bloco...
    $semBloco = collect($configuracoes)
        ->filter(fn (array $c): bool => ! isset($c['bloco']))
        ->pluck('chave')
        ->all();
    expect($semBloco)->toBe([]);

    // ...a lista de blocos vem na ordem do catálogo...
    expect($resposta->json('blocos.*.bloco'))->toBe(array_keys(CatalogoConfiguracoes::BLOCOS))
        ->and($resposta->json('blocos.0'))->toBe(['bloco' => 'clinica', 'rotulo' => 'Clínica']);

    // ...e o bloco de cada chave EXISTE na lista: se divergir, o campo some da tela
    $declarados = collect($resposta->json('blocos.*.bloco'));
    $orfas = collect($configuracoes)
        ->reject(fn (array $c): bool => $declarados->contains($c['bloco']))
        ->pluck('chave')
        ->all();
    expect($orfas)->toBe([]);
});

it('deve dar a cada chave o bloco do PREFIXO dela', function () {
    // ARRANGE — é o que faz `whatsapp.*` e `mensagens.*` virarem subtítulos distintos
    // dentro da MESMA aba
    $adminDaClinica = admin();

    // ACT
    $configuracoes = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes')->json('configuracoes');

    // ASSERT
    $whatsapp = configDaResposta($configuracoes, 'whatsapp.limite_mensal');
    $mensagens = configDaResposta($configuracoes, 'mensagens.retencao_dias');

    expect($whatsapp['bloco'])->toBe('whatsapp')
        ->and($mensagens['bloco'])->toBe('mensagens')
        ->and($whatsapp['secao'])->toBe($mensagens['secao']);
});

it('NÃO deve levar metadado de apresentação para a leitura MINIMIZADA da agenda', function () {
    /*
     * ARRANGE — `/agenda/configuracoes` é lido sob `agenda.ver`, não `configuracoes.ver`,
     * justamente para não carregar o catálogo inteiro (T-sag-02). Rótulo e seção são da tela
     * de Configurações e não têm consumidor ali (achado CR-I7).
     */
    $adminDaClinica = admin();

    // ACT
    $configuracoes = $this->actingAs($adminDaClinica)->getJson('/api/agenda/configuracoes')->json('configuracoes');

    // ASSERT — conjunto EXATO, não ausência de três nomes: afirmar `not->toHaveKey` para
    // `rotulo`/`secao`/`bloco` deixaria passar o QUARTO metadado de apresentação que alguém
    // acrescentasse, com a suíte verde (achado CR-IMPORTANTE-1, provado por mutação)
    expect($configuracoes)->not->toBeEmpty();
    foreach ($configuracoes as $config) {
        expect(array_keys($config))->toBe(['chave', 'tipo', 'valor']);
    }
});

it('NÃO deve derrubar a grade quando OUTRA chave do catálogo está incompleta', function () {
    /*
     * ARRANGE — a grade é essencial na tela da agenda: se este endpoint cai, a recepção vê
     * "Não foi possível carregar a agenda". Antes, um `rotulo` faltando em QUALQUER uma das 37
     * chaves derrubava as 8 que a grade lê, porque a projeção passava por `metadados()`
     * (achado SEC-SDC-01).
     */
    $adminDaClinica = admin();
    $incompleta = new ReflectionProperty(CatalogoConfiguracoes::class, 'extras');
    $incompleta->setValue(null, ['financeiro.chave_quebrada' => ['tipo' => 'bool', 'default' => false]]);

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/agenda/configuracoes');

    // ASSERT — a grade continua de pé
    $resposta->assertOk();
    expect($resposta->json('configuracoes'))->not->toBeEmpty();
});

it('deve trazer as seções na ordem das abas, ao lado das configurações', function () {
    // ARRANGE — a ordem não cabe dentro de uma entrada isolada; por isso vem em lista própria
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');

    // ASSERT
    expect($resposta->json('secoes.*.secao'))->toBe(array_keys(CatalogoConfiguracoes::SECOES))
        ->and($resposta->json('secoes.0'))->toBe(['secao' => 'clinica', 'rotulo' => 'Clínica']);
});

it('deve dar a MESMA seção a chaves de prefixos diferentes', function () {
    // ARRANGE — é o ponto da change: a aba deixa de ser o prefixo da chave
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');
    $configuracoes = $resposta->json('configuracoes');

    // ASSERT
    $mensagens = configDaResposta($configuracoes, 'mensagens.retencao_dias');
    $whatsapp = configDaResposta($configuracoes, 'whatsapp.limite_mensal');

    expect($mensagens['secao'])->toBe('comunicacao')
        ->and($whatsapp['secao'])->toBe('comunicacao');
});

it('deve manter os metadados de domínio opcionais, e os de apresentação obrigatórios', function () {
    // ARRANGE
    $adminDaClinica = admin();

    // ACT
    $resposta = $this->actingAs($adminDaClinica)->getJson('/api/configuracoes');
    $configuracoes = $resposta->json('configuracoes');

    // ASSERT — a chave com faixa traz min/max E apresentação
    $granularidade = configDaResposta($configuracoes, 'agenda.granularidade_min');
    expect($granularidade)->toHaveKeys(['min', 'max', 'rotulo', 'secao'])
        ->and($granularidade['secao'])->toBe('agenda');

    // e a chave sem domínio não ganha campos vazios, mas traz apresentação
    $nome = configDaResposta($configuracoes, 'clinica.nome');
    expect($nome)->not->toHaveKey('min')
        ->and($nome)->not->toHaveKey('opcoes')
        ->and($nome['rotulo'])->toBe('Nome da clínica')
        ->and($nome['secao'])->toBe('clinica');
});

it('deve recusar extensão de catálogo sem rótulo ou sem seção', function () {
    // ARRANGE / ACT / ASSERT — a porta valida, para a omissão não virar
    // `Undefined array key` só quando alguém ler a chave
    expect(fn () => CatalogoConfiguracoes::estender([
        'teste.sem_rotulo' => ['secao' => 'clinica', 'tipo' => 'bool', 'default' => false],
    ]))->toThrow(InvalidArgumentException::class, 'teste.sem_rotulo');

    expect(fn () => CatalogoConfiguracoes::estender([
        'teste.secao_inventada' => ['rotulo' => 'Teste', 'secao' => 'inexistente', 'tipo' => 'bool', 'default' => false],
    ]))->toThrow(InvalidArgumentException::class, 'inexistente');

    // e o prefixo sem rótulo de bloco viraria subtítulo cru na tela
    expect(fn () => CatalogoConfiguracoes::estender([
        'prefixo_sem_bloco.flag' => ['rotulo' => 'Teste', 'secao' => 'clinica', 'tipo' => 'bool', 'default' => false],
    ]))->toThrow(InvalidArgumentException::class, 'BLOCOS');
});
