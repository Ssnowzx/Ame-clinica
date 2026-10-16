import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { montarGrade } from '@/lib/grade-agenda'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { cardFicticio, DIA_FICTICIO, handlersDaAgenda, PROFISSIONAIS_FICTICIOS, SELECAO_FICTICIA } from '@/test/dados-agenda'
import { servidor } from '@/test/servidor-msw'
import type { CardAgendamento, ConfiguracaoAgenda, ProfissionalDaAgenda } from '@/tipos'
import { HttpResponse, http as msw } from 'msw'

/**
 * Piso §16: a Visão Geral com 20 profissionais × dia inteiro é o teto de
 * performance do produto. Aqui provamos que a grade cheia RENDERIZA COMPLETA
 * (o número de cards, colunas e células é o esperado) — o tempo medido fica
 * registrado no design.md, porque cronômetro em CI é flaky.
 */

const PROFISSIONAIS = 20
const SESSOES_POR_PROFISSIONAL = 16 // 08:00–19:00 em slots de 40 min

function vinteProfissionais(): ProfissionalDaAgenda[] {
  return Array.from({ length: PROFISSIONAIS }, (_, indice) => ({
    ...PROFISSIONAIS_FICTICIOS[0],
    id: indice + 1,
    nome: `Profissional Fictício ${indice + 1}`,
    horarios: {},
  }))
}

function diaCheio(): CardAgendamento[] {
  const cards: CardAgendamento[] = []
  for (let profissional = 1; profissional <= PROFISSIONAIS; profissional++) {
    for (let sessao = 0; sessao < SESSOES_POR_PROFISSIONAL; sessao++) {
      const minutos = 8 * 60 + sessao * 40
      const hora = String(Math.floor(minutos / 60)).padStart(2, '0')
      const minuto = String(minutos % 60).padStart(2, '0')
      cards.push(
        cardFicticio({
          id: profissional * 100 + sessao,
          profissional_id: profissional,
          inicio: `${DIA_FICTICIO} ${hora}:${minuto}`,
          fim: `${DIA_FICTICIO} ${hora}:${minuto}`,
          paciente: { id: profissional * 100 + sessao, nome: `Paciente Fictício ${sessao}`, nome_social: null },
        }),
      )
    }
  }
  return cards
}

const CONFIG: ConfiguracaoAgenda = {
  granularidadeMin: 40,
  fimDeSemana: 'nenhum',
  visaoPadrao: 'geral',
  janelaPadraoInicio: '08:00',
  janelaPadraoFim: '19:00',
  timezone: 'America/Sao_Paulo',
  responsavelTecnicoObrigatorio: false,
  statusAoSalvarEvolucao: 0,
  arrastarParaRemarcar: false,
}

describe('Agenda — piso de performance §16', () => {
  it('deve montar a grade de 20 profissionais × dia cheio sem perder card', () => {
    // ARRANGE: 320 agendamentos, o pior caso real da clínica
    const cards = diaCheio()
    expect(cards).toHaveLength(320)

    // ACT: o cálculo puro é o que carrega o custo (a renderização é burra)
    const grade = montarGrade({
      visao: 'geral',
      data: DIA_FICTICIO,
      agendamentos: cards,
      profissionais: vinteProfissionais(),
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: 20 colunas × 16 linhas, e todo card posicionado
    expect(grade.colunas).toHaveLength(20)
    expect(grade.linhas).toHaveLength(17)
    const posicionados = grade.linhas.flatMap((linha) =>
      linha.celulas.flatMap((celula) => celula.cards),
    )
    expect(posicionados).toHaveLength(320)
  })

  it('deve renderizar a grade cheia completa e interativa', async () => {
    // ARRANGE
    servidor.use(...handlersDaAgenda(diaCheio()))
    servidor.use(
      // a grade lê da SELEÇÃO (sob `agenda.ver`), não mais de `/profissionais`
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({ ...SELECAO_FICTICIA, profissionais: vinteProfissionais() }),
      ),
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({
          configuracoes: [
            { chave: 'agenda.granularidade_min', tipo: 'int', valor: 40 },
            { chave: 'agenda.visao_padrao', tipo: 'string', valor: 'geral' },
            { chave: 'agenda.janela_padrao_inicio', tipo: 'string', valor: '08:00' },
            { chave: 'agenda.janela_padrao_fim', tipo: 'string', valor: '19:00' },
          ],
        }),
      ),
    )

    // ACT
    const usuario = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/agenda?visao=geral&data=${DIA_FICTICIO}`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByRole('table')

    // ASSERT: os 320 cards estão na tela (nenhum sumiu por conta do volume)
    expect(screen.getAllByRole('article')).toHaveLength(320)
    expect(screen.getAllByRole('columnheader')).toHaveLength(21) // 20 + Horário

    // ACT + ASSERT: e a grade cheia RESPONDE — a spec pede interatividade, não
    // só pintura (um clique com 320 cards na árvore muda a data de verdade)
    await usuario.click(screen.getByRole('button', { name: 'Próximo período' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Data da agenda')).toHaveValue('14/07/2026')
    })
  }, 30000)
})
