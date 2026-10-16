import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NADA_FOI_VINCULADO } from '@/componentes/financeiro/lote-de-vinculos'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaVincularPagamentos } from '@/paginas/pagina-vincular-pagamentos'
import { useAuthStore } from '@/stores/auth-store'
import { handlersDaAgenda } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { PagamentoSemTratamento, PaginaDeApi, TratamentoDaLista, VinculoDoLote } from '@/tipos'

expect.extend(toHaveNoViolations)

/** Quem confere o lote: as três da rota, mais o que nomeia os pacotes (agenda e convênios). */
const QUEM_CONFERE = [
  'lancamentos.ver',
  'lancamentos.editar',
  'lancamentos.pagar',
  'tratamentos.ver',
  'agenda.ver',
  'convenios.ver',
]

/** Crianças FICTÍCIAS: nenhum nome aqui vem de paciente real. */
const ALFA = { id: 21, nome: 'Criança Fictícia Alfa' }
const BETA = { id: 22, nome: 'Criança Fictícia Beta' }
const GAMA = { id: 23, nome: 'Criança Fictícia Gama' }
const DELTA = { id: 24, nome: 'Criança Fictícia Delta' }

function pagamento(sobrescritas: Partial<PagamentoSemTratamento> & Pick<PagamentoSemTratamento, 'id'>): PagamentoSemTratamento {
  return {
    pago_em: '2026-09-05 10:00',
    liquido: '1200.00',
    paciente: ALFA,
    sugestao: null,
    tratamentos_da_crianca: [],
    ...sobrescritas,
  }
}

const DA_ALFA = pagamento({
  id: 101,
  sugestao: { tratamento_id: 7, especialidade: 'Psicologia', profissional: 'Profissional Fictício B', convenio: 'Particular' },
  tratamentos_da_crianca: [tratamento({ id: 7, paciente_id: ALFA.id, especialidade_id: 2, profissional_id: 2 })],
})
const DA_GAMA = pagamento({
  id: 102,
  pago_em: '2026-09-08 09:30',
  liquido: '800.00',
  paciente: GAMA,
  sugestao: { tratamento_id: 11, especialidade: 'Fonoaudiologia', profissional: 'Profissional Fictício A', convenio: 'Particular' },
})

function tratamento(sobrescritas: Partial<TratamentoDaLista> & Pick<TratamentoDaLista, 'id'>): TratamentoDaLista {
  return {
    realce: 'nenhum',
    paciente_id: BETA.id,
    convenio_id: 3,
    especialidade_id: 1,
    profissional_id: 1,
    servico_id: null,
    sessoes_total: 10,
    sessoes_realizadas: 1,
    sessoes_saldo: 9,
    vencido: false,
    data_inicio: '2026-09-01',
    validade_dias: null,
    pedido_vence_em: null,
    pedido_vencido: false,
    status: 'andamento',
    updated_at: '2026-09-01T10:00:00.000000Z',
    ...sobrescritas,
  }
}

const PACOTES_DA_BETA = [tratamento({ id: 9 }), tratamento({ id: 10, especialidade_id: 2, profissional_id: 2 })]
/** A Beta tem dois pacotes particulares em andamento — ambiguidade é decisão humana (D1). */
const DA_BETA = pagamento({
  id: 103,
  pago_em: '2026-09-12 16:00',
  liquido: '150.00',
  paciente: BETA,
  tratamentos_da_crianca: PACOTES_DA_BETA,
})
/** O rótulo do caixa: especialidade · profissional · convênio · realizadas/total. */
const PACOTE_10_DA_BETA = 'Psicologia · Profissional Fictício B · Particular · 1/10 sessões'

function pagina<T>(itens: T[]): PaginaDeApi<T> {
  return { data: itens, current_page: 1, last_page: 1, per_page: 100, total: itens.length }
}

/** Cada `GET /tratamentos` que a tela fez — a lista do lote já traz os da criança (CR-VPT-07). */
let pedidosDeTratamentos: string[] = []

