import type { RelatorioDoCatalogo } from '@/lib/relatorios/catalogo'

/**
 * A busca do catálogo — por nome de agora, descrição e nome antigo, SEM sensibilidade a
 * acento ou caixa: "evolucoes" acha "Evoluções", e "agenda por status" acha o cartão
 * "Agendamentos" pelo nome que a recepção conhece do ClinicaÁgil.
 */
export function normalizarParaBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function filtrarRelatorios(
  relatorios: readonly RelatorioDoCatalogo[],
  termo: string,
): RelatorioDoCatalogo[] {
  const procurado = normalizarParaBusca(termo)
  if (procurado === '') {
    return [...relatorios]
  }

  return relatorios.filter((relatorio) =>
    [relatorio.nome, relatorio.descricao, ...relatorio.nomesAntigos].some((texto) =>
      normalizarParaBusca(texto).includes(procurado),
    ),
  )
}
