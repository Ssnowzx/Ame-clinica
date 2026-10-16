import { useQuery } from '@tanstack/react-query'

import type { CategoriaNoDre, ConfiguracaoDoDre, SubcategoriaNoDre, TipoLancamento } from '@/tipos'

import { chaves } from '@/lib/chaves-query'
import { possuiTodasAsPermissoes } from '@/lib/permissoes'
import { buscarConfiguracaoDoDre } from '@/servicos/dre'
import { useAuthStore } from '@/stores/auth-store'

/** Trocar a linha muda o que o DRE mostra: é de quem edita categorias E vê o caixa (design D6). */
const PERMISSOES_DE_TROCAR_A_LINHA = ['categorias.editar', 'fluxo_caixa.ver'] as const

const NOME_DA_NATUREZA: Record<TipoLancamento, string> = { receita: 'receita', despesa: 'despesa' }

/**
 * A configuração do DRE, para quem pode vê-la (`fluxo_caixa.ver`): quem não vê o resultado da
 * clínica não tem por que saber em que linha dele a categoria cai — e a escada vem do servidor.
 */
function useConfiguracaoDoDre() {
  const podeVer = useAuthStore((estado) => estado.temPermissao('fluxo_caixa.ver'))
  const podeTrocar = useAuthStore((estado) => possuiTodasAsPermissoes(estado.temPermissao, PERMISSOES_DE_TROCAR_A_LINHA))
  const consulta = useQuery({
    queryKey: chaves.configuracaoDoDre(),
    queryFn: buscarConfiguracaoDoDre,
    enabled: podeVer,
  })

  return { consulta, podeVer, podeTrocar }
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { useConfiguracaoDoDre as usarConfiguracaoDoDre }

/** O rótulo da linha pelo código — o código cru nunca vai à tela. */
export function rotuloDaLinha(configuracao: ConfiguracaoDoDre, codigo: string): string {
  return configuracao.linhas.find((linha) => linha.codigo === codigo)?.rotulo ?? 'Linha que não existe mais'
}

/** As linhas que aceitam a natureza — despesa nunca entra numa linha de receita (D5). */
export function linhasDaNatureza(configuracao: ConfiguracaoDoDre, natureza: TipoLancamento) {
  return configuracao.linhas.filter((linha) => linha.natureza === natureza)
}

/** "Despesas administrativas (padrão da despesa)" — a linha em vigor e de onde ela vem. */
export function descreverLinhaDaCategoria(configuracao: ConfiguracaoDoDre, categoria: CategoriaNoDre): string {
  const rotulo = rotuloDaLinha(configuracao, categoria.linha_efetiva)

  return categoria.linha_dre === null ? `${rotulo} (padrão da ${NOME_DA_NATUREZA[categoria.tipo]})` : rotulo
}

/** "Despesas com pessoal (segue a categoria)" quando a subcategoria não escolheu a sua. */
export function descreverLinhaDaSubcategoria(configuracao: ConfiguracaoDoDre, subcategoria: SubcategoriaNoDre): string {
  const rotulo = rotuloDaLinha(configuracao, subcategoria.linha_efetiva)

  return subcategoria.linha_dre === null ? `${rotulo} (segue a categoria)` : rotulo
}

/** A opção "sem escolha" do seletor: o padrão da natureza, ou a linha da categoria-mãe. */
export function opcaoSemEscolha(
  configuracao: ConfiguracaoDoDre,
  alvo: { tipo: 'categoria'; natureza: TipoLancamento } | { tipo: 'subcategoria'; categoria: CategoriaNoDre },
): { valor: string; rotulo: string } {
  if (alvo.tipo === 'categoria') {
    return {
      valor: '',
      rotulo: `Padrão da ${NOME_DA_NATUREZA[alvo.natureza]} (${rotuloDaLinha(configuracao, configuracao.padrao[alvo.natureza])})`,
    }
  }

  return { valor: '', rotulo: `Segue a categoria (${rotuloDaLinha(configuracao, alvo.categoria.linha_efetiva)})` }
}

/** O `id` do seletor de cada item — é por ele que o foco volta depois que o item muda de linha. */
export function idDoSeletor(tipo: 'categoria' | 'subcategoria', id: number): string {
  return `dre-${tipo}-${id}`
}
