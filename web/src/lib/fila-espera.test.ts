import { describe, expect, it } from 'vitest'

import { filtrarFila, ordenarFila, rotuloDaPrioridade, tempoDeEspera } from '@/lib/fila-espera'
import type { EntradaDaFila } from '@/tipos'

function entrada(sobrescritas: Partial<EntradaDaFila> = {}): EntradaDaFila {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    paciente_id: 10,
    especialidade_id: null,
    profissional_id: null,
    prioridade: 0,
    obs: null,
    created_at: '2026-07-01T12:00:00.000000Z',
    paciente: { id: 10, nome: 'Paciente Fictício', nome_social: null },
    especialidade: null,
    profissional: null,
    ...sobrescritas,
  }
}

describe('ordenarFila', () => {
  it('deve pôr a prioridade maior primeiro e desempatar pela chegada', () => {
    // ARRANGE
    const fila = [
      entrada({ id: 1, prioridade: 0, created_at: '2026-07-01T09:00:00Z' }),
      entrada({ id: 2, prioridade: 10, created_at: '2026-07-05T09:00:00Z' }),
      entrada({ id: 3, prioridade: 10, created_at: '2026-07-02T09:00:00Z' }),
    ]

    // ACT
    const ordenada = ordenarFila(fila)

    // ASSERT — urgente que chegou antes vem antes; o normal fica por último
    expect(ordenada.map((item) => item.id)).toEqual([3, 2, 1])
  })
})

describe('rotuloDaPrioridade', () => {
  it('deve nomear os três degraus da tela', () => {
    // ARRANGE + ACT + ASSERT
    expect(rotuloDaPrioridade(0)).toBe('Normal')
    expect(rotuloDaPrioridade(5)).toBe('Alta')
    expect(rotuloDaPrioridade(10)).toBe('Urgente')
  })

  it('deve exibir valor fora dos degraus sem escondê-lo', () => {
    // ARRANGE — a prioridade é 0–10 no dado: a tela não pode fingir que 7 não existe
    // ACT + ASSERT
    expect(rotuloDaPrioridade(7)).toBe('Prioridade 7')
  })
})

describe('tempoDeEspera', () => {
  it('deve contar os dias inteiros de espera', () => {
    // ARRANGE
    const agora = new Date('2026-07-11T10:00:00Z')

    // ACT + ASSERT
    expect(tempoDeEspera('2026-07-11T08:00:00Z', agora)).toBe('hoje')
    expect(tempoDeEspera('2026-07-10T08:00:00Z', agora)).toBe('há 1 dia')
    expect(tempoDeEspera('2026-07-06T08:00:00Z', agora)).toBe('há 5 dias')
  })

  it('deve tratar data inválida como zero dias', () => {
    // ARRANGE + ACT + ASSERT — dado torto do servidor não quebra a fila
    expect(tempoDeEspera('banana')).toBe('hoje')
  })
})

describe('filtrarFila', () => {
  it('deve manter quem espera pelo profissional em foco e quem não escolheu ninguém', () => {
    // ARRANGE — entrada sem desejo cabe em QUALQUER horário que abrir
    const fila = [
      entrada({ id: 1, profissional_id: 7 }),
      entrada({ id: 2, profissional_id: 9 }),
      entrada({ id: 3, profissional_id: null }),
    ]

    // ACT
    const daVisao = filtrarFila(fila, { profissionalId: 7 })

    // ASSERT
    expect(daVisao.map((item) => item.id)).toEqual([1, 3])
  })

  it('deve devolver a fila inteira quando não há foco', () => {
    // ARRANGE
    const fila = [entrada({ id: 1, profissional_id: 7 }), entrada({ id: 2, especialidade_id: 3 })]

    // ACT
    const semFoco = filtrarFila(fila, { profissionalId: null, especialidadeId: null })

    // ASSERT
    expect(semFoco).toHaveLength(2)
  })
})
