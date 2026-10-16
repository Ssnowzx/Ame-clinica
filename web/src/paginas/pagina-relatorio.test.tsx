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
import { envelopeFicticio, envelopeSinteticoFicticio, handlersDeRelatorios } from '@/test/dados-relatorios'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { EnvelopeDeRelatorio, Servico } from '@/tipos'

expect.extend(toHaveNoViolations)

const URL_DE_JUNHO = '/relatorios/agendamentos?de=2026-06-01&ate=2026-06-30&profissional_id=1'

/** As chamadas ao relatório, pela query string — o que a tela PEDIU ao servidor. */
function servirRelatorio(envelope: EnvelopeDeRelatorio = envelopeFicticio(), status = 200): string[] {
  const chamadas: string[] = []
  // o handler que GRAVA vem primeiro: no MSW o primeiro da lista vence, e o genérico da
  // fixture o esconderia em silêncio (foi assim que `chamadas` ficou vazio na 1ª rodada)
  servidor.use(
    msw.get('/api/relatorios/:slug', ({ request }) => {
      chamadas.push(new URL(request.url).search)
      return status === 200 ? HttpResponse.json(envelope) : HttpResponse.json({ message: 'Erro' }, { status })
    }),
    ...handlersDaAgenda(),
    ...handlersDeRelatorios(envelope),
    msw.get('/api/convenios', () => HttpResponse.json([{ id: 1, nome: 'Convênio Fictício' }])),
  )

  return chamadas
}

