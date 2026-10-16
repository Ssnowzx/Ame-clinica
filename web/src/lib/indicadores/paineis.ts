import { queryOptions, useQuery } from '@tanstack/react-query'

import { chaves } from '@/lib/chaves-query'
import { TEMPO_AGENDA_MS } from '@/lib/query-client'
import {
  buscarPainelDaAgenda,
  buscarPainelDaEquipe,
  buscarPainelDoDinheiro,
  buscarPainelDosPacientes,
} from '@/servicos/indicadores'
import type { PainelDaFrente } from '@/lib/indicadores/frases'
import type { FrenteDoPainel, PainelDaAgenda, PainelDaEquipe, PainelDoDinheiro, PainelDosPacientes } from '@/tipos'

/**
 * As consultas dos PAINÉIS por frente (change indicadores-profissionais). Uma chave por frente e
 * mês: o cartão da Visão geral, a linha do período e a aba de detalhe da MESMA frente leem o mesmo
 * cache — trocar de aba não busca de novo o que já chegou.
 *
 * **Nenhuma destas consultas tem `enabled`.** Quem decide se a frente é buscada é quem MONTA o
 * componente, pela permissão do módulo dono (T-not-13): sem a permissão, o componente nem existe.
 * Uma consulta desabilitada no TanStack v5 fica `isPending` para sempre — e viraria um esqueleto
 * eterno no lugar de um cartão que não deveria aparecer (lição da casa).
 *
 * Em arquivo sem componente para não quebrar o fast refresh.
 */

/** A permissão do módulo DONO de cada painel — TODAS exigidas (a equipe cruza os dois eixos). */
export const PERMISSOES_DO_PAINEL: Record<FrenteDoPainel, readonly string[]> = {
  dinheiro: ['fluxo_caixa.ver'],
  agenda: ['agenda.ver'],
  pacientes: ['pacientes.ver'],
  equipe: ['agenda.ver', 'atendimentos.ver'],
}

export function opcoesDoPainelDoDinheiro(mes: string) {
  return {
    queryKey: chaves.indicadores('painel-dinheiro', mes),
    queryFn: () => buscarPainelDoDinheiro(mes),
    staleTime: TEMPO_AGENDA_MS,
  }
}

export function opcoesDoPainelDaAgenda(mes: string) {
  return {
    queryKey: chaves.indicadores('painel-agenda', mes),
    queryFn: () => buscarPainelDaAgenda(mes),
    staleTime: TEMPO_AGENDA_MS,
  }
}

export function opcoesDoPainelDosPacientes(mes: string) {
  return {
    queryKey: chaves.indicadores('painel-pacientes', mes),
    queryFn: () => buscarPainelDosPacientes(mes),
    staleTime: TEMPO_AGENDA_MS,
  }
}

export function opcoesDoPainelDaEquipe(mes: string) {
  return {
    queryKey: chaves.indicadores('painel-equipe', mes),
    queryFn: () => buscarPainelDaEquipe(mes),
    staleTime: TEMPO_AGENDA_MS,
  }
}

/**
 * As opções de consulta de uma frente com o painel ROTULADO pela frente (`select`): o cache guarda o
 * painel cru — o MESMO que o cartão e a aba de detalhe leem —, e quem precisa saber de QUAL frente é
 * cada painel (a linha do período da Visão geral, as regras dos indicadores) o vê com o rótulo, sem
 * consulta própria.
 */
export function opcoesRotuladasDaFrente(frente: FrenteDoPainel, mes: string) {
  switch (frente) {
    case 'dinheiro':
      return queryOptions({ ...opcoesDoPainelDoDinheiro(mes), select: (painel): PainelDaFrente => ({ frente, painel }) })
    case 'agenda':
      return queryOptions({ ...opcoesDoPainelDaAgenda(mes), select: (painel): PainelDaFrente => ({ frente, painel }) })
    case 'pacientes':
      return queryOptions({ ...opcoesDoPainelDosPacientes(mes), select: (painel): PainelDaFrente => ({ frente, painel }) })
    case 'equipe':
      return queryOptions({ ...opcoesDoPainelDaEquipe(mes), select: (painel): PainelDaFrente => ({ frente, painel }) })
  }
}

export function usePainelDoDinheiro(mes: string) {
  return useQuery<PainelDoDinheiro>(opcoesDoPainelDoDinheiro(mes))
}

export function usePainelDaAgenda(mes: string) {
  return useQuery<PainelDaAgenda>(opcoesDoPainelDaAgenda(mes))
}

export function usePainelDosPacientes(mes: string) {
  return useQuery<PainelDosPacientes>(opcoesDoPainelDosPacientes(mes))
}

export function usePainelDaEquipe(mes: string) {
  return useQuery<PainelDaEquipe>(opcoesDoPainelDaEquipe(mes))
}
