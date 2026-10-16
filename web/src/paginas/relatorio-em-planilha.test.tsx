import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryClient } from '@/lib/query-client'
import { PaginaRelatorio } from '@/paginas/pagina-relatorio'
import { nomeDoArquivoBaixado } from '@/servicos/relatorios'
import { useAuthStore } from '@/stores/auth-store'
import { handlersDaAgenda } from '@/test/dados-agenda'
import { envelopeFicticio } from '@/test/dados-relatorios'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

/**
 * O relatório em planilha (change `relatorio-em-planilha`): "Baixar planilha" ao lado de
 * "Imprimir", pelo MESMO recorte da consulta, com o nome que o servidor deu, e a recusa dita na
 * tela. Dados FICTÍCIOS.
 */

const QUEM_VE_O_CAIXA = ['lancamentos.ver', 'fluxo_caixa.ver', 'contas.ver', 'categorias.ver']
const CSV = '﻿Recebido e pago;\nPessoa;Recebido\nCriança Fictícia;150,00\n'

interface Registro {
  consultas: string[]
  planilhas: string[]
  nomesBaixados: string[]
}

function servir(slug: string, { statusDaPlanilha = 200 }: { statusDaPlanilha?: number } = {}): Registro {
  const registro: Registro = { consultas: [], planilhas: [], nomesBaixados: [] }
  servidor.use(
    msw.get('/api/relatorios/:slug/planilha', ({ request }) => {
      registro.planilhas.push(new URL(request.url).search)
      if (statusDaPlanilha !== 200) {
        return HttpResponse.json({ message: 'Sem permissão para este relatório.' }, { status: statusDaPlanilha })
      }
      return new HttpResponse(CSV, {
        headers: {
          'Content-Type': 'text/csv; charset=UTF-8',
          'Content-Disposition': `attachment; filename=${slug}_2026-09-01_a_2026-09-30.csv`,
        },
      })
    }),
    msw.get('/api/relatorios/:slug', ({ request }) => {
      registro.consultas.push(new URL(request.url).search)
      return HttpResponse.json(
        envelopeFicticio({
          slug,
          titulo: 'Relatório fictício',
          periodo: { de: '2026-09-01', ate: '2026-09-30' },
          filtros_aplicados: [],
        }),
      )
    }),
    ...handlersDaAgenda(),
    msw.get('/api/contas', () => HttpResponse.json([])),
    msw.get('/api/categorias', () => HttpResponse.json([])),
    msw.get('/api/convenios', () => HttpResponse.json([{ id: 1, nome: 'Particular' }])),
    msw.get('/api/convenios/:convenioId/servicos', () => HttpResponse.json([])),
  )
  // jsdom não baixa arquivo: o clique da âncora temporária é onde o NOME aparece
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function registrar(this: HTMLAnchorElement) {
    registro.nomesBaixados.push(this.download)
  })
  return registro
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

