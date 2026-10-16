import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { CardAgendamento } from '@/componentes/agenda/card-agendamento'
import { HorarioDoCard } from '@/componentes/agenda/conteudo-do-card'
import { ListaAgenda } from '@/componentes/agenda/lista-agenda'
import { ProximasSessoesDoPaciente } from '@/componentes/agenda/proximas-sessoes-do-paciente'
import { dataComHorarioLegivel } from '@/lib/datas'
import { montarGrade } from '@/lib/grade-agenda'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, DIA_FICTICIO, PROFISSIONAIS_FICTICIOS } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CardAgendamento as DadosDoCard, ConfiguracaoAgenda, ItemAgendamentoDaFicha } from '@/tipos'

const CONFIG: ConfiguracaoAgenda = {
  granularidadeMin: 40,
  fimDeSemana: 'nenhum',
  visaoPadrao: 'dia',
  janelaPadraoInicio: '08:00',
  janelaPadraoFim: '19:00',
  timezone: 'America/Sao_Paulo',
  responsavelTecnicoObrigatorio: false,
  statusAoSalvarEvolucao: 0,
  arrastarParaRemarcar: false,
}

/** A lista do celular sobre a MESMA grade da tabela, num dia com os cards dados. */
function renderLista(cards: DadosDoCard[]) {
  const grade = montarGrade({
    visao: 'dia',
    data: DIA_FICTICIO,
    agendamentos: cards,
    profissionais: [PROFISSIONAIS_FICTICIOS[0]],
    feriados: [],
    config: CONFIG,
  })
  return render(<ListaAgenda grade={grade} legenda="Agenda do dia" />)
}

/**
 * Change horario-de-termino-no-card — o pedido da clínica: "08:40 às 09:20" no card, e as
 * próximas sessões (cada uma com o próprio horário) ao abrir o card.
 */

function itemDaFicha(id: number, inicio: string, fim: string): ItemAgendamentoDaFicha {
  return {
    id,
    inicio,
    fim,
    especialidade: { id: 1, nome: 'Fonoaudiologia', cor: '#A85550' },
    profissional: { id: 1, nome: 'Profissional Fictício A' },
    status: { id: 1, nome: 'Em Aberto', cor: '#64748B', cor_borda: null, tipo: 'circle-dashed' },
    tem_evolucao: null,
  }
}

function comAgendamentosDoPaciente(itens: ItemAgendamentoDaFicha[], total = itens.length): void {
  servidor.use(
    msw.get('/api/pacientes/:id/agendamentos', () =>
      HttpResponse.json({
        proximos: { janela: { de: DIA_FICTICIO, ate: null }, total, itens },
        recentes: { janela: { de: '2026-04-14', ate: DIA_FICTICIO }, total: 0, itens: [] },
      }),
    ),
  )
}

function comPermissoes(permissoes: string[]): void {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes } })
}

function renderProximas(agendamentoId = 1, inicioDoAberto = '2026-07-11 08:00') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProximasSessoesDoPaciente pacienteId={10} agendamentoId={agendamentoId} inicioDoAberto={inicioDoAberto} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  comPermissoes(['agenda.ver', 'pacientes.ver'])
})

describe('O card mostra início e término', () => {
  it('deve mostrar "08:40 às 09:30" com o término gravado, e não o início mais a grade', () => {
    // ARRANGE — 50 minutos: prova que o término é o `fim`, e não um cálculo de 40
    const card = cardFicticio({ inicio: `${DIA_FICTICIO} 08:40`, fim: `${DIA_FICTICIO} 09:30`, duracao_minutos: 50 })

    // ACT
    render(<CardAgendamento card={card} />)

    // ASSERT
    expect(screen.getByText(/08:40/).closest('span')).toHaveTextContent('08:40 às 09:30')
  })

  it('deve marcar o início e o término como horários de máquina, para quem lê a página', () => {
    // ARRANGE
    const card = cardFicticio({ inicio: `${DIA_FICTICIO} 08:40`, fim: `${DIA_FICTICIO} 09:20` })

    // ACT
    const { container } = render(<HorarioDoCard card={card} />)

    // ASSERT
    const horarios = [...container.querySelectorAll('time')].map((t) => t.getAttribute('dateTime'))
    expect(horarios).toEqual([`${DIA_FICTICIO} 08:40`, `${DIA_FICTICIO} 09:20`])
    expect(container).toHaveTextContent('08:40 às 09:20')
  })
})

