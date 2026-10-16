import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryClient } from '@/lib/query-client'
import { PaginaRelatorio } from '@/paginas/pagina-relatorio'
import { useAuthStore } from '@/stores/auth-store'
import { handlersDaAgenda } from '@/test/dados-agenda'
import { envelopeFicticio } from '@/test/dados-relatorios'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { EnvelopeDeRelatorio } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * Os relatórios do caixa na tela (changes `relatorios-do-caixa` e `fechamento-de-caixa`): os
 * filtros Conta e Categoria, o Tipo com o sentido de cada relatório, a natureza das categorias,
 * o convênio que só acha o serviço, e o papel do fechamento com as assinaturas. Dados FICTÍCIOS.
 */

const QUEM_VE_O_CAIXA = ['lancamentos.ver', 'fluxo_caixa.ver', 'contas.ver', 'categorias.ver']
const RECEPCAO = ['lancamentos.ver', 'lancamentos.pagar', 'contas.ver', 'categorias.ver']
const SETEMBRO = 'de=2026-09-01&ate=2026-09-30'

const CONTAS = [
  { id: 1, nome: 'Caixa Fictício', codigo_contabil: null, ativo: true, updated_at: 'v1' },
  { id: 2, nome: 'Banco Antigo Fictício', codigo_contabil: null, ativo: false, updated_at: 'v1' },
]

const CATEGORIAS = [
  { id: 10, nome: 'Sessões', tipo: 'receita', subcategorias: [], updated_at: 'v1' },
  { id: 20, nome: 'Aluguel', tipo: 'despesa', subcategorias: [], updated_at: 'v1' },
]

function envelope(slug: string, titulo: string, sobrescritas: Partial<EnvelopeDeRelatorio> = {}): EnvelopeDeRelatorio {
  return envelopeFicticio({
    slug,
    titulo,
    periodo: { de: '2026-09-01', ate: '2026-09-30' },
    filtros_aplicados: [{ rotulo: 'Base', valor: 'Pela data do pagamento' }],
    colunas: [
      { chave: 'pessoa', rotulo: 'Pessoa', tipo: 'texto' },
      { chave: 'recebido', rotulo: 'Recebido', tipo: 'dinheiro' },
    ],
    linhas: [{ pessoa: 'Criança Fictícia', recebido: '150.00' }],
    grupos: null,
    totais: { recebido: '150.00' },
    contagem: 1,
    ...sobrescritas,
  })
}

/** O relatório e os catálogos do caixa; devolve a query string de cada chamada ao relatório. */
function servir(resposta: EnvelopeDeRelatorio): string[] {
  const chamadas: string[] = []
  servidor.use(
    msw.get('/api/relatorios/:slug', ({ request }) => {
      chamadas.push(new URL(request.url).search)
      return HttpResponse.json(resposta)
    }),
    ...handlersDaAgenda(),
    msw.get('/api/contas', () => HttpResponse.json(CONTAS)),
    msw.get('/api/categorias', () => HttpResponse.json(CATEGORIAS)),
    msw.get('/api/convenios', () => HttpResponse.json([{ id: 1, nome: 'Particular' }])),
    msw.get('/api/convenios/:convenioId/servicos', () =>
      HttpResponse.json([{ id: 12, convenio_id: 1, procedimento: 'Avaliação fictícia', codigo_procedimento: null, valor: '150.00', updated_at: 'v1' }]),
    ),
  )
  return chamadas
}

function ultima(chamadas: string[]): URLSearchParams {
  return new URLSearchParams(chamadas.at(-1) ?? '')
}

