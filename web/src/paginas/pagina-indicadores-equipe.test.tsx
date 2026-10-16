import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ShellDeIndicadores } from '@/componentes/indicadores/shell-de-indicadores'
import { queryClient } from '@/lib/query-client'
import { PaginaIndicadoresEquipe, RedirecionarParaEquipe } from '@/paginas/pagina-indicadores-equipe'
import { useAuthStore } from '@/stores/auth-store'
import { MES_DO_PAINEL, painelDaEquipeFicticio, paineisQueAnotam } from '@/test/dados-paineis'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { IndicadoresDeAtendimentos, PainelDaEquipe, ProducaoDoMes } from '@/tipos'

expect.extend(toHaveNoViolations)

const AS_DUAS = ['agenda.ver', 'atendimentos.ver']

const handlerDeConfiguracao = msw.get('/api/agenda/configuracoes', () => HttpResponse.json({ configuracoes: [] }))

const atendimentos: IndicadoresDeAtendimentos = {
  mes: MES_DO_PAINEL,
  total: 2,
  por_especialidade: [
    { especialidade: { id: 1, nome: 'Fonoaudiologia Fictícia' }, total: 1 },
    { especialidade: { id: 2, nome: 'Psicologia Fictícia' }, total: 1 },
  ],
  por_convenio: [
    { convenio: null, total: 1 },
    { convenio: { id: 3, nome: 'Convênio Fictício' }, total: 1 },
  ],
}

const producao: ProducaoDoMes = {
  de: `${MES_DO_PAINEL}-01`,
  ate: `${MES_DO_PAINEL}-31`,
  linhas: [
    { profissional: { id: 2, nome: 'Psico Fictícia' }, atendimentos: 4, sessoes_consumidas: 4, evolucoes_preenchidas: 3 },
    { profissional: { id: 1, nome: 'Fono Fictícia' }, atendimentos: 9, sessoes_consumidas: 8, evolucoes_preenchidas: 7 },
  ],
}

