import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DialogoFaturarSessao,
  EXPLICACAO_DO_JA_PAGO_NA_SESSAO,
} from '@/componentes/agenda/dialogo-faturar-sessao'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CardAgendamento } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * "Já foi pago" no Faturar sessão (change `caixa-do-dia-a-dia`): a família paga na recepção e a
 * sessão sai faturada E paga num gesto só. Dados FICTÍCIOS (LGPD — nunca paciente real).
 */

const CARD: CardAgendamento = {
  id: 42,
  updated_at: '2026-09-25T10:00:00.000000Z',
  tipo: 'atendimento',
  profissional_id: 7,
  paciente_id: 3,
  tratamento_id: 9,
  status_id: 1,
  inicio: '2026-09-25 14:00',
  fim: '2026-09-25 14:40',
  duracao_minutos: 40,
  is_reposicao: false,
  paciente: { id: 3, nome: 'Paciente Fictício', nome_social: null },
  especialidade: { id: 2, nome: 'Fonoaudiologia', cor: '#448247' },
  status: { id: 1, nome: 'Atendido', cor: '#64748B', cor_borda: null, tipo: 'circle-check' },
  profissional: { id: 7, nome: 'Profissional Fictício' },
  sala: { id: 5, nome: 'Sala 3' },
  tratamento_saldo: 8,
  tratamento_total: 30,
  tratamento_realce: 'nenhum',
  convenio: { id: 1, nome: 'Particular Fictício', particular: true },
}

const QUEM_FATURA = ['agenda.ver', 'lancamentos.criar']
const QUEM_FATURA_E_DA_BAIXA = [...QUEM_FATURA, 'lancamentos.pagar']

/** Catálogos + o faturamento, que devolve o lançamento pago quando o pedido é `pagar_agora`. */
function comServidor(): Array<Record<string, unknown>> {
  const corpos: Array<Record<string, unknown>> = []
  servidor.use(
    msw.get('/api/contas', () => HttpResponse.json([{ id: 3, nome: 'Caixa da recepção' }])),
    msw.get('/api/categorias', () =>
      HttpResponse.json([{ id: 1, nome: 'Atendimentos', tipo: 'receita', subcategorias: [] }]),
    ),
    msw.get('/api/tipos-pagamento', () => HttpResponse.json([{ id: 2, nome: 'Pix' }])),
    msw.post('/api/agendamentos/42/faturamento', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      corpos.push(corpo)
      return HttpResponse.json(
        {
          id: 900,
          tipo: 'receita',
          valor: '150.00',
          desconto: '0.00',
          liquido: '150.00',
          agendamento_id: 42,
          pago_em: corpo.pagar_agora === true ? '2026-09-25 14:45' : null,
        },
        { status: 201 },
      )
    }),
  )
  return corpos
}

function renderizar(permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProvedorToast>
          <DialogoFaturarSessao aberto card={CARD} aoFechar={() => undefined} />
        </ProvedorToast>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function preencherObrigatorios(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('option', { name: 'Atendimentos' })
  await screen.findByRole('option', { name: 'Pix' })
  await screen.findByRole('option', { name: 'Caixa da recepção' })
  await usuario.selectOptions(screen.getByLabelText(/^Categoria/), '1')
  await usuario.selectOptions(screen.getByLabelText(/^Forma de pagamento/), '2')
  await usuario.selectOptions(screen.getByLabelText(/^Conta/), '3')
}

beforeEach(() => {
  queryClient.clear()
})

describe('Faturar sessão — "Já foi pago" só para quem dá baixa', () => {
  it('deve oferecer "Já foi pago", desmarcado e explicado, a quem pode dar baixa', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(QUEM_FATURA_E_DA_BAIXA)

    // ASSERT
    const opcao = await screen.findByRole('checkbox', { name: 'Já foi pago' })
    expect(opcao).not.toBeChecked()
    expect(opcao).toHaveAccessibleDescription(EXPLICACAO_DO_JA_PAGO_NA_SESSAO)
  })

  it('deve não oferecer "Já foi pago" a quem só pode faturar', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(QUEM_FATURA)

    // ASSERT
    await screen.findByRole('dialog', { name: 'Faturar sessão' })
    expect(screen.queryByRole('checkbox', { name: 'Já foi pago' })).not.toBeInTheDocument()
  })
})

describe('Faturar sessão — faturar já pago', () => {
  it('deve dizer no botão que a sessão vai faturada como paga', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_FATURA_E_DA_BAIXA)

    // ACT
    await usuario.click(await screen.findByRole('checkbox', { name: 'Já foi pago' }))

    // ASSERT
    expect(screen.getByRole('button', { name: 'Faturar como pago' })).toBeInTheDocument()
  })

  it('deve mandar pagar_agora: true e anunciar "Sessão faturada e paga"', async () => {
    // ARRANGE
    const corpos = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_FATURA_E_DA_BAIXA)
    await preencherObrigatorios(usuario)

    // ACT
    await usuario.click(screen.getByRole('checkbox', { name: 'Já foi pago' }))
    await usuario.click(screen.getByRole('button', { name: 'Faturar como pago' }))

    // ASSERT — um só pedido, e o anúncio DENTRO do diálogo (o toast repete)
    const dialogo = await screen.findByRole('dialog', { name: 'Sessão faturada e paga' })
    expect(within(dialogo).getByText(/o pagamento já está registrado/)).toBeInTheDocument()
    expect(corpos).toEqual([{ categoria_id: 1, tipo_pagamento_id: 2, conta_id: 3, pagar_agora: true }])
  })

  it('deve não mandar pagar_agora e manter "Sessão faturada" com a opção desmarcada', async () => {
    // ARRANGE
    const corpos = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_FATURA_E_DA_BAIXA)
    await preencherObrigatorios(usuario)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Faturar' }))

    // ASSERT — desmarcada, nada muda em relação a antes da opção
    expect(await screen.findByRole('dialog', { name: 'Sessão faturada' })).toBeInTheDocument()
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).not.toHaveProperty('pagar_agora')
  })

  it('deve dizer só "Sessão faturada" quando o servidor devolve o lançamento em aberto', async () => {
    // ARRANGE — o anúncio segue o `pago_em` da RESPOSTA, não o que a tela pediu
    comServidor()
    servidor.use(
      msw.post('/api/agendamentos/42/faturamento', () =>
        HttpResponse.json(
          { id: 900, tipo: 'receita', valor: '150.00', desconto: '0.00', liquido: '150.00', agendamento_id: 42, pago_em: null },
          { status: 201 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_FATURA_E_DA_BAIXA)
    await preencherObrigatorios(usuario)

    // ACT
    await usuario.click(screen.getByRole('checkbox', { name: 'Já foi pago' }))
    await usuario.click(screen.getByRole('button', { name: 'Faturar como pago' }))

    // ASSERT
    expect(await screen.findByRole('dialog', { name: 'Sessão faturada' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Sessão faturada e paga' })).not.toBeInTheDocument()
  })
})

describe('Faturar sessão — axe nos estados novos do "Já foi pago"', () => {
  it('deve passar no axe com a opção marcada', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_FATURA_E_DA_BAIXA)

    // ACT
    await usuario.click(await screen.findByRole('checkbox', { name: 'Já foi pago' }))

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve passar no axe no anúncio de faturada e paga', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_FATURA_E_DA_BAIXA)
    await preencherObrigatorios(usuario)
    await usuario.click(screen.getByRole('checkbox', { name: 'Já foi pago' }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Faturar como pago' }))
    await screen.findByRole('dialog', { name: 'Sessão faturada e paga' })

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
