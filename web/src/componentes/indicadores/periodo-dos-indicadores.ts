import { useOutletContext } from 'react-router-dom'

/**
 * O que o shell da área compartilha com cada aba.
 *
 * Mora em arquivo PRÓPRIO (sem componente) porque o fast refresh do Vite só funciona
 * quando um módulo exporta apenas componentes — misturar hook e componente derrubava o
 * recarregamento em toda edição do shell.
 */
export interface ContextoDosIndicadores {
  mes: string
  /** Move o período da ÁREA. A aba que precisa de salto de ano usa `somarMeses(mes, ±12)`
   *  — o eixo continua sendo UM só, e a URL segue dona do estado. Fora do alcance (mês futuro ou
   *  anterior a 2000), o mês fica no limite: o servidor recusaria (422) e as abas ficariam sem saída. */
  trocarMes: (proximo: string) => void
  /** O mês de HOJE no fuso da clínica — o último que a área mostra (CR-IND-17) */
  mesCorrente: string
}

/** O primeiro mês que a área aceita — o mesmo piso do servidor (`?mes=` abaixo de 2000-01 é 422). */
export const PRIMEIRO_MES_DOS_INDICADORES = '2000-01'

/** O mês dentro do alcance da área: nem antes de 2000-01, nem depois do mês corrente da clínica. */
export function mesNoAlcance(mes: string, mesCorrente: string): string {
  if (mes < PRIMEIRO_MES_DOS_INDICADORES) {
    return PRIMEIRO_MES_DOS_INDICADORES
  }

  return mes > mesCorrente ? mesCorrente : mes
}

/** Atalho para a aba ler o mês da área sem reimplementar a leitura da URL. */
export function useMesDosIndicadores(): string {
  return useOutletContext<ContextoDosIndicadores>().mes
}

/** O contexto inteiro, para quem também precisa MOVER o período (ex.: salto de ano). */
export function usePeriodoDosIndicadores(): ContextoDosIndicadores {
  return useOutletContext<ContextoDosIndicadores>()
}
