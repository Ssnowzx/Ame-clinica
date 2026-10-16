import { dataEhValida } from '@/lib/grade-agenda'
import type { CardAgendamento, PayloadRemarcacao } from '@/tipos'

/**
 * Modelo PURO do arrastar-para-remarcar (change arrastar-para-remarcar, D1/D2) —
 * o padrão `montarGrade`: toda a decisão de "esta célula é alvo válido?" e a
 * montagem do payload parcial vivem aqui, testadas SEM DOM. O gesto (Pointer
 * Events) e o modo teclado só perguntam a este módulo; nunca decidem sozinhos.
 *
 * O que o cliente decide é só o que a UX não pode prometer (célula indisponível,
 * mesma posição, bloqueio). Conflito real, retroativo e guardas de série são do
 * SERVIDOR (D5) — recusa de domínio volta pelo PUT, nunca é replicada aqui.
 */

/** A célula de destino, no vocabulário do domínio (nunca coordenadas de tela). */
export interface AlvoDeRemarcacao {
  profissionalId: number
  /** "Y-m-d" */
  data: string
  /** "HH:MM" */
  horario: string
}

export type MotivoDeRecusaDoArrasto = 'bloqueio' | 'celula_indisponivel' | 'mesma_posicao'

export type AvaliacaoDoArrasto =
  | { valido: true }
  | { valido: false; motivo: MotivoDeRecusaDoArrasto }

/**
 * Decide se soltar `card` na célula `alvo` inicia uma remarcação.
 *
 * @param card - O card arrastado (bloqueio nunca é arrastável nesta versão)
 * @param alvo - A célula de destino
 * @param celulaIndisponivel - A célula está pintada como indisponível pelo modelo da grade
 * @returns `valido`, ou o motivo da recusa (mesma posição = cancelar, sem efeito)
 */
export function avaliarAlvoDoArrasto(
  card: CardAgendamento,
  alvo: AlvoDeRemarcacao,
  celulaIndisponivel: boolean,
): AvaliacaoDoArrasto {
  if (card.tipo === 'bloqueio') {
    return { valido: false, motivo: 'bloqueio' }
  }
  // a UX não promete o que o servidor nega — o mesmo contrato do slot livre
  // que não convida a marcar fora da janela
  if (celulaIndisponivel) {
    return { valido: false, motivo: 'celula_indisponivel' }
  }
  const mesmoInicio = card.inicio.slice(0, 16) === `${alvo.data} ${alvo.horario}`
  if (mesmoInicio && alvo.profissionalId === card.profissional_id) {
    return { valido: false, motivo: 'mesma_posicao' }
  }
  return { valido: true }
}

/**
 * Monta o payload PARCIAL do PUT (D2, corrigido na verificação ao vivo de
 * 2026-07-19): `inicio` E `profissional_id` SEMPRE — o contrato vivo do UPDATE
 * exige `profissional_id` required INCONDICIONAL (provado com 422 no arrasto
 * Ana→Ana: "profissional id field is required"). O alvo já carrega o
 * profissional mesmo quando não mudou. Nenhum outro campo existe aqui por
 * construção: o gesto não troca paciente, especialidade nem vínculo algum.
 */
export function montarPayloadDeRemarcacao(
  alvo: AlvoDeRemarcacao,
  aplicarNaSerie = false,
): PayloadRemarcacao {
  const payload: PayloadRemarcacao = {
    inicio: `${alvo.data} ${alvo.horario}`,
    profissional_id: alvo.profissionalId,
  }
  if (aplicarNaSerie) {
    payload.aplicar_na_serie = true
  }
  return payload
}

const FORMATO_HORARIO = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/** Serializa o alvo para o `data-slot` da célula (`profissional|data|horario`). */
export function montarDataSlot(alvo: AlvoDeRemarcacao): string {
  return `${alvo.profissionalId}|${alvo.data}|${alvo.horario}`
}

/**
 * Lê o alvo de um `data-slot`. O DOM é entrada não confiável para o modelo
 * (o mesmo contrato do SEC-R1 na URL): atributo ausente ou malformado devolve
 * `null` — soltar ali simplesmente não faz nada, nunca derruba a grade.
 */
export function lerAlvoDoSlot(valor: string | undefined): AlvoDeRemarcacao | null {
  if (valor === undefined || valor === '') {
    return null
  }
  const [profissional, data, horario] = valor.split('|')
  const profissionalId = Number(profissional)
  if (!Number.isInteger(profissionalId) || profissionalId <= 0) {
    return null
  }
  if (!dataEhValida(data)) {
    return null
  }
  if (horario === undefined || !FORMATO_HORARIO.test(horario)) {
    return null
  }
  return { profissionalId, data, horario }
}
