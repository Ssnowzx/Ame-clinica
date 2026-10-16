import { garantirCsrf, http, putComVersao } from '@/lib/http'
import type {
  Atendimento,
  AtendimentoDetalhe,
  DestinoDaEvolucao,
  Evolucao,
  EvolucaoDetalhe,
  EvolucaoRegistrada,
  EvolucaoEmAberto,
  PaginaDeApi,
  PayloadAtendimento,
  PayloadEvolucao,
  PayloadEvolucaoEdicao,
} from '@/tipos'

/** O atendimento de UM agendamento (1:1 — a lista traz zero ou uma linha). */
export async function buscarAtendimentoDoAgendamento(agendamentoId: number): Promise<Atendimento | null> {
  const { data } = await http.get<PaginaDeApi<Atendimento>>('/api/atendimentos', {
    params: { agendamento_id: agendamentoId },
  })

  return data.data[0] ?? null
}

/**
 * A linha do tempo do PRONTUÁRIO da ficha: os atendimentos de UM paciente,
 * resolvidos pelo agendamento-mãe no servidor (interseção com o escopo D11 na
 * mesma query — SEC-PF-01). Metadados-só: `observacoes` nunca vem na listagem.
 */
export async function buscarAtendimentosDoPaciente(
  pacienteId: number,
  pagina: number,
): Promise<PaginaDeApi<Atendimento>> {
  const { data } = await http.get<PaginaDeApi<Atendimento>>('/api/atendimentos', {
    params: { paciente_id: pacienteId, page: pagina },
  })

  return data
}

/**
 * O DETALHE — é o único lugar de onde `observacoes` sai (dado clínico, detail-only) e o
 * único de onde sai `em_ciclo_fechado` (SEC-FC-09). Por isso o retorno é
 * `AtendimentoDetalhe`, não `Atendimento`: o tipo carrega essa fronteira.
 */
export async function buscarAtendimento(id: number): Promise<AtendimentoDetalhe> {
  const { data } = await http.get<AtendimentoDetalhe>(`/api/atendimentos/${id}`)

  return data
}

export async function registrarAtendimento(
  agendamentoId: number,
  payload: PayloadAtendimento,
): Promise<Atendimento> {
  await garantirCsrf()
  const { data } = await http.post<Atendimento>(`/api/agendamentos/${agendamentoId}/atendimento`, payload)

  return data
}

export async function atualizarAtendimento(id: number, payload: PayloadAtendimento, versao: string): Promise<Atendimento> {
  const data = await putComVersao<Atendimento>(`/api/atendimentos/${id}`, payload, versao)

  return data
}

export async function excluirAtendimento(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/atendimentos/${id}`)
}

/**
 * O prontuário. A leitura é AUDITADA no servidor (art. 11) — por isso a query que
 * consome esta função NÃO pode ser servida por cache: um segundo profissional que abrisse
 * o prontuário sem chegar ao servidor não apareceria na trilha, e a auditoria mentiria.
 */
export async function buscarEvolucao(id: number): Promise<EvolucaoDetalhe> {
  const { data } = await http.get<EvolucaoDetalhe>(`/api/evolucoes/${id}`)

  return data
}

/**
 * Sem atendimento, a rota da SESSÃO registra o atendimento e a evolução numa transação só (D1) —
 * a tela não encadeia duas chamadas, que deixariam atendimento sem evolução numa falha no meio.
 */
export async function registrarEvolucao(destino: DestinoDaEvolucao, payload: PayloadEvolucao): Promise<EvolucaoRegistrada> {
  await garantirCsrf()
  const url =
    'atendimentoId' in destino
      ? `/api/atendimentos/${destino.atendimentoId}/evolucao`
      : `/api/agendamentos/${destino.agendamentoId}/evolucao`
  const { data } = await http.post<EvolucaoRegistrada>(url, payload)

  return data
}

export async function atualizarEvolucao(id: number, payload: PayloadEvolucaoEdicao, versao: string): Promise<Evolucao> {
  const data = await putComVersao<Evolucao>(`/api/evolucoes/${id}`, payload, versao)

  return data
}

/**
 * A fila: quem DEVE evolução. `prazo_ate` e `vencida` vêm calculados no fuso da CLÍNICA —
 * a tela os exibe e não os refaz (o navegador pode estar em outro fuso).
 *
 * Nunca traz conteúdo: por definição, a fila é a dos atendimentos que ainda NÃO têm evolução.
 */
export async function listarEvolucoesEmAberto(filtro: {
  profissionalId?: number | null
  pagina?: number
}): Promise<PaginaDeApi<EvolucaoEmAberto>> {
  const { data } = await http.get<PaginaDeApi<EvolucaoEmAberto>>('/api/evolucoes/em-aberto', {
    params: {
      page: filtro.pagina ?? 1,
      ...(filtro.profissionalId != null ? { profissional_id: filtro.profissionalId } : {}),
    },
  })

  return data
}
