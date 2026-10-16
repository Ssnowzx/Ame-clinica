import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * GUARDA DE CONTRATO — **as correções de acessibilidade desta casa não voltam sozinhas**.
 *
 * A rodada 2 do gate (2026-08-28) provou o buraco: apagou cada uma das três correções de a11y e
 * os 1335 testes continuaram verdes. Teste que não cai quando a guarda some não é teste — e o
 * `jest-axe` sobre jsdom **não avalia contraste nem tamanho de alvo**, então esse ângulo nunca
 * teve gate nenhum aqui.
 *
 * Estas guardas são de TEXTO. Elas não medem pixel: fixam a decisão no código, para que desfazê-la
 * seja uma escolha visível no diff, e não um descuido que passa verde.
 *
 * O que elas NÃO cobrem, dito com todas as letras: se a cor resolvida ainda passa em AA (isso é
 * medição em navegador), se o leitor de tela de fato anuncia, e qualquer coisa em `forced-colors`.
 */

const RAIZ = join(process.cwd(), 'src')

function fonte(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8')
}

/** Só o código que RENDERIZA — comentário explicando a decisão não conta como uso. */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('Manual — o token de desabilitado não volta a pintar texto ativo', () => {
  it.each([
    ['a página', 'paginas/pagina-manual.tsx'],
    ['o índice', 'componentes/manual/indice-do-manual.tsx'],
    ['a seção', 'componentes/manual/secao-do-manual.tsx'],
    ['o bloco', 'componentes/manual/bloco-do-manual.tsx'],
  ])('deve não usar texto-desativado em %s', (_onde, caminho) => {
    // ARRANGE + ACT: `--texto-desativado` é `--neutro-400` e mede 2,48:1 sobre a superfície —
    // abaixo do piso AA de 4,5. Ele existe para o estado DESABILITADO, onde 1.4.3 isenta.
    // O manual o usava no rótulo "Neste manual" e nos numerais do índice, que são texto ativo.
    const codigo = semComentarios(fonte(caminho))

    // ASSERT
    expect(codigo).not.toMatch(/text-texto-desativado/)
  })
})

describe('Identidade da clínica — o foco não some de novo no rádio recortado', () => {
  it('deve levar o foco do rádio sr-only para a caixa visível', () => {
    // ARRANGE: o input é `sr-only` (clipado em 1×1px), então o `:focus-visible` universal é
    // pintado dentro da caixa recortada e não aparece. Sem o `peer`, quem navega por teclado
    // não vê onde está, entre quatro caixas iguais (2.4.7).
    const codigo = semComentarios(fonte('componentes/administracao/secao-identidade-da-clinica.tsx'))

    // ACT
    const temPeerNoInput = /className="peer sr-only"/.test(codigo)
    const temAnelNoVisivel = /peer-focus-visible:outline-2/.test(codigo)

    // ASSERT
    expect(temPeerNoInput && temAnelNoVisivel).toBe(true)
  })

  it('deve manter a região viva SEMPRE montada, com o texto condicional dentro', () => {
    // ARRANGE: região `status` inserida já com conteúdo é o caso historicamente não confiável —
    // parte das combinações leitor/navegador só observa mutações de regiões que já existiam
    // (achado A11Y-04, fechado em `secao-campos-do-cadastro` e reaberto aqui uma vez).
    const codigo = semComentarios(fonte('componentes/administracao/secao-identidade-da-clinica.tsx'))

    // ACT: toda região viva desta tela abre com a div e só depois condiciona o conteúdo
    const regioes = [...codigo.matchAll(/<div role="status" aria-live="polite">\s*\n\s*\{/g)]

    // ASSERT: as duas (aviso de não salvo e aviso de logo sem arquivo)
    expect(regioes).toHaveLength(2)
    expect(codigo).not.toMatch(/\{[^}]*\?\s*\(\s*\n?\s*<(p|div)[^>]*role="status"/)
  })
})

describe('País do telefone — o foco não some no select transparente', () => {
  it('deve levar o anel de foco do <select> transparente para a caixa da bandeira', () => {
    // ARRANGE: o `<select>` nativo fica por cima da caixa visível com `opacity-0` (change
    // telefone-estrangeiro). O `:focus-visible` universal é pintado nele — e some junto com ele, pela
    // opacidade. Sem o `peer`, quem navega por teclado não vê que está no país (2.4.7)
    const codigo = semComentarios(fonte('componentes/pacientes/seletor-do-pais.tsx'))

    // ACT
    const transparenteComPeer = /className="peer absolute[^"]*opacity-0/.test(codigo)
    const anelNaCaixa = /'peer-focus-visible:border-foco peer-focus-visible:outline-2/.test(codigo)

    // ASSERT
    expect(transparenteComPeer && anelNaCaixa).toBe(true)
  })

  it('deve esconder do leitor de tela a caixa visível, que repetiria o país', () => {
    // ARRANGE + ACT: quem usa leitor de tela ouve o `<select>` ("País do telefone, Reino Unido +44")
    const codigo = semComentarios(fonte('componentes/pacientes/seletor-do-pais.tsx'))

    // ASSERT
    expect(codigo).toMatch(/<span\s+aria-hidden="true"\s+className=\{cn\(\s*'flex size-full/)
  })
})
