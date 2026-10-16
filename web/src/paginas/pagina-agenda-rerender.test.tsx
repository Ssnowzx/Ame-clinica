import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

let commits = 0

beforeEach(() => {
  queryClient.clear()
  commits = 0
})

/**
 * O BAIL-OUT DO `setAlcance` (change agenda-no-mouse, D2).
 *
 * `medirAlcance` roda a cada evento de `scroll` da grade. Se ele escrevesse estado novo a cada
 * chamada, a Visão Geral re-renderizaria **a cada quadro de rolagem** — com os 298 cards do
 * piso do §16, e sem o memo do card ajudar, porque o `chip={<MenuDeStatus/>}` cria elemento
 * novo a cada render. Por isso o `setAlcance` compara antes de escrever.
 *
 * O comentário do código já dizia que isso é load-bearing; o gate mostrou que **nada guardava**.
 * Guarda adotada do parecer do `code-reviewer`, com os nomes da casa.
 */
describe('Agenda — a rolagem não re-renderiza a grade', () => {
  it('não deve re-renderizar a cada quadro de rolagem (bail-out do alcance)', async () => {
    // ARRANGE
    servidor.use(...handlersDaAgenda([cardFicticio()]))
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'] },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}&visao=geral`]}>
            <Profiler id="agenda" onRender={() => { commits += 1 }}>
              <PaginaAgenda />
            </Profiler>
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await screen.findByRole('table')
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
    const grade = document.querySelector<HTMLElement>('[data-grade-agenda]') as HTMLElement
    commits = 0

    // ACT — 20 quadros de rolagem, sem mudança de extremo
    await act(async () => {
      for (let i = 0; i < 20; i++) grade.dispatchEvent(new Event('scroll'))
    })

    // ASSERT
    expect(commits).toBe(0)
  })
})
