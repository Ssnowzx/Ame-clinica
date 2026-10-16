import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { baixarBlob } from '@/lib/baixar-blob'

/**
 * O download pelo caminho autenticado (blob): a âncora temporária leva o NOME, e a URL do blob só é
 * revogada DEPOIS — síncrona, a revogação aborta o download em alguns navegadores (CR-WEB-04).
 */

const URL_DO_BLOB = 'blob:ficticio'

let nomesBaixados: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  nomesBaixados = []
  // jsdom não tem createObjectURL: espiar SÓ os métodos (nunca trocar a classe URL global)
  URL.createObjectURL = vi.fn(() => URL_DO_BLOB) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
  // jsdom não baixa arquivo: o clique da âncora temporária é onde o nome aparece
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function registrar(this: HTMLAnchorElement) {
    nomesBaixados.push(this.download)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('baixarBlob', () => {
  it('deve baixar com o nome dado pela URL do blob', () => {
    // ARRANGE
    const arquivo = new Blob(['conteúdo fictício'], { type: 'text/csv' })

    // ACT
    baixarBlob(arquivo, 'relatorio-ficticio.csv')

    // ASSERT
    expect(URL.createObjectURL).toHaveBeenCalledWith(arquivo)
    expect(nomesBaixados).toEqual(['relatorio-ficticio.csv'])
  })

  it('deve revogar a URL do blob em 1000 ms, e não antes', () => {
    // ARRANGE
    const arquivo = new Blob(['conteúdo fictício'], { type: 'application/pdf' })

    // ACT
    baixarBlob(arquivo, 'comprovante-ficticio.pdf')
    vi.advanceTimersByTime(999)

    // ASSERT — ainda não: o download precisa da URL viva
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    // ACT
    vi.advanceTimersByTime(1)

    // ASSERT
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(URL_DO_BLOB)
  })
})
