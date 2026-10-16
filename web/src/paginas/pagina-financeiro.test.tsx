import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaFinanceiro } from '@/paginas/pagina-financeiro'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { LancamentoCaixa } from '@/tipos'

function lancamento(sobrescritas: Partial<LancamentoCaixa> = {}): LancamentoCaixa {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    tipo: 'receita',
    competencia: '2026-07-01',
    vencimento: '2026-07-10',
    categoria_id: 1,
    subcategoria_id: null,
    valor: '150.00',
    juros: '0.00',
    multa: '0.00',
    desconto: '0.00',
    liquido: '150.00',
    tipo_pagamento_id: 1,
    conta_id: 1,
    contabil: true,
    documento: null,
    agendamento_id: null,
    grupo_parcelamento: null,
    parcela: null,
    parcelas_total: null,
    pago_em: null,
    interessado: { tipo: 'paciente', id: 10, nome: 'Ana Beatriz' },
    ...sobrescritas,
  }
}

function pagina(itens: LancamentoCaixa[]) {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

/** Contas: o filtro do topo as consome; default vazio. */
function mockContas() {
  servidor.use(msw.get('/api/contas', () => HttpResponse.json([])))
}

function renderizar(permissoes: string[] = ['lancamentos.ver']) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/financeiro']}>
          <PaginaFinanceiro />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Financeiro — a lista e seus quatro estados', () => {
  it('deve carregar e mostrar os lançamentos', async () => {
    // ARRANGE
    mockContas()
    servidor.use(msw.get('/api/lancamentos', () => HttpResponse.json(pagina([lancamento()]))))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Ana Beatriz')).toBeInTheDocument()
    expect(screen.getByText('R$ 150,00')).toBeInTheDocument()
  })

  it('deve dizer que o recorte está vazio, não parecer quebrado', async () => {
    // ARRANGE
    mockContas()
    servidor.use(msw.get('/api/lancamentos', () => HttpResponse.json(pagina([]))))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhum lançamento neste recorte')).toBeInTheDocument()
  })

  it('deve mostrar erro com nova tentativa — falha de rede não é "nenhum lançamento"', async () => {
    // ARRANGE — a lição já registrada: consulta que falha NUNCA vira lista vazia
    mockContas()
    servidor.use(msw.get('/api/lancamentos', () => new HttpResponse(null, { status: 500 })))

    // ACT
    renderizar()

    // ASSERT
    const erro = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(within(erro).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    expect(screen.queryByText('Nenhum lançamento neste recorte')).not.toBeInTheDocument()
  })
})

describe('Financeiro — o filtro é do SERVIDOR', () => {
  it('deve repassar a situação (pago/em aberto) à API, não filtrar no cliente', async () => {
    // ARRANGE
    mockContas()
    const buscas: string[] = []
    servidor.use(
      msw.get('/api/lancamentos', ({ request }) => {
        buscas.push(new URL(request.url).search)
        return HttpResponse.json(pagina([lancamento()]))
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Ana Beatriz')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Em aberto' }))

    // ASSERT
    await waitFor(() => {
      expect(buscas.some((busca) => busca.includes('pago=0'))).toBe(true)
    })
  })

  it('deve não exibir a obs (texto livre sensível) na listagem', async () => {
    // ARRANGE — mesmo que a obs chegue por engano no payload da lista, a tela não a renderiza
    mockContas()
    servidor.use(
      msw.get('/api/lancamentos', () =>
        HttpResponse.json(pagina([{ ...lancamento(), obs: 'segredo-do-paciente' }])),
      ),
    )

    // ACT
    renderizar()
    await screen.findByText('Ana Beatriz')

    // ASSERT
    expect(screen.queryByText('segredo-do-paciente')).not.toBeInTheDocument()
  })
})

