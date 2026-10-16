import { useMutation, useQueryClient } from '@tanstack/react-query'

import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { ehLancamentoPago } from '@/hooks/usar-mutacao-de-faturamento'
import {
  atualizarLancamento,
  criarLancamento,
  estornarPagamento,
  excluirLancamento,
  pagarLancamento,
} from '@/servicos/financeiro'
import type { CriacaoDeLancamento, PayloadLancamento, PayloadLancamentoPago } from '@/tipos'

/**
 * Os campos do FORMULÁRIO de lançamento.
 *
 * A chave `lancamento` — com que o serviço recusa mexer no PAGO (T-fin-09) — NÃO
 * entra: não é campo, então a recusa pousa em `gerais`, onde o `AvisoErro` a mostra.
 * Num campo inexistente, o estorno-antes-de-editar falharia em silêncio.
 */
const CAMPOS = new Set([
  'tipo',
  'competencia',
  'vencimento',
  'interessado_tipo',
  'interessado_id',
  'categoria_id',
  'subcategoria_id',
  'valor',
  'juros',
  'multa',
  'desconto',
  'tipo_pagamento_id',
  'conta_id',
  'contabil',
  'documento',
  'obs',
  'parcelas',
  // "Já foi pago" com parcelas ≥ 2 (a API recusa: o parcelamento é pago parcela a parcela)
  'pagar_agora',
  // a recusa do vínculo (tratamento de outra criança, ou troca no faturado) pousa NO campo
  'tratamento_id',
])

/**
 * A criação voltou PAGA? Pergunta ao `pago_em` da resposta, como o faturamento
 * (`ehLancamentoPago`): se o servidor não deu baixa, a tela não anuncia baixa (CR-CDD-06). O
 * envelope do parcelado só é "pago" se TODAS as parcelas vierem pagas — e o servidor recusa
 * `pagar_agora` no parcelado, então na prática nunca é.
 */
function criacaoFoiPaga(resposta: CriacaoDeLancamento): boolean {
  // corpo que não é objeto (resposta vazia) não prova baixa nenhuma — e o `in` lançaria
  if (typeof resposta !== 'object' || resposta === null) {
    return false
  }
  if ('lancamentos' in resposta) {
    return resposta.lancamentos.length > 0 && resposta.lancamentos.every(ehLancamentoPago)
  }
  return ehLancamentoPago(resposta)
}

/**
 * Invalida a lista/detalhe do lançamento, o extrato do fluxo (regime de caixa: dar
 * baixa muda o período) e o centro de notificações (o bloco "lançamentos em atraso"
 * conta os não pagos). Uma escrita que não reverbera nessas três mente para a próxima tela.
 */
function useMutacaoDeLancamento() {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS)

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['lancamentos'] })
    await queryClient.invalidateQueries({ queryKey: ['fluxo-caixa'] })
    await queryClient.invalidateQueries({ queryKey: ['notificacoes'] })
    notificar({ tom: 'sucesso', titulo })
  }

  const criar = useMutation({
    retry: 0,
    mutationFn: (payload: PayloadLancamento) => criarLancamento(payload),
    onMutate: limparErros,
    // "Já foi pago" (caixa-do-dia-a-dia): o anúncio diz o que ACONTECEU — registrado E pago só
    // quando a resposta volta com `pago_em`; o que a tela pediu não é prova de baixa (CR-CDD-06)
    onSuccess: (resposta) =>
      aoConcluir(criacaoFoiPaga(resposta) ? 'Lançamento registrado e pago.' : 'Lançamento registrado.'),
    onError: aoFalhar,
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({
      id,
      payload,
      versao,
    }: {
      id: number
      payload: PayloadLancamento | PayloadLancamentoPago
      versao: string
    }) =>
      atualizarLancamento(id, payload, versao),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Lançamento salvo.'),
    onError: aoFalhar,
  })

  const excluir = useMutation({
    retry: 0,
    mutationFn: ({ id, aplicarNoGrupo }: { id: number; aplicarNoGrupo: boolean }) =>
      excluirLancamento(id, aplicarNoGrupo),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Lançamento excluído.'),
    onError: aoFalhar,
  })

  const pagar = useMutation({
    retry: 0,
    mutationFn: (id: number) => pagarLancamento(id),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Baixa registrada.'),
    onError: aoFalhar,
  })

  const estornar = useMutation({
    retry: 0,
    mutationFn: (id: number) => estornarPagamento(id),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Pagamento estornado.'),
    onError: aoFalhar,
  })

  return {
    erros,
    limparErros,
    criar,
    atualizar,
    excluir,
    pagar,
    estornar,
    salvando: criar.isPending || atualizar.isPending,
    excluindo: excluir.isPending,
    baixando: pagar.isPending || estornar.isPending,
  }
}

export { useMutacaoDeLancamento as usarMutacaoDeLancamento }
