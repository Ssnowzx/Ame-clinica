import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  EXPLICACAO_DO_JA_PAGO,
  FormularioLancamento,
  RAZAO_DO_PARCELADO_SEM_PAGAR,
} from '@/componentes/financeiro/formulario-lancamento'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { LancamentoCaixaDetalhe } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * "Já foi pago" no Novo lançamento (change `caixa-do-dia-a-dia`, D1): a receita que a família paga
 * na hora nasce paga num POST só. Dados FICTÍCIOS (LGPD).
 */

const QUEM_LANCA = ['lancamentos.ver', 'lancamentos.criar']
const QUEM_LANCA_E_DA_BAIXA = [...QUEM_LANCA, 'lancamentos.pagar']

function lancamentoEmAberto(): LancamentoCaixaDetalhe {
  return {
    id: 1,
    updated_at: '2026-09-25T10:00:00.000000Z',
    tipo: 'receita',
    competencia: '2026-09-01',
    vencimento: '2026-09-10',
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
    obs: null,
    em_ciclo_fechado: false,
    tratamento_id: null,
    ultima_cobranca: null,
  }
}

/** Catálogos do caixa + a captura do que chega ao servidor. */
function comServidor(): Array<Record<string, unknown>> {
  const corpos: Array<Record<string, unknown>> = []
  servidor.use(
    msw.get('/api/contas', () => HttpResponse.json([{ id: 1, nome: 'Caixa', ativo: true }])),
    msw.get('/api/categorias', () =>
      HttpResponse.json([{ id: 1, nome: 'Atendimentos', tipo: 'receita', subcategorias: [] }]),
    ),
    msw.get('/api/tipos-pagamento', () => HttpResponse.json([{ id: 1, nome: 'PIX' }])),
    msw.post('/api/lancamentos', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      corpos.push(corpo)
      return HttpResponse.json(
        { ...lancamentoEmAberto(), id: 9, pago_em: corpo.pagar_agora === true ? '2026-09-25 10:30' : null },
        { status: 201 },
      )
    }),
  )
  return corpos
}

function renderizar(
  permissoes: string[],
  lancamento: LancamentoCaixaDetalhe | null = null,
  aoFechar: () => void = () => undefined,
) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <FormularioLancamento lancamento={lancamento} aoFechar={aoFechar} />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** O mínimo que o servidor exige num lançamento novo. */
async function preencher(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('option', { name: 'PIX' })
  await screen.findByRole('option', { name: 'Caixa' })
  await screen.findByRole('option', { name: 'Atendimentos' })
  fireEvent.change(screen.getByLabelText('Competência (obrigatório)'), { target: { value: '2026-09-25' } })
  fireEvent.change(screen.getByLabelText('Vencimento (obrigatório)'), { target: { value: '2026-09-25' } })
  await usuario.selectOptions(screen.getByLabelText('Conta (obrigatório)'), '1')
  await usuario.selectOptions(screen.getByLabelText('Categoria (obrigatório)'), '1')
  await usuario.selectOptions(screen.getByLabelText('Forma de pagamento (obrigatório)'), '1')
  fireEvent.change(screen.getByLabelText('Valor (R$) (obrigatório)'), { target: { value: '180,00' } })
}

function opcaoJaPago(): HTMLElement {
  return screen.getByRole('checkbox', { name: 'Já foi pago' })
}

beforeEach(() => {
  queryClient.clear()
})

describe('Novo lançamento — "Já foi pago" aparece só para quem dá baixa, e só ao criar', () => {
  it('deve oferecer "Já foi pago", desmarcado e explicado, a quem pode dar baixa', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(QUEM_LANCA_E_DA_BAIXA)

    // ASSERT — desmarcado por padrão (design, Riscos): a baixa nunca vai sem alguém pedir
    expect(opcaoJaPago()).not.toBeChecked()
    expect(opcaoJaPago()).toHaveAccessibleDescription(EXPLICACAO_DO_JA_PAGO)
  })

  it('deve não oferecer "Já foi pago" a quem só pode lançar', () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(QUEM_LANCA)

    // ASSERT — o servidor responderia 403: a tela não promete o que ele recusa
    expect(screen.queryByRole('checkbox', { name: 'Já foi pago' })).not.toBeInTheDocument()
  })

  it('deve não oferecer "Já foi pago" na edição', () => {
    // ARRANGE — na edição a baixa é a transição própria (botão Pagar)
    comServidor()

    // ACT
    renderizar([...QUEM_LANCA_E_DA_BAIXA, 'lancamentos.editar'], lancamentoEmAberto())

    // ASSERT
    expect(screen.queryByRole('checkbox', { name: 'Já foi pago' })).not.toBeInTheDocument()
  })
})

