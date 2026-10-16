import { describe, expect, it } from 'vitest'

import {
  destacarMencoes,
  detectarGatilho,
  filtrarParticipantes,
  inserirMencao,
  mencoesAindaNoTexto,
} from '@/lib/mencoes-de-tarefa'
import type { ParticipanteDoMural } from '@/tipos'

const ANA: ParticipanteDoMural = { id: 1, nome: 'Ana' }
const ANA_CLARA: ParticipanteDoMural = { id: 2, nome: 'Ana Clara' }
const JOSE: ParticipanteDoMural = { id: 3, nome: 'José Fictício' }

describe('detectarGatilho', () => {
  it('deve detectar o @ sob o cursor, inclusive com acento', () => {
    // ACT + ASSERT — a consulta é o que veio depois do @
    expect(detectarGatilho('chamando @Jos', 13)).toEqual({ consulta: 'Jos', inicio: 9 })
    expect(detectarGatilho('oi @José', 8)).toEqual({ consulta: 'José', inicio: 3 })
    expect(detectarGatilho('só @', 4)).toEqual({ consulta: '', inicio: 3 })
  })

  it('deve ignorar @ longe do cursor ou seguido de espaço', () => {
    // ACT + ASSERT
    expect(detectarGatilho('@Ana já mencionada', 18)).toBeNull()
    expect(detectarGatilho('sem arroba nenhum', 17)).toBeNull()
  })
})

describe('filtrarParticipantes', () => {
  it('deve casar sem acento e sem caixa, com teto de 8', () => {
    // ARRANGE
    const muitos = Array.from({ length: 12 }, (_, i) => ({ id: 10 + i, nome: `Pessoa ${i}` }))

    // ACT + ASSERT
    expect(filtrarParticipantes([ANA, JOSE], 'jose')).toEqual([JOSE])
    expect(filtrarParticipantes(muitos, 'pessoa')).toHaveLength(8)
    expect(filtrarParticipantes([ANA, ANA_CLARA], '')).toEqual([ANA, ANA_CLARA])
  })
})

describe('inserirMencao', () => {
  it('deve substituir o gatilho por @Nome e reposicionar o cursor', () => {
    // ARRANGE
    const texto = 'chamando @Jos para cá'
    const gatilho = detectarGatilho(texto, 13)

    // ACT
    const resultado = inserirMencao(texto, gatilho!, 13, 'José Fictício')

    // ASSERT
    expect(resultado.texto).toBe('chamando @José Fictício  para cá')
    expect(resultado.cursor).toBe('chamando @José Fictício '.length)
  })
})

describe('mencoesAindaNoTexto', () => {
  it('deve remover do payload a menção apagada do texto', () => {
    // ACT + ASSERT — o texto é a fonte da verdade
    expect(mencoesAindaNoTexto('oi @Ana', [ANA, JOSE])).toEqual([ANA])
  })
})

describe('destacarMencoes', () => {
  it('deve casar o nome MAIS LONGO primeiro (@Ana Clara antes de @Ana)', () => {
    // ACT
    const segmentos = destacarMencoes('oi @Ana Clara e @Ana', [ANA, ANA_CLARA])

    // ASSERT — lição do original: ordenar do mais longo para o mais curto
    expect(segmentos).toEqual([
      { tipo: 'texto', valor: 'oi ' },
      { tipo: 'mencao', valor: '@Ana Clara', usuarioId: 2 },
      { tipo: 'texto', valor: ' e ' },
      { tipo: 'mencao', valor: '@Ana', usuarioId: 1 },
    ])
  })

  it('deve devolver texto puro quando não há mencionados', () => {
    // ACT + ASSERT
    expect(destacarMencoes('sem menção', [])).toEqual([{ tipo: 'texto', valor: 'sem menção' }])
    expect(destacarMencoes('', [ANA])).toEqual([])
  })
})
