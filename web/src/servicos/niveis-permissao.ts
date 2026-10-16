import { garantirCsrf, http, putComVersaoDetalhado } from '@/lib/http'
import type { AprovacaoDeAcesso, NivelPermissao, PayloadNivel, ResultadoDeMutacaoGovernada } from '@/tipos'

/** Os níveis da clínica, cada um com o conjunto completo de permissões. */
export async function listarNiveisPermissao(): Promise<NivelPermissao[]> {
  const { data } = await http.get<NivelPermissao[]>('/api/niveis-permissao')
  return data
}

/**
 * Catálogo GLOBAL de permissões (`modulo.acao`) — somente leitura (T-rbac-04). A tela
 * deriva a grade dele; permissão nova nunca é omitida (SEC-ADM-08).
 */
export async function listarCatalogoPermissoes(): Promise<string[]> {
  const { data } = await http.get<{ permissoes: string[] }>('/api/permissoes')
  return data.permissoes
}

export async function criarNivelPermissao(payload: PayloadNivel): Promise<NivelPermissao> {
  await garantirCsrf()
  const { data } = await http.post<NivelPermissao>('/api/niveis-permissao', payload)
  return data
}

/**
 * Edição GOVERNADA pelo maker-checker (AP-13): com a aprovação dupla ligada o
 * servidor responde 202 e a mudança vira PENDÊNCIA — nada aplicou.
 */
export async function atualizarNivelPermissao(
  id: number,
  payload: PayloadNivel,
  versao: string,
): Promise<ResultadoDeMutacaoGovernada<NivelPermissao>> {
  const resposta = await putComVersaoDetalhado<NivelPermissao | AprovacaoDeAcesso>(
    `/api/niveis-permissao/${id}`,
    payload,
    versao,
  )

  // o STATUS é o discriminador do contrato (202 = pendência) — o cast só o materializa
  return resposta.status === 202
    ? { aplicado: false, aprovacao: resposta.data as AprovacaoDeAcesso }
    : { aplicado: true, dados: resposta.data as NivelPermissao }
}

/** Exclusão PROTEGIDA: nível em uso → 422 com o motivo (a tela o exibe). */
export async function excluirNivelPermissao(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/niveis-permissao/${id}`)
}
