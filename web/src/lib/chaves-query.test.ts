import { describe, expect, it } from 'vitest'

import { chaves } from '@/lib/chaves-query'
import { DETALHES, FABRICA_DA_LISTA, LISTAS, SEM_DETALHE } from '@/test/chaves-classificacao'

/**
 * GUARDA DA FÁBRICA — a FORMA da chave (gatilho CHAVE-DETALHE).
 *
 * A bomba: chave de detalhe SINGULAR (`['tratamento', id]`) contra invalidação de lista PLURAL
 * (`['tratamentos']`). Não são prefixo uma da outra ⇒ **nenhuma invalidação de lista alcança o
 * detalhe**. Onde o formulário de edição hidrata `useState` a partir do `useQuery`, reabrir monta
 * sobre cache velho e a segunda edição seguida REVERTE a primeira, em silêncio. Nos tratamentos
 * isso apagou a **matrícula de um menor**.
 *
 * A guarda IRMÃ (`detalhe-sem-cache.contrato.test.ts`) prende o COMPORTAMENTO (`gcTime: 0`) —
 * porque a chave prefixo-correta, sozinha, **não** impede a reversão. As duas leem a MESMA
 * classificação (`@/test/chaves-classificacao`): lista escrita à mão em cada teste já nasceu
 * divergente uma vez, e a divergência era exatamente o buraco.
 */

describe('Fábrica de chaves — a invalidação da lista alcança o detalhe', () => {
  it.each(DETALHES)('deve fazer de `$nome` um prefixo-extensão da sua lista', ({ chave, lista }) => {
    // ARRANGE — a raiz do namespace é o PRIMEIRO segmento: é com ele que se invalida
    const raiz = LISTAS[lista][0]

    // ACT + ASSERT — `invalidateQueries([raiz])` casa por PREFIXO
    expect(chave[0]).toBe(raiz)
  })

  it('deve manter lista e detalhe DISTINGUÍVEIS dentro do mesmo namespace', () => {
    // ARRANGE: o namespace comum é o objetivo; a COLISÃO não é. O segundo segmento é um objeto
    // de filtro na lista e um number no detalhe — nunca a mesma chave.
    for (const { chave, lista } of DETALHES) {
      // ACT + ASSERT
      expect(JSON.stringify(chave)).not.toBe(JSON.stringify(LISTAS[lista]))
    }
  })
})

describe('Fábrica de chaves — chave nova nasce classificada', () => {
  it('deve ter TODA chave da fábrica classificada: lista, detalhe ou sem-detalhe', () => {
    // ARRANGE — é ESTA asserção que fecha o buraco da memória. Sem ela, a próxima tela
    // acrescenta `chaves.faturamento(id)` na forma singular, ninguém lembra do gatilho, e a bomba
    // volta armada — com a suíte inteira verde.
    const declaradas = new Set<string>([
      ...Object.values(FABRICA_DA_LISTA),
      ...DETALHES.map(({ nome }) => nome),
      ...SEM_DETALHE,
    ])

    // ACT
    const naoClassificadas = Object.keys(chaves).filter((nome) => !declaradas.has(nome))

    // ASSERT
    expect(naoClassificadas).toEqual([])
  })
})

describe('Fábrica de chaves — a seleção do repasse não se mistura com a da grade', () => {
  it('deve dar à seleção com desligados uma chave própria', () => {
    // ARRANGE + ACT — se colidissem, a grade herdaria os desligados da lista do relatório (CR-RPP-32)
    const daGrade = JSON.stringify(chaves.selecaoDaAgenda())
    const doRepasse = JSON.stringify(chaves.selecaoComDesligados())

    // ASSERT
    expect(doRepasse).not.toBe(daGrade)
  })
})