describe('A lista do celular mostra início e término', () => {
  it('deve mostrar "08:40 às 09:30" no agendamento da lista', () => {
    // ARRANGE — o celular não tem altura proporcional: o término só existe se for escrito
    const sessao = cardFicticio({ inicio: `${DIA_FICTICIO} 08:40`, fim: `${DIA_FICTICIO} 09:30`, duracao_minutos: 50 })

    // ACT
    renderLista([sessao])

    // ASSERT
    // o cabeçalho do grupo também diz "08:40" (a hora do SLOT): procura a peça do horário do card
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '08:40 às 09:30')).toBeInTheDocument()
  })

  it('deve mostrar início e término também no bloqueio da lista', () => {
    // ARRANGE
    const bloqueio = cardFicticio({
      id: 2,
      tipo: 'bloqueio',
      paciente_id: null,
      paciente: null,
      tratamento_id: null,
      status: null,
      convenio: null,
      inicio: `${DIA_FICTICIO} 10:00`,
      fim: `${DIA_FICTICIO} 11:20`,
      duracao_minutos: 80,
    })

    // ACT
    renderLista([bloqueio])

    // ASSERT
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '10:00 às 11:20')).toBeInTheDocument()
  })
})

describe('A data com o horário', () => {
  it('deve dizer "das 08:40 às 09:20" quando o término vem', () => {
    // ARRANGE + ACT
    const texto = dataComHorarioLegivel('2026-10-15 08:40', '2026-10-15 09:20')

    // ASSERT
    expect(texto).toBe('15/10/2026, das 08:40 às 09:20')
  })

  it('deve cair no início sozinho quando o término não veio (deploy fora de ordem)', () => {
    // ARRANGE + ACT
    const texto = dataComHorarioLegivel('2026-10-15 08:40', undefined)

    // ASSERT
    expect(texto).toBe('15/10/2026 às 08:40')
  })
})

