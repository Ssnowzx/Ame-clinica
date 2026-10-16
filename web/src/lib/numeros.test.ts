import { describe, expect, it } from 'vitest'

import { formatarContagem } from '@/lib/numeros'

describe('Contagens em pt-BR', () => {
  it('deve agrupar milhares no formato pt-BR e não vazar NaN', () => {
    // ARRANGE + ACT + ASSERT — a escala de 2 mil+ agendamentos é o caso real
    expect(formatarContagem(2045)).toBe('2.045')
    expect(formatarContagem(0)).toBe('0')
    expect(formatarContagem(999)).toBe('999')
    expect(formatarContagem(Number.NaN)).toBe('0')
  })
})
