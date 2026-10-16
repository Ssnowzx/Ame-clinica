import { garantirCsrf, http, patchComVersao } from '@/lib/http'
import type {
  ComentarioDeTarefa,
  ItemDeOrdem,
  ParticipanteDoMural,
  PayloadTarefa,
  Tarefa,
} from '@/tipos'

/** O quadro inteiro (a clínica tem dezenas de tarefas, não milhares — sem paginação). */
export async function listarTarefas(arquivadas = false): Promise<Tarefa[]> {
  const { data } = await http.get<Tarefa[]>('/api/tarefas', {
    params: arquivadas ? { arquivadas: 1 } : undefined,
  })
  return data
}

/** Participantes do mural (usuários ativos, id+nome) — responsáveis e menções. */
export async function listarParticipantes(): Promise<ParticipanteDoMural[]> {
  const { data } = await http.get<ParticipanteDoMural[]>('/api/tarefas/usuarios')
  return data
}

export async function criarTarefa(payload: PayloadTarefa): Promise<Tarefa> {
  await garantirCsrf()
  const { data } = await http.post<Tarefa>('/api/tarefas', payload)
  return data
}

export async function atualizarTarefa(id: number, payload: PayloadTarefa, versao: string): Promise<Tarefa> {
  return patchComVersao<Tarefa>(`/api/tarefas/${id}`, payload, versao)
}

/**
 * Lote de posições do arrasto/teclado — SEM If-Match de propósito (exceção
 * SEC-OCC-06 por URI): quadro colaborativo, a última intenção de ORDEM vence e o
 * servidor reindexa denso em transação.
 */
export async function reordenarTarefas(itens: ItemDeOrdem[]): Promise<void> {
  await garantirCsrf()
  await http.patch('/api/tarefas/ordem', { itens })
}

export async function assumirTarefa(id: number): Promise<Tarefa> {
  await garantirCsrf()
  const { data } = await http.post<Tarefa>(`/api/tarefas/${id}/assumir`)
  return data
}

export async function arquivarTarefa(id: number): Promise<void> {
  await garantirCsrf()
  await http.post(`/api/tarefas/${id}/arquivar`)
}

export async function desarquivarTarefa(id: number): Promise<Tarefa> {
  await garantirCsrf()
  const { data } = await http.post<Tarefa>(`/api/tarefas/${id}/desarquivar`)
  return data
}

export async function excluirTarefa(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/tarefas/${id}`)
}

/** Marca lidos os eventos do PRÓPRIO usuário naquela tarefa (alertas-do-mural). */
export async function lerEventosDaTarefa(id: number): Promise<void> {
  await garantirCsrf()
  await http.post(`/api/tarefas/${id}/eventos/ler`)
}

/** "Marcar todas como lidas" do bloco do sino. */
export async function lerTodosEventos(): Promise<void> {
  await garantirCsrf()
  await http.post('/api/tarefas/eventos/ler-todos')
}

/** A leitura CARIMBA o lido_em do usuário no servidor — é o que zera os não lidos. */
export async function listarComentarios(tarefaId: number): Promise<ComentarioDeTarefa[]> {
  const { data } = await http.get<ComentarioDeTarefa[]>(`/api/tarefas/${tarefaId}/comentarios`)
  return data
}

export async function comentarTarefa(
  tarefaId: number,
  corpo: string,
  mencoes: number[],
): Promise<ComentarioDeTarefa> {
  await garantirCsrf()
  const { data } = await http.post<ComentarioDeTarefa>(`/api/tarefas/${tarefaId}/comentarios`, {
    corpo,
    ...(mencoes.length > 0 ? { mencoes } : {}),
  })
  return data
}

export async function editarComentario(
  id: number,
  corpo: string,
  mencoes: number[],
  versao: string,
): Promise<ComentarioDeTarefa> {
  return patchComVersao<ComentarioDeTarefa>(`/api/tarefas/comentarios/${id}`, { corpo, mencoes }, versao)
}

export async function excluirComentario(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/tarefas/comentarios/${id}`)
}
