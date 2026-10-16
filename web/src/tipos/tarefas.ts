/**
 * Mural de tarefas da equipe (change kanban-da-equipe). SEM vínculo com
 * paciente por decisão LGPD — o mural é operacional; dado clínico tem lugar
 * próprio (prontuário), e a tela orienta a minimização.
 */

export const COLUNAS_DE_TAREFA = ['a_fazer', 'em_andamento', 'aguardando', 'concluida'] as const
export type ColunaDeTarefa = (typeof COLUNAS_DE_TAREFA)[number]

export const PRIORIDADES_DE_TAREFA = ['baixa', 'media', 'alta', 'urgente'] as const
export type PrioridadeDeTarefa = (typeof PRIORIDADES_DE_TAREFA)[number]

export interface ParticipanteDoMural {
  id: number
  nome: string
}

export interface Tarefa {
  id: number
  titulo: string
  descricao: string | null
  coluna: ColunaDeTarefa
  prioridade: PrioridadeDeTarefa
  /** "Y-m-d" */
  prazo: string | null
  /** texto livre, separado por vírgula */
  etiquetas: string | null
  posicao: number
  concluida_em: string | null
  arquivada_em: string | null
  responsaveis: ParticipanteDoMural[]
  comentarios_count: number
  /** não lidos DO USUÁRIO AUTENTICADO — o servidor calcula pelo carimbo de leitura */
  comentarios_nao_lidos_count: number
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface ComentarioDeTarefa {
  id: number
  tarefa_id: number
  corpo: string
  /** null quando o autor saiu do sistema — a conversa sobrevive */
  autor: ParticipanteDoMural | null
  mencionados: ParticipanteDoMural[]
  created_at: string
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface PayloadTarefa {
  titulo?: string
  descricao?: string | null
  coluna?: ColunaDeTarefa
  prioridade?: PrioridadeDeTarefa
  prazo?: string | null
  etiquetas?: string | null
  responsaveis?: number[]
}

/** Um item do lote de reordenação (`PATCH /api/tarefas/ordem`). */
export interface ItemDeOrdem {
  id: number
  coluna: ColunaDeTarefa
  posicao: number
}

// ── Bloco `tarefas` do centro de notificações (design D5) ────────────────────

export interface ItemTarefaDoBloco {
  id: number
  titulo: string
  coluna: ColunaDeTarefa
  prazo: string | null
}

export interface ItemMencaoDoBloco {
  tarefa_id: number
  titulo: string | null
  autor: string | null
}

export const TIPOS_DE_EVENTO_DO_MURAL = ['atribuicao', 'status', 'comentario'] as const
export type TipoDeEventoDoMural = (typeof TIPOS_DE_EVENTO_DO_MURAL)[number]

/**
 * Evento direcionado do mural (change alertas-do-mural): atribuição, mudança de
 * coluna ou comentário numa tarefa MINHA — não lido até eu abrir a tarefa ou
 * marcar todas. `dados` varia por tipo (origem→destino, demanda assumida).
 */
export interface EventoDoMural {
  id: number
  tarefa_id: number
  /** null quando a tarefa foi excluída entre o evento e a leitura */
  titulo: string | null
  autor: string | null
  tipo: TipoDeEventoDoMural
  dados: {
    de?: ColunaDeTarefa
    para?: ColunaDeTarefa
    assumida?: boolean
    comentario_id?: number
  } | null
  /** "Y-m-d H:i" */
  quando: string
}

/**
 * ESTADO ATUAL do próprio usuário + eventos não lidos (specs notificacoes:
 * kanban-da-equipe D5 · alertas-do-mural) — sem janela de data.
 */
export interface BlocoTarefas {
  total: number
  minhas: ItemTarefaDoBloco[]
  mencoes: ItemMencaoDoBloco[]
  demandas_abertas: ItemTarefaDoBloco[]
  eventos: EventoDoMural[]
}
