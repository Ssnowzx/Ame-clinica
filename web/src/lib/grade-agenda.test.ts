import { describe, expect, it } from 'vitest'

import { dataEhValida, diasDaSemanaVisiveis, feriadoDoDia, montarGrade, ocupaOHorario } from '@/lib/grade-agenda'
import type {
  CardAgendamento,
  ConfiguracaoAgenda,
  FeriadoDaAgenda,
  HorariosPorDia,
  ProfissionalDaAgenda,
} from '@/tipos'

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

/** Horários iguais em todos os dias da semana (a forma dos fixtures antigos de janela única). */
function horariosTodosOsDias(inicio: string, fim: string): HorariosPorDia {
  const mapa: HorariosPorDia = {}
  for (let dia = 1; dia <= 7; dia++) {
    mapa[String(dia)] = [{ inicio, fim }]
  }
  return mapa
}

/** Horários só nos dias informados (ISO), num intervalo único (08:00–12:00 por padrão). */
function horariosNosDias(dias: number[], inicio = '08:00', fim = '12:00'): HorariosPorDia {
  const mapa: HorariosPorDia = {}
  for (const dia of dias) {
    mapa[String(dia)] = [{ inicio, fim }]
  }
  return mapa
}

function profissional(sobrescritas: Partial<ProfissionalDaAgenda> = {}): ProfissionalDaAgenda {
  return {
    id: 1,
    nome: 'Profissional Fictício',
    foto_versao: null,
    // horário histórico do fixture: 08:00–12:00 em todos os dias
    horarios: horariosTodosOsDias('08:00', '12:00'),
    obs: null,
    especialidades: [],
    ...sobrescritas,
  }
}

function card(sobrescritas: Partial<CardAgendamento> = {}): CardAgendamento {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    tipo: 'atendimento',
    profissional_id: 1,
    paciente_id: 10,
    tratamento_id: 5,
    status_id: 1,
    inicio: '2026-07-13 08:00',
    fim: '2026-07-13 08:40',
    duracao_minutos: 40,
    is_reposicao: false,
    paciente: { id: 10, nome: 'Paciente Fictício', nome_social: null },
    especialidade: { id: 1, nome: 'Fonoaudiologia', cor: '#A85550' },
    status: { id: 1, nome: 'Em Aberto', cor: '#64748B', cor_borda: null, tipo: 'circle-dashed' },
    profissional: { id: 1, nome: 'Profissional Fictício' },
    sala: null,
    tratamento_saldo: 9,
    tratamento_total: 12,
    tratamento_realce: 'nenhum' as const,
    convenio: { id: 1, nome: 'Convênio Fictício', particular: false },
    ...sobrescritas,
  }
}

// 2026-07-13 é uma segunda-feira
const SEGUNDA = '2026-07-13'

describe('dataEhValida — a URL não é confiável (SEC-R1)', () => {
  it('deve aceitar data de calendário real', () => {
    // ARRANGE + ACT + ASSERT
    expect(dataEhValida('2026-07-13')).toBe(true)
    expect(dataEhValida('2028-02-29')).toBe(true) // bissexto
  })

  it('deve rejeitar lixo e data inexistente sem lançar', () => {
    // ARRANGE: valores que chegariam pela query string
    for (const payload of ['banana', '2026-02-30', '2026-13-01', '13/07/2026', '', null, 42, '2026-7-1']) {
      // ACT + ASSERT: sem isto, a aritmética de datas derrubaria o render inteiro
      expect(dataEhValida(payload)).toBe(false)
    }
  })
})

describe('montarGrade — totalidade (SEC-R3)', () => {
  it('deve terminar mesmo com granularidade corrompida', () => {
    // ARRANGE: config absurda (0 faria o laço não terminar)
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional()],
      feriados: [],
      config: { ...CONFIG, granularidadeMin: 0 },
    })

    // ASSERT: a função se defende sozinha — cota de 1 minuto
    expect(grade.linhas.length).toBe(240) // 08:00–12:00 minuto a minuto
  }, 5000)

  it('deve terminar com granularidade negativa', () => {
    // ARRANGE + ACT
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional()],
      feriados: [],
      config: { ...CONFIG, granularidadeMin: -30 },
    })

    // ASSERT
    expect(grade.linhas.length).toBeGreaterThan(0)
  }, 5000)
})

