/**
 * O TERMO de consentimento da clínica (FA-08) — o contrato terapêutico como dado
 * versionado. Uma linha por VERSÃO; publicar uma nova não toca nas anteriores,
 * porque há aceites presos a elas.
 */
export interface VersaoDoTermo {
  id: number
  titulo: string
  versao: number
  vigente: boolean
  /**
   * Quantos pacientes aceitaram ESTA versão. É CONTAGEM, nunca a lista de quem —
   * o catálogo não diz nomes de menores (design D8). É o número que explica por
   * que o texto travou para edição.
   */
  aceites_total: number
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/** A versão aberta (`GET /termos-consentimento/:id`) traz o texto integral. */
export interface VersaoDoTermoComTexto extends VersaoDoTermo {
  texto: string
}

/** O que a tela ENVIA ao publicar/corrigir. Versão e vigência são do SERVIDOR. */
export interface PayloadDoTermo {
  titulo: string
  texto: string
}

/**
 * A régua que está valendo, para quem REGISTRA aceite (`/termos-consentimento/vigente`).
 * Nomeia o termo e nada mais — sem o texto (a recepção tem o papel na mão).
 * `null` = a clínica ainda não publicou nenhuma versão.
 */
export interface TermoVigente {
  id: number
  titulo: string
  versao: number
}
