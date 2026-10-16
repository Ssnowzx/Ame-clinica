import { useQuery } from '@tanstack/react-query'

import type { FiltroDeTratamentos } from '@/tipos'

import { chaves } from '@/lib/chaves-query'
import { listarTratamentos } from '@/servicos/tratamentos'

/**
 * As leituras de TRATAMENTOS da ficha do profissional — a lista é escopada pelo eixo AGENDA (D11), então
 * só são montadas por quem ALCANÇA este profissional (a própria ficha, ou quem opera a agenda de toda a
 * clínica). Sem `enabled` de propósito: quem decide é quem monta o componente — uma consulta
 * desabilitada no TanStack v5 fica `isPending` para sempre (lição da casa).
 *
 * Em arquivo sem componente para não quebrar o fast refresh.
 */

/** O recorte "em andamento" da ficha — o MESMO filtro da lista de Tratamentos aberta pela porta. */
function filtroDosAtivos(profissionalId: number): FiltroDeTratamentos {
  return { profissional_id: profissionalId, status: 'andamento', pagina: 1 }
}

/** A página CHEIA do servidor (`per_page` vai de 1 a 100): passou disso, a lista se declara cortada. */
export const PAGINA_CHEIA = 100

/**
 * Os pacotes perto do fim: o recorte "Acabando" do servidor (o limiar da clínica, §13), numa página cheia.
 * A lista "Acabando" inclui o pacote de UMA sessão; o aviso "Pacotes acabando" não — quem separa os dois
 * é o veredito `realce` que o servidor manda em cada linha (a mesma fonte única, `RealceDoPacote`).
 */
function filtroDosPacotesNoFim(profissionalId: number): FiltroDeTratamentos {
  return { profissional_id: profissionalId, status: 'andamento', acabando: true, pagina: 1, por_pagina: PAGINA_CHEIA }
}

export function useTratamentosAtivos(profissionalId: number) {
  const filtro = filtroDosAtivos(profissionalId)

  return useQuery({ queryKey: chaves.tratamentos(filtro), queryFn: () => listarTratamentos(filtro) })
}

export function usePacotesNoFim(profissionalId: number) {
  const filtro = filtroDosPacotesNoFim(profissionalId)

  return useQuery({ queryKey: chaves.tratamentos(filtro), queryFn: () => listarTratamentos(filtro) })
}
