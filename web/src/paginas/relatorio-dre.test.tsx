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
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { EnvelopeDeRelatorio } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * O relatório DRE gerencial na área (change `dre-gerencial`): o ano corrente por padrão, a base
 * pelo Tipo (sem "todas": a primeira é a do servidor), "Somente contábeis", a escada com recuo e
 * subtotal realçado, e o aviso das categorias no padrão levando a Configurar DRE. Dados FICTÍCIOS.
 */

const QUEM_VE_O_DRE = ['lancamentos.ver', 'fluxo_caixa.ver']
const ANO = 'de=2026-01-01&ate=2026-12-31'

const AVISO = '2 categorias estão na linha padrão da natureza (receita em "Prestação de serviços", despesa em "Despesas administrativas") — confira em Configurar DRE.'

function envelopeDoDre(): EnvelopeDeRelatorio {
  return {
    slug: 'dre-gerencial',
    titulo: 'DRE gerencial',
    periodo: { de: '2026-09-01', ate: '2026-09-30' },
    filtros_aplicados: [{ rotulo: 'Base', valor: 'Pela data do pagamento (regime de caixa)' }],
    colunas: [
      { chave: 'linha', rotulo: 'DRE', tipo: 'texto' },
      { chave: 'm_2026_09', rotulo: 'set/2026', tipo: 'dinheiro' },
      { chave: 'total', rotulo: 'Total', tipo: 'dinheiro' },
    ],
    linhas: [
      { linha: 'Receita bruta', m_2026_09: '30000.00', total: '30000.00', nivel: 0, destaque: false },
      { linha: 'Prestação de serviços', m_2026_09: '30000.00', total: '30000.00', nivel: 1, destaque: false },
      { linha: 'Sessões Fictícias', m_2026_09: '30000.00', total: '30000.00', nivel: 2, destaque: false },
      { linha: '(−) Deduções', m_2026_09: '-2000.00', total: '-2000.00', nivel: 0, destaque: false },
      { linha: 'Receita líquida', m_2026_09: '28000.00', total: '28000.00', nivel: 0, destaque: true },
    ],
    grupos: null,
    totais: {},
    contagem: 5,
    truncado: false,
    avisos: [AVISO],
  }
}

function servir(): string[] {
  const chamadas: string[] = []
  servidor.use(
    msw.get('/api/relatorios/:slug', ({ request }) => {
      chamadas.push(new URL(request.url).search)
      return HttpResponse.json(envelopeDoDre())
    }),
    ...handlersDaAgenda(),
  )
  return chamadas
}

function ultima(chamadas: string[]): URLSearchParams {
  return new URLSearchParams(chamadas.at(-1) ?? '')
}

function renderizar(caminho: string, permissoes: string[] = QUEM_VE_O_DRE) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/relatorios/:slug" element={<PaginaRelatorio />} />
          <Route path="/financeiro/dre/configurar" element={<h1>Configurar DRE</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DRE gerencial — o formulário', () => {
  it('deve nascer no ano corrente da clínica, contando pelo pagamento', async () => {
    // ARRANGE — hoje é 25 de setembro de 2026 na parede da clínica
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T15:00:00Z'))
    servir()

    // ACT
    renderizar('/relatorios/dre-gerencial', [...QUEM_VE_O_DRE, 'agenda.ver'])

    // ASSERT — o ano inteiro; a base não tem vazio: a primeira é o padrão do servidor
    const base = await screen.findByLabelText('Base')
    expect(screen.getByLabelText('De (início do período)')).toHaveValue('01/01/2026')
    expect(screen.getByLabelText('Até (fim do período)')).toHaveValue('31/12/2026')
    expect(base).toHaveValue('pagamento')
    expect(within(base).getAllByRole('option').map((opcao) => opcao.textContent)).toEqual([
      'Pelo pagamento (regime de caixa)',
      'Pela competência',
    ])
    expect(screen.queryByRole('combobox', { name: 'Resultado' })).not.toBeInTheDocument()
  })

  it('deve levar a competência e "Somente contábeis" na chamada, com 1 — nunca "true"', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const chamadas = servir()
    renderizar(`/relatorios/dre-gerencial?${ANO}`)
    await screen.findByRole('table')

    // ACT
    await usuaria.selectOptions(screen.getByLabelText('Base'), 'competencia')
    await usuaria.click(screen.getByRole('checkbox', { name: 'Somente lançamentos contábeis' }))
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT
    await waitFor(() => {
      expect(ultima(chamadas).get('tipo')).toBe('competencia')
    })
    expect(ultima(chamadas).get('somente_contabeis')).toBe('1')
  })

  it('deve descartar da URL um "somente contábeis" que não seja 1', async () => {
    // ARRANGE
    const chamadas = servir()

    // ACT — o link colado é entrada não confiável; a API só entende `boolean`
    renderizar(`/relatorios/dre-gerencial?${ANO}&somente_contabeis=true`)
    await screen.findByRole('table')

    // ASSERT
    expect(ultima(chamadas).has('somente_contabeis')).toBe(false)
    expect(screen.getByRole('checkbox', { name: 'Somente lançamentos contábeis' })).not.toBeChecked()
  })
})

describe('DRE gerencial — o resultado', () => {
  it('deve levar do aviso das categorias no padrão até Configurar DRE', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    servir()
    renderizar(`/relatorios/dre-gerencial?${ANO}`)
    const aviso = (await screen.findByText(AVISO)).closest('[role="status"]') as HTMLElement

    // ACT
    await usuaria.click(within(aviso).getByRole('link', { name: 'Configurar DRE' }))

    // ASSERT
    expect(await screen.findByRole('heading', { name: 'Configurar DRE' })).toBeInTheDocument()
  })

  it('deve mostrar a escada sem linha de total — os subtotais já são o resultado', async () => {
    // ARRANGE
    servir()

    // ACT
    renderizar(`/relatorios/dre-gerencial?${ANO}`)
    const tabela = await screen.findByRole('table')

    // ASSERT
    expect(within(tabela).getByText('Receita líquida')).toBeInTheDocument()
    expect(within(tabela).getAllByText('R$ 28.000,00')).toHaveLength(2)
    expect(within(tabela).getAllByText('-R$ 2.000,00')).toHaveLength(2)
    expect(tabela.querySelector('tfoot')).toBeNull()
  })

  it('deve dizer que não há lançamento no período, com a saída, e sem violações axe', async () => {
    // ARRANGE — nada entrou nem saiu no recorte
    servidor.use(
      msw.get('/api/relatorios/:slug', () =>
        HttpResponse.json({ ...envelopeDoDre(), linhas: [], contagem: 0, avisos: [] }),
      ),
      ...handlersDaAgenda(),
    )

    // ACT
    const { container } = renderizar(`/relatorios/dre-gerencial?${ANO}&somente_contabeis=1`)

    // ASSERT
    expect(await screen.findByText(/^Nenhum registro para/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gerar sem os filtros' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe no DRE gerado, com o aviso e a escada', async () => {
    // ARRANGE + ACT
    servir()
    const { container } = renderizar(`/relatorios/dre-gerencial?${ANO}`)
    await screen.findByRole('table')

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)
})
