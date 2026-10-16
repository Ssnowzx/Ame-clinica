import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import type { CardAgendamento } from '@/tipos'
import { cardFicticio, CONFIGURACAO_FICTICIA, DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

/**
 * O horário que a SITUAÇÃO liberou volta a ser marcável (change grade-conhece-ocupa-horario).
 *
 * O servidor já aceitava: `VerificadorDeConflitos` só conta como ocupante quem é bloqueio ou tem
 * `status.ocupa_horario`. A grade é que dizia "tem card ⇒ ocupado" e engolia o gesto seguinte —
 * que é justamente puxar outra criança para o horário que vagou.
 */

/** O mesmo card da demo, na situação que LIBERA o horário. */
function cardLiberado(sobrescritas: Partial<CardAgendamento> = {}): CardAgendamento {
  return cardFicticio({
    status: { id: 7, nome: 'Desmarcado pelo Profissional', cor: '#64748B', cor_borda: null, tipo: null, ocupa_horario: false },
    ...sobrescritas,
  })
}

function renderizarAgenda(
  cards: CardAgendamento[],
  permissoes: string[] = ['agenda.ver', 'agenda.criar'],
  comArrasto = false,
) {
  // no MSW ganha o PRIMEIRO handler que casar: o override tem de entrar na MESMA chamada,
  // antes da lista, senão o handler da lista responde e a config do arrasto nunca chega
  servidor.use(
    ...(comArrasto
      ? [
          msw.get('/api/agenda/configuracoes', () =>
            HttpResponse.json({
              configuracoes: [
                ...CONFIGURACAO_FICTICIA.configuracoes,
                { chave: 'agenda.arrastar_para_remarcar', tipo: 'bool', valor: true },
              ],
            }),
          ),
        ]
      : []),
    ...handlersDaAgenda(cards),
  )
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

beforeEach(() => {
  queryClient.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Agenda — o horário que a situação liberou', () => {
  it('deve oferecer o horário de volta, sem apagar o card que estava nele', async () => {
    // ARRANGE — um único card das 08:00, na situação que libera
    renderizarAgenda([cardLiberado()])
    await screen.findByRole('table')

    // ACT
    const convite = screen.queryByRole('button', { name: /^Marcar às 08:00/ })

    // ASSERT — o slot convida DE NOVO e o histórico continua desenhado
    expect(convite).toBeInTheDocument()
    expect(screen.getByText('Paciente Fictício')).toBeInTheDocument()
  })

  it('deve manter o eixo de acessibilidade na célula que tem card E convite', async () => {
    // ARRANGE — a condição REAL da change: dois controles na mesma célula, não a célula vazia
    const { container } = renderizarAgenda([cardLiberado()])
    await screen.findByRole('table')
    await screen.findByRole('button', { name: /^Marcar às 08:00/ })

    // ACT
    const resultado = await axe(container)

    // ASSERT — e o nome acessível distingue o convite do card que está ali
    expect(resultado).toHaveNoViolations()
    expect(screen.getByRole('button', { name: 'Marcar às 08:00 com Profissional Fictício A' })).toBeInTheDocument()
  })

  it('deve manter a linha do agora POR TRÁS do card na célula que também tem convite', async () => {
    // ARRANGE — 08:20 na clínica, card das 08:00 na situação que libera: a célula ganha card,
    // convite E a linha do agora ao mesmo tempo. É a condição que a change criou.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${DIA_FICTICIO}T11:20:00Z`))
    renderizarAgenda([cardLiberado()])
    await screen.findByRole('table')
    await screen.findByRole('button', { name: /^Marcar às 08:00/ })

    // ACT
    const celulaComALinha = document.querySelector('td.before\\:bg-destaque')

    // ASSERT — a pilha continua POSICIONADA: mover o convite para depois dela não trocou a
    // camada que impede o traço de riscar o nome do paciente
    const card = celulaComALinha?.querySelector('article[data-card-id]')
    expect(card, 'o card liberado das 08:00 deveria estar na célula da linha do agora').not.toBeNull()
    expect(card?.parentElement?.className).toContain('relative')
    expect(celulaComALinha?.className).toContain('before:h-px')
  })

  it('deve continuar recusando o horário quando a situação ocupa', async () => {
    // ARRANGE — o par do teste acima: sem ele, "convida" passaria por acidente
    renderizarAgenda([cardFicticio()])
    await screen.findByRole('table')

    // ACT + ASSERT
    expect(screen.queryByRole('button', { name: /^Marcar às 08:00/ })).not.toBeInTheDocument()
  })

  it('deve manter o horário tomado quando UM dos cards ainda ocupa', async () => {
    // ARRANGE — sobreposição do eixo paciente (`avisar`): um liberado, um em aberto
    renderizarAgenda([cardLiberado(), cardFicticio({ id: 2 })])
    await screen.findByRole('table')

    // ACT + ASSERT — basta um ocupante para o slot continuar fechado
    expect(screen.queryByRole('button', { name: /^Marcar às 08:00/ })).not.toBeInTheDocument()
  })

  it('deve devolver também o slot que o card longo cobria', async () => {
    // ARRANGE — 80 min numa grade de 60: com rowSpan, a faixa seguinte ficava sem `<td>`
    renderizarAgenda([cardLiberado({ fim: `${DIA_FICTICIO} 09:20`, duracao_minutos: 80 })])
    await screen.findByRole('table')

    // ACT + ASSERT — as duas faixas voltam a convidar
    expect(screen.queryByRole('button', { name: /^Marcar às 08:00/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Marcar às 09:00/ })).toBeInTheDocument()
  })

  it('deve continuar sem convite no horário fora da janela do profissional', async () => {
    // ARRANGE — a demo atende até as 12:00; um card liberado às 13:00 não abre a janela
    renderizarAgenda([cardLiberado({ inicio: `${DIA_FICTICIO} 13:00`, fim: `${DIA_FICTICIO} 13:40` })])
    await screen.findByRole('table')

    // ACT + ASSERT
    expect(screen.queryByRole('button', { name: /^Marcar às 13:00/ })).not.toBeInTheDocument()
  })

  it('deve aceitar o horário liberado como alvo da remarcação por teclado', async () => {
    // ARRANGE — com o arrasto ligado, o modo por teclado oferece os slots LIVRES como alvo
    const usuario = userEvent.setup()
    // duas faixas: a das 08:00 tem o card liberado, a das 09:00 tem o card que será remarcado
    renderizarAgenda(
      [cardLiberado(), cardFicticio({ id: 2, inicio: `${DIA_FICTICIO} 09:00`, fim: `${DIA_FICTICIO} 10:00` })],
      ['agenda.ver', 'agenda.editar'],
      true,
    )
    await screen.findByRole('table')

    // ACT — entra no modo pelo card das 09:00
    const acoes = screen.getAllByRole('button', { name: 'Remarcar Paciente Fictício para outro horário' })
    await usuario.click(acoes[acoes.length - 1])

    // ASSERT — as 08:00 aparecem como alvo, ainda mostrando o card que liberou
    const alvo = await screen.findByRole('button', { name: /^Remarcar para 08:00/ })
    expect(alvo).toBeInTheDocument()
    expect(within(alvo).getByText(/Remarcar para 08:00/)).toBeInTheDocument()
  })
})
