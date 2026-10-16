import { useMutation, useQueryClient } from '@tanstack/react-query'

import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import {
  atualizarTratamento,
  criarTratamento,
  excluirTratamento,
} from '@/servicos/tratamentos'
import type { PayloadTratamento } from '@/tipos'

/**
 * Os campos do FORMULÁRIO.
 *
 * `sessoes_realizadas` NÃO está aqui — e não está no payload: o único caminho de
 * escrita dela é a reconciliação do atendimento (a API a recusa de duas formas,
 * mas a tela não a manda nem por acidente).
 *
 * `tratamento` (a chave com que o servidor recusa a EXCLUSÃO de um pacote em uso)
 * também fica de fora de propósito: ela não é campo de formulário nenhum, e se
 * entrasse aqui a mensagem pousaria num campo inexistente — a exclusão falharia em
 * silêncio.
 */
const CAMPOS = new Set([
  // `paciente_id` NÃO entra: não há campo dele na tela (o pacote é da criança da
  // página). A recusa do servidor precisa pousar em `gerais`, onde o AvisoErro a
  // mostra — num campo que não existe, ela não apareceria em lugar nenhum.
  'convenio_id',
  'especialidade_id',
  'profissional_id',
  'servico_id',
  'matricula',
  'guia',
  'sessoes_total',
  'data_inicio',
  'validade_dias',
  // pedido médico (limites-e-pedidos): a recusa de data futura / faixa 1..40
  // pousa NO campo, não no aviso geral
  'pedido_emitido_em',
  'pedido_sessoes_por_semana',
  'status',
])

/** Invalida a lista do paciente E a lista global — o pacote aparece nas duas. */
function useMutacaoDeTratamento() {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS)

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['tratamentos'] })
    // a agenda mostra o saldo no card ("9/10 sessões"): ela também precisa reler
    await queryClient.invalidateQueries({ queryKey: ['agenda'] })
    notificar({ tom: 'sucesso', titulo })
  }

  const criar = useMutation({
    retry: 0,
    mutationFn: (payload: PayloadTratamento) => criarTratamento(payload),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Tratamento cadastrado com sucesso.'),
    onError: aoFalhar,
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: PayloadTratamento; versao: string }) =>
      atualizarTratamento(id, payload, versao),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Tratamento salvo.'),
    onError: aoFalhar,
  })

  const excluir = useMutation({
    retry: 0,
    mutationFn: (id: number) => excluirTratamento(id),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Tratamento excluído.'),
    onError: aoFalhar,
  })

  return {
    erros,
    limparErros,
    criar,
    atualizar,
    excluir,
    salvando: criar.isPending || atualizar.isPending,
    excluindo: excluir.isPending,
  }
}

export { useMutacaoDeTratamento as usarMutacaoDeTratamento }
