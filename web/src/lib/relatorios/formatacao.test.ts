import { describe, expect, it } from 'vitest'

import { ehColunaNumerica, formatarCelula } from '@/lib/relatorios/formatacao'

describe('Formatação da célula pelo tipo da coluna', () => {
  it('deve formatar dinheiro pela moeda da casa, sem aritmética', () => {
    // ACT + ASSERT — string decimal do servidor → BRL; o que não é decimal vale zero
    expect(formatarCelula('1234.50', 'dinheiro')).toBe('R$ 1.234,50')
    expect(formatarCelula('-80.5', 'dinheiro')).toBe('-R$ 80,50')
    expect(formatarCelula('1e3', 'dinheiro')).toBe('R$ 0,00')
  })

  it('deve formatar data em dd/mm/aaaa e hora em HH:MM', () => {
    // ACT + ASSERT
    expect(formatarCelula('2026-06-01', 'data')).toBe('01/06/2026')
    expect(formatarCelula('08:00:00', 'hora')).toBe('08:00')
  })

  it('deve formatar percentual inteiro com o sinal e número em pt-BR', () => {
    // ACT + ASSERT
    expect(formatarCelula(75, 'percentual')).toBe('75%')
    expect(formatarCelula('2.5', 'percentual')).toBe('2,5%')
    expect(formatarCelula(2045, 'numero')).toBe('2.045')
    expect(formatarCelula('12.5', 'numero')).toBe('12,5')
  })

  it('deve mostrar o marcador de ausência para vazio, nunca a palavra null', () => {
    // ACT + ASSERT
    expect(formatarCelula(null, 'texto')).toBe('—')
    expect(formatarCelula('', 'dinheiro')).toBe('—')
    expect(formatarCelula(null, 'numero')).not.toContain('null')
  })

  it('deve alinhar à direita só número, dinheiro e percentual', () => {
    // ACT + ASSERT
    expect(ehColunaNumerica('dinheiro')).toBe(true)
    expect(ehColunaNumerica('percentual')).toBe(true)
    expect(ehColunaNumerica('data')).toBe(false)
    expect(ehColunaNumerica('texto')).toBe(false)
  })
})
