import { Lock } from 'lucide-react'

import { ListaDescricao, type ItemDescricao } from '@/componentes/ui/lista-descricao'
import { Realce } from '@/componentes/ui/realce'
import { dataHoraLegivel, dataLegivel } from '@/lib/datas'
import { formatarBRL } from '@/lib/dinheiro'
import type {
  CategoriaFinanceira,
  ContaFinanceira,
  LancamentoCaixaDetalhe,
  TipoDePagamento,
} from '@/tipos'

/** A explicação do porquê: o que NÃO muda aqui, e o que muda. */
export const AVISO_DO_PAGO =
  'Valores, datas, conta, categoria e interessado só mudam estornando o pagamento. Aqui você ajusta o tratamento, o documento e as observações.'

/**
 * O mesmo aviso para quem NÃO dá baixa (CR-RPP-21): o tratamento do pago não muda para ela, e
 * o aviso não pode prometer o que o campo logo abaixo recusa.
 */
export const AVISO_DO_PAGO_SEM_BAIXA =
  'Valores, datas, conta, categoria e interessado só mudam estornando o pagamento. Aqui você ajusta o documento e as observações.'

const ZERO = '0.00'

export interface ResumoDoLancamentoPagoProps {
  lancamento: LancamentoCaixaDetalhe
  contas: readonly ContaFinanceira[]
  categorias: readonly CategoriaFinanceira[]
  tiposPagamento: readonly TipoDePagamento[]
  /** Quem dá baixa troca o tratamento do pago; os outros, não — e o aviso diz o que vale. */
  podeTrocarTratamento: boolean
}

function nomeNoCatalogo(catalogo: ReadonlyArray<{ id: number; nome: string }>, id: number | null): string {
  return catalogo.find((item) => item.id === id)?.nome ?? '—'
}

/**
 * O lançamento PAGO, em LEITURA (change `recebido-por-profissional`).
 *
 * Lançamento pago é documento contábil: o servidor recusa qualquer chave financeira no corpo do
 * `PUT`, mesmo com o valor igual (T-fin-09). Mostrar esses campos editáveis era prometer o que a
 * API recusa — e o formulário mandava todos eles, então nem a observação salvava. Leitura em
 * `<dl>`, não campo desabilitado: o design system troca o formulário travado pela lista de
 * descrição.
 *
 * Juros, multa e desconto só aparecem quando existem — zero em três linhas é ruído no meio do
 * que a pessoa veio conferir.
 */
export function ResumoDoLancamentoPago({
  lancamento,
  contas,
  categorias,
  tiposPagamento,
  podeTrocarTratamento,
}: ResumoDoLancamentoPagoProps) {
  const categoria = categorias.find((item) => item.id === lancamento.categoria_id)
  const subcategoria = categoria?.subcategorias.find((item) => item.id === lancamento.subcategoria_id)
  const acessorios: ItemDescricao[] = [
    { rotulo: 'Juros', valor: lancamento.juros },
    { rotulo: 'Multa', valor: lancamento.multa },
    { rotulo: 'Desconto', valor: lancamento.desconto },
  ]
    .filter((item) => item.valor !== ZERO)
    .map((item) => ({ rotulo: item.rotulo, valor: formatarBRL(item.valor) }))

  const itens: ItemDescricao[] = [
    { rotulo: 'Tipo', valor: lancamento.tipo === 'receita' ? 'Receita' : 'Despesa' },
    { rotulo: 'Pago em', valor: dataHoraLegivel(lancamento.pago_em) },
    { rotulo: 'Valor', valor: formatarBRL(lancamento.valor) },
    ...acessorios,
    { rotulo: 'Líquido', valor: formatarBRL(lancamento.liquido) },
    { rotulo: 'Forma de pagamento', valor: nomeNoCatalogo(tiposPagamento, lancamento.tipo_pagamento_id) },
    { rotulo: 'Conta', valor: nomeNoCatalogo(contas, lancamento.conta_id) },
    {
      rotulo: 'Categoria',
      valor:
        categoria === undefined
          ? '—'
          : subcategoria === undefined
            ? categoria.nome
            : `${categoria.nome} › ${subcategoria.nome}`,
    },
    { rotulo: 'Competência', valor: dataLegivel(lancamento.competencia) },
    { rotulo: 'Vencimento', valor: dataLegivel(lancamento.vencimento) },
    {
      rotulo: 'Interessado',
      valor: lancamento.interessado === undefined ? 'Nenhum' : (lancamento.interessado.nome ?? '—'),
    },
    { rotulo: 'Contábil', valor: lancamento.contabil ? 'Sim' : 'Não' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Realce
        tom="dica"
        rotulo="Lançamento pago"
        icone={<Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info-texto" />}
        texto={podeTrocarTratamento ? AVISO_DO_PAGO : AVISO_DO_PAGO_SEM_BAIXA}
      />
      <ListaDescricao itens={itens} />
    </div>
  )
}