/** A lista do lote + os catálogos que nomeiam os pacotes. Devolve as consultas à lista. */
function servirLista(pagamentos: PagamentoSemTratamento[] = [DA_ALFA, DA_GAMA, DA_BETA]): string[] {
  const consultas: string[] = []
  pedidosDeTratamentos = []
  servidor.use(
    ...handlersDaAgenda(),
    msw.get('/api/lancamentos/sem-tratamento', ({ request }) => {
      consultas.push(new URL(request.url).search)
      return HttpResponse.json({ data: pagamentos, contagem: pagamentos.length, truncado: false })
    }),
    msw.get('/api/tratamentos', ({ request }) => {
      pedidosDeTratamentos.push(new URL(request.url).search)
      return HttpResponse.json(pagina<TratamentoDaLista>([]))
    }),
    msw.get('/api/convenios', () => HttpResponse.json([{ id: 3, nome: 'Particular', particular: true }])),
  )
  return consultas
}

/** O lote que chegou ao servidor, e a resposta que ele dá. */
function capturarLote(resposta: () => Response = () => HttpResponse.json({ vinculados: 2 })): VinculoDoLote[][] {
  const lotes: VinculoDoLote[][] = []
  servidor.use(
    msw.post('/api/lancamentos/vincular-tratamentos', async ({ request }) => {
      lotes.push(((await request.json()) as { vinculos: VinculoDoLote[] }).vinculos)
      return resposta()
    }),
  )
  return lotes
}

function renderizar(caminho = '/financeiro/vincular?mes=2026-09', permissoes: string[] = QUEM_CONFERE) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[caminho]}>
          <Routes>
            <Route path="/financeiro/vincular" element={<PaginaVincularPagamentos />} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

const caixaDe = (crianca: { nome: string }) => screen.getByRole('checkbox', { name: crianca.nome })

afterEach(() => {
  vi.useRealTimers()
})

describe('Vincular pagamentos — a lista do mês', () => {
  it('deve listar as receitas do mês com a criança, a data, o valor e a sugestão', async () => {
    // ARRANGE
    const consultas = servirLista()

    // ACT
    renderizar()

    // ASSERT — o mês pedido vira o período inteiro; cada linha diz quando, quanto e para quem vai
    expect(await screen.findByRole('checkbox', { name: ALFA.nome })).toBeInTheDocument()
    expect(consultas).toEqual(['?de=2026-09-01&ate=2026-09-30'])
    expect(screen.getByText('Pago em 05/09/2026 · R$ 1.200,00')).toBeInTheDocument()
    expect(screen.getByText('Psicologia · Particular')).toBeInTheDocument()
    expect(screen.getByText('Vai para: Profissional Fictício B')).toBeInTheDocument()
    expect(screen.getByText('Pago em 12/09/2026 · R$ 150,00')).toBeInTheDocument()
    expect(screen.getByText('setembro de 2026', { selector: '[aria-live]' })).toBeInTheDocument()
  })

  it('deve abrir no mês atual da clínica quando a URL não diz o mês', async () => {
    // ARRANGE — 3 de setembro de 2026, meio-dia em Brasília
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-03T15:00:00Z'))
    const consultas = servirLista()

    // ACT
    renderizar('/financeiro/vincular')

    // ASSERT
    await screen.findByRole('checkbox', { name: ALFA.nome })
    expect(consultas[0]).toBe('?de=2026-09-01&ate=2026-09-30')
  })

  it('deve dizer que a criança sem tratamento nenhum não tem o que escolher, sem pedir a lista dela', async () => {
    // ARRANGE — a Delta não tem pacote: o servidor já mandou a lista vazia
    servirLista([pagamento({ id: 104, paciente: DELTA, tratamentos_da_crianca: [] })])

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Esta criança não tem tratamento cadastrado.')).toBeInTheDocument()
    expect(caixaDe(DELTA)).toBeDisabled()
    expect(pedidosDeTratamentos).toEqual([])
  })

  it('deve oferecer os tratamentos da criança que vieram na linha, sem pedir /tratamentos por criança', async () => {
    // ARRANGE — CR-VPT-07: uma consulta por linha sem sugestão era N+1, e a lista vai a 500
    servirLista()

    // ACT
    renderizar()

    // ASSERT — as opções da Beta são os dois pacotes da linha, com o rótulo do caixa
    expect(await screen.findByRole('option', { name: PACOTE_10_DA_BETA })).toBeInTheDocument()
    expect(
      within(screen.getByRole('combobox', { name: `Tratamento de ${BETA.nome}` })).getAllByRole('option'),
    ).toHaveLength(3)
    expect(pedidosDeTratamentos).toEqual([])
  })
})

