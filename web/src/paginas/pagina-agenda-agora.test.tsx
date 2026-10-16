import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

// Contador de renders do menu de status — um por card com `agenda.editar`. É o termômetro do
// `memo` do card: se o tique do relógio re-renderizar os cards, ele sobe (perf-engineer PERF-AV-02).
const rendersDoMenu = { total: 0 }
vi.mock('@/componentes/agenda/menu-de-status', () => ({
  MenuDeStatus: () => {
    rendersDoMenu.total += 1

    return <span data-testid="menu-de-status" />
  },
}))

function renderizarAgenda(permissoes: string[] = ['agenda.ver', 'agenda.criar']) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}&profissional=1`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** Só o relógio é falso: os timers seguem reais, senão o MSW e o React Query travam. */
function congelarRelogioEm(instanteUtc: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instanteUtc))
}

describe('Agenda — a linha do agora e o horário que convida (agenda-com-vida)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('deve desenhar a linha do agora na faixa certa, à altura certa, quando o dia é hoje', async () => {
    // ARRANGE: 08:20 em Brasília no dia fictício; a grade da demo tem passo de 60 min, e a
    // sessão fictícia vai até 09:20 — ocupa DUAS faixas (rowSpan), o caso da clínica
    congelarRelogioEm(`${DIA_FICTICIO}T11:20:00Z`)
    servidor.use(...handlersDaAgenda([cardFicticio({ fim: `${DIA_FICTICIO} 09:20`, duracao_minutos: 80 })]))

    // ACT
    const { container } = renderizarAgenda()
    await screen.findByRole('table')

    // ASSERT: a faixa das 08:00 é a de agora, 20 de 60 minutos abaixo do topo dela
    const faixa = document.querySelector('tr[data-horario="08:00"]')
    expect(faixa).toHaveAttribute('data-agora', 'true')
    expect(faixa?.getAttribute('style')).toContain('--agora: 33%')
    expect(document.querySelector('tr[data-horario="09:00"]')).not.toHaveAttribute('data-agora')
    // a célula do card (que ocupa DUAS faixas de 60 min: sessão de 08:00 às 09:20) divide o % pelo
    // rowSpan — senão a linha cairia quase uma faixa abaixo nessa coluna (design-qa DQA-02)
    const celulaDoCard = document.querySelector('tr[data-horario="08:00"] td[rowspan="2"]')
    expect(celulaDoCard?.getAttribute('style')).toContain('--agora-celula: calc(var(--agora) / 2)')
    expect(celulaDoCard?.className).toContain('before:top-(--agora-celula)')
    // e a coluna de horários diz que horas são, distinguindo o agora do horário da faixa
    const cabecalhoDaFaixa = document.querySelector('tr[data-horario="08:00"] th')
    expect(cabecalhoDaFaixa).toHaveTextContent('08:00, agora são 08:20')
    // o axe vê a grade COM a linha desenhada (a11y-auditor AV-02): nenhuma outra célula a via
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve correr a linha do agora POR TRÁS do card, num traço de 1px', async () => {
    // ARRANGE: 08:20 na clínica e a sessão fictícia começando às 08:00 — o caso que a clínica
    // encontra o dia inteiro, porque sessão começa em horário redondo
    congelarRelogioEm(`${DIA_FICTICIO}T11:20:00Z`)
    servidor.use(...handlersDaAgenda([cardFicticio()]))

    // ACT
    renderizarAgenda()
    await screen.findByRole('table')

    // ASSERT: o traço afinou — 1px marca a hora sem disputar a atenção com o card
    const celulaComALinha = document.querySelector('td.before\\:bg-destaque')
    expect(celulaComALinha?.className).toContain('before:h-px')
    expect(celulaComALinha?.className).not.toContain('before:h-0.5')
    // e a pilha de cards é POSICIONADA: a linha é um `::before` absoluto da célula, que pinta
    // depois do conteúdo em fluxo (ordem de pintura do CSS) — sem pôr a pilha na mesma camada,
    // o verde passa POR CIMA do card e risca o nome do paciente
    const card = celulaComALinha?.querySelector('article[data-card-id]')
    expect(card, 'o card fictício das 08:00 deveria estar na célula da linha do agora').not.toBeNull()
    expect(card?.parentElement?.className).toContain('relative')
  })

  it('deve escrever a hora de agora ao lado do ponto, e dizê-la uma vez só', async () => {
    // ARRANGE
    congelarRelogioEm(`${DIA_FICTICIO}T11:20:00Z`)
    servidor.use(...handlersDaAgenda([cardFicticio()]))

    // ACT
    renderizarAgenda()
    await screen.findByRole('table')

    // ASSERT: a hora é texto VISÍVEL (nó de texto direto do rótulo, no acento) — não mais um
    // `sr-only` que só o leitor de tela alcançava: "ninguém sabe o que é aquilo"
    const cabecalhoDaFaixa = document.querySelector('tr[data-horario="08:00"] th')
    const rotuloDoAgora = cabecalhoDaFaixa?.querySelector('.text-acento')
    const textoVisivel = [...(rotuloDoAgora?.childNodes ?? [])]
      .filter((no) => no.nodeType === Node.TEXT_NODE)
      .map((no) => no.textContent)
      .join('')
    expect(textoVisivel).toBe('08:20')
    // e ninguém anuncia duas vezes: a hora aparece UMA vez no cabeçalho de linha
    expect(cabecalhoDaFaixa?.textContent?.match(/08:20/g)).toHaveLength(1)
  })

  it('deve não desenhar a linha nem escrever a hora quando a data da tela não é hoje', async () => {
    // ARRANGE: o relógio está em outro dia
    congelarRelogioEm('2026-07-20T11:20:00Z')
    servidor.use(...handlersDaAgenda([cardFicticio()]))

    // ACT
    renderizarAgenda()
    await screen.findByRole('table')

    // ASSERT: a faixa até existe (o relógio marca 08:20), mas nenhuma célula desenha a linha —
    // e a coluna de horários não ganha ponto nem hora: marcador sem linha é marcador sem sentido
    expect(document.querySelector('td.before\\:bg-destaque')).toBeNull()
    expect(document.querySelector('tr[data-agora="true"]')).toBeNull()
    expect(screen.queryByText(/agora são/)).toBeNull()
  })

  it('deve não escrever a hora quando o agora está fora da janela da grade', async () => {
    // ARRANGE: é hoje na clínica, mas são 15:00 — o profissional fictício atende 08:00–12:00,
    // então o relógio caiu fora do eixo e não há faixa onde pousar a linha
    congelarRelogioEm(`${DIA_FICTICIO}T18:00:00Z`)
    servidor.use(...handlersDaAgenda([cardFicticio()]))

    // ACT
    renderizarAgenda()
    await screen.findByRole('table')

    // ASSERT
    expect(document.querySelector('tr[data-agora="true"]')).toBeNull()
    expect(document.querySelector('td.before\\:bg-destaque')).toBeNull()
    expect(screen.queryByText(/agora são/)).toBeNull()
  })

  it('deve convidar em palavras no horário livre — o mesmo começo do nome acessível', async () => {
    // ARRANGE
    congelarRelogioEm('2026-07-20T11:20:00Z')
    servidor.use(...handlersDaAgenda([cardFicticio()]))

    // ACT
    renderizarAgenda()
    const slot = await screen.findByRole('button', { name: /^Marcar às 09:00/ })

    // ASSERT
    expect(slot).toHaveTextContent('Marcar às 09:00')
  })

  it('deve mostrar as iniciais do profissional com o anel da especialidade na lista', async () => {
    // ARRANGE
    congelarRelogioEm('2026-07-20T11:20:00Z')
    servidor.use(...handlersDaAgenda([cardFicticio()]))

    // ACT
    renderizarAgenda()
    await screen.findByRole('table')

    // ASSERT: decorativo (o nome segue em texto), com a cor da especialidade na borda
    const avatar = screen.getAllByText('PA').find((elemento) => elemento.getAttribute('aria-hidden') === 'true')
    expect(avatar).toBeDefined()
    expect(avatar?.getAttribute('style')).toContain('border-color')
  })

  it('deve não redesenhar os cards no tique do relógio — o memo do card segura', async () => {
    // ARRANGE: relógio E intervalo falsos (MSW e React Query usam setTimeout, que fica real)
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(`${DIA_FICTICIO}T11:20:00Z`))
    servidor.use(...handlersDaAgenda([cardFicticio({ id: 1 }), cardFicticio({ id: 2, inicio: `${DIA_FICTICIO} 10:00` })]))
    renderizarAgenda(['agenda.ver', 'agenda.criar', 'agenda.editar'])
    await screen.findAllByTestId('menu-de-status')
    const antes = rendersDoMenu.total
    expect(antes).toBeGreaterThan(0)

    // ACT: um minuto
    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    // ASSERT: a faixa andou (o relógio foi lido) e nenhum menu — logo nenhum card — redesenhou
    expect(document.querySelector('tr[data-horario="08:00"]')).toHaveAttribute('data-agora', 'true')
    expect(document.querySelector('tr[data-horario="08:00"]')?.getAttribute('style')).toContain('--agora: 35%')
    expect(rendersDoMenu.total).toBe(antes)
  })

  it('deve anunciar o que a grade DESENHA — card de profissional sem coluna não conta', async () => {
    // ARRANGE: um card de profissional que não está na seleção (inativado com agenda) — a
    // grade não tem coluna para ele, então a tela diz "nenhum"; o anúncio precisa dizer o mesmo
    congelarRelogioEm('2026-07-20T11:20:00Z')
    servidor.use(...handlersDaAgenda([cardFicticio({ profissional_id: 99 })]))

    // ACT
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'] }, carregandoSessao: false })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}&visao=geral`]}>
            <PaginaAgenda />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await screen.findByRole('heading', { name: 'Nenhum agendamento neste período' })

    // ASSERT
    expect(screen.getByRole('status')).toHaveTextContent(/^Nenhum agendamento em /)
  })
})
