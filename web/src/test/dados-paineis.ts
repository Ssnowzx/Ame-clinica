import { HttpResponse, http as msw } from 'msw'

import { somarMeses } from '@/lib/meses'
import type {
  PainelDaAgenda,
  PainelDaEquipe,
  PainelDoDinheiro,
  PainelDosPacientes,
  PeriodoDoPainel,
} from '@/tipos'

/**
 * Dublês dos PAINÉIS (change indicadores-profissionais) no formato EXATO do contrato D9 — dinheiro
 * em string decimal, taxas de 0 a 1, `anterior` nulo antes do histórico, séries com `null` nos
 * meses antes do sistema. 100% FICTÍCIOS (LGPD): nenhum nome aqui é de pessoa real.
 *
 * O mês padrão é o do exemplo do D9: outubro de 2026, medido até o dia 5 e comparado com 1 a 5 de
 * setembro, com o histórico começando em setembro — no DIA 1º (`inicio_historico_dia`, contrato 1 da
 * rodada 1 do gate), então o comparado está inteiro dentro do histórico e a comparação vale.
 *
 * O painel dos pacientes vem com `pacotes_no_fim` e `fila_de_espera` (quem tem as permissões); para
 * o caso sem elas, `semAsChavesProtegidas` tira as chaves — AUSENTE, como o servidor manda, nunca zero.
 */

export const MES_DO_PAINEL = '2026-10'

/** O histórico fictício começa em 1º de setembro de 2026 — o mês e o dia, como o servidor manda. */
const HISTORICO = { inicio_historico: '2026-09', inicio_historico_dia: '2026-09-01' } as const

/** O período do D9: mês em curso até o dia 5, contra os mesmos dias do anterior. */
export function periodoFicticio(mes = MES_DO_PAINEL, sobrescritas: Partial<PeriodoDoPainel> = {}): PeriodoDoPainel {
  const anterior = somarMeses(mes, -1)

  return {
    mes,
    de: `${mes}-01`,
    ate: `${mes}-05`,
    parcial: true,
    comparado_de: `${anterior}-01`,
    comparado_ate: `${anterior}-05`,
    ...sobrescritas,
  }
}

/** Seis meses terminando no pedido; antes de setembro/2026, nulo (o sistema não existia). */
function seisMeses<T>(mes: string, valor: (mesDoBucket: string) => T): Array<{ mes: string; valor: T }> {
  return Array.from({ length: 6 }, (_, indice) => {
    const mesDoBucket = somarMeses(mes, indice - 5)

    return { mes: mesDoBucket, valor: valor(mesDoBucket) }
  })
}

export function painelDoDinheiroFicticio(sobrescritas: Partial<PainelDoDinheiro> = {}): PainelDoDinheiro {
  return {
    periodo: periodoFicticio(),
    ...HISTORICO,
    recebido: { atual: '7560.60', anterior: '6400.00' },
    a_receber_no_mes: '21300.00',
    em_atraso: { valor: '1240.00', quantidade: 4 },
    valor_medio_sessao: { atual: '85.00', anterior: '80.00' },
    serie_recebido: seisMeses(MES_DO_PAINEL, (mes) =>
      mes < '2026-09' ? null : mes === '2026-09' ? '14500.00' : '7560.60',
    ),
    ...sobrescritas,
  }
}

export function painelDaAgendaFicticio(sobrescritas: Partial<PainelDaAgenda> = {}): PainelDaAgenda {
  return {
    periodo: periodoFicticio(),
    ...HISTORICO,
    ocupacao: { atual: 0.87, anterior: 0.91, profissionais_com_grade: 9, profissionais: 12 },
    realizadas: { atual: 1024, anterior: 966 },
    sessoes_passadas: { atual: 1212, anterior: 1100 },
    faltas: { atual: { quantidade: 73, taxa: 0.0602 }, anterior: { quantidade: 50, taxa: 0.0455 } },
    desmarques: { atual: { quantidade: 109, taxa: 0.0899 }, anterior: { quantidade: 80, taxa: 0.0727 } },
    sem_baixa: 0,
    confirmadas: { atual: { confirmadas: 300, enviados: 480, taxa: 0.625 }, anterior: null },
    status_que_contam: {
      falta: ['Não Compareceu'],
      desmarque: ['Desmarcado pelo Profissional', 'Desmarcado pelo Paciente'],
    },
    faltas_por_dia_semana: [
      { dia: 1, sessoes: 200, faltas: 22, taxa: 0.11 },
      { dia: 2, sessoes: 240, faltas: 12, taxa: 0.05 },
      { dia: 3, sessoes: 250, faltas: 10, taxa: 0.04 },
      { dia: 4, sessoes: 240, faltas: 12, taxa: 0.05 },
      { dia: 5, sessoes: 200, faltas: 14, taxa: 0.07 },
      { dia: 6, sessoes: 82, faltas: 2, taxa: 0.0244 },
    ],
    ocupacao_por_periodo: [
      { dia: 1, periodo: 'manha', marcadas: 120, capacidade: 140, taxa: 0.857 },
      { dia: 1, periodo: 'tarde', marcadas: 110, capacidade: 140, taxa: 0.7857 },
      { dia: 5, periodo: 'manha', marcadas: 100, capacidade: 140, taxa: 0.7143 },
      { dia: 5, periodo: 'tarde', marcadas: 81, capacidade: 140, taxa: 0.5786 },
      { dia: 6, periodo: 'manha', marcadas: 30, capacidade: 40, taxa: 0.75 },
      { dia: 6, periodo: 'tarde', marcadas: 0, capacidade: 0, taxa: null },
    ],
    por_convenio: [
      { nome: 'Convênio Fictício Alfa', particular: false, sessoes: 500, faltas: 30, desmarques: 10, taxa: 0.08 },
      { nome: 'Particular', particular: true, sessoes: 300, faltas: 10, desmarques: 8, taxa: 0.06 },
      { nome: 'Convênio Fictício Beta', particular: false, sessoes: 200, faltas: 20, desmarques: 10, taxa: 0.15 },
      { nome: 'Outros', outros: 4, particular: false, sessoes: 212, faltas: 5, desmarques: 6, taxa: 0.0519 },
    ],
    situacao: [
      { status_id: 4, nome: 'Finalizado com Evolução', cor: '#059669', quantidade: 893 },
      { status_id: 3, nome: 'Finalizado', cor: '#0EA5E9', quantidade: 131 },
      { status_id: 6, nome: 'Desmarcado pelo Paciente', cor: '#9CA3AF', quantidade: 109 },
      { status_id: 5, nome: 'Não Compareceu', cor: '#DC2626', quantidade: 41 },
      { status_id: 7, nome: 'Falta Justificada', cor: '#F59E0B', quantidade: 32 },
    ],
    ...sobrescritas,
  }
}

