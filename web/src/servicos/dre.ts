import { http, putComVersao } from '@/lib/http'
import type { ConfiguracaoDoDre, LinhaDreDefinida } from '@/tipos'

/**
 * A configuração do DRE (change `dre-gerencial`): ler a escada e onde cada categoria cai (sob
 * `fluxo_caixa.ver`), e trocar a linha de uma categoria ou subcategoria (`categorias.editar` E
 * `fluxo_caixa.ver`). A escada vem SEMPRE do servidor — uma cópia aqui divergiria no primeiro ajuste.
 */

export async function buscarConfiguracaoDoDre(): Promise<ConfiguracaoDoDre> {
  const { data } = await http.get<ConfiguracaoDoDre>('/api/dre/linhas')
  return data
}

/** `null` volta ao padrão da natureza. Leva no `If-Match` o `updated_at` lido na configuração. */
export function definirLinhaDaCategoria(id: number, linha: string | null, versao: string): Promise<LinhaDreDefinida> {
  return putComVersao<LinhaDreDefinida>(`/api/categorias/${id}/linha-dre`, { linha_dre: linha }, versao)
}

/** `null` volta a seguir a linha da categoria. */
export function definirLinhaDaSubcategoria(id: number, linha: string | null, versao: string): Promise<LinhaDreDefinida> {
  return putComVersao<LinhaDreDefinida>(`/api/subcategorias/${id}/linha-dre`, { linha_dre: linha }, versao)
}
