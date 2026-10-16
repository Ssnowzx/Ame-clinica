import { useMutation, useQueryClient } from '@tanstack/react-query'

import { usarErrosDoServidor } from '@/hooks/usar-erros-do-servidor'
import { chaves } from '@/lib/chaves-query'
import { ErroDeApi } from '@/lib/http'
import {
  atualizarAtendimento,
  atualizarEvolucao,
  excluirAtendimento,
  registrarAtendimento,
  registrarEvolucao,
} from '@/servicos/atendimentos'
import type {
  DestinoDaEvolucao,
  PayloadAtendimento,
  PayloadEvolucao,
  PayloadEvolucaoEdicao,
  SessaoAoSalvarEvolucao,
} from '@/tipos'

/**
 * Onde a recusa do servidor POUSA.
 *
 * `agendamento_id` e `atendimento` NÃO entram: são as chaves com que o servidor recusa
 * registrar (bloqueio não é atendível; já tem atendimento) e excluir (tem evolução; sessão
 * consumida). Não existe campo de formulário para elas — mapeadas, a mensagem pousaria num
 * campo inexistente e a falha seria SILENCIOSA. Fora do set, elas caem em `gerais`, onde o
 * AvisoErro as mostra, dentro do diálogo em que a pessoa está olhando.
 */
const CAMPOS_DO_ATENDIMENTO = new Set(['iniciado_em', 'finalizado_em', 'observacoes'])

/** `atendimento_id` fica fora pelo mesmo motivo (é a recusa de evolução duplicada). */
const CAMPOS_DA_EVOLUCAO = new Set([
  'profissional_id',
  'responsavel_tecnico_id',
  'conteudo',
  'motivo_assinatura', // exceção de autoria (FA-04): o campo existe no ramo sem-vínculo
])

function useMutacaoDeAtendimento() {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS_DO_ATENDIMENTO)

  async function aoConcluir(titulo: string): Promise<void> {
    // `['atendimentos']` alcança o detalhe TAMBÉM: as chaves destas entidades nascem
    // prefixo-corretas (gatilho CHAVE-DETALHE), ao contrário das mais antigas
    await queryClient.invalidateQueries({ queryKey: ['atendimentos'] })
    // a fila de evoluções em aberto muda quando um atendimento nasce ou morre
    await queryClient.invalidateQueries({ queryKey: ['evolucoes'] })
    // o contador do cabeçalho conta essa fila
    await queryClient.invalidateQueries({ queryKey: ['notificacoes'] })
    notificar({ tom: 'sucesso', titulo })
  }

  const registrar = useMutation({
    retry: 0,
    mutationFn: ({ agendamentoId, payload }: { agendamentoId: number; payload: PayloadAtendimento }) =>
      registrarAtendimento(agendamentoId, payload),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Atendimento registrado.'),
    onError: aoFalhar,
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: PayloadAtendimento; versao: string }) =>
      atualizarAtendimento(id, payload, versao),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Atendimento salvo.'),
    onError: aoFalhar,
  })

  const excluir = useMutation({
    retry: 0,
    mutationFn: (id: number) => excluirAtendimento(id),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Registro de atendimento desfeito.'),
    onError: aoFalhar,
  })

  return {
    erros,
    limparErros,
    registrar,
    atualizar,
    excluir,
    salvando: registrar.isPending || atualizar.isPending,
    excluindo: excluir.isPending,
  }
}

/**
 * O 409 de ESCREVER a evolução não é versão velha (o POST não leva If-Match): é a sessão travada por
 * outra escrita no mesmo instante (lock wait/deadlock → `ciclo_em_alteracao`). Nada foi salvo, e o
 * texto continua no formulário — o genérico "Recarregue" faria a pessoa perder o que escreveu (gate
 * CR-EVO-R2-03).
 */
export const MENSAGEM_DA_CORRIDA_NA_EVOLUCAO =
  'A sessão estava sendo alterada por outra pessoa neste instante, e nada foi salvo. O texto continua aqui: salve de novo.'

function useMutacaoDeEvolucao() {
  const queryClient = useQueryClient()
  const { erros, limparErros, aoFalhar, notificar } = usarErrosDoServidor(CAMPOS_DA_EVOLUCAO)

  async function invalidarLeituras(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['evolucoes'] })
    await queryClient.invalidateQueries({ queryKey: ['atendimentos'] }) // `evolucao_id` mudou
    await queryClient.invalidateQueries({ queryKey: ['notificacoes'] })
  }

  async function aoConcluir(titulo: string): Promise<void> {
    await invalidarLeituras()
    notificar({ tom: 'sucesso', titulo })
  }

  /** O aviso diz o que aconteceu com a SESSÃO: finalizada, ou por que não (evolucao-finaliza-a-sessao, D5). */
  async function aoRegistrar(sessao: SessaoAoSalvarEvolucao | undefined): Promise<void> {
    await invalidarLeituras()
    if (sessao?.finalizada === true) {
      // o cartão da grade mostra o status novo — UMA invalidação, como na baixa em lote
      await queryClient.invalidateQueries({ queryKey: chaves.agenda() })
      notificar({ tom: 'sucesso', titulo: 'Evolução salva e sessão finalizada.' })
      return
    }
    if (sessao?.motivo != null) {
      notificar({ tom: 'aviso', titulo: 'Evolução salva. A sessão não foi finalizada:', descricao: sessao.motivo })
      return
    }
    notificar({ tom: 'sucesso', titulo: 'Evolução registrada.' })
  }

  const registrar = useMutation({
    retry: 0,
    mutationFn: ({ destino, payload }: { destino: DestinoDaEvolucao; payload: PayloadEvolucao }) =>
      registrarEvolucao(destino, payload),
    onMutate: limparErros,
    onSuccess: (resposta) => aoRegistrar(resposta.sessao),
    onError: (erro: unknown) => {
      aoFalhar(
        erro instanceof ErroDeApi && erro.motivo === 'conflito'
          ? new ErroDeApi('conflito', MENSAGEM_DA_CORRIDA_NA_EVOLUCAO)
          : erro,
      )
    },
  })

  const atualizar = useMutation({
    retry: 0,
    mutationFn: ({ id, payload, versao }: { id: number; payload: PayloadEvolucaoEdicao; versao: string }) =>
      atualizarEvolucao(id, payload, versao),
    onMutate: limparErros,
    onSuccess: () => aoConcluir('Evolução salva.'),
    onError: aoFalhar,
  })

  return {
    erros,
    limparErros,
    registrar,
    atualizar,
    salvando: registrar.isPending || atualizar.isPending,
  }
}

export { useMutacaoDeAtendimento as usarMutacaoDeAtendimento, useMutacaoDeEvolucao as usarMutacaoDeEvolucao }
