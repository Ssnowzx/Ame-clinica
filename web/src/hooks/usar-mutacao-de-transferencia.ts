import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { PayloadTransferencia } from '@/tipos'

import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { atualizarTransferencia, criarTransferencia, excluirTransferencia } from '@/servicos/financeiro'

/** Os campos do diálogo — a recusa de "contas iguais" (`different`) pousa em `conta_destino_id`. */
const CAMPOS = new Set(['conta_origem_id', 'conta_destino_id', 'valor', 'data', 'obs'])

/**
 * As escritas da transferência entre contas (change `caixa-do-dia-a-dia`). Toda uma reconsulta o
 * FLUXO DE CAIXA, que é onde a transferência aparece (a linha e o total "Transferido"): sem isso,
 * a clínica corrige o valor e continua vendo o antigo.
 */
function useMutacaoDeTransferencia() {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS)

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['fluxo-caixa'] })
    notificar({ tom: 'sucesso', titulo })
  }

  const criar = useMutation({
    retry: 0,
    mutationFn: (payload: PayloadTransferencia) => criarTransferencia(payload),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Transferência registrada.'),
    onError: aoFalhar,
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: PayloadTransferencia; versao: string }) =>
      atualizarTransferencia(id, payload, versao),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Transferência salva.'),
    onError: aoFalhar,
  })

  const excluir = useMutation({
    retry: 0,
    mutationFn: (id: number) => excluirTransferencia(id),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Transferência excluída.'),
    onError: aoFalhar,
  })

  return {
    erros,
    limparErros,
    notificar,
    criar,
    atualizar,
    excluir,
    salvando: criar.isPending || atualizar.isPending,
  }
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { useMutacaoDeTransferencia as usarMutacaoDeTransferencia }
