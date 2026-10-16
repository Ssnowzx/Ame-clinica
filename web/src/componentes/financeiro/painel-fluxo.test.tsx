import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { PainelFluxo } from '@/componentes/financeiro/painel-fluxo'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

function renderizar(permissoes: string[] = ['lancamentos.ver']) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <PainelFluxo />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

const EXTRATO = {
  de: '2026-07-01',
  ate: '2026-07-31',
  conta_id: null,
  saldo_anterior: '0.00',
  movimentos: [
    {
      movimento: 'receita',
      lancamento_id: 1,
      conta_id: 1,
      categoria_id: 1,
      valor_liquido: '100.00',
      pago_em: '2026-07-05 10:00',
      interessado: { tipo: 'paciente', id: 10, nome: 'Ana' },
      saldo: '100.00',
    },
    {
      movimento: 'transferencia',
      transferencia_id: 1,
      conta_origem_id: 1,
      conta_destino_id: 2,
      valor: '500.00',
      data: '2026-07-06',
      // sem conta, a transferência entre duas contas não muda o saldo da clínica
      saldo: '100.00',
    },
  ],
  totais: { entradas: '100.00', saidas: '0.00', saldo_do_periodo: '100.00', transferido: '500.00' },
}

beforeEach(() => {
  queryClient.clear()
})

describe('Fluxo de caixa — os totais são do SERVIDOR', () => {
  it('deve exibir os totais calculados pela API, sem somar no cliente', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json([])),
      msw.get('/api/fluxo-caixa', () => HttpResponse.json(EXTRATO)),
    )

    // ACT
    renderizar()

    // ASSERT — os quatro totais do payload aparecem
    expect(await screen.findByText('Entradas')).toBeInTheDocument()
    expect(screen.getByText('Transferido')).toBeInTheDocument()
    expect(screen.getAllByText('R$ 500,00').length).toBeGreaterThan(0)
  })

  it('deve manter a transferência FORA de entradas/saídas', async () => {
    // ARRANGE — se o cliente somasse a transferência em entradas, entradas viraria R$ 600,00
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json([])),
      msw.get('/api/fluxo-caixa', () => HttpResponse.json(EXTRATO)),
    )

    // ACT
    renderizar()
    await screen.findByText('Transferência')

    // ASSERT — a transferência é movimento próprio; a soma errada (600) não existe
    expect(screen.getByText('Transferência')).toBeInTheDocument()
    expect(screen.queryByText('R$ 600,00')).not.toBeInTheDocument()
  })
})

describe('Fluxo de caixa — o 422 da janela é acionável', () => {
  it('deve mostrar a mensagem de refinar o intervalo, não o "tente novamente" genérico', async () => {
    // ARRANGE — janela máxima estourada: repetir não resolve, refinar sim
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json([])),
      msw.get('/api/fluxo-caixa', () =>
        HttpResponse.json(
          { message: 'Janela máxima de 366 dias.', errors: { ate: ['Janela máxima de 366 dias.'] } },
          { status: 422 },
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Janela máxima de 366 dias.')).toBeInTheDocument()
  })
})
