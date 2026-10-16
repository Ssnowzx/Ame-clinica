import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CobrancaNoDetalhe, DialogoDeCobranca } from '@/componentes/financeiro/cobranca-pelo-whatsapp'
import { chaves } from '@/lib/chaves-query'
import type { LancamentoCobravel } from '@/lib/cobranca-pelo-whatsapp'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CobrancaDoLancamento, LancamentoCaixaDetalhe, ResponsavelCobravel, UltimaCobranca } from '@/tipos'

expect.extend(toHaveNoViolations)

const QUEM_COBRA = ['lancamentos.ver', 'pacientes.ver']

/** Nomes, telefones e valores 100% fictícios. */
const MAE: ResponsavelCobravel = {
  nome: 'Mãe Fictícia',
  parentesco: 'Mãe',
  telefone: '5549998765432',
  mensagem: 'Olá, Mãe Fictícia! Passando para lembrar do pagamento de R$ 450,00 referente a Criança Fictícia.',
}

const PAI: ResponsavelCobravel = {
  nome: 'Pai Fictício',
  parentesco: 'Pai',
  telefone: '5549988887777',
  mensagem: 'Olá, Pai Fictício! Passando para lembrar do pagamento de R$ 450,00 referente a Criança Fictícia.',
}

const RECEITA: LancamentoCobravel = {
  id: 7,
  liquido: '450.00',
  vencimento: '2026-10-10',
  interessado: { tipo: 'paciente', id: 10, nome: 'Criança Fictícia' },
}

function cobranca(
  responsaveis: ResponsavelCobravel[],
  ultima: UltimaCobranca | null = null,
): CobrancaDoLancamento {
  return { lancamento_id: 7, responsaveis, ultima_cobranca: ultima }
}

