import type { ColunaDeTarefa, ItemDeOrdem, PrioridadeDeTarefa, Tarefa } from '@/tipos'
import { COLUNAS_DE_TAREFA } from '@/tipos'

/**
 * Modelo PURO do quadro de tarefas (kanban-da-equipe, design D6) — o padrão
 * `arrastar-remarcar` da agenda: toda a matemática de posições e a montagem do
 * lote do `PATCH /api/tarefas/ordem` vivem aqui, testadas SEM DOM. O gesto
 * (Pointer Events) e o modo teclado só perguntam a este módulo.
 *
 * As posições finais são SEMPRE reindexadas densas (0..n-1) por coluna — o
 * mesmo contrato do servidor, para o update otimista não divergir do refetch.
 */

export const ROTULO_DA_COLUNA: Record<ColunaDeTarefa, string> = {
  a_fazer: 'A fazer',
  em_andamento: 'Em andamento',
  aguardando: 'Aguardando',
  concluida: 'Concluída',
}

/** O que cada coluna cobre — o hint discreto do cabeçalho. */
export const DICA_DA_COLUNA: Record<ColunaDeTarefa, string> = {
  a_fazer: 'O que ainda não começou',
  em_andamento: 'O que a equipe está fazendo',
  aguardando: 'Travado em terceiro: retorno, convênio, fornecedor',
  concluida: 'Feito — arquive quando não precisar mais ver',
}

export const ROTULO_DA_PRIORIDADE: Record<PrioridadeDeTarefa, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  urgente: 'Urgente',
}

/** Agrupa por coluna, ordenado por posição (desempate por id — como o servidor). */
export function agruparPorColuna(tarefas: readonly Tarefa[]): Record<ColunaDeTarefa, Tarefa[]> {
  const grupos = Object.fromEntries(COLUNAS_DE_TAREFA.map((coluna) => [coluna, [] as Tarefa[]])) as Record<
    ColunaDeTarefa,
    Tarefa[]
  >
  for (const tarefa of tarefas) {
    grupos[tarefa.coluna]?.push(tarefa)
  }
  for (const coluna of COLUNAS_DE_TAREFA) {
    grupos[coluna].sort((a, b) => a.posicao - b.posicao || a.id - b.id)
  }
  return grupos
}

export interface PlanoDeMovimento {
  /** O lote das colunas afetadas — o payload do `PATCH /api/tarefas/ordem`. */
  itens: ItemDeOrdem[]
  /** A lista inteira com o movimento aplicado — o update otimista. */
  tarefas: Tarefa[]
}

/**
 * Planeja mover uma tarefa para `colunaDestino` na posição `indiceDestino`
 * (ausente = fim da coluna). Devolve `null` quando o movimento é um não-evento
 * (mesma coluna e mesma posição) — soltar no lugar não dispara request.
 */
export function planejarMovimento(
  tarefas: readonly Tarefa[],
  tarefaId: number,
  colunaDestino: ColunaDeTarefa,
  indiceDestino?: number,
): PlanoDeMovimento | null {
  const tarefa = tarefas.find((t) => t.id === tarefaId)
  if (tarefa === undefined) {
    return null
  }

  const grupos = agruparPorColuna(tarefas)
  const origem = grupos[tarefa.coluna].filter((t) => t.id !== tarefaId)
  const destino = tarefa.coluna === colunaDestino ? origem : [...grupos[colunaDestino]]

  const teto = destino.length
  const indice = Math.max(0, Math.min(indiceDestino ?? teto, teto))

  if (tarefa.coluna === colunaDestino && grupos[colunaDestino][indice]?.id === tarefaId) {
    return null // mesma posição — não-evento
  }

  destino.splice(indice, 0, { ...tarefa, coluna: colunaDestino })

  const itens: ItemDeOrdem[] = []
  const posicoes = new Map<number, { coluna: ColunaDeTarefa; posicao: number }>()
  destino.forEach((t, posicao) => {
    itens.push({ id: t.id, coluna: colunaDestino, posicao })
    posicoes.set(t.id, { coluna: colunaDestino, posicao })
  })
  if (tarefa.coluna !== colunaDestino) {
    origem.forEach((t, posicao) => {
      itens.push({ id: t.id, coluna: t.coluna, posicao })
      posicoes.set(t.id, { coluna: t.coluna, posicao })
    })
  }

  const atualizadas = tarefas.map((t) => {
    const nova = posicoes.get(t.id)
    return nova === undefined ? t : { ...t, coluna: nova.coluna, posicao: nova.posicao }
  })

  return { itens, tarefas: atualizadas }
}

/**
 * A tarefa está atrasada? Prazo vencido E fora de `concluida` — `hoje` chega de
 * fora ("Y-m-d") para o modelo continuar puro e testável.
 */
export function tarefaAtrasada(tarefa: Pick<Tarefa, 'prazo' | 'coluna'>, hoje: string): boolean {
  return tarefa.prazo !== null && tarefa.prazo < hoje && tarefa.coluna !== 'concluida'
}

/** Etiquetas do texto livre — vírgula separa, vazio some, espaço não conta. */
export function separarEtiquetas(etiquetas: string | null): string[] {
  if (etiquetas === null) {
    return []
  }
  return etiquetas
    .split(',')
    .map((etiqueta) => etiqueta.trim())
    .filter((etiqueta) => etiqueta !== '')
}