describe('Vincular pagamentos — a marcação', () => {
  it('deve vir com as linhas sugeridas marcadas e a sem sugestão fora do lote', async () => {
    // ARRANGE
    servirLista()

    // ACT
    renderizar()
    await screen.findByRole('checkbox', { name: ALFA.nome })

    // ASSERT
    expect(caixaDe(ALFA)).toBeChecked()
    expect(caixaDe(GAMA)).toBeChecked()
    expect(caixaDe(BETA)).not.toBeChecked()
    expect(caixaDe(BETA)).toBeDisabled()
    expect(screen.getByText('2 pagamentos marcados de 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vincular 2 pagamentos' })).toBeInTheDocument()
  })

  it('deve pôr no lote a linha sem sugestão quando o tratamento dela é escolhido', async () => {
    // ARRANGE
    servirLista()
    const usuaria = userEvent.setup()
    renderizar()
    const campo = await screen.findByRole('combobox', { name: `Tratamento de ${BETA.nome}` })

    // ACT
    await usuaria.selectOptions(campo, await within(campo).findByRole('option', { name: PACOTE_10_DA_BETA }))

    // ASSERT — entrou marcada, e o campo diz para quem vai
    expect(caixaDe(BETA)).toBeChecked()
    expect(campo).toHaveAccessibleDescription('Vai para: Profissional Fictício B')
    expect(screen.getByRole('button', { name: 'Vincular 3 pagamentos' })).toBeInTheDocument()
  })

  it('deve travar o envio sem nenhuma linha marcada, dizendo o que falta', async () => {
    // ARRANGE
    servirLista()
    const usuaria = userEvent.setup()
    renderizar()
    await screen.findByRole('checkbox', { name: ALFA.nome })

    // ACT
    await usuaria.click(caixaDe(ALFA))
    await usuaria.click(caixaDe(GAMA))
    await usuaria.click(screen.getByRole('button', { name: 'Vincular pagamentos' }))

    // ASSERT — focável, mas inerte, e o porquê ligado ao botão
    const botao = screen.getByRole('button', { name: 'Vincular pagamentos' })
    expect(botao).toHaveAttribute('aria-disabled', 'true')
    expect(botao).toHaveAccessibleDescription('Marque ao menos um pagamento com tratamento.')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('Vincular pagamentos — confirmar e enviar', () => {
  it('deve confirmar e mandar no POST exatamente os pares marcados, e recarregar a lista', async () => {
    // ARRANGE — a Gama desmarcada, a Beta escolhida à mão
    const consultas = servirLista()
    const lotes = capturarLote()
    const usuaria = userEvent.setup()
    renderizar()
    const campo = await screen.findByRole('combobox', { name: `Tratamento de ${BETA.nome}` })
    await usuaria.click(caixaDe(GAMA))
    await usuaria.selectOptions(campo, await within(campo).findByRole('option', { name: PACOTE_10_DA_BETA }))

    // ACT
    await usuaria.click(screen.getByRole('button', { name: 'Vincular 2 pagamentos' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Vincular 2 pagamentos ao tratamento?' })
    expect(lotes).toEqual([])
    await usuaria.click(within(dialogo).getByRole('button', { name: 'Vincular 2 pagamentos' }))

    // ASSERT — os pares na ordem da lista, a notícia, e a lista pedida de novo
    await waitFor(() => {
      expect(lotes).toHaveLength(1)
    })
    expect(lotes[0]).toEqual([
      { lancamento_id: DA_ALFA.id, tratamento_id: 7 },
      { lancamento_id: DA_BETA.id, tratamento_id: 10 },
    ])
    expect(await screen.findByText('2 pagamentos vinculados ao tratamento.')).toBeInTheDocument()
    await waitFor(() => {
      expect(consultas).toHaveLength(2)
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('deve apontar a linha recusada pelo índice do LOTE, com a mensagem, e não mudar nada', async () => {
    // ARRANGE — a Alfa desmarcada: o lote é [Gama, Beta], e o `vinculos.1` é a BETA, não a Gama
    const consultas = servirLista()
    const MENSAGEM = 'O tratamento escolhido não é desta criança.'
    capturarLote(() =>
      HttpResponse.json({ message: 'Inválido.', errors: { 'vinculos.1.tratamento_id': [MENSAGEM] } }, { status: 422 }),
    )
    const usuaria = userEvent.setup()
    renderizar()
    const campo = await screen.findByRole('combobox', { name: `Tratamento de ${BETA.nome}` })
    await usuaria.click(caixaDe(ALFA))
    await usuaria.selectOptions(campo, await within(campo).findByRole('option', { name: PACOTE_10_DA_BETA }))

    // ACT
    await usuaria.click(screen.getByRole('button', { name: 'Vincular 2 pagamentos' }))
    await usuaria.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Vincular 2 pagamentos' }))

    // ASSERT — a linha da Beta, e só ela; o resumo diz que nada foi gravado e nomeia a linha
    await waitFor(() => {
      expect(caixaDe(BETA)).toHaveAttribute('aria-invalid', 'true')
    })
    expect(caixaDe(BETA)).toHaveAccessibleDescription(expect.stringContaining(MENSAGEM))
    expect(caixaDe(GAMA)).not.toHaveAttribute('aria-invalid')
    const resumo = screen.getByText(NADA_FOI_VINCULADO).closest('[role="alert"]')
    expect(resumo).not.toBeNull()
    expect(resumo?.textContent).toContain(`${BETA.nome}, pago em 12/09/2026: ${MENSAGEM}`)
    // nada mudou: a marcação é a mesma e a lista não foi recarregada
    expect(caixaDe(ALFA)).not.toBeChecked()
    expect(caixaDe(GAMA)).toBeChecked()
    expect(caixaDe(BETA)).toBeChecked()
    expect(consultas).toHaveLength(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('deve começar o mês seguinte sem a recusa do mês anterior', async () => {
    // ARRANGE — CR-VPT-09: a recusa de setembro não pode aparecer como se fosse de outubro. Outubro
    // já foi visto (está no cache): a volta a ele não passa pelo "carregando", que desmontaria o lote
    const consultas = servirLista()
    capturarLote(() =>
      HttpResponse.json({ message: 'Inválido.', errors: { 'vinculos.0.tratamento_id': ['Recusado.'] } }, { status: 422 }),
    )
    const usuaria = userEvent.setup()
    renderizar('/financeiro/vincular?mes=2026-10')
    await screen.findByRole('checkbox', { name: ALFA.nome })
    await usuaria.click(screen.getByRole('button', { name: 'Mês anterior' }))
    await screen.findByText('setembro de 2026', { selector: '[aria-live]' })
    await screen.findByRole('checkbox', { name: ALFA.nome })
    await usuaria.click(screen.getByRole('button', { name: 'Vincular 2 pagamentos' }))
    await usuaria.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Vincular 2 pagamentos' }))
    await screen.findByText(NADA_FOI_VINCULADO)

    // ACT
    await usuaria.click(screen.getByRole('button', { name: 'Próximo mês' }))

    // ASSERT — outubro chegou, e sem a recusa nem a linha marcada como inválida
    await waitFor(() => {
      expect(consultas.at(-1)).toBe('?de=2026-10-01&ate=2026-10-31')
    })
    expect(await screen.findByText('outubro de 2026', { selector: '[aria-live]' })).toBeInTheDocument()
    await screen.findByRole('checkbox', { name: ALFA.nome })
    expect(screen.queryByText(NADA_FOI_VINCULADO)).not.toBeInTheDocument()
    expect(caixaDe(ALFA)).not.toHaveAttribute('aria-invalid')
  })

  it('deve manter o diálogo aberto com a razão quando a recusa não é de linha', async () => {
    // ARRANGE — sem `lancamentos.pagar` no servidor (403): não há linha onde pousar
    servirLista()
    capturarLote(() => HttpResponse.json({ message: 'Proibido.' }, { status: 403 }))
    const usuaria = userEvent.setup()
    renderizar()
    await screen.findByRole('checkbox', { name: ALFA.nome })

    // ACT
    await usuaria.click(screen.getByRole('button', { name: 'Vincular 2 pagamentos' }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuaria.click(within(dialogo).getByRole('button', { name: 'Vincular 2 pagamentos' }))

    // ASSERT
    expect(await within(dialogo).findByText('Você não tem acesso a este recurso.')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})

describe('Vincular pagamentos — vazio, erro e acessibilidade', () => {
  it('deve dizer que o mês não tem pagamento sem tratamento e oferecer o mês anterior', async () => {
    // ARRANGE
    const consultas = servirLista([])
    const usuaria = userEvent.setup()
    renderizar()

    // ACT
    await usuaria.click(await screen.findByRole('button', { name: 'Ver agosto de 2026' }))

    // ASSERT — a frase nomeia o mês, e a saída leva ao mês anterior
    await waitFor(() => {
      expect(consultas.at(-1)).toBe('?de=2026-08-01&ate=2026-08-31')
    })
    expect(await screen.findByText('Nenhum pagamento sem tratamento em agosto de 2026.')).toBeInTheDocument()
  })

  it('deve mostrar o erro com "Tentar novamente", e listar quando volta', async () => {
    // ARRANGE — a primeira consulta é recusada (4xx não se repete sozinha); a segunda responde
    servirLista()
    let tentativas = 0
    servidor.use(
      msw.get('/api/lancamentos/sem-tratamento', () => {
        tentativas += 1
        return tentativas === 1
          ? HttpResponse.json({ message: 'Proibido.' }, { status: 403 })
          : HttpResponse.json({ data: [DA_ALFA], contagem: 1, truncado: false })
      }),
    )
    const usuaria = userEvent.setup()
    renderizar()

    // ACT
    expect(await screen.findByText('Você não tem acesso à lista de pagamentos sem tratamento.')).toBeInTheDocument()
    await usuaria.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT
    expect(await screen.findByRole('checkbox', { name: ALFA.nome })).toBeChecked()
  })

  it('deve não ter violações axe na lista, nem com uma linha recusada', async () => {
    // ARRANGE
    servirLista()
    capturarLote(() =>
      HttpResponse.json({ message: 'Inválido.', errors: { 'vinculos.0.tratamento_id': ['Recusado.'] } }, { status: 422 }),
    )
    const usuaria = userEvent.setup()
    const { container } = renderizar()
    await screen.findByRole('combobox', { name: `Tratamento de ${BETA.nome}` })
    expect(await axe(container)).toHaveNoViolations()

    // ACT
    await usuaria.click(screen.getByRole('button', { name: 'Vincular 2 pagamentos' }))
    await usuaria.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Vincular 2 pagamentos' }))
    await screen.findByText(NADA_FOI_VINCULADO)

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)
})