function renderizar(caminho: string, permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/relatorios/:slug" element={<PaginaRelatorio />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** As opções de um select, pelo texto. */
function opcoes(campo: HTMLElement): string[] {
  return within(campo).getAllByRole('option').map((opcao) => opcao.textContent ?? '')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Relatórios do caixa — Conta e Categoria', () => {
  it('deve oferecer Conta e Categoria a quem vê os catálogos, e levá-las na chamada', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const chamadas = servir(envelope('recebido-e-pago', 'Recebido e pago'))
    renderizar(`/relatorios/recebido-e-pago?${SETEMBRO}`, QUEM_VE_O_CAIXA)
    await screen.findByRole('option', { name: 'Caixa Fictício' })
    await screen.findByRole('option', { name: 'Sessões (receita)' })

    // ACT
    await usuaria.selectOptions(screen.getByLabelText('Conta'), '1')
    await usuaria.selectOptions(screen.getByLabelText('Categoria'), '10')
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT — a conta inativa continua escolhível, marcada; os dois filtros viajam
    await waitFor(() => {
      expect(ultima(chamadas).get('conta_id')).toBe('1')
    })
    expect(ultima(chamadas).get('categoria_id')).toBe('10')
    expect(opcoes(screen.getByLabelText('Conta'))).toEqual(['Todas', 'Caixa Fictício', 'Banco Antigo Fictício (inativa)'])
  })

  it('deve esconder Conta e Categoria de quem não vê os catálogos, e gerar sem eles', async () => {
    // ARRANGE — sem `contas.ver` nem `categorias.ver`: o campo SOME, não fica desabilitado
    const chamadas = servir(envelope('recebido-e-pago', 'Recebido e pago'))

    // ACT — um link copiado por quem vê as contas, aberto por quem não vê
    renderizar(`/relatorios/recebido-e-pago?${SETEMBRO}&conta_id=1&categoria_id=10`, ['lancamentos.ver', 'fluxo_caixa.ver'])
    await screen.findByRole('table', { name: 'Recebido e pago: 1 linhas' })

    // ASSERT — o relatório sai SEM esses filtros: um recorte que a pessoa não vê nem consegue tirar
    // não pode estar valendo (spec `relatorios-do-caixa`)
    expect(screen.queryByLabelText('Conta')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Categoria')).not.toBeInTheDocument()
    expect(ultima(chamadas).has('conta_id')).toBe(false)
    expect(ultima(chamadas).has('categoria_id')).toBe(false)
    expect(ultima(chamadas).get('de')).toBe('2026-09-01')
  })

  it('deve reproduzir a conta e a categoria do link copiado', async () => {
    // ARRANGE
    const chamadas = servir(envelope('contas-em-aberto', 'Contas a pagar e a receber'))

    // ACT
    renderizar(`/relatorios/contas-em-aberto?${SETEMBRO}&conta_id=2&categoria_id=20&tipo=pagar`, QUEM_VE_O_CAIXA)
    await screen.findByRole('option', { name: 'Aluguel' })

    // ASSERT
    expect(screen.getByLabelText('Conta')).toHaveValue('2')
    expect(screen.getByLabelText('Categoria')).toHaveValue('20')
    expect(ultima(chamadas).get('tipo')).toBe('pagar')
  })

  it('deve pôr a conta escolhida no cabeçalho do papel', async () => {
    // ARRANGE — o servidor diz o nome legível; o papel diz de que recorte é
    servir(
      envelope('recebido-e-pago', 'Recebido e pago', {
        filtros_aplicados: [
          { rotulo: 'Base', valor: 'Pela data do pagamento' },
          { rotulo: 'Conta', valor: 'Caixa Fictício' },
        ],
      }),
    )

    // ACT
    renderizar(`/relatorios/recebido-e-pago?${SETEMBRO}&conta_id=1`, QUEM_VE_O_CAIXA)
    await screen.findByRole('table', { name: 'Recebido e pago: 1 linhas' })

    // ASSERT
    const folha = document.querySelector('[data-impresso]')
    expect(folha).toHaveTextContent('Conta: Caixa Fictício')
    expect(folha).toHaveTextContent('Base: Pela data do pagamento')
  })

  it('deve tirar conta, categoria e tipo em "Gerar sem os filtros", mantendo o período', async () => {
    // ARRANGE — nada no recorte
    const usuaria = userEvent.setup()
    const chamadas = servir(
      envelope('contas-em-aberto', 'Contas a pagar e a receber', {
        filtros_aplicados: [
          { rotulo: 'Base', valor: 'Pelo vencimento, só o que está em aberto' },
          { rotulo: 'Conta', valor: 'Caixa Fictício' },
        ],
        linhas: [],
        contagem: 0,
        totais: {},
      }),
    )
    renderizar(`/relatorios/contas-em-aberto?${SETEMBRO}&conta_id=1&categoria_id=10&tipo=receber`, QUEM_VE_O_CAIXA)

    // ACT
    await usuaria.click(await screen.findByRole('button', { name: 'Gerar sem os filtros' }))

    // ASSERT
    await waitFor(() => {
      expect(ultima(chamadas).has('conta_id')).toBe(false)
    })
    expect(ultima(chamadas).has('categoria_id')).toBe(false)
    expect(ultima(chamadas).has('tipo')).toBe(false)
    expect(ultima(chamadas).get('de')).toBe('2026-09-01')
  })

  it('deve deixar a base fora da frase do vazio — ela descreve o papel, não recorta', async () => {
    // ARRANGE
    servir(
      envelope('contas-em-aberto', 'Contas a pagar e a receber', {
        filtros_aplicados: [
          { rotulo: 'Base', valor: 'Pelo vencimento, só o que está em aberto' },
          { rotulo: 'Conta', valor: 'Caixa Fictício' },
        ],
        linhas: [],
        contagem: 0,
        totais: {},
      }),
    )

    // ACT
    renderizar(`/relatorios/contas-em-aberto?${SETEMBRO}&conta_id=1`, QUEM_VE_O_CAIXA)

    // ASSERT
    expect(
      await screen.findByRole('heading', { name: 'Nenhum registro para 1º a 30 de setembro de 2026 com conta Caixa Fictício.' }),
    ).toBeInTheDocument()
  })
})

