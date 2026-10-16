import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usarAgoraNaClinica } from '@/hooks/usar-agora-na-clinica'

describe('usarAgoraNaClinica — o relógio da grade é o da clínica, e anda sozinho', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve dar a data e a hora no fuso da clínica e avançar a cada minuto', () => {
    // ARRANGE: 23:30 em Brasília é 02:30 do dia seguinte em UTC — o fuso decide o dia
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-14T02:30:00Z'))

    // ACT
    const { result } = renderHook(() => usarAgoraNaClinica('America/Sao_Paulo'))

    // ASSERT
    expect(result.current).toEqual({ data: '2026-07-13', hora: '23:30' })

    // ACT: um minuto depois
    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    // ASSERT
    expect(result.current.hora).toBe('23:31')
  })
})
