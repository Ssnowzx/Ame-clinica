import { garantirCsrf, http } from '@/lib/http'
import type { AnexoDoLancamento } from '@/tipos'

/**
 * Os arquivos de um lançamento de caixa (change `anexo-no-lancamento`): comprovante, nota fiscal,
 * recibo. A régua é a dos anexos do paciente — o tipo é decidido pelo CONTEÚDO no servidor, o
 * arquivo é cifrado em repouso e o conteúdo só desce pelo download autenticado.
 */

/** Metadados dos anexos (`lancamentos.ver`) — o conteúdo NUNCA vem na lista. */
export async function listarAnexosDoLancamento(lancamentoId: number): Promise<AnexoDoLancamento[]> {
  const { data } = await http.get<AnexoDoLancamento[]>(`/api/lancamentos/${lancamentoId}/anexos`)

  return data
}

/** Envia UM arquivo no campo `arquivo` (`lancamentos.editar`). A recusa chega em `arquivo`. */
export async function enviarAnexoDoLancamento(lancamentoId: number, arquivo: File): Promise<AnexoDoLancamento> {
  await garantirCsrf()
  const form = new FormData()
  form.append('arquivo', arquivo)
  const { data } = await http.post<AnexoDoLancamento>(`/api/lancamentos/${lancamentoId}/anexos`, form)

  return data
}

/** O conteúdo, pelo caminho AUTENTICADO (blob). O servidor serve como anexo e registra a leitura. */
export async function baixarAnexoDoLancamento(anexoId: number): Promise<Blob> {
  const { data } = await http.get<Blob>(`/api/lancamentos/anexos/${anexoId}/download`, { responseType: 'blob' })

  return data
}

/** Exclusão LÓGICA no servidor (`lancamentos.editar`): some da lista, o arquivo fica (retenção). */
export async function excluirAnexoDoLancamento(anexoId: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/lancamentos/anexos/${anexoId}`)
}
