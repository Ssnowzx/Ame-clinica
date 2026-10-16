import type { AcaoDaRegraDeLimite, PeriodoDaRegraDeLimite } from '@/tipos'

/**
 * Rótulos pt-BR do domínio FECHADO das regras de limite do convênio (change
 * limites-e-pedidos-por-convenio). O domínio é do BANCO (§13 — regra é dado);
 * aqui só a apresentação: `mes` (chave da API, sem acento) vira "mês" na tela.
 */
export const ROTULO_DO_PERIODO: Record<PeriodoDaRegraDeLimite, string> = {
  dia: 'dia',
  semana: 'semana',
  mes: 'mês',
}

export const ROTULO_DA_ACAO: Record<AcaoDaRegraDeLimite, string> = {
  bloquear: 'Bloquear o agendamento',
  avisar: 'Avisar e deixar marcar',
}

const PERIODO_POR_CHAVE: ReadonlyMap<string, string> = new Map(Object.entries(ROTULO_DO_PERIODO))

/**
 * O `alerta_limite` do painel traz `periodo` como STRING (contrato do `show`) —
 * valor fora do domínio sai CRU, nunca quebra a tela (fail-safe, como os demais
 * catálogos de exibição).
 */
export function rotuloDePeriodo(periodo: string): string {
  return PERIODO_POR_CHAVE.get(periodo) ?? periodo
}
