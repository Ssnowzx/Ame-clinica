import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import { PainelUsuarios } from '@/componentes/administracao/painel-usuarios'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Usuario } from '@/tipos'

/** Um usuário fictício da lista, com as permissões dadas. */
function daLista(id: number, nome: string, permissoes: string[]): Usuario {
  return { ...usuarioFicticio, id, nome, email: `usuario${id}@exemplo.com.br`, permissoes }
}

function renderizar(usuarios: Usuario[], permissoes: string[]) {
  servidor.use(msw.get('/api/usuarios', () => HttpResponse.json(usuarios)))
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
  return render(
    <QueryClientProvider client={queryClient}>
      <PainelUsuarios />
    </QueryClientProvider>,
  )
}

describe('PainelUsuarios — o usuário acima do acesso (trava-de-usuarios-e-niveis)', () => {
  it('deve trocar o "Editar" de quem tem acesso que a pessoa não tem pelo motivo', async () => {
    // ARRANGE — a recepção edita usuários e vê a agenda; a administradora tem também o caixa
    renderizar(
      [
        daLista(2, 'Administradora Fictícia', ['agenda.ver', 'fluxo_caixa.ver']),
        daLista(3, 'Terapeuta Fictícia', ['agenda.ver']),
      ],
      ['usuarios.ver', 'usuarios.editar', 'agenda.ver'],
    )

    // ACT
    const linhaAdmin = (await screen.findByRole('cell', { name: 'Administradora Fictícia' })).closest('tr') as HTMLElement
    const linhaTerapeuta = screen.getByRole('cell', { name: 'Terapeuta Fictícia' }).closest('tr') as HTMLElement

    // ASSERT — o servidor recusaria com 403; a tela diz por quê no lugar do botão
    expect(within(linhaAdmin).queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(within(linhaAdmin).getByText('Tem acesso que você não tem')).toBeInTheDocument()
    expect(within(linhaTerapeuta).getByRole('button', { name: /Editar/ })).toBeInTheDocument()
  })
})

describe('PainelUsuarios — o colega de outro profissional (trava-de-usuarios-e-niveis)', () => {
  it('deve trocar o "Editar" pelo motivo quando o usuário é de outro profissional e eu não vejo a clínica inteira', async () => {
    // ARRANGE — eu sou da profissional 10, sem as flags; a colega é da 20, com a mesma permissão
    servidor.use(
      msw.get('/api/usuarios', () =>
        HttpResponse.json([{ ...daLista(5, 'Colega de Outra Fictícia', ['agenda.ver']), profissional_id: 20 }]),
      ),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, profissional_id: 10, permissoes: ['usuarios.ver', 'usuarios.editar', 'agenda.ver'] },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <PainelUsuarios />
      </QueryClientProvider>,
    )

    // ACT
    const linha = (await screen.findByRole('cell', { name: 'Colega de Outra Fictícia' })).closest('tr') as HTMLElement

    // ASSERT
    expect(within(linha).queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(within(linha).getByText('Tem acesso que você não tem')).toBeInTheDocument()
  })
})

