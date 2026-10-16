import { garantirCsrf, http, putComVersao } from '@/lib/http'
import type { AgendamentoDoEncaixe, EntradaDaFila, PayloadDaFila, PayloadEncaixe } from '@/tipos'

/** A fila, já ordenada pelo servidor (prioridade desc, chegada asc). */
export async function listarFila(): Promise<EntradaDaFila[]> {
  const { data } = await http.get<EntradaDaFila[]>('/api/lista-espera')
  return data
}

export async function entrarNaFila(payload: PayloadDaFila): Promise<EntradaDaFila> {
  await garantirCsrf()
  const { data } = await http.post<EntradaDaFila>('/api/lista-espera', payload)
  return data
}

export async function atualizarEntrada(id: number, payload: PayloadDaFila, versao: string): Promise<EntradaDaFila> {
  const data = await putComVersao<EntradaDaFila>(`/api/lista-espera/${id}`, payload, versao)
  return data
}

export async function sairDaFila(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/lista-espera/${id}`)
}

/**
 * Encaixe: cria o agendamento e tira o paciente da fila numa transação só.
 * Recusa do domínio (horário ocupado, tratamento sem saldo…) chega como 422 por
 * campo — e o paciente CONTINUA na fila.
 */
export async function encaixarDaFila(
  entradaId: number,
  payload: PayloadEncaixe,
): Promise<AgendamentoDoEncaixe> {
  await garantirCsrf()
  const { data } = await http.post<AgendamentoDoEncaixe>(`/api/lista-espera/${entradaId}/encaixar`, payload)
  return data
}
