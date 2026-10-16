import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { rotuloDoMes } from '@/lib/meses'
import { queryClient } from '@/lib/query-client'
import { PaginaIndicadoresItens } from '@/paginas/pagina-indicadores-itens'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ItemDaAgenda, ItemDeAtendimento, ItensDeIndicador } from '@/tipos'

expect.extend(toHaveNoViolations)

const MES = '2026-07'

function paginaDeAgenda(sobrescritas: Partial<ItensDeIndicador<ItemDaAgenda>> = {}): ItensDeIndicador<ItemDaAgenda> {
  return {
    mes: MES,
    contexto: { rotulo: 'Em Aberto', total: 60 },
    data: [
      {
        id: 1,
        inicio: '2026-07-20 08:00',
        paciente: { id: 10, nome: 'Paciente Fictício Um' },
        profissional: { id: 1, nome: 'Profissional Fictício A' },
      },
      {
        id: 2,
        inicio: '2026-07-19 09:00',
        paciente: { id: 11, nome: 'Paciente Fictício Dois' },
        profissional: { id: 2, nome: 'Profissional Fictício B' },
      },
    ],
    current_page: 1,
    last_page: 2,
    per_page: 50,
    total: 60,
    ...sobrescritas,
  }
}

function paginaDeAtendimentos(): ItensDeIndicador<ItemDeAtendimento> {
  return {
    mes: MES,
    contexto: { rotulo: 'Fonoaudiologia Fictícia', total: 1 },
    data: [
      {
        id: 5,
        finalizado_em: '2026-07-15 10:00',
        paciente: { id: 10, nome: 'Paciente Fictício Um' },
        profissional: { id: 1, nome: 'Profissional Fictício A' },
        especialidade: { id: 1, nome: 'Fonoaudiologia Fictícia' },
        convenio: null,
      },
    ],
    current_page: 1,
    last_page: 1,
    per_page: 50,
    total: 1,
  }
}