describe('Novo lançamento — "Já foi pago" no parcelado', () => {
  it('deve deixar a opção indisponível com 3 parcelas, com a razão ao lado', () => {
    // ARRANGE
    comServidor()
    renderizar(QUEM_LANCA_E_DA_BAIXA)

    // ACT
    fireEvent.change(screen.getByLabelText('Parcelas'), { target: { value: '3' } })

    // ASSERT — a razão é a DESCRIÇÃO do controle: quem usa leitor de tela a ouve junto da opção
    expect(opcaoJaPago()).toBeDisabled()
    expect(opcaoJaPago()).toHaveAccessibleDescription(RAZAO_DO_PARCELADO_SEM_PAGAR)
  })

  it('deve não mandar pagar_agora no parcelado, mesmo que a opção tenha sido marcada antes', async () => {
    // ARRANGE
    const corpos = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_E_DA_BAIXA)
    await preencher(usuario)
    await usuario.click(opcaoJaPago())

    // ACT — virou parcelado depois de marcar
    fireEvent.change(screen.getByLabelText('Parcelas'), { target: { value: '3' } })
    await usuario.click(screen.getByRole('button', { name: 'Registrar' }))

    // ASSERT
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).toMatchObject({ parcelas: 3 })
    expect(corpos[0]).not.toHaveProperty('pagar_agora')
  })

  it('deve continuar desmarcada ao voltar para lançamento único', async () => {
    // ARRANGE — a baixa não pode voltar sozinha, sem ninguém a ver sendo marcada
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_E_DA_BAIXA)
    await usuario.click(opcaoJaPago())
    fireEvent.change(screen.getByLabelText('Parcelas'), { target: { value: '3' } })

    // ACT
    fireEvent.change(screen.getByLabelText('Parcelas'), { target: { value: '' } })

    // ASSERT
    expect(opcaoJaPago()).toBeEnabled()
    expect(opcaoJaPago()).not.toBeChecked()
  })
})

describe('Novo lançamento — registrar já pago', () => {
  it('deve dizer no botão que o lançamento vai como pago', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_E_DA_BAIXA)

    // ACT
    await usuario.click(opcaoJaPago())

    // ASSERT — a consequência à vista antes do clique (design, Riscos: clique errado)
    expect(screen.getByRole('button', { name: 'Registrar como pago' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar' })).not.toBeInTheDocument()
  })

  it('deve mandar um só POST com pagar_agora: true', async () => {
    // ARRANGE
    const corpos = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_E_DA_BAIXA)
    await preencher(usuario)

    // ACT
    await usuario.click(opcaoJaPago())
    await usuario.click(screen.getByRole('button', { name: 'Registrar como pago' }))

    // ASSERT — criar e dar baixa na MESMA requisição (D1): nunca um segundo pedido de baixa
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).toMatchObject({ pagar_agora: true, valor: '180.00' })
    expect(corpos[0]).not.toHaveProperty('pago_em')
  })

  it('deve não levar pagar_agora quando a opção fica desmarcada', async () => {
    // ARRANGE
    const corpos = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_E_DA_BAIXA)
    await preencher(usuario)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Registrar' }))

    // ASSERT — desmarcada, o POST é exatamente o de antes da opção existir
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).not.toHaveProperty('pagar_agora')
  })

  it('deve anunciar que o lançamento foi registrado e pago', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    let fechou = false
    renderizar(QUEM_LANCA_E_DA_BAIXA, null, () => {
      fechou = true
    })
    await preencher(usuario)

    // ACT
    await usuario.click(opcaoJaPago())
    await usuario.click(screen.getByRole('button', { name: 'Registrar como pago' }))

    // ASSERT
    expect(await screen.findByText('Lançamento registrado e pago.')).toBeInTheDocument()
    expect(fechou).toBe(true)
  })

  it('deve não anunciar "pago" quando o servidor registra sem dar baixa', async () => {
    // ARRANGE — CR-CDD-06: o anúncio segue o `pago_em` da RESPOSTA, como no faturamento; o
    // `pagar_agora` que a tela pediu não prova que a baixa aconteceu
    comServidor()
    servidor.use(
      msw.post('/api/lancamentos', () =>
        HttpResponse.json({ ...lancamentoEmAberto(), id: 9, pago_em: null }, { status: 201 }),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_E_DA_BAIXA)
    await preencher(usuario)

    // ACT
    await usuario.click(opcaoJaPago())
    await usuario.click(screen.getByRole('button', { name: 'Registrar como pago' }))

    // ASSERT
    expect(await screen.findByText('Lançamento registrado.')).toBeInTheDocument()
    expect(screen.queryByText('Lançamento registrado e pago.')).not.toBeInTheDocument()
  })

  it('deve pousar a recusa do servidor em pagar_agora na própria opção', async () => {
    // ARRANGE — o 422 do parcelado, se ele chegar por outro caminho (a tela já impede antes)
    comServidor()
    servidor.use(
      msw.post('/api/lancamentos', () =>
        HttpResponse.json(
          { message: 'Inválido.', errors: { pagar_agora: ['Parcelamento é pago parcela a parcela.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_E_DA_BAIXA)
    await preencher(usuario)

    // ACT
    await usuario.click(opcaoJaPago())
    await usuario.click(screen.getByRole('button', { name: 'Registrar como pago' }))

    // ASSERT
    await waitFor(() => {
      expect(opcaoJaPago()).toHaveAttribute('aria-invalid', 'true')
    })
  })
})

describe('Novo lançamento — axe nos estados novos do "Já foi pago"', () => {
  it('deve passar no axe com a opção marcada', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_E_DA_BAIXA)
    await screen.findByRole('option', { name: 'PIX' })

    // ACT
    await usuario.click(opcaoJaPago())

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve passar no axe com a opção indisponível pelo parcelado', async () => {
    // ARRANGE
    comServidor()
    renderizar(QUEM_LANCA_E_DA_BAIXA)
    await screen.findByRole('option', { name: 'PIX' })

    // ACT
    fireEvent.change(screen.getByLabelText('Parcelas'), { target: { value: '4' } })

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