describe('montarGrade — eixo de horários', () => {
  it('deve avançar as linhas no passo da granularidade configurada', () => {
    // ARRANGE + ACT
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional()],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: 08:00–12:00 de 40 em 40 minutos
    expect(grade.linhas.map((linha) => linha.horario)).toEqual([
      '08:00',
      '08:40',
      '09:20',
      '10:00',
      '10:40',
      '11:20',
    ])
  })

  it('deve respeitar outra granularidade sem tocar em componente', () => {
    // ARRANGE: regra de tela é DADO (§13)
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional({ horarios: horariosTodosOsDias('08:00', '09:00') })],
      feriados: [],
      config: { ...CONFIG, granularidadeMin: 30 },
    })

    // ASSERT
    expect(grade.linhas.map((linha) => linha.horario)).toEqual(['08:00', '08:30'])
  })

  it('deve usar a janela padrão da clínica quando o profissional não tem horários', () => {
    // ARRANGE + ACT
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional({ horarios: {} })],
      feriados: [],
      config: { ...CONFIG, granularidadeMin: 60 },
    })

    // ASSERT: 08:00 → 19:00 (padrão), 11 linhas
    expect(grade.linhas).toHaveLength(11)
    expect(grade.linhas[0].horario).toBe('08:00')
    expect(grade.linhas.at(-1)?.horario).toBe('18:00')
  })
})

describe('montarGrade — indisponibilidade fora da janela', () => {
  it('deve marcar como indisponível o horário fora da janela do profissional', () => {
    // ARRANGE: A atende até 12:00; B até 19:00 — a grade vai até 19:00
    const grade = montarGrade({
      visao: 'geral',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [
        profissional({ id: 1, nome: 'Profissional A', horarios: horariosTodosOsDias('08:00', '12:00') }),
        profissional({ id: 2, nome: 'Profissional B', horarios: horariosTodosOsDias('08:00', '19:00') }),
      ],
      feriados: [],
      config: { ...CONFIG, granularidadeMin: 60 },
    })

    // ACT: a linha das 13:00
    const linha = grade.linhas.find((item) => item.horario === '13:00')

    // ASSERT: indisponível na coluna de A, disponível na de B
    expect(linha?.celulas[0].indisponivel).toBe(true)
    expect(linha?.celulas[1].indisponivel).toBe(false)
  })
})

