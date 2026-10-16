import type { QueryClient } from '@tanstack/react-query'

import { chaves } from '@/lib/chaves-query'
import type { CardAgendamento } from '@/tipos'

/**
 * O cartão de um agendamento como a GRADE o tem agora — o formato completo do cartão, que o detalhe
 * (`GET /agendamentos/{id}`) não tem (gate CR-EVO-R2-01: tratar o detalhe como cartão derrubou a tela).
 *
 * Quem acabou de invalidar a agenda — a finalização pela evolução — lê daqui, sem requisição nova: a
 * invalidação já releu as consultas ATIVAS da grade. Só elas entram — uma consulta inativa (a Semana
 * deixada em cache ao ir para o Dia) é velha e traria o cartão de antes (gate CR-EVO-R3-05). E só as
 * da grade (`['agenda', { de, ate, … }]`): o detalhe e a série moram sob o mesmo prefixo e não são
 * listas de cartões.
 */
export function cartaoNaGrade(queryClient: QueryClient, id: number): CardAgendamento | undefined {
  const daGrade = queryClient
    .getQueryCache()
    .findAll({
      queryKey: chaves.agenda(),
      type: 'active',
      predicate: (consulta) => {
        const parametros = consulta.queryKey[1]
        return typeof parametros === 'object' && parametros !== null && 'de' in parametros
      },
    })
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)

  for (const consulta of daGrade) {
    const cartoes = consulta.state.data
    if (Array.isArray(cartoes)) {
      // as consultas da grade guardam `CardAgendamento[]` (`buscarAgenda`) — o predicado acima as separou
      const achado: CardAgendamento | undefined = cartoes.find((cartao: CardAgendamento) => cartao.id === id)
      if (achado !== undefined) {
        return achado
      }
    }
  }

  return undefined
}