function renderizar(caminho: string, permissoes: string[] = ['agenda.ver', 'convenios.ver']) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path="/relatorios/:slug" element={<PaginaRelatorio />} />
          <Route path="/relatorios" element={<h1>Catálogo</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** HOJE fixo na parede da clínica (America/Sao_Paulo): 3 de setembro de 2026. */
function fixarHoje() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-03T12:00:00Z'))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PaginaRelatorio — a URL é o recorte', () => {
  it('deve gerar ao abrir a URL com parâmetros e formatar cada coluna pelo tipo', async () => {
    // ARRANGE
    const chamadas = servirRelatorio()

    // ACT
    const { container } = renderizar(URL_DE_JUNHO)

    // ASSERT — a chamada leva exatamente o recorte da URL
    const tabela = await screen.findByRole('table', { name: 'Agendamentos: 3 linhas' })
    expect(chamadas).toEqual(['?de=2026-06-01&ate=2026-06-30&profissional_id=1'])
    expect(within(tabela).getByText('R$ 1.234,50')).toBeInTheDocument()
    expect(within(tabela).getByText('01/06/2026')).toBeInTheDocument()
    expect(within(tabela).getByText('75%')).toBeInTheDocument()
    // contagem e período por extenso; o rodapé com o total
    expect(screen.getByText('3 linhas')).toBeInTheDocument()
    // por extenso na tela E no cabeçalho do papel — ao menos uma vez fora da folha
    expect(screen.getAllByText(/1º a 30 de junho de 2026/).length).toBeGreaterThan(0)
    expect(within(tabela).getByRole('rowheader', { name: 'Total' })).toBeInTheDocument()
    // o formulário nasceu da URL: o profissional está escolhido
    expect(screen.getByLabelText('Profissional')).toHaveValue('1')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve pôr no cabeçalho impresso o título, o período e os filtros aplicados', async () => {
    // ARRANGE
    servirRelatorio()

    // ACT
    renderizar(URL_DE_JUNHO)
    await screen.findByRole('table', { name: 'Agendamentos: 3 linhas' })

    // ASSERT — o papel diz de que recorte ele é; formulário e navegação ficam fora dele
    const folha = document.querySelector('[data-impresso]')
    expect(folha).not.toBeNull()
    expect(folha).toHaveTextContent('Agendamentos — 1º a 30 de junho de 2026')
    expect(folha).toHaveTextContent('Profissional: Profissional Fictício A')
    expect(folha?.querySelector('form')).toBeNull()
    expect(document.querySelector('form')).toHaveAttribute('data-nao-imprimir')
    expect(document.querySelector('header')).toHaveAttribute('data-nao-imprimir')
    expect(screen.getByRole('button', { name: 'Imprimir' })).toHaveAttribute('data-nao-imprimir')
  })

  it('deve renderizar o sintético puro como UMA tabela com uma linha por grupo e o total geral', async () => {
    // ARRANGE — grupos sem linhas (só totais): conferido ao vivo que um bloco por grupo virava
    // título + tabela sem corpo + total para dizer um número
    const base = envelopeSinteticoFicticio()
    servirRelatorio({
      ...base,
      colunas: [
        { chave: 'grupo', rotulo: 'Status', tipo: 'texto' },
        { chave: 'quantidade', rotulo: 'Quantidade', tipo: 'numero' },
      ],
      grupos: base.grupos!.map((grupo) => ({ ...grupo, linhas: [] })),
      contagem: 2,
    })

    // ACT
    renderizar('/relatorios/agendamentos?de=2026-06-01&ate=2026-06-30&resultado=sintetico&dividir_por=status')

    // ASSERT
    const tabela = await screen.findByRole('table', { name: 'Agendamentos: 2 grupos' })
    const linhaFinalizado = within(tabela).getByText('Finalizado').closest('tr')
    expect(linhaFinalizado).not.toBeNull()
    expect(within(linhaFinalizado as HTMLElement).getByText('12')).toBeInTheDocument()
    expect(within(tabela).getByText('Em Aberto')).toBeInTheDocument()
    expect(within(tabela).getByRole('rowheader', { name: 'Total geral' })).toBeInTheDocument()
    expect(within(tabela).getByText('15')).toBeInTheDocument()
    expect(screen.getByText('2 grupos')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Finalizado' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Dividir por')).toHaveValue('status')
  })

  it('deve manter os blocos por grupo quando os grupos TÊM linhas (lista de presença)', async () => {
    // ARRANGE — a fixture padrão: grupos COM linhas (profissional dentro do status)
    servirRelatorio(envelopeSinteticoFicticio())

    // ACT
    renderizar('/relatorios/agendamentos?de=2026-06-01&ate=2026-06-30&resultado=sintetico&dividir_por=status')

    // ASSERT
    const finalizado = await screen.findByRole('region', { name: 'Finalizado' })
    expect(within(finalizado).getByRole('rowheader', { name: 'Total de Finalizado' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Total geral' })).toBeInTheDocument()
  })

  it('deve explicar o vazio pelo recorte e limpar os filtros mantendo o período', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const chamadas = servirRelatorio(envelopeFicticio({ linhas: [], contagem: 0, totais: {} }))

    // ACT
    renderizar(URL_DE_JUNHO)

    // ASSERT — o recorte, nomeado; e a saída
    expect(
      await screen.findByRole('heading', {
        name: 'Nenhum registro para 1º a 30 de junho de 2026 com profissional Profissional Fictício A.',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Amplie o período ou limpe os filtros.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Imprimir' })).not.toBeInTheDocument()
    await usuaria.click(screen.getByRole('button', { name: 'Gerar sem os filtros' }))
    await waitFor(() => {
      expect(chamadas).toContain('?de=2026-06-01&ate=2026-06-30')
    })
  })

  it('deve mostrar o erro com tentar de novo, e tentar de novo pede outra vez', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const chamadas = servirRelatorio(envelopeFicticio(), 500)

    // ACT
    renderizar(URL_DE_JUNHO)
    // 5xx é falha transitória: o cliente tenta UMA vez mais (1 s) antes de desistir
    const alerta = await screen.findByRole('alert', {}, { timeout: 4000 })

    // ASSERT
    expect(alerta).toHaveTextContent('Não foi possível gerar o relatório.')
    const antes = chamadas.length
    await usuaria.click(within(alerta).getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => {
      expect(chamadas.length).toBeGreaterThan(antes)
    }, { timeout: 4000 })
  })

  it('deve dizer que não há acesso quando o servidor recusa com 403', async () => {
    // ARRANGE
    servirRelatorio(envelopeFicticio(), 403)

    // ACT
    renderizar(URL_DE_JUNHO)

    // ASSERT
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem acesso a este relatório.')
  })
})

describe('PaginaRelatorio — o formulário declarado', () => {
  it('deve preencher "mês passado" com o mês anterior inteiro, no fuso da clínica', async () => {
    // ARRANGE — hoje é 3 de setembro de 2026 em São Paulo
    fixarHoje()
    const usuaria = userEvent.setup()
    servirRelatorio()
    renderizar('/relatorios/agendamentos')
    await screen.findByLabelText('Profissional')

    // ACT
    await usuaria.selectOptions(screen.getByLabelText('Atalho de período'), 'mes-passado')

    // ASSERT — 1º a 31 de agosto, no formato que o balcão lê
    expect(screen.getByLabelText('De (início do período)')).toHaveValue('01/08/2026')
    expect(screen.getByLabelText('Até (fim do período)')).toHaveValue('31/08/2026')
  })

  it('deve desabilitar "Gerar" acima de 366 dias, dizendo o teto — e não pedir nada ao servidor', async () => {
    // ARRANGE — 401 dias
    const chamadas = servirRelatorio()

    // ACT
    renderizar('/relatorios/agendamentos?de=2025-01-01&ate=2026-02-05')
    const gerar = await screen.findByRole('button', { name: 'Gerar' })

    // ASSERT — inerte MAS focável, com a razão ligada por `aria-describedby`
    expect(gerar).toHaveAttribute('aria-disabled', 'true')
    const razao = screen.getByText('O período tem 401 dias; o máximo é 366 dias (um ano).')
    expect(gerar.getAttribute('aria-describedby')).toBe(razao.id)
    expect(chamadas).toEqual([])
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('deve nascer com "este mês" e, ao Gerar, escrever a URL e pedir o relatório', async () => {
    // ARRANGE — sem parâmetros na URL: o resultado espera o Gerar
    fixarHoje()
    const usuaria = userEvent.setup()
    const chamadas = servirRelatorio()
    renderizar('/relatorios/agendamentos')
    expect(await screen.findByText('Preencha os filtros e clique em Gerar.')).toBeInTheDocument()
    expect(chamadas).toEqual([])

    // ACT — escolhe um status e gera
    await usuaria.selectOptions(await screen.findByLabelText('Status'), '3')
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT — o recorte foi para a URL e daí para o servidor, com o mês corrente inteiro
    await screen.findByRole('table', { name: 'Agendamentos: 3 linhas' })
    expect(chamadas).toEqual(['?de=2026-09-01&ate=2026-09-30&status_id=3&resultado=analitico'])
  })

  it('deve ir para "não existe" com a volta quando o slug não está no catálogo', async () => {
    // ARRANGE
    servirRelatorio()

    // ACT
    renderizar('/relatorios/nao-existe')

    // ASSERT
    expect(screen.getByRole('heading', { name: 'Este relatório não existe.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver todos os relatórios' })).toHaveAttribute('href', '/relatorios')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('deve negar o acesso quando falta QUALQUER uma das permissões do relatório', () => {
    // ARRANGE — Evoluções exige evolucoes.ver E atendimentos.ver; a usuária tem só a primeira
    servirRelatorio()

    // ACT
    renderizar('/relatorios/evolucoes', ['evolucoes.ver'])

    // ASSERT — nem formulário, nem consulta
    expect(screen.getByText('Você não tem acesso a esta tela')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gerar' })).not.toBeInTheDocument()
  })
})

/**
 * O formulário é o que a API ACEITA: nome de parâmetro, valores e obrigatoriedade saem da
 * declaração do relatório no catálogo — um campo a mais aqui é um 422 garantido.
 */
describe('PaginaRelatorio — o recorte que cada relatório aceita', () => {
  /** Os parâmetros da última chamada ao servidor. */
  function ultimaChamada(chamadas: string[]): URLSearchParams {
    return new URLSearchParams(chamadas.at(-1) ?? '')
  }

  it('deve gerar "Pacientes" nas ativas SEM período — nem campo na tela, nem parâmetro na chamada', async () => {
    // ARRANGE — a situação padrão do servidor é "ativos", que não tem recorte de data
    const chamadas = servirRelatorio(envelopeFicticio({ slug: 'pacientes', titulo: 'Pacientes', periodo: null }))

    // ACT
    renderizar('/relatorios/pacientes', ['pacientes.ver'])
    await screen.findByRole('table', { name: 'Pacientes: 3 linhas' })

    // ASSERT — gerou de cara, sem período; o campo de data nem existe
    expect(ultimaChamada(chamadas).has('de')).toBe(false)
    expect(screen.queryByLabelText('De (início do período)')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Situação')).toHaveValue('ativos')
  })

  it('deve mostrar o período nas cadastradas no período e NÃO pedir nada sem as datas', async () => {
    // ARRANGE — link pela metade: a situação exige o período e ele não veio
    const chamadas = servirRelatorio()

    // ACT
    renderizar('/relatorios/pacientes?situacao=cadastrados_no_periodo', ['pacientes.ver'])
    await screen.findByLabelText('Situação')

    // ASSERT — a razão do que falta, e nenhuma chamada fadada ao 422
    expect(screen.getByLabelText('De (início do período)')).toBeInTheDocument()
    expect(screen.getByText(/Informe o início e o fim do período\./)).toBeInTheDocument()
    expect(chamadas).toEqual([])
  })

  it('deve desabilitar "Gerar" nas cadastradas no período quando o período estoura o teto', async () => {
    // ARRANGE — 401 dias, agora sob a situação que exige o período
    const chamadas = servirRelatorio()

    // ACT
    renderizar('/relatorios/pacientes?situacao=cadastrados_no_periodo&de=2025-01-01&ate=2026-02-05', ['pacientes.ver'])
    const gerar = await screen.findByRole('button', { name: 'Gerar' })

    // ASSERT
    expect(gerar).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('O período tem 401 dias; o máximo é 366 dias (um ano).')).toBeInTheDocument()
    expect(chamadas).toEqual([])
  })

  it('deve exigir o mês nas aniversariantes e mandá-lo como `mes`', async () => {
    // ARRANGE — hoje é 3 de setembro de 2026 na clínica
    fixarHoje()
    const usuaria = userEvent.setup()
    const chamadas = servirRelatorio(envelopeFicticio({ slug: 'pacientes', titulo: 'Pacientes', periodo: null }))

    // ACT — a URL sem `mes` não gera; o formulário nasce no mês corrente
    renderizar('/relatorios/pacientes?situacao=aniversariantes', ['pacientes.ver'])
    await screen.findByLabelText('Mês')
    expect(screen.getByText(/Escolha o mês\./)).toBeInTheDocument()
    expect(chamadas).toEqual([])
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))
    await screen.findByRole('table', { name: 'Pacientes: 3 linhas' })

    // ASSERT — mês no formato da API, e nenhum período junto
    expect(ultimaChamada(chamadas).get('mes')).toBe('2026-09')
    expect(ultimaChamada(chamadas).get('situacao')).toBe('aniversariantes')
    expect(ultimaChamada(chamadas).has('de')).toBe(false)
  })

  it('deve levar os dias só na situação "sem atendimento", com o padrão do servidor', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const chamadas = servirRelatorio(envelopeFicticio({ slug: 'pacientes', titulo: 'Pacientes', periodo: null }))

    // ACT
    renderizar('/relatorios/pacientes?situacao=sem_atendimento', ['pacientes.ver'])
    await screen.findByLabelText('Dias sem atendimento')
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))
    await screen.findByRole('table', { name: 'Pacientes: 3 linhas' })

    // ASSERT — 60 dias é o padrão declarado pela API
    expect(ultimaChamada(chamadas).get('dias')).toBe('60')
    expect(screen.queryByLabelText('Mês')).not.toBeInTheDocument()
  })

  it('deve mandar `tipo` (não `situacao`) na movimentação da agenda', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const chamadas = servirRelatorio(envelopeFicticio({ slug: 'movimentacao-da-agenda', titulo: 'Movimentação da agenda' }))

    // ACT
    renderizar('/relatorios/movimentacao-da-agenda?de=2026-06-01&ate=2026-06-30', ['auditoria.ver', 'agenda.ver'])
    await usuaria.selectOptions(await screen.findByLabelText('Tipo de movimentação'), 'remarcado')
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))
    await screen.findByRole('table', { name: 'Movimentação da agenda: 3 linhas' })

    // ASSERT — o parâmetro da API é `tipo`; `situacao` seria 422
    expect(ultimaChamada(chamadas).get('tipo')).toBe('remarcado')
    expect(ultimaChamada(chamadas).has('situacao')).toBe(false)
    expect(screen.queryByLabelText('Situação')).not.toBeInTheDocument()
  })

  it('deve mandar `ordenar` nos serviços, e não oferecer o convênio que a API não aceita', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const chamadas = servirRelatorio(envelopeFicticio({ slug: 'servicos', titulo: 'Serviços' }))

    // ACT — ordenar por valor é de quem vê o caixa (change `financeiro-sem-faturamento-total`)
    renderizar('/relatorios/servicos?de=2026-06-01&ate=2026-06-30', ['tratamentos.ver', 'fluxo_caixa.ver'])
    await usuaria.selectOptions(await screen.findByLabelText('Ordenar por'), 'valor')
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))
    await screen.findByRole('table', { name: 'Serviços: 3 linhas' })

    // ASSERT
    expect(ultimaChamada(chamadas).get('ordenar')).toBe('valor')
    expect(ultimaChamada(chamadas).has('convenio_id')).toBe(false)
    expect(screen.queryByLabelText('Convênio')).not.toBeInTheDocument()
  })

  it('deve ordenar os serviços só por quantidade, e dizer por quê, a quem não vê o caixa', async () => {
    // ARRANGE — a soma dos vendidos refaz o faturamento; a API recusa `ordenar=valor` (422)
    servirRelatorio(envelopeFicticio({ slug: 'servicos', titulo: 'Serviços' }))

    // ACT
    renderizar('/relatorios/servicos?de=2026-06-01&ate=2026-06-30', ['tratamentos.ver'])
    const ordenar = await screen.findByLabelText('Ordenar por')

    // ASSERT
    expect([...ordenar.querySelectorAll('option')].map((opcao) => opcao.textContent)).toEqual(['Quantidade'])
    expect(screen.getByText(/^Você vê as quantidades\./)).toBeInTheDocument()
  })

  it('deve explicar o vazio do filtro de paciente quando o cadastro está INATIVO', async () => {
    // ARRANGE — a TERCEIRA caixa servida pela seleção da agenda. Um motivo explicado na agenda e
    // na fila, mas não aqui, deixaria o mesmo beco aberto no relatório (achado CR-IMP-2 do gate)
    const usuario = userEvent.setup()
    servirRelatorio(envelopeFicticio({ slug: 'extrato-do-paciente', titulo: 'Extrato do paciente' }))
    servidor.use(
      msw.get('/api/agenda/selecao/pacientes', () =>
        HttpResponse.json([], { headers: { 'X-Pacientes-Inativos': '1' } }),
      ),
    )

    // ACT
    renderizar('/relatorios/extrato-do-paciente?de=2026-06-01&ate=2026-06-30', ['lancamentos.ver', 'agenda.ver'])
    await usuario.type(await screen.findByRole('combobox', { name: /Paciente/ }), 'Valmiro')

    // ASSERT
    expect(await screen.findByText(/Existe cadastro/)).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum resultado para/)).not.toBeInTheDocument()
  })

  it('deve manter o vazio de sempre no filtro de paciente quando o servidor não sinaliza', async () => {
    // ARRANGE — sem o cabeçalho, nada muda: a tela não infere existência por conta própria
    const usuario = userEvent.setup()
    servirRelatorio(envelopeFicticio({ slug: 'extrato-do-paciente', titulo: 'Extrato do paciente' }))
    servidor.use(msw.get('/api/agenda/selecao/pacientes', () => HttpResponse.json([])))

    // ACT
    renderizar('/relatorios/extrato-do-paciente?de=2026-06-01&ate=2026-06-30', ['lancamentos.ver', 'agenda.ver'])
    await usuario.type(await screen.findByRole('combobox', { name: /Paciente/ }), 'Valmiro')

    // ASSERT
    expect(await screen.findByText(/Nenhum resultado para/)).toBeInTheDocument()
    expect(screen.queryByText(/Existe cadastro/)).not.toBeInTheDocument()
  })

  it('deve exigir o paciente no extrato antes de pedir qualquer coisa ao servidor', async () => {
    // ARRANGE
    const chamadas = servirRelatorio(envelopeFicticio({ slug: 'extrato-do-paciente', titulo: 'Extrato do paciente' }))

    // ACT
    renderizar('/relatorios/extrato-do-paciente?de=2026-06-01&ate=2026-06-30', ['lancamentos.ver', 'agenda.ver'])
    const gerar = await screen.findByRole('button', { name: 'Gerar' })

    // ASSERT
    expect(gerar).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Escolha o paciente.')).toBeInTheDocument()
    expect(chamadas).toEqual([])
  })
})

