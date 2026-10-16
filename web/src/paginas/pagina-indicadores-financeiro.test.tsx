import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryClient } from '@/lib/query-client'
import { ShellDeIndicadores } from '@/componentes/indicadores/shell-de-indicadores'
import { PaginaIndicadoresFinanceiro } from '@/paginas/pagina-indicadores-financeiro'
import { useAuthStore } from '@/stores/auth-store'
import { painelDoDinheiroFicticio, periodoFicticio } from '@/test/dados-paineis'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { GraficosFinanceiros, PainelDoDinheiro } from '@/tipos'

expect.extend(toHaveNoViolations)

const MES = '2026-06'

/** Os 12 buckets do ano, zerados — a API nunca manda série com buraco. */
function dozeMeses<T extends object>(valores: T): Array<{ mes: string } & T> {
  return Array.from({ length: 12 }, (_, indice) => ({
    mes: `2026-${String(indice + 1).padStart(2, '0')}`,
    ...valores,
  }))
}

function vistaFicticia(sobrescritas: Partial<GraficosFinanceiros> = {}): GraficosFinanceiros {
  return {
    mes: MES,
    ano: '2026',
    recebido_por_categoria: [
      {
        categoria_id: 1,
        categoria: 'Atendimentos Fictícios',
        subcategoria_id: 7,
        subcategoria: 'Sessão Fictícia',
        total: '1200.50',
      },
      { categoria_id: 2, categoria: 'Avaliações Fictícias', subcategoria_id: null, subcategoria: null, total: '300.00' },
    ],
    pago_por_categoria: [
      { categoria_id: 3, categoria: 'Aluguel Fictício', subcategoria_id: null, subcategoria: null, total: '800.00' },
    ],
    serie_do_ano: dozeMeses({ recebidas: '0.00', pagas: '0.00' }).map((bucket) =>
      bucket.mes === MES ? { ...bucket, recebidas: '1500.50', pagas: '800.00' } : bucket,
    ),
    previsao_do_ano: dozeMeses({ a_receber: '0.00', a_pagar: '0.00' }).map((bucket) =>
      bucket.mes === '2026-08' ? { ...bucket, a_receber: '480.00', a_pagar: '90.00' } : bucket,
    ),
    vencido: { a_receber: '150.00', a_pagar: '40.00' },
    ...sobrescritas,
  }
}

