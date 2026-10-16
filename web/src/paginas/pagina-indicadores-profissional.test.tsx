import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { queryClient } from '@/lib/query-client'
import { PaginaIndicadoresProfissional } from '@/paginas/pagina-indicadores-profissional'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ItemDeAtendimento, ItensDeIndicador } from '@/tipos'

expect.extend(toHaveNoViolations)

const MES = '2026-07'

const producaoDoMes = {
  de: `${MES}-01`,
  ate: `${MES}-31`,
  linhas: [
    {
      profissional: { id: 1, nome: 'Fono Fictícia' },
      atendimentos: 9,
      sessoes_consumidas: 8,
      evolucoes_preenchidas: 7,
    },
  ],
}

function itemFicticio(sobrescritas: Partial<ItemDeAtendimento> = {}): ItemDeAtendimento {
  return {
    id: 5,
    finalizado_em: '2026-07-15 10:00',
    paciente: { id: 10, nome: 'Paciente Fictício Um' },
    profissional: { id: 1, nome: 'Fono Fictícia' },
    especialidade: { id: 1, nome: 'Fonoaudiologia Fictícia' },
    convenio: null,
    ...sobrescritas,
  }
}

function paginaDeItens(
  itens: ItemDeAtendimento[],
  rotulo = 'Fono Fictícia',
): ItensDeIndicador<ItemDeAtendimento> {
  return {
    mes: MES,
    contexto: { rotulo, total: itens.length },
    data: itens,
    current_page: 1,
    last_page: 1,
    per_page: 50,
    total: itens.length,
  }
}

const selecaoDaAgenda = {
  profissionais: [],
  especialidades: [
    { id: 1, nome: 'Fonoaudiologia Fictícia' },
    { id: 2, nome: 'Psicologia Fictícia' },
  ],
  feriados: [],
  salas: [],
  equipamentos: [],
  medicos: [],
  status: [],
}

