import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ShellDeIndicadores } from '@/componentes/indicadores/shell-de-indicadores'
import { queryClient } from '@/lib/query-client'
import { PaginaIndicadoresAgenda } from '@/paginas/pagina-indicadores-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { MES_DO_PAINEL, painelDaAgendaFicticio, paineisQueAnotam, periodoFicticio } from '@/test/dados-paineis'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { PainelDaAgenda } from '@/tipos'

expect.extend(toHaveNoViolations)

const handlerDeConfiguracao = msw.get('/api/agenda/configuracoes', () => HttpResponse.json({ configuracoes: [] }))

function renderizar(
  painel: PainelDaAgenda = painelDaAgendaFicticio(),
  caminho = `/indicadores/agenda?mes=${MES_DO_PAINEL}`,
  /** Handlers que valem ANTES dos que anotam (o MSW serve o primeiro que casa) */
  antes: Parameters<typeof servidor.use> = [],
) {
  const anotador = paineisQueAnotam({ agenda: painel })
  servidor.use(handlerDeConfiguracao, ...antes, ...anotador.handlers)
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'] }, carregandoSessao: false })

  const resultado = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route element={<ShellDeIndicadores />}>
            <Route path="/indicadores" element={<div />} />
            <Route path="/indicadores/agenda" element={<PaginaIndicadoresAgenda />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { ...resultado, chamadas: anotador.chamadas }
}

/** A aba carregada: o esqueleto (a região "Agenda no mês") saiu. */
async function abaPronta(): Promise<void> {
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Agenda no mês' })).not.toBeInTheDocument())
}

beforeEach(() => {
  queryClient.clear()
})

describe('Aba Agenda — o padrão das abas de detalhe', () => {
  it('deve seguir a ordem: a linha do período, os cinco cartões, os gráficos com título-conclusão e a tabela', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()

    // ASSERT — a ordem de leitura é a ordem do DOM
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((titulo) => titulo.textContent)
    expect(titulos).toEqual([
      'Ocupação',
      'Realizadas',
      'Faltas',
      'Desmarques',
      'Confirmadas',
      'As faltas se concentram na segunda-feira',
      'A sexta à tarde é o horário mais vazio',
      'Convênio Fictício Beta tem a maior taxa de faltas e desmarques',
      'Situação das sessões que já passaram',
    ])
    // a linha do período abre a aba, antes do primeiro cartão — e nenhuma frase de resumo (D8)
    const periodo = screen.getByText('De 1º a 5 de outubro de 2026, até hoje, comparado com 1º a 5 de setembro de 2026.')
    expect(periodo.compareDocumentPosition(screen.getByRole('region', { name: 'Ocupação' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Das 1.212 sessões que já passaram, 1.024 foram realizadas.')).not.toBeInTheDocument()
  })

  it('deve destacar o pior dia de faltas e deixar os outros recessivos', async () => {
    // ARRANGE + ACT — a segunda tem a maior taxa (11%)
    renderizar()
    await abaPronta()
    const grafico = screen.getByRole('region', { name: 'As faltas se concentram na segunda-feira' })

    // ASSERT
    const destaques = grafico.querySelectorAll('[data-destaque="sim"]')
    expect(destaques).toHaveLength(1)
    expect(grafico.querySelectorAll('[data-destaque="nao"]')).toHaveLength(5)
    // a coluna em destaque é a da segunda-feira (dia ISO 1)
    expect(destaques[0].closest('[data-coluna]')).toHaveAttribute('data-coluna', '1')
    expect(within(grafico).getByText('O dia com mais faltas')).toBeInTheDocument()
  })

  it('deve dizer no cartão de ocupação sobre quantos profissionais com horário ela foi calculada', async () => {
    // ARRANGE + ACT — 3 de 12 sem horário cadastrado
    renderizar()
    await abaPronta()

    // ASSERT
    const ocupacao = screen.getByRole('region', { name: 'Ocupação' })
    expect(ocupacao).toHaveTextContent('A ocupação foi calculada sobre 9 de 12 profissionais, os que têm horário e especialidade cadastrados.')
    expect(within(ocupacao).getByText('87%')).toBeInTheDocument()
    expect(within(ocupacao).getByText('4 p.p. a menos')).toBeInTheDocument()
  })

  it('deve deixar as sessões futuras fora da tabela, dizer isso em texto e explicar o status aberto que já passou', async () => {
    // ARRANGE — como na produção: uma sessão que JÁ PASSOU sem baixa ainda está "Em Aberto"
    const painel = painelDaAgendaFicticio()
    renderizar({ ...painel, situacao: [...painel.situacao, { status_id: 1, nome: 'Em Aberto', cor: '#2563EB', quantidade: 32 }] })
    await abaPronta()
    const situacao = screen.getByRole('region', { name: 'Situação das sessões que já passaram' })

    // ASSERT — a frase não pode contradizer a linha "Em Aberto 32": ela diz o que essa linha é
    expect(
      within(situacao).getByText(
        'Só as sessões que já passaram; as que ainda vão acontecer ficam fora. Uma sessão em status aberto aqui já passou e ainda não teve baixa.',
      ),
    ).toBeInTheDocument()
    expect(situacao).not.toHaveTextContent(/futuras \("Em aberto"\) ficam fora/i)
    expect(within(situacao).getByRole('row', { name: /Em Aberto 32/ })).toBeInTheDocument()
    // o total fecha com as linhas
    expect(within(situacao).getByRole('row', { name: /Total 1.238/ })).toBeInTheDocument()
    // cada status é porta para a lista daquele status no mês (ids e mês, nunca nome) — e SÓ das que
    // já passaram, o mesmo corte da tabela (contrato 2): sem ele a lista trazia as futuras também
    expect(within(situacao).getByRole('link', { name: 'Não Compareceu' })).toHaveAttribute(
      'href',
      `/indicadores/itens?origem=agenda&status_id=5&mes=${MES_DO_PAINEL}&passadas=1`,
    )
  })

  it('deve desenhar o mapa em faixas de uma cor, hachurar a célula sem grade e escrever só a mais vazia', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()
    const mapa = screen.getByRole('region', { name: 'A sexta à tarde é o horário mais vazio' })

    // ASSERT — o sábado à tarde não tem capacidade: hachurado, nunca 0%
    expect(mapa.querySelectorAll('[data-sem-dados]')).not.toHaveLength(0)
    expect(within(mapa).getByText('58%')).toBeInTheDocument()
    expect(within(mapa).getByText('Sem horário na grade naquele período')).toBeInTheDocument()
    // a tabela equivalente traz todos os números
    const tabela = within(mapa).getByRole('table', { name: 'Ocupação por dia da semana e período do dia' })
    expect(within(tabela).getByRole('row', { name: /sexta-feira/ })).toHaveTextContent('58% · 81 de 140')
    expect(within(tabela).getByRole('row', { name: /sábado/ })).toHaveTextContent('sem horário')
  })

  it('deve destacar o convênio com a maior taxa — nunca a linha agregada "Outros"', async () => {
    // ARRANGE — "Outros" com a maior taxa de todas não pode virar destaque: não é UM convênio
    renderizar(
      painelDaAgendaFicticio({
        por_convenio: [
          { nome: 'Convênio Fictício Alfa', particular: false, sessoes: 500, faltas: 30, desmarques: 10, taxa: 0.08 },
          { nome: 'Outros', outros: 3, particular: false, sessoes: 20, faltas: 5, desmarques: 5, taxa: 0.5 },
        ],
      }),
    )
    await abaPronta()

    // ASSERT
    const grafico = screen.getByRole('region', { name: 'Convênio Fictício Alfa tem a maior taxa de faltas e desmarques' })
    const destaques = grafico.querySelectorAll('[data-destaque="sim"]')
    expect(destaques).toHaveLength(1)
    // a barra em destaque é a do convênio do título — e não a da linha agregada, que tem taxa maior
    expect(destaques[0].closest('.contents')).toHaveTextContent('Convênio Fictício Alfa')
    expect(destaques[0].closest('.contents')).not.toHaveTextContent('Outros')
    expect(within(grafico).getByRole('table')).toHaveTextContent('Outros (3)')
  })

  it('deve dar aos cinco cartões a mesma anatomia: comparação E frase em todos (DQ-05)', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()

    // ASSERT — Faltas e Desmarques não ficam sem a frase ao lado dos que têm
    for (const rotulo of ['Ocupação', 'Realizadas', 'Faltas', 'Desmarques', 'Confirmadas']) {
      const cartao = screen.getByRole('region', { name: rotulo })
      expect(cartao.querySelectorAll('[data-comparacao]')).toHaveLength(1)
      expect(cartao.querySelector('p.border-t')).not.toBeNull()
    }
    expect(screen.getByRole('region', { name: 'Faltas' })).toHaveTextContent('73 de 1.212 sessões que já passaram.')
    expect(screen.getByRole('region', { name: 'Desmarques' })).toHaveTextContent('109 de 1.212 sessões que já passaram.')
  })

  it('deve trocar o gráfico de faltas por uma frase quando nenhum dia teve falta (DQ-22)', async () => {
    // ARRANGE — sessões passaram, e nenhuma faltou
    renderizar(
      painelDaAgendaFicticio({
        faltas_por_dia_semana: [
          { dia: 1, sessoes: 200, faltas: 0, taxa: 0 },
          { dia: 2, sessoes: 240, faltas: 0, taxa: 0 },
        ],
      }),
    )
    await abaPronta()

    // ASSERT — nada de colunas zeradas: o título e a frase dizem o que houve
    const quadro = screen.getByRole('region', { name: 'Nenhuma falta no período' })
    expect(quadro.querySelector('[data-coluna]')).toBeNull()
    expect(quadro).toHaveTextContent('Nenhuma das 1.212 sessões que já passaram teve falta.')
  })

  it('deve oferecer o equivalente em tabela de cada gráfico', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()

    // ASSERT
    expect(screen.getByRole('table', { name: 'Faltas por dia da semana nas sessões que já passaram' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Ocupação por dia da semana e período do dia' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Faltas e desmarques por convênio nas sessões que já passaram' })).toBeInTheDocument()
    expect(screen.getAllByText('Ver os números em tabela')).toHaveLength(3)
    // cada "Ver os números em tabela" diz, para o leitor de tela, QUAL tabela abre (A11Y-IND-06)
    const resumo = screen.getAllByText('Ver os números em tabela')[0].closest('summary')
    expect(resumo).toHaveTextContent('Ver os números em tabela: Faltas por dia da semana nas sessões que já passaram')
  })

  it('deve dizer "sem comparação" nas confirmadas quando não havia lembrete no período comparado', async () => {
    // ARRANGE + ACT — o D9 manda `confirmadas.anterior` nulo
    renderizar()
    await abaPronta()

    // ASSERT
    const confirmadas = screen.getByRole('region', { name: 'Confirmadas' })
    expect(within(confirmadas).getByText('sem comparação')).toBeInTheDocument()
    expect(confirmadas).toHaveTextContent('300 de 480 lembretes enviados, confirmados pela família ou pela recepção.')
  })

  it('deve dizer "Sem dados" — nunca 0% — quando o servidor manda a taxa nula por falta de base', async () => {
    // ARRANGE — nenhum lembrete saiu no período: a taxa de confirmadas vem NULA
    renderizar(painelDaAgendaFicticio({ confirmadas: { atual: { confirmadas: 0, enviados: 0, taxa: null }, anterior: null } }))
    await abaPronta()

    // ASSERT
    const confirmadas = screen.getByRole('region', { name: 'Confirmadas' })
    expect(within(confirmadas).getByText('Sem dados')).toBeInTheDocument()
    expect(within(confirmadas).queryByText('0%')).not.toBeInTheDocument()
    expect(within(confirmadas).getByText('Nenhum lembrete enviado no período.')).toBeInTheDocument()
  })

  it('deve listar no "i" das faltas os status que contam, pelo nome do cadastro', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    await abaPronta()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Como se calcula: Faltas' }))

    // ASSERT — a regra é DADO: a clínica muda a flag e o "i" passa a dizer o que conta
    const painel = await screen.findByRole('dialog', { name: 'Como se calcula: Faltas' })
    expect(painel).toHaveTextContent('Sessões que já passaram com status que marca falta: "Não Compareceu".')
    expect(painel).toHaveTextContent('(1.212)')
  })

  it('não deve ter violações de acessibilidade', async () => {
    // ARRANGE + ACT
    const { container } = renderizar()
    await abaPronta()

    // ASSERT — mede o elemento renderizado (a aba dentro do shell)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Aba Agenda — os quatro estados', () => {
  it('deve anunciar o carregamento com o esqueleto na ordem do conteúdo', async () => {
    // ARRANGE + ACT
    const { container } = renderizar()

    // ASSERT — ocupado enquanto pende, e solto quando chega
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    await abaPronta()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument()
  })

  it('deve oferecer nova tentativa quando o painel falha', async () => {
    // ARRANGE
    let chamadas = 0
    const instavel = msw.get('/api/indicadores/painel/agenda', () => {
      chamadas += 1

      // o 500 é falha de servidor: o query client re-tenta 1x sozinho
      return chamadas <= 2
        ? HttpResponse.json({ message: 'erro' }, { status: 500 })
        : HttpResponse.json(painelDaAgendaFicticio())
    })
    renderizar(undefined, undefined, [instavel])

    // ACT
    expect(await screen.findByText('Não foi possível carregar os números da agenda.', undefined, { timeout: 3000 })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT
    await abaPronta()
  })

  it('deve dizer "Sem dados" no mês antes do histórico e levar ao primeiro mês que existe', async () => {
    // ARRANGE — agosto, antes de setembro
    const agosto = periodoFicticio('2026-08', { ate: '2026-08-31', parcial: false, comparado_de: '2026-07-01', comparado_ate: '2026-07-31' })
    const { chamadas } = renderizar(painelDaAgendaFicticio({ periodo: agosto }), '/indicadores/agenda?mes=2026-08')

    // ASSERT — nenhuma porcentagem zerada no lugar do vazio
    expect(await screen.findByRole('heading', { name: 'Sem dados para este mês' })).toBeInTheDocument()
    expect(screen.getByText('Este mês é anterior ao início dos indicadores, em setembro de 2026.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Ocupação' })).not.toBeInTheDocument()

    // ACT — a próxima ação leva ao início do histórico, pelo período da ÁREA
    await userEvent.click(screen.getByRole('button', { name: 'Ver setembro de 2026' }))

    // ASSERT
    await waitFor(() => expect(chamadas).toContain('agenda?mes=2026-09'))
  })

  it('deve trocar o gráfico vazio por uma frase quando nenhuma sessão do período já passou', async () => {
    // ARRANGE — dia 1 de manhã: nada passou ainda
    renderizar(
      painelDaAgendaFicticio({
        sessoes_passadas: { atual: 0, anterior: 0 },
        faltas_por_dia_semana: [],
        por_convenio: [],
        situacao: [],
      }),
    )
    await abaPronta()

    // ASSERT
    expect(screen.getAllByRole('heading', { name: 'Ainda não há sessões que já passaram' })).toHaveLength(2)
    expect(screen.getByText('Nenhuma sessão do período já passou.', { selector: 'p.rounded-campo' })).toBeInTheDocument()
  })
})
