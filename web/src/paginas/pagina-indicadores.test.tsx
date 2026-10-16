import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppShell } from '@/componentes/app-shell'
import { ShellDeIndicadores } from '@/componentes/indicadores/shell-de-indicadores'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaIndicadores } from '@/paginas/pagina-indicadores'
import { useAuthStore } from '@/stores/auth-store'
import {
  MES_DO_PAINEL,
  painelDaAgendaFicticio,
  painelDaEquipeFicticio,
  painelDoDinheiroFicticio,
  paineisQueAnotam,
  periodoFicticio,
} from '@/test/dados-paineis'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

const TODAS = ['agenda.ver', 'atendimentos.ver', 'pacientes.ver', 'fluxo_caixa.ver']

/** Quem tem `agenda.ver` também lê a config (o fuso da clínica semeia o mês default do shell). */
const handlerDeConfiguracao = msw.get('/api/agenda/configuracoes', () => HttpResponse.json({ configuracoes: [] }))

/**
 * O centro de notificações com os quatro blocos que pedem ação — e ITENS com nome de criança, que
 * a Visão geral NUNCA pode mostrar (só os totais). Os nomes são fictícios.
 */
function notificacoesComItens(totais: { desmarque: number; pacotes: number; evolucoes: number; atrasos: number }) {
  return {
    pedidos_de_desmarque: { total: totais.desmarque, itens: [{ dia: '2026-10-06', total: totais.desmarque }] },
    pacotes_acabando: {
      total: totais.pacotes,
      itens: [
        {
          tratamento_id: 1,
          paciente: { id: 1, nome: 'Criança Fictícia Pacote', nome_social: null },
          convenio: null,
          especialidade: null,
          sessoes_total: 10,
          sessoes_saldo: 1,
        },
      ],
    },
    evolucoes_em_aberto: { total: totais.evolucoes, itens: [{ paciente: { nome: 'Criança Fictícia Evolução' } }] },
    lancamentos_em_atraso: {
      total: totais.atrasos,
      itens: [
        {
          lancamento_id: 1,
          tipo: 'receita',
          vencimento: '2026-10-01',
          valor_liquido: '100.00',
          interessado: { tipo: 'paciente', id: 1, nome: 'Responsável Fictício Atraso' },
        },
      ],
    },
  }
}

function renderizar(permissoes: string[], caminho = `/indicadores?mes=${MES_DO_PAINEL}`) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  // a página é aba de uma ÁREA: monta DENTRO do shell, que traz o período, as abas e o Imprimir
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route element={<ShellDeIndicadores />}>
            <Route path="/indicadores" element={<PaginaIndicadores />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * A região JÁ CARREGADA: o esqueleto tem o mesmo nome (a moldura fica no lugar, CLS 0), então quem
 * espera pelo nome sozinho pegaria o esqueleto — e um elemento que some quando o dado chega.
 */
async function regiaoPronta(nome: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByRole('region', { name: nome })).not.toHaveAttribute('aria-busy'))

  return screen.getByRole('region', { name: nome })
}

beforeEach(() => {
  queryClient.clear()
})

