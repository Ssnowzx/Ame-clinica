<?php

use App\Support\Configuracoes\CatalogoConfiguracoes as Catalogo;

/*
 * `extras` é estado ESTÁTICO: se a asserção do meio de um teste falhar, a chave fictícia fica
 * registrada no processo e contamina todo o resto da execução. O restore na última linha do
 * teste só roda quando o teste passa — exatamente quando não é preciso. `ConfiguracoesTest`
 * já tem esta linha; o Unit não tinha (higiene apontada no gate de segurança da rodada 3).
 */
afterEach(fn () => Catalogo::limparExtensoes());

/**
 * O catálogo das configurações (change secoes-das-configuracoes).
 *
 * O que estes testes protegem: o nome que a clínica lê e a aba onde a chave aparece são
 * METADADO DO SERVIDOR, não conhecimento do front. Antes desta change o front mantinha
 * duas listas paralelas — prefixo → aba e chave → rótulo —, e elas divergiram em produção:
 * a change `mensageria-whatsapp` acrescentou as chaves `whatsapp.*`, ninguém atualizou as
 * listas, e a administradora da clínica viu `whatsapp.limite_mensal` cru na tela.
 *
 * A garantia aqui é mecânica: chave sem rótulo, sem seção, ou com seção inexistente derruba
 * a suíte apontando a chave — antes de a tela ser exercitada.
 */
it('deve validar o catálogo pela regra que o servidor usa, não por uma cópia dela', function () {
    /*
     * ARRANGE — `validarCatalogo()` é a fonte única da exigência. Este teste tem de cair se
     * ela for esvaziada: `not->toThrow` sozinho é satisfeito por um método vazio, e foi assim
     * que a versão anterior passou 8/8 com o corpo apagado (achado CR, mutação MF).
     *
     * Provamos os dois lados: o catálogo real passa, e uma chave incompleta é REJEITADA
     * nomeando a chave — o que só acontece se a regra estiver de fato lá dentro.
     */
    $extras = new ReflectionProperty(Catalogo::class, 'extras');

    // ACT / ASSERT — o catálogo de produção passa
    $extras->setValue(null, []);
    expect(fn () => Catalogo::validarCatalogo())->not->toThrow(InvalidArgumentException::class);

    // ...e a chave incompleta é apontada pelo nome
    $extras->setValue(null, ['financeiro.sem_rotulo' => ['secao' => 'financeiro', 'tipo' => 'bool', 'default' => false]]);
    expect(fn () => Catalogo::validarCatalogo())
        ->toThrow(InvalidArgumentException::class, 'financeiro.sem_rotulo');

    $extras->setValue(null, []);
});

it('deve dar rótulo em português a toda seção, na ordem das abas', function () {
    // ARRANGE / ACT
    $secoes = Catalogo::SECOES;

    // ASSERT — a ORDEM do array é a ordem das abas; a tela não reordena
    expect(array_keys($secoes))->toBe([
        'clinica', 'agenda', 'atendimento', 'financeiro', 'comunicacao', 'seguranca',
    ]);

    foreach ($secoes as $slug => $rotulo) {
        expect($rotulo)->not->toBe($slug)
            ->and($rotulo)->not->toBe('');
    }
});

it('NÃO deve deixar nenhuma seção com menos de dois controles', function () {
    /*
     * ARRANGE — é o objetivo da change, e sem esta rede ele se perde na primeira chave
     * nova. Antes dela, `notificacoes.a_partir_de` e `mensagens.retencao_dias` ocupavam
     * uma aba inteira cada, para um controle só.
     */
    $porSecao = [];

    // ACT — parte de SECOES, não de todas(): contando só as seções que TÊM chave, uma seção
    // declarada e vazia passava no teste que promete "menos de dois" (achado CR-nit-3)
    foreach (array_keys(Catalogo::SECOES) as $secao) {
        $porSecao[$secao] = 0;
    }
    foreach (Catalogo::todas() as $definicao) {
        $porSecao[$definicao['secao']] = ($porSecao[$definicao['secao']] ?? 0) + 1;
    }

    // ASSERT
    $magras = array_keys(array_filter($porSecao, fn (int $n): bool => $n < 2));
    expect($magras)->toBe([]);
});