function renderizar(caminho = `/indicadores/financeiro?mes=${MES}`) {
  useAuthStore.setState({
    // `agenda.ver` porque o mês default nasce do FUSO da clínica, lido da configuração
    // da agenda — como o painel já faz
    usuario: { ...usuarioFicticio, permissoes: ['fluxo_caixa.ver', 'agenda.ver'] },
    carregandoSessao: false,
  })

  // aba de uma ÁREA: monta DENTRO do shell, de onde vêm o período e as abas
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route element={<ShellDeIndicadores />}>
            <Route path="/indicadores/financeiro" element={<PaginaIndicadoresFinanceiro />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** O painel do dinheiro do mês da página (D9) — o topo da aba, desde indicadores-profissionais. */
function painelDoMes(sobrescritas: Partial<PainelDoDinheiro> = {}): PainelDoDinheiro {
  return painelDoDinheiroFicticio({
    periodo: periodoFicticio(MES, { ate: '2026-06-30', parcial: false, comparado_de: '2026-05-01', comparado_ate: '2026-05-31' }),
    inicio_historico: '2026-01',
    inicio_historico_dia: '2026-01-01',
    serie_recebido: [],
    ...sobrescritas,
  })
}

beforeEach(() => {
  queryClient.clear()
  // a aba ganhou a linha do período e os cartões no TOPO (indicadores-profissionais): todo teste desta página
  // passa a receber o painel do dinheiro — os gráficos de baixo são os mesmos de antes
  servidor.use(msw.get('/api/indicadores/painel/dinheiro', () => HttpResponse.json(painelDoMes())))
})

describe('Gráficos financeiros — categorias do mês, ano em caixa e previsão', () => {
  it('deve mostrar as duas quebras por categoria com o valor em BRL', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())),
    )

    // ACT
    const { container } = renderizar()

    // ASSERT — categoria › subcategoria quando há nível; categoria sozinha quando não
    // o `h1` agora é da ÁREA ("Indicadores"); a aba se identifica pelos próprios blocos
    expect(screen.getByRole('heading', { name: 'Indicadores' })).toBeInTheDocument()
    const recebido = await screen.findByRole('region', { name: /Recebido por categoria/ })
    expect(within(recebido).getAllByText('Atendimentos Fictícios › Sessão Fictícia').length).toBeGreaterThan(0)
    expect(within(recebido).getAllByText('Avaliações Fictícias').length).toBeGreaterThan(0)
    expect(within(recebido).getAllByText('R$ 1.200,50').length).toBeGreaterThan(0)
    const pago = screen.getByRole('region', { name: /Pago por categoria/ })
    expect(within(pago).getAllByText('Aluguel Fictício').length).toBeGreaterThan(0)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve nomear o regime de cada seção e não somar caixa com previsão', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())),
    )

    // ACT
    const { container } = renderizar()
    const caixa = await screen.findByRole('region', { name: /Já entrou e saiu em 2026/ })

    // ASSERT — os dois regimes nomeados, em seções próprias
    const previsao = screen.getByRole('region', { name: /Ainda vai vencer em 2026/ })
    expect(within(caixa).getByText(/Regime de caixa/)).toBeInTheDocument()
    expect(within(previsao).getByText(/ainda NÃO foi pago/)).toBeInTheDocument()
    expect(within(previsao).getByText(/nada aqui está somado ao que já/)).toBeInTheDocument()

    // e NENHUM número da tela é a soma dos dois regimes: caixa 1.500,50 + previsão
    // 480,00 = 1.980,50 não pode aparecer em lugar NENHUM.
    //
    // A varredura é no TEXTO CRU do contêiner, não `queryByText`: aquele casa o
    // texto INTEIRO de um elemento, então um "Total geral: R$ 1.980,50" dentro de
    // um parágrafo com rótulo passaria batido — provado por mutação, foi o que
    // aconteceu na primeira versão deste teste.
    expect(container.textContent).not.toContain('1.980,50')
    // as duas parcelas, sim, cada uma na sua seção
    expect(within(caixa).getAllByText('R$ 1.500,50').length).toBeGreaterThan(0)
    expect(within(previsao).getAllByText('R$ 480,00').length).toBeGreaterThan(0)
  })

  it('deve declarar que o vencido é recorte dos meses, não parcela a mais', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())),
    )

    // ACT
    renderizar()
    const previsao = await screen.findByRole('region', { name: /Ainda vai vencer em 2026/ })

    // ASSERT
    expect(within(previsao).getByText('A receber já vencido no ano')).toBeInTheDocument()
    expect(within(previsao).getByText('R$ 150,00')).toBeInTheDocument()
    expect(within(previsao).getByText(/já estão contados nos meses abaixo/)).toBeInTheDocument()
  })

  it('deve mover o ano das séries movendo o MÊS em 12, sem um segundo controle de período', async () => {
    // ARRANGE — o handler registra o mês pedido em cada chamada
    const mesesPedidos: Array<string | null> = []
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', ({ request }) => {
        mesesPedidos.push(new URL(request.url).searchParams.get('mes'))

        return HttpResponse.json(vistaFicticia())
      }),
    )
    renderizar()
    await screen.findByRole('region', { name: /Recebido por categoria/ })

    // ACT — a seta de ANO anterior
    await userEvent.click(screen.getByRole('button', { name: 'Ano anterior' }))

    // ASSERT — o mesmo MÊS, 12 meses atrás: o ano não é um eixo separado.
    //
    // A prova de que não há segundo eixo é o RÓTULO DO MÊS ter andado junto: se o ano
    // fosse independente, "junho de 2026" continuaria lá enquanto só o ano mudasse.
    // (A versão anterior asseverava `queryByRole('combobox')` — asserção que não podia
    // falhar, porque a página nunca teve combobox algum. Achado CR-GF-16.)
    const periodo = screen.getByRole('group', { name: /Período de todos os indicadores/ })
    await waitFor(() => {
      expect(within(periodo).getByText('junho de 2025')).toBeInTheDocument()
    })
    expect(within(periodo).queryByText('junho de 2026')).not.toBeInTheDocument()
    expect(mesesPedidos).toContain('2025-06')
  })

  // A guarda de "região rolável alcançável por teclado" NÃO mora aqui: o rolador só se
  // anuncia quando há conteúdo escondido, e o jsdom reporta `scrollWidth = clientWidth = 0`
  // em tudo — nesta página ele nunca rolaria. A guarda vive em
  // `componentes/ui/rolador-horizontal.test.tsx`, com as medidas simuladas e as DUAS
  // direções cobertas (rola → região focável; não rola → sem parada de foco).

  it('deve oferecer saída e descrever a natureza certa em cada bloco vazio', async () => {
    // ARRANGE — o vazio era beco sem saída (os cartões desta página não têm porta no
    // cabeçalho como os do painel), e a descrição de "Nada recebido" falava em PAGO,
    // que lê como saída (achados IMP-7 e IMP-8)
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', () =>
        HttpResponse.json(vistaFicticia({ recebido_por_categoria: [], pago_por_categoria: [] })),
      ),
    )

    // ACT
    renderizar()
    const recebido = await screen.findByRole('region', { name: /Recebido por categoria/ })
    const pago = screen.getByRole('region', { name: /Pago por categoria/ })

    // ASSERT — cada um descreve a SUA natureza e oferece para onde ir
    expect(within(recebido).getByText(/efetivamente RECEBEU no mês/)).toBeInTheDocument()
    expect(within(pago).getByText(/efetivamente PAGOU no mês/)).toBeInTheDocument()
    expect(within(recebido).getByRole('link', { name: 'Abrir financeiro' })).toHaveAttribute(
      'href',
      '/financeiro',
    )
    expect(within(pago).getByRole('link', { name: 'Abrir financeiro' })).toBeInTheDocument()
    // a porta é da TELA: no papel um botão não leva a lugar nenhum (achado do PDF A4 de 05/10)
    for (const porta of screen.getAllByRole('link', { name: 'Abrir financeiro' })) {
      expect(porta).toHaveAttribute('data-nao-imprimir')
    }
  })

  it('deve explicar o período em cada bloco vazio, sem gráfico em branco', async () => {
    // ARRANGE — mês e ano sem nada pago nem a vencer
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', () =>
        HttpResponse.json(
          vistaFicticia({
            recebido_por_categoria: [],
            pago_por_categoria: [],
            serie_do_ano: dozeMeses({ recebidas: '0.00', pagas: '0.00' }),
            previsao_do_ano: dozeMeses({ a_receber: '0.00', a_pagar: '0.00' }),
            vencido: { a_receber: '0.00', a_pagar: '0.00' },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nada recebido neste mês.')).toBeInTheDocument()
    expect(screen.getByText('Nada pago neste mês.')).toBeInTheDocument()
    expect(screen.getByText('Nada pago nem recebido neste ano.')).toBeInTheDocument()
    expect(screen.getByText('Nada a vencer neste ano.')).toBeInTheDocument()
    // as quatro portas dos vazios ficam fora do papel
    const portas = screen.getAllByRole('link', { name: 'Abrir financeiro' })
    expect(portas).toHaveLength(4)
    for (const porta of portas) {
      expect(porta).toHaveAttribute('data-nao-imprimir')
    }
  })

  it('deve anunciar o carregamento com aria-busy enquanto a vista não chega', async () => {
    // ARRANGE — a spec exige os quatro estados, e CARREGANDO não tinha teste nenhum:
    // apagar o `aria-busy` ou o esqueleto inteiro não derrubava nada (achado do gate).
    // O contrato está escrito no próprio `skeleton.tsx`: o contêiner da superfície
    // async leva `aria-busy`.
    let liberar: (() => void) | undefined
    const suspenso = new Promise<void>((resolve) => {
      liberar = resolve
    })
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', async () => {
        await suspenso

        return HttpResponse.json(vistaFicticia())
      }),
    )

    // ACT
    const { container } = renderizar()

    // ASSERT — enquanto pende, o contêiner anuncia ocupado
    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    })
    expect(screen.queryByRole('region', { name: /Recebido por categoria/ })).not.toBeInTheDocument()

    // e some quando o dado chega
    liberar?.()
    expect(await screen.findByRole('region', { name: /Recebido por categoria/ })).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  it('deve oferecer nova tentativa quando a vista falha', async () => {
    // ARRANGE
    let chamadas = 0
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', () => {
        chamadas += 1

        // o 500 é falha de servidor: o query client re-tenta 1x sozinho, então
        // as DUAS primeiras têm de falhar para o estado de erro aparecer
        return chamadas <= 2
          ? HttpResponse.json({ message: 'erro' }, { status: 500 })
          : HttpResponse.json(vistaFicticia())
      }),
    )

    // ACT
    renderizar()
    expect(
      await screen.findByText('Não foi possível carregar os gráficos financeiros.', undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }))

    // ASSERT
    expect(await screen.findByRole('region', { name: /Recebido por categoria/ })).toBeInTheDocument()
  })

  it('deve tirar o mês default do FUSO DA CLÍNICA, não da constante', async () => {
    // ARRANGE — sem `?mes=` na URL, o mês nasce do DIA na parede da clínica, e o fuso é
    // DADO da clínica (§13).
    //
    // **O tempo é CONGELADO de propósito.** Sem congelar, o teste só discriminaria perto
    // da virada do mês: em qualquer outro dia São Paulo e Kiritimati caem no MESMO mês e
    // a asserção passa com ou sem o conserto — foi o que aconteceu na primeira versão
    // deste teste, e a mutação sutil sobreviveu a ela.
    //
    // 30/09 às 23h30 em São Paulo (UTC−3) é 01/10 às 13h30 em Kiritimati (UTC+14): os
    // meses DIVERGEM, e só então o teste tem o que provar.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T23:30:00-03:00'))
    const mesesPedidos: Array<string | null> = []
    servidor.use(
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({
          configuracoes: [{ chave: 'clinica.timezone', valor: 'Pacific/Kiritimati' }],
        }),
      ),
      msw.get('/api/indicadores/financeiro/graficos', ({ request }) => {
        mesesPedidos.push(new URL(request.url).searchParams.get('mes'))

        return HttpResponse.json(vistaFicticia())
      }),
    )

    // ACT — SEM `?mes=` na URL
    renderizar('/indicadores/financeiro')
    await screen.findByRole('region', { name: /Recebido por categoria/ })

    // ASSERT — o mês que a tela ASSENTA é outubro, a parede da clínica.
    //
    // Observado e declarado: a lista contém `['2026-09', '2026-10']`. A configuração da
    // clínica chega por requisição, então o primeiro render usa o fallback São Paulo e
    // refaz a busca quando o fuso chega. É o MESMO comportamento do painel
    // `/indicadores`, que usa este padrão — não é regressão desta tela. O efeito prático
    // aparece só na virada do mês, por instantes.
    expect(mesesPedidos.at(-1)).toBe('2026-10')
    vi.useRealTimers()
  })

  it('deve oferecer a aba Visão geral preservando o mês', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())),
    )

    // ACT
    renderizar()
    await screen.findByRole('region', { name: /Recebido por categoria/ })

    // ASSERT — a volta ao painel agora é a ABA, não um link "Voltar": ela carrega o mês
    // corrente, que é o que faz o período ser compartilhado pela ÁREA
    expect(screen.getByRole('link', { name: 'Visão geral' })).toHaveAttribute(
      'href',
      `/indicadores?mes=${MES}`,
    )
    expect(screen.getByRole('link', { name: 'Financeiro' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

describe('Aba Financeiro — a linha do período e os cartões do mês no topo', () => {
  it('deve abrir com a linha do período e os quatro cartões, e manter os gráficos de sempre embaixo', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())))

    // ACT
    renderizar()
    const graficos = await screen.findByRole('region', { name: /Recebido por categoria/ })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Dinheiro no mês' })).not.toBeInTheDocument())

    // ASSERT — o mês fechado, comparado com o anterior inteiro, e nenhuma frase de resumo (D8)
    const periodo = screen.getByText('Junho de 2026, comparado com maio de 2026.')
    expect(screen.queryByText(/Em junho entraram/)).not.toBeInTheDocument()
    for (const cartao of ['Recebido', 'A receber no mês', 'A receber em atraso', 'Valor médio por sessão']) {
      expect(screen.getByRole('region', { name: cartao })).toBeInTheDocument()
    }
    // o topo vem ANTES dos gráficos, na ordem de leitura
    expect(periodo.compareDocumentPosition(graficos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('deve chamar o atraso de "a receber em atraso" — só receitas, nunca o número do sino', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())))

    // ACT
    renderizar()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Dinheiro no mês' })).not.toBeInTheDocument())

    // ASSERT
    const atraso = screen.getByRole('region', { name: 'A receber em atraso' })
    expect(within(atraso).getByText('R$ 1.240')).toBeInTheDocument()
    expect(within(atraso).getByText('4 receitas vencidas')).toBeInTheDocument()
  })

  it('deve dizer "Sem dados" no valor médio quando não houve sessão faturada', async () => {
    // ARRANGE — o D4: sem sessão faturada, a média fica nula (nunca R$ 0)
    servidor.use(
      msw.get('/api/indicadores/painel/dinheiro', () =>
        HttpResponse.json(painelDoMes({ valor_medio_sessao: { atual: null, anterior: '80.00' } })),
      ),
      msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())),
    )

    // ACT
    renderizar()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Dinheiro no mês' })).not.toBeInTheDocument())

    // ASSERT
    const medio = screen.getByRole('region', { name: 'Valor médio por sessão' })
    expect(within(medio).getByText('Sem dados')).toBeInTheDocument()
    expect(within(medio).getByText('sem sessão faturada no período')).toBeInTheDocument()
    expect(within(medio).queryByText(/R\$ 0/)).not.toBeInTheDocument()
  })

  it('deve isolar o erro do topo: os gráficos de baixo continuam', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/indicadores/painel/dinheiro', () => HttpResponse.json({ message: 'erro' }, { status: 500 })),
      msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Não foi possível carregar os números do dinheiro.', undefined, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Recebido por categoria/ })).toBeInTheDocument()
  })

  it('não deve ter violações de acessibilidade com o topo e os gráficos', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())))

    // ACT
    const { container } = renderizar()
    await screen.findByRole('region', { name: /Recebido por categoria/ })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Dinheiro no mês' })).not.toBeInTheDocument())

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Aba Financeiro — as séries do ano no padrão novo (sem dados, zero neutro, tabela recolhida)', () => {
  /** O histórico da clínica começa em junho: de janeiro a maio o sistema não existia. */
  function comHistoricoDesde(inicio: string) {
    servidor.use(
      msw.get('/api/indicadores/painel/dinheiro', () => HttpResponse.json(painelDoMes({ inicio_historico: inicio, inicio_historico_dia: `${inicio}-01` }))),
      msw.get('/api/indicadores/financeiro/graficos', () => HttpResponse.json(vistaFicticia())),
    )
  }

  async function serieCarregada(): Promise<{ caixa: HTMLElement; container: HTMLElement }> {
    const { container } = renderizar()
    await waitFor(() => expect(screen.getByRole('region', { name: /Já entrou e saiu em 2026/ }).querySelector('[data-sem-dados]')).not.toBeNull())

    return { caixa: screen.getByRole('region', { name: /Já entrou e saiu em 2026/ }), container }
  }

  it('deve hachurar os meses antes do histórico e escrever "sem dados" na tabela — nunca R$ 0,00', async () => {
    // ARRANGE
    comHistoricoDesde('2026-06')

    // ACT
    const { caixa } = await serieCarregada()
    const previsao = screen.getByRole('region', { name: /Ainda vai vencer em 2026/ })

    // ASSERT — janeiro a maio, nas DUAS séries
    expect(caixa.querySelectorAll('[data-sem-dados]')).toHaveLength(5)
    expect(previsao.querySelectorAll('[data-sem-dados]')).toHaveLength(5)
    expect(within(caixa).getByText('jan–mai: nada registrado no caixa')).toBeInTheDocument()
    const tabela = within(caixa).getByRole('table', { name: 'Contas recebidas e pagas por mês no ano, em regime de caixa' })
    const janeiro = within(tabela).getByRole('row', { name: /janeiro de 2026/ })
    expect(within(janeiro).getAllByText('sem dados')).toHaveLength(2)
    expect(janeiro).not.toHaveTextContent('R$ 0,00')
  })

  it('não deve esconder dinheiro de verdade como "sem dados", mesmo antes do histórico', async () => {
    // ARRANGE — junho tem R$ 1.500,50 e o histórico (de agendamentos) só começa em julho
    comHistoricoDesde('2026-07')

    // ACT
    const { caixa } = await serieCarregada()

    // ASSERT — de janeiro a maio sem dados; junho, com o valor
    expect(caixa.querySelectorAll('[data-sem-dados]')).toHaveLength(5)
    const tabela = within(caixa).getByRole('table', { name: 'Contas recebidas e pagas por mês no ano, em regime de caixa' })
    expect(within(tabela).getByRole('row', { name: /junho de 2026/ })).toHaveTextContent('R$ 1.500,50')
  })

  it('deve escrever o zero em tom neutro — a cor só no valor diferente de zero', async () => {
    // ARRANGE — julho já é do histórico e não teve movimento
    comHistoricoDesde('2026-06')

    // ACT
    const { caixa } = await serieCarregada()
    const tabela = within(caixa).getByRole('table', { name: 'Contas recebidas e pagas por mês no ano, em regime de caixa' })

    // ASSERT — "Pagas R$ 0,00" em vermelho mês a mês era a queixa que abriu a change
    const julho = within(tabela).getByRole('row', { name: /julho de 2026/ })
    for (const zero of within(julho).getAllByText('R$ 0,00')) {
      expect(zero.className).toContain('text-texto-suave')
      expect(zero.className).not.toMatch(/text-(sucesso|perigo)-texto/)
    }
    const junho = within(tabela).getByRole('row', { name: /junho de 2026/ })
    expect(within(junho).getByText('R$ 1.500,50').className).toContain('text-sucesso-texto')
    expect(within(junho).getByText('R$ 800,00').className).toContain('text-perigo-texto')
  })

  it('deve recolher as tabelas mensais em "Ver os números em tabela" e titular pela conclusão', async () => {
    // ARRANGE
    comHistoricoDesde('2026-01')

    // ACT
    renderizar()
    const caixa = await screen.findByRole('region', { name: 'Já entrou e saiu em 2026: junho foi o mês que mais recebeu' })
    const previsao = screen.getByRole('region', { name: 'Ainda vai vencer em 2026: o maior valor a receber vence em agosto' })

    // ASSERT — cada tabela é o equivalente do gráfico, dentro do `details` (aberto no papel)
    for (const secao of [caixa, previsao]) {
      const resumo = within(secao).getByText('Ver os números em tabela').closest('summary')
      expect(resumo).not.toBeNull()
      const recolhida = resumo?.closest('details')
      expect(recolhida?.querySelector('table')).not.toBeNull()
      // recolhida na TELA: as doze linhas abertas eram o que ocupava a página inteira
      expect(recolhida?.open).toBe(false)
    }
    // sem histórico anterior ao ano, nada é hachurado
    expect(caixa.querySelector('[data-sem-dados]')).toBeNull()
  })

  it('deve titular sem conclusão quando dois meses empatam no maior valor', async () => {
    // ARRANGE — a previsão de outubro a dezembro igual: não há "o maior"
    servidor.use(
      msw.get('/api/indicadores/financeiro/graficos', () =>
        HttpResponse.json(
          vistaFicticia({
            previsao_do_ano: dozeMeses({ a_receber: '0.00', a_pagar: '0.00' }).map((bucket) =>
              bucket.mes >= '2026-10' ? { ...bucket, a_receber: '300.00' } : bucket,
            ),
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByRole('region', { name: 'Ainda vai vencer em 2026' })).toBeInTheDocument()
  })

  it('não deve ter violações de acessibilidade com os meses sem dados', async () => {
    // ARRANGE
    comHistoricoDesde('2026-06')

    // ACT
    const { container } = await serieCarregada()

    // ASSERT — mede o elemento renderizado, como os vizinhos (o `body` do jsdom não é uma página)
    expect(await axe(container)).toHaveNoViolations()
  })
})

