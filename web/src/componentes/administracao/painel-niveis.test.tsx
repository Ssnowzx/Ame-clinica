import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import { PainelNiveis } from '@/componentes/administracao/painel-niveis'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { NivelPermissao } from '@/tipos'

function renderizar(niveis: NivelPermissao[], permissoes: string[]) {
  servidor.use(msw.get('/api/niveis-permissao', () => HttpResponse.json(niveis)))
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <PainelNiveis />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('PainelNiveis — excluir nível em uso', () => {
  it('deve desabilitar excluir com o motivo quando o nível tem usuários', async () => {
    // ARRANGE — um nível em uso (2 usuários) e um livre
    renderizar(
      [
        { id: 1, nome: 'Administrador', permissoes: ['agenda.ver'], usuarios_count: 2, updated_at: '2026-07-15T10:00:00.000000Z' },
        { id: 2, nome: 'Recepção', permissoes: ['agenda.ver'], usuarios_count: 0, updated_at: '2026-07-15T10:00:00.000000Z' },
      ],
      ['niveis_permissao.ver', 'niveis_permissao.editar', 'niveis_permissao.excluir'],
    )

    // ASSERT — a linha do Administrador tem excluir desabilitado com o motivo no title
    const celulaAdmin = await screen.findByRole('cell', { name: 'Administrador' })
    const linhaAdmin = celulaAdmin.closest('tr') as HTMLElement
    const excluirAdmin = within(linhaAdmin).getByRole('button', { name: /Excluir/ })
    expect(excluirAdmin).toBeDisabled()
    expect(excluirAdmin).toHaveAttribute('title', expect.stringContaining('não pode ser excluído'))
  })
})

describe('PainelNiveis — o nível acima do acesso (trava-de-usuarios-e-niveis)', () => {
  it('deve trocar o "Editar" do nível com permissão que a pessoa não tem pelo motivo', async () => {
    // ARRANGE — a recepção edita níveis, mas não tem o caixa do Administrador
    renderizar(
      [
        { id: 1, nome: 'Administrador', permissoes: ['agenda.ver', 'fluxo_caixa.ver'], usuarios_count: 2, updated_at: '2026-07-15T10:00:00.000000Z' },
        { id: 2, nome: 'Recepção', permissoes: ['agenda.ver'], usuarios_count: 1, updated_at: '2026-07-15T10:00:00.000000Z' },
      ],
      ['niveis_permissao.ver', 'niveis_permissao.editar', 'agenda.ver'],
    )

    // ACT
    const linhaAdmin = (await screen.findByRole('cell', { name: 'Administrador' })).closest('tr') as HTMLElement
    const linhaRecepcao = screen.getByRole('cell', { name: 'Recepção' }).closest('tr') as HTMLElement

    // ASSERT
    expect(within(linhaAdmin).queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
    expect(within(linhaAdmin).getByText('Tem acesso que você não tem')).toBeInTheDocument()
    expect(within(linhaRecepcao).getByRole('button', { name: /Editar/ })).toBeInTheDocument()
  })
})