it('deve manter o rótulo da chave livre de identificador de máquina', function () {
    // ARRANGE — o defeito de 2026-08-21 era exatamente o slug chegando à tela
    $comSlug = [];

    // ACT
    foreach (Catalogo::todas() as $chave => $definicao) {
        $rotulo = $definicao['rotulo'] ?? '';
        $sufixo = str_contains($chave, '.') ? substr($chave, strpos($chave, '.') + 1) : $chave;
        // o sufixo CRU sem separador escapava: 'whatsapp.automatico' => 'automatico' passava
        // nas três checagens e chegava assim à clínica (achado CR-nit-4)
        if (
            str_contains($rotulo, '.') || str_contains($rotulo, '_')
            || $rotulo === $chave || $rotulo === $sufixo
        ) {
            $comSlug[] = $chave;
        }
    }

    // ASSERT
    expect($comSlug)->toBe([]);
});

it('deve manter o WhatsApp como PRIMEIRO bloco de Comunicação', function () {
    /*
     * ARRANGE — decisão tomada com o usuário depois de ver a tela: é o assunto mais
     * procurado ali e o único que leva a outra página. Ela vive na ORDEM do array `BLOCOS`,
     * e nada a afirmava: alfabetizar a constante derrubava o WhatsApp para 4º com as duas
     * suítes verdes (achado CR-I4).
     */
    $daComunicacao = array_values(array_filter(
        array_keys(Catalogo::BLOCOS),
        fn (string $bloco): bool => in_array($bloco, ['whatsapp', 'mensagens', 'lembretes', 'notificacoes'], true),
    ));

    // ACT / ASSERT
    expect($daComunicacao[0])->toBe('whatsapp');
});

it('deve recusar chave sem apresentação na leitura, e não só na validação do catálogo', function () {
    /*
     * ARRANGE — `metadados()` chama `exigirApresentacao()` como defesa em profundidade, e
     * remover essa linha deixava 26 + 1185 testes verdes (achado SEC-SDC-R3-03).
     *
     * A guarda não ficou descoberta por descuido: ao tirar `/agenda/configuracoes` de
     * `todasEfetivas()`, o único caminho de teste que injetava chave incompleta passou a
     * apontar para o endpoint que NÃO chama `metadados()`. Foi efeito colateral do próprio
     * conserto — e é por isso que ela precisa de teste direto, não herdado de um endpoint.
     */
    $extras = new ReflectionProperty(Catalogo::class, 'extras');
    $extras->setValue(null, ['financeiro.chave_quebrada' => ['secao' => 'financeiro', 'tipo' => 'bool', 'default' => false]]);

    // ACT + ASSERT — a leitura aponta a CHAVE, em vez de estourar `Undefined array key`
    expect(fn () => Catalogo::metadados('financeiro.chave_quebrada'))
        ->toThrow(InvalidArgumentException::class, 'financeiro.chave_quebrada');
});

it('deve manter FIXO o conjunto de chaves que a agenda expõe sob agenda.ver', function () {
    /*
     * ARRANGE — a allowlist fecha por omissão para chave NOVA do catálogo, e isso está provado.
     * O buraco é o outro sentido: ALARGAR a lista não custava nada e não acordava ninguém.
     * O único teste que reagia nomeava duas chaves — uma lista de NEGAÇÃO, que é o mesmo
     * defeito que esta change corrigiu um andar acima. Acrescentar `seguranca.aprovacao_dupla`
     * e `whatsapp.limite_mensal` deixava 54 testes verdes (achado SEC-SDC-R3-02).
     *
     * Fixado POSITIVAMENTE: entregar mais uma chave à recepção passa a exigir editar este
     * teste — e um revisor ver.
     */
    // ACT / ASSERT
    expect(Catalogo::CHAVES_EXIBICAO_AGENDA)->toBe([
        'agenda.granularidade_min',
        'agenda.fim_de_semana',
        'agenda.visao_padrao',
        'agenda.janela_padrao_inicio',
        'agenda.janela_padrao_fim',
        'agenda.arrastar_para_remarcar',
        'clinica.timezone',
        'evolucoes.responsavel_tecnico_obrigatorio',
        'evolucoes.status_ao_salvar',
    ]);
});