describe('montarGrade — colunas por visão', () => {
  it('deve usar um profissional por coluna na visão geral', () => {
    // ARRANGE + ACT
    const grade = montarGrade({
      visao: 'geral',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [
        profissional({ id: 1, nome: 'Profissional A' }),
        profissional({ id: 2, nome: 'Profissional B' }),
      ],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT
    expect(grade.colunas.map((coluna) => coluna.rotulo)).toEqual(['Profissional A', 'Profissional B'])
  })

  it('deve desenhar uma coluna por profissional que a seleção entregou', () => {
    // ARRANGE — quem filtra o DESLIGADO é o SERVIDOR (`/agenda/selecao` só devolve ativos), e
    // isso é provado lá (`AgendaSelecaoTest`). Aqui a grade desenha o que recebe: um filtro por
    // `ativo` nesta camada seria um filtro que nunca filtra — código morto que mente sobre o que
    // garante, e que a próxima pessoa leria como "a grade protege contra isso".
    const grade = montarGrade({
      visao: 'geral',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional({ id: 1 }), profissional({ id: 2 })],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT
    expect(grade.colunas).toHaveLength(2)
  })

  it('deve usar um dia por coluna na visão semana, sem fim de semana', () => {
    // ARRANGE + ACT: config default = 'nenhum'
    const grade = montarGrade({
      visao: 'semana',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional()],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: só os 5 dias úteis
    expect(grade.colunas).toHaveLength(5)
    expect(grade.colunas[0].data).toBe('2026-07-13')
    expect(grade.colunas.at(-1)?.data).toBe('2026-07-17')
  })

  it('deve incluir sábado e domingo quando a clínica configura ambos', () => {
    // ARRANGE + ACT
    const grade = montarGrade({
      visao: 'semana',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional()],
      feriados: [],
      config: { ...CONFIG, fimDeSemana: 'ambos' },
    })

    // ASSERT
    expect(grade.colunas).toHaveLength(7)
  })

  it('deve incluir só o sábado quando configurado sabado', () => {
    // ARRANGE + ACT
    const dias = diasDaSemanaVisiveis(SEGUNDA, { ...CONFIG, fimDeSemana: 'sabado' })

    // ASSERT
    expect(dias).toHaveLength(6)
    expect(dias.at(-1)).toBe('2026-07-18') // sábado
  })
})

describe('feriadoDoDia', () => {
  // Como a SELEÇÃO os entrega: só os ATIVOS, sem o campo `ativo` (o servidor já filtrou).
  const feriados: FeriadoDaAgenda[] = [
    { id: 1, nome: 'Natal', data: '2020-12-25', recorrente: true },
    { id: 2, nome: 'Ponte da clínica', data: '2026-07-14', recorrente: false },
  ]

  it('deve reconhecer feriado recorrente cadastrado em outro ano', () => {
    // ARRANGE + ACT + ASSERT: só dia e mês importam
    expect(feriadoDoDia('2026-12-25', feriados)).toBe('Natal')
    expect(feriadoDoDia('2030-12-25', feriados)).toBe('Natal')
  })

  it('deve reconhecer feriado de data fixa', () => {
    expect(feriadoDoDia('2026-07-14', feriados)).toBe('Ponte da clínica')
  })

  it('deve devolver null no dia que não é feriado', () => {
    // O feriado DESATIVADO nem chega aqui: quem o descarta é o servidor
    // (`/agenda/selecao` filtra, e o `AgendaSelecaoTest` prova). Filtrar de novo no cliente, sobre
    // um campo que a API não manda, foi o que fez a grade parar de pintar TODOS os feriados.
    expect(feriadoDoDia('2026-07-15', feriados)).toBeNull()
  })

  it('deve marcar a coluna do dia com o nome do feriado na visão semana', () => {
    // ARRANGE + ACT
    const grade = montarGrade({
      visao: 'semana',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional()],
      feriados,
      config: CONFIG,
    })

    // ASSERT
    expect(grade.colunas.find((coluna) => coluna.data === '2026-07-14')?.feriado).toBe('Ponte da clínica')
    expect(grade.colunas[0].feriado).toBeUndefined()
  })
})

describe('montarGrade — posicionamento dos cards', () => {
  it('deve colocar o card no slot do seu horário', () => {
    // ARRANGE + ACT
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [card({ inicio: '2026-07-13 08:40', fim: '2026-07-13 09:20' })],
      profissionais: [profissional()],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT
    expect(grade.linhas[0].celulas[0].cards).toHaveLength(0)
    expect(grade.linhas[1].celulas[0].cards).toHaveLength(1)
    expect(grade.vazia).toBe(false)
  })

  it('deve ancorar no slot que contém o card quando ele começa fora do passo', () => {
    // ARRANGE: encaixe às 08:15 numa grade de 40 min (o card NÃO pode sumir)
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [card({ inicio: '2026-07-13 08:15', fim: '2026-07-13 08:55' })],
      profissionais: [profissional()],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: aparece no slot das 08:00
    expect(grade.linhas[0].celulas[0].cards).toHaveLength(1)
  })

  it('deve fazer a sessão longa ocupar os slots que cobre', () => {
    // ARRANGE + ACT: 80 min numa grade de 40 → 2 slots
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [card({ duracao_minutos: 80, fim: '2026-07-13 09:20' })],
      profissionais: [profissional()],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: o slot seguinte NÃO pode parecer livre para quem lê a grade
    expect(grade.linhas[0].celulas[0].alturaEmSlots).toBe(2)
    expect(grade.linhas[1].celulas[0].continuacao).toBe(true)
  })

  it('deve aparar a altura no próximo card, sem sobrepor', () => {
    // ARRANGE: sessão de 80 min seguida de outra às 08:40 (dado inconsistente
    // vindo do banco não pode fazer a grade se sobrepor)
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [
        card({ id: 1, duracao_minutos: 80, inicio: '2026-07-13 08:00', fim: '2026-07-13 09:20' }),
        card({ id: 2, inicio: '2026-07-13 08:40', fim: '2026-07-13 09:20' }),
      ],
      profissionais: [profissional()],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: o primeiro card é aparado; o segundo continua visível
    expect(grade.linhas[0].celulas[0].alturaEmSlots).toBe(1)
    expect(grade.linhas[1].celulas[0].continuacao).toBe(false)
    expect(grade.linhas[1].celulas[0].cards[0].id).toBe(2)
  })

  it('deve exibir agendamento ANTES da janela do profissional (B-01)', () => {
    // ARRANGE: a API não valida a janela na escrita — um encaixe às 07:30 é
    // criável hoje pela recepção. Antes, ele SUMIA e a grade se dizia vazia.
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [card({ inicio: '2026-07-13 07:30', fim: '2026-07-13 08:10' })],
      profissionais: [profissional()], // janela 08:00–12:00
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: o eixo estica em passos inteiros e o card aparece — no slot certo
    expect(grade.vazia).toBe(false)
    const linhaDoCard = grade.linhas.find((linha) => linha.celulas[0].cards.length > 0)
    expect(linhaDoCard?.horario).toBe('07:20')
    // o slot extra é fora da janela: tratamento visual de indisponível
    expect(linhaDoCard?.celulas[0].indisponivel).toBe(true)
  })

  it('deve exibir agendamento DEPOIS da janela, sem mentir o horário (B-01)', () => {
    // ARRANGE: antes, um card às 20:00 caía no último slot (11:20) — a grade
    // dizia um horário e o card, outro
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [card({ inicio: '2026-07-13 20:00', fim: '2026-07-13 20:40' })],
      profissionais: [profissional()], // janela 08:00–12:00
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: o card está na linha das 20:00
    const linhaDoCard = grade.linhas.find((linha) => linha.celulas[0].cards.length > 0)
    expect(linhaDoCard?.horario).toBe('20:00')
  })

  it('deve separar os cards por profissional na visão geral', () => {
    // ARRANGE + ACT
    const grade = montarGrade({
      visao: 'geral',
      data: SEGUNDA,
      agendamentos: [card({ id: 1, profissional_id: 1 }), card({ id: 2, profissional_id: 2 })],
      profissionais: [profissional({ id: 1 }), profissional({ id: 2 })],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT
    expect(grade.linhas[0].celulas[0].cards[0].id).toBe(1)
    expect(grade.linhas[0].celulas[1].cards[0].id).toBe(2)
  })

  it('deve separar os cards por dia na visão semana', () => {
    // ARRANGE + ACT
    const grade = montarGrade({
      visao: 'semana',
      data: SEGUNDA,
      agendamentos: [
        card({ id: 1, inicio: '2026-07-13 08:00', fim: '2026-07-13 08:40' }),
        card({ id: 2, inicio: '2026-07-15 08:00', fim: '2026-07-15 08:40' }),
      ],
      profissionais: [profissional()],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: segunda e quarta
    expect(grade.linhas[0].celulas[0].cards[0].id).toBe(1)
    expect(grade.linhas[0].celulas[2].cards[0].id).toBe(2)
  })

  it('deve marcar a grade como vazia mantendo o eixo de horários', () => {
    // ARRANGE + ACT: dia sem agendamentos
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional()],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT: vazia, mas a grade continua legível
    expect(grade.vazia).toBe(true)
    expect(grade.linhas.length).toBeGreaterThan(0)
  })
})

describe('montarGrade — horários por dia do profissional', () => {
  // 2026-07-13 é segunda (ISO 1); 2026-07-12 é domingo (ISO 7, JS getDay 0).
  const DOMINGO = '2026-07-12'

  it('deve marcar a coluna indisponível quando o profissional não atende no dia (visão Dia)', () => {
    // ARRANGE — atende terça(2) e quinta(4), a tela mostra uma SEGUNDA
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional({ horarios: horariosNosDias([2, 4]) })],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT — coluna marcada e TODAS as células indisponíveis (o slot não convida a marcar)
    expect(grade.colunas[0].naoAtende).toBe(true)
    expect(grade.linhas.every((linha) => linha.celulas[0].indisponivel)).toBe(true)
  })

  it('deve manter disponível o dia em que o profissional atende', () => {
    // ARRANGE — atende segunda(1), a tela mostra uma SEGUNDA
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [profissional({ horarios: horariosNosDias([1]) })],
      feriados: [],
      config: CONFIG,
    })

    // ASSERT — não marcada, e há slot livre dentro da janela
    expect(grade.colunas[0].naoAtende).toBe(false)
    expect(grade.linhas.some((linha) => !linha.celulas[0].indisponivel)).toBe(true)
  })

  it('deve pintar indisponível o VAZIO entre turnos (almoço)', () => {
    // ARRANGE — segunda com turno partido 08:00–12:00 e 14:00–18:00
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: [],
      profissionais: [
        profissional({
          horarios: { '1': [{ inicio: '08:00', fim: '12:00' }, { inicio: '14:00', fim: '18:00' }] },
        }),
      ],
      feriados: [],
      config: { ...CONFIG, granularidadeMin: 60 },
    })

    // ASSERT — manhã (10:00) e tarde (15:00) disponíveis; o almoço (13:00, entre os turnos) indisponível
    expect(grade.linhas.find((linha) => linha.horario === '10:00')?.celulas[0].indisponivel).toBe(false)
    expect(grade.linhas.find((linha) => linha.horario === '13:00')?.celulas[0].indisponivel).toBe(true)
    expect(grade.linhas.find((linha) => linha.horario === '15:00')?.celulas[0].indisponivel).toBe(false)
  })

  it('deve mapear o DOMINGO (ISO 7 × getDay 0) sem off-by-one', () => {
    // ARRANGE — o dia da tela é um DOMINGO
    const atendeDomingo = montarGrade({
      visao: 'dia', data: DOMINGO, agendamentos: [],
      profissionais: [profissional({ horarios: horariosNosDias([7]) })], feriados: [], config: CONFIG,
    })
    const soSegunda = montarGrade({
      visao: 'dia', data: DOMINGO, agendamentos: [],
      profissionais: [profissional({ horarios: horariosNosDias([1]) })], feriados: [], config: CONFIG,
    })

    // ASSERT — quem atende domingo(7) fica disponível; quem só atende segunda(1) fica indisponível
    expect(atendeDomingo.colunas[0].naoAtende).toBe(false)
    expect(soSegunda.colunas[0].naoAtende).toBe(true)
  })

  it('deve atender todos os dias quando não há horários (retrocompat)', () => {
    const grade = montarGrade({
      visao: 'dia', data: SEGUNDA, agendamentos: [],
      profissionais: [profissional({ horarios: {} })], feriados: [], config: CONFIG,
    })

    expect(grade.colunas[0].naoAtende).toBe(false)
  })

  it('deve marcar os dias sem o profissional na visão Semana', () => {
    // ARRANGE — atende terça(2) e quinta(4); a Semana mostra seg..sex (fim de semana nenhum)
    const grade = montarGrade({
      visao: 'semana', data: SEGUNDA, agendamentos: [],
      profissionais: [profissional({ horarios: horariosNosDias([2, 4]) })], feriados: [], config: CONFIG,
    })

    // ASSERT — a coluna da segunda é indisponível; a da terça, não
    const segunda = grade.colunas.find((coluna) => coluna.rotulo.startsWith('segunda'))
    const terca = grade.colunas.find((coluna) => coluna.rotulo.startsWith('terça'))
    expect(segunda?.naoAtende).toBe(true)
    expect(terca?.naoAtende).toBe(false)
  })
})

