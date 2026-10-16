<?php

use App\Support\Configuracoes\CatalogoConfiguracoes;
use Tests\Arquitetura\Fontes;

/**
 * A FRONTEIRA ENTRE CHAVE E RÓTULO, agora fechada (change secoes-das-configuracoes).
 *
 * Este arquivo nasceu para tapar um buraco: o catálogo nascia no servidor e era EXIBIDO no
 * front, que mantinha o próprio dicionário e caía para a CHAVE CRUA quando não conhecia uma.
 * Foi assim que a change `mensageria-whatsapp` acrescentou nove configurações e a
 * administradora da clínica viu `whatsapp.limite_mensal` na tela (produção, 2026-08-21).
 *
 * A fronteira deixou de existir: `rotulo` e `secao` são declarados ao lado da chave, e
 * `CatalogoConfiguracoesTest` cobra os dois sobre o catálogo de verdade. O que sobra é a
 * guarda da VOLTA — e ela varre `web/src` INTEIRO, não um arquivo.
 *
 * A versão anterior lia só `configuracoes-rotulos.ts` e proibia o NOME de uma constante:
 * recriar o mapa em `pagina-configuracoes.tsx`, num arquivo novo ou num hook passava por
 * baixo com a suíte verde. É a lição que `Fontes::doApp()` já documenta — guarda que não
 * cobre a fonte por onde o defeito de fato volta é decoração.
 */
it('NÃO deve haver dicionário de rótulos de configuração em NENHUM arquivo do front', function () {
    // ARRANGE
    $chaves = array_keys(CatalogoConfiguracoes::todas());
    $fontes = Fontes::doWeb();

    // ACT
    $reincidencias = [];
    foreach ($fontes as $caminho => $conteudo) {
        foreach ($chaves as $chave) {
            if (str_contains($conteudo, "'{$chave}':") || str_contains($conteudo, "\"{$chave}\":")) {
                $reincidencias[] = "{$caminho} → {$chave}";
            }
        }
    }

    // ASSERT
    expect($fontes)->not->toBeEmpty()
        ->and($reincidencias)->toBe(
            [],
            'Rótulo de configuração voltou para o front. Ele vive no catálogo do servidor desde a '
            .'change secoes-das-configuracoes — duplicá-lo reabre o defeito de 2026-08-21.'
        );
});

it('NÃO deve haver lista de grupos por prefixo em NENHUM arquivo do front', function () {
    // ARRANGE — a aba era o prefixo da chave, e a lista prefixo → rótulo vivia no front
    $fontes = Fontes::doWeb();

    // ACT
    $reincidencias = [];
    foreach ($fontes as $caminho => $conteudo) {
        if (str_contains($conteudo, 'GRUPOS_DE_CONFIGURACAO') || str_contains($conteudo, "prefixo: '")) {
            $reincidencias[] = $caminho;
        }
    }

    // ASSERT
    expect($reincidencias)->toBe([]);
});

it('deve manter o rótulo e a seção ao lado da chave que eles descrevem', function () {
    // ARRANGE / ACT — o outro lado da mesma moeda: o servidor tem de saber os dois
    $incompletas = collect(CatalogoConfiguracoes::todas())
        ->reject(fn (array $definicao): bool => isset($definicao['rotulo'], $definicao['secao']))
        ->keys();

    // ASSERT
    expect($incompletas->all())->toBe([]);
});

/**
 * A fábrica de teste do front tem de espelhar o catálogo — slug E rótulo.
 *
 * Sem esta guarda, `SECOES_FICTICIAS`/`BLOCOS_FICTICIOS` são listas redigitadas à mão sem
 * amarração nenhuma: o gate provou que trocar `'Comunicação'` por `'Comunicacao'` e
 * `'WhatsApp'` por `'Whatsapp'` deixava 81 testes verdes (achado CR-IMPORTANTE-3). É a tese
 * desta change — "nenhuma lista manual paralela ao catálogo" — reaparecendo uma camada
 * abaixo, e justamente na suíte que existe para provar que o artefato de 2026-08-21 acabou.
 *
 * A fixture mente barato: um teste de tela que passa contra um servidor que não pode existir
 * não prova nada sobre o servidor que existe.
 */
it('deve manter a fábrica de teste do front espelhando as listas do catálogo', function () {
    // ARRANGE
    $caminho = dirname(__DIR__, 3).'/web/src/test/dados-configuracoes.ts';
    expect($caminho)->toBeReadableFile();
    $fonte = file_get_contents($caminho);

    // ACT — lê as duas listas da fábrica como o front as declara
    $lidas = [];
    foreach (['secao' => 'SECOES_FICTICIAS', 'bloco' => 'BLOCOS_FICTICIOS'] as $campo => $constante) {
        // o corpo do literal, e NÃO a anotação de tipo: `LeituraDeConfiguracoes['secoes']`
        // tem um `]` antes da lista, e cortar no primeiro fechava o trecho vazio
        preg_match("/export const {$constante}[^=]*=\s*\[(.*?)^\]/ms", $fonte, $literal);
        $trecho = $literal[1] ?? '';
        preg_match_all("/\{ {$campo}: '([^']+)', rotulo: '([^']+)' \}/u", $trecho, $casos, PREG_SET_ORDER);
        $lidas[$constante] = array_combine(
            array_column($casos, 1),
            array_column($casos, 2),
        );
    }

    // ASSERT — mesmos slugs, mesma ORDEM e mesmos rótulos que o servidor publica
    expect($lidas['SECOES_FICTICIAS'])->toBe(
        CatalogoConfiguracoes::SECOES,
        'A fábrica de teste do front divergiu das seções do catálogo.'
    )->and($lidas['BLOCOS_FICTICIOS'])->toBe(
        CatalogoConfiguracoes::BLOCOS,
        'A fábrica de teste do front divergiu dos blocos do catálogo.'
    );
});
