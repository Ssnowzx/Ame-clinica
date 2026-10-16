import { http } from '@/lib/http'
import type { LinhaAuditoria, PaginaDeApi } from '@/tipos'

/**
 * Trilha de UM agendamento (mais recente no topo, pelo servidor). A resposta é
 * paginada; a sub-view do histórico consome a primeira página.
 */
export async function buscarAuditoriaDoAgendamento(agendamentoId: number): Promise<LinhaAuditoria[]> {
  const { data } = await http.get<{ data: LinhaAuditoria[] }>('/api/auditoria', {
    params: { entidade: 'agendamentos', entidade_id: agendamentoId },
  })
  return data.data
}

/** Filtros da tela de auditoria (auditoria-tela) — todos opcionais, aplicados pela API. */
export interface FiltrosDeAuditoria {
  entidade?: string
  entidadeId?: string
  usuarioId?: string
  acao?: string
  de?: string
  ate?: string
  pagina?: number
}

/** A trilha paginada com filtros — a tela nunca filtra client-side o que a API sabe filtrar. */
export async function listarAuditoria(filtros: FiltrosDeAuditoria): Promise<PaginaDeApi<LinhaAuditoria>> {
  const { data } = await http.get<PaginaDeApi<LinhaAuditoria>>('/api/auditoria', {
    params: {
      entidade: filtros.entidade || undefined,
      // id órfão (URL na mão, sem entidade) não viaja — a API exige o par (422)
      entidade_id: filtros.entidade ? filtros.entidadeId || undefined : undefined,
      usuario_id: filtros.usuarioId || undefined,
      acao: filtros.acao || undefined,
      de: filtros.de || undefined,
      ate: filtros.ate || undefined,
      page: filtros.pagina ?? 1,
    },
  })
  return data
}
