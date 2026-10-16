import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { PainelLancamentos } from '@/componentes/financeiro/painel-lancamentos'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { LancamentoDaLista } from '@/tipos'

expect.extend(toHaveNoViolations)

const QUEM_COBRA = ['lancamentos.ver', 'pacientes.ver']

/** Uma linha da listagem, com nomes 100% fictícios. */
function linha(sobrescritas: Partial<LancamentoDaLista> = {}): LancamentoDaLista {
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
    tem_anexo: false,
    ...sobrescritas,
  }
}

function comLista(linhas: LancamentoDaLista[]): void {
  servidor.use(
    msw.get('/api/contas', () => HttpResponse.json([])),
    msw.get('/api/lancamentos', () =>
      HttpResponse.json({ data: linhas, current_page: 1, last_page: 1, per_page: 50, total: linhas.length }),
    ),
  )
}

function renderizar(permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <PainelLancamentos />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Lista de lançamentos — o selo "Com anexo"', () => {
  it('deve marcar só a linha que tem anexo', async () => {
    // ARRANGE
    comLista([
      linha({ id: 1, tem_anexo: true, interessado: { tipo: 'paciente', id: 10, nome: 'Com Arquivo Fictícia' } }),
      linha({ id: 2, tem_anexo: false, interessado: { tipo: 'paciente', id: 11, nome: 'Sem Arquivo Fictícia' } }),
    ])

    // ACT
    renderizar(['lancamentos.ver'])

    // ASSERT
    const comArquivo = (await screen.findByText('Com Arquivo Fictícia')).closest('tr') as HTMLElement
    const semArquivo = screen.getByText('Sem Arquivo Fictícia').closest('tr') as HTMLElement
    expect(within(comArquivo).getByRole('button', { name: 'Com anexo: ver os arquivos' })).toBeInTheDocument()
    expect(within(semArquivo).queryByText('Com anexo')).not.toBeInTheDocument()
  })

  it('deve abrir os arquivos pelo selo, para quem só vê lançamentos', async () => {
    // ARRANGE — sem `lancamentos.editar` não há Editar: o selo é o caminho até o comprovante
    const usuario = userEvent.setup()
    comLista([linha({ tem_anexo: true })])
    servidor.use(
      msw.get('/api/lancamentos/1/anexos', () =>
        HttpResponse.json([
          {
            id: 9,
            nome: 'comprovante-ficticio.pdf',
            mime: 'application/pdf',
            tamanho: 2048,
            criado_em: '2026-09-24 10:00',
            criado_por: null,
          },
        ]),
      ),
    )
    renderizar(['lancamentos.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Com anexo: ver os arquivos' }))

    // ASSERT
    const dialogo = await screen.findByRole('dialog', { name: 'Anexos do lançamento' })
    expect(await within(dialogo).findByText('comprovante-ficticio.pdf')).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Baixar comprovante-ficticio.pdf' })).toBeInTheDocument()
    expect(within(dialogo).queryByRole('button', { name: 'Anexar arquivo' })).not.toBeInTheDocument()
  })
})

describe('Lista de lançamentos — "Cobrar pelo WhatsApp"', () => {
  it('deve oferecer a cobrança na receita em aberto de criança a quem tem as duas permissões', async () => {
    // ARRANGE — sem editar, pagar nem excluir, a coluna Ações existe só pela cobrança
    comLista([linha()])

    // ACT
    renderizar(QUEM_COBRA)

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Cobrar pelo WhatsApp' })).toHaveTextContent('Cobrar')
    expect(screen.getByRole('columnheader', { name: 'Ações' })).toBeInTheDocument()
  })

  it.each([
    ['sem pacientes.ver', linha(), ['lancamentos.ver']],
    ['receita já paga', linha({ pago_em: '2026-10-05 10:00' }), QUEM_COBRA],
    ['despesa', linha({ tipo: 'despesa' }), QUEM_COBRA],
    ['de fornecedor', linha({ interessado: { tipo: 'fornecedor', id: 3, nome: 'Fornecedor Fictício' } }), QUEM_COBRA],
  ])('deve não oferecer a cobrança — %s', async (_caso, umaLinha, permissoes) => {
    // ARRANGE
    comLista([umaLinha])

    // ACT
    renderizar(permissoes)

    // ASSERT
    await screen.findByText('R$ 450,00')
    expect(screen.queryByRole('button', { name: 'Cobrar pelo WhatsApp' })).not.toBeInTheDocument()
  })

  it('deve abrir a cobrança da linha, sem que a lista tenha carregado telefone', async () => {
    // ARRANGE — a lista nunca traz telefone (D1): ele só desce na rota da cobrança, sob demanda
    const usuario = userEvent.setup()
    const pedidos: string[] = []
    comLista([linha({ id: 7 })])
    servidor.use(
      msw.get('/api/lancamentos/7/cobranca', ({ request }) => {
        pedidos.push(new URL(request.url).pathname)
        return HttpResponse.json({
          lancamento_id: 7,
          responsaveis: [
            { nome: 'Mãe Fictícia', parentesco: 'Mãe', telefone: '5549998765432', mensagem: 'Olá, Mãe Fictícia!' },
          ],
          ultima_cobranca: null,
        })
      }),
    )
    renderizar(QUEM_COBRA)
    await screen.findByRole('button', { name: 'Cobrar pelo WhatsApp' })
    expect(pedidos).toEqual([])

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Cobrar pelo WhatsApp' }))

    // ASSERT
    const dialogo = await screen.findByRole('dialog', { name: 'Cobrar pelo WhatsApp' })
    expect(await within(dialogo).findByRole('link', { name: /Abrir conversa com Mãe Fictícia/ })).toBeInTheDocument()
    expect(pedidos).toEqual(['/api/lancamentos/7/cobranca'])
  })
})

describe('Lista de lançamentos — excluir o que tem anexo', () => {
  it('deve mostrar, dentro da confirmação, a recusa de excluir lançamento com anexo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    comLista([linha({ tem_anexo: true })])
    servidor.use(
      msw.delete('/api/lancamentos/1', () =>
        HttpResponse.json(
          {
            message: 'inválido',
            errors: { lancamento: ['Este lançamento tem anexos: exclua os anexos antes de excluir o lançamento.'] },
          },
          { status: 422 },
        ),
      ),
    )
    renderizar(['lancamentos.ver', 'lancamentos.excluir'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Excluir' }))
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Excluir' }))

    // ASSERT
    await waitFor(() => {
      expect(within(confirmacao).getByText(/exclua os anexos antes/)).toBeInTheDocument()
    })
  })
})

describe('Lista de lançamentos — acessibilidade do selo e da cobrança', () => {
  it('deve passar no axe com o selo e a ação de cobrar', async () => {
    // ARRANGE
    comLista([linha({ tem_anexo: true })])
    const { container } = renderizar(QUEM_COBRA)
    await screen.findByRole('button', { name: 'Cobrar pelo WhatsApp' })

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
