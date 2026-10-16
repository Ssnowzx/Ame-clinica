import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { ProvedorToast } from '@/componentes/ui/toast'
import { usarMutacaoDeFaturamento } from '@/hooks/usar-mutacao-de-faturamento'
import { queryClient } from '@/lib/query-client'
import { servidor } from '@/test/servidor-msw'

/** Harness mínimo: um botão que fatura, expondo o aviso de erro e o travamento. */
function Harness() {
  const { faturar, erros, faturando } = usarMutacaoDeFaturamento()
  return (
    <>
      <AvisoErro mensagens={erros.gerais} />
      <Botao
        carregando={faturando}
        onClick={() => {
          faturar.mutate({
            agendamentoId: 42,
            payload: { categoria_id: 1, tipo_pagamento_id: 2, conta_id: 3 },
          })
        }}
      >
        Faturar
      </Botao>
    </>
  )
}

function renderizarHarness() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <Harness />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usarMutacaoDeFaturamento — o lançamento novo reverbera nas telas certas', () => {
  it('deve reconsultar financeiro, notificações e o agendamento e anunciar o valor no sucesso', async () => {
    // ARRANGE — sem estas invalidações, a ficha financeira e o fluxo mostrariam o caixa velho
    const usuario = userEvent.setup()
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries')
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos/42/faturamento', () =>
        HttpResponse.json(
          { id: 900, tipo: 'receita', valor: '150.00', desconto: '0.00', liquido: '150.00', agendamento_id: 42 },
          { status: 201 },
        ),
      ),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Faturar' }))

    // ASSERT
    expect(await screen.findByText('Lançado no financeiro: R$ 150,00')).toBeInTheDocument()
    const chaves = invalidar.mock.calls.map(([opcoes]) => JSON.stringify(opcoes?.queryKey))
    expect(chaves).toEqual(
      expect.arrayContaining([
        JSON.stringify(['lancamentos']),
        JSON.stringify(['fluxo-caixa']),
        JSON.stringify(['notificacoes']),
        JSON.stringify(['agenda', 'agendamento', 42]),
      ]),
    )
  })

  it('deve não reexecutar o POST quando o servidor recusa, e pousar o motivo no aviso', async () => {
    // ARRANGE — um POST repetido por conta própria é a corrida de duplo faturamento (T-fin-13)
    const usuario = userEvent.setup()
    let tentativas = 0
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos/42/faturamento', () => {
        tentativas += 1
        return HttpResponse.json(
          { message: 'Inválido.', errors: { agendamento_id: ['Este agendamento já foi faturado.'] } },
          { status: 422 },
        )
      }),
    )
    renderizarHarness()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Faturar' }))

    // ASSERT
    expect(await screen.findByRole('alert')).toHaveTextContent('Este agendamento já foi faturado.')
    await waitFor(() => {
      expect(tentativas).toBe(1)
    })
  })
})
