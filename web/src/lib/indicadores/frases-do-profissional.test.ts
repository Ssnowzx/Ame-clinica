import { describe, expect, it } from 'vitest'

import type { Frase } from '@/lib/indicadores/frases'
import type { BaseDoPainel, ParDoPainel } from '@/tipos'

import {
  ATENDIMENTOS,
  FALTAS,
  aAgendaDe,
  atendimentosDe,
  comQuem,
  diaDeHojeDoPeriodo,
  fraseDaBaseDoFinanceiro,
  fraseDaOcupacaoDoProfissional,
  fraseDasEvolucoesAtrasadas,
  fraseDasHorasOciosas,
  perdasDoMes,
  tituloDaMaiorParteDoRecebido,
  tituloDaPerda,
  tituloDaTendenciaDaContagem,
  tituloDaTendenciaDoRecebidoDoProfissional,
  tituloDasSessoesPorConvenio,
  tituloDoDiaMaisCheio,
  tituloDoSemPagamento,
  type VozDaFicha,
} from '@/lib/indicadores/frases-do-profissional'
import { painelDaAgendaFicticio, painelDaEquipeFicticio, periodoFicticio } from '@/test/dados-paineis'
import { linhaDeProdutividadeFicticia } from '@/test/dados-painel-do-profissional'

const PROPRIA: VozDaFicha = { ehProprio: true, nome: 'Ana Fictícia' }
const ALHEIA: VozDaFicha = { ehProprio: false, nome: 'Ana Fictícia' }

/** O cabeçalho do painel: outubro em curso (até o dia 5) contra 1º a 5 de setembro, histórico desde setembro. */
function base(sobrescritas: Partial<BaseDoPainel> = {}): BaseDoPainel {
  return { periodo: periodoFicticio(), inicio_historico: '2026-09', inicio_historico_dia: '2026-09-01', ...sobrescritas }
}

/** Setembro FECHADO, contra agosto inteiro. */
const SETEMBRO_FECHADO = base({
  periodo: periodoFicticio('2026-09', { ate: '2026-09-30', parcial: false, comparado_ate: '2026-08-31' }),
  inicio_historico: '2026-08',
  inicio_historico_dia: '2026-08-01',
})

function textoDaFrase(frase: Frase): string {
  return frase.map((trecho) => trecho.texto).join('')
}

describe('a voz da ficha — com o profissional na própria, com o gestor na alheia', () => {
  it.each([
    [PROPRIA, 'seus atendimentos', 'com você', 'a sua agenda'],
    [ALHEIA, 'atendimentos de Ana Fictícia', 'com Ana Fictícia', 'a agenda de Ana Fictícia'],
  ])('deve escrever a voz de %o', (voz, atendimentos, comQuemTexto, agenda) => {
    // ARRANGE + ACT + ASSERT
    expect(atendimentosDe(voz)).toBe(atendimentos)
    expect(comQuem(voz)).toBe(comQuemTexto)
    expect(aAgendaDe(voz)).toBe(agenda)
  })

  it('deve dizer a base do financeiro, com o convênio de plano fora', () => {
    // ARRANGE + ACT
    const frase = fraseDaBaseDoFinanceiro(PROPRIA)

    // ASSERT — o texto exato da spec profissionais-tela
    expect(frase).toBe('Pagamentos recebidos no caixa da clínica pelos seus atendimentos; convênio de plano não passa por aqui.')
  })
})

