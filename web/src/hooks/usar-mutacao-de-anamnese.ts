import { useMutation, useQueryClient } from '@tanstack/react-query'

import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'
import { atualizarAnamnese, criarAnamnese } from '@/servicos/anamneses'
import type { PayloadAnamnese, RespostasAnamnese } from '@/tipos'

/**
 * As chaves com que o servidor recusa: `respostas_json.{id}` (pousa no campo) e
 * `respostas_json` (contrabando de chave — vai ao aviso geral do diálogo). O
 * `modelo_id` (modelo inativo, só na criação) não está no conjunto: cai em `gerais`.
 */
const CAMPOS = new Set(['respostas_json'])

/**
 * Mutação de anamnese (§7) — dado de saúde de MENOR (art. 11).
 *
 * O `onSuccess` invalida SÓ a LISTA (`chaves.anamnesesDoPaciente`) e nunca semeia o
 * detalhe com `setQueryData` (SEC-ANM-02): reabrir para reler é um `show` fresco e
 * AUDITADO. Quem fecha o diálogo é o `onSuccess` da chamada (segundo argumento do
 * `mutate`), não o hook.
 */
function useMutacaoDeAnamnese(pacienteId: number) {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS)

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: chaves.anamnesesDoPaciente(pacienteId) })
    notificar({ tom: 'sucesso', titulo })
  }

  const criar = useMutation({
    retry: 0,
    mutationFn: (payload: PayloadAnamnese) => criarAnamnese(pacienteId, payload),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Anamnese registrada.'),
    onError: aoFalhar,
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, respostas, versao }: { id: number; respostas: RespostasAnamnese; versao: string }) =>
      atualizarAnamnese(id, respostas, versao),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Anamnese salva.'),
    onError: aoFalhar,
  })

  return {
    erros,
    limparErros,
    criar,
    atualizar,
    salvando: criar.isPending || atualizar.isPending,
  }
}

export { useMutacaoDeAnamnese as usarMutacaoDeAnamnese }