export function painelDosPacientesFicticio(sobrescritas: Partial<PainelDosPacientes> = {}): PainelDosPacientes {
  return {
    periodo: periodoFicticio(),
    ...HISTORICO,
    ativos: 432,
    novos: { atual: 24, anterior: 20 },
    sairam: { atual: 3, anterior: 1 },
    pacotes_no_fim: 9,
    fila_de_espera: 18,
    // setembro é o mês da IMPORTAÇÃO da virada: 400 cadastros de uma vez
    serie_novos: seisMeses(MES_DO_PAINEL, (mes) => (mes < '2026-09' ? null : mes === '2026-09' ? 400 : 24)).map(
      ({ mes, valor }) => ({ mes, quantidade: valor }),
    ),
    ...sobrescritas,
  }
}

export function painelDaEquipeFicticio(sobrescritas: Partial<PainelDaEquipe> = {}): PainelDaEquipe {
  return {
    periodo: periodoFicticio(),
    ...HISTORICO,
    evolucoes: { em_dia: { atual: 0.94, anterior: 0.9 }, atrasadas: 6, profissionais_com_atraso: 3, sem_evolucao: 255, prazo_dias: 3 },
    profissionais: [
      {
        id: 7,
        nome: 'Profissional Fictício',
        especialidades: ['Fonoaudiologia'],
        tem_grade: true,
        ocupacao: 0.8,
        marcadas: 120,
        realizadas: 100,
        faltas: 6,
        evolucoes_em_dia: 0.95,
        evolucoes_atrasadas: 1,
      },
      {
        id: 9,
        nome: 'Profissional Fictícia Sem Grade',
        especialidades: ['Psicologia'],
        tem_grade: false,
        ocupacao: null,
        marcadas: 12,
        realizadas: 10,
        faltas: 1,
        evolucoes_em_dia: 0.9,
        evolucoes_atrasadas: 0,
      },
    ],
    ...sobrescritas,
  }
}

/**
 * O painel dos pacientes de quem NÃO tem `tratamentos.ver` nem `lista_espera.ver`: as duas chaves
 * protegidas AUSENTES (SEC-IND-01) — o servidor não manda, e a tela não pode tratar como zero.
 */
export function semAsChavesProtegidas(painel: PainelDosPacientes): PainelDosPacientes {
  const { pacotes_no_fim: _pacotes, fila_de_espera: _fila, ...resto } = painel

  return resto
}

/** Handlers dos quatro painéis que ANOTAM cada chamada (a frente e o mês) — para provar quem foi buscado. */
export function paineisQueAnotam(
  respostas: {
    dinheiro?: PainelDoDinheiro
    agenda?: PainelDaAgenda
    pacientes?: PainelDosPacientes
    equipe?: PainelDaEquipe
  } = {},
) {
  const chamadas: string[] = []
  const handler = (frente: string, corpo: object) =>
    msw.get(`/api/indicadores/painel/${frente}`, ({ request }) => {
      chamadas.push(`${frente}?mes=${new URL(request.url).searchParams.get('mes') ?? ''}`)

      return HttpResponse.json(corpo)
    })

  return {
    chamadas,
    handlers: [
      handler('dinheiro', respostas.dinheiro ?? painelDoDinheiroFicticio()),
      handler('agenda', respostas.agenda ?? painelDaAgendaFicticio()),
      handler('pacientes', respostas.pacientes ?? painelDosPacientesFicticio()),
      handler('equipe', respostas.equipe ?? painelDaEquipeFicticio()),
    ],
  }
}
