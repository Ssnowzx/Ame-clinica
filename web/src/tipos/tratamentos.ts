import type { RealceDoPacote } from '@/tipos/agenda'

/** O pacote de sessões: é dele que a agenda desconta e o financeiro cobra. */

export type SituacaoDoTratamento = 'andamento' | 'parado' | 'finalizado'

/**
 * O tratamento como a LISTAGEM o entrega (`GET /api/tratamentos`) — e nada além.
 *
 * A separação lista × detalhe não é preciosismo de tipo: é a lição do
 * `FeriadoDaAgenda`. Um tipo único que prometia `pedido_emitido_em` na lista deixou a
 * linha do pedido MORTA em produção (o campo é detail-only: `emitidoEm` seria sempre
 * `undefined` e o componente nunca renderizaria), com a suíte VERDE — porque a fixture
 * MSW mentia sobre a forma do servidor. Aqui só entra o que a listagem realmente manda.
 *
 * Fora daqui de propósito (minimização, SEC-LP-02/03 — `CAMPOS_LISTAGEM` do
 * `TratamentoController`): `matricula`, `guia`, `pedido_emitido_em` e o override
 * `pedido_sessoes_por_semana`. Quem precisa deles carrega o DETALHE.
 */
export interface TratamentoDaLista {
  /** Veredito do fim de pacote, decidido no SERVIDOR (§13 — limiar é dado da clínica) */
  realce: RealceDoPacote
  id: number
  paciente_id: number
  convenio_id: number
  especialidade_id: number
  profissional_id: number
  servico_id: number | null
  sessoes_total: number
  /** LEITURA. O único caminho de escrita é a reconciliação do atendimento. */
  sessoes_realizadas: number
  /** CALCULADO PELO SERVIDOR — a tela exibe, nunca refaz a conta */
  sessoes_saldo: number
  /** CALCULADO PELO SERVIDOR, no fuso da CLÍNICA — o navegador pode estar em outro */
  vencido: boolean
  /** `Y-m-d` (âncora da validade); sem ela, o tratamento nunca vence */
  data_inicio: string | null
  validade_dias: number | null
  /**
   * `Y-m-d` — vencimento do pedido médico (change limites-e-pedidos-por-convenio, D4),
   * DERIVADO NO SERVIDOR (emissão + validade em meses do convênio, fuso da clínica).
   * SÓ leitura: nunca vai em payload, nunca é recalculado aqui. `null` ⇒ sem pedido ou
   * convênio sem validade — nada renderiza (sem alarme falso, fail-safe SEC-LP-11).
   */
  pedido_vence_em: string | null
  /**
   * O VEREDITO do vencimento, decidido NO SERVIDOR, no fuso da CLÍNICA (§13) — como
   * `vencido` do pacote. A tela exibe a palavra; comparar `Y-m-d` aqui usaria o fuso do
   * NAVEGADOR da recepcionista, que não é o da clínica.
   */
  pedido_vencido: boolean
  status: SituacaoDoTratamento
  /** Só o NOME (whitelist do servidor) — nunca o cadastro do menor */
  paciente?: { id: number; nome: string; nome_social: string | null }
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/**
 * O tratamento como o DETALHE o entrega (`GET /api/tratamentos/{id}`) — a forma que
 * hidrata o formulário, e a única em que os campos detail-only existem.
 *
 * Montar o formulário sobre o item da LISTA faria matrícula, guia e pedido nascerem
 * vazios e o `PUT` gravar `null` por cima (gate SEC-TR-14). O tipo agora impede isso:
 * `TratamentoDaLista` não é atribuível a `TratamentoDetalhe`.
 */
export interface TratamentoDetalhe extends TratamentoDaLista {
  /**
   * Identificadores do MENOR no convênio: **detail-only**. A API os omite da
   * listagem de propósito — a tela não os reintroduz (nem em coluna, nem em URL,
   * nem em título de diálogo).
   */
  matricula: string | null
  guia: string | null
  /**
   * `Y-m-d` da emissão do pedido médico. Detail-only: não sai em listagem paginada.
   * `null` ⇒ tratamento sem pedido — nada muda no ciclo dele (SEC-LP-11).
   */
  pedido_emitido_em: string | null
  /**
   * Override "conforme pedido semanal" (Pladisa) — vence a regra-default `semana` do
   * convênio. Detail-only e nunca em lista: o override é o dado mais sensível do pedido.
   */
  pedido_sessoes_por_semana: number | null
}

/**
 * O que a tela envia.
 *
 * **`sessoes_realizadas` não está aqui** de propósito: o único caminho de escrita dela
 * é a reconciliação do atendimento.
 *
 * **`tipo` não existe mais na fronteira** (SEC-TR-17): a coluna tem um valor só
 * ('pacote', default do banco) e nenhum leitor, então a API deixou de aceitá-la e de
 * devolvê-la. Antes disso, mandar `tipo: null` num campo validado como
 * `sometimes|string` (SEM `nullable`) fazia TODO cadastro levar 422 — a tela não
 * conseguia criar um único pacote, que é a razão de ser desta change.
 */
export interface PayloadTratamento {
  paciente_id: number
  convenio_id: number
  especialidade_id: number
  profissional_id: number
  servico_id: number | null
  matricula: string | null
  guia: string | null
  sessoes_total: number
  /** `Y-m-d` cru — nada de `toISOString()` (o servidor exige o formato exato) */
  data_inicio: string | null
  validade_dias: number | null
  /** `Y-m-d` cru; o servidor recusa data futura (SEC-LP-05, fuso da clínica) */
  pedido_emitido_em: string | null
  /** 1..40 — `pedido_vence_em` NUNCA vai: é derivado, só leitura */
  pedido_sessoes_por_semana: number | null
  status: SituacaoDoTratamento
}

export interface FiltroDeTratamentos {
  /** Recorte 'Acabando' pelo limiar da CLÍNICA — o front não manda o número */
  acabando?: boolean
  paciente_id?: number
  /** O recorte da ficha do profissional — mesma permissão da lista global */
  profissional_id?: number
  status?: SituacaoDoTratamento
  /** Filtra NO SERVIDOR: filtrar depois de paginar daria resposta errada */
  vencido?: boolean
  saldo_max?: number
  pagina?: number
  /**
   * Itens por página (`per_page`, 1..100 no servidor). O campo Tratamento do lançamento pede a
   * página cheia: com um pacote por mês e por especialidade, a criança passa de 50 em dois anos.
   */
  por_pagina?: number
}
