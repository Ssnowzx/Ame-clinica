import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ShellDeIndicadores } from '@/componentes/indicadores/shell-de-indicadores'
import { queryClient } from '@/lib/query-client'
import { PaginaIndicadoresPacientes } from '@/paginas/pagina-indicadores-pacientes'
import { useAuthStore } from '@/stores/auth-store'
import { MES_DO_PAINEL, painelDosPacientesFicticio, paineisQueAnotam, semAsChavesProtegidas } from '@/test/dados-paineis'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { IndicadoresDePacientes, PainelDosPacientes } from '@/tipos'

expect.extend(toHaveNoViolations)

/** A vista das quebras demográficas (a de sempre) — contagens agregadas, rótulos fictícios. */
function vistaDasQuebras(sobrescritas: Partial<IndicadoresDePacientes> = {}): IndicadoresDePacientes {
  return {
    mes: MES_DO_PAINEL,
    ativos: 12,
    novos_no_mes: 2,
    serie: [],
    por_sexo: [
      { sexo: 'feminino', total: 8 },
      { sexo: 'masculino', total: 4 },
    ],
    por_faixa_etaria: [
      { faixa: '0-2', total: 1 },
      { faixa: '3-5', total: 5 },
      { faixa: '6-8', total: 3 },
      { faixa: '9-11', total: 2 },
      { faixa: '12-14', total: 1 },
      { faixa: '15-17', total: 0 },
      { faixa: '18+', total: 0 },
    ],
    por_indicacao: {
      total: [
        { indicacao: 'Indicação Médica Fictícia', total: 6 },
        { indicacao: 'Google Fictício', total: 4 },
        { indicacao: null, total: 2 },
      ],
      mensal: [{ indicacao: 'Google Fictício', total: 2 }],
    },
    por_convenio: [
      { convenio: { id: 30, nome: 'Convênio Pacientes Fictício' }, total: 5 },
      { convenio: { id: 31, nome: 'Particular Fictício' }, total: 3 },
    ],
    ...sobrescritas,
  }
}

