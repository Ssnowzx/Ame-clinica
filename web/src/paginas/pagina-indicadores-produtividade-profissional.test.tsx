import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellDeIndicadores } from '@/componentes/indicadores/shell-de-indicadores'
import { queryClient } from '@/lib/query-client'
import { PaginaIndicadoresProdutividadeProfissional } from '@/paginas/pagina-indicadores-produtividade-profissional'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { LinhaDeProdutividade, NumerosDeProdutividade, ProdutividadeDoMes } from '@/tipos'

expect.extend(toHaveNoViolations)

const MES = '2026-08'
const AS_DUAS = ['agenda.ver', 'atendimentos.ver']

function numeros(sobrescritas: Partial<NumerosDeProdutividade> = {}): NumerosDeProdutividade {
  return {
    minutos_na_grade: 4800,
    minutos_marcados: 3200,
    minutos_realizados: 2400,
    minutos_ociosos: 1600,
    capacidade_atendimentos: 120,
    marcados: 80,
    realizados: 60,
    faltas: 10,
    liberados: 5,
    em_aberto: 10,
    ocupacao_pct: 67,
    produtividade_pct: 50,
    aproveitamento_pct: 75,
    ...sobrescritas,
  }
}

function linha(id: number, nome: string, sobrescritas: Partial<LinhaDeProdutividade> = {}): LinhaDeProdutividade {
  return {
    ...numeros(),
    profissional: { id, nome, foto_versao: null },
    especialidade: { id: 1, nome: 'Fonoaudiologia Fictícia', cor: '#0F766E' },
    duracao_referencia_min: 40,
    minutos_em_feriados: 240,
    minutos_em_bloqueios: 60,
    por_dia_da_semana: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({
      dia,
      minutos_na_grade: dia <= 5 ? 960 : 0,
      marcados: dia <= 5 ? 16 : 0,
      minutos_marcados: dia <= 5 ? 640 : 0,
      realizados: dia <= 5 ? 12 : 0,
      minutos_realizados: dia <= 5 ? 480 : 0,
    })),
    ...sobrescritas,
  }
}

function vistaFicticia(linhas: LinhaDeProdutividade[]): ProdutividadeDoMes {
  return { mes: MES, totais: numeros(), linhas }
}

