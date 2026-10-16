import { useMutation, useQueryClient } from '@tanstack/react-query'

import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'
import { formatarBRL } from '@/lib/dinheiro'
import { faturarAgendamento } from '@/servicos/financeiro'
import type { LancamentoCaixa, PayloadFaturamento } from '@/tipos'

/**
 * O lançamento voltou PAGO? Pergunta ao `pago_em` da resposta, não ao que a tela pediu: se o
 * servidor não deu baixa, a tela não anuncia baixa.
 */
export function ehLancamentoPago(lancamento: Pick<LancamentoCaixa, 'pago_em'>): boolean {
  return typeof lancamento.pago_em === 'string' && lancamento.pago_em !== ''
}

/**
 * Os campos do diálogo "Faturar sessão". A chave `agendamento_id` — com que o
 * `FaturamentoService` explica POR QUE o agendamento não é faturável (sessão não
 * consumida, tratamento sem serviço, convênio na esteira §14, já faturado) — NÃO
 * entra de propósito: não é campo, então a recusa pousa em `gerais`, onde o
 * `AvisoErro` a mostra no topo. Se entrasse, a mensagem morreria num campo que a
 * tela não desenha. (Mesmo regime da chave `lancamento` no formulário de lançamento.)
 */
const CAMPOS = new Set([
  'categoria_id',
  'subcategoria_id',
  'tipo_pagamento_id',
  'conta_id',
  'desconto',
  'vencimento',
  'obs',
  'pagar_agora',
])

/**
 * Fatura pela agenda (change faturar-pelo-painel-da-agenda). No sucesso reverbera
 * nas telas que o lançamento novo muda: a lista/ficha do financeiro, o fluxo de
 * caixa, o centro de notificações e o detalhe do agendamento faturado.
 *
 * O 403 (sem `lancamentos.criar`, ou agendamento de OUTRO profissional — SEC-VP-13)
 * chega já traduzido pelo dicionário do `http` (`motivo: 'sem_acesso'`), e pousa em
 * `gerais` como as demais recusas sem campo; o diálogo o complementa com o escopo.
 */
function useMutacaoDeFaturamento() {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS)

  const faturar = useMutation({
    retry: 0,
    mutationFn: ({ agendamentoId, payload }: { agendamentoId: number; payload: PayloadFaturamento }) =>
      faturarAgendamento(agendamentoId, payload),
    onMutate: limparErros,
    onSuccess: async (lancamento, { agendamentoId }) => {
      await queryClient.invalidateQueries({ queryKey: ['lancamentos'] })
      await queryClient.invalidateQueries({ queryKey: ['fluxo-caixa'] })
      await queryClient.invalidateQueries({ queryKey: ['notificacoes'] })
      await queryClient.invalidateQueries({ queryKey: chaves.agendamentoDetalhe(agendamentoId) })
      // o que o SERVIDOR devolveu decide o anúncio: `pago_em` preenchido é a sessão já paga
      const titulo = ehLancamentoPago(lancamento) ? 'Sessão faturada e paga' : 'Lançado no financeiro'
      notificar({ tom: 'sucesso', titulo: `${titulo}: ${formatarBRL(lancamento.liquido)}` })
    },
    onError: aoFalhar,
  })

  return { erros, limparErros, faturar, faturando: faturar.isPending }
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { useMutacaoDeFaturamento as usarMutacaoDeFaturamento }
