import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellDeIndicadores } from '@/componentes/indicadores/shell-de-indicadores'
import { useMesDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

/** TODOS os meses que a aba recebeu, render a render — um só fora do alcance já dispara 4 × 422. */
const mesesRecebidos: string[] = []

/** A aba de teste mostra o mês que o shell lhe entrega, e o endereço. */
function AbaDeTeste() {
  const mes = useMesDosIndicadores()
  const { search } = useLocation()
  mesesRecebidos.push(mes)

  return (
    <p>
      mês da aba: {mes} · endereço: {search}
    </p>
  )
}

function renderizar(caminho: string) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'] }, carregandoSessao: false })
  servidor.use(msw.get('/api/agenda/configuracoes', () => HttpResponse.json({ configuracoes: [] })))

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route element={<ShellDeIndicadores />}>
            <Route path="/indicadores" element={<AbaDeTeste />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  mesesRecebidos.length = 0
  // 5 de outubro de 2026 na parede da clínica (São Paulo, o fuso padrão)
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T10:00:00-03:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ShellDeIndicadores — o período nunca sai do alcance (CR-IND-17)', () => {
  it('deve desligar o "Próximo mês" no mês corrente da clínica', async () => {
    // ARRANGE + ACT
    renderizar('/indicadores?mes=2026-10')

    // ASSERT — o mês futuro não tem números: o botão não convida a uma tela de erro
    expect(await screen.findByText(/mês da aba: 2026-10/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeEnabled()
  })

  it('deve deixar o "Próximo mês" ligado num mês passado', async () => {
    // ARRANGE + ACT
    renderizar('/indicadores?mes=2026-09')

    // ASSERT
    expect(await screen.findByText(/mês da aba: 2026-09/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeEnabled()
  })

  it.each([
    ['um mês futuro', '2026-12'],
    ['um mês antes de 2000', '1999-12'],
  ])('deve trocar %s pelo mês corrente, na tela e no endereço', async (_caso, mes) => {
    // ARRANGE + ACT — o link editado ou copiado de um "Próximo mês" antigo
    renderizar(`/indicadores?mes=${mes}`)

    // ASSERT — a aba nunca recebe o mês fora do alcance (os painéis responderiam 422), e o endereço
    // passa a dizer o mês que a tela mostra
    expect(await screen.findByText(/mês da aba: 2026-10/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/endereço: \?mes=2026-10/)).toBeInTheDocument())
    expect(mesesRecebidos.length).toBeGreaterThan(0)
    expect(mesesRecebidos).not.toContain(mes)
  })
})