function renderizar(busca: string, permissoes: string[] = ['agenda.ver', 'atendimentos.ver']) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/indicadores/itens${busca}`]}>
        <Routes>
          <Route path="/indicadores/itens" element={<PaginaIndicadoresItens />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Página de itens do indicador — contexto, paginação e portas', () => {
  it('deve mostrar o cabeçalho de contexto vindo da RESPOSTA e a volta com o mês', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/indicadores/agenda/itens', () => HttpResponse.json(paginaDeAgenda())))

    // ACT
    const { container } = renderizar(`?origem=agenda&status_id=1&mes=${MES}`)

    // ASSERT — rótulo + mês por extenso + total; a volta preserva o mês
    expect(await screen.findByRole('heading', { name: 'Em Aberto' })).toBeInTheDocument()
    expect(screen.getByText(`${rotuloDoMes(MES)} · 60 agendamentos`)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar aos indicadores/ })).toHaveAttribute(
      'href',
      `/indicadores?mes=${MES}`,
    )
    expect(screen.getByText('Paciente Fictício Dois')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve pedir só as sessões que JÁ PASSARAM e dizer isso, quando a porta vem da "Situação"', async () => {
    // ARRANGE — o corte das que passaram (contrato 2): sem ele, a lista trazia as futuras do status
    const pedidos: Array<string | null> = []
    servidor.use(
      msw.get('/api/indicadores/agenda/itens', ({ request }) => {
        pedidos.push(new URL(request.url).searchParams.get('passadas'))
        return HttpResponse.json(paginaDeAgenda())
      }),
    )

    // ACT
    renderizar(`?origem=agenda&status_id=1&mes=${MES}&passadas=1`)

    // ASSERT — o parâmetro viaja, e a tela diz o recorte em texto
    expect(await screen.findByRole('heading', { name: 'Em Aberto' })).toBeInTheDocument()
    expect(pedidos).toEqual(['1'])
    expect(screen.getByText(/Só as sessões que já passaram/)).toBeInTheDocument()
  })

  it('não deve cortar nem anunciar o corte quando a porta não pede as que passaram', async () => {
    // ARRANGE
    const pedidos: Array<string | null> = []
    servidor.use(
      msw.get('/api/indicadores/agenda/itens', ({ request }) => {
        pedidos.push(new URL(request.url).searchParams.get('passadas'))
        return HttpResponse.json(paginaDeAgenda())
      }),
    )

    // ACT
    renderizar(`?origem=agenda&status_id=1&mes=${MES}`)

    // ASSERT
    expect(await screen.findByRole('heading', { name: 'Em Aberto' })).toBeInTheDocument()
    expect(pedidos).toEqual([null])
    expect(screen.queryByText(/Só as sessões que já passaram/)).not.toBeInTheDocument()
  })

  it('deve pedir a página escolhida na paginação', async () => {
    // ARRANGE
    const paginasPedidas: Array<string | null> = []
    servidor.use(
      msw.get('/api/indicadores/agenda/itens', ({ request }) => {
        const url = new URL(request.url)
        paginasPedidas.push(url.searchParams.get('page'))
        return HttpResponse.json(
          paginaDeAgenda({ current_page: Number(url.searchParams.get('page') ?? 1) }),
        )
      }),
    )
    renderizar(`?origem=agenda&status_id=1&mes=${MES}`)
    await screen.findByRole('heading', { name: 'Em Aberto' })

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Página 2' }))

    // ASSERT — a página vai na requisição (e na URL, deep-linkável)
    expect(await screen.findByRole('button', { name: 'Página 2' })).toHaveAttribute('aria-current', 'page')
    expect(paginasPedidas).toContain('2')
  })

  it('deve linkar o nome do paciente à ficha SÓ com a permissão do destino', async () => {
    // ARRANGE + ACT — com pacientes.ver
    servidor.use(msw.get('/api/indicadores/agenda/itens', () => HttpResponse.json(paginaDeAgenda())))
    const primeira = renderizar(`?origem=agenda&status_id=1&mes=${MES}`, ['agenda.ver', 'pacientes.ver'])

    // ASSERT — porta real para a ficha
    expect(await screen.findByRole('link', { name: 'Paciente Fictício Um' })).toHaveAttribute(
      'href',
      '/pacientes/10',
    )
    primeira.unmount()
    queryClient.clear()

    // ACT — sem a permissão: o MESMO nome vira texto puro (F-02)
    renderizar(`?origem=agenda&status_id=1&mes=${MES}`, ['agenda.ver'])
    expect(await screen.findByText('Paciente Fictício Um')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Paciente Fictício Um' })).not.toBeInTheDocument()
  })

  it('deve listar atendimentos com especialidade e convênio ("Sem convênio" nomeado)', async () => {
    // ARRANGE + ACT
    servidor.use(
      msw.get('/api/indicadores/atendimentos/itens', () => HttpResponse.json(paginaDeAtendimentos())),
    )
    renderizar(`?origem=atendimentos&especialidade_id=1&mes=${MES}`)

    // ASSERT
    expect(await screen.findByRole('heading', { name: 'Fonoaudiologia Fictícia' })).toBeInTheDocument()
    expect(screen.getByText('Sem convênio')).toBeInTheDocument()
  })

  it('deve mostrar erro amigável com volta para query inválida — sem chamar a API', async () => {
    // ARRANGE + ACT — origem fora do par; nenhum handler registrado: qualquer
    // fetch derrubaria o teste (onUnhandledRequest: error)
    renderizar(`?origem=banana&mes=${MES}`)

    // ASSERT
    expect(await screen.findByRole('alert')).toHaveTextContent('Este endereço de itens não é válido.')
    expect(screen.getByRole('link', { name: 'Voltar aos indicadores' })).toHaveAttribute(
      'href',
      `/indicadores?mes=${MES}`,
    )
  })

  it('deve recusar duas dimensões base na própria URL (a regra da API, antes dela)', async () => {
    // ARRANGE + ACT — profissional + convênio: combinação que a API responderia 422
    renderizar(`?origem=atendimentos&profissional_id=1&convenio_id=2&mes=${MES}`)

    // ASSERT — erro amigável local; o combo profissional×especialidade continua válido
    expect(await screen.findByRole('alert')).toHaveTextContent('Este endereço de itens não é válido.')
  })

  it('deve aceitar o combo profissional × especialidade na URL (deep-link do refino)', async () => {
    // ARRANGE — o par PERMITIDO (CR-DD-03b): um flip na regra derrubaria este deep-link
    servidor.use(
      msw.get('/api/indicadores/atendimentos/itens', () => HttpResponse.json(paginaDeAtendimentos())),
    )

    // ACT
    renderizar(`?origem=atendimentos&profissional_id=1&especialidade_id=1&mes=${MES}`)

    // ASSERT — nada de alerta: a lista carrega
    expect(await screen.findByRole('heading', { name: 'Fonoaudiologia Fictícia' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
