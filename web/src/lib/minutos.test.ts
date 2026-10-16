import { describe, expect, it } from 'vitest'

import { formatarMinutosEmHoras } from '@/lib/minutos'

describe('formatarMinutosEmHoras — a grade em horas, do jeito que a clínica lê', () => {
  it('deve escrever só as horas quando não sobra minuto', () => {
    // ARRANGE + ACT + ASSERT
    expect(formatarMinutosEmHoras(0)).toBe('0h')
    expect(formatarMinutosEmHoras(60)).toBe('1h')
    expect(formatarMinutosEmHoras(4800)).toBe('80h')
  })

  it('deve acrescentar os minutos com dois dígitos', () => {
    // ARRANGE + ACT + ASSERT — "26h40", nunca "26h4" nem "26,67 h"
    expect(formatarMinutosEmHoras(1600)).toBe('26h40')
    expect(formatarMinutosEmHoras(65)).toBe('1h05')
    expect(formatarMinutosEmHoras(1)).toBe('0h01')
  })

  it('deve arredondar a fração de minuto e nunca devolver negativo', () => {
    // ARRANGE + ACT + ASSERT — o servidor já corta o negativo (SEC-PR-01); aqui é o cinto:
    // uma linha torta não pode virar "-2h" na tela de quem confere a produção
    expect(formatarMinutosEmHoras(90.4)).toBe('1h30')
    expect(formatarMinutosEmHoras(-120)).toBe('0h')
  })
})
