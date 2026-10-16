import type { TipoLancamento } from '@/tipos/financeiro'

/**
 * A configuração do DRE (change `dre-gerencial`): a escada é padrão contábil e vem do servidor
 * (nunca copiada aqui); a ESCOLHA da linha de cada categoria é dado da clínica.
 */

/** Um degrau da escada: um grupo (com as linhas de valor dele) ou um subtotal. */
export interface DegrauDoDre {
  tipo: 'grupo' | 'subtotal'
  codigo: string
  rotulo: string
  /** Só no grupo: os códigos das linhas de valor, na ordem. */
  linhas?: string[]
  explicacao: string
}

/** Uma linha de VALOR: recebe categorias de UMA natureza. */
export interface LinhaDoDre {
  codigo: string
  rotulo: string
  natureza: TipoLancamento
  explicacao: string
}

export interface SubcategoriaNoDre {
  id: number
  nome: string
  /** `null` = segue a linha da categoria */
  linha_dre: string | null
  /** a linha em vigor, já resolvida pelo servidor */
  linha_efetiva: string
  /** token da concorrência otimista (If-Match) do `PUT` da linha */
  updated_at: string
}

export interface CategoriaNoDre {
  id: number
  nome: string
  tipo: TipoLancamento
  /** `null` = o padrão da natureza */
  linha_dre: string | null
  linha_efetiva: string
  updated_at: string
  subcategorias: SubcategoriaNoDre[]
}

/** `GET /api/dre/linhas` — sob `fluxo_caixa.ver`. */
export interface ConfiguracaoDoDre {
  escada: DegrauDoDre[]
  linhas: LinhaDoDre[]
  /** A linha de cada natureza quando a categoria não escolheu nenhuma. */
  padrao: Record<TipoLancamento, string>
  categorias: CategoriaNoDre[]
  /** Quantas categorias estão no padrão (sem linha escolhida). */
  no_padrao: number
}

export interface LinhaDreDefinida {
  id: number
  linha_dre: string | null
  updated_at: string
}