function detalhe(sobrescritas: Partial<LancamentoCaixaDetalhe> = {}): LancamentoCaixaDetalhe {
  return {
    id: 7,
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

function comoUsuario(permissoes: string[]): void {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
}

function renderizarDialogo(aoRegistrar: (ultima: UltimaCobranca) => void = () => undefined) {
  comoUsuario(QUEM_COBRA)
  const aoFechar = vi.fn()

  const resultado = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DialogoDeCobranca lancamento={RECEITA} aoFechar={aoFechar} aoRegistrar={aoRegistrar} />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { ...resultado, aoFechar }
}

function renderizarDetalhe(lancamento: LancamentoCaixaDetalhe, permissoes: string[] = QUEM_COBRA) {
  comoUsuario(permissoes)

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CobrancaNoDetalhe lancamento={lancamento} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Cobrar pelo WhatsApp — um responsável', () => {
  it('deve abrir o wa.me numa nova aba, sem opener nem referrer, com a mensagem do servidor', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/lancamentos/7/cobranca', () => HttpResponse.json(cobranca([MAE]))))

    // ACT
    renderizarDialogo()

    // ASSERT
    const link = await screen.findByRole('link', { name: /Abrir conversa com Mãe Fictícia no WhatsApp/ })
    expect(link).toHaveAttribute('href', `https://wa.me/5549998765432?text=${encodeURIComponent(MAE.mensagem)}`)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('+55 (49) 99876-5432')).toBeInTheDocument()
    expect(screen.queryByText('A quem enviar?')).not.toBeInTheDocument()
  })

  it('deve registrar a cobrança ao abrir a conversa e avisar com o que o SERVIDOR gravou', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoRegistrar = vi.fn()
    let registros = 0
    servidor.use(
      msw.get('/api/lancamentos/7/cobranca', () =>
        HttpResponse.json(
          cobranca([MAE], registros === 0 ? null : { em: '2026-09-25 14:10', por: 'Operadora Fictícia' }),
        ),
      ),
      msw.post('/api/lancamentos/7/cobranca', () => {
        registros += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderizarDialogo(aoRegistrar)

    // ACT
    await usuario.click(await screen.findByRole('link', { name: /Abrir conversa com Mãe Fictícia/ }))

    // ASSERT — "aberta", nunca "enviada": o sistema sabe que a conversa abriu
    await waitFor(() => {
      expect(aoRegistrar).toHaveBeenCalledWith({ em: '2026-09-25 14:10', por: 'Operadora Fictícia' })
    })
    expect(registros).toBe(1)
    expect(screen.getByRole('status')).toHaveTextContent('Conversa com Mãe Fictícia aberta numa nova aba')
    expect(document.body.textContent).not.toMatch(/enviada/i)
  })

  it('deve registrar a cobrança também quando a conversa abre pelo clique do meio', async () => {
    // ARRANGE — o botão do meio abre a nova aba sem disparar `click`
    const usuario = userEvent.setup()
    let registros = 0
    servidor.use(
      msw.get('/api/lancamentos/7/cobranca', () => HttpResponse.json(cobranca([MAE]))),
      msw.post('/api/lancamentos/7/cobranca', () => {
        registros += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderizarDialogo()
    const link = await screen.findByRole('link', { name: /Abrir conversa com Mãe Fictícia/ })

    // ACT
    await usuario.pointer({ keys: '[MouseMiddle]', target: link })

    // ASSERT
    await waitFor(() => {
      expect(registros).toBe(1)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Conversa com Mãe Fictícia aberta numa nova aba')
  })

  it('deve não registrar nada no clique direito, que só abre o menu', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let registros = 0
    servidor.use(
      msw.get('/api/lancamentos/7/cobranca', () => HttpResponse.json(cobranca([MAE]))),
      msw.post('/api/lancamentos/7/cobranca', () => {
        registros += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderizarDialogo()
    const link = await screen.findByRole('link', { name: /Abrir conversa com Mãe Fictícia/ })

    // ACT
    await usuario.pointer({ keys: '[MouseRight]', target: link })

    // ASSERT — nenhuma conversa foi aberta: nada a registrar nem a anunciar
    expect(screen.getByRole('status').textContent).toBe('')
    expect(registros).toBe(0)
  })

  it('deve avisar que a família já foi lembrada, e por quem', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/lancamentos/7/cobranca', () =>
        HttpResponse.json(cobranca([MAE], { em: '2026-09-24 09:30', por: 'Operadora Fictícia' })),
      ),
    )

    // ACT
    renderizarDialogo()

    // ASSERT
    expect(await screen.findByText('Família já lembrada:')).toBeInTheDocument()
    expect(screen.getByText('Cobrança aberta em 24/09 por Operadora Fictícia.')).toBeInTheDocument()
  })
})

describe('Cobrar pelo WhatsApp — vários responsáveis', () => {
  it('deve perguntar a quem enviar e abrir a conversa com o escolhido', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/lancamentos/7/cobranca', () => HttpResponse.json(cobranca([MAE, PAI]))))

    // ACT
    renderizarDialogo()

    // ASSERT
    const lista = await screen.findByRole('list', { name: 'A quem enviar?' })
    const doPai = within(lista).getByRole('link', { name: /Abrir conversa com Pai Fictício/ })
    expect(doPai).toHaveAttribute('href', `https://wa.me/5549988887777?text=${encodeURIComponent(PAI.mensagem)}`)
    expect(within(lista).getAllByRole('link')).toHaveLength(2)
  })
})

describe('Cobrar pelo WhatsApp — sem telefone, recusa e falha', () => {
  it('deve explicar que a ficha não tem telefone e oferecer abrir a ficha da criança', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/lancamentos/7/cobranca', () => HttpResponse.json(cobranca([]))))

    // ACT
    renderizarDialogo()

    // ASSERT
    expect(
      await screen.findByText(/A ficha de Criança Fictícia não tem telefone de responsável/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir a ficha da criança' })).toHaveAttribute('href', '/pacientes/10')
    expect(screen.queryByRole('link', { name: /Abrir conversa/ })).not.toBeInTheDocument()
  })

  it('deve dizer a razão da recusa do servidor, sem oferecer tentar de novo', async () => {
    // ARRANGE — pago entre a lista e o clique
    servidor.use(
      msw.get('/api/lancamentos/7/cobranca', () =>
        HttpResponse.json(
          { message: 'inválido', errors: { lancamento: ['Este lançamento já foi pago.'] } },
          { status: 422 },
        ),
      ),
    )

    // ACT
    renderizarDialogo()

    // ASSERT
    expect(await screen.findByText('Este lançamento já foi pago.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
  })

  it('deve oferecer tentar de novo quando a falha é do servidor', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/lancamentos/7/cobranca', () => new HttpResponse(null, { status: 500 })))

    // ACT
    renderizarDialogo()

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })

  it('deve não guardar o telefone no cache depois que o diálogo fecha', async () => {
    // ARRANGE — dado de menor numa máquina compartilhada
    servidor.use(msw.get('/api/lancamentos/7/cobranca', () => HttpResponse.json(cobranca([MAE]))))
    const { unmount } = renderizarDialogo()
    await screen.findByRole('link', { name: /Abrir conversa/ })

    // ACT
    unmount()

    // ASSERT
    await waitFor(() => {
      expect(queryClient.getQueryData(chaves.cobrancaDoLancamento(7))).toBeUndefined()
    })
    expect(window.sessionStorage.length).toBe(0)
  })
})

describe('Cobrar pelo WhatsApp — no detalhe do lançamento', () => {
  it('deve mostrar "Cobrança aberta em" com o que veio do lançamento', () => {
    // ARRANGE + ACT
    renderizarDetalhe(detalhe({ ultima_cobranca: { em: '2026-09-24 09:30', por: 'Operadora Fictícia' } }))

    // ASSERT
    expect(screen.getByText('Cobrança aberta em 24/09 por Operadora Fictícia.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cobrar pelo WhatsApp' })).toBeInTheDocument()
  })

  it('deve atualizar a linha depois de abrir a conversa', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let registros = 0
    servidor.use(
      msw.get('/api/lancamentos/7/cobranca', () =>
        HttpResponse.json(cobranca([MAE], registros === 0 ? null : { em: '2026-09-25 14:10', por: 'Operadora Fictícia' })),
      ),
      msw.post('/api/lancamentos/7/cobranca', () => {
        registros += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderizarDetalhe(detalhe())
    expect(screen.getByText('Nenhuma cobrança pelo WhatsApp aberta ainda.')).toBeInTheDocument()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Cobrar pelo WhatsApp' }))
    await usuario.click(await screen.findByRole('link', { name: /Abrir conversa com Mãe Fictícia/ }))
    await usuario.click(screen.getByRole('button', { name: 'Fechar' }))

    // ASSERT
    expect(await screen.findByText('Cobrança aberta em 25/09 por Operadora Fictícia.')).toBeInTheDocument()
  })

  it.each([
    ['sem pacientes.ver', detalhe(), ['lancamentos.ver']],
    ['receita já paga', detalhe({ pago_em: '2026-10-05 10:00' }), QUEM_COBRA],
    ['despesa', detalhe({ tipo: 'despesa' }), QUEM_COBRA],
  ])('deve não oferecer a cobrança — %s', (_caso, lancamento, permissoes) => {
    // ARRANGE + ACT
    renderizarDetalhe(lancamento, permissoes)

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Cobrar pelo WhatsApp' })).not.toBeInTheDocument()
  })

  it('deve manter a última cobrança à vista mesmo quando não há mais o que cobrar', () => {
    // ARRANGE + ACT — pago depois de lembrado: o histórico continua valendo
    renderizarDetalhe(
      detalhe({ pago_em: '2026-10-05 10:00', ultima_cobranca: { em: '2026-10-01 08:00', por: 'Operadora Fictícia' } }),
    )

    // ASSERT
    expect(screen.getByText('Cobrança aberta em 01/10 por Operadora Fictícia.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cobrar pelo WhatsApp' })).not.toBeInTheDocument()
  })
})

describe('Cobrar pelo WhatsApp — acessibilidade', () => {
  it('deve passar no axe com a escolha entre responsáveis', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/lancamentos/7/cobranca', () =>
        HttpResponse.json(cobranca([MAE, PAI], { em: '2026-09-24 09:30', por: 'Operadora Fictícia' })),
      ),
    )
    renderizarDialogo()
    await screen.findByRole('list', { name: 'A quem enviar?' })

    // ACT
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })

  it('deve passar no axe sem telefone de responsável', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/lancamentos/7/cobranca', () => HttpResponse.json(cobranca([]))))
    renderizarDialogo()
    await screen.findByRole('link', { name: 'Abrir a ficha da criança' })

    // ACT
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