describe('ocupaOHorario — a grade fala a mesma frase do servidor', () => {
  it('deve dizer que a situação que libera o horário NÃO ocupa', () => {
    // ARRANGE — é o "Desmarcado pelo Profissional" da clínica
    const liberado = card({ status: { id: 7, nome: 'Desmarcado', cor: '#64748B', cor_borda: null, tipo: null, ocupa_horario: false } })

    // ACT + ASSERT
    expect(ocupaOHorario(liberado)).toBe(false)
  })

  it('deve tratar bloqueio como ocupante mesmo com situação que libera', () => {
    // ARRANGE — o servidor conta bloqueio por `tipo`, antes de olhar a situação
    const bloqueio = card({
      tipo: 'bloqueio',
      status: { id: 7, nome: 'Desmarcado', cor: '#64748B', cor_borda: null, tipo: null, ocupa_horario: false },
    })

    // ACT + ASSERT
    expect(ocupaOHorario(bloqueio)).toBe(true)
  })

  it('deve ocupar quando o card não tem situação', () => {
    // ARRANGE
    const semStatus = card({ status: null })

    // ACT + ASSERT — sem o dado, a posição segura é recusar o horário
    expect(ocupaOHorario(semStatus)).toBe(true)
  })

  it('deve ocupar quando o payload não traz a flag', () => {
    // ARRANGE — deploy fora de ordem: API velha, tela nova
    const semFlag = card({ status: { id: 1, nome: 'Em Aberto', cor: '#64748B', cor_borda: null, tipo: null } })

    // ACT + ASSERT
    expect(ocupaOHorario(semFlag)).toBe(true)
  })
})

