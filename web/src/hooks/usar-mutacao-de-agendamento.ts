import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { usarToast } from '@/componentes/ui/toast'
import { ehConflitoDeEdicao } from '@/lib/conflito'
import { dataLegivel } from '@/lib/datas'
import { chaves } from '@/lib/chaves-query'
import { distribuirErros, type ErrosDoFormulario } from '@/lib/erros-agenda'
import {
  atualizarAgendamento,
  criarAgendamento,
  excluirAgendamento,
} from '@/servicos/agenda'
import { encaixarDaFila } from '@/servicos/lista-espera'
import type { AvisoAFamilia, PayloadAgendamento, PayloadEncaixe, PayloadRemarcacao, SerieCriada } from '@/tipos'

const SEM_ERROS: ErrosDoFormulario = { porCampo: {}, gerais: [] }

/**
 * O padrão de mutação do produto — o primeiro (design D8).
 *
 * Regras que ele carrega, todas do parecer:
 * - **`retry: 0`** (T-aes-01): um POST reexecutado é um agendamento DUPLICADO.
 *   Escrita não é idempotente; repetir por conta própria é criar sessão fantasma
 *   na agenda de uma criança.
 * - O CSRF é garantido dentro do serviço, antes de cada escrita.
 * - Nenhuma escrita falha em silêncio: sucesso vira toast + grade invalidada;
 *   recusa vira mensagem no campo certo ou no aviso geral.
 */