function renderizar(caminho: string, permissoes: string[] = AS_DUAS) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route element={<ShellDeIndicadores />}>
            {/* a raiz da área só existe para a barra de abas ter para onde apontar */}
            <Route path="/indicadores" element={<div />} />
            {/* a lista virou a aba Equipe (indicadores-profissionais): aqui só o destino da volta */}
            <Route path="/indicadores/equipe" element={<div />} />
            <Route
              path="/indicadores/produtividade/:id"
              element={<PaginaIndicadoresProdutividadeProfissional />}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Produtividade — o detalhe do profissional', () => {
  it('deve mostrar a semana em horas e atendimentos, os três percentuais e a perda discriminada', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/indicadores/produtividade', () => HttpResponse.json(vistaFicticia([linha(4, 'Profissional Fictício A')]))))

    // ACT
    const { container } = renderizar(`/indicadores/produtividade/4?mes=${MES}`)
    const semana = await screen.findByRole('table', { name: 'Grade, marcados e realizados por dia da semana' })

    // ASSERT — só os dias com grade (seg–sex), e o total do mês no fim
    expect(within(semana).getByText('Segunda')).toBeInTheDocument()
    expect(within(semana).queryByText('Sábado')).not.toBeInTheDocument()
    expect(within(semana).getAllByText('16h').length).toBeGreaterThan(0)
    expect(within(semana).getByText('Total do mês')).toBeInTheDocument()
    // os três percentuais com a conta por extenso — cada taxa é um par `dt`/`dd`
    const taxas = screen.getByRole('heading', { name: 'O mês em números' }).parentElement
    expect(taxas).not.toBeNull()
    expect(within(taxas as HTMLElement).getByText('67%')).toBeInTheDocument()
    expect(within(taxas as HTMLElement).getByText('50%')).toBeInTheDocument()
    expect(within(taxas as HTMLElement).getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('realizado ÷ marcado')).toBeInTheDocument()
    // a perda, item a item
    const perda = screen.getByRole('region', { name: 'Onde a agenda não rendeu' })
    expect(within(perda).getByText('Faltas')).toBeInTheDocument()
    expect(within(perda).getByText('Horas ociosas (sem marcação)')).toBeInTheDocument()
    // o 4º balde não é só "vai acontecer": Falta Justificada e Reserva caem aqui (CR-04)
    expect(within(perda).getByText('Outros, sem cobrança')).toBeInTheDocument()
    expect(within(perda).getByText(/Falta Justificada e Reserva de Agenda/)).toBeInTheDocument()
    expect(within(perda).getByText('26h40')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver os atendimentos do mês' })).toHaveAttribute(
      'href',
      `/indicadores/profissionais/4?mes=${MES}`,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it.each([
    // [mês, nota esperada, "até hoje" aparece?] — "hoje" é 5 de outubro de 2026
    ['2026-10', 'Números do mês inteiro de outubro de 2026 — a tabela da Equipe mostra só o período até hoje.', true],
    ['2026-08', 'Números do mês inteiro de agosto de 2026.', false],
  ])('deve dizer a janela do detalhe em %s (CR-IND-03)', async (mes, nota, ateHoje) => {
    // ARRANGE — o mesmo profissional com dois números diferentes só existe no mês EM CURSO
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T10:00:00-03:00'))
    servidor.use(msw.get('/api/indicadores/produtividade', () => HttpResponse.json(vistaFicticia([linha(4, 'Profissional Fictício A')]))))

    // ACT
    renderizar(`/indicadores/produtividade/4?mes=${mes}`)

    // ASSERT
    const texto = await screen.findByText(/Números do mês inteiro de/)
    expect(texto).toHaveTextContent(nota)
    expect(texto.textContent?.includes('até hoje')).toBe(ateHoje)
    vi.useRealTimers()
  })

  it('deve dizer que o profissional não está no recorte quando o id não vem na vista (escopo)', async () => {
    // ARRANGE — o escopado só recebe a própria linha: o id alheio simplesmente não vem
    servidor.use(msw.get('/api/indicadores/produtividade', () => HttpResponse.json(vistaFicticia([linha(4, 'Profissional Fictício A')]))))

    // ACT
    renderizar(`/indicadores/produtividade/77?mes=${MES}`)

    // ASSERT
    expect(await screen.findByText('Profissional não encontrado neste recorte.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Profissional Fictício A' })).not.toBeInTheDocument()
  })

  it('deve tratar id inválido sem chamar a API', async () => {
    // ARRANGE
    let chamadas = 0
    servidor.use(
      msw.get('/api/indicadores/produtividade', () => {
        chamadas += 1

        return HttpResponse.json(vistaFicticia([]))
      }),
    )

    // ACT
    renderizar(`/indicadores/produtividade/abc?mes=${MES}`)

    // ASSERT
    expect(await screen.findByText('Profissional não encontrado neste recorte.')).toBeInTheDocument()
    expect(chamadas).toBe(0)
  })

  it('deve voltar à aba Equipe preservando o mês', async () => {
    // ARRANGE — a Produtividade virou a Equipe; o detalhe continua sendo porta da tabela dela
    servidor.use(msw.get('/api/indicadores/produtividade', () => HttpResponse.json(vistaFicticia([linha(4, 'Profissional Fictício A')]))))

    // ACT
    renderizar(`/indicadores/produtividade/4?mes=${MES}`)

    // ASSERT — dentro da área (o período continua no shell) e com a volta para a Equipe
    expect(await screen.findByRole('heading', { name: 'Profissional Fictício A' })).toBeInTheDocument()
    expect(screen.getByText('agosto de 2026', { selector: '[aria-live]' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Todos os profissionais' })).toHaveAttribute('href', `/indicadores/equipe?mes=${MES}`)
  })
})