describe('tituloDaTendenciaDaContagem — a conclusão pela comparação justa', () => {
  it.each<[string, ParDoPainel<number>, BaseDoPainel, typeof ATENDIMENTOS, string]>([
    ['mês em curso acima', { atual: 24, anterior: 20 }, base(), ATENDIMENTOS, 'Os atendimentos de outubro estão acima do ritmo de setembro'],
    ['mês em curso abaixo', { atual: 15, anterior: 20 }, base(), ATENDIMENTOS, 'Os atendimentos de outubro estão abaixo do ritmo de setembro'],
    ['mês em curso no ritmo (±5%)', { atual: 40, anterior: 41 }, base(), ATENDIMENTOS, 'Os atendimentos de outubro estão no ritmo de setembro'],
    ['faltas em curso', { atual: 3, anterior: 2 }, base(), FALTAS, 'As faltas de outubro estão acima do ritmo de setembro'],
    ['mês fechado com mais', { atual: 61, anterior: 50 }, SETEMBRO_FECHADO, ATENDIMENTOS, 'Setembro teve mais atendimentos que agosto'],
    ['mês fechado quase igual', { atual: 100, anterior: 98 }, SETEMBRO_FECHADO, FALTAS, 'Setembro teve quase as mesmas faltas que agosto'],
    ['zero contra zero', { atual: 0, anterior: 0 }, base(), FALTAS, 'Nenhuma falta em outubro, como em setembro'],
    ['contra zero', { atual: 5, anterior: 0 }, base(), ATENDIMENTOS, 'Os atendimentos de outubro estão acima do ritmo de setembro'],
  ])('deve titular %s', (_caso, par, painel, coisa, esperado) => {
    // ARRANGE + ACT
    const titulo = tituloDaTendenciaDaContagem(par, painel, coisa)

    // ASSERT
    expect(titulo).toBe(esperado)
  })

  it('deve dizer a conclusão SEM comparação no primeiro mês dos indicadores, nunca "0% a mais"', () => {
    // ARRANGE — outubro é o primeiro mês: o anterior não existe
    const painel = base({ inicio_historico: '2026-10', inicio_historico_dia: '2026-10-01' })

    // ACT
    const titulo = tituloDaTendenciaDaContagem({ atual: 24, anterior: null }, painel, ATENDIMENTOS)

    // ASSERT
    expect(titulo).toBe('Outubro, primeiro mês dos indicadores, teve 24 atendimentos realizados até hoje')
  })
})

describe('tituloDaTendenciaDoRecebidoDoProfissional', () => {
  it.each<[string, ParDoPainel<string>, BaseDoPainel, string]>([
    ['em curso acima', { atual: '1840.50', anterior: '1500.00' }, base(), 'O recebido de outubro está acima do ritmo de setembro'],
    ['em curso no ritmo', { atual: '1500.00', anterior: '1520.00' }, base(), 'O recebido de outubro está no ritmo de setembro'],
    ['fechado com menos', { atual: '900.00', anterior: '1500.00' }, SETEMBRO_FECHADO, 'Setembro recebeu menos que agosto'],
    [
      'sem comparação',
      { atual: '1840.50', anterior: null },
      base({ inicio_historico: '2026-10', inicio_historico_dia: '2026-10-01' }),
      'Outubro, primeiro mês dos indicadores, recebeu R$ 1,8 mil até hoje',
    ],
  ])('deve titular %s', (_caso, par, painel, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(tituloDaTendenciaDoRecebidoDoProfissional(par, painel)).toBe(esperado)
  })
})

describe('as frases da semana e da perda', () => {
  it('deve nomear o dia com mais atendimentos — e os dois quando empatam', () => {
    // ARRANGE
    const dias = linhaDeProdutividadeFicticia().por_dia_da_semana
    const empate = dias.map((dia) => ({ ...dia, realizados: dia.dia === 1 || dia.dia === 3 ? 12 : 4 }))

    // ACT + ASSERT
    expect(tituloDoDiaMaisCheio(dias)).toBe('Quarta-feira é o dia com mais atendimentos')
    expect(tituloDoDiaMaisCheio(empate)).toBe('Segunda-feira e quarta-feira são os dias com mais atendimentos')
    expect(tituloDoDiaMaisCheio(dias.map((dia) => ({ ...dia, realizados: 0 })))).toBe('Nenhum atendimento realizado no mês')
  })

  it.each([
    [{ faltas: 9, liberados: 5, em_aberto: 6 }, 'As faltas foram a maior perda do mês'],
    [{ faltas: 2, liberados: 5, em_aberto: 1 }, 'Os horários liberados foram a maior perda do mês'],
    [{ faltas: 1, liberados: 1, em_aberto: 4 }, 'Os horários sem cobrança foram a maior perda do mês'],
    [{ faltas: 3, liberados: 3, em_aberto: 0 }, 'As perdas do mês se dividem por igual'],
    [{ faltas: 0, liberados: 0, em_aberto: 0 }, 'Nenhuma sessão perdida no mês'],
  ])('deve titular as perdas %o', (numeros, esperado) => {
    // ARRANGE
    const perdas = perdasDoMes(linhaDeProdutividadeFicticia(numeros))

    // ACT + ASSERT
    expect(tituloDaPerda(perdas)).toBe(esperado)
  })

  it('deve dizer as horas da grade sem marcação, ou que não sobrou nenhuma', () => {
    // ARRANGE + ACT + ASSERT — 1600 minutos são 26h40
    expect(fraseDasHorasOciosas(linhaDeProdutividadeFicticia())).toBe('Além delas, 26h40 da grade ficaram sem marcação.')
    expect(fraseDasHorasOciosas(linhaDeProdutividadeFicticia({ minutos_ociosos: 0 }))).toBe('Nenhuma hora da grade ficou sem marcação.')
  })

  it('deve ler o dia de hoje do período que o servidor mandou', () => {
    // ARRANGE + ACT + ASSERT — a tela não conta dias
    expect(diaDeHojeDoPeriodo(base())).toBe('5')
  })
})

