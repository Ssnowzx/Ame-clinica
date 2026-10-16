import { garantirCsrf, http } from '@/lib/http'
import type { AprovacaoDeAcesso } from '@/tipos'

/**
 * Pendências do maker-checker de acesso (AP-13) — leitura sob
 * `niveis_permissao.ver`; aprovar/recusar sob `niveis_permissao.editar` E
 * decisor ≠ solicitante (regra do SERVIDOR — o botão desabilitado é cortesia);
 * cancelar é do próprio solicitante.
 */

export async function listarAprovacoes(): Promise<AprovacaoDeAcesso[]> {
  const { data } = await http.get<AprovacaoDeAcesso[]>('/api/aprovacoes-de-acesso')

  return data
}

export async function aprovarAprovacao(id: number): Promise<AprovacaoDeAcesso> {
  await garantirCsrf()
  const { data } = await http.post<AprovacaoDeAcesso>(`/api/aprovacoes-de-acesso/${id}/aprovar`)

  return data
}

export async function recusarAprovacao(id: number): Promise<AprovacaoDeAcesso> {
  await garantirCsrf()
  const { data } = await http.post<AprovacaoDeAcesso>(`/api/aprovacoes-de-acesso/${id}/recusar`)

  return data
}

export async function cancelarAprovacao(id: number): Promise<AprovacaoDeAcesso> {
  await garantirCsrf()
  const { data } = await http.post<AprovacaoDeAcesso>(`/api/aprovacoes-de-acesso/${id}/cancelar`)

  return data
}
