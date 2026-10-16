import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaSalas } from '@/paginas/pagina-salas'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Sala } from '@/tipos'

const TUDO = ['salas.ver', 'salas.criar', 'salas.editar', 'salas.excluir']

const SALA_COMUM: Sala = {
  id: 1,
  nome: 'Sala Fictícia 1',
  capacidade: 1,
  ativo: true,
  updated_at: '2026-09-15T10:00:00.000000Z',
}

const SALA_DO_GRUPO: Sala = { ...SALA_COMUM, id: 2, nome: 'Sala Fictícia do Grupo', capacidade: 4 }

/** O corpo do PUT, para o teste conferir o que a tela mandou de fato. */
let ultimoPut: Record<string, unknown> | null = null

function renderizar(salas: Sala[] = [SALA_COMUM, SALA_DO_GRUPO]) {
  ultimoPut = null
  servidor.use(
    msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    msw.get('/api/notificacoes', () => HttpResponse.json({})),
    msw.get('/api/salas', () => HttpResponse.json(salas)),
    msw.put('/api/salas/:id', async ({ request }) => {
      ultimoPut = (await request.json()) as Record<string, unknown>
      return HttpResponse.json({ ...SALA_COMUM, ...ultimoPut })
    }),
  )
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: TUDO }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/salas']}>
          <PaginaSalas />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Salas — capacidade do atendimento em grupo', () => {
  it('deve anunciar a capacidade só na sala que comporta mais de uma', async () => {
    // ARRANGE + ACT
    renderizar()
    await screen.findByRole('table')

    // ASSERT — a linha do grupo diz o número; a comum não vira ruído
    const linhaDoGrupo = screen.getByRole('row', { name: /Sala Fictícia do Grupo/ })
    expect(within(linhaDoGrupo).getByText('4 atendimentos')).toBeInTheDocument()
    const linhaComum = screen.getByRole('row', { name: /Sala Fictícia 1/ })
    expect(within(linhaComum).queryByText(/atendimentos/)).not.toBeInTheDocument()
  })

  it('deve confirmar a mudança da capacidade dizendo que nada é desmarcado', async () => {
    // ARRANGE — capacidade é REGRA: ela decide o que a agenda aceita
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('table')
    const linhaComum = screen.getByRole('row', { name: /Sala Fictícia 1/ })
    await usuario.click(within(linhaComum).getByRole('button', { name: /Editar/ }))

    const campo = await screen.findByLabelText(/Quantos cabem ao mesmo tempo/)
    await usuario.clear(campo)
    await usuario.type(campo, '4')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Salvar/ }))

    // ASSERT — a confirmação diz o número E não promete o que não faz
    const dialogo = await screen.findByRole('alertdialog', { name: /Mudar a regra/ })
    expect(within(dialogo).getByText(/4 atendimentos no mesmo horário/)).toBeInTheDocument()
    expect(within(dialogo).getByText(/já marcados não mudam/)).toBeInTheDocument()
  })

  it('deve mandar a capacidade ao servidor depois da confirmação', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('table')
    const linhaComum = screen.getByRole('row', { name: /Sala Fictícia 1/ })
    await usuario.click(within(linhaComum).getByRole('button', { name: /Editar/ }))
    const campo = await screen.findByLabelText(/Quantos cabem ao mesmo tempo/)
    await usuario.clear(campo)
    await usuario.type(campo, '4')
    await usuario.click(screen.getByRole('button', { name: /Salvar/ }))
    const dialogo = await screen.findByRole('alertdialog', { name: /Mudar a regra/ })

    // ACT
    await usuario.click(within(dialogo).getByRole('button', { name: /Mudar a regra/ }))

    // ASSERT — número, não string: a tela converte antes de mandar
    await waitFor(() => {
      expect(ultimoPut?.capacidade).toBe(4)
    })
  })

  it('não deve pedir confirmação quando só o nome muda', async () => {
    // ARRANGE — confirmação para tudo é ruído, e ruído faz clicar sem ler
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('table')
    const linhaComum = screen.getByRole('row', { name: /Sala Fictícia 1/ })
    await usuario.click(within(linhaComum).getByRole('button', { name: /Editar/ }))
    const nome = await screen.findByLabelText(/Nome/)
    await usuario.clear(nome)
    await usuario.type(nome, 'Sala Fictícia Renomeada')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Salvar/ }))

    // ASSERT — foi direto ao servidor, sem diálogo de regra
    await waitFor(() => {
      expect(ultimoPut?.nome).toBe('Sala Fictícia Renomeada')
    })
    expect(screen.queryByRole('alertdialog', { name: /Mudar a regra/ })).not.toBeInTheDocument()
  })

  it('deve tratar o campo apagado como uma criança por vez', async () => {
    // ARRANGE — quem apaga o número quer "uma por vez", não um 422 sobre tipo
    const usuario = userEvent.setup()
    renderizar([SALA_DO_GRUPO])
    await screen.findByRole('table')
    const linha = screen.getByRole('row', { name: /Sala Fictícia do Grupo/ })
    await usuario.click(within(linha).getByRole('button', { name: /Editar/ }))
    const campo = await screen.findByLabelText(/Quantos cabem ao mesmo tempo/)
    await usuario.clear(campo)

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Salvar/ }))
    const dialogo = await screen.findByRole('alertdialog', { name: /Mudar a regra/ })
    await usuario.click(within(dialogo).getByRole('button', { name: /Mudar a regra/ }))

    // ASSERT
    await waitFor(() => {
      expect(ultimoPut?.capacidade).toBe(1)
    })
  })
})