function useMutacaoDeAgendamento() {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const [erros, setErros] = useState<ErrosDoFormulario>(SEM_ERROS)

  function limparErros(): void {
    setErros(SEM_ERROS)
  }

  function aoFalhar(erro: unknown): void {
    const distribuidos = distribuirErros(erro)
    setErros(distribuidos)

    // Fluxos SEM formulário (chip de status, exclusão) não têm campo onde a
    // mensagem possa pousar: ali o toast é o único aviso — e ele nunca pode
    // faltar (SEC-A1). A recusa do chip chega em `status_id`, que É campo: sem
    // este fallback, a recepcionista não sabe que o servidor disse não.
    const mensagem = distribuidos.gerais[0] ?? Object.values(distribuidos.porCampo)[0]
    if (mensagem !== undefined) {
      notificar({ tom: 'erro', titulo: mensagem })
    }
  }

  async function aoConcluir(titulo: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: chaves.agenda() })
    notificar({ tom: 'sucesso', titulo })
  }

  /**
   * O aviso de criança sobreposta (conflito-do-paciente, D4), quando a clínica escolheu
   * `avisar`: a escrita PASSOU, então isto não é erro — não marca campo, não segura o
   * formulário, não impede o fechamento. Vem depois do toast de sucesso porque a ordem
   * conta o que aconteceu: o agendamento existe, e há uma coisa a conferir.
   *
   * Toast, e não mensagem de campo, porque o formulário já fechou quando ele chega.
   */
  function avisarSobreposicaoDoPaciente(
    resposta: { alerta_paciente?: string[] | null },
    ehSerie: boolean,
  ): void {
    const datas = resposta.alerta_paciente
    if (datas === undefined || datas === null || datas.length === 0) {
      return
    }

    /*
     * As DATAS, não a contagem (achado do gate, CR-A1).
     *
     * A primeira versão dizia "em 3 datas da série" — a mesma classe de não-informação que o
     * design D4 rejeitou ao decidir avisar por ocorrência: com o formulário já fechado, a
     * recepção não tem como descobrir QUAIS são. Pior no caso de uma só: uma série pedida para
     * 01/09 com choque apenas em 13/10 dizia "neste horário", e a pessoa ia conferir 01/09,
     * onde não havia nada — o aviso apontava a data errada.
     *
     * O que decide o texto é ser SÉRIE, não a quantidade de datas: série de uma ocorrência em
     * conflito continua sendo série.
     */
    const LIMITE = 4
    const lista = datas.slice(0, LIMITE).map(dataLegivel).join(', ')
    const restantes = datas.length - LIMITE
    const emQue = restantes > 0 ? `${lista} e mais ${String(restantes)}` : lista

    notificar({
      tom: 'aviso',
      titulo: ehSerie
        ? `Atenção: esta criança já tem outro atendimento em ${emQue}.`
        : 'Atenção: esta criança já tem outro atendimento neste horário.',
    })
  }

  /**
   * Se a família foi avisada pelo WhatsApp (change avisos-do-agendamento-por-whatsapp). O servidor
   * só manda `aviso_familia` quando um aviso foi TENTADO — confirmação, remarcação ou cancelamento.
   * Não saiu não é erro da gravação (o agendamento existe): é um aviso para a recepção avisar à mão.
   */
  function contarAvisoAFamilia(resposta: { aviso_familia?: AvisoAFamilia }): void {
    const aviso = resposta.aviso_familia
    if (aviso === undefined) {
      return
    }

    notificar(
      aviso.enviado
        // "enviado" é ENFILEIRADO: a entrega a Meta confirma depois, na conversa (SEC-AV-06)
        ? { tom: 'sucesso', titulo: 'Aviso enviado ao WhatsApp da família.' }
        : { tom: 'aviso', titulo: `A família não foi avisada pelo WhatsApp: ${aviso.motivo ?? 'motivo não informado'}.` },
    )
  }

  const criar = useMutation({
    retry: 0,
    mutationFn: (payload: PayloadAgendamento) => criarAgendamento(payload),
    onMutate: limparErros,
    onError: aoFalhar,
    onSuccess: async (resposta) => {
      const serie = resposta as Partial<SerieCriada>
      const ehSerie = serie.criados !== undefined
      await aoConcluir(ehSerie ? `${serie.criados} agendamentos criados na série.` : 'Agendamento criado.')
      avisarSobreposicaoDoPaciente(resposta, ehSerie)
      contarAvisoAFamilia(resposta)
    },
  })

  const atualizar = useMutation({
    retry: 0,
    // o arrasto-para-remarcar reusa ESTA mutação com o payload parcial (D2):
    // uma superfície de escrita só — nunca duas que possam divergir
    mutationFn: ({ id, payload, versao }: { id: number; payload: PayloadAgendamento | PayloadRemarcacao; versao: string }) =>
      atualizarAgendamento(id, payload, versao),
    onMutate: limparErros,
    onError: (erro) => {
      aoFalhar(erro)
      // conflito (EX-05/B1): invalida a leitura que hidratou a LINHA — reabrir re-hidrata fresco
      if (ehConflitoDeEdicao(erro)) {
        void queryClient.invalidateQueries({ queryKey: chaves.agenda() })
      }
    },
    onSuccess: async (resposta) => {
      await aoConcluir('Agendamento atualizado.')
      avisarSobreposicaoDoPaciente(resposta, false)
      contarAvisoAFamilia(resposta)
    },
  })

  const excluir = useMutation({
    retry: 0,
    mutationFn: ({ id, aplicarNaSerie }: { id: number; aplicarNaSerie: boolean }) =>
      excluirAgendamento(id, aplicarNaSerie),
    onMutate: limparErros,
    onError: aoFalhar,
    onSuccess: () => aoConcluir('Agendamento excluído.'),
  })

  /**
   * Encaixe da fila: escrita de agenda que também move a FILA — as duas listas
   * são invalidadas juntas. A recusa cai no mesmo mapa de campos (o 422 do
   * encaixe tem o formato do agendamento); quando ela vem, o paciente continua
   * na fila — e o painel, revalidado, mostra isso.
   */
  const encaixar = useMutation({
    retry: 0,
    mutationFn: ({ entradaId, payload }: { entradaId: number; payload: PayloadEncaixe }) =>
      encaixarDaFila(entradaId, payload),
    onMutate: limparErros,
    onError: aoFalhar,
    onSuccess: async (resposta) => {
      await queryClient.invalidateQueries({ queryKey: chaves.listaEspera() })
      await aoConcluir('Paciente encaixado.')
      avisarSobreposicaoDoPaciente(resposta, false)
      contarAvisoAFamilia(resposta)
    },
  })

  return {
    criar,
    atualizar,
    excluir,
    encaixar,
    erros,
    limparErros,
    /** Alguma escrita em andamento — trava o submit (dois cliques = uma requisição) */
    gravando: criar.isPending || atualizar.isPending || excluir.isPending || encaixar.isPending,
  }
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração (mesmo
// padrão do `usarToast`)
export { useMutacaoDeAgendamento as usarMutacaoDeAgendamento }
