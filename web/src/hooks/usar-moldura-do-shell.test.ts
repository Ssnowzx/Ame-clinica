import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usarMolduraDoShell } from '@/hooks/usar-moldura-do-shell'

/*
 * A moldura do shell MEDIDA (change conversa-legivel). O jsdom não calcula layout, então a
 * altura do cabeçalho é fingida no `getBoundingClientRect`, e o `ResizeObserver` é um dublê que
 * o teste dispara — o que se prova é o contrato: medida → token, mudança → token novo,
 * desmontar → token do CSS de volta.
 */

let disparar: () => void = () => undefined
let opcoesObservadas: ResizeObserverOptions | undefined

/** Só dispara o que foi OBSERVADO: um observador criado e nunca ligado não acompanha nada. */
class ObservadorFalso {
  private readonly callback: () => void

  constructor(callback: () => void) {
    this.callback = callback
  }
  observe(_alvo: Element, opcoes?: ResizeObserverOptions): void {
    disparar = this.callback
    opcoesObservadas = opcoes
  }
  unobserve(): void {}
  disconnect(): void {
    disparar = () => undefined
  }
}

function cabecalhoCom(altura: { valor: number }): { current: HTMLElement } {
  const elemento = document.createElement('header')
  elemento.getBoundingClientRect = () => ({ height: altura.valor }) as DOMRect
  return { current: elemento }
}

const moldura = (): string => document.documentElement.style.getPropertyValue('--moldura-do-shell')

afterEach(() => {
  disparar = () => undefined
  opcoesObservadas = undefined
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('--moldura-do-shell')
})

describe('usarMolduraDoShell', () => {
  it('deve descontar da viewport a altura MEDIDA do cabeçalho, não a suposta', () => {
    // ARRANGE — no celular, com os contadores reais, o cabeçalho tem 68px (e não os 52 do token)
    vi.stubGlobal('ResizeObserver', ObservadorFalso)
    const cabecalho = cabecalhoCom({ valor: 68 })

    // ACT
    renderHook(() => usarMolduraDoShell(cabecalho))

    // ASSERT
    expect(moldura()).toBe('calc(68px + 3.75rem)')
  })

  it('deve acompanhar o cabeçalho quando ele muda de altura', () => {
    // ARRANGE
    vi.stubGlobal('ResizeObserver', ObservadorFalso)
    const altura = { valor: 52 }
    renderHook(() => usarMolduraDoShell(cabecalhoCom(altura)))

    // ACT — um contador apareceu e a barra cresceu
    altura.valor = 68
    disparar()

    // ASSERT
    expect(moldura()).toBe('calc(68px + 3.75rem)')
  })

  it('não deve sobrescrever o token do CSS sem layout para medir', () => {
    // ARRANGE — altura 0: elemento oculto, ou ambiente sem layout
    vi.stubGlobal('ResizeObserver', ObservadorFalso)

    // ACT
    renderHook(() => usarMolduraDoShell(cabecalhoCom({ valor: 0 })))

    // ASSERT
    expect(moldura()).toBe('')
  })

  it('deve devolver o token do CSS ao desmontar', () => {
    // ARRANGE — o login e as telas públicas não têm o shell
    vi.stubGlobal('ResizeObserver', ObservadorFalso)
    const { unmount } = renderHook(() => usarMolduraDoShell(cabecalhoCom({ valor: 68 })))

    // ACT
    unmount()

    // ASSERT
    expect(moldura()).toBe('')
  })

  it('deve observar a caixa INTEIRA do cabeçalho, com respiro e borda', () => {
    // ARRANGE — o padrão do ResizeObserver é só o conteúdo: um cabeçalho que cresce pelo respiro
    // passava sem aviso (visto no teste local: 84px de cabeçalho, moldura parada em 68)
    vi.stubGlobal('ResizeObserver', ObservadorFalso)

    // ACT
    renderHook(() => usarMolduraDoShell(cabecalhoCom({ valor: 68 })))

    // ASSERT
    expect(opcoesObservadas).toEqual({ box: 'border-box' })
  })
})