describe('montarGrade — o horário que a situação liberou volta a ser marcável', () => {
  /** Um card da segunda às 08:00, com a flag pedida. */
  function cardDaSegunda(ocupa: boolean, sobrescritas: Partial<CardAgendamento> = {}): CardAgendamento {
    return card({
      inicio: `${SEGUNDA} 08:00`,
      fim: `${SEGUNDA} 08:40`,
      status: { id: 9, nome: 'Situação Fictícia', cor: '#64748B', cor_borda: null, tipo: null, ocupa_horario: ocupa },
      ...sobrescritas,
    })
  }

  function celulaDas0800(agendamentos: CardAgendamento[]) {
    const grade = montarGrade({
      visao: 'dia', data: SEGUNDA, agendamentos,
      profissionais: [profissional()], feriados: [], config: CONFIG,
    })

    return grade.linhas[0].celulas[0]
  }

  it('deve deixar a célula DESocupada quando o único card libera o horário', () => {
    // ARRANGE + ACT
    const celula = celulaDas0800([cardDaSegunda(false)])

    // ASSERT — o card continua desenhado; o slot volta a aceitar marcação
    expect(celula.cards).toHaveLength(1)
    expect(celula.ocupada).toBe(false)
  })

  it('deve manter a célula ocupada quando UM dos cards segura o horário', () => {
    // ARRANGE — sobreposição do eixo paciente (`avisar`): um liberado, um em aberto
    const celula = celulaDas0800([cardDaSegunda(false), cardDaSegunda(true, { id: 2 })])

    // ACT + ASSERT — basta um ocupante
    expect(celula.cards).toHaveLength(2)
    expect(celula.ocupada).toBe(true)
  })

  it('deve manter a célula ocupada com card comum', () => {
    // ARRANGE + ACT
    const celula = celulaDas0800([cardDaSegunda(true)])

    // ASSERT
    expect(celula.ocupada).toBe(true)
  })

  it('deve deixar o slot seguinte livre quando o card longo não ocupa', () => {
    // ARRANGE — 80 min numa grade de 40: com rowSpan, as 08:40 ficariam sem `<td>`
    const longo = cardDaSegunda(false, { fim: `${SEGUNDA} 09:20`, duracao_minutos: 80 })

    const grade = montarGrade({
      visao: 'dia', data: SEGUNDA, agendamentos: [longo],
      profissionais: [profissional()], feriados: [], config: CONFIG,
    })

    // ASSERT — a célula do card mede UM slot e as 08:40 continuam alcançáveis
    expect(grade.linhas[0].celulas[0].alturaEmSlots).toBe(1)
    expect(grade.linhas[1].celulas[0].continuacao).toBe(false)
    expect(grade.linhas[1].celulas[0].ocupada).toBe(false)
  })

  it('deve continuar cobrindo o slot seguinte quando o card longo ocupa', () => {
    // ARRANGE — o par do teste acima: sem ele, "mede um slot" passaria por acidente
    const longo = cardDaSegunda(true, { fim: `${SEGUNDA} 09:20`, duracao_minutos: 80 })

    const grade = montarGrade({
      visao: 'dia', data: SEGUNDA, agendamentos: [longo],
      profissionais: [profissional()], feriados: [], config: CONFIG,
    })

    // ASSERT
    expect(grade.linhas[0].celulas[0].alturaEmSlots).toBe(2)
    expect(grade.linhas[1].celulas[0].continuacao).toBe(true)
  })
})

