import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, CONFIGURACAO_FICTICIA, DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import { fingirTelaEstreita } from '@/test/setup'
import type { CardAgendamento, ConfirmacaoDoCard } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * A resposta da família ao lembrete na AGENDA (change lembrete-com-botoes-de-resposta): o ícone
 * do cartão (4.2), a faixa do topo com o destaque (4.4) e a grade que se atualiza sozinha (4.5).
 * Dados 100% fictícios (LGPD — menores).
 */

/** Um instante às 08:12 no relógio de quem roda o teste — o relógio que a tela usa para a hora. */
const OITO_E_DOZE = new Date(2026, 6, 12, 8, 12).toISOString()

/** Um cartão do profissional 1 às `hora`, com a resposta ao lembrete dada. */
function cartao(id: number, hora: string, confirmacao: ConfirmacaoDoCard | null): CardAgendamento {
  const fim = `${String(Number(hora.slice(0, 2))).padStart(2, '0')}:40`

  return cardFicticio({
    id,
    inicio: `${DIA_FICTICIO} ${hora}`,
    fim: `${DIA_FICTICIO} ${fim}`,
    paciente: { id: 10 + id, nome: `Paciente Fictício ${id}`, nome_social: null },
    confirmacao,
  })
}

const QUATRO_ESTADOS: CardAgendamento[] = [
  cartao(1, '08:00', { estado: 'aguardando', em: null }),
  cartao(2, '09:00', { estado: 'confirmado', em: OITO_E_DOZE }),
  cartao(3, '10:00', { estado: 'pediu_desmarque', em: OITO_E_DOZE }),
  cartao(4, '11:00', { estado: 'nao_entregue', em: null }),
]

interface OpcoesDeRender {
  cards?: CardAgendamento[]
  permissoes?: string[]
  arrastoLigado?: boolean
  /** `?visao=` da URL — a Visão geral em tela estreita vira a LISTA do celular */
  visao?: 'dia' | 'geral'
  /** O resto da URL (ex.: `&paciente=10`, o modo retorno) */
  extraNaUrl?: string
}

/**
 * A agenda do profissional 1 no dia fictício, CONTANDO as leituras do período — é a contagem que
 * diz se a grade buscou de novo. `proximas` troca o que o servidor responde a partir da 2ª leitura;
 * `falhar` faz o servidor responder 503 (o redeploy, o 502 do proxy) enquanto estiver ligado.
 */
function renderizarAgenda({
  cards = QUATRO_ESTADOS,
  permissoes = ['agenda.ver'],
  arrastoLigado = false,
  visao = 'dia',
  extraNaUrl = '',
}: OpcoesDeRender = {}) {
  const leituras = { total: 0, proximas: cards, falhar: false }
  servidor.use(...handlersDaAgenda(cards))
  servidor.use(
    msw.get('/api/agenda', () => {
      leituras.total += 1
      if (leituras.falhar) {
        return HttpResponse.json({ message: 'Serviço indisponível.' }, { status: 503 })
      }
      return HttpResponse.json(leituras.total === 1 ? cards : leituras.proximas)
    }),
    ...(arrastoLigado
      ? [
          msw.get('/api/agenda/configuracoes', () =>
            HttpResponse.json({
              configuracoes: [
                ...CONFIGURACAO_FICTICIA.configuracoes,
                { chave: 'agenda.arrastar_para_remarcar', tipo: 'bool', valor: true },
              ],
            }),
          ),
        ]
      : []),
  )
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  const tela = render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter
          initialEntries={[
            (visao === 'geral' ? `/agenda?data=${DIA_FICTICIO}&visao=geral` : `/agenda?data=${DIA_FICTICIO}&profissional=1`)
              + extraNaUrl,
          ]}
        >
          <PaginaAgenda />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )

  return { ...tela, leituras }
}

function cartaoNaTela(id: number): HTMLElement {
  const elemento = document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
  if (elemento === null) {
    throw new Error(`cartão ${id} não está na grade`)
  }
  return elemento
}

