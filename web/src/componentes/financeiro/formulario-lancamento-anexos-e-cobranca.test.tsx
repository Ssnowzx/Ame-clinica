import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { FormularioLancamento } from '@/componentes/financeiro/formulario-lancamento'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { LancamentoCaixaDetalhe } from '@/tipos'

expect.extend(toHaveNoViolations)

const QUEM_EDITA = ['lancamentos.ver', 'lancamentos.editar']

/** O DETALHE de uma receita fictícia de criança, em aberto. */
function lancamento(sobrescritas: Partial<LancamentoCaixaDetalhe> = {}): LancamentoCaixaDetalhe {
  return {
    id: 1,
    updated_at: '2026-09-25T10:00:00.000000Z',
    tipo: 'receita',
    competencia: '2026-10-01',
    vencimento: '2026-10-10',
    categoria_id: 1,
    subcategoria_id: null,
    valor: '450.00',
    juros: '0.00',
    multa: '0.00',
    desconto: '0.00',
    liquido: '450.00',
    tipo_pagamento_id: 1,
    conta_id: 1,
    contabil: true,
    documento: null,
    agendamento_id: null,
    grupo_parcelamento: null,
    parcela: null,
    parcelas_total: null,
    pago_em: null,
    interessado: { tipo: 'paciente', id: 10, nome: 'Criança Fictícia' },
    obs: null,
    em_ciclo_fechado: false,
    tratamento_id: null,
    ultima_cobranca: null,
    ...sobrescritas,
  }
}

function renderizar(lanc: LancamentoCaixaDetalhe | null, permissoes: string[] = QUEM_EDITA) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
  servidor.use(
    msw.get('/api/contas', () => HttpResponse.json([{ id: 1, nome: 'Caixa', ativo: true }])),
    msw.get('/api/categorias', () => HttpResponse.json([{ id: 1, nome: 'Sessões', tipo: 'receita', subcategorias: [] }])),
    msw.get('/api/tipos-pagamento', () => HttpResponse.json([{ id: 1, nome: 'PIX' }])),
  )

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <FormularioLancamento lancamento={lanc} aoFechar={() => undefined} />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Detalhe do lançamento — a seção Anexos', () => {
  it('deve mostrar a seção na edição', async () => {
    // ARRANGE + ACT
    renderizar(lancamento())

    // ASSERT
    expect(screen.getByRole('heading', { name: 'Anexos' })).toBeInTheDocument()
    expect(await screen.findByText(/Nenhum arquivo anexado/)).toBeInTheDocument()
  })

  it('deve aceitar anexo no lançamento PAGO e no de período fechado — anexo não é dinheiro', async () => {
    // ARRANGE + ACT (D3)
    renderizar(lancamento({ pago_em: '2026-10-05 10:00', em_ciclo_fechado: true }), [
      ...QUEM_EDITA,
      'lancamentos.pagar',
    ])

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Anexar arquivo' })).toBeInTheDocument()
  })

  it('deve não mostrar a seção no lançamento novo — ele ainda não existe para ter arquivo', () => {
    // ARRANGE + ACT
    renderizar(null, ['lancamentos.ver', 'lancamentos.criar'])

    // ASSERT
    expect(screen.queryByRole('heading', { name: 'Anexos' })).not.toBeInTheDocument()
  })

  it('deve não pedir a lista a quem não vê lançamentos — seria um 403 na tela', () => {
    // ARRANGE — a lista responderia 403; se a tela a pedisse, o teste veria
    let pedidos = 0
    servidor.use(
      msw.get('/api/lancamentos/1/anexos', () => {
        pedidos += 1
        return new HttpResponse(null, { status: 403 })
      }),
    )

    // ACT
    renderizar(lancamento(), ['lancamentos.editar'])

    // ASSERT
    expect(screen.queryByRole('heading', { name: 'Anexos' })).not.toBeInTheDocument()
    expect(pedidos).toBe(0)
  })
})

describe('Detalhe do lançamento — a cobrança', () => {
  it('deve mostrar quem abriu a última cobrança e oferecer cobrar de novo', () => {
    // ARRANGE + ACT
    renderizar(lancamento({ ultima_cobranca: { em: '2026-09-24 09:30', por: 'Operadora Fictícia' } }), [
      ...QUEM_EDITA,
      'pacientes.ver',
    ])

    // ASSERT
    expect(screen.getByText('Cobrança aberta em 24/09 por Operadora Fictícia.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cobrar pelo WhatsApp' })).toBeInTheDocument()
  })

  it('deve abrir a cobrança por cima da edição, sem fechar o formulário', async () => {
    // ARRANGE — dois diálogos empilhados: o da cobrança nasce DENTRO do da edição
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/lancamentos/1/cobranca', () =>
        HttpResponse.json({
          lancamento_id: 1,
          responsaveis: [
            { nome: 'Mãe Fictícia', parentesco: 'Mãe', telefone: '5549998765432', mensagem: 'Olá, Mãe Fictícia!' },
          ],
          ultima_cobranca: null,
        }),
      ),
    )
    renderizar(lancamento(), [...QUEM_EDITA, 'pacientes.ver'])

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Cobrar pelo WhatsApp' }))
    const cobranca = await screen.findByRole('dialog', { name: 'Cobrar pelo WhatsApp' })
    await within(cobranca).findByRole('link', { name: /Abrir conversa com Mãe Fictícia/ })
    await usuario.keyboard('{Escape}')

    // ASSERT — o Esc fecha só o de cima; a edição continua aberta
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Cobrar pelo WhatsApp' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('alertdialog', { name: 'Editar lançamento' })).toBeInTheDocument()
  })

  it('deve passar no axe com a cobrança e os anexos', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/lancamentos/1/anexos', () =>
        HttpResponse.json([
          {
            id: 9,
            nome: 'comprovante-ficticio.pdf',
            mime: 'application/pdf',
            tamanho: 2048,
            criado_em: '2026-09-24 10:00',
            criado_por: { id: 1, nome: 'Operadora Fictícia' },
          },
        ]),
      ),
    )
    renderizar(lancamento({ ultima_cobranca: { em: '2026-09-24 09:30', por: 'Operadora Fictícia' } }), [
      ...QUEM_EDITA,
      'pacientes.ver',
    ])
    await screen.findByText('comprovante-ficticio.pdf')

    // ACT
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