function renderizar(caminho: string, permissoes: string[] = ['atendimentos.ver']) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/indicadores/profissionais/:id" element={<PaginaIndicadoresProfissional />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Página do profissional — KPIs, lista e o combo da cliente', () => {
  it('deve mostrar os três KPIs da linha de produção e a lista de atendimentos', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/relatorios/producao-por-profissional', () => HttpResponse.json(producaoDoMes)),
      msw.get('/api/indicadores/atendimentos/itens', () => HttpResponse.json(paginaDeItens([itemFicticio()]))),
    )

    // ACT
    const { container } = renderizar(`/indicadores/profissionais/1?mes=${MES}`)

    // ASSERT — o nome no título; os três números; a linha da lista
    expect(await screen.findByRole('heading', { name: 'Fono Fictícia' })).toBeInTheDocument()
    expect(await screen.findByText('9')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('atendimentos finalizados')).toBeInTheDocument()
    // o critério escrito junto do número (change producao-pelo-dia-da-sessao)
    expect(screen.getByText('sessões consumidas, pelo dia da sessão')).toBeInTheDocument()
    expect(await screen.findByText('Paciente Fictício Um')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar aos indicadores/ })).toHaveAttribute(
      'href',
      `/indicadores?mes=${MES}`,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve refinar a lista pela especialidade — o combo profissional × especialidade', async () => {
    // ARRANGE — o handler devolve o recorte conforme o filtro pedido
    const filtrosPedidos: Array<string | null> = []
    servidor.use(
      msw.get('/api/relatorios/producao-por-profissional', () => HttpResponse.json(producaoDoMes)),
      msw.get('/api/agenda/selecao', () => HttpResponse.json(selecaoDaAgenda)),
      msw.get('/api/indicadores/atendimentos/itens', ({ request }) => {
        const especialidade = new URL(request.url).searchParams.get('especialidade_id')
        filtrosPedidos.push(especialidade)
        return HttpResponse.json(
          especialidade === null
            ? paginaDeItens([
                itemFicticio(),
                itemFicticio({
                  id: 6,
                  paciente: { id: 11, nome: 'Paciente Fictício Dois' },
                  especialidade: { id: 2, nome: 'Psicologia Fictícia' },
                }),
              ])
            : paginaDeItens([itemFicticio()], 'Fono Fictícia · Fonoaudiologia Fictícia'),
        )
      }),
    )
    renderizar(`/indicadores/profissionais/1?mes=${MES}`, ['atendimentos.ver', 'agenda.ver'])
    await screen.findByText('Paciente Fictício Um')

    // ACT — escolher a especialidade no filtro
    await userEvent.selectOptions(
      await screen.findByLabelText('Filtrar por especialidade'),
      '1',
    )

    // ASSERT — a requisição leva o refino e o contexto passa a nomeá-lo
    await waitFor(() => expect(filtrosPedidos).toContain('1'))
    expect(await screen.findByText(/Fono Fictícia · Fonoaudiologia Fictícia/)).toBeInTheDocument()
  })

  it('deve esconder o filtro sem a permissão da seleção — a lista continua', async () => {
    // ARRANGE + ACT — sem agenda.ver não há catálogo de especialidades (nem fetch:
    // qualquer chamada sem handler derruba o teste)
    servidor.use(
      msw.get('/api/relatorios/producao-por-profissional', () => HttpResponse.json(producaoDoMes)),
      msw.get('/api/indicadores/atendimentos/itens', () => HttpResponse.json(paginaDeItens([itemFicticio()]))),
    )
    renderizar(`/indicadores/profissionais/1?mes=${MES}`)

    // ASSERT
    expect(await screen.findByText('Paciente Fictício Um')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filtrar por especialidade')).not.toBeInTheDocument()
  })

  it('deve zerar os KPIs (sem inventar) para profissional sem produção no mês', async () => {
    // ARRANGE — a produção não tem a linha dele; o contexto da lista dá o nome
    servidor.use(
      msw.get('/api/relatorios/producao-por-profissional', () =>
        HttpResponse.json({ de: `${MES}-01`, ate: `${MES}-31`, linhas: [] }),
      ),
      msw.get('/api/indicadores/atendimentos/itens', () => HttpResponse.json(paginaDeItens([], 'Psico Fictícia'))),
    )

    // ACT
    renderizar(`/indicadores/profissionais/2?mes=${MES}`)

    // ASSERT — três zeros + estado vazio nomeado
    expect(await screen.findByRole('heading', { name: 'Psico Fictícia' })).toBeInTheDocument()
    expect(await screen.findAllByText('0')).toHaveLength(3)
    expect(await screen.findByText('Nenhum atendimento neste recorte.')).toBeInTheDocument()
  })

  it('deve mostrar erro amigável para id inválido — sem chamar a API', async () => {
    // ARRANGE + ACT — nenhum handler: qualquer fetch derrubaria o teste
    renderizar('/indicadores/profissionais/abc')

    // ASSERT
    expect(await screen.findByRole('alert')).toHaveTextContent('Este endereço de profissional não é válido.')
    expect(screen.getByRole('link', { name: 'Voltar aos indicadores' })).toBeInTheDocument()
  })

  it('deve mostrar não-encontrado amigável para profissional inexistente', async () => {
    // ARRANGE — a âncora responde 404 (escopo do model); a produção responde normal
    servidor.use(
      msw.get('/api/relatorios/producao-por-profissional', () => HttpResponse.json(producaoDoMes)),
      msw.get('/api/indicadores/atendimentos/itens', () =>
        HttpResponse.json({ message: 'não encontrado' }, { status: 404 }),
      ),
    )

    // ACT
    renderizar(`/indicadores/profissionais/999?mes=${MES}`)

    // ASSERT — a volta DENTRO do aviso (o cabeçalho tem a sua própria)
    const aviso = await screen.findByRole('alert')
    expect(aviso).toHaveTextContent('Não encontramos este profissional.')
    expect(within(aviso).getByRole('link', { name: 'Voltar aos indicadores' })).toBeInTheDocument()
  })

  it('deve manter o erro recuperável com tentar de novo quando o servidor falha', async () => {
    // ARRANGE — 500 na lista: é "tente de novo", não "não existe"
    let disponivel = false
    servidor.use(
      msw.get('/api/relatorios/producao-por-profissional', () => HttpResponse.json(producaoDoMes)),
      msw.get('/api/indicadores/atendimentos/itens', () =>
        disponivel
          ? HttpResponse.json(paginaDeItens([itemFicticio()]))
          : HttpResponse.json({ message: 'indisponível' }, { status: 500 }),
      ),
    )
    renderizar(`/indicadores/profissionais/1?mes=${MES}`)
    expect(
      await screen.findByText('Não foi possível carregar os atendimentos do profissional.', undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument()

    // ACT — o servidor volta
    disponivel = true
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT
    expect(await screen.findByText('Paciente Fictício Um')).toBeInTheDocument()
  })

  it('deve voltar à primeira página ao trocar o filtro de especialidade', async () => {
    // ARRANGE — usuário preso na página 3 de um recorte largo; o refino encolhe o recorte
    const paginasPedidas: Array<string | null> = []
    servidor.use(
      msw.get('/api/relatorios/producao-por-profissional', () => HttpResponse.json(producaoDoMes)),
      msw.get('/api/agenda/selecao', () => HttpResponse.json(selecaoDaAgenda)),
      msw.get('/api/indicadores/atendimentos/itens', ({ request }) => {
        paginasPedidas.push(new URL(request.url).searchParams.get('page'))
        return HttpResponse.json(paginaDeItens([itemFicticio()]))
      }),
    )
    renderizar(`/indicadores/profissionais/1?mes=${MES}&pagina=3`, ['atendimentos.ver', 'agenda.ver'])
    await screen.findByText('Paciente Fictício Um')
    expect(paginasPedidas).toContain('3')

    // ACT — trocar o filtro reancora a lista
    await userEvent.selectOptions(await screen.findByLabelText('Filtrar por especialidade'), '1')

    // ASSERT — a requisição do recorte novo volta à 1ª página (nunca presa na 3)
    await waitFor(() => expect(paginasPedidas.length).toBeGreaterThan(1))
    expect(paginasPedidas.at(-1)).toBe('1')
  })

  it('deve voltar à FICHA quando a porta veio dela — e preservar a origem ao trocar de mês', async () => {
    // ARRANGE — `de=ficha` na URL (feedback do usuário: a volta ignorava a origem)
    servidor.use(
      msw.get('/api/relatorios/producao-por-profissional', () => HttpResponse.json(producaoDoMes)),
      msw.get('/api/indicadores/atendimentos/itens', () => HttpResponse.json(paginaDeItens([itemFicticio()]))),
    )
    renderizar(`/indicadores/profissionais/1?mes=${MES}&de=ficha`)

    // ASSERT — a volta aponta para a ficha do profissional
    expect(await screen.findByRole('link', { name: /Voltar à ficha do profissional/ })).toHaveAttribute(
      'href',
      '/profissionais/1',
    )

    // ACT — trocar o mês NÃO pode perder a origem
    await userEvent.click(screen.getByRole('button', { name: 'Mês anterior' }))

    // ASSERT
    expect(await screen.findByRole('link', { name: /Voltar à ficha do profissional/ })).toBeInTheDocument()
  })
})