describe('as frases dos cartões do profissional', () => {
  it.each([
    [{ profissionais: 1, profissionais_com_grade: 1 }, PROPRIA, 'Sessões marcadas sobre os horários da sua grade, já sem feriados e bloqueios.'],
    [{ profissionais: 1, profissionais_com_grade: 1 }, ALHEIA, 'Sessões marcadas sobre os horários da grade de Ana Fictícia, já sem feriados e bloqueios.'],
    [{ profissionais: 1, profissionais_com_grade: 0 }, PROPRIA, 'Sem horário ou especialidade cadastrados não há grade para medir a ocupação.'],
    [{ profissionais: 0, profissionais_com_grade: 0 }, PROPRIA, 'Nenhuma sessão marcada no período.'],
  ])('deve explicar a ocupação %o', (contagem, voz, esperado) => {
    // ARRANGE
    const agenda = painelDaAgendaFicticio({ ocupacao: { atual: 0.8, anterior: 0.75, ...contagem } })

    // ACT + ASSERT
    expect(textoDaFrase(fraseDaOcupacaoDoProfissional(agenda, voz))).toBe(esperado)
  })

  it('deve dizer as evoluções que passaram do prazo, ou que nenhuma passou', () => {
    // ARRANGE
    const equipe = painelDaEquipeFicticio()
    const emDia = { ...equipe, evolucoes: { ...equipe.evolucoes, atrasadas: 0 } }

    // ACT + ASSERT
    expect(textoDaFrase(fraseDasEvolucoesAtrasadas(equipe))).toBe('6 sessões passaram do prazo de 3 dias sem evolução.')
    expect(textoDaFrase(fraseDasEvolucoesAtrasadas(emDia))).toBe('Nenhuma sessão passou do prazo de 3 dias sem evolução.')
  })

  it('deve nomear o convênio com mais sessões, sem nunca eleger a linha "Outros"', () => {
    // ARRANGE — "Outros" é a maior em sessões, mas agrega vários convênios
    const linhas = painelDaAgendaFicticio().por_convenio.map((linha) =>
      linha.outros === undefined ? linha : { ...linha, sessoes: 9999 },
    )

    // ACT + ASSERT
    expect(tituloDasSessoesPorConvenio(linhas)).toBe('Convênio Fictício Alfa concentra a maior parte das sessões')
    expect(tituloDasSessoesPorConvenio([])).toBe('Ainda não há sessões que já passaram')
  })

  it.each([
    [[{ rotulo: 'Pix', valor: '1200.00' }, { rotulo: 'Cartão', valor: '640.50' }], 'Pix trouxe a maior parte do recebido'],
    [[{ rotulo: 'Pix', valor: '100.00' }, { rotulo: 'Dinheiro', valor: '100.00' }], 'Pix e Dinheiro dividem a maior parte do recebido'],
    [[], 'Nenhum pagamento recebido no período'],
  ])('deve titular a maior parte do recebido %o', (fatias, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(tituloDaMaiorParteDoRecebido(fatias)).toBe(esperado)
  })

  it.each([
    [0, 'Todas as sessões realizadas no mês têm pagamento'],
    [1, '1 sessão realizada no mês ainda sem pagamento'],
    [2, '2 sessões realizadas no mês ainda sem pagamento'],
  ])('deve titular %s sessões sem pagamento', (quantidade, esperado) => {
    // ARRANGE + ACT + ASSERT
    expect(tituloDoSemPagamento(quantidade)).toBe(esperado)
  })
})