/**
 * "Recebido por profissional" (change `recebido-por-profissional`): o filtro Serviço é novo, e é
 * POR convênio — o preço de um serviço muda por operadora, então a lista só existe depois do
 * convênio. É o formulário que a clínica usava no ClinicaÁgil (Convênio = Particular → Serviço).
 */
describe('PaginaRelatorio — Recebido por profissional: o serviço depende do convênio', () => {
  const RECEBIDO = envelopeFicticio({
    slug: 'recebido-por-profissional',
    titulo: 'Recebido por profissional',
    filtros_aplicados: [{ rotulo: 'Base', valor: 'Pagamentos recebidos no caixa da clínica' }],
  })
  const QUEM_FECHA_O_MES = ['repasse.ver', 'tratamentos.ver', 'fluxo_caixa.ver', 'lancamentos.ver', 'agenda.ver', 'convenios.ver', 'servicos.ver']
  // a Faturista da matriz (AP-10) com o `repasse.ver`: sem agenda nenhuma e sem o total da clínica
  const FATURISTA = ['repasse.ver', 'lancamentos.ver', 'tratamentos.ver', 'pacientes.ver', 'convenios.ver', 'servicos.ver']
  const SETEMBRO = '/relatorios/recebido-por-profissional?de=2026-09-01&ate=2026-09-30'

  function servico(id: number, convenioId: number, procedimento: string): Servico {
    return { id, convenio_id: convenioId, procedimento, codigo_procedimento: null, valor: '150.00', updated_at: 'v1' }
  }

  const SERVICOS_POR_CONVENIO: Record<string, Servico[]> = {
    '1': [servico(11, 1, 'Sessão de fonoaudiologia'), servico(12, 1, 'Avaliação psicológica')],
    '2': [servico(21, 2, 'Sessão de psicologia')],
  }

  /** O relatório, os convênios e a tabela de serviços de cada um; devolve os convênios pedidos. */
  function servirRecebido(): { chamadas: string[]; tabelasPedidas: string[] } {
    const chamadas = servirRelatorio(RECEBIDO)
    const tabelasPedidas: string[] = []
    servidor.use(
      msw.get('/api/convenios', () =>
        HttpResponse.json([
          { id: 1, nome: 'Particular' },
          { id: 2, nome: 'Convênio Fictício' },
        ]),
      ),
      msw.get('/api/convenios/:convenioId/servicos', ({ params }) => {
        tabelasPedidas.push(String(params.convenioId))
        return HttpResponse.json(SERVICOS_POR_CONVENIO[String(params.convenioId)] ?? [])
      }),
    )
    return { chamadas, tabelasPedidas }
  }

  function ultimaChamada(chamadas: string[]): URLSearchParams {
    return new URLSearchParams(chamadas.at(-1) ?? '')
  }

  it('deve exigir o profissional da faturista, sem "Todos", e só gerar depois de escolhido', async () => {
    // ARRANGE — decisão 2026-07-19: a faturista monta o repasse POR PROFISSIONAL e não vê o total
    // da clínica. Sem permissão de agenda, a lista de profissionais vem pela seleção (repasse.ver)
    const usuaria = userEvent.setup()
    const { chamadas } = servirRecebido()
    renderizar(SETEMBRO, FATURISTA)
    const campo = await screen.findByLabelText(/^Profissional/)
    await waitFor(() => {
      expect(within(campo).getAllByRole('option').length).toBeGreaterThan(1)
    })

    // ASSERT — antes de escolher: nada pedido, a razão ao lado de Gerar, e o "Todos" não existe
    expect(chamadas).toEqual([])
    expect(campo).toBeEnabled()
    expect(within(campo).queryByRole('option', { name: 'Todos' })).not.toBeInTheDocument()
    expect(within(campo).getAllByRole('option')[0]).toHaveTextContent('Escolha o profissional')
    expect(screen.getByText(/Escolha o profissional\. Ajuste o formulário/)).toBeInTheDocument()

    // ACT
    const primeiro = within(campo).getAllByRole('option')[1] as HTMLOptionElement
    await usuaria.selectOptions(campo, primeiro.value)
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT — a chamada leva o profissional
    await waitFor(() => {
      expect(ultimaChamada(chamadas).get('profissional_id')).toBe(primeiro.value)
    })
  })

  it('deve oferecer à faturista a profissional desligada, marcada, pedindo a seleção com desligados', async () => {
    // ARRANGE — CR-RPP-25: o último mês de quem saiu é um repasse a fazer
    const pedidosDaSelecao: string[] = []
    servirRecebido()
    servidor.use(
      msw.get('/api/agenda/selecao', ({ request }) => {
        pedidosDaSelecao.push(new URL(request.url).search)
        return HttpResponse.json({
          profissionais: [
            { id: 1, nome: 'Ana Fictícia', foto_versao: null, especialidades: [], ativo: true },
            { id: 2, nome: 'Bia Fictícia', foto_versao: null, especialidades: [], ativo: false },
          ],
          especialidades: [],
        })
      }),
    )

    // ACT
    renderizar(SETEMBRO, FATURISTA)
    const campo = await screen.findByLabelText(/^Profissional/)

    // ASSERT
    expect(await within(campo).findByRole('option', { name: 'Bia Fictícia (desligado)' })).toBeInTheDocument()
    expect(within(campo).getByRole('option', { name: 'Ana Fictícia' })).toBeInTheDocument()
    expect(pedidosDaSelecao).toContain('?com_desligados=1')
  })

  it('não deve oferecer "Gerar sem os filtros" quando o único filtro é o profissional obrigatório', async () => {
    // ARRANGE — CR-RPP-27: tirar o obrigatório levava a "Escolha o profissional", o contrário do
    // que o botão prometia; a "Base" do cabeçalho também não é filtro
    servirRelatorio(
      envelopeFicticio({
        slug: 'recebido-por-profissional',
        titulo: 'Recebido por profissional',
        filtros_aplicados: [
          { rotulo: 'Base', valor: 'Pagamentos recebidos no caixa da clínica' },
          { rotulo: 'Profissional', valor: 'Ana Fictícia' },
        ],
        linhas: [],
        contagem: 0,
        totais: {},
      }),
    )

    // ACT
    renderizar(`${SETEMBRO}&profissional_id=1`, FATURISTA)

    // ASSERT
    expect(await screen.findByText(/Nenhum registro/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gerar sem os filtros' })).not.toBeInTheDocument()
  })

  it('deve manter o profissional obrigatório ao gerar sem os outros filtros', async () => {
    // ARRANGE — com um convênio escolhido o botão aparece, e tira só o convênio
    const usuaria = userEvent.setup()
    const chamadas = servirRelatorio(
      envelopeFicticio({
        slug: 'recebido-por-profissional',
        titulo: 'Recebido por profissional',
        filtros_aplicados: [{ rotulo: 'Base', valor: 'Pagamentos recebidos no caixa da clínica' }],
        linhas: [],
        contagem: 0,
        totais: {},
      }),
    )
    renderizar(`${SETEMBRO}&profissional_id=1&convenio_id=1`, FATURISTA)

    // ACT
    await usuaria.click(await screen.findByRole('button', { name: 'Gerar sem os filtros' }))

    // ASSERT
    await waitFor(() => {
      const ultima = new URLSearchParams(chamadas.at(-1) ?? '')
      expect(ultima.get('convenio_id')).toBeNull()
      expect(ultima.get('profissional_id')).toBe('1')
    })
  })

  it('deve mostrar o aviso de pagamentos sem profissional como aviso, fora da frase do vazio', async () => {
    // ARRANGE — CR-RPP-31: o aviso entrava como linha de filtro — miúdo, sem `role="status"`, e
    // colado na frase "Nenhum registro… com …", justamente no caso que o motivou
    const AVISO = '1 pagamento do período está sem profissional — vincule-o ao tratamento em Financeiro.'
    servirRelatorio(
      envelopeFicticio({
        slug: 'recebido-por-profissional',
        titulo: 'Recebido por profissional',
        filtros_aplicados: [{ rotulo: 'Profissional', valor: 'Bia Fictícia' }],
        linhas: [],
        contagem: 0,
        totais: {},
        avisos: [AVISO],
      }),
    )

    // ACT
    renderizar(`${SETEMBRO}&profissional_id=2`, FATURISTA)

    // ASSERT — o aviso é um `status` próprio, e a frase do vazio não o carrega
    const aviso = await screen.findByText(AVISO)
    expect(aviso.closest('[role="status"]')).not.toBeNull()
    expect(screen.getByText(/Nenhum registro/).textContent).not.toContain('sem profissional')
  })

  it('deve oferecer "Vincular pagamentos" ao lado do aviso, no mês do relatório, a quem pode vincular', async () => {
    // ARRANGE — change `vincular-pagamentos-ao-tratamento`: o aviso passa a levar ao lote
    const AVISO = '3 pagamentos do período estão sem profissional — vincule-os ao tratamento em Financeiro.'
    servirRelatorio(
      envelopeFicticio({
        slug: 'recebido-por-profissional',
        titulo: 'Recebido por profissional',
        periodo: { de: '2026-09-01', ate: '2026-09-30' },
        avisos: [AVISO],
      }),
    )

    // ACT
    renderizar(`${SETEMBRO}&profissional_id=2`, [...QUEM_FECHA_O_MES, 'lancamentos.editar', 'lancamentos.pagar'])

    // ASSERT — dentro do mesmo aviso, e com o mês do período
    const aviso = (await screen.findByText(AVISO)).closest('[role="status"]')
    expect(aviso).not.toBeNull()
    expect(within(aviso as HTMLElement).getByRole('link', { name: 'Vincular pagamentos' })).toHaveAttribute(
      'href',
      '/financeiro/vincular?mes=2026-09',
    )
  })

  it('deve não oferecer "Vincular pagamentos" à faturista, que não aplica o vínculo no pago', async () => {
    // ARRANGE — sem `lancamentos.editar`/`lancamentos.pagar` o link levaria a "acesso negado"
    const AVISO = '1 pagamento do período está sem profissional — vincule-o ao tratamento em Financeiro.'
    servirRelatorio(
      envelopeFicticio({ slug: 'recebido-por-profissional', titulo: 'Recebido por profissional', avisos: [AVISO] }),
    )

    // ACT
    renderizar(`${SETEMBRO}&profissional_id=2`, FATURISTA)
    await screen.findByText(AVISO)

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Vincular pagamentos' })).not.toBeInTheDocument()
  })

  it('deve não oferecer "Vincular pagamentos" quando não há aviso', async () => {
    // ARRANGE — nada sem profissional no período: nada a vincular
    servirRelatorio(envelopeFicticio({ slug: 'recebido-por-profissional', titulo: 'Recebido por profissional' }))

    // ACT
    renderizar(SETEMBRO, [...QUEM_FECHA_O_MES, 'lancamentos.editar', 'lancamentos.pagar'])
    await screen.findByRole('table', { name: 'Recebido por profissional: 3 linhas' })

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Vincular pagamentos' })).not.toBeInTheDocument()
  })

  it('deve manter o "Todos" para quem vê o total da clínica', async () => {
    // ARRANGE
    servirRecebido()

    // ACT
    renderizar(SETEMBRO, QUEM_FECHA_O_MES)
    const campo = await screen.findByLabelText(/^Profissional/)

    // ASSERT
    expect(within(campo).getByRole('option', { name: 'Todos' })).toBeInTheDocument()
  })

  it('deve desabilitar o Serviço dizendo "Escolha o convênio" enquanto não há convênio, sem pedir tabela', async () => {
    // ARRANGE
    const { tabelasPedidas } = servirRecebido()

    // ACT
    renderizar(SETEMBRO, QUEM_FECHA_O_MES)
    await screen.findByRole('table', { name: 'Recebido por profissional: 3 linhas' })

    // ASSERT
    expect(screen.getByLabelText('Serviço')).toBeDisabled()
    expect(screen.getByText(/^Escolha o convênio/)).toBeInTheDocument()
    expect(tabelasPedidas).toEqual([])
  })

  it('deve listar os serviços do convênio escolhido e levar o serviço na URL e na chamada', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const { chamadas, tabelasPedidas } = servirRecebido()
    renderizar(SETEMBRO, QUEM_FECHA_O_MES)
    await screen.findByRole('option', { name: 'Particular' })

    // ACT
    await usuaria.selectOptions(screen.getByLabelText('Convênio'), '1')
    await usuaria.selectOptions(screen.getByLabelText('Serviço'), await screen.findByRole('option', { name: 'Avaliação psicológica' }))
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT — a tabela pedida é a do convênio escolhido, e o filtro foi como os outros
    await waitFor(() => {
      expect(ultimaChamada(chamadas).get('servico_id')).toBe('12')
    })
    expect(ultimaChamada(chamadas).get('convenio_id')).toBe('1')
    expect(tabelasPedidas).toEqual(['1'])
    expect(screen.getByLabelText('Serviço')).toBeEnabled()
  })

  it('deve limpar o serviço ao trocar o convênio, e listar a tabela do novo', async () => {
    // ARRANGE — o serviço 12 é da tabela do Particular; com outro convênio ele não existe
    const usuaria = userEvent.setup()
    const { chamadas } = servirRecebido()
    renderizar(SETEMBRO, QUEM_FECHA_O_MES)
    await screen.findByRole('option', { name: 'Particular' })
    await usuaria.selectOptions(screen.getByLabelText('Convênio'), '1')
    await usuaria.selectOptions(screen.getByLabelText('Serviço'), await screen.findByRole('option', { name: 'Avaliação psicológica' }))

    // ACT
    await usuaria.selectOptions(screen.getByLabelText('Convênio'), '2')
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT — nenhum 422 de "serviço de outro convênio" nasce da tela
    expect(await screen.findByRole('option', { name: 'Sessão de psicologia' })).toBeInTheDocument()
    expect(screen.getByLabelText('Serviço')).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'Avaliação psicológica' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(ultimaChamada(chamadas).get('convenio_id')).toBe('2')
    })
    expect(ultimaChamada(chamadas).has('servico_id')).toBe(false)
  })

  it('deve desabilitar o Serviço dizendo o porquê, e não pedir a tabela, sem `servicos.ver`', async () => {
    // ARRANGE — mesmo padrão do convênio: o campo não promete o que a API recusa
    const usuaria = userEvent.setup()
    const { tabelasPedidas } = servirRecebido()
    renderizar(SETEMBRO, ['repasse.ver', 'tratamentos.ver', 'fluxo_caixa.ver', 'lancamentos.ver', 'agenda.ver', 'convenios.ver'])
    await screen.findByRole('option', { name: 'Particular' })

    // ACT
    await usuaria.selectOptions(screen.getByLabelText('Convênio'), '1')

    // ASSERT
    expect(screen.getByLabelText('Serviço')).toBeDisabled()
    expect(screen.getByText('Listar os serviços precisa da permissão de ver serviços.')).toBeInTheDocument()
    expect(tabelasPedidas).toEqual([])
  })

  it('deve reproduzir o serviço do link copiado — o filtro vive na URL como os outros', async () => {
    // ARRANGE
    const { chamadas } = servirRecebido()

    // ACT
    renderizar(`${SETEMBRO}&convenio_id=1&servico_id=12`, QUEM_FECHA_O_MES)
    await screen.findByRole('option', { name: 'Avaliação psicológica' })

    // ASSERT
    expect(screen.getByLabelText('Serviço')).toHaveValue('12')
    expect(ultimaChamada(chamadas).get('servico_id')).toBe('12')
  })

  it('deve não ter violações axe com o Serviço desabilitado à espera do convênio', async () => {
    // ARRANGE + ACT
    servirRecebido()
    const { container } = renderizar(SETEMBRO, QUEM_FECHA_O_MES)
    await screen.findByRole('table', { name: 'Recebido por profissional: 3 linhas' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)

  it('deve oferecer no sintético a divisão por profissional como padrão, e também por convênio e serviço', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    const { chamadas } = servirRecebido()
    renderizar(SETEMBRO, QUEM_FECHA_O_MES)

    // ACT
    await usuaria.selectOptions(await screen.findByRole('combobox', { name: 'Resultado' }), 'sintetico')
    const dividir = screen.getByLabelText('Dividir por')
    const opcoes = Array.from(dividir.querySelectorAll('option')).map((opcao) => opcao.textContent)
    await usuaria.click(screen.getByRole('button', { name: 'Gerar' }))

    // ASSERT
    expect(dividir).toHaveValue('profissional')
    expect(opcoes).toEqual(['Profissional', 'Convênio', 'Serviço'])
    await waitFor(() => {
      expect(ultimaChamada(chamadas).get('dividir_por')).toBe('profissional')
    })
  })
})
