import type { ComponentType } from 'react'

import type { InteressadoSelecionado } from '@/componentes/financeiro/busca-de-interessado'
import type { ErrosDoServidor } from '@/lib/erros'
import type { FiltroDeInteressados, PaginaDeApi } from '@/tipos'

/**
 * O contrato de um cadastro de "a quem a clínica paga" (change `caixa-do-dia-a-dia`) — fornecedor
 * ou funcionário. Declarado UMA vez por módulo e lido por três lugares: a tela do módulo, o
 * formulário (cheio na tela, curto no lançamento) e o cadastro rápido do Interessado.
 *
 * O cadastro rápido é o MESMO formulário da tela (design D5), não um segundo: a mesma validação, o
 * mesmo payload, a mesma recusa pousando no mesmo campo. Duas cópias divergiriam primeiro
 * justamente aí.
 */

/** O `definir` dos formulários da casa, que também aceita o estado anterior (o CEP responde depois). */
export type Definir<V> = (parciais: Partial<V> | ((anteriores: V) => Partial<V>)) => void

export interface CamposDoInteressadoProps<V> {
  valores: V
  definir: Definir<V>
  erros: ErrosDoServidor
  /**
   * A versão CURTA, do cadastro rápido pelo lançamento: só o que o lançamento precisa (fornecedor:
   * razão social, documento e categoria padrão; funcionário: nome e função). O resto do cadastro
   * se completa depois, na tela do módulo.
   */
  curto: boolean
}

/** A linha e o detalhe têm o mínimo que a tela manipula sem saber de qual módulo são. */
export interface LinhaDeInteressado {
  id: number
  ativo: boolean
}

export interface DetalheDeInteressado extends LinhaDeInteressado {
  updated_at: string
}

export interface ServicoDeInteressado<L, D, P> {
  listar: (filtro: FiltroDeInteressados) => Promise<PaginaDeApi<L>>
  buscar: (id: number) => Promise<D>
  criar: (payload: P) => Promise<D>
  atualizar: (id: number, payload: P, versao: string) => Promise<D>
  excluir: (id: number) => Promise<void>
}

export interface ModuloDeInteressado<
  L extends LinhaDeInteressado,
  D extends DetalheDeInteressado,
  P,
  V extends { ativo: boolean },
> {
  /** O módulo de permissão (`fornecedores.criar`…) */
  modulo: 'fornecedores' | 'funcionarios'
  titulo: string
  rotuloSingular: string
  /** O português tem gênero: "fornecedor cadastradO" */
  genero: 'm' | 'f'
  /** A frase de "o que é" (design D8): a tela explica o cadastro antes de pedir qualquer coisa. */
  explicacao: string
  servico: ServicoDeInteressado<L, D, P>
  /** A fábrica da chave da lista; sem argumento, a raiz do namespace (a invalidação). */
  chave: (filtro?: FiltroDeInteressados) => readonly unknown[]
  /** Os campos do FORMULÁRIO — a chave da entidade (`fornecedor`, com que a exclusão é recusada) fica fora. */
  campos: ReadonlySet<string>
  /** O estado do formulário: novo (com o nome já digitado na busca, quando houver) ou edição. */
  valoresIniciais: (detalhe?: D, nomeSugerido?: string) => V
  /** `curto` deixa contatos e endereço fora do corpo: o formulário curto não os desenha. */
  paraPayload: (valores: V, curto: boolean) => P
  nomeDaLinha: (linha: L) => string
  nomeDoDetalhe: (detalhe: D) => string
  /** O recém-cadastrado, na forma que o campo Interessado do lançamento guarda. */
  comoInteressado: (detalhe: D) => InteressadoSelecionado
  Campos: ComponentType<CamposDoInteressadoProps<V>>
}
