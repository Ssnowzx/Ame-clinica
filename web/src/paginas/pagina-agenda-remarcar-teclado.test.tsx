import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, CONFIGURACAO_FICTICIA, DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

/**
 * A alternativa por TECLADO do arrasto (D3 — WCAG 2.2 AA, 2.5.7): tudo o que o
 * gesto faz tem que fechar SEM mouse — modo "Remarcar para…", slots livres como
 * alvo, a MESMA confirmação, Escape cancelando sem efeito.
 */

const CONFIG_COM_ARRASTO = {
  configuracoes: [
    ...CONFIGURACAO_FICTICIA.configuracoes,
    { chave: 'agenda.arrastar_para_remarcar', tipo: 'bool', valor: true },
  ],
}

// SEM `agenda.criar` de propósito: o modo teclado precisa oferecer os slots
// como ALVO mesmo para quem não pode marcar — a condição é a do gesto (editar).
function renderizarAgenda(permissoes: string[] = ['agenda.ver', 'agenda.editar']) {
  servidor.use(
    // o override vem ANTES dos handlers da lista: no MSW, ganha o primeiro que casar
    msw.get('/api/agenda/configuracoes', () => HttpResponse.json(CONFIG_COM_ARRASTO)),
    ...handlersDaAgenda([cardFicticio()]),
  )
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}&visao=geral`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Agenda — remarcar por teclado (2.5.7)', () => {
  it('deve completar o fluxo inteiro sem mouse: card → modo → slot → confirmação', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')

    // sem `agenda.criar`, fora do modo NÃO existe botão de marcar
    expect(screen.queryByRole('button', { name: /^Marcar às/ })).not.toBeInTheDocument()

    // ACT 1: foca a ação do card e aciona por Enter
    const acaoDoCard = screen.getByRole('button', {
      name: 'Remarcar Paciente Fictício para outro horário',
    })
    acaoDoCard.focus()
    expect(acaoDoCard).toHaveFocus()
    await usuario.keyboard('{Enter}')

    // ASSERT 1: o banner aria-live anuncia o modo
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Remarcando Paciente Fictício')

    // ACT 2: os slots livres EXISTENTES agora agem como alvo — escolhe por teclado
    const alvo = screen.getByRole('button', {
      name: 'Remarcar para 09:00 com Profissional Fictício B',
    })
    alvo.focus()
    expect(alvo).toHaveFocus()
    await usuario.keyboard('{Enter}')

    // ASSERT 2: a MESMA confirmação do arrasto, com o de→para escolhido
    const confirmacao = await screen.findByRole('dialog')
    expect(within(confirmacao).getByText('Remarcar Paciente Fictício?')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(confirmacao).getByText(/13\/07\/2026 às 09:00 · Profissional Fictício B/)).toBeInTheDocument()
    })
    // o modo terminou junto com a escolha
    expect(screen.queryByText(/escolha um horário livre na grade/)).not.toBeInTheDocument()
  })

  it('deve cancelar com Escape sem gravar, devolvendo o foco ao GATILHO de origem', async () => {
    // ARRANGE: entra no modo
    const usuario = userEvent.setup()
    let putEmitido = false
    renderizarAgenda()
    servidor.use(
      msw.put('/api/agendamentos/:id', () => {
        putEmitido = true
        return HttpResponse.json(cardFicticio())
      }),
    )
    await screen.findByRole('table')
    const acaoDoCard = screen.getByRole('button', {
      name: 'Remarcar Paciente Fictício para outro horário',
    })
    acaoDoCard.focus()
    await usuario.keyboard('{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('Remarcando')

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT: o modo termina, nada é gravado, o foco volta ao gatilho
    // "Remarcar…" que iniciou (2.4.3) — não ao primeiro botão do card
    expect(screen.queryByText(/escolha um horário livre na grade/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remarcar para/ })).not.toBeInTheDocument()
    expect(putEmitido).toBe(false)
    const gatilho = document.querySelector<HTMLElement>('[data-card-id="1"] [aria-label^="Remarcar"]')
    expect(gatilho).not.toBeNull()
    expect(gatilho).toHaveFocus()
  })

  it('deve ignorar o Escape já consumido por uma camada Radix (defaultPrevented)', async () => {
    // ARRANGE: entra no modo e simula um menu/diálogo aberto por cima — o
    // Radix consome o Esc PRIMEIRO (preventDefault) na fase de captura
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')
    const acaoDoCard = screen.getByRole('button', {
      name: 'Remarcar Paciente Fictício para outro horário',
    })
    acaoDoCard.focus()
    await usuario.keyboard('{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('Remarcando')
    window.addEventListener(
      'keydown',
      (evento) => {
        if (evento.key === 'Escape') {
          evento.preventDefault()
        }
      },
      { capture: true, once: true },
    )

    // ACT: o primeiro Esc pertence à camada de cima; o segundo, ao modo
    await usuario.keyboard('{Escape}')

    // ASSERT: UM Esc não fecha as duas camadas de uma vez
    expect(screen.getByRole('status')).toHaveTextContent('Remarcando')
    await usuario.keyboard('{Escape}')
    expect(screen.queryByText(/escolha um horário livre na grade/)).not.toBeInTheDocument()
  })

  it('deve oferecer a ação também no painel de leitura, sob as mesmas condições', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')

    // ACT: abre a leitura e aciona "Remarcar para…" pelo menu
    await usuario.click(screen.getByRole('button', { name: 'Paciente Fictício' }))
    const painel = await screen.findByRole('dialog')
    await usuario.click(within(painel).getByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Remarcar para…' }))

    // ASSERT: o painel fecha e o modo de escolha começa
    await waitFor(() => {
      expect(screen.queryByText('Detalhes do agendamento')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('status')).toHaveTextContent('Remarcando Paciente Fictício')
    // os slots livres viraram alvo (um por coluna de profissional)
    expect(screen.getAllByRole('button', { name: /^Remarcar para 09:00/ }).length).toBeGreaterThan(0)
  })

  it('deve não oferecer a ação no painel quando a config está desligada', async () => {
    // ARRANGE: config default (false) — o item não existe nem para quem edita
    const usuario = userEvent.setup()
    servidor.use(...handlersDaAgenda([cardFicticio()]))
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver', 'agenda.editar'] },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}&visao=geral`]}>
            <PaginaAgenda />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await screen.findByRole('table')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Paciente Fictício' }))
    const painel = await screen.findByRole('dialog')
    await usuario.click(within(painel).getByRole('button', { name: 'Mais ações' }))
    await screen.findByRole('menuitem', { name: 'Editar' })

    // ASSERT
    expect(screen.queryByRole('menuitem', { name: 'Remarcar para…' })).not.toBeInTheDocument()
  })

  it('deve não ter violações axe com o modo de escolha ativo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { container } = renderizarAgenda()
    await screen.findByRole('table')
    const acaoDoCard = screen.getByRole('button', {
      name: 'Remarcar Paciente Fictício para outro horário',
    })
    acaoDoCard.focus()
    await usuario.keyboard('{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('Remarcando')

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})

describe('Agenda — a ação de remarcar tem a palavra (botoes-com-nome-na-agenda)', () => {
  it('deve carregar o texto "Remarcar" e o title, mantendo o nome acessível completo', async () => {
    // ARRANGE
    renderizarAgenda()
    await screen.findByRole('table')

    // ACT
    const acao = screen.getByRole('button', {
      name: 'Remarcar Paciente Fictício para outro horário',
    })

    // ASSERT: o rótulo visível é parte do nome (2.5.3); o title cobre o card estreito
    expect(acao).toHaveTextContent('Remarcar')
    expect(acao).toHaveAttribute('title', 'Remarcar')
    expect(acao).toHaveAccessibleName('Remarcar Paciente Fictício para outro horário')
  })
})
