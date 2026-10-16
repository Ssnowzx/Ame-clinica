import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { usarPreferenciaDeLayout } from '@/hooks/usar-preferencia-de-layout'
import { chaveDeLayout } from '@/lib/preferencias-locais'
import { useAuthStore } from '@/stores/auth-store'
import type { Usuario } from '@/tipos'

function entrar(id: number): void {
  const usuario: Usuario = {
    id,
    updated_at: '2026-07-15T10:00:00.000000Z',
    nome: `Usuária ${id}`,
    email: `usuaria${id}@clinica-exemplo.com.br`,
    acesso_mobile: false,
    ativo: true,
    profissional_id: null,
    nivel_permissao_id: 1,
    nivel_permissao: 'Recepção',
    permissoes: ['agenda.ver', 'lista_espera.ver'],
    marca: { nome: '', identidade: 'nome', fonte: 'padrao', logo_versao: null },
    avatar_versao: null,
  }
  useAuthStore.setState({ usuario, carregandoSessao: false })
}

function sair(): void {
  useAuthStore.setState({ usuario: null, carregandoSessao: false })
}

// sem `localStorage.clear()` aqui de propósito: o `afterEach` global (que roda
// DEPOIS, porque os hooks do Vitest empilham) precisa VER o que este arquivo
// gravou — é ele quem exercita a escrita de verdade. Auditoria que só olha disco
// já limpo não audita nada.
afterEach(() => {
  sair()
})

describe('usarPreferenciaDeLayout', () => {
  it('deve começar expandido para quem nunca escolheu', () => {
    // ARRANGE
    entrar(1)

    // ACT
    const { result } = renderHook(() => usarPreferenciaDeLayout('menu'))

    // ASSERT
    expect(result.current[0]).toBe(false)
  })

  it('deve guardar a escolha e devolvê-la já na primeira pintura', () => {
    // ARRANGE
    entrar(1)
    const { result, unmount } = renderHook(() => usarPreferenciaDeLayout('menu'))
    act(() => {
      result.current[1]()
    })
    expect(result.current[0]).toBe(true)
    unmount()

    // ACT — a tela remonta (recarregar a página, trocar de rota)
    const remontado = renderHook(() => usarPreferenciaDeLayout('menu'))

    // ASSERT — recolhido no PRIMEIRO render: nada de piscar aberto antes
    expect(remontado.result.current[0]).toBe(true)
  })

  it('deve guardar cada painel separadamente', () => {
    // ARRANGE
    entrar(1)
    const menu = renderHook(() => usarPreferenciaDeLayout('menu'))
    const fila = renderHook(() => usarPreferenciaDeLayout('filaAgenda'))

    // ACT
    act(() => {
      menu.result.current[1]()
    })

    // ASSERT
    expect(menu.result.current[0]).toBe(true)
    expect(fila.result.current[0]).toBe(false)
  })

  it('deve não deixar a colega herdar o layout na troca de usuário, sem recarregar', () => {
    // ARRANGE — o balcão compartilha a máquina, e a SPA não recarrega no logout
    entrar(1)
    const { result, rerender } = renderHook(() => usarPreferenciaDeLayout('menu'))
    act(() => {
      result.current[1]()
    })
    expect(result.current[0]).toBe(true)

    // ACT — a recepcionista sai e a colega entra na MESMA aba
    act(() => {
      sair()
      entrar(2)
    })
    rerender()

    // ASSERT — a colega vê o padrão dela, não o recolhido da outra
    expect(result.current[0]).toBe(false)
  })

  it('deve não escrever na chave de quem saiu quando a colega alterna', () => {
    // ARRANGE
    entrar(1)
    const { result, rerender } = renderHook(() => usarPreferenciaDeLayout('menu'))
    act(() => {
      result.current[1]()
    })

    // ACT
    act(() => {
      sair()
      entrar(2)
    })
    rerender()
    act(() => {
      result.current[1]()
    })

    // ASSERT — cada uma escreve na sua
    expect(window.localStorage.getItem(chaveDeLayout(1))).toBe('{"menu":true}')
    expect(window.localStorage.getItem(chaveDeLayout(2))).toBe('{"menu":true}')
  })

  it('deve devolver a escolha ao usuário que volta depois de sair', () => {
    // ARRANGE — sair (ou expirar em 401) não apaga a preferência: ela é layout,
    // não é sessão nem dado de menor
    entrar(1)
    const primeira = renderHook(() => usarPreferenciaDeLayout('filaAgenda'))
    act(() => {
      primeira.result.current[1]()
    })
    primeira.unmount()
    act(() => {
      sair()
    })

    // ACT
    entrar(1)
    const { result } = renderHook(() => usarPreferenciaDeLayout('filaAgenda'))

    // ASSERT
    expect(result.current[0]).toBe(true)
  })

  it('deve somar as escolhas dos dois painéis, não sobrescrever uma com a outra', () => {
    // ARRANGE: na agenda o menu e a fila vivem montados JUNTOS, cada um com sua
    // cópia em memória da mesma chave
    entrar(1)
    const menu = renderHook(() => usarPreferenciaDeLayout('menu'))
    const fila = renderHook(() => usarPreferenciaDeLayout('filaAgenda'))

    // ACT: a recepcionista recolhe os dois
    act(() => {
      menu.result.current[1]()
    })
    act(() => {
      fila.result.current[1]()
    })
    menu.unmount()
    fila.unmount()

    // ASSERT: recarregar não pode evaporar a escolha de quem foi alternado primeiro
    const menuRecarregado = renderHook(() => usarPreferenciaDeLayout('menu'))
    const filaRecarregada = renderHook(() => usarPreferenciaDeLayout('filaAgenda'))
    expect(menuRecarregado.result.current[0]).toBe(true)
    expect(filaRecarregada.result.current[0]).toBe(true)
  })

  it('deve não gravar nada enquanto não há usuário', () => {
    // ARRANGE — tela de login / sessão ainda carregando
    sair()
    const { result } = renderHook(() => usarPreferenciaDeLayout('menu'))

    // ACT
    act(() => {
      result.current[1]()
    })

    // ASSERT — vale em memória, e nenhuma chave anônima nasce no disco
    expect(result.current[0]).toBe(true)
    expect(window.localStorage.length).toBe(0)
  })
})
