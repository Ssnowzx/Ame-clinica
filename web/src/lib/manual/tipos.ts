import type { IdDaCaptura } from '@/lib/manual/capturas'

/**
 * Os tipos do manual (change `manual-do-operador`, design D1).
 *
 * O manual é DADO, não marcação: uma lista de seções, cada seção uma lista de blocos com `tipo`.
 * A tela é um renderizador burro com um `switch` exaustivo — bloco novo sem renderizador não
 * compila.
 *
 * O motivo de não ser JSX: o ÍNDICE sai da mesma lista que o corpo. Índice escrito à mão é uma
 * segunda lista para manter em dia, e lista paralela sempre diverge — a tela de Configurações
 * já pagou essa conta nesta casa.
 */
export type BlocoDoManual =
  /** Texto corrido. O tijolo comum. */
  | { tipo: 'paragrafo'; texto: string }
  /**
   * Um subtítulo dentro da seção (vira `h3`).
   *
   * COM `id`, ele é endereçável (`/manual#configuracoes-agenda`) e entra no índice como
   * sub-item da seção. Sem `id`, é só um respiro no texto. A distinção é de PRODUTO: seção
   * longa que a pessoa consulta por parte (as abas de Configurações) merece endereço; um
   * subtítulo de leitura corrida, não — índice que lista tudo deixa de ser índice.
   */
  | { tipo: 'subtitulo'; texto: string; id?: string }
  /** Passos numerados: a ordem importa. */
  | { tipo: 'passos'; passos: readonly string[] }
  /** Uma lista de termo + explicação — para "o que cada coisa quer dizer". */
  | { tipo: 'lista'; itens: readonly ItemDeLista[] }
  /** Uma captura de tela do próprio sistema (o id vem do manifesto). */
  | { tipo: 'captura'; id: IdDaCaptura }
  /** Um atalho que economiza tempo de quem opera o dia inteiro. */
  | { tipo: 'dica'; texto: string }
  /** Um cuidado: o que dá errado, e o que fazer para não dar. */
  | { tipo: 'atencao'; texto: string }

export interface ItemDeLista {
  termo: string
  descricao: string
}

export interface SecaoDoManual {
  /** A âncora da seção (`/manual#agenda`) — parte do endereço, então nunca muda por capricho. */
  id: string
  /** O título, como aparece no índice e no corpo */
  titulo: string
  /** Uma linha dizendo a quem a seção serve. Aparece sob o título. */
  resumo: string
  blocos: readonly BlocoDoManual[]
}
