import { describe, expect, it } from 'vitest'

import { limitesDoMes, rotuloCurtoDoMes, rotuloDoMes, somarMeses } from '@/lib/meses'

describe('Aritmética de mês como string', () => {
  it('deve somar e subtrair meses virando o ano quando preciso', () => {
    // ARRANGE + ACT + ASSERT — a virada de ano é o único caso com armadilha
    expect(somarMeses('2026-07', -1)).toBe('2026-06')
    expect(somarMeses('2026-01', -1)).toBe('2025-12')
    expect(somarMeses('2025-12', 1)).toBe('2026-01')
    expect(somarMeses('2026-07', 0)).toBe('2026-07')
  })

  it('deve deixar formato inesperado sair CRU, nunca como NaN', () => {
    // ARRANGE + ACT + ASSERT — idioma de datas.ts: dado ruim não vira crash nem "NaN-NaN"
    expect(somarMeses('2026-13', -1)).toBe('2026-13')
    expect(somarMeses('julho', 1)).toBe('julho')
  })

  it('deve calcular os limites do mês, inclusive fevereiro bissexto', () => {
    // ARRANGE + ACT + ASSERT — o último dia é a única armadilha
    expect(limitesDoMes('2026-07')).toEqual({ de: '2026-07-01', ate: '2026-07-31' })
    expect(limitesDoMes('2026-02')).toEqual({ de: '2026-02-01', ate: '2026-02-28' })
    expect(limitesDoMes('2028-02')).toEqual({ de: '2028-02-01', ate: '2028-02-29' })
    expect(limitesDoMes('2026-04')).toEqual({ de: '2026-04-01', ate: '2026-04-30' })
  })

  it('deve rotular o mês por extenso em pt-BR e curto para eixos', () => {
    // ARRANGE + ACT + ASSERT
    expect(rotuloDoMes('2026-07')).toBe('julho de 2026')
    expect(rotuloDoMes('2025-03')).toBe('março de 2025')
    expect(rotuloDoMes('invalido')).toBe('invalido')
    expect(rotuloCurtoDoMes('2026-07')).toBe('jul')
    expect(rotuloCurtoDoMes('2026-03')).toBe('mar')
  })
})
