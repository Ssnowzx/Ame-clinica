import { useQuery } from '@tanstack/react-query'

import type { OpcaoDeclarada, RelatorioDoCatalogo } from '@/lib/relatorios/catalogo'
import type { CategoriaFinanceira, ContaFinanceira, TipoLancamento } from '@/tipos'

import { chaves } from '@/lib/chaves-query'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { listarCategorias, listarContas } from '@/servicos/financeiro'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Os catálogos dos filtros Conta e Categoria dos relatórios do caixa (change `relatorios-do-caixa`,
 * D6). Cada campo existe só quando o relatório o declara E a pessoa pode ver aquele catálogo:
 * sem a permissão, o campo não aparece e o relatório sai sem esse filtro — o servidor nunca exige.
 */
function useCatalogosDoCaixa(relatorio: RelatorioDoCatalogo) {
  const podeContas = useAuthStore((estado) => estado.temPermissao('contas.ver'))
  const podeCategorias = useAuthStore((estado) => estado.temPermissao('categorias.ver'))
  const mostraConta = relatorio.filtros.includes('conta') && podeContas
  const mostraCategoria = relatorio.filtros.includes('categoria') && podeCategorias

  // as MESMAS chaves do financeiro: cadastrar uma conta lá invalida o seletor daqui
  const contas = useQuery({
    queryKey: chaves.contas(),
    queryFn: listarContas,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: mostraConta,
  })
  const categorias = useQuery({
    queryKey: chaves.categorias(),
    queryFn: listarCategorias,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: mostraCategoria,
  })

  return {
    mostraConta,
    mostraCategoria,
    contas: contas.data ?? [],
    categorias: categorias.data ?? [],
    erroNasContas: contas.isError,
    erroNasCategorias: categorias.isError,
  }
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { useCatalogosDoCaixa as usarCatalogosDoCaixa }

const TODAS: OpcaoDeclarada = { valor: '', rotulo: 'Todas' }

const NOME_DA_NATUREZA: Record<TipoLancamento, string> = { receita: 'receita', despesa: 'despesa' }

/** As contas, com a inativa marcada: o extrato de uma conta que saiu de uso continua valendo. */
export function opcoesDeConta(contas: readonly ContaFinanceira[]): OpcaoDeclarada[] {
  return [TODAS, ...contas.map((conta) => ({ valor: String(conta.id), rotulo: conta.ativo ? conta.nome : `${conta.nome} (inativa)` }))]
}

/**
 * As categorias da natureza em vigor — ou as duas, com a natureza escrita, quando o Tipo não a
 * define. A categoria já escolhida que NÃO cabe na natureza continua na lista, marcada: o campo
 * mostra o que vai ao servidor (que a recusa dizendo o porquê), nunca "Todas" por cima de um id.
 */
export function opcoesDeCategoria(
  categorias: readonly CategoriaFinanceira[],
  natureza: TipoLancamento | undefined,
  escolhida: string | undefined,
): OpcaoDeclarada[] {
  const comNatureza = (categoria: CategoriaFinanceira): OpcaoDeclarada => ({
    valor: String(categoria.id),
    rotulo: `${categoria.nome} (${NOME_DA_NATUREZA[categoria.tipo]})`,
  })
  if (natureza === undefined) {
    const receitas = categorias.filter((categoria) => categoria.tipo === 'receita')
    const despesas = categorias.filter((categoria) => categoria.tipo === 'despesa')

    return [TODAS, ...receitas.map(comNatureza), ...despesas.map(comNatureza)]
  }
  const daNatureza = categorias
    .filter((categoria) => categoria.tipo === natureza)
    .map((categoria) => ({ valor: String(categoria.id), rotulo: categoria.nome }))
  const foraDaNatureza = categorias.find((categoria) => String(categoria.id) === escolhida && categoria.tipo !== natureza)

  return [TODAS, ...daNatureza, ...(foraDaNatureza === undefined ? [] : [comNatureza(foraDaNatureza)])]
}

/**
 * A categoria escolhida cabe na natureza nova? Sem escolha, sem natureza ou sem a lista carregada,
 * cabe — quem decide, no fim, é o servidor (422 com a razão).
 */
export function categoriaCabe(
  categorias: readonly CategoriaFinanceira[],
  escolhida: string | undefined,
  natureza: TipoLancamento | undefined,
): boolean {
  if (escolhida === undefined || natureza === undefined) {
    return true
  }
  const categoria = categorias.find((candidata) => String(candidata.id) === escolhida)

  return categoria === undefined || categoria.tipo === natureza
}

/** Por que a lista de categorias está como está — dito sob o campo. */
export function ajudaDaCategoria(
  relatorio: RelatorioDoCatalogo,
  natureza: TipoLancamento | undefined,
  comErro: boolean,
): string | undefined {
  if (comErro) {
    return 'Não foi possível carregar as categorias.'
  }
  if (natureza === undefined) {
    return undefined
  }
  if (relatorio.categoriasDaNatureza?.fixa !== undefined) {
    return `Só as categorias de ${NOME_DA_NATUREZA[natureza]}: é o que este relatório conta.`
  }

  return `Só as categorias de ${NOME_DA_NATUREZA[natureza]}, pelo que você escolheu em "${relatorio.rotulosDoTipo?.campo ?? 'Tipo'}".`
}