/** A região viva que diz uma frase — há mais de uma na página (a do período e a da faixa). */
function regiaoQueDiz(frase: RegExp): HTMLElement | undefined {
  return screen.getAllByRole('status', { hidden: true }).find((regiao) => frase.test(regiao.textContent ?? ''))
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Agenda — a resposta da família no cartão (4.2)', () => {
  it('deve dizer cada estado da confirmação em palavras, no nome acessível e ao passar o mouse', async () => {
    // ARRANGE + ACT
    const { container } = renderizarAgenda()
    await screen.findByText('Paciente Fictício 1')

    // ASSERT — um ícone por cartão, cada um com a frase do seu estado
    const esperado: Array<[number, string]> = [
      [1, 'Lembrete enviado, sem resposta da família'],
      [2, 'Confirmado pela família às 08:12'],
      [3, 'A família pediu para desmarcar'],
      [4, 'Lembrete não entregue — ligue para a família'],
    ]
    for (const [id, frase] of esperado) {
      const icone = within(cartaoNaTela(id)).getByRole('img', { name: frase })
      expect(icone).toHaveAttribute('title', frase)
    }
    // o axe vê a grade com os quatro ícones desenhados
    expect(await axe(container)).toHaveNoViolations()
  })

  it('não deve desenhar ícone na sessão sem lembrete daquela data', async () => {
    // ARRANGE — `null` é o que o servidor manda para a sessão sem lembrete ou que não está marcada
    renderizarAgenda({ cards: [cartao(1, '08:00', null)] })

    // ACT
    await screen.findByText('Paciente Fictício 1')

    // ASSERT
    expect(within(cartaoNaTela(1)).queryByRole('img')).not.toBeInTheDocument()
    expect(cartaoNaTela(1)).not.toHaveAttribute('data-confirmacao')
  })
})

