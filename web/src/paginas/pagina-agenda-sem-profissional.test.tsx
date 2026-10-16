import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { DIA_FICTICIO, handlersDaAgenda, SELECAO_FICTICIA } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

/**
 * A agenda sem nenhum profissional ativo (change `o-sistema-avisa-o-que-falta`, tarefa 2.6): o estado
 * vazio que já existia ganha a saída — o cadastro para quem pode, a quem pedir para quem não pode.
 * O aviso sai da seleção que a agenda já carrega; nenhuma requisição a mais. Dados FICTÍCIOS.
 */

const QUEM_VE = ['agenda.ver']
const QUEM_VE_E_CADASTRA = ['agenda.ver', 'profissionais.ver', 'profissionais.criar']
const TITULO_DO_VAZIO = 'Nenhum profissional ativo na agenda'

function renderizarAgenda(permissoes: string[], busca = `?data=${DIA_FICTICIO}`, semProfissional = true) {
  servidor.use(...handlersDaAgenda([]))
  if (semProfissional) {
    servidor.use(msw.get('/api/agenda/selecao', () => HttpResponse.json({ ...SELECAO_FICTICIA, profissionais: [] })))
  }
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes, profissional_id: null }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[`/agenda${busca}`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Agenda sem profissional ativo — o estado vazio com saída (o-sistema-avisa-o-que-falta)', () => {
  it('deve oferecer "Cadastrar profissional" a quem pode cadastrar', async () => {
    // ARRANGE + ACT — a clínica recém-criada, antes do primeiro profissional
    renderizarAgenda(QUEM_VE_E_CADASTRA)

    // ASSERT
    expect(await screen.findByRole('heading', { name: TITULO_DO_VAZIO })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cadastrar profissional' })).toHaveAttribute('href', '/profissionais')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('deve dizer a quem pedir, sem link, a quem não pode cadastrar profissional', async () => {
    // ARRANGE + ACT — mandar a uma tela que responde 403 é pior que não mandar
    renderizarAgenda(QUEM_VE)

    // ASSERT
    await screen.findByRole('heading', { name: TITULO_DO_VAZIO })
    expect(screen.getByText('Peça a quem administra o sistema para cadastrar.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cadastrar profissional' })).not.toBeInTheDocument()
  })

  it('deve mostrar o estado vazio também na Semana, em vez de uma grade livre sem ninguém', async () => {
    // ARRANGE + ACT — as colunas da Semana são dias: antes, elas nunca ficavam vazias
    renderizarAgenda(QUEM_VE_E_CADASTRA, `?visao=semana&data=${DIA_FICTICIO}`)

    // ASSERT
    expect(await screen.findByRole('heading', { name: TITULO_DO_VAZIO })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cadastrar profissional' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('não deve oferecer o cadastro quando há profissional ativo e a coluna falta por outro motivo', async () => {
    // ARRANGE — um `?profissional=` que não está na lista: cadastrar outro não resolveria
    renderizarAgenda(QUEM_VE_E_CADASTRA, `?data=${DIA_FICTICIO}&profissional=999`, false)

    // ACT — o mesmo estado vazio aparece (a grade fica sem coluna), mas a lista NÃO está vazia
    await screen.findByRole('heading', { name: TITULO_DO_VAZIO })

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Cadastrar profissional' })).not.toBeInTheDocument()
  })

  it('deve abrir a agenda com as mesmas requisições, com e sem profissional ativo (nenhuma requisição nova)', async () => {
    // ARRANGE — o aviso sai da seleção que a agenda já carrega (D6)
    async function requisicoesAoAbrir(semProfissional: boolean): Promise<string[]> {
      queryClient.clear()
      const pedidas: string[] = []
      const anotar = ({ request }: { request: Request }): void => {
        pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
      }
      servidor.events.on('request:start', anotar)
      const { unmount } = renderizarAgenda(QUEM_VE_E_CADASTRA, `?data=${DIA_FICTICIO}`, semProfissional)
      await (semProfissional
        ? screen.findByRole('heading', { name: TITULO_DO_VAZIO })
        : screen.findByRole('table'))
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      servidor.events.removeListener('request:start', anotar)
      unmount()
      return pedidas.sort()
    }

    // ACT
    const comAviso = await requisicoesAoAbrir(true)
    const semAviso = await requisicoesAoAbrir(false)

    // ASSERT — e a conta não é vazia por acidente: a agenda pediu o que sempre pede
    expect(comAviso.length).toBeGreaterThan(0)
    expect(comAviso).toEqual(semAviso)
  })

  it('deve passar no axe com o estado vazio, com e sem a permissão de cadastrar', async () => {
    for (const permissoes of [QUEM_VE_E_CADASTRA, QUEM_VE]) {
      // ARRANGE
      queryClient.clear()
      const { container, unmount } = renderizarAgenda(permissoes)

      // ACT
      await screen.findByRole('heading', { name: TITULO_DO_VAZIO })

      // ASSERT
      expect(await axe(container)).toHaveNoViolations()
      unmount()
    }
  })
})
