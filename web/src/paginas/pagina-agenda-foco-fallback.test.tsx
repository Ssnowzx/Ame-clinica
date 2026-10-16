import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, CONFIGURACAO_FICTICIA, DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

const CONFIG_COM_ARRASTO = {
  configuracoes: [
    ...CONFIGURACAO_FICTICIA.configuracoes,
    { chave: 'agenda.arrastar_para_remarcar', tipo: 'bool', valor: true },
  ],
}

/** Depois do PUT, o card SAI do período visível: a lista volta vazia. */
let cardsDaAgenda = [cardFicticio()]

function renderizarAgenda() {
  servidor.use(
    msw.get('/api/agenda/configuracoes', () => HttpResponse.json(CONFIG_COM_ARRASTO)),
    msw.get('/api/agenda', () => HttpResponse.json(cardsDaAgenda)),
    msw.put('/api/agendamentos/:id', () => {
      cardsDaAgenda = []
      return HttpResponse.json(cardFicticio())
    }),
    ...handlersDaAgenda(cardsDaAgenda),
  )
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes: ['agenda.ver', 'agenda.editar', 'lista_espera.ver'] },
    carregandoSessao: false,
  })
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

function stubElementFromPoint(alvo: Element | null): () => void {
  const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, writable: true, value: () => alvo })
  return () => {
    if (original === undefined) Reflect.deleteProperty(document, 'elementFromPoint')
    else Object.defineProperty(document, 'elementFromPoint', original)
  }
}

function arrastarPara(origem: Element, celulaAlvo: Element | null): void {
  const restaurar = stubElementFromPoint(celulaAlvo)
  fireEvent.pointerDown(origem, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 80 })
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 80 })
  restaurar()
}

beforeEach(() => {
  queryClient.clear()
  cardsDaAgenda = [cardFicticio()]
})

/**
 * O FALLBACK DE FOCO NÃO PODE DESLIGAR A REGIÃO FOCÁVEL (change agenda-no-mouse, D3).
 *
 * `focarNoGatilhoDoCard` cai no contêiner da grade quando o card sai do período visível. Antes
 * da change o contêiner não era focável, então o fallback escrevia `grade.tabIndex = -1` na
 * mão. Depois dela o contêiner nasce com `tabIndex={0}` — e a escrita imperativa passou a ser
 * um defeito silencioso: **o React não enxerga escrita externa**, a prop continua `0`, o diff
 * não acha mudança e o `tabindex="-1"` fica gravado até o remount da página.
 *
 * A região rolável saía da ordem de tabulação para sempre, levando junto a rolagem por setas —
 * e nada parecia quebrado, porque os botões de coluna continuavam tabuláveis. Achado do gate.
 *
 * O caminho exercitado é o de usuário: arrastar, confirmar, e o card ir para fora do período.
 */
describe('Agenda — o fallback de foco preserva a região focável', () => {
  it('deve manter a grade tabulável depois de remarcar para fora do período visível', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')
    const grade = document.querySelector<HTMLElement>('[data-grade-agenda]') as HTMLElement
    expect(grade.getAttribute('tabindex')).toBe('0') // a afordância nova, viva

    // ACT — arrasta, confirma, e o card some da grade (foi para outro dia)
    arrastarPara(screen.getByRole('article'), document.querySelector('[data-slot="2|' + DIA_FICTICIO + '|09:00"]'))
    const confirmacao = await screen.findByRole('dialog')
    const botao = within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' })
    await waitFor(() => { expect(botao).toBeEnabled() })
    await usuario.click(botao)
    await waitFor(() => { expect(screen.queryByRole('article')).not.toBeInTheDocument() })
    // o fallback roda depois de 30 rAF
    await waitFor(() => { expect(grade).toHaveFocus() }, { timeout: 3000 })

    // ASSERT 1 — o foco caiu na região E ela continua tabulável
    expect(grade.getAttribute('tabindex')).toBe('0')

    // ACT 2 — qualquer re-render posterior da página
    await usuario.click(await screen.findByRole('button', { name: 'Recolher a lista de espera' }))

    // o clique de fato re-renderizou a página (prova de que não é assert vazio)
    expect(await screen.findByRole('button', { name: 'Expandir a lista de espera' })).toBeInTheDocument()

    // ASSERT 2 — e continua depois de um re-render: se alguém reintroduzir a escrita
    // imperativa, é AQUI que o `-1` fica gravado para sempre
    expect(document.querySelector('[data-grade-agenda]')?.getAttribute('tabindex')).toBe('0')
  })
})