describe('Agenda — a sessão que ficou sem lembrete (change telefone-que-chega-no-whatsapp)', () => {
  const SEM_LEMBRETE: CardAgendamento[] = [
    cartao(1, '08:00', { estado: 'confirmado', em: OITO_E_DOZE }),
    cartao(2, '09:00', { estado: 'nao_enviado', em: null, motivo: 'telefone inválido no cadastro' }),
    cartao(3, '10:00', { estado: 'nao_enviado', em: null, motivo: 'sem telefone no cadastro' }),
  ]

  it('deve dizer no cartão por que o lembrete não saiu', async () => {
    // ARRANGE + ACT
    const { container } = renderizarAgenda({ cards: SEM_LEMBRETE })
    await screen.findByText('Paciente Fictício 2')

    // ASSERT — o motivo em palavras, no nome acessível e ao passar o mouse
    const icone = within(cartaoNaTela(2)).getByRole('img', { name: 'Lembrete não enviado: telefone inválido no cadastro' })
    expect(icone).toHaveAttribute('title', 'Lembrete não enviado: telefone inválido no cadastro')
    // só o `title`: com um `aria-label` igual, o leitor lia a frase duas vezes (gate r2, A11Y-TEL-06)
    expect(icone).not.toHaveAttribute('aria-label')
    expect(within(cartaoNaTela(3)).getByRole('img', { name: 'Lembrete não enviado: sem telefone no cadastro' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve contar "sem lembrete" por último na faixa e destacar essas sessões', async () => {
    // ARRANGE
    renderizarAgenda({ cards: SEM_LEMBRETE })
    const faixa = await screen.findByRole('group', { name: 'Respostas ao lembrete' })
    const grade = document.querySelector<HTMLElement>('[data-grade-agenda]')

    // ACT
    fireEvent.click(within(faixa).getByRole('button', { name: '2 sem lembrete' }))

    // ASSERT
    expect(within(faixa).getAllByRole('button').map((botao) => botao.textContent)).toEqual([
      '1 confirmado',
      '2 sem lembrete',
    ])
    expect(grade).toHaveAttribute('data-destaque', 'nao_enviado')
    expect(within(faixa).getByRole('status')).toHaveTextContent('Destacando 2 sessões sem lembrete')
    expect(cartaoNaTela(2)).toHaveAttribute('data-confirmacao', 'nao_enviado')
    expect(cartaoNaTela(2).className).toContain(
      'group-data-[destaque=nao\\_enviado]/destaque:data-[confirmacao=nao\\_enviado]:ring-2',
    )
  })

  it('não deve mostrar "sem lembrete" na faixa quando nenhuma sessão ficou sem', async () => {
    // ARRANGE + ACT
    renderizarAgenda({ cards: [cartao(1, '08:00', { estado: 'confirmado', em: OITO_E_DOZE })] })
    const faixa = await screen.findByRole('group', { name: 'Respostas ao lembrete' })

    // ASSERT
    expect(within(faixa).queryByRole('button', { name: /sem lembrete/ })).not.toBeInTheDocument()
  })
})

describe('Agenda — a resposta da família na lista do celular', () => {
  it('deve mostrar o mesmo ícone e o mesmo destaque na lista da Visão geral estreita', async () => {
    // ARRANGE — no celular a Visão geral vira lista: o cartão curto não pode perder o sinal
    fingirTelaEstreita(true)
    renderizarAgenda({ visao: 'geral' })
    await screen.findByText('Paciente Fictício 3')

    // ACT
    fireEvent.click(screen.getByRole('button', { name: '1 pediu para desmarcar' }))

    // ASSERT — o ícone com a frase, e o destaque pelo mesmo contrato da grade
    expect(screen.getByRole('img', { name: 'A família pediu para desmarcar' })).toBeInTheDocument()
    const lista = document.querySelector<HTMLElement>('section[data-destaque]')
    if (lista === null) {
      throw new Error('a lista não recebeu o destaque')
    }
    expect(lista).toHaveAttribute('data-destaque', 'pediu_desmarque')
    // destacar não esconde: os quatro cartões seguem na lista
    expect(within(lista).getAllByRole('listitem')).toHaveLength(4)
  })
})

describe('Agenda — a faixa de respostas ao lembrete (4.4)', () => {
  it('deve contar os cartões por estado e omitir o que está em zero', async () => {
    // ARRANGE — dois confirmados, um sem resposta, um pedido de desmarque e um SEM lembrete
    renderizarAgenda({
      cards: [
        cartao(1, '08:00', { estado: 'confirmado', em: OITO_E_DOZE }),
        cartao(2, '09:00', { estado: 'confirmado', em: OITO_E_DOZE }),
        cartao(3, '10:00', { estado: 'aguardando', em: null }),
        cartao(4, '11:00', { estado: 'pediu_desmarque', em: OITO_E_DOZE }),
        cartao(5, '11:00', null),
      ],
    })

    // ACT
    const faixa = await screen.findByRole('group', { name: 'Respostas ao lembrete' })

    // ASSERT — na ordem da faixa, e sem "não entregues" (zero não é notícia)
    expect(within(faixa).getAllByRole('button').map((botao) => botao.textContent)).toEqual([
      '2 confirmados',
      '1 sem resposta',
      '1 pediu para desmarcar',
    ])
  })

  it('deve sumir quando nenhum cartão do período teve lembrete', async () => {
    // ARRANGE + ACT
    renderizarAgenda({ cards: [cartao(1, '08:00', null), cartao(2, '09:00', null)] })
    await screen.findByText('Paciente Fictício 1')

    // ASSERT
    expect(screen.queryByRole('group', { name: 'Respostas ao lembrete' })).not.toBeInTheDocument()
  })

  it('deve destacar os cartões do estado tocado, sem esconder os outros, e desfazer no segundo toque', async () => {
    // ARRANGE
    renderizarAgenda()
    const semResposta = await screen.findByRole('button', { name: '1 sem resposta' })
    const grade = document.querySelector<HTMLElement>('[data-grade-agenda]')

    // ACT
    fireEvent.click(semResposta)

    // ASSERT — o botão diz que está marcado, a grade diz o que destacar, e o cartão do estado tem a
    // pele do destaque; os outros três continuam na grade
    expect(semResposta).toHaveAttribute('aria-pressed', 'true')
    expect(grade).toHaveAttribute('data-destaque', 'aguardando')
    // e diz, com educação, o que passou a ser destacado (o botão só diz que ficou pressionado)
    expect(within(screen.getByRole('group', { name: 'Respostas ao lembrete' })).getByRole('status')).toHaveTextContent(
      'Destacando 1 sessão sem resposta',
    )
    expect(cartaoNaTela(1)).toHaveAttribute('data-confirmacao', 'aguardando')
    expect(cartaoNaTela(1).className).toContain(
      'group-data-[destaque=aguardando]/destaque:data-[confirmacao=aguardando]:ring-2',
    )
    for (const id of [2, 3, 4]) {
      expect(cartaoNaTela(id)).toBeVisible()
    }

    // ACT — o segundo toque desfaz
    fireEvent.click(semResposta)

    // ASSERT
    expect(semResposta).toHaveAttribute('aria-pressed', 'false')
    expect(grade).not.toHaveAttribute('data-destaque')
  })

  it('deve trocar o destaque ao tocar em outro estado', async () => {
    // ARRANGE
    renderizarAgenda()
    fireEvent.click(await screen.findByRole('button', { name: '1 sem resposta' }))

    // ACT
    fireEvent.click(screen.getByRole('button', { name: '1 pediu para desmarcar' }))

    // ASSERT — um destaque por vez
    expect(screen.getByRole('button', { name: '1 sem resposta' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '1 pediu para desmarcar' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('[data-grade-agenda]')).toHaveAttribute('data-destaque', 'pediu_desmarque')
  })
})

describe('Agenda — a grade se atualiza sozinha (4.5)', () => {
  it('deve manter o botão pressionado, com zero, quando a busca de fundo zera o estado dele', async () => {
    // ARRANGE — a recepção destacou o pedido de desmarque; outra pessoa o resolveu
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda()
    leituras.proximas = QUATRO_ESTADOS.map((card) => (card.id === 3 ? { ...card, confirmacao: null } : card))
    fireEvent.click(await screen.findByRole('button', { name: '1 pediu para desmarcar' }))

    // ACT
    await vi.advanceTimersByTimeAsync(61_000)

    // ASSERT — o botão continua lá, pressionado e com 0: é por ele que a grade volta a ter cor
    const pressionado = await screen.findByRole('button', { name: '0 pediram para desmarcar' })
    expect(pressionado).toHaveAttribute('aria-pressed', 'true')

    // ACT — a pessoa desfaz
    fireEvent.click(pressionado)

    // ASSERT — agora, sim, o zero sai da faixa
    expect(screen.queryByRole('button', { name: '0 pediram para desmarcar' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-grade-agenda]')).not.toHaveAttribute('data-destaque')
  })

  it('não deve tirar de debaixo do foco o botão cujo número zerou', async () => {
    // ARRANGE — o foco está em "1 não entregue" e a busca traz o lembrete entregue
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda()
    leituras.proximas = QUATRO_ESTADOS.map((card) => (card.id === 4 ? { ...card, confirmacao: null } : card))
    const naoEntregue = await screen.findByRole('button', { name: '1 não entregue' })
    act(() => {
      naoEntregue.focus()
    })

    // ACT
    await vi.advanceTimersByTimeAsync(61_000)

    // ASSERT — o botão fica (com 0) e o foco continua nele, em vez de cair no `body`
    const comFoco = await screen.findByRole('button', { name: '0 não entregues' })
    expect(comFoco).toHaveFocus()
  })

  it('deve manter a grade e avisar quando a busca de fundo falha, e tirar o aviso quando ela volta', async () => {
    // ARRANGE — 1ª leitura 200; depois o servidor cai (503) na busca de minuto em minuto
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda()
    await screen.findByText('Paciente Fictício 1')
    leituras.falhar = true

    // ACT — o minuto vence; a nova tentativa automática (1 s depois) também falha
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.advanceTimersByTimeAsync(3_000)

    // ASSERT — a grade FICA, com um aviso discreto de quando ela é, anunciado com educação
    const frase = /^Não foi possível atualizar agora — mostrando o que foi carregado às \d{2}:\d{2}\.$/
    // o que se VÊ (o botão é descrito pela frase) e o que se OUVE (a região viva da página)
    expect(await screen.findByRole('button', { name: 'Tentar de novo' })).toHaveAccessibleDescription(frase)
    expect(screen.getByText('Paciente Fictício 1')).toBeInTheDocument()
    expect(screen.queryByText('Não foi possível carregar a agenda.')).not.toBeInTheDocument()
    expect(regiaoQueDiz(frase)).toBeDefined()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // ACT — o servidor volta, e a próxima busca (a 3ª leitura em diante) dá 200
    leituras.falhar = false
    await vi.advanceTimersByTimeAsync(61_000)

    // ASSERT — o aviso some, e a região diz que voltou
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    })
    expect(regiaoQueDiz(/^A agenda voltou a se atualizar\.$/)).toBeDefined()
  })

  it('deve buscar na hora pelo "Tentar de novo" do aviso', async () => {
    // ARRANGE — a busca de fundo falhou
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda()
    await screen.findByText('Paciente Fictício 1')
    leituras.falhar = true
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.advanceTimersByTimeAsync(3_000)
    const tentar = await screen.findByRole('button', { name: 'Tentar de novo' })
    const leiturasAntes = leituras.total
    leituras.falhar = false

    // ACT
    fireEvent.click(tentar)

    // ASSERT — sem esperar o próximo minuto
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    })
    expect(leituras.total).toBe(leiturasAntes + 1)
  })

  it('deve levar o foco à grade quando o "Tentar de novo" dá certo e o aviso some', async () => {
    // ARRANGE — a busca de fundo falhou, e a pessoa está no botão do aviso
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda()
    await screen.findByText('Paciente Fictício 1')
    leituras.falhar = true
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.advanceTimersByTimeAsync(3_000)
    const tentar = await screen.findByRole('button', { name: 'Tentar de novo' })
    act(() => {
      tentar.focus()
    })
    leituras.falhar = false

    // ACT
    fireEvent.click(tentar)

    // ASSERT — o aviso saiu da tela com o foco dentro; o foco vai à grade (a região que acabou de
    // ser atualizada), nunca ao `body`
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.querySelector('[data-grade-agenda]')).toHaveFocus()
    })
  })

  it('deve dizer, com educação, que o "Tentar de novo" falhou outra vez, sem mudar a hora do que está na tela', async () => {
    // ARRANGE — a busca de fundo falhou e o servidor continua fora
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda()
    await screen.findByText('Paciente Fictício 1')
    leituras.falhar = true
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.advanceTimersByTimeAsync(3_000)
    const tentar = await screen.findByRole('button', { name: 'Tentar de novo' })
    const descricaoAntes = tentar.getAttribute('aria-describedby')
    const fraseAntes = document.getElementById(descricaoAntes ?? '')?.textContent

    // ACT — clica, e a nova tentativa (e a repetição automática dela) também falha
    fireEvent.click(tentar)
    await vi.advanceTimersByTimeAsync(3_000)

    // ASSERT — a resposta ao clique é anunciada; o aviso segue dizendo a hora do ÚLTIMO carregamento
    await waitFor(() => {
      expect(regiaoQueDiz(/^Ainda não foi possível atualizar\.$/)).toBeDefined()
    })
    expect(document.getElementById(descricaoAntes ?? '')?.textContent).toBe(fraseAntes)
  })

  it('deve voltar ao texto do período, e não à notícia da volta, depois de sair de "Remarcar para…"', async () => {
    // ARRANGE — um dia sem lembrete (só a região do período); a busca falha e depois volta
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda({
      cards: [cartao(1, '08:00', null)],
      permissoes: ['agenda.ver', 'agenda.editar'],
      arrastoLigado: true,
    })
    await screen.findByText('Paciente Fictício 1')
    leituras.falhar = true
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.advanceTimersByTimeAsync(3_000)
    leituras.falhar = false
    await vi.advanceTimersByTimeAsync(61_000)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^A agenda voltou a se atualizar\.$/)
    })

    // ACT — entra no modo de remarcar pelo teclado e sai com Esc
    fireEvent.click(screen.getByRole('button', { name: 'Remarcar Paciente Fictício 1 para outro horário' }))
    expect(screen.getByRole('status')).toHaveTextContent(/^Remarcando Paciente Fictício 1/)
    fireEvent.keyDown(window, { key: 'Escape' })

    // ASSERT — a região volta para o período; a notícia da volta já passou
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/^1 agendamento em segunda-feira, 13 de julho de 2026\.$/)
    })
  })

  it('deve anunciar a falha da busca de fundo também no modo retorno, que ocupa a região da página', async () => {
    // ARRANGE — "Marcando retorno de …" é o texto da região da página enquanto o modo durar
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda({ permissoes: ['agenda.ver', 'agenda.criar'], extraNaUrl: '&paciente=10' })
    await screen.findByText('Paciente Fictício 1')
    await screen.findByRole('button', { name: 'Cancelar retorno' })
    leituras.falhar = true

    // ACT — a busca de fundo falha (e a repetição automática também)
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.advanceTimersByTimeAsync(3_000)

    // ASSERT — o modo segue dito na página, e a falha é dita pela região do aviso
    const frase = /^Não foi possível atualizar agora — mostrando o que foi carregado às \d{2}:\d{2}\.$/
    await waitFor(() => {
      expect(regiaoQueDiz(frase)).toBeDefined()
    })
    expect(regiaoQueDiz(/^Marcando retorno de Paciente Fictício/)).toBeDefined()
  })

  it('deve anunciar, no modo retorno, quando a busca de fundo volta a funcionar', async () => {
    // ARRANGE — modo retorno, a busca falha (o aviso diz) e depois volta (o aviso sai da tela)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda({ permissoes: ['agenda.ver', 'agenda.criar'], extraNaUrl: '&paciente=10' })
    await screen.findByText('Paciente Fictício 1')
    await screen.findByRole('button', { name: 'Cancelar retorno' })
    leituras.falhar = true
    await vi.advanceTimersByTimeAsync(61_000)
    await vi.advanceTimersByTimeAsync(3_000)
    await screen.findByRole('button', { name: 'Tentar de novo' })
    leituras.falhar = false

    // ACT — a próxima busca dá certo
    await vi.advanceTimersByTimeAsync(61_000)

    // ASSERT — a volta é dita, e o modo continua dito na região da página
    await waitFor(() => {
      expect(regiaoQueDiz(/^A agenda voltou a se atualizar\.$/)).toBeDefined()
    })
    expect(regiaoQueDiz(/^Marcando retorno de Paciente Fictício/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument()
  })

  it('não deve derrubar a grade quando a rebusca dos catálogos falha com o dado já em mãos', async () => {
    // ARRANGE — a agenda carregou; depois a configuração e a seleção passam a responder 503
    renderizarAgenda()
    await screen.findByText('Paciente Fictício 1')
    servidor.use(
      msw.get('/api/agenda/selecao', () => HttpResponse.json({ message: 'Fora.' }, { status: 503 })),
      msw.get('/api/agenda/configuracoes', () => HttpResponse.json({ message: 'Fora.' }, { status: 503 })),
    )

    // ACT — as duas são buscadas de novo (é o que uma invalidação faz) e falham
    await act(async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chaves.selecaoDaAgenda() }),
        queryClient.invalidateQueries({ queryKey: chaves.configuracaoAgenda() }),
      ])
    })

    // ASSERT — as rebuscas falharam de verdade, e a grade ficou com o que tinha
    expect(queryClient.getQueryState(chaves.selecaoDaAgenda())?.status).toBe('error')
    expect(queryClient.getQueryState(chaves.configuracaoAgenda())?.status).toBe('error')
    expect(screen.getByText('Paciente Fictício 1')).toBeInTheDocument()
    expect(screen.queryByText('Não foi possível carregar a agenda.')).not.toBeInTheDocument()
  })

  it('não deve anunciar de novo a contagem quando a busca de fundo traz um agendamento novo', async () => {
    // ARRANGE — um dia sem lembrete (a única região viva é a do período); na 2ª leitura, outra
    // recepcionista marcou mais uma criança
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const um = [cartao(1, '08:00', null)]
    const { leituras } = renderizarAgenda({ cards: um })
    leituras.proximas = [...um, cartao(2, '09:00', null)]
    await screen.findByText('Paciente Fictício 1')
    const regiao = screen.getByRole('status')
    expect(regiao).toHaveTextContent(/^1 agendamento em segunda-feira, 13 de julho de 2026\.$/)

    // ACT — a busca de fundo
    await vi.advanceTimersByTimeAsync(61_000)

    // ASSERT — a grade mostra o novo, e a região NÃO fala por isso
    expect(await screen.findByText('Paciente Fictício 2')).toBeInTheDocument()
    expect(regiao).toHaveTextContent(/^1 agendamento em segunda-feira, 13 de julho de 2026\.$/)

    // ACT — a PESSOA muda de dia
    fireEvent.click(screen.getByRole('button', { name: 'Próximo período' }))

    // ASSERT — aí, sim, a região diz o resultado da troca
    await waitFor(() => {
      expect(regiao).toHaveTextContent(/terça-feira, 14 de julho de 2026\.$/)
    })
  })

  it('deve buscar o período de novo a cada minuto com a aba visível', async () => {
    // ARRANGE
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda()
    await screen.findByText('Paciente Fictício 1')
    expect(leituras.total).toBe(1)

    // ACT
    await vi.advanceTimersByTimeAsync(61_000)

    // ASSERT
    await waitFor(() => {
      expect(leituras.total).toBe(2)
    })
  })

  it('não deve buscar com a aba escondida, e deve buscar ao voltar para ela', async () => {
    // ARRANGE — a aba esquecida no balcão não bate no servidor
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda()
    await screen.findByText('Paciente Fictício 1')
    const visibilidade = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    // ACT — dois minutos com a aba escondida
    await vi.advanceTimersByTimeAsync(121_000)

    // ASSERT
    expect(leituras.total).toBe(1)

    // ACT — a pessoa volta para a aba
    visibilidade.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    // ASSERT — busca na hora, sem esperar o próximo minuto
    await waitFor(() => {
      expect(leituras.total).toBe(2)
    })
  })

  it('não deve buscar durante o arraste de um cartão, e deve buscar quando ele termina', async () => {
    // ARRANGE — gesto ligado para quem edita
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda({ permissoes: ['agenda.ver', 'agenda.editar'], arrastoLigado: true })
    await screen.findByText('Paciente Fictício 1')

    // ACT — o cartão sobe (passa do limiar do mouse) e fica no ar por dois minutos
    fireEvent.pointerDown(cartaoNaTela(1), { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 80 })
    expect(document.querySelector('[data-fantasma-arrasto]')).not.toBeNull()
    await vi.advanceTimersByTimeAsync(121_000)

    // ASSERT — a busca esperou
    expect(leituras.total).toBe(1)

    // ACT — solta fora de alvo (cancela o gesto)
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 80 })

    // ASSERT — o minuto venceu no meio do arraste: a busca que esperou acontece agora
    await waitFor(() => {
      expect(leituras.total).toBe(2)
    })
  })

  it('não deve buscar com o formulário de agendamento aberto', async () => {
    // ARRANGE — a recepção abriu "Marcar" num horário livre
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda({
      cards: [cartao(1, '08:00', { estado: 'aguardando', em: null })],
      permissoes: ['agenda.ver', 'agenda.criar'],
    })
    await screen.findByText('Paciente Fictício 1')
    fireEvent.click(screen.getByRole('button', { name: /^Marcar às 10:00/ }))
    await screen.findByRole('alertdialog')

    // ACT
    await vi.advanceTimersByTimeAsync(121_000)

    // ASSERT
    expect(leituras.total).toBe(1)
  })

  it('deve manter o destaque da faixa e o cartão aberto depois da busca', async () => {
    // ARRANGE — na 2ª leitura a família de outro cartão também não respondeu
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { leituras } = renderizarAgenda()
    leituras.proximas = [
      ...QUATRO_ESTADOS.filter((card) => card.id !== 4),
      cartao(4, '11:00', { estado: 'aguardando', em: null }),
    ]
    fireEvent.click(await screen.findByRole('button', { name: '1 sem resposta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Paciente Fictício 2' }))
    await screen.findByRole('dialog', { name: 'Detalhes do agendamento' })

    // ACT
    await vi.advanceTimersByTimeAsync(61_000)

    // ASSERT — o dado mudou (agora são 2 sem resposta), o destaque e o painel continuam. `hidden`:
    // com o painel modal aberto, a faixa fica fora da árvore acessível — é ela que se quer ver
    expect(await screen.findByRole('button', { name: '2 sem resposta', hidden: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(leituras.total).toBe(2)
    expect(document.querySelector('[data-grade-agenda]')).toHaveAttribute('data-destaque', 'aguardando')
    expect(screen.getByRole('dialog', { name: 'Detalhes do agendamento' })).toBeInTheDocument()
  })
})