describe('montarGrade — capacidade do atendimento em grupo', () => {
  /** N cards ocupantes no mesmo slot do mesmo profissional, cada um de uma criança. */
  function grupoDe(quantos: number): CardAgendamento[] {
    return Array.from({ length: quantos }, (_, i) =>
      card({ id: i + 1, paciente_id: 100 + i, paciente: { id: 100 + i, nome: `Criança ${i + 1}`, nome_social: null } }),
    )
  }

  function primeiraCelula(cards: CardAgendamento[], capacidade?: number) {
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: cards,
      profissionais: [profissional({ atendimentos_simultaneos: capacidade })],
      feriados: [],
      config: CONFIG,
    })
    return grade.linhas[0].celulas[0]
  }

  it('deve continuar convidando enquanto o grupo tem vaga', () => {
    // ARRANGE: um profissional de capacidade 4 com duas crianças às 08:00
    // ACT
    const celula = primeiraCelula(grupoDe(2), 4)

    // ASSERT: sem isto a recepção marca a 1ª e fica sem onde clicar para a 2ª
    expect(celula.ocupada).toBe(false)
    expect(celula.cards).toHaveLength(2)
  })

  it('deve parar de convidar quando o grupo lota', () => {
    // ARRANGE + ACT
    const celula = primeiraCelula(grupoDe(4), 4)

    // ASSERT
    expect(celula.ocupada).toBe(true)
  })

  it('deve tomar a célula inteira no bloqueio, qualquer que seja a capacidade', () => {
    // ARRANGE: bloqueio marca AUSÊNCIA — não divide vaga com ninguém
    const bloqueio = card({ id: 9, tipo: 'bloqueio', status: null })

    // ACT
    const celula = primeiraCelula([bloqueio], 4)

    // ASSERT
    expect(celula.ocupada).toBe(true)
  })

  it('deve valer uma vaga quando o payload não traz a capacidade', () => {
    // ARRANGE: quem administra a fila recebe o profissional sem o campo, e um deploy fora de
    // ordem serve o payload anterior — a posição segura é a de sempre
    // ACT
    const celula = primeiraCelula(grupoDe(1), undefined)

    // ASSERT
    expect(celula.ocupada).toBe(true)
  })

  it('deve ignorar capacidade absurda vinda de payload adulterado', () => {
    // ARRANGE + ACT: 0 e negativo não podem destravar nem travar a grade
    // ASSERT
    expect(primeiraCelula(grupoDe(1), 0).ocupada).toBe(true)
    expect(primeiraCelula(grupoDe(1), -3).ocupada).toBe(true)
  })

  it('deve manter o card liberado fora da conta de vagas', () => {
    // ARRANGE: card desmarcado não segura o horário — e também não consome vaga
    const desmarcado = card({
      id: 7,
      status: { id: 2, nome: 'Desmarcado', cor: '#94A3B8', cor_borda: null, tipo: 'circle-dashed', ocupa_horario: false },
    })

    // ACT: 3 ocupantes + 1 liberado numa capacidade 4
    const celula = primeiraCelula([...grupoDe(3), desmarcado], 4)

    // ASSERT
    expect(celula.ocupada).toBe(false)
    expect(celula.cards).toHaveLength(4)
  })
})

