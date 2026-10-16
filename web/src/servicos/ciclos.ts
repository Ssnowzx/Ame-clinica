import { garantirCsrf, http } from '@/lib/http'
import type { FechamentoDeCiclo, PeriodoDoCiclo, ProximoCiclo } from '@/tipos'

/**
 * Ciclos de faturamento do convênio — rotas aninhadas, como os serviços e as regras de
 * limite (escopadas pelo pai).
 *
 * As duas LEITURAS vivem sob `ciclos.fechar` no servidor. A tela não as chama sem a
 * permissão: além do 403 inútil, a seção inteira deixa de existir (SEC-FC-09 — a
 * afordância não pode virar oráculo do calendário nem da lista de fechamentos).
 *
 * Aqui não há validação: a API é a autoridade. `garantirCsrf` em toda escrita.
 */

export async function listarCiclos(convenioId: number): Promise<FechamentoDeCiclo[]> {
  const { data } = await http.get<FechamentoDeCiclo[]>(`/api/convenios/${convenioId}/ciclos`)
  return data
}

/**
 * O próximo período fechável, derivado pelo servidor a partir do calendário.
 *
 * `periodo: null` vem SEMPRE acompanhado de um `motivo` — `sem_calendario` (não há corte
 * configurado) ou `ja_fechado` (o corte existe e o último período já foi fechado). São
 * dois estados vazios com próximos passos OPOSTOS, e a tela precisa saber qual é.
 *
 * A tela NUNCA deriva o período por conta própria: o corte é regra de servidor, e duas
 * derivações independentes divergiriam exatamente na virada de mês.
 */
export async function buscarProximoCiclo(convenioId: number): Promise<ProximoCiclo> {
  const { data } = await http.get<ProximoCiclo>(`/api/convenios/${convenioId}/ciclos/proximo`)
  return data
}

export async function fecharCiclo(
  convenioId: number,
  periodo: PeriodoDoCiclo,
): Promise<FechamentoDeCiclo> {
  await garantirCsrf()
  const { data } = await http.post<FechamentoDeCiclo>(
    `/api/convenios/${convenioId}/ciclos`,
    periodo,
  )
  return data
}

/**
 * Reabertura — a exceção do administrador (`ciclos.reabrir`).
 *
 * O `motivo` é obrigatório e vai para a trilha. Ele NÃO é campo de prontuário: a tela
 * pede, em texto, que ninguém escreva nome de criança ali (SEC-FC-06).
 */
export async function reabrirCiclo(
  convenioId: number,
  cicloId: number,
  motivo: string,
): Promise<FechamentoDeCiclo> {
  await garantirCsrf()
  const { data } = await http.post<FechamentoDeCiclo>(
    `/api/convenios/${convenioId}/ciclos/${cicloId}/reabertura`,
    { motivo },
  )
  return data
}
