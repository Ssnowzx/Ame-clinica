/** A fila de espera (§6) — leitura e escrita. */

import type { AvisoAFamilia } from '@/tipos/agenda'

/** Entrada da fila (GET /api/lista-espera). Paciente minimizado (LGPD). */
export interface EntradaDaFila {
  id: number
  paciente_id: number
  especialidade_id: number | null
  profissional_id: number | null
  /** 0–10 no dado; a tela apresenta três degraus (design D7) */
  prioridade: number
  obs: string | null
  /** Entrada na fila — é daqui que sai o tempo de espera */
  created_at: string
  paciente: { id: number; nome: string; nome_social: string | null } | null
  especialidade: { id: number; nome: string } | null
  profissional: { id: number; nome: string } | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/** Entrar na fila / editar a entrada. */
export interface PayloadDaFila {
  paciente_id: number
  especialidade_id?: number | null
  profissional_id?: number | null
  prioridade?: number
  obs?: string | null
}

/**
 * Encaixe (POST /api/lista-espera/{id}/encaixar).
 * `paciente_id` NÃO existe aqui de propósito: o servidor o toma da entrada, e
 * mandá-lo é 422 — encaixar é agendar quem esperava. `status_id` também fica
 * fora: a tela não escolhe status no encaixe, e um campo que o formulário nunca
 * monta é só uma porta destrancada (parecer SEC-LE-15).
 */
export interface PayloadEncaixe {
  /** "Y-m-d H:i" no fuso da clínica */
  inicio: string
  profissional_id: number
  especialidade_id: number
  duracao_minutos?: number | null
  tratamento_id?: number | null
  sala_id?: number | null
  medico_id?: number | null
  obs?: string | null
}

/**
 * Resposta do encaixe: os ESCALARES do agendamento criado — a mesma forma do
 * `POST /agendamentos`. Não é o card da grade (sem paciente/status/convênio
 * aninhados): quem precisa do card lê a grade, que a mutação já revalidou.
 */
export interface AgendamentoDoEncaixe {
  id: number
  tipo: 'atendimento' | 'bloqueio'
  paciente_id: number | null
  profissional_id: number
  especialidade_id: number | null
  tratamento_id: number | null
  sala_id: number | null
  equipamento_id: number | null
  medico_id: number | null
  status_id: number | null
  inicio: string
  fim: string
  duracao_minutos: number
  origem: string
  is_reposicao: boolean
  reposicao_de_id: number | null
  recorrencia_grupo_id: string | null
  obs: string | null
  /** ver `CardAgendamento.alerta_paciente` — o encaixe herda os avisos da escrita */
  alerta_paciente?: string[] | null
  /** a confirmação do primeiro agendamento, quando a criança entra pela fila */
  aviso_familia?: AvisoAFamilia
}
