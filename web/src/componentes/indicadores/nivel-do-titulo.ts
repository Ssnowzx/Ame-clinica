import { createContext, useContext } from 'react'

/**
 * O NÍVEL do título dos cartões e dos quadros de gráfico. Nas abas dos Indicadores eles ficam logo
 * abaixo do `h1` da área, e são `h2`; no painel do profissional moram DENTRO de um bloco com `h2` próprio
 * ("O mês em números", "Seis meses"…), e são `h3` — sem pular nível e sem dois `h2` aninhados (spec do
 * design system: os títulos respeitam a ordem). Quem embrulha o bloco diz o nível; os componentes leem.
 *
 * Em arquivo sem componente para não quebrar o fast refresh.
 */
type NivelDoTitulo = 2 | 3

export const ContextoDoNivelDoTitulo = createContext<NivelDoTitulo>(2)

/** A tag do título no nível de onde o componente foi montado. */
export function useTagDoTitulo(): 'h2' | 'h3' {
  return useContext(ContextoDoNivelDoTitulo) === 3 ? 'h3' : 'h2'
}
