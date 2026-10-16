import { describe, expect, it } from 'vitest'

import { ehDataDeFiltroUtilizavel } from '@/lib/data-de-filtro'

describe('ehDataDeFiltroUtilizavel', () => {
  it('deve aceitar uma data completa e plausível', () => {
    // ARRANGE + ACT + ASSERT
    expect(ehDataDeFiltroUtilizavel('2026-08-21')).toBe(true)
  })

  it('deve recusar o ano em digitação — a sequência que gerava quatro 422', () => {
    // ARRANGE: digitar "2026" no input de data emite estes quatro valores, um por tecla
    // ASSERT: só o último consulta (achado da validação em produção, 2026-08-21)
    expect(ehDataDeFiltroUtilizavel('0002-08-01')).toBe(false)
    expect(ehDataDeFiltroUtilizavel('0020-08-01')).toBe(false)
    expect(ehDataDeFiltroUtilizavel('0202-08-01')).toBe(false)
    expect(ehDataDeFiltroUtilizavel('2026-08-01')).toBe(true)
  })

  it('deve recusar vazio, incompleto e ano de cinco dígitos', () => {
    // ARRANGE + ACT + ASSERT
    expect(ehDataDeFiltroUtilizavel('')).toBe(false)
    expect(ehDataDeFiltroUtilizavel('2026-08')).toBe(false)
    expect(ehDataDeFiltroUtilizavel('12026-08-01')).toBe(false)
    expect(ehDataDeFiltroUtilizavel('abc')).toBe(false)
  })
})
