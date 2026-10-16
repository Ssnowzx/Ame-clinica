import { garantirCsrf, http, putComVersao } from '@/lib/http'
import type { Cbos, PainelDoProfissional, PayloadProfissional, Profissional } from '@/tipos'

/** Lista completa (a API não pagina: a clínica tem dezenas). */
export async function listarProfissionaisDoCadastro(): Promise<Profissional[]> {
  const { data } = await http.get<Profissional[]>('/api/profissionais')
  return data
}

/** A ficha: o servidor autoriza `profissionais.ver` OU o PRÓPRIO (own-show). */
export async function buscarProfissionalDoCadastro(id: number): Promise<Profissional> {
  const { data } = await http.get<Profissional>(`/api/profissionais/${id}`)
  return data
}

/**
 * O PAINEL do mês (change painel-do-profissional, D7): uma chamada monta a ficha inteira. O servidor
 * decide bloco a bloco — sem a permissão do módulo dono, a chave nem vem — e recusa com 403 quem não
 * alcança bloco nenhum (o escopado pedindo o painel de um colega), antes de validar o `mes`.
 */
export async function buscarPainelDoProfissional(id: number, mes: string): Promise<PainelDoProfissional> {
  const { data } = await http.get<PainelDoProfissional>(`/api/profissionais/${id}/painel`, { params: { mes } })
  return data
}

export async function criarProfissional(payload: PayloadProfissional): Promise<Profissional> {
  await garantirCsrf()
  const { data } = await http.post<Profissional>('/api/profissionais', payload)
  return data
}

export async function atualizarProfissional(id: number, payload: PayloadProfissional, versao: string): Promise<Profissional> {
  const data = await putComVersao<Profissional>(`/api/profissionais/${id}`, payload, versao)
  return data
}

/** Exclusão PROTEGIDA: referenciado → 422 com o motivo (a tela o exibe). */
export async function excluirProfissional(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/profissionais/${id}`)
}

/** Catálogo GLOBAL de ocupações — leitura livre a autenticados. */
export async function listarCbos(): Promise<Cbos[]> {
  const { data } = await http.get<Cbos[]>('/api/cbos')
  return data
}

export async function enviarFotoDoProfissional(id: number, arquivo: File): Promise<{ foto_versao: string }> {
  await garantirCsrf()
  const corpo = new FormData()
  corpo.append('arquivo', arquivo)
  const { data } = await http.post<{ foto_versao: string }>(`/api/profissionais/${id}/foto`, corpo)

  return data
}

export async function removerFotoDoProfissional(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/profissionais/${id}/foto`)
}