describe('Relatórios do caixa — o Tipo e a natureza das categorias', () => {
  it('deve chamar o Tipo pelo sentido dele: "Receber ou pagar", com "Os dois"', async () => {
    // ARRANGE
    servir(envelope('contas-em-aberto', 'Contas a pagar e a receber'))

    // ACT
    renderizar(`/relatorios/contas-em-aberto?${SETEMBRO}`, QUEM_VE_O_CAIXA)

    // ASSERT
    const tipo = await screen.findByLabelText('Receber ou pagar')
    expect(opcoes(tipo)).toEqual(['Os dois', 'A receber', 'A pagar'])
  })

  it('deve oferecer só as categorias da natureza do Tipo, e as duas, marcadas, sem Tipo', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    servir(envelope('contas-em-aberto', 'Contas a pagar e a receber'))
    renderizar(`/relatorios/contas-em-aberto?${SETEMBRO}`, QUEM_VE_O_CAIXA)
    await screen.findByRole('option', { name: 'Sessões (receita)' })
    const categoria = screen.getByLabelText('Categoria')
    expect(opcoes(categoria)).toEqual(['Todas', 'Sessões (receita)', 'Aluguel (despesa)'])

    // ACT
    await usuaria.selectOptions(screen.getByLabelText('Receber ou pagar'), 'pagar')

    // ASSERT — "A pagar" é despesa: a receita some, e a ajuda diz o porquê
    expect(opcoes(categoria)).toEqual(['Todas', 'Aluguel'])
    expect(screen.getByText('Só as categorias de despesa, pelo que você escolheu em "Receber ou pagar".')).toBeInTheDocument()
  })

  it('deve limpar a categoria que deixa de caber quando o Tipo muda', async () => {
    // ARRANGE — uma receita escolhida; a pessoa passa para "A pagar"
    const usuaria = userEvent.setup()
    const chamadas = servir(envelope('contas-em-aberto', 'Contas a pagar e a receber'))
    renderizar(`/relatorios/contas-em-aberto?${SETEMBRO}`, QUEM_VE_O_CAIXA)
    await screen.findByRole('option', { name: 'Sessões (receita)' })
    await usuaria.selectOptions(screen.getByLabelText('Categoria'), '10')

    // ACT
    await usuaria.selectOptions(screen.getByLabelText('Receber ou pagar'), 'pagar')
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT — nenhum 422 de "categoria de receita" nasce da tela
    await waitFor(() => {
      expect(ultima(chamadas).get('tipo')).toBe('pagar')
    })
    expect(ultima(chamadas).has('categoria_id')).toBe(false)
    expect(screen.getByLabelText('Categoria')).toHaveValue('')
  })

  it('deve oferecer nas Vendas só categorias de receita, e mandar o serviço sem o convênio', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const chamadas = servir(envelope('vendas-do-periodo', 'Vendas do período'))
    renderizar(`/relatorios/vendas-do-periodo?${SETEMBRO}`, [...QUEM_VE_O_CAIXA, 'tratamentos.ver', 'agenda.ver', 'convenios.ver', 'servicos.ver'])
    await screen.findByRole('option', { name: 'Sessões' })

    // ACT — o convênio só acha o serviço (a tabela é por convênio)
    await usuaria.selectOptions(screen.getByLabelText('Convênio do serviço'), '1')
    await usuaria.selectOptions(screen.getByLabelText('Serviço'), await screen.findByRole('option', { name: 'Avaliação fictícia' }))
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT — venda é receita; o serviço vai, o convênio não (as vendas não se filtram por ele)
    await waitFor(() => {
      expect(ultima(chamadas).get('servico_id')).toBe('12')
    })
    expect(ultima(chamadas).has('convenio_id')).toBe(false)
    expect(opcoes(screen.getByLabelText('Categoria'))).toEqual(['Todas', 'Sessões'])
    expect(screen.getByText(/O relatório não se filtra por convênio\./)).toBeInTheDocument()
  })

  it('deve oferecer na Movimentação do financeiro os tipos de ação, sem Conta nem Categoria', async () => {
    // ARRANGE
    servir(envelope('movimentacao-do-financeiro', 'Movimentação do financeiro'))

    // ACT
    renderizar(`/relatorios/movimentacao-do-financeiro?${SETEMBRO}`, ['auditoria.ver', 'lancamentos.ver', 'contas.ver', 'categorias.ver'])

    // ASSERT
    const tipo = await screen.findByLabelText('Tipo de movimentação')
    expect(opcoes(tipo)).toEqual(['Todas', 'Criado', 'Alterado', 'Baixa (pago)', 'Estornado', 'Excluído'])
    expect(screen.queryByLabelText('Conta')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Categoria')).not.toBeInTheDocument()
  })

  it('deve não ter violações axe no formulário com Conta, Categoria e o Tipo do relatório', async () => {
    // ARRANGE + ACT
    servir(envelope('contas-em-aberto', 'Contas a pagar e a receber'))
    const { container } = renderizar(`/relatorios/contas-em-aberto?${SETEMBRO}&tipo=receber`, QUEM_VE_O_CAIXA)
    await screen.findByRole('option', { name: 'Sessões' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)
})

describe('Fechamento de caixa — a gaveta do dia', () => {
  /** HOJE fixo na parede da clínica (America/Sao_Paulo): 25 de setembro de 2026. */
  function fixarHoje() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T15:00:00Z'))
  }

  const FECHAMENTO = envelope('fechamento-de-caixa', 'Fechamento de caixa', {
    periodo: { de: '2026-09-25', ate: '2026-09-25' },
    filtros_aplicados: [{ rotulo: 'Base', valor: 'Pela data do pagamento' }],
  })

  it('deve nascer em hoje, dia da clínica, quando o link não traz período', async () => {
    // ARRANGE
    fixarHoje()
    const chamadas = servir(FECHAMENTO)

    // ACT
    renderizar('/relatorios/fechamento-de-caixa', QUEM_VE_O_CAIXA)
    await screen.findByLabelText('Entradas ou saídas')

    // ASSERT — o formulário nasce em hoje; nada é pedido antes de Gerar (a URL veio vazia)
    expect(screen.getByLabelText('De (início do período)')).toHaveValue('25/09/2026')
    expect(screen.getByLabelText('Até (fim do período)')).toHaveValue('25/09/2026')
    expect(chamadas).toEqual([])
  })

  it('deve levar ao papel as linhas de quem entrega e de quem confere', async () => {
    // ARRANGE
    servir(FECHAMENTO)

    // ACT
    renderizar('/relatorios/fechamento-de-caixa?de=2026-09-25&ate=2026-09-25', QUEM_VE_O_CAIXA)
    await screen.findByRole('table', { name: 'Fechamento de caixa: 1 linhas' })

    // ASSERT — dentro da folha que vai ao papel, depois do resultado
    const folha = document.querySelector('[data-impresso]') as HTMLElement
    expect(within(folha).getByText('Entregue por')).toBeInTheDocument()
    expect(within(folha).getByText('Conferido por')).toBeInTheDocument()
  })

  it('deve não levar assinatura ao papel dos outros relatórios', async () => {
    // ARRANGE
    servir(envelope('recebido-e-pago', 'Recebido e pago'))

    // ACT
    renderizar(`/relatorios/recebido-e-pago?${SETEMBRO}`, QUEM_VE_O_CAIXA)
    await screen.findByRole('table', { name: 'Recebido e pago: 1 linhas' })

    // ASSERT
    expect(screen.queryByText('Entregue por')).not.toBeInTheDocument()
  })

  it('deve fechar o relatório à recepção, que dá baixa mas não vê o caixa da clínica', async () => {
    // ARRANGE — change `financeiro-sem-faturamento-total`: a recepção não fecha o caixa
    const chamadas = servir(FECHAMENTO)

    // ACT
    renderizar('/relatorios/fechamento-de-caixa?de=2026-09-25&ate=2026-09-25', RECEPCAO)

    // ASSERT — a tela de sem acesso, e nada pedido ao servidor
    expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
    expect(chamadas).toEqual([])
  })

  it('deve oferecer a divisão por quem deu baixa a quem vê o caixa da clínica', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    servir(FECHAMENTO)
    renderizar('/relatorios/fechamento-de-caixa?de=2026-09-25&ate=2026-09-25', QUEM_VE_O_CAIXA)

    // ACT
    await usuaria.selectOptions(await screen.findByRole('combobox', { name: 'Resultado' }), 'sintetico')

    // ASSERT
    expect(opcoes(screen.getByLabelText('Dividir por'))).toEqual(['Forma de pagamento', 'Conta', 'Quem deu baixa'])
  })

  it('deve não ter violações axe no fechamento gerado, com as assinaturas', async () => {
    // ARRANGE + ACT
    servir(FECHAMENTO)
    const { container } = renderizar('/relatorios/fechamento-de-caixa?de=2026-09-25&ate=2026-09-25', QUEM_VE_O_CAIXA)
    await screen.findByRole('table', { name: 'Fechamento de caixa: 1 linhas' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)
})
