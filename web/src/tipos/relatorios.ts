/**
 * O ENVELOPE dos relatórios (change `area-de-relatorios`, design D2): a API manda as
 * colunas junto das linhas, e a tela genérica renderiza qualquer relatório sem conhecer o
 * seu formato. O `tipo` da coluna é o que diz como formatar — dinheiro chega como string
 * decimal e é só FORMATADO aqui (a tela não soma; quem soma é o servidor, em decimal).
 */

export type TipoDeColuna = 'texto' | 'numero' | 'dinheiro' | 'data' | 'hora' | 'percentual'

export interface ColunaDeRelatorio {
  chave: string
  rotulo: string
  tipo: TipoDeColuna
}

/** Uma célula: texto, número, string decimal (dinheiro) ou vazio. */
export type ValorDeCelula = string | number | null

/**
 * Uma linha: as células pelas chaves das colunas e, no DRE (change `dre-gerencial`, D4), duas
 * MARCAS que não são coluna — `nivel` (0 grupo ou subtotal, 1 linha da escada, 2 categoria: o
 * recuo) e `destaque` (o subtotal, realçado). Os outros relatórios não as mandam.
 */
export type LinhaDeRelatorio = Record<string, ValorDeCelula | boolean>

/** Totais por chave numérica — o servidor os calcula; a tela formata pelo `tipo` da coluna. */
export type TotaisDeRelatorio = Record<string, string | number>

/** Um bloco do resultado SINTÉTICO com divisão: título, linhas e o total próprio. */
export interface GrupoDeRelatorio {
  titulo: string
  linhas: LinhaDeRelatorio[]
  totais: TotaisDeRelatorio
}

/** Rótulo e valor legíveis — o que o papel imprime no cabeçalho ("Profissional: Ana"). */
export interface FiltroAplicado {
  rotulo: string
  valor: string
}

export interface EnvelopeDeRelatorio {
  slug: string
  titulo: string
  periodo: { de: string; ate: string } | null
  filtros_aplicados: FiltroAplicado[]
  colunas: ColunaDeRelatorio[]
  linhas: LinhaDeRelatorio[]
  grupos: GrupoDeRelatorio[] | null
  totais: TotaisDeRelatorio
  contagem: number
  /** O servidor cortou o resultado no teto de linhas — o papel avisa que há mais. */
  truncado: boolean
  /** Frases para quem lê o papel (ex.: pagamentos sem profissional) — não são filtros. Opcional: só alguns relatórios mandam. */
  avisos?: string[]
}

export type ResultadoDeRelatorio = 'analitico' | 'sintetico'

/**
 * Os parâmetros de `GET /api/relatorios/{slug}` — os MESMOS nomes da URL da tela (D5): o
 * link copiado reproduz o recorte. Tudo string porque tudo nasce da query string; o
 * servidor valida.
 */
export interface ParametrosDeRelatorio {
  de?: string
  ate?: string
  resultado?: ResultadoDeRelatorio
  dividir_por?: string
  profissional_id?: string
  convenio_id?: string
  /** Serviço do convênio escolhido — sem `convenio_id` ele não existe (a tabela é por convênio). */
  servico_id?: string
  especialidade_id?: string
  status_id?: string
  situacao?: string
  /** O recorte da *Movimentação da agenda* (criado · remarcado · desmarcado · status) — não é `situacao`. */
  tipo?: string
  paciente_id?: string
  dias?: string
  /** `AAAA-MM` — o mês das aniversariantes; o ano importa porque a linha traz a idade que a criança fará. */
  mes?: string
  /** A ordenação do ranking de *Serviços* (quantidade · valor). */
  ordenar?: string
  /** A conta do caixa — os relatórios do caixa (change `relatorios-do-caixa`). */
  conta_id?: string
  /** `1` = só lançamentos contábeis (DRE). O servidor valida `boolean`: vai `1`, nunca `true`. */
  somente_contabeis?: string
  /** A categoria do caixa — da natureza que o relatório (ou o Tipo) define. */
  categoria_id?: string
}
