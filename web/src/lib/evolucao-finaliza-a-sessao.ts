import type { StatusDaSelecao } from '@/lib/baixa-em-lote'

/**
 * Salvar a evolução vai finalizar esta sessão? (change evolucao-finaliza-a-sessao)
 *
 * Só para AVISAR antes do clique — quem decide é o servidor, e a resposta diz o que aconteceu. A
 * régua é a mesma do servidor, lida da seleção da agenda que a tela já carregou (nenhuma requisição
 * a mais): a sessão está EM ABERTO (flag `em_aberto`) e o status configurado ainda FINALIZA —
 * desconta, não é falta e é sessão marcada (gate CR-EVO-14: o id configurado sozinho não basta).
 * Na dúvida (seleção ausente, status desconhecido), não promete.
 */
export function evolucaoVaiFinalizar(
  status: readonly StatusDaSelecao[] | undefined,
  statusAtualId: number | undefined,
  statusAoSalvarId: number,
): boolean {
  if (status === undefined || statusAtualId === undefined || statusAoSalvarId <= 0) {
    return false
  }
  const atual = status.find((item) => item.id === statusAtualId)
  const alvo = status.find((item) => item.id === statusAoSalvarId)

  return (
    atual?.em_aberto === true
    && alvo !== undefined
    && alvo.desconta_sessao
    && !alvo.marca_falta
    && alvo.sessao_marcada === true
  )
}
