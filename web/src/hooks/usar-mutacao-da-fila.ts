import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { usarToast } from '@/componentes/ui/toast'
import { ehConflitoDeEdicao } from '@/lib/conflito'
import { chaves } from '@/lib/chaves-query'
import { distribuirErros, type ErrosDoFormulario } from '@/lib/erros-agenda'
import { atualizarEntrada, entrarNaFila, sairDaFila } from '@/servicos/lista-espera'
import type { PayloadDaFila } from '@/tipos'

const SEM_ERROS: ErrosDoFormulario = { porCampo: {}, gerais: [] }

/**
 * Mutações da FILA (entrar, editar, sair) — mesmo padrão da agenda (design D8):
 * `retry: 0` (repetir um POST é duplicar a entrada), CSRF no serviço, recusa no
 * campo certo, sucesso com toast e a fila invalidada.
 *
 * O ENCAIXE não mora aqui: ele é escrita de agenda (e move as duas listas) —
 * vive em `usarMutacaoDeAgendamento`.
 */
function useMutacaoDaFila() {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const [erros, setErros] = useState<ErrosDoFormulario>(SEM_ERROS)

  function limparErros(): void {
    setErros(SEM_ERROS)
  }

  function aoFalhar(erro: unknown): void {
    const distribuidos = distribuirErros(erro)
    setErros(distribuidos)

    // "Sair da fila" não tem formulário onde a mensagem possa pousar: sem o
    // toast, a recusa seria invisível
    const mensagem = distribuidos.gerais[0] ?? Object.values(distribuidos.porCampo)[0]
    if (mensagem !== undefined) {
      notificar({ tom: 'erro', titulo: mensagem })
    }
  }

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: chaves.listaEspera() })
    notificar({ tom: 'sucesso', titulo })
  }

  const entrar = useMutation({
    retry: 0,
    mutationFn: (payload: PayloadDaFila) => entrarNaFila(payload),
    onMutate: limparErros,
    onError: aoFalhar,
    onSuccess: () => aoConcluir('Paciente na lista de espera.'),
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: PayloadDaFila; versao: string }) =>
      atualizarEntrada(id, payload, versao),
    onMutate: limparErros,
    onError: (erro) => {
      aoFalhar(erro)
      // conflito (EX-05/B1): invalida a leitura que hidratou a LINHA — reabrir re-hidrata fresco
      if (ehConflitoDeEdicao(erro)) {
        void queryClient.invalidateQueries({ queryKey: chaves.listaEspera() })
      }
    },
    onSuccess: () => aoConcluir('Entrada atualizada.'),
  })

  const sair = useMutation({
    retry: 0,
    mutationFn: (id: number) => sairDaFila(id),
    onMutate: limparErros,
    onError: aoFalhar,
    onSuccess: () => aoConcluir('Paciente removido da lista de espera.'),
  })

  return {
    entrar,
    atualizar,
    sair,
    erros,
    limparErros,
    gravando: entrar.isPending || atualizar.isPending || sair.isPending,
  }
}

export { useMutacaoDaFila as usarMutacaoDaFila }
