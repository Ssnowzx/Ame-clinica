import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, DIA_FICTICIO, handlersDaAgenda, SELECAO_FICTICIA } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CardAgendamento } from '@/tipos'

/**
 * A célula do profissional que atende em GRUPO continua convidando até lotar
 * (change atendimento-em-grupo, D5).
 *
 * Sem isto a recepção marca a primeira criança e fica SEM ONDE CLICAR para marcar a segunda —
 * num horário que o servidor aceitaria. É a divergência de 11/09 outra vez: tela e servidor
 * com frases diferentes sobre o que é horário ocupado, cada lado passando sozinho no seu teste.
 */

/** As N crianças do grupo, todas no mesmo horário do mesmo profissional. */
function grupoDe(quantos: number): CardAgendamento[] {
  return Array.from({ length: quantos }, (_, i) =>
    cardFicticio({
      id: 100 + i,
      paciente: { id: 200 + i, nome: `Paciente Fictício ${i + 1}`, nome_social: null },
    }),
  )
}

function renderizarAgenda(cards: CardAgendamento[], capacidade: number) {
  // o override entra ANTES da lista: no MSW ganha o primeiro handler que casar
  servidor.use(
    msw.get('/api/agenda/selecao', () =>
      HttpResponse.json({
        ...SELECAO_FICTICIA,
        profissionais: SELECAO_FICTICIA.profissionais.map((profissional) =>
          profissional.id === 1 ? { ...profissional, atendimentos_simultaneos: capacidade } : profissional,
        ),
      }),
    ),
    ...handlersDaAgenda(cards),
  )
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes: ['agenda.ver', 'agenda.criar', 'agenda.editar'] },
    carregandoSessao: false,
  })

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

describe('Agenda — atendimento em grupo', () => {
  it('deve continuar oferecendo o horário enquanto o grupo tem vaga', async () => {
    // ARRANGE + ACT — duas das quatro crianças já marcadas às 08:00
    renderizarAgenda(grupoDe(2), 4)
    await screen.findByRole('table')

    // ASSERT — os dois cards aparecem E o convite continua ali
    expect(screen.getByText('Paciente Fictício 1')).toBeInTheDocument()
    expect(screen.getByText('Paciente Fictício 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Marcar às 08:00/ })).toBeInTheDocument()
  })

  it('deve parar de oferecer o horário quando o grupo lota', async () => {
    // ARRANGE + ACT
    renderizarAgenda(grupoDe(4), 4)
    await screen.findByRole('table')

    // ASSERT — as quatro entraram; a quinta não tem onde clicar, como o servidor recusaria
    expect(screen.getByText('Paciente Fictício 4')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar às 08:00/ })).not.toBeInTheDocument()
  })

  it('deve tomar o horário no primeiro card quando o profissional atende um por vez', async () => {
    // ARRANGE + ACT — o comportamento de sempre, que o default 1 preserva
    renderizarAgenda(grupoDe(1), 1)
    await screen.findByRole('table')

    // ASSERT
    expect(screen.queryByRole('button', { name: /Marcar às 08:00/ })).not.toBeInTheDocument()
  })
})
