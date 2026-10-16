import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DETALHES, SEM_CACHE_POR_SER_DADO_DE_MENOR } from '@/test/chaves-classificacao'

/**
 * GUARDA DE COMPORTAMENTO do detalhe — a camada 2 do gatilho CHAVE-DETALHE.
 *
 * A guarda da fábrica (`chaves-query.test.ts`) prova a FORMA da chave. Não basta: **a chave
 * prefixo-correta, sozinha, não impede a reversão**. Invalidar uma query INATIVA apenas a marca
 * *stale* — no remount o `useQuery` devolve o dado do cache no PRIMEIRO render (já `isSuccess`), e
 * é nele que o `useState` do formulário hidrata. O refetch chega depois, atualiza o cache e nunca
 * toca o formulário.
 *
 * Quem impede a reversão é o `gcTime: 0`. Esta guarda torna isso CONTRATO, não disciplina — e a
 * regra é **sem exceção**: julgar "só quando o componente hidrata `useState`" exigiria alguém
 * acertar esse julgamento a cada tela nova, e é o julgamento que falha (nos tratamentos custou a
 * **matrícula de um menor**).
 *
 * ⚠️ Duas lições já pagas, e as duas estão no código abaixo:
 *
 * 1. **A lista de chaves vem da FONTE ÚNICA** (`@/test/chaves-classificacao`). Copiada à mão, ela
 *    nasceu com 5 das 7 — e as 2 que faltavam eram justamente as 2 queries SEM `gcTime: 0`. A
 *    guarda ficava verde por não olhar para o que a reprovava.
 * 2. **O bloco do `useQuery` se acha por CHAVES BALANCEADAS**, nunca pelo `})` no início da linha:
 *    num `useQuery` de UMA LINHA (idioma real desta base) aquela heurística pulava para o `})` do
 *    useQuery SEGUINTE e herdava o `gcTime: 0` do vizinho — falso-negativo VERDE sobre código que
 *    viola (re-review r9).
 *
 * E **nada passa em silêncio**: uso de chave de detalhe que a guarda não consiga classificar vira
 * FALHA, não passe-livre. O modo de falha de uma guarda tem de ser vermelho.
 */

// `process.cwd()`, como o `design-system.contrato.test` já faz: o `import.meta.url` do Vite
// resolve para o caminho SERVIDO (`/src`), não para o do disco.
const RAIZ = join(process.cwd(), 'src')

/** Quem ABRE uma consulta observável (a que hidrata formulário e, por isso, deve `gcTime: 0`). */
const CONSULTAS = ['useQuery(', 'useSuspenseQuery(', 'useInfiniteQuery(']

/** Onde a chave aparece SEM ser consulta — invalidar/escrever/prefetch não pede `gcTime`. */
const NAO_E_CONSULTA = [
  'invalidateQueries(',
  'setQueryData(',
  'getQueryData(',
  'cancelQueries(',
  'removeQueries(',
  'refetchQueries(',
  'resetQueries(',
  'prefetchQuery(',
  'fetchQuery(',
  'ensureQueryData(',
]

function arquivosDeFonte(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name)

    if (entrada.isDirectory()) {
      return arquivosDeFonte(caminho)
    }

    const ehFonte = ['.ts', '.tsx'].includes(extname(entrada.name))

    return ehFonte && !entrada.name.includes('.test.') ? [caminho] : []
  })
}

/** Sem comentários — senão a guarda casa o `gcTime: 0` do comentário que EXPLICA o `gcTime: 0`. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Os blocos de opções de cada consulta, por CHAVES BALANCEADAS — do `{` que abre até o `}` que o
 * fecha. Vale para `useQuery` de uma linha, de vinte, e com `select: (d) => ({ ...d })` dentro.
 */
function blocosDeConsulta(fonte: string): Array<{ inicio: number; fim: number; corpo: string }> {
  const blocos: Array<{ inicio: number; fim: number; corpo: string }> = []

  for (const consulta of CONSULTAS) {
    for (let i = fonte.indexOf(consulta); i !== -1; i = fonte.indexOf(consulta, i + 1)) {
      const abre = fonte.indexOf('{', i)
      if (abre === -1) {
        continue
      }

      let profundidade = 0
      for (let j = abre; j < fonte.length; j++) {
        if (fonte[j] === '{') {
          profundidade++
        } else if (fonte[j] === '}') {
          profundidade--

          if (profundidade === 0) {
            blocos.push({ inicio: i, fim: j, corpo: fonte.slice(abre, j + 1) })
            break
          }
        }
      }
    }
  }

  return blocos
}

describe('Detalhe no cache — o formulário não monta sobre o dado velho', () => {
  it('deve exigir `gcTime: 0` em todo useQuery de chave de detalhe', () => {
    const faltando: string[] = []

    // ACT
    for (const arquivo of arquivosDeFonte(RAIZ)) {
      const fonte = semComentarios(readFileSync(arquivo, 'utf-8'))
      const nome = arquivo.replace(RAIZ, '')
      const blocos = blocosDeConsulta(fonte)

      // DETALHES pela razão original (reversão de formulário) + as que entram pela outra razão:
      // dado de menor no cache de uma máquina compartilhada
      const vigiadas = [...DETALHES.map(({ nome }) => nome), ...SEM_CACHE_POR_SER_DADO_DE_MENOR]

      for (const chave of vigiadas) {
        const alvo = `queryKey: chaves.${chave}(`

        for (let i = fonte.indexOf(alvo); i !== -1; i = fonte.indexOf(alvo, i + 1)) {
          const dentroDaConsulta = blocos.find((bloco) => i > bloco.inicio && i < bloco.fim)

          if (dentroDaConsulta !== undefined) {
            if (!dentroDaConsulta.corpo.includes('gcTime: 0')) {
              faltando.push(`${nome} (chaves.${chave})`)
            }
            continue
          }

          // Fora de uma consulta: só é legítimo em invalidar/escrever/prefetch. Qualquer outro
          // uso é DESCONHECIDO — e desconhecido vira FALHA, nunca passe-livre: era assim que a
          // guarda anterior ignorava `useSuspenseQuery` e opções içadas para uma variável.
          const antes = fonte.slice(0, i)
          const ehOperacaoDeCache = NAO_E_CONSULTA.some((metodo) => {
            const ocorrencia = antes.lastIndexOf(metodo)

            return ocorrencia !== -1 && i - ocorrencia < 120
          })

          if (!ehOperacaoDeCache) {
            faltando.push(
              `${nome} (chaves.${chave}) — chave de detalhe fora de uma consulta reconhecida: `
              + 'classifique o uso ou ensine a guarda',
            )
          }
        }
      }
    }

    // ASSERT
    expect(
      faltando,
      [
        'useQuery de chave de DETALHE sem `gcTime: 0`.',
        '',
        'A chave prefixo-correta faz a invalidação da lista ALCANÇAR o detalhe — mas query',
        'inativa invalidada só fica stale: no remount, o primeiro render ainda serve o CACHE,',
        'e é nele que o `useState` do formulário hidrata. A segunda edição seguida reverte a',
        'primeira, em silêncio. Nos tratamentos isso apagou a matrícula de um MENOR.',
        '',
        `Sites: ${faltando.join(' · ')}`,
      ].join('\n'),
    ).toEqual([])
  })
})