describe('montarGrade — a lotação conta por SOBREPOSIÇÃO, como o servidor', () => {
  /** A célula de um horário qualquer da coluna única. */
  function celulaDe(horario: string, cards: CardAgendamento[], capacidade?: number) {
    const grade = montarGrade({
      visao: 'dia',
      data: SEGUNDA,
      agendamentos: cards,
      profissionais: [profissional({ atendimentos_simultaneos: capacidade })],
      feriados: [],
      config: CONFIG,
    })
    const linha = grade.linhas.find((item) => item.horario === horario)
    return linha?.celulas[0]
  }

  it('deve contar o card longo que vem de cima antes de convidar', () => {
    // ARRANGE: capacidade 2, um card de 80 min das 08:00 e outro de 40 das 08:40.
    // Contando só quem COMEÇA no slot, a célula das 08:40 tinha 1 de 2 e convidava —
    // enquanto o servidor contava 2 sobrepostos e devolvia 422. A tela convidava onde o
    // servidor recusa: a direção perigosa, e sem saída pelo formulário.
    const longo = card({ id: 1, duracao_minutos: 80, inicio: '2026-07-13 08:00', fim: '2026-07-13 09:20' })
    const curto = card({ id: 2, paciente_id: 11, inicio: '2026-07-13 08:40', fim: '2026-07-13 09:20' })

    // ACT
    const celula = celulaDe('08:40', [longo, curto], 2)

    // ASSERT
    expect(celula?.ocupada).toBe(true)
  })

  it('deve manter a vaga do grupo quando o card longo ainda deixa espaço', () => {
    // ARRANGE: o mesmo arranjo com capacidade 4 — 2 de 4, ainda cabe
    const longo = card({ id: 1, duracao_minutos: 80, inicio: '2026-07-13 08:00', fim: '2026-07-13 09:20' })
    const curto = card({ id: 2, paciente_id: 11, inicio: '2026-07-13 08:40', fim: '2026-07-13 09:20' })

    // ACT
    const celula = celulaDe('08:40', [longo, curto], 4)

    // ASSERT
    expect(celula?.ocupada).toBe(false)
  })

  it('deve segurar a folga inteira, mesmo com a altura aparada por um card próprio', () => {
    // ARRANGE: bloqueio de 08:00 às 11:20 e um atendimento às 08:40. O `rowSpan` do bloqueio
    // é aparado pelo card, e os slots de 09:20 e 10:00 voltavam a oferecer "Marcar às" DENTRO
    // da folga — que o servidor recusa. Pré-existente, agravado pelo grupo: quanto mais cards
    // por coluna, mais o rowSpan é aparado.
    const bloqueio = card({
      id: 1,
      tipo: 'bloqueio',
      status: null,
      duracao_minutos: 200,
      inicio: '2026-07-13 08:00',
      fim: '2026-07-13 11:20',
    })
    const atendimento = card({ id: 2, paciente_id: 11, inicio: '2026-07-13 08:40', fim: '2026-07-13 09:20' })

    // ACT + ASSERT
    expect(celulaDe('09:20', [bloqueio, atendimento], 1)?.ocupada).toBe(true)
    expect(celulaDe('10:00', [bloqueio, atendimento], 1)?.ocupada).toBe(true)
  })
})
