import { periodoEmPalavras } from '@/lib/datas'
import { dataEhValida, somarDias } from '@/lib/grade-agenda'
import { limitesDoMes, somarMeses } from '@/lib/meses'
import type { EnvelopeDeRelatorio } from '@/tipos'

/**
 * O período dos relatórios: atalhos, contagem de dias e o teto.
 *
 * Tudo aqui é aritmética de STRING `AAAA-MM-DD` — nenhum `new Date()` interpretando fuso.
 * O "hoje" entra por parâmetro e vem de `hojeNaClinica(fuso da clínica)` (design D5): o
 * atalho "mês passado" às 22h de Brasília não pode virar o mês seguinte porque o navegador
 * já está em amanhã UTC.
 */

/** Espelho do teto do servidor (422 acima) — a tela desabilita "Gerar" antes de pedir. */
export const TETO_DE_DIAS_DO_PERIODO = 366

export type AtalhoDePeriodo = 'hoje' | 'este-mes' | 'mes-passado' | 'ultimos-30-dias' | 'ultimos-90-dias' | 'este-ano'

export const ATALHOS_DE_PERIODO: ReadonlyArray<{ valor: AtalhoDePeriodo; rotulo: string }> = [
  // o dia de hoje: o fechamento de caixa confere a gaveta do dia (change `fechamento-de-caixa`)
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'este-mes', rotulo: 'Este mês' },
  { valor: 'mes-passado', rotulo: 'Mês passado' },
  { valor: 'ultimos-30-dias', rotulo: 'Últimos 30 dias' },
  { valor: 'ultimos-90-dias', rotulo: 'Últimos 90 dias' },
  // o ano civil inteiro: o DRE lê o ano mês a mês (change `dre-gerencial`) — cabe no teto (366)
  { valor: 'este-ano', rotulo: 'Este ano' },
]

export interface Periodo {
  de: string
  ate: string
}

/** O período de um atalho, a partir de HOJE na clínica (`AAAA-MM-DD`). */
export function periodoDoAtalho(atalho: AtalhoDePeriodo, hoje: string): Periodo {
  const mes = hoje.slice(0, 7)
  switch (atalho) {
    case 'hoje':
      return { de: hoje, ate: hoje }
    case 'este-mes':
      return limitesDoMes(mes)
    case 'mes-passado':
      return limitesDoMes(somarMeses(mes, -1))
    case 'ultimos-30-dias':
      // 30 dias INCLUINDO hoje — "últimos 30" com o de hoje é 29 para trás
      return { de: somarDias(hoje, -29), ate: hoje }
    case 'ultimos-90-dias':
      return { de: somarDias(hoje, -89), ate: hoje }
    case 'este-ano':
      return { de: `${hoje.slice(0, 4)}-01-01`, ate: `${hoje.slice(0, 4)}-12-31` }
  }
}

const MILISSEGUNDOS_POR_DIA = 86_400_000

function emDiasUtc(ymd: string): number {
  const [ano = 0, mes = 1, dia = 1] = ymd.split('-').map(Number)

  return Date.UTC(ano, mes - 1, dia) / MILISSEGUNDOS_POR_DIA
}

/** Dias do período, com as duas pontas: `2026-06-01` a `2026-06-30` → 30. */
export function diasDoPeriodo({ de, ate }: Periodo): number {
  return emDiasUtc(ate) - emDiasUtc(de) + 1
}

export type ValidacaoDoPeriodo = { valido: true } | { valido: false; razao: string }

/**
 * Por que "Gerar" está desabilitado — em TEXTO, para ficar ao lado do botão (não só
 * `disabled`): um botão apagado sem motivo é um botão que a recepção clica três vezes.
 */
export function validarPeriodo(de: string, ate: string): ValidacaoDoPeriodo {
  if (!dataEhValida(de) || !dataEhValida(ate)) {
    return { valido: false, razao: 'Informe o início e o fim do período.' }
  }
  if (ate < de) {
    return { valido: false, razao: 'O fim do período vem antes do início.' }
  }
  const dias = diasDoPeriodo({ de, ate })
  if (dias > TETO_DE_DIAS_DO_PERIODO) {
    return {
      valido: false,
      razao: `O período tem ${dias} dias; o máximo é ${TETO_DE_DIAS_DO_PERIODO} dias (um ano).`,
    }
  }

  return { valido: true }
}

/** O período do envelope por extenso — "1º a 30 de junho de 2026"; `null` sem período. */
export function periodoDoEnvelope(envelope: EnvelopeDeRelatorio): string | null {
  return envelope.periodo === null ? null : periodoEmPalavras(envelope.periodo.de, envelope.periodo.ate)
}