describe('Visão geral — linha do período, quatro cartões, tendência e "Pede atenção"', () => {
  it('deve abrir com a linha do período, os quatro cartões com a comparação, a tendência e o "Pede atenção"', async () => {
    // ARRANGE — o gestor, com as quatro frentes
    const { handlers } = paineisQueAnotam()
    servidor.use(
      handlerDeConfiguracao,
      ...handlers,
      msw.get('/api/notificacoes', () => HttpResponse.json(notificacoesComItens({ desmarque: 3, pacotes: 9, evolucoes: 6, atrasos: 4 }))),
    )

    // ACT
    renderizar(TODAS)

    // ASSERT — a linha do período abre a Visão geral; resumo em frases não há mais (D8: a manchete
    // narrada fica para a IA)
    expect(await screen.findByText('De 1º a 5 de outubro de 2026, até hoje, comparado com 1º a 5 de setembro de 2026.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Resumo do mês' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Até hoje entraram/)).not.toBeInTheDocument()

    // os quatro cartões, cada um com o número e a comparação
    const dinheiro = await regiaoPronta('Dinheiro')
    expect(within(dinheiro).getByText('R$ 7.560,60')).toBeInTheDocument()
    expect(within(dinheiro).getByText('18% a mais')).toBeInTheDocument()
    expect(within(await regiaoPronta('Agenda')).getByText('87%')).toBeInTheDocument()
    const pacientes = await regiaoPronta('Pacientes')
    expect(within(pacientes).getByText('432')).toBeInTheDocument()
    // os ATIVOS não têm comparação: no lugar dela, a linha dos NOVOS, sem seta (DQ-05); e a
    // comparação deles mora na frase — junto do 432, "4 a mais" seria lido como crescimento dos ativos
    expect(pacientes.querySelector('[data-comparacao]')).toBeNull()
    expect(pacientes.querySelector('[data-contexto]')).toHaveTextContent('+24 novos no período')
    expect(pacientes).toHaveTextContent('Os novos são 4 a mais que em 1º a 5 de setembro.')
    expect(within(await regiaoPronta('Equipe')).getByText('94%')).toBeInTheDocument()

    // a tendência e o "Pede atenção"
    expect(await screen.findByRole('heading', { name: 'O recebido de outubro está acima do ritmo de setembro' })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Pede atenção' })).toBeInTheDocument()
  })

  it('não deve mostrar cartão, frase nem tendência de dinheiro sem fluxo_caixa.ver — nem chamar o painel do dinheiro', async () => {
    // ARRANGE — os quatro painéis respondem e ANOTAM quem foi chamado
    const { handlers, chamadas } = paineisQueAnotam()
    servidor.use(handlerDeConfiguracao, ...handlers)

    // ACT
    renderizar(['agenda.ver', 'atendimentos.ver', 'pacientes.ver'])
    await regiaoPronta('Agenda')

    // ASSERT — as três frentes permitidas foram buscadas; o dinheiro, nunca
    await waitFor(() => expect(chamadas).toEqual(expect.arrayContaining([`agenda?mes=${MES_DO_PAINEL}`, `pacientes?mes=${MES_DO_PAINEL}`, `equipe?mes=${MES_DO_PAINEL}`])))
    expect(chamadas.filter((chamada) => chamada.startsWith('dinheiro'))).toEqual([])
    expect(screen.queryByRole('region', { name: 'Dinheiro' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /recebido/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/lançado no caixa/)).not.toBeInTheDocument()
  })

  it.each([
    [['agenda.ver'], ['agenda'], ['Agenda']],
    [['pacientes.ver'], ['pacientes'], ['Pacientes']],
    [['fluxo_caixa.ver'], ['dinheiro'], ['Dinheiro']],
    // a Equipe cruza os dois eixos: só com as DUAS
    [['agenda.ver', 'atendimentos.ver'], ['agenda', 'equipe'], ['Agenda', 'Equipe']],
    [['atendimentos.ver'], [], []],
  ])('deve, com %j, buscar só %j e montar só %j', async (permissoes, buscados, cartoes) => {
    // ARRANGE
    const { handlers, chamadas } = paineisQueAnotam()
    servidor.use(handlerDeConfiguracao, ...handlers)

    // ACT
    renderizar(permissoes)
    for (const cartao of cartoes) {
      expect(await regiaoPronta(cartao)).toBeInTheDocument()
    }

    // ASSERT — o que não tem permissão nem monta, nem busca
    await waitFor(() => expect(new Set(chamadas.map((chamada) => chamada.split('?')[0]))).toEqual(new Set(buscados)))
    for (const outro of ['Dinheiro', 'Agenda', 'Pacientes', 'Equipe'].filter((nome) => !cartoes.includes(nome))) {
      expect(screen.queryByRole('region', { name: outro })).not.toBeInTheDocument()
    }
  })

  it('deve isolar o erro de um cartão, com tentar de novo, sem derrubar os outros', async () => {
    // ARRANGE — o dinheiro fora do ar; os outros respondem
    let dinheiroNoAr = false
    const { handlers } = paineisQueAnotam()
    // o handler específico vem ANTES dos que anotam: o MSW serve o primeiro que casa
    servidor.use(
      handlerDeConfiguracao,
      msw.get('/api/indicadores/painel/dinheiro', () =>
        dinheiroNoAr ? HttpResponse.json(painelDoDinheiroFicticio()) : HttpResponse.json({ message: 'indisponível' }, { status: 500 }),
      ),
      ...handlers,
    )
    renderizar(TODAS)

    // ASSERT — o erro é DO cartão Dinheiro; os outros seguem com os números deles
    expect(await screen.findByText('Não foi possível carregar os números do dinheiro.', undefined, { timeout: 4000 })).toBeInTheDocument()
    const dinheiro = await regiaoPronta('Dinheiro')
    expect(within(await regiaoPronta('Agenda')).getByText('87%')).toBeInTheDocument()

    // ACT — o servidor volta e a pessoa tenta de novo
    dinheiroNoAr = true
    await userEvent.click(within(dinheiro).getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT — o cartão volta com o número (e a linha do caixa volta às regras)
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Dinheiro' })).getByText('R$ 7.560,60')).toBeInTheDocument())
  })

  it('deve mostrar o esqueleto do cartão, ocupado, enquanto o painel não chega', async () => {
    // ARRANGE — o painel da agenda fica pendurado
    let liberar: (() => void) | undefined
    const pendurado = new Promise<void>((resolve) => {
      liberar = resolve
    })
    servidor.use(
      handlerDeConfiguracao,
      msw.get('/api/indicadores/painel/agenda', async () => {
        await pendurado

        return HttpResponse.json(painelDaAgendaFicticio())
      }),
    )

    // ACT
    renderizar(['agenda.ver'])

    // ASSERT — a moldura do cartão já está no lugar, anunciada como ocupada
    const cartao = await screen.findByRole('region', { name: 'Agenda' })
    expect(cartao).toHaveAttribute('aria-busy', 'true')
    liberar?.()
    expect(await screen.findByText('87%')).toBeInTheDocument()
    expect(within(await regiaoPronta('Agenda')).getByText('87%')).toBeInTheDocument()
  })
})

describe('Visão geral — o cartão Equipe e o "Pede atenção" contam a mesma história', () => {
  it('deve dizer quantas sessões ainda esperam evolução quando nenhuma passou do prazo', async () => {
    // ARRANGE — a validação local achou "Nenhuma evolução atrasada" ao lado de "255 atendimentos
    // sem evolução registrada": as duas verdadeiras, e lado a lado pareciam contradição
    const equipe = painelDaEquipeFicticio()
    servidor.use(
      handlerDeConfiguracao,
      ...paineisQueAnotam({
        equipe: { ...equipe, evolucoes: { ...equipe.evolucoes, atrasadas: 0, profissionais_com_atraso: 0 } },
      }).handlers,
      msw.get('/api/notificacoes', () => HttpResponse.json(notificacoesComItens({ desmarque: 0, pacotes: 0, evolucoes: 255, atrasos: 0 }))),
    )

    // ACT
    renderizar(['agenda.ver', 'atendimentos.ver', 'evolucoes.ver'])

    // ASSERT — o cartão nomeia as 255 e o prazo; o quadro conta as mesmas 255
    const cartao = await regiaoPronta('Equipe')
    expect(cartao).toHaveTextContent('255 sessões ainda sem evolução; nenhuma passou do prazo de 3 dias.')
    expect(cartao).not.toHaveTextContent('Nenhuma evolução atrasada')
    const quadro = await screen.findByRole('region', { name: 'Pede atenção' })
    expect(await within(quadro).findByRole('link', { name: /255 atendimentos sem evolução registrada/ })).toBeInTheDocument()
  })

  it('deve dizer as que passaram do prazo e o total que ainda espera', async () => {
    // ARRANGE + ACT — o dublê do D9: 6 atrasadas de 3 profissionais, 255 sem evolução, prazo de 3 dias
    servidor.use(handlerDeConfiguracao, ...paineisQueAnotam().handlers)
    renderizar(['agenda.ver', 'atendimentos.ver'])

    // ASSERT
    expect(await regiaoPronta('Equipe')).toHaveTextContent(
      '6 sessões passaram do prazo de 3 dias, de 3 profissionais; 255 ainda sem evolução no total.',
    )
  })
})

describe('Visão geral — "sem dados" antes do histórico, nunca zero', () => {
  it('deve hachurar e nomear os meses da tendência antes do sistema, sem coluna nem valor zero', async () => {
    // ARRANGE — o histórico começa em setembro: maio a agosto vêm nulos (D3)
    const { handlers } = paineisQueAnotam()
    servidor.use(handlerDeConfiguracao, ...handlers)

    // ACT
    const { container } = renderizar(['fluxo_caixa.ver'])
    const tendencia = await screen.findByRole('region', { name: 'O recebido de outubro está acima do ritmo de setembro' })

    // ASSERT — quatro colunas "sem dados", as duas com dado desenhadas (outubro em destaque)
    expect(tendencia.querySelectorAll('[data-sem-dados]')).toHaveLength(4)
    expect(tendencia.querySelectorAll('[data-destaque="sim"]')).toHaveLength(1)
    expect(tendencia.querySelectorAll('[data-destaque="nao"]')).toHaveLength(1)
    expect(within(tendencia).getByText('mai–ago: antes dos indicadores, sem dados')).toBeInTheDocument()
    // o eixo do mês em curso é CURTO (`out*`) — o "até o dia 5" vai na legenda (DQ-03)
    expect(within(tendencia).getByText('out*')).toBeInTheDocument()
    expect(within(tendencia).getByText('out*: só até hoje, dia 5 — o mês ainda está em curso')).toBeInTheDocument()
    // a tabela equivalente diz "sem dados" — nunca R$ 0,00
    const tabela = within(tendencia).getByRole('table', { name: 'Recebido por mês, em regime de caixa' })
    expect(within(tabela).getAllByText('sem dados')).toHaveLength(4)
    expect(within(tabela).queryByText('R$ 0,00')).not.toBeInTheDocument()
    expect(within(tabela).getByText('R$ 14.500,00')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/R\$ 0(,00)?\b/)
  })

  it('deve dizer "Sem dados" nos cartões do mês anterior ao histórico, explicar UMA vez na linha do período e levar ao início', async () => {
    // ARRANGE — agosto, antes de setembro (o início do histórico): o servidor manda zeros
    const agosto = periodoFicticio('2026-08', { ate: '2026-08-31', parcial: false, comparado_de: '2026-07-01', comparado_ate: '2026-07-31' })
    const { handlers, chamadas } = paineisQueAnotam({
      dinheiro: painelDoDinheiroFicticio({ periodo: agosto, recebido: { atual: '0.00', anterior: null } }),
      agenda: painelDaAgendaFicticio({ periodo: agosto, ocupacao: { atual: 0, anterior: null, profissionais_com_grade: 0, profissionais: 0 } }),
    })
    servidor.use(handlerDeConfiguracao, ...handlers)

    // ACT
    renderizar(['fluxo_caixa.ver', 'agenda.ver'], '/indicadores?mes=2026-08')

    // ASSERT — nada de R$ 0 nem 0%: "Sem dados" nos cartões, sem repetir o porquê (DQ-14)
    const dinheiro = await regiaoPronta('Dinheiro')
    expect(within(dinheiro).getByText('Sem dados')).toBeInTheDocument()
    expect(within(dinheiro).queryByText(/R\$ 0/)).not.toBeInTheDocument()
    expect(within(await regiaoPronta('Agenda')).queryByText('0%')).not.toBeInTheDocument()
    expect(await screen.findByText('Este mês é anterior ao início dos indicadores, em setembro de 2026.')).toBeInTheDocument()
    // o porquê e a saída ficam NA linha do período: um bloco abaixo dela empurrava os cartões quando o
    // painel chegava, porque o esqueleto reserva uma linha só (gate r2, CLS)
    expect(screen.getByRole('button', { name: 'Ver setembro de 2026' }).closest('p')).toHaveTextContent(
      'Agosto de 2026. Este mês é anterior ao início dos indicadores, em setembro de 2026. Ver setembro de 2026',
    )
    expect(screen.getAllByText(/anterior ao início dos indicadores/)).toHaveLength(1)

    // ACT — a saída leva ao primeiro mês com dados, pelo período da ÁREA
    await userEvent.click(screen.getByRole('button', { name: 'Ver setembro de 2026' }))

    // ASSERT
    await waitFor(() => expect(chamadas).toContain('dinheiro?mes=2026-09'))
  })
})

describe('Visão geral — sem comparação quando os indicadores começaram no meio do período comparado', () => {
  it('deve dizer na linha do período POR QUE não há comparação, e "sem comparação" nos cartões', async () => {
    // ARRANGE — setembro fechado contra agosto, com o sistema desde 21/08: o servidor manda todo
    // `anterior` nulo (contrato 1 da rodada 1 do gate)
    const setembro = periodoFicticio('2026-09', { ate: '2026-09-30', parcial: false, comparado_de: '2026-08-01', comparado_ate: '2026-08-31' })
    const historico = { periodo: setembro, inicio_historico: '2026-08', inicio_historico_dia: '2026-08-21' }
    const { handlers } = paineisQueAnotam({
      dinheiro: painelDoDinheiroFicticio({ ...historico, recebido: { atual: '9000.00', anterior: null }, valor_medio_sessao: { atual: '85.00', anterior: null } }),
    })
    servidor.use(handlerDeConfiguracao, ...handlers)

    // ACT
    renderizar(['fluxo_caixa.ver'], '/indicadores?mes=2026-09')

    // ASSERT
    expect(await screen.findByText('Setembro de 2026, sem comparação: os indicadores contam a partir de 21 de agosto de 2026.')).toBeInTheDocument()
    expect(within(await regiaoPronta('Dinheiro')).getByText('sem comparação')).toBeInTheDocument()
    // a tendência diz a CONCLUSÃO no título; o aviso vai para o subtítulo (DQ-21)
    const tendencia = await screen.findByRole('region', { name: 'Setembro, primeiro mês inteiro dos indicadores, recebeu R$ 9 mil' })
    expect(tendencia).toHaveTextContent('Sem comparação: os indicadores contam a partir de 21 de agosto de 2026.')
  })
})

describe('Visão geral — "Pede atenção"', () => {
  it('deve mostrar só os TOTAIS, com ícone e palavra e o atalho — nunca os itens com nome de criança', async () => {
    // ARRANGE — permissões dos quatro destinos
    servidor.use(
      handlerDeConfiguracao,
      ...paineisQueAnotam().handlers,
      msw.get('/api/notificacoes', () => HttpResponse.json(notificacoesComItens({ desmarque: 3, pacotes: 9, evolucoes: 6, atrasos: 4 }))),
    )

    // ACT
    renderizar([...TODAS, 'tratamentos.ver', 'evolucoes.ver', 'lancamentos.ver'])
    const quadro = await screen.findByRole('region', { name: 'Pede atenção' })

    // ASSERT — cada item é porta para onde se resolve, com a contagem e a palavra do estado
    const desmarques = await within(quadro).findByRole('link', { name: /3 sessões com pedido de desmarque pelo WhatsApp/ })
    expect(desmarques).toHaveAttribute('href', '/agenda')
    expect(desmarques).toHaveTextContent('Urgente')
    expect(within(quadro).getByRole('link', { name: /9 pacotes estão no fim/ })).toHaveAttribute('href', '/tratamentos')
    expect(within(quadro).getByRole('link', { name: /6 atendimentos sem evolução registrada/ })).toHaveAttribute('href', '/evolucoes')
    // o sino junta receitas e despesas: a contagem com o nome certo, e nenhum valor em R$ aqui
    const vencidos = within(quadro).getByRole('link', { name: /4 lançamentos vencidos \(a receber e a pagar\)/ })
    expect(vencidos).toHaveAttribute('href', '/financeiro')
    expect(quadro).not.toHaveTextContent(/R\$|pagamentos em atraso/)
    expect(within(quadro).getAllByText('Atenção')).toHaveLength(3)

    // LGPD — os itens do sino trazem nome; aqui, nenhum
    expect(screen.queryByText(/Criança Fictícia|Responsável Fictício/)).not.toBeInTheDocument()
  })

  it('deve alinhar selo, texto e atalho em três colunas fixas, as mesmas em todas as linhas', async () => {
    // ARRANGE — DQ-12: o atalho descia para baixo do texto em umas linhas e não em outras
    servidor.use(
      handlerDeConfiguracao,
      ...paineisQueAnotam().handlers,
      msw.get('/api/notificacoes', () => HttpResponse.json(notificacoesComItens({ desmarque: 3, pacotes: 9, evolucoes: 6, atrasos: 4 }))),
    )

    // ACT
    renderizar([...TODAS, 'tratamentos.ver', 'evolucoes.ver', 'lancamentos.ver'])
    const quadro = await screen.findByRole('region', { name: 'Pede atenção' })
    await within(quadro).findByRole('link', { name: /sessões com pedido de desmarque/ })

    // ASSERT — a lista é a grade; cada linha (e o link dela) herda as colunas dela (`subgrid`)
    const lista = within(quadro).getByRole('list')
    expect(lista.className).toContain('grid-cols-[auto_minmax(0,1fr)_auto]')
    for (const link of within(quadro).getAllByRole('link')) {
      expect(link.className).toContain('grid-cols-subgrid')
      expect(link.className).not.toContain('flex-wrap')
    }
  })

  it('não deve listar o item zerado, e deve dizer "Nada pede atenção agora" quando todos estão zerados', async () => {
    // ARRANGE
    servidor.use(
      handlerDeConfiguracao,
      ...paineisQueAnotam().handlers,
      msw.get('/api/notificacoes', () => HttpResponse.json(notificacoesComItens({ desmarque: 0, pacotes: 0, evolucoes: 0, atrasos: 0 }))),
    )

    // ACT
    renderizar(['agenda.ver'])
    const quadro = await screen.findByRole('region', { name: 'Pede atenção' })

    // ASSERT — o quadro não some sem explicação
    expect(await within(quadro).findByText('Nada pede atenção agora')).toBeInTheDocument()
    expect(within(quadro).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve escrever o item sem porta quando falta a permissão do destino', async () => {
    // ARRANGE — o bloco de atrasos veio, mas a pessoa não abre o financeiro
    servidor.use(
      handlerDeConfiguracao,
      ...paineisQueAnotam().handlers,
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({ lancamentos_em_atraso: { total: 2, itens: [] } }),
      ),
    )

    // ACT
    renderizar(['agenda.ver'])
    const quadro = await screen.findByRole('region', { name: 'Pede atenção' })

    // ASSERT — o número aparece, a porta não promete um 403
    expect(await within(quadro).findByText('lançamentos vencidos (a receber e a pagar)', { exact: false })).toBeInTheDocument()
    expect(within(quadro).queryByRole('link')).not.toBeInTheDocument()
  })

  it('não deve existir quando nenhum dos quatro blocos veio (o servidor filtra pela permissão)', async () => {
    // ARRANGE — o default do servidor de teste: centro de notificações vazio
    servidor.use(handlerDeConfiguracao, ...paineisQueAnotam().handlers)

    // ACT
    renderizar(['agenda.ver'])
    await regiaoPronta('Agenda')

    // ASSERT
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pede atenção' })).not.toBeInTheDocument())
  })
})

describe('Visão geral — período, portas e acessibilidade', () => {
  it('deve trocar o mês no seletor e refazer as consultas dos painéis com o novo mês', async () => {
    // ARRANGE
    const { handlers, chamadas } = paineisQueAnotam()
    servidor.use(handlerDeConfiguracao, ...handlers)
    renderizar(['agenda.ver'])
    expect(within(await regiaoPronta('Agenda')).getByText('87%')).toBeInTheDocument()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Mês anterior' }))

    // ASSERT — o MESMO painel, agora do mês anterior (o período mora na URL do shell)
    await waitFor(() => expect(chamadas).toContain('agenda?mes=2026-09'))
    expect(chamadas[0]).toBe(`agenda?mes=${MES_DO_PAINEL}`)
  })

  it('deve fazer de cada cartão uma porta para a aba da frente, com o mês', async () => {
    // ARRANGE
    servidor.use(handlerDeConfiguracao, ...paineisQueAnotam().handlers)

    // ACT
    renderizar(TODAS)

    // ASSERT — cada porta exige a MESMA permissão do painel, então nunca promete 403
    expect(await screen.findByRole('link', { name: 'Ver o financeiro do mês' })).toHaveAttribute('href', `/indicadores/financeiro?mes=${MES_DO_PAINEL}`)
    expect(await screen.findByRole('link', { name: 'Ver a agenda do mês' })).toHaveAttribute('href', `/indicadores/agenda?mes=${MES_DO_PAINEL}`)
    expect(await screen.findByRole('link', { name: 'Ver os pacientes do mês' })).toHaveAttribute('href', `/indicadores/pacientes?mes=${MES_DO_PAINEL}`)
    expect(await screen.findByRole('link', { name: 'Ver a equipe do mês' })).toHaveAttribute('href', `/indicadores/equipe?mes=${MES_DO_PAINEL}`)
  })

  it('não deve ter violações de acessibilidade com tudo carregado', async () => {
    // ARRANGE
    servidor.use(
      handlerDeConfiguracao,
      ...paineisQueAnotam().handlers,
      msw.get('/api/notificacoes', () => HttpResponse.json(notificacoesComItens({ desmarque: 3, pacotes: 9, evolucoes: 6, atrasos: 4 }))),
    )

    // ACT
    const { container } = renderizar([...TODAS, 'tratamentos.ver', 'evolucoes.ver', 'lancamentos.ver'])
    await screen.findByRole('link', { name: /sessões com pedido de desmarque/ })
    await regiaoPronta('Equipe')
    await screen.findByText(/até hoje, comparado com/)

    // ASSERT — mede o elemento renderizado (a página inteira, com o shell)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Item Indicadores na navegação', () => {
  function renderizarShell(permissoes: string[]) {
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes },
      carregandoSessao: false,
    })

    return render(
      <QueryClientProvider client={queryClient}>
        {/* o app real envolve o shell no ProvedorToast (app.tsx) — o sino usa usarToast */}
        <ProvedorToast>
          <MemoryRouter initialEntries={['/agenda']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/agenda" element={<p>Conteúdo da agenda</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
  }

  it('deve mostrar o item com QUALQUER permissão de módulo dono', () => {
    // ARRANGE + ACT — só a vista financeira (dono: fluxo_caixa — totais-do-caixa) basta
    renderizarShell(['fluxo_caixa.ver'])

    // ASSERT
    expect(screen.getByRole('link', { name: 'Indicadores' })).toBeInTheDocument()
  })

  it('deve esconder o item de quem não tem nenhuma permissão dona', () => {
    // ARRANGE + ACT — experiência apenas: o servidor continua respondendo 403.
    renderizarShell(['evolucoes.ver', 'lancamentos.ver'])

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Indicadores' })).not.toBeInTheDocument()
  })
})

describe('Visão geral — "Para os números ficarem certos" (change inicio-dos-indicadores)', () => {
  const NOTIFICACOES_ZERADAS = notificacoesComItens({ desmarque: 0, pacotes: 0, evolucoes: 0, atrasos: 0 })

  function servirPaineis(agenda: Parameters<typeof painelDaAgendaFicticio>[0] = {}) {
    const anotados = paineisQueAnotam({ agenda: painelDaAgendaFicticio(agenda) })
    servidor.use(
      handlerDeConfiguracao,
      ...anotados.handlers,
      msw.get('/api/notificacoes', () => HttpResponse.json(NOTIFICACOES_ZERADAS)),
    )

    return anotados
  }

  it('deve destacar os profissionais sem horário e levar a Profissionais quem pode cadastrar', async () => {
    // ARRANGE — o caso da produção: 9 dos 20 profissionais com sessão têm horário
    servirPaineis({ ocupacao: { atual: 0.16, anterior: null, profissionais_com_grade: 9, profissionais: 20 } })

    // ACT
    renderizar([...TODAS, 'profissionais.ver', 'profissionais.editar'])

    // ASSERT — o número no TEXTO (nunca só no ícone) e o caminho
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    expect(regras).toHaveTextContent('Só 9 de 20 profissionais com sessão têm horário de atendimento; os outros ficam fora da ocupação.')
    expect(within(regras).getByRole('link', { name: 'Cadastrar os horários em Profissionais' })).toHaveAttribute('href', '/profissionais')
  })

  it('deve dizer a quem pedir, sem link, para quem não pode cadastrar os horários', async () => {
    // ARRANGE
    servirPaineis({ ocupacao: { atual: 0.16, anterior: null, profissionais_com_grade: 9, profissionais: 20 } })

    // ACT — vê Profissionais, mas sem `profissionais.editar`: o link levaria a uma tela onde ela não
    // resolve nada
    renderizar([...TODAS, 'profissionais.ver'])

    // ASSERT
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    expect(regras).toHaveTextContent('Peça a quem administra o sistema para cadastrar os horários.')
    expect(within(regras).queryByRole('link', { name: 'Cadastrar os horários em Profissionais' })).not.toBeInTheDocument()
  })

  it('deve contar as sessões que já passaram sem baixa, no plural e no singular', async () => {
    // ARRANGE + ACT — 176 sem baixa
    servirPaineis({ sem_baixa: 176 })
    const { unmount } = renderizar([...TODAS, 'agenda.editar'])

    // ASSERT
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    expect(regras).toHaveTextContent('176 sessões que já passaram estão sem baixa e não contam como realizadas.')
    expect(within(regras).getByRole('link', { name: 'Dar baixa na Agenda' })).toHaveAttribute('href', '/agenda')

    // ARRANGE + ACT — uma só
    unmount()
    queryClient.clear()
    servirPaineis({ sem_baixa: 1 })
    renderizar(TODAS)

    // ASSERT
    expect(await screen.findByRole('region', { name: 'Para os números ficarem certos' })).toHaveTextContent(
      '1 sessão que já passou está sem baixa e não conta como realizada.',
    )
  })

  it('deve mostrar as regras sem destaque quando tudo está em ordem', async () => {
    // ARRANGE — todos com horário e nenhuma sessão sem baixa
    servirPaineis({ ocupacao: { atual: 0.87, anterior: 0.91, profissionais_com_grade: 12, profissionais: 12 }, sem_baixa: 0 })

    // ACT
    renderizar([...TODAS, 'profissionais.ver', 'profissionais.editar', 'agenda.editar'])

    // ASSERT — as frases da regra cumprida, e nenhum caminho de conserto
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    expect(regras).toHaveTextContent('Todo profissional com sessão tem horário de atendimento: a ocupação conta todos.')
    expect(regras).toHaveTextContent('Toda sessão que já passou tem baixa: as realizadas estão contadas.')
    expect(within(regras).queryByRole('link', { name: 'Cadastrar os horários em Profissionais' })).not.toBeInTheDocument()
    expect(within(regras).queryByRole('link', { name: 'Dar baixa na Agenda' })).not.toBeInTheDocument()
    expect(regras).not.toHaveTextContent(/Só \d/)
  })

  it('deve mostrar só o caixa e o início das comparações a quem vê o dinheiro, mas não a agenda', async () => {
    // ARRANGE
    servirPaineis({ sem_baixa: 176 })

    // ACT
    renderizar(['fluxo_caixa.ver'])

    // ASSERT
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    expect(within(regras).getAllByRole('listitem')).toHaveLength(2)
    expect(regras).toHaveTextContent('O dinheiro é só o que foi lançado no caixa: lance todo recebimento.')
    expect(regras).toHaveTextContent('Os indicadores contam e comparam a partir de 1º de setembro de 2026.')
    expect(regras).not.toHaveTextContent('horário')
    expect(regras).not.toHaveTextContent('baixa')
  })

  it('deve dizer a data dos indicadores e levar a Configurações quem pode mudá-la', async () => {
    // ARRANGE
    servirPaineis()

    // ACT
    renderizar([...TODAS, 'configuracoes.ver', 'configuracoes.editar'])

    // ASSERT
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    expect(regras).toHaveTextContent('Os indicadores contam e comparam a partir de 1º de setembro de 2026.')
    expect(within(regras).getByRole('link', { name: /^Mudar em Configurações\s›\sClínica$/ })).toHaveAttribute('href', '/configuracoes')
  })

  it('deve mostrar só a linha do início no mês anterior a ele, sem contradizer o "Sem dados" dos cartões', async () => {
    // ARRANGE — setembro, com os indicadores contando a partir de 1º de outubro (gate r1, design-qa)
    const setembro = periodoFicticio('2026-09', { ate: '2026-09-30', parcial: false, comparado_de: '2026-08-01', comparado_ate: '2026-08-31' })
    const outubro = { periodo: setembro, inicio_historico: '2026-10', inicio_historico_dia: '2026-10-01' }
    const { handlers } = paineisQueAnotam({
      dinheiro: painelDoDinheiroFicticio(outubro),
      agenda: painelDaAgendaFicticio({ ...outubro, ocupacao: { atual: null, anterior: null, profissionais_com_grade: 8, profissionais: 10 }, sem_baixa: 41 }),
    })
    servidor.use(handlerDeConfiguracao, ...handlers, msw.get('/api/notificacoes', () => HttpResponse.json(NOTIFICACOES_ZERADAS)))

    // ACT
    renderizar(TODAS, '/indicadores?mes=2026-09')

    // ASSERT
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    expect(within(regras).getAllByRole('listitem')).toHaveLength(1)
    expect(regras).toHaveTextContent('Os indicadores contam e comparam a partir de 1º de outubro de 2026.')
    expect(regras).not.toHaveTextContent('8 de 10')
    expect(regras).not.toHaveTextContent('sem baixa')
  })

  it('deve dizer a quem pedir, sem link, a quem vê mas não pode dar baixa nem mudar a data', async () => {
    // ARRANGE — só os `.ver`: os links levariam a telas onde a pessoa não resolve nada
    servirPaineis({ sem_baixa: 176 })

    // ACT
    renderizar([...TODAS, 'configuracoes.ver'])

    // ASSERT
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    expect(regras).toHaveTextContent('Peça a quem atende para dar baixa nas sessões.')
    expect(regras).toHaveTextContent('Quem administra o sistema muda essa data.')
    expect(within(regras).queryByRole('link')).not.toBeInTheDocument()
  })

  it('não deve mostrar a linha do caixa a quem não vê o dinheiro', async () => {
    // ARRANGE
    servirPaineis()

    // ACT
    renderizar(['agenda.ver'])

    // ASSERT
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    expect(regras).toHaveTextContent('Os indicadores contam e comparam')
    expect(regras).not.toHaveTextContent('caixa')
  })

  it('não deve fazer requisição própria: cada painel é buscado UMA vez, pelos cartões', async () => {
    // ARRANGE
    const { chamadas } = servirPaineis({ sem_baixa: 3 })

    // ACT
    renderizar(TODAS)
    await screen.findByRole('region', { name: 'Para os números ficarem certos' })
    await screen.findByText(/até hoje, comparado com/)

    // ASSERT — uma chamada por frente, com ou sem o bloco
    for (const frente of ['dinheiro', 'agenda', 'pacientes', 'equipe']) {
      expect(chamadas.filter((chamada) => chamada.startsWith(`${frente}?`))).toEqual([`${frente}?mes=${MES_DO_PAINEL}`])
    }
  })

  it('não deve ter violação de acessibilidade', async () => {
    // ARRANGE
    servirPaineis({ ocupacao: { atual: 0.16, anterior: null, profissionais_com_grade: 9, profissionais: 20 }, sem_baixa: 176 })

    // ACT
    renderizar([...TODAS, 'profissionais.ver', 'profissionais.editar', 'agenda.editar', 'configuracoes.ver', 'configuracoes.editar'])
    const regras = await screen.findByRole('region', { name: 'Para os números ficarem certos' })

    // ASSERT
    expect(await axe(regras)).toHaveNoViolations()
  })
})
