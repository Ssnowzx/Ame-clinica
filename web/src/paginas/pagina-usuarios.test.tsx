import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaUsuarios } from '@/paginas/pagina-usuarios'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

function renderizar(permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/usuarios']}>
          <PaginaUsuarios />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('PaginaUsuarios — abas gated por permissão', () => {
  beforeEach(() => {
    servidor.use(
      msw.get('/api/usuarios', () => HttpResponse.json([])),
      msw.get('/api/niveis-permissao', () => HttpResponse.json([])),
    )
  })

  it('deve oferecer as duas abas com as duas permissões', async () => {
    // ARRANGE + ACT
    renderizar(['usuarios.ver', 'niveis_permissao.ver'])

    // ASSERT — as duas abas existem; Usuários é a ativa
    expect(await screen.findByRole('tab', { name: 'Usuários' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Níveis de permissão' })).toBeInTheDocument()
    // a escolhida e a outra com o canto de controle, nunca a pílula do botão (change tema-da-clinica)
    for (const aba of screen.getAllByRole('tab')) {
      expect(aba).toHaveClass('rounded-t-controle', 'rounded-b-none')
    }
  })

  it('deve abrir direto em Níveis quando só tem niveis_permissao.ver', async () => {
    // ARRANGE + ACT — sem usuarios.ver
    renderizar(['niveis_permissao.ver'])

    // ASSERT — a aba Usuários não é oferecida; o painel de níveis aparece
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Níveis de permissão' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('tab', { name: 'Usuários' })).not.toBeInTheDocument()
  })

  it('deve mostrar acesso negado sem nenhuma das permissões', () => {
    // ARRANGE + ACT
    renderizar(['agenda.ver'])

    // ASSERT
    expect(screen.getByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  })
})