describe('Financeiro — a aba Fluxo de caixa exige a permissão dos agregados (totais-do-caixa)', () => {
  it('deve não oferecer a aba Fluxo de caixa a quem tem só lancamentos.ver', async () => {
    // ARRANGE — a recepção/faturista de AP-10: opera lançamentos, não vê o total
    mockContas()
    servidor.use(msw.get('/api/lancamentos', () => HttpResponse.json(pagina([lancamento()]))))

    // ACT
    renderizar(['lancamentos.ver'])
    await screen.findByText('Ana Beatriz')

    // ASSERT — a afordância SOME (nunca aba desabilitada); Lançamentos segue plena
    expect(screen.queryByRole('tab', { name: 'Fluxo de caixa' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Lançamentos' })).toBeInTheDocument()
  })

  it('deve oferecer a aba e carregar os totais do servidor com fluxo_caixa.ver', async () => {
    // ARRANGE
    mockContas()
    servidor.use(
      msw.get('/api/lancamentos', () => HttpResponse.json(pagina([lancamento()]))),
      msw.get('/api/fluxo-caixa', () =>
        HttpResponse.json({
          de: '2026-07-01',
          ate: '2026-07-31',
          conta_id: null,
          saldo_anterior: '0.00',
          movimentos: [],
          totais: { entradas: '200.00', saidas: '80.00', saldo_do_periodo: '120.00', transferido: '0.00' },
        }),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(['lancamentos.ver', 'fluxo_caixa.ver'])
    await screen.findByText('Ana Beatriz')

    // ACT — as duas abas existem; abrir o fluxo de caixa
    await usuario.click(screen.getByRole('tab', { name: 'Fluxo de caixa' }))

    // ASSERT — os totais vêm do servidor
    expect(await screen.findByText('R$ 200,00')).toBeInTheDocument()
    expect(screen.getByText('R$ 120,00')).toBeInTheDocument()
    // a escolhida e a outra com o canto de controle, nunca a pílula do botão (change tema-da-clinica)
    for (const aba of screen.getAllByRole('tab')) {
      expect(aba).toHaveClass('rounded-t-controle', 'rounded-b-none')
    }
  })
})

describe('Financeiro — a afordância deriva da permissão', () => {
  it('deve não oferecer Pagar a quem não tem lancamentos.pagar', async () => {
    // ARRANGE
    mockContas()
    servidor.use(msw.get('/api/lancamentos', () => HttpResponse.json(pagina([lancamento()]))))

    // ACT — só ver
    renderizar(['lancamentos.ver'])
    await screen.findByText('Ana Beatriz')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Pagar' })).not.toBeInTheDocument()
  })

  it('deve oferecer Pagar a quem tem lancamentos.pagar', async () => {
    // ARRANGE
    mockContas()
    servidor.use(msw.get('/api/lancamentos', () => HttpResponse.json(pagina([lancamento()]))))

    // ACT
    renderizar(['lancamentos.ver', 'lancamentos.pagar'])
    await screen.findByText('Ana Beatriz')

    // ASSERT
    expect(screen.getByRole('button', { name: 'Pagar' })).toBeInTheDocument()
  })

  it('deve não oferecer Excluir de um lançamento PAGO (é documento contábil)', async () => {
    // ARRANGE — pago não tem célula de exclusão (T-fin-09); oferece estorno e recibo
    mockContas()
    servidor.use(
      msw.get('/api/lancamentos', () =>
        HttpResponse.json(pagina([lancamento({ pago_em: '2026-07-10 14:00' })])),
      ),
    )

    // ACT
    renderizar(['lancamentos.ver', 'lancamentos.excluir', 'lancamentos.pagar'])
    await screen.findByText('Ana Beatriz')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Estornar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recibo' })).toBeInTheDocument()
  })

  it('deve oferecer Excluir de um lançamento EM ABERTO a quem pode excluir', async () => {
    // ARRANGE
    mockContas()
    servidor.use(msw.get('/api/lancamentos', () => HttpResponse.json(pagina([lancamento()]))))

    // ACT
    renderizar(['lancamentos.ver', 'lancamentos.excluir'])
    await screen.findByText('Ana Beatriz')

    // ASSERT
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument()
  })
})

describe('Financeiro — o caminho até os pagamentos sem tratamento (vincular-pagamentos-ao-tratamento)', () => {
  it('deve levar ao lote quem tem as três permissões dele', async () => {
    // ARRANGE
    mockContas()
    servidor.use(msw.get('/api/lancamentos', () => HttpResponse.json(pagina([lancamento()]))))

    // ACT
    renderizar(['lancamentos.ver', 'lancamentos.editar', 'lancamentos.pagar', 'tratamentos.ver'])

    // ASSERT
    expect(await screen.findByRole('link', { name: 'Pagamentos sem tratamento' })).toHaveAttribute(
      'href',
      '/financeiro/vincular',
    )
  })

  it('deve não oferecer o link a quem não dá baixa — ele levaria a "acesso negado"', async () => {
    // ARRANGE
    mockContas()
    servidor.use(msw.get('/api/lancamentos', () => HttpResponse.json(pagina([lancamento()]))))

    // ACT
    renderizar(['lancamentos.ver', 'lancamentos.editar', 'tratamentos.ver'])
    await screen.findByText('Ana Beatriz')

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Pagamentos sem tratamento' })).not.toBeInTheDocument()
  })
})

describe('Financeiro — o caminho até o DRE', () => {
  it('deve levar do Fluxo de caixa ao DRE e à configuração dele', async () => {
    // ARRANGE — o DRE é o resultado da clínica: mora ao lado do Fluxo, que já exige ver o caixa
    mockContas()
    servidor.use(
      msw.get('/api/lancamentos', () => HttpResponse.json(pagina([]))),
      msw.get('/api/fluxo-caixa', () =>
        HttpResponse.json({
          de: '2026-07-01',
          ate: '2026-07-31',
          conta_id: null,
          saldo_anterior: '0.00',
          movimentos: [],
          totais: { entradas: '0.00', saidas: '0.00', saldo_do_periodo: '0.00', transferido: '0.00' },
        }),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(['lancamentos.ver', 'fluxo_caixa.ver'])
    expect(screen.queryByRole('link', { name: 'Ver o DRE' })).not.toBeInTheDocument()

    // ACT
    await usuario.click(screen.getByRole('tab', { name: 'Fluxo de caixa' }))

    // ASSERT
    expect(screen.getByRole('link', { name: 'Ver o DRE' })).toHaveAttribute('href', '/relatorios/dre-gerencial')
    expect(screen.getByRole('link', { name: 'Configurar DRE' })).toHaveAttribute('href', '/financeiro/dre/configurar')
  })
})