beforeEach(() => {
  // jsdom não tem createObjectURL: espiar SÓ os métodos (nunca trocar a classe URL global)
  URL.createObjectURL = vi.fn(() => 'blob:ficticio') as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('Baixar planilha — o mesmo relatório da tela', () => {
  it('deve baixar pelo MESMO recorte da consulta, com o nome que o servidor deu', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const registro = servir('contas-em-aberto')
    renderizar('/relatorios/contas-em-aberto?de=2026-09-01&ate=2026-09-30&tipo=receber&conta_id=3', QUEM_VE_O_CAIXA)
    await screen.findByRole('table')

    // ACT
    await usuaria.click(screen.getByRole('button', { name: 'Baixar planilha' }))

    // ASSERT — os parâmetros da planilha são os da tela, e o arquivo sai com o nome do servidor
    await waitFor(() => {
      expect(registro.nomesBaixados).toEqual(['contas-em-aberto_2026-09-01_a_2026-09-30.csv'])
    })
    expect(registro.planilhas).toEqual(registro.consultas)
    expect(new URLSearchParams(registro.planilhas[0]).get('conta_id')).toBe('3')
    // os bytes chegam crus: o BOM do UTF-8, que faz o Excel ler os acentos, está no arquivo
    const arquivo = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0]
    expect(arquivo).toBeInstanceOf(Blob)
    const bytes = new Uint8Array(await (arquivo as Blob).arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('deve deixar o convênio das Vendas fora da planilha, como da consulta', async () => {
    // ARRANGE — nas Vendas o convênio só acha o serviço; o relatório não se filtra por ele
    const usuaria = userEvent.setup()
    const registro = servir('vendas-do-periodo')
    renderizar(
      '/relatorios/vendas-do-periodo?de=2026-09-01&ate=2026-09-30&convenio_id=1&servico_id=12',
      [...QUEM_VE_O_CAIXA, 'tratamentos.ver', 'convenios.ver', 'servicos.ver'],
    )
    await screen.findByRole('table')

    // ACT
    await usuaria.click(screen.getByRole('button', { name: 'Baixar planilha' }))

    // ASSERT
    await waitFor(() => {
      expect(registro.planilhas).toHaveLength(1)
    })
    expect(new URLSearchParams(registro.planilhas[0]).has('convenio_id')).toBe(false)
    expect(new URLSearchParams(registro.planilhas[0]).get('servico_id')).toBe('12')
  })

  it('deve dizer na tela quando o servidor recusa, sem baixar nada', async () => {
    // ARRANGE — a permissão foi retirada depois que o relatório apareceu
    const usuaria = userEvent.setup()
    const registro = servir('recebido-e-pago', { statusDaPlanilha: 403 })
    renderizar('/relatorios/recebido-e-pago?de=2026-09-01&ate=2026-09-30', QUEM_VE_O_CAIXA)
    await screen.findByRole('table')

    // ACT
    await usuaria.click(screen.getByRole('button', { name: 'Baixar planilha' }))

    // ASSERT — nunca falha em silêncio
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem acesso à planilha deste relatório.')
    expect(registro.nomesBaixados).toEqual([])
    expect(screen.getByRole('button', { name: 'Baixar planilha' })).toBeEnabled()
  })

  it('deve tirar da tela a recusa da planilha quando o recorte muda', async () => {
    // ARRANGE — o recorte A fica no cache; a recusa acontece no recorte B. A URL inicial é a que o
    // formulário gera (com o `resultado`): só assim a volta ao A é o MESMO recorte, servido do cache
    const usuaria = userEvent.setup()
    const registro = servir('recebido-e-pago', { statusDaPlanilha: 403 })
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json([{ id: 1, nome: 'Caixa Fictício', codigo_contabil: null, ativo: true, updated_at: 'v1' }])),
    )
    renderizar('/relatorios/recebido-e-pago?de=2026-09-01&ate=2026-09-30&resultado=analitico', QUEM_VE_O_CAIXA)
    await screen.findByRole('table')
    await screen.findByRole('option', { name: 'Caixa Fictício' })
    await usuaria.selectOptions(screen.getByLabelText('Conta'), '1')
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))
    await waitFor(() => {
      expect(registro.consultas).toHaveLength(2)
    })
    await usuaria.click(await screen.findByRole('button', { name: 'Baixar planilha' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem acesso à planilha deste relatório.')

    // ACT — de volta ao recorte A, que o cache mostra na hora (o resultado não chega a desmontar)
    await usuaria.selectOptions(screen.getByLabelText('Conta'), '')
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT — a recusa era do recorte B: no A ela não diz nada. A 3ª consulta é a releitura do A
    // em segundo plano (vencido no cache), a prova de que a tela voltou ao MESMO recorte
    await waitFor(() => {
      expect(registro.consultas).toHaveLength(3)
    })
    expect(registro.consultas[2]).toBe(registro.consultas[0])
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByText('Você não tem acesso à planilha deste relatório.')).not.toBeInTheDocument()
  })

  it('deve não oferecer a planilha de um recorte vazio', async () => {
    // ARRANGE
    servir('recebido-e-pago')
    servidor.use(
      msw.get('/api/relatorios/:slug', () =>
        HttpResponse.json(envelopeFicticio({ slug: 'recebido-e-pago', linhas: [], contagem: 0, totais: {}, filtros_aplicados: [] })),
      ),
    )

    // ACT
    renderizar('/relatorios/recebido-e-pago?de=2026-09-01&ate=2026-09-30', QUEM_VE_O_CAIXA)
    await screen.findByText(/Nenhum registro/)

    // ASSERT — como o Imprimir: sem linha, nada a levar
    expect(screen.queryByRole('button', { name: 'Baixar planilha' })).not.toBeInTheDocument()
  })

  it('deve não ter violações axe com a recusa da planilha na tela', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    servir('recebido-e-pago', { statusDaPlanilha: 403 })
    const { container } = renderizar('/relatorios/recebido-e-pago?de=2026-09-01&ate=2026-09-30', QUEM_VE_O_CAIXA)
    await screen.findByRole('table')

    // ACT
    await usuaria.click(screen.getByRole('button', { name: 'Baixar planilha' }))
    await screen.findByRole('alert')

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)
})

describe('O nome do arquivo baixado', () => {
  it.each([
    ['attachment; filename=recebido-e-pago_2026-09-01_a_2026-09-30.csv', 'recebido-e-pago_2026-09-01_a_2026-09-30.csv'],
    ['attachment; filename="extrato.csv"', 'extrato.csv'],
    ["attachment; filename=relatorio.csv; filename*=utf-8''s%C3%A9rie.csv", 'série.csv'],
    ['attachment; filename="../../etc/relatorio.csv"', '..-..-etc-relatorio.csv'],
  ])('deve ler "%s" como "%s"', (disposicao, esperado) => {
    // ACT + ASSERT
    expect(nomeDoArquivoBaixado(disposicao, 'padrao.csv')).toBe(esperado)
  })

  it('deve cair no nome padrão sem o cabeçalho', () => {
    // ACT + ASSERT
    expect(nomeDoArquivoBaixado(undefined, 'dre-gerencial.csv')).toBe('dre-gerencial.csv')
    expect(nomeDoArquivoBaixado('attachment', 'dre-gerencial.csv')).toBe('dre-gerencial.csv')
  })
})
