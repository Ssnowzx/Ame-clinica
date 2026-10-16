import { garantirCsrf, http, putComVersao } from '@/lib/http'
import type { PayloadDoTermo, TermoVigente, VersaoDoTermo, VersaoDoTermoComTexto } from '@/tipos'

const CAMINHO = '/api/termos-consentimento'

/**
 * O termo de consentimento (FA-08). Não usa o `recursoDeCatalogo` genérico por
 * duas diferenças de contrato que são o ponto da change:
 * - a LISTA vem sem o texto (até 50 KB por versão); o texto só ao abrir a versão;
 * - existe `/vigente`, a régua nomeada para quem registra aceite — outra permissão,
 *   outro payload (sem texto, sem contagem).
 *
 * A API é a autoridade: aqui não há validação, só transporte.
 */
export const termos = {
  /** Histórico da clínica, do mais novo ao mais velho — metadados, sem texto. */
  listar: async (): Promise<VersaoDoTermo[]> => {
    const { data } = await http.get<VersaoDoTermo[]>(CAMINHO)
    return data
  },

  /** Uma versão, com o texto integral. */
  obter: async (id: number): Promise<VersaoDoTermoComTexto> => {
    const { data } = await http.get<VersaoDoTermoComTexto>(`${CAMINHO}/${id}`)
    return data
  },

  /** Publicar: o servidor numera a versão e aposenta a anterior. */
  publicar: async (payload: PayloadDoTermo): Promise<VersaoDoTermoComTexto> => {
    await garantirCsrf()
    const { data } = await http.post<VersaoDoTermoComTexto>(CAMINHO, payload)
    return data
  },

  /** Corrigir uma versão que ninguém aceitou (o servidor recusa as aceitas). */
  atualizar: async (id: number, payload: PayloadDoTermo, versao: string): Promise<VersaoDoTermoComTexto> =>
    putComVersao<VersaoDoTermoComTexto>(`${CAMINHO}/${id}`, payload, versao),

  excluir: async (id: number): Promise<void> => {
    await garantirCsrf()
    await http.delete(`${CAMINHO}/${id}`)
  },

  /** A régua em vigor (ou `null` quando a clínica ainda não publicou). */
  vigente: async (): Promise<TermoVigente | null> => {
    const { data } = await http.get<{ termo: TermoVigente | null }>(`${CAMINHO}/vigente`)
    return data.termo
  },
}