function renderizar({
  painel = painelDosPacientesFicticio(),
  quebras = vistaDasQuebras(),
  permissoes = ['pacientes.ver'],
}: { painel?: PainelDosPacientes; quebras?: IndicadoresDePacientes; permissoes?: string[] } = {}) {
  const anotador = paineisQueAnotam({ pacientes: painel })
  servidor.use(...anotador.handlers, msw.get('/api/indicadores/pacientes', () => HttpResponse.json(quebras)))
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  const resultado = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/indicadores/pacientes?mes=${MES_DO_PAINEL}`]}>
        <Routes>
          <Route element={<ShellDeIndicadores />}>
            <Route path="/indicadores" element={<div />} />
            <Route path="/indicadores/pacientes" element={<PaginaIndicadoresPacientes />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { ...resultado, chamadas: anotador.chamadas }
}

async function abaPronta(): Promise<void> {
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Pacientes no mês' })).not.toBeInTheDocument())
  await screen.findByText('Por sexo')
}

beforeEach(() => {
  queryClient.clear()
})

describe('Aba Pacientes — linha do período, cartões, crescimento e quebras', () => {
  it('deve seguir a ordem: a linha do período, os cinco cartões, o crescimento e as quebras', async () => {
    // ARRANGE + ACT
    const { chamadas } = renderizar()
    await abaPronta()

    // ASSERT
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((titulo) => titulo.textContent)
    expect(titulos).toEqual([
      'Ativos',
      'Novos',
      'Saíram',
      'Pacotes no fim',
      'Fila de espera',
      'Os cadastros novos subiram em relação a 1º a 5 de setembro',
      'A faixa etária com mais pacientes é a de 3-5 anos',
    ])
    expect(within(screen.getByRole('region', { name: 'Ativos' })).getByText('432')).toBeInTheDocument()
    // a linha do período abre a aba — e nenhuma frase de resumo (D8)
    const periodo = screen.getByText('De 1º a 5 de outubro de 2026, até hoje, comparado com 1º a 5 de setembro de 2026.')
    expect(periodo.compareDocumentPosition(screen.getByRole('region', { name: 'Ativos' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/em atendimento\./)).not.toBeInTheDocument()
    // só o painel desta frente foi buscado
    expect(chamadas).toEqual([`pacientes?mes=${MES_DO_PAINEL}`])
  })

  it('não deve transformar o mês da importação em queda: a comparação é o mesmo trecho dos dois meses', async () => {
    // ARRANGE — setembro teve 400 novos (a importação da virada); de 1 a 5 de setembro, 20
    renderizar()
    await abaPronta()

    // ASSERT — a variação é a JUSTA (24 contra 20), e o texto nomeia os dois períodos
    const novos = screen.getByRole('region', { name: 'Novos' })
    expect(within(novos).getByText('4 a mais')).toBeInTheDocument()
    expect(novos).toHaveTextContent('que em 1º a 5 de setembro')
    expect(document.body.textContent).not.toMatch(/−\s?376|-376/)
  })

  it('deve mostrar a série com os meses antes do histórico como "sem dados", nunca zero', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()
    const grafico = screen.getByRole('region', { name: 'Os cadastros novos subiram em relação a 1º a 5 de setembro' })

    // ASSERT
    expect(grafico.querySelectorAll('[data-sem-dados]')).toHaveLength(4)
    expect(within(grafico).getByText('mai–ago: antes dos indicadores, sem dados')).toBeInTheDocument()
    const tabela = within(grafico).getByRole('table', { name: 'Pacientes novos por mês' })
    expect(within(tabela).getAllByText('sem dados')).toHaveLength(4)
    expect(within(tabela).getByRole('row', { name: /setembro de 2026/ })).toHaveTextContent('400')
  })

  it('deve dizer "sem comparação" nos novos no primeiro mês do histórico', async () => {
    // ARRANGE — o histórico começa em outubro: não há setembro para comparar
    renderizar({
      painel: painelDosPacientesFicticio({
        inicio_historico: '2026-10',
        inicio_historico_dia: '2026-10-01',
        novos: { atual: 24, anterior: null },
        sairam: { atual: 3, anterior: null },
      }),
    })
    await abaPronta()

    // ASSERT
    const novos = screen.getByRole('region', { name: 'Novos' })
    expect(within(novos).getByText('sem comparação')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Outubro, primeiro mês dos indicadores, teve 24 cadastros novos até hoje' })).toBeInTheDocument()
  })

  it('deve abrir as portas só com a permissão do DESTINO', async () => {
    // ARRANGE + ACT — sem tratamentos.ver e sem lista_espera.ver
    renderizar()
    await abaPronta()

    // ASSERT
    expect(screen.getByRole('link', { name: 'Abrir pacientes' })).toHaveAttribute('href', '/pacientes')
    expect(screen.queryByRole('link', { name: 'Ver os tratamentos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Abrir a lista de espera' })).not.toBeInTheDocument()
  })

  it('deve abrir as portas dos pacotes e da fila a quem pode ver os destinos', async () => {
    // ARRANGE + ACT
    renderizar({ permissoes: ['pacientes.ver', 'tratamentos.ver', 'lista_espera.ver'] })
    await abaPronta()

    // ASSERT
    expect(screen.getByRole('link', { name: 'Ver os tratamentos' })).toHaveAttribute('href', '/tratamentos')
    expect(screen.getByRole('link', { name: 'Abrir a lista de espera' })).toHaveAttribute('href', '/lista-espera')
  })

  it('deve sumir com os cartões e as frases de pacotes e fila quando o servidor não manda as chaves', async () => {
    // ARRANGE — sem `tratamentos.ver` e sem `lista_espera.ver`, as chaves vêm AUSENTES (SEC-IND-01)
    renderizar({ painel: semAsChavesProtegidas(painelDosPacientesFicticio()) })
    await abaPronta()

    // ASSERT — ausente não é zero: nem cartão, nem "Nenhum pacote", nem "ninguém na fila"
    expect(screen.queryByRole('region', { name: 'Pacotes no fim' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Fila de espera' })).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/pacote|fila de espera/i)
    expect(screen.getByRole('region', { name: 'Ativos' })).toBeInTheDocument()
  })

  it('deve mostrar o ZERO quando a chave veio com zero — zero é resultado, ausente é que some', async () => {
    // ARRANGE
    renderizar({
      painel: painelDosPacientesFicticio({ pacotes_no_fim: 0, fila_de_espera: 0 }),
      permissoes: ['pacientes.ver', 'tratamentos.ver', 'lista_espera.ver'],
    })
    await abaPronta()

    // ASSERT
    expect(within(screen.getByRole('region', { name: 'Pacotes no fim' })).getByText('0')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Fila de espera' })).getByText('0')).toBeInTheDocument()
  })

  it('deve dar aos cartões a mesma anatomia: a comparação ou a linha "situação de hoje", e nenhuma frase', async () => {
    // ARRANGE + ACT
    renderizar({ permissoes: ['pacientes.ver', 'tratamentos.ver', 'lista_espera.ver'] })
    await abaPronta()

    // ASSERT — DQ-05: lado a lado, nada de um cartão com frase e o vizinho sem
    for (const rotulo of ['Ativos', 'Novos', 'Saíram', 'Pacotes no fim', 'Fila de espera']) {
      const cartao = screen.getByRole('region', { name: rotulo })
      expect(cartao.querySelectorAll('[data-comparacao], [data-contexto]')).toHaveLength(1)
      expect(cartao.querySelector('p.border-t')).toBeNull()
    }
    expect(screen.getByRole('region', { name: 'Ativos' })).toHaveTextContent('situação de hoje')
  })

  it('não deve ter violações de acessibilidade', async () => {
    // ARRANGE + ACT
    const { container } = renderizar()
    await abaPronta()

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Aba Pacientes — quebras demográficas (§11)', () => {
  it('deve exibir as quatro quebras legíveis como texto, com a indicação em total e no mês', async () => {
    // ARRANGE + ACT
    renderizar()
    await abaPronta()

    // ASSERT — sexo (rótulo capitalizado + contagem em texto)
    expect(screen.getByText('Feminino')).toBeInTheDocument()
    expect(screen.getByText('Masculino')).toBeInTheDocument()
    // faixa etária em bandas (inclusive as zeradas, legenda estável)
    expect(screen.getByText('0-2 anos')).toBeInTheDocument()
    expect(screen.getByText('18 anos ou mais')).toBeInTheDocument()
    // indicação nas DUAS leituras; null vira "Não informado"
    expect(screen.getByText('Por indicação (total)')).toBeInTheDocument()
    expect(screen.getByText('Por indicação (novos no mês)')).toBeInTheDocument()
    expect(screen.getAllByText('Google Fictício').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Não informado')).toBeInTheDocument()
    // convênio + o aviso de que a soma não particiona a base
    expect(screen.getByText('Convênio Pacientes Fictício')).toBeInTheDocument()
    expect(screen.getByText(/Conta por vínculo de tratamento/)).toBeInTheDocument()
  })

  it('deve pôr a maior barra de cada quebra em destaque e o resto recessivo', async () => {
    // ARRANGE + ACT
    const { container } = renderizar()
    await abaPronta()

    // ASSERT — "Por sexo": feminino (8) em destaque, masculino (4) recessivo
    const fluxo = container.querySelector('[data-fluxo-em-colunas]')
    const sexo = fluxo?.firstElementChild
    expect(sexo?.querySelectorAll('[data-tom="destaque"]')).toHaveLength(1)
    expect(sexo?.querySelectorAll('[data-tom="recessivo"]')).toHaveLength(1)
  })

  it('deve mostrar o sexo e a faixa não informados por rótulo legível, nunca o valor cru', async () => {
    // ARRANGE — a produção mostrava "Nao_informado" e "não informado anos"
    const quebras = vistaDasQuebras()
    renderizar({
      quebras: vistaDasQuebras({
        por_sexo: [...quebras.por_sexo, { sexo: 'nao_informado', total: 3 }],
        por_faixa_etaria: [...quebras.por_faixa_etaria, { faixa: 'não informado', total: 2 }],
        por_indicacao: { total: [{ indicacao: 'Google Fictício', total: 4 }], mensal: [] },
      }),
    })
    await abaPronta()

    // ASSERT
    expect(screen.getAllByText('Não informado')).toHaveLength(2)
    expect(screen.queryByText(/Nao_informado/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/informado anos/)).not.toBeInTheDocument()
  })

  it('deve fazer as quebras fluírem em até duas colunas pela largura do quadro, inteiras e na ordem que equilibra', async () => {
    // ARRANGE + ACT — numa grade em linhas, cada par de quebras de alturas diferentes abria um buraco
    const { container } = renderizar()
    await abaPronta()
    const fluxo = container.querySelector('[data-fluxo-em-colunas]')

    // ASSERT
    const titulos = Array.from(fluxo?.querySelectorAll('h3') ?? []).map((titulo) => titulo.textContent)
    expect(titulos).toEqual(['Por sexo', 'Por faixa etária', 'Por indicação (novos no mês)', 'Por convênio', 'Por indicação (total)'])
    expect(fluxo?.className).toMatch(/@min-\[44rem\]:columns-2/)
    expect(fluxo?.closest('.\\@container')).not.toBeNull()
    expect(fluxo?.className).toMatch(/(^|\s)print:break-inside-avoid(\s|$)/)
    const quebras = Array.from(fluxo?.children ?? [])
    expect(quebras.every((quebra) => quebra.className.includes('break-inside-avoid'))).toBe(true)
  })

  it('não deve montar o fluxo das quebras quando nenhuma tem dado, e dizer por quê', async () => {
    // ARRANGE
    renderizar({
      quebras: vistaDasQuebras({
        por_sexo: [],
        por_faixa_etaria: vistaDasQuebras().por_faixa_etaria.map((linha) => ({ ...linha, total: 0 })),
        por_convenio: [],
        por_indicacao: { total: [], mensal: [] },
      }),
    })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Pacientes no mês' })).not.toBeInTheDocument())

    // ASSERT
    expect(await screen.findByText('Nenhum paciente ativo para descrever.')).toBeInTheDocument()
    expect(document.querySelector('[data-fluxo-em-colunas]')).toBeNull()
  })

  it('deve agregar a cauda da indicação em "Outras (+N)" quando há muitas origens', async () => {
    // ARRANGE — 10 origens (2 além do teto de 8)
    const dezOrigens = Array.from({ length: 10 }, (_, indice) => ({ indicacao: `Origem ${String(indice + 1)} Fictícia`, total: 100 - indice * 5 }))
    renderizar({ quebras: vistaDasQuebras({ por_indicacao: { total: dezOrigens, mensal: [] } }) })
    await abaPronta()

    // ASSERT — teto DECLARADO, nunca corte silencioso
    expect(screen.getByText('Outras (+2)')).toBeInTheDocument()
    expect(screen.queryByText('Origem 10 Fictícia')).not.toBeInTheDocument()
  })
})
