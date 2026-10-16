import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * GUARDA DE CONTRATO — **a moldura do shell tem UMA medida, e ela mora no token**.
 *
 * Quem precisa de altura contida (rolar por dentro em vez de esticar o documento) desconta a
 * moldura do shell da viewport. Esse desconto é uma MEDIÇÃO — 88px acima, 24px abaixo — e
 * medição copiada diverge.
 *
 * Ela divergiu: `pagina-mensagens` carregava a própria constante, `6.25rem` (100px) contra os
 * 112px reais, e por isso aquela página **transbordava o documento em 12px** desde que nasceu.
 * Ninguém viu, porque 12px de rolagem não parecem defeito — parecem página comprida. Só
 * apareceu quando a change `agenda-no-mouse` precisou do mesmo número e o mediu.
 *
 * O que esta guarda cobre e o que NÃO cobre, dito com todas as letras:
 *
 * - **COBRE** a duplicação: nenhuma tela pode descontar a viewport com um comprimento cru.
 *   É a classe de defeito que já mordeu, e a única que dá para pegar sem navegador.
 * - **NÃO COBRE** o envelhecimento: se alguém aumentar o cabeçalho do shell, o token fica
 *   errado e as páginas transbordam em silêncio, com esta guarda verde. O jsdom não calcula
 *   layout (`vite.config.ts` tem `css: false`), então a única prova possível é medição em
 *   navegador — e ela mora nas tarefas 7.1/7.2 da change. Guarda que não diz o que não cobre
 *   é guarda que engana.
 */

// `process.cwd()`, como as outras guardas de contrato desta casa: o `import.meta.url` do Vite
// resolve para o caminho SERVIDO (`/src`), não para o do disco.
const RAIZ = join(process.cwd(), 'src')

/** Desconto de viewport com comprimento CRU — `calc(100dvh-6.25rem)`, `calc(100vh - 100px)`… */
const DESCONTO_CRU = /calc\(\s*100d?vh\s*-\s*[\d.]+(px|rem|em)/

function arquivosDeCodigo(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((item) => {
    const caminho = join(diretorio, item.name)
    if (item.isDirectory()) {
      return arquivosDeCodigo(caminho)
    }
    return ['.ts', '.tsx'].includes(extname(item.name)) && !item.name.includes('.test.')
      ? [caminho]
      : []
  })
}

describe('a moldura do shell tem uma medida só', () => {
  it('NENHUMA tela deve descontar a viewport com um comprimento cru', () => {
    // ARRANGE
    const infratores: string[] = []

    // ACT
    for (const arquivo of arquivosDeCodigo(RAIZ)) {
      const conteudo = readFileSync(arquivo, 'utf-8')
      for (const [indice, linha] of conteudo.split('\n').entries()) {
        // comentário não é código: o porquê do token cita os números de propósito
        if (linha.trimStart().startsWith('//') || linha.trimStart().startsWith('*')) {
          continue
        }
        if (DESCONTO_CRU.test(linha)) {
          infratores.push(`${arquivo.replace(RAIZ, 'src')}:${indice + 1} — ${linha.trim()}`)
        }
      }
    }

    // ASSERT — o desconto passa por `var(--moldura-do-shell)`, nunca por número aqui
    expect(infratores).toEqual([])
  })

  it('deve haver quem USE o token — guarda que não guarda nada fica verde sozinha', () => {
    /*
     * ARRANGE — sem esta segunda asserção, apagar as duas telas que usam a moldura deixaria a
     * primeira verde para sempre, e a guarda viraria decoração. É a lição do
     * `expect(x).toContainElement(x)` que o gate achou na change vizinha.
     */
    const usos = arquivosDeCodigo(RAIZ).filter((arquivo) =>
      readFileSync(arquivo, 'utf-8').includes('var(--moldura-do-shell)'),
    )

    // ASSERT
    expect(usos.length).toBeGreaterThanOrEqual(2)
  })
})
