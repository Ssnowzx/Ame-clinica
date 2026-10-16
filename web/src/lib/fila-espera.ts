import type { EntradaDaFila } from '@/tipos'

/**
 * Regras de apresentação da fila (§6, design D7).
 *
 * A prioridade é `0–10` no dado — e continua sendo: regra configurável é dado,
 * não código. A tela oferece três degraus, mas **nunca esconde** uma entrada só
 * porque o número não é um deles.
 */

export const DEGRAUS_DE_PRIORIDADE = [
  { valor: 0, rotulo: 'Normal' },
  { valor: 5, rotulo: 'Alta' },
  { valor: 10, rotulo: 'Urgente' },
] as const

export function rotuloDaPrioridade(prioridade: number): string {
  return DEGRAUS_DE_PRIORIDADE.find((degrau) => degrau.valor === prioridade)?.rotulo
    ?? `Prioridade ${prioridade}`
}

/** Dias inteiros de espera desde a entrada na fila (nunca negativo). */
export function diasDeEspera(entradaEm: string, agora: Date = new Date()): number {
  const entrada = new Date(entradaEm)
  if (Number.isNaN(entrada.getTime())) {
    return 0
  }
  const dias = Math.floor((agora.getTime() - entrada.getTime()) / 86_400_000)
  return dias > 0 ? dias : 0
}

/** "hoje" · "há 1 dia" · "há 5 dias" — o contador do §6, em português. */
export function tempoDeEspera(entradaEm: string, agora: Date = new Date()): string {
  const dias = diasDeEspera(entradaEm, agora)
  if (dias === 0) {
    return 'hoje'
  }
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`
}

/**
 * Ordem real de atendimento — espelha o servidor (prioridade desc, chegada asc).
 * A tela reordena porque filtra: uma fila filtrada que mantém a ordem do
 * servidor continua correta, mas ordenar aqui garante isso mesmo se um filtro
 * futuro mexer no array.
 */
export function ordenarFila(fila: readonly EntradaDaFila[]): EntradaDaFila[] {
  return [...fila].sort((a, b) => {
    if (a.prioridade !== b.prioridade) {
      return b.prioridade - a.prioridade
    }
    return a.created_at.localeCompare(b.created_at)
  })
}

export interface FiltroDaFila {
  profissionalId?: number | null
  especialidadeId?: number | null
}

/**
 * Fila da visão (painel da agenda): quem espera POR este profissional/
 * especialidade — e quem não escolheu ninguém (entrada sem desejo cabe em
 * qualquer horário que abrir; escondê-la seria perder o encaixe mais fácil).
 */
export function filtrarFila(fila: readonly EntradaDaFila[], filtro: FiltroDaFila): EntradaDaFila[] {
  const { profissionalId, especialidadeId } = filtro

  return ordenarFila(fila).filter((entrada) => {
    const profissionalBate =
      profissionalId == null || entrada.profissional_id === null || entrada.profissional_id === profissionalId
    const especialidadeBate =
      especialidadeId == null || entrada.especialidade_id === null || entrada.especialidade_id === especialidadeId

    return profissionalBate && especialidadeBate
  })
}

/** Nome de exibição do paciente (social quando houver) — nunca o cadastro. */
export function nomeDoPaciente(entrada: EntradaDaFila): string {
  return entrada.paciente?.nome_social ?? entrada.paciente?.nome ?? 'Paciente'
}