function renderizar({
  painel = painelDaEquipeFicticio(),
  permissoes = AS_DUAS,
  caminho = `/indicadores/equipe?mes=${MES_DO_PAINEL}`,
}: { painel?: PainelDaEquipe; permissoes?: string[]; caminho?: string } = {}) {
  const anotador = paineisQueAnotam({ equipe: painel })
  servidor.use(
    handlerDeConfiguracao,
    ...anotador.handlers,
    msw.get('/api/indicadores/atendimentos', () => HttpResponse.json(atendimentos)),
    msw.get('/api/relatorios/producao-por-profissional', () => HttpResponse.json(producao)),
  )
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  const resultado = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route element={<ShellDeIndicadores />}>
            <Route path="/indicadores" element={<div />} />
            <Route path="/indicadores/equipe" element={<PaginaIndicadoresEquipe />} />
            <Route path="/indicadores/produtividade" element={<RedirecionarParaEquipe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { ...resultado, chamadas: anotador.chamadas }
}

async function abaPronta(): Promise<void> {
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Equipe no mês' })).not.toBeInTheDocument())
  await screen.findByText('Fono Fictícia')
}

beforeEach(() => {
  queryClient.clear()
})

describe('Aba Equipe — por profissional, com as definições e a pendência de horário', () => {
  it('deve seguir a ordem: a linha do período, cartões, o gráfico dos atendimentos e as tabelas', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()

    // ASSERT
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((titulo) => titulo.textContent)
    expect(titulos).toEqual([
      'Evoluções em dia',
      'Evoluções atrasadas',
      'Sem grade',
      'Fonoaudiologia Fictícia é a especialidade com mais atendimentos',
      'Por profissional',
      'Produção do mês por profissional',
    ])
    // a linha do período abre a aba — e nenhuma frase de resumo (D8)
    const periodo = screen.getByText('De 1º a 5 de outubro de 2026, até hoje, comparado com 1º a 5 de setembro de 2026.')
    expect(periodo.compareDocumentPosition(screen.getByRole('region', { name: 'Evoluções em dia' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/das sessões realizadas no período têm evolução em dia/)).not.toBeInTheDocument()
  })

  it('deve listar cada profissional com ocupação, realizadas, faltas e evoluções — e ligar ao detalhe dele', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()
    const tabela = screen.getByRole('table', { name: 'Ocupação, sessões e evoluções por profissional no período' })

    // ASSERT
    const linha = within(tabela).getByRole('link', { name: 'Profissional Fictício' }).closest('tr') as HTMLElement
    expect(within(linha).getByText('80%')).toBeInTheDocument()
    expect(within(linha).getByText('100')).toBeInTheDocument()
    expect(within(linha).getByText('95%')).toBeInTheDocument()
    expect(within(tabela).getByRole('link', { name: 'Profissional Fictício' })).toHaveAttribute(
      'href',
      `/indicadores/produtividade/7?mes=${MES_DO_PAINEL}`,
    )
  })

  it('deve abrir o painel do profissional pela linha, no mesmo mês, para quem abre a ficha', async () => {
    // ARRANGE + ACT — a ficha (o painel do mês) abre com `profissionais.ver` (painel-do-profissional, D6)
    renderizar({ permissoes: [...AS_DUAS, 'profissionais.ver'] })
    await abaPronta()
    const tabela = screen.getByRole('table', { name: 'Ocupação, sessões e evoluções por profissional no período' })

    // ASSERT — o nome continua levando ao detalhe da produtividade; a porta nova diz de quem é o painel
    expect(within(tabela).getByRole('link', { name: 'Abrir o painel de Profissional Fictício' })).toHaveAttribute(
      'href',
      `/profissionais/7?mes=${MES_DO_PAINEL}`,
    )
  })

  it('não deve oferecer o painel de um colega a quem não abre a ficha dele', async () => {
    // ARRANGE + ACT — sem `profissionais.ver` e sem vínculo: a rota da ficha negaria, então a porta some
    renderizar()
    await abaPronta()

    // ASSERT
    expect(screen.queryByRole('link', { name: /Abrir o painel/ })).not.toBeInTheDocument()
  })

  it('deve mostrar o profissional sem horário como PENDÊNCIA, sem porcentagem de ocupação', async () => {
    // ARRANGE + ACT — sem `profissionais.editar`, a pendência aparece, a porta não
    renderizar()
    await abaPronta()
    const tabela = screen.getByRole('table', { name: 'Ocupação, sessões e evoluções por profissional no período' })
    const linha = within(tabela).getByRole('link', { name: 'Profissional Fictícia Sem Grade' }).closest('tr') as HTMLElement

    // ASSERT — nada de 0% nem de travessão no lugar da grade (a 1ª célula é o cabeçalho da linha)
    const celulaDaOcupacao = within(linha).getAllByRole('cell')[0]
    // "Sem grade" cobre os dois casos (CR-IND-14): sem horário, ou com horário e sem especialidade
    expect(celulaDaOcupacao).toHaveTextContent('Sem grade: falta horário ou especialidade')
    expect(celulaDaOcupacao).not.toHaveTextContent('%')
    expect(within(linha).queryByRole('link', { name: 'Abrir o cadastro' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Sem grade' })).toHaveTextContent('1')
  })

  it('deve oferecer o caminho para cadastrar o horário a quem edita profissionais', async () => {
    // ARRANGE + ACT
    renderizar({ permissoes: [...AS_DUAS, 'profissionais.editar'] })
    await abaPronta()

    // ASSERT
    expect(screen.getByRole('link', { name: 'Abrir o cadastro' })).toHaveAttribute('href', '/profissionais/9')
  })

  it('deve explicar "capacidade" e "produtividade" no "i", pelo teclado', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    await abaPronta()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Como se calcula: Capacidade' }))

    // ASSERT
    expect(await screen.findByRole('dialog', { name: 'Como se calcula: Capacidade' })).toHaveTextContent(
      'O que cabe na grade do mês: os horários cadastrados, menos feriados e bloqueios.',
    )

    // ACT — fecha e abre a outra
    await usuario.keyboard('{Escape}')
    await usuario.click(screen.getByRole('button', { name: 'Como se calcula: Produtividade' }))

    // ASSERT
    expect(await screen.findByRole('dialog', { name: 'Como se calcula: Produtividade' })).toHaveTextContent(
      'O que foi realizado ÷ a capacidade da grade.',
    )
  })

  it('deve nomear cada linha pelo profissional — o "Abrir o cadastro" fica associado ao nome', async () => {
    // ARRANGE + ACT — a 1ª célula é o CABEÇALHO DA LINHA (A11Y-IND-02)
    renderizar({ permissoes: [...AS_DUAS, 'profissionais.editar'] })
    await abaPronta()
    const tabela = screen.getByRole('table', { name: 'Ocupação, sessões e evoluções por profissional no período' })

    // ASSERT
    const cabecalhos = within(tabela).getAllByRole('rowheader')
    expect(cabecalhos.map((celula) => celula.textContent)).toEqual([
      expect.stringContaining('Profissional Fictício'),
      expect.stringContaining('Profissional Fictícia Sem Grade'),
    ])
    expect(cabecalhos[1]).toHaveAttribute('scope', 'row')
  })

  it('deve dizer a JANELA de cada tabela: o período até hoje em cima, o mês inteiro embaixo', async () => {
    // ARRANGE + ACT — outubro em curso, até o dia 5
    renderizar()
    await abaPronta()

    // ASSERT — sem isso, os dois números do mesmo profissional pareciam brigar (CR-IND-03)
    expect(screen.getByRole('region', { name: 'Por profissional' })).toHaveTextContent('De 1º a 5 de outubro, até hoje')
    expect(screen.getByRole('region', { name: 'Produção do mês por profissional' })).toHaveTextContent(
      'O mês inteiro de outubro de 2026',
    )
  })

  it('deve dizer, no vazio, que não há profissional VISÍVEL no seu recorte (CR-IND-16)', async () => {
    // ARRANGE — o servidor não manda nenhuma linha (a escopada sem sessão, um recorte sem ninguém)
    renderizar({ painel: { ...painelDaEquipeFicticio(), profissionais: [] } })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Equipe no mês' })).not.toBeInTheDocument())

    // ASSERT — "nenhum profissional teve sessão" seria falso para a clínica inteira
    expect(await screen.findByText(/Nenhum profissional visível para você teve sessão no período/)).toBeInTheDocument()
  })

  it('deve mostrar só a linha da profissional escopada quando o servidor manda só ela (D11)', async () => {
    // ARRANGE — o escopo é do servidor: a tela mostra o que veio
    const painel = painelDaEquipeFicticio()
    renderizar({ painel: { ...painel, profissionais: [painel.profissionais[0]] } })
    await abaPronta()

    // ASSERT
    const tabela = screen.getByRole('table', { name: 'Ocupação, sessões e evoluções por profissional no período' })
    expect(within(tabela).getAllByRole('row')).toHaveLength(2)
  })

  it('deve dizer no cartão das atrasadas o prazo e quantas ainda esperam — sem contradizer o sino', async () => {
    // ARRANGE — nenhuma atrasada, mas 255 sem evolução (o mesmo número do "Pede atenção")
    const painel = painelDaEquipeFicticio()
    renderizar({
      painel: { ...painel, evolucoes: { ...painel.evolucoes, atrasadas: 0, profissionais_com_atraso: 0 } },
      permissoes: [...AS_DUAS, 'evolucoes.ver'],
    })
    await abaPronta()

    // ASSERT
    const cartao = screen.getByRole('region', { name: 'Evoluções atrasadas' })
    expect(within(cartao).getByText('passaram do prazo de 3 dias')).toBeInTheDocument()
    expect(cartao).toHaveTextContent('255 sessões ainda sem evolução, todas dentro do prazo.')
    expect(cartao).not.toHaveTextContent('Nenhuma evolução atrasada')
    // ainda há o que escrever: a porta continua
    expect(within(cartao).getByRole('link', { name: 'Abrir as evoluções' })).toHaveAttribute('href', '/evolucoes')
  })

  it('deve abrir as evoluções atrasadas como porta a quem vê as evoluções', async () => {
    // ARRANGE + ACT
    renderizar({ permissoes: [...AS_DUAS, 'evolucoes.ver'] })
    await abaPronta()

    // ASSERT
    expect(screen.getByRole('link', { name: 'Abrir as evoluções' })).toHaveAttribute('href', '/evolucoes')
  })

  it('não deve ter violações de acessibilidade', async () => {
    // ARRANGE + ACT
    const { container } = renderizar({ permissoes: [...AS_DUAS, 'profissionais.editar'] })
    await abaPronta()
    await screen.findByRole('link', { name: /atendimentos finalizados no mês/ })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Aba Equipe — a produção e os atendimentos (vieram da Visão geral)', () => {
  it('deve listar a produção POR profissional, quem mais produziu primeiro, com a régua das sessões', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()
    const tabela = screen.getByRole('table', { name: 'Produção do mês por profissional' })

    // ASSERT
    const nomes = within(tabela).getAllByRole('link').map((link) => link.textContent)
    expect(nomes).toEqual(['Fono Fictícia', 'Psico Fictícia'])
    expect(within(tabela).getByRole('link', { name: 'Fono Fictícia' })).toHaveAttribute(
      'href',
      `/indicadores/profissionais/1?mes=${MES_DO_PAINEL}`,
    )
    expect(screen.getByText(/sessões consumidas \(contadas pelo dia da sessão\)/)).toBeInTheDocument()
  })

  it('deve linkar o total e as quebras de atendimentos — "Sem convênio" fica sem porta', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()

    // ASSERT — o TOTAL abre o mês inteiro; cada quebra, a sua dimensão (ids, nunca nome)
    expect(await screen.findByRole('link', { name: /atendimentos finalizados no mês/ })).toHaveAttribute(
      'href',
      `/indicadores/itens?origem=atendimentos&mes=${MES_DO_PAINEL}`,
    )
    expect(screen.getByRole('link', { name: /Fonoaudiologia Fictícia/ })).toHaveAttribute(
      'href',
      `/indicadores/itens?origem=atendimentos&especialidade_id=1&mes=${MES_DO_PAINEL}`,
    )
    expect(screen.getByRole('link', { name: /Convênio Fictício/ })).toHaveAttribute(
      'href',
      `/indicadores/itens?origem=atendimentos&convenio_id=3&mes=${MES_DO_PAINEL}`,
    )
    expect(screen.getByText('Sem convênio')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Sem convênio/ })).not.toBeInTheDocument()
  })
})

describe('Link antigo da Produtividade', () => {
  it('deve levar /indicadores/produtividade?mes= à aba Equipe do MESMO mês', async () => {
    // ARRANGE + ACT — o link copiado numa mensagem antes da mudança
    // agosto, e não o mês corrente: sem `?mes=` o shell abriria no mês de HOJE, e um redirecionamento
    // que perdesse o parâmetro passaria despercebido justamente em outubro
    const { chamadas } = renderizar({ permissoes: [...AS_DUAS, 'fluxo_caixa.ver'], caminho: '/indicadores/produtividade?mes=2026-08' })

    // ASSERT — a aba corrente é a Equipe, e o painel foi pedido para outubro
    const barra = await screen.findByRole('navigation', { name: 'Seções dos indicadores' })
    await waitFor(() => expect(within(barra).getByRole('link', { name: 'Equipe' })).toHaveAttribute('aria-current', 'page'))
    await waitFor(() => expect(chamadas).toContain('equipe?mes=2026-08'))
    expect(screen.getByText('agosto de 2026', { selector: '[aria-live]' })).toBeInTheDocument()
  })
})
