import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { usarTemaDaClinica } from '@/hooks/usar-tema-da-clinica'

/*
 * O tema da clínica no `<html>` (change tema-da-clinica). Quem segura o atributo é o ciclo de
 * vida de quem chama: montado → tema; desmontado (saiu da sessão) → Padrão. É isso que impede a
 * tela de login de herdar a cor da última clínica.
 */

function temaNoHtml(): string | undefined {
  return document.documentElement.dataset.tema
}

afterEach(() => {
  delete document.documentElement.dataset.tema
})

describe('usarTemaDaClinica', () => {
  it('deve aplicar o tema conhecido no html', () => {
    // ARRANGE + ACT
    renderHook(() => {
      usarTemaDaClinica('menta')
    })

    // ASSERT
    expect(temaNoHtml()).toBe('menta')
  })

  it('deve tirar o tema ao desmontar, para o login voltar ao Padrão', () => {
    // ARRANGE
    const { unmount } = renderHook(() => {
      usarTemaDaClinica('menta')
    })

    // ACT
    unmount()

    // ASSERT
    expect(temaNoHtml()).toBeUndefined()
  })

  it('não deve aplicar atributo nenhum no Padrão', () => {
    // ARRANGE + ACT
    renderHook(() => {
      usarTemaDaClinica('padrao')
    })

    // ASSERT — o Padrão é a AUSÊNCIA do atributo, não um valor
    expect(temaNoHtml()).toBeUndefined()
  })

  it('deve cair no Padrão com tema que o design system não conhece', () => {
    // ARRANGE + ACT — deploy fora de ordem, chave nova no servidor antes da tela
    renderHook(() => {
      usarTemaDaClinica('rosa-choque')
    })

    // ASSERT
    expect(temaNoHtml()).toBeUndefined()
  })

  it('deve trocar o tema quando a sessão muda sem desmontar', () => {
    // ARRANGE — salvar o tema em Configurações recarrega o /me com o shell montado
    let tema: string | undefined = 'padrao'
    const { rerender } = renderHook(() => {
      usarTemaDaClinica(tema)
    })

    // ACT
    tema = 'menta'
    rerender()

    // ASSERT
    expect(temaNoHtml()).toBe('menta')
  })

  it('deve tirar o tema quando a clínica volta ao Padrão sem desmontar', () => {
    // ARRANGE
    let tema: string | undefined = 'menta'
    const { rerender } = renderHook(() => {
      usarTemaDaClinica(tema)
    })

    // ACT
    tema = 'padrao'
    rerender()

    // ASSERT
    expect(temaNoHtml()).toBeUndefined()
  })
})