describe('Próximas sessões no painel do agendamento', () => {
  it('deve listar as próximas sessões, cada uma com o próprio horário, sem repetir a aberta', async () => {
    // ARRANGE — o tratamento de 20 sessões não tem um horário só
    comAgendamentosDoPaciente([
      itemDaFicha(1, '2026-07-13 08:00', '2026-07-13 08:40'),
      itemDaFicha(2, '2026-07-15 10:00', '2026-07-15 10:50'),
      itemDaFicha(3, '2026-07-20 14:20', '2026-07-20 15:00'),
    ])

    // ACT
    renderProximas(1)

    // ASSERT — espera o DADO, e não a lista: o esqueleto do carregamento também é uma lista
    await screen.findByText('15/07/2026, das 10:00 às 10:50')
    const lista = screen.getByRole('list')
    expect(within(lista).getByText('15/07/2026, das 10:00 às 10:50')).toBeInTheDocument()
    expect(within(lista).getByText('20/07/2026, das 14:20 às 15:00')).toBeInTheDocument()
    expect(within(lista).queryByText(/13\/07\/2026/)).not.toBeInTheDocument()
  })

  it('deve nascer aberta — é a resposta que a clínica pediu ao abrir o card', () => {
    // ARRANGE
    comAgendamentosDoPaciente([])

    // ACT
    renderProximas()

    // ASSERT
    expect(screen.getByRole('button', { name: 'Próximas sessões' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('deve dizer quantas mais há e levar à ficha, para quem pode abrir a ficha', async () => {
    // ARRANGE — o servidor corta o bloco no teto e diz o total REAL
    comAgendamentosDoPaciente(
      [1, 2, 3, 4, 5, 6].map((id) => itemDaFicha(id, `2026-07-${10 + id} 08:00`, `2026-07-${10 + id} 08:40`)),
      19,
    )

    // ACT
    renderProximas(1)

    // ASSERT — 19 próximas, a aberta é uma delas: 18 outras, 4 à vista, mais 14
    expect(await screen.findByText(/Mais 14 sessões marcadas/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver todas na ficha' })).toHaveAttribute('href', '/pacientes/10/agendamentos')
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4)
  })

  it('não deve oferecer a ficha a quem não tem pacientes.ver', async () => {
    // ARRANGE
    comPermissoes(['agenda.ver'])
    comAgendamentosDoPaciente(
      [1, 2, 3, 4, 5, 6].map((id) => itemDaFicha(id, `2026-07-${10 + id} 08:00`, `2026-07-${10 + id} 08:40`)),
      6,
    )

    // ACT
    renderProximas(1)

    // ASSERT
    expect(await screen.findByText(/Mais 1 sessão marcada/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ver todas na ficha' })).not.toBeInTheDocument()
  })

  it('deve descontar o aberto que está ALÉM do corte do servidor', async () => {
    // ARRANGE — 60 próximas, o servidor manda 6 (o teto do dublê); a recepção abriu a 55ª
    comAgendamentosDoPaciente(
      [1, 2, 3, 4, 5, 6].map((id) => itemDaFicha(id, `2026-07-${10 + id} 08:00`, `2026-07-${10 + id} 08:40`)),
      60,
    )

    // ACT
    renderProximas(55, '2026-09-30 08:00')

    // ASSERT — 60 menos a aberta = 59 outras; 4 à vista, mais 55
    expect(await screen.findByText(/Mais 55 sessões marcadas/)).toBeInTheDocument()
  })

  it('deve descontar o aberto no MESMO minuto do último item que veio, com id maior (o corte é por início e id)', async () => {
    // ARRANGE — o servidor ordena por início e id: o aberto às 08:00 do último dia, de id maior, ficou
    // logo depois do corte — está entre os próximos, e não veio nos itens (code-reviewer r2)
    comAgendamentosDoPaciente(
      [1, 2, 3, 4, 5, 6].map((id) => itemDaFicha(id, `2026-07-${10 + id} 08:00`, `2026-07-${10 + id} 08:40`)),
      10,
    )

    // ACT
    renderProximas(99, '2026-07-16 08:00')

    // ASSERT — 10 menos a aberta = 9 outras; 4 à vista, mais 5
    expect(await screen.findByText(/Mais 5 sessões marcadas/)).toBeInTheDocument()
  })

  it('não deve descontar nada quando o aberto já passou (a baixa de ontem)', async () => {
    // ARRANGE — o aberto é de antes de todas as próximas, e o bloco veio cortado
    comAgendamentosDoPaciente(
      [1, 2, 3, 4, 5, 6].map((id) => itemDaFicha(id, `2026-07-${10 + id} 08:00`, `2026-07-${10 + id} 08:40`)),
      20,
    )

    // ACT
    renderProximas(99, '2026-07-01 08:00')

    // ASSERT — as 20 são todas "outras"; 4 à vista, mais 16
    expect(await screen.findByText(/Mais 16 sessões marcadas/)).toBeInTheDocument()
  })

  it('deve dizer que não há outra sessão quando a aberta é a única', async () => {
    // ARRANGE
    comAgendamentosDoPaciente([itemDaFicha(1, '2026-07-13 08:00', '2026-07-13 08:40')])

    // ACT
    renderProximas(1)

    // ASSERT
    expect(await screen.findByText('Nenhuma outra sessão marcada')).toBeInTheDocument()
  })
})
