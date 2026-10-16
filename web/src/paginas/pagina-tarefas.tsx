import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { ModalTarefa } from '@/componentes/tarefas/modal-tarefa'
import { PainelComentarios } from '@/componentes/tarefas/painel-comentarios'
import { QuadroTarefas } from '@/componentes/tarefas/quadro-tarefas'
import { Botao } from '@/componentes/ui/botao'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { Dialog } from '@/componentes/ui/dialog'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { dataLegivel, hojeNaClinica, TIMEZONE_PADRAO } from '@/lib/datas'
import { planejarMovimento, ROTULO_DA_COLUNA } from '@/lib/quadro-de-tarefas'
import {
  arquivarTarefa,
  assumirTarefa,
  atualizarTarefa,
  criarTarefa,
  desarquivarTarefa,
  excluirTarefa,
  lerEventosDaTarefa,
  listarParticipantes,
  listarTarefas,
  reordenarTarefas,
} from '@/servicos/tarefas'
import { useAuthStore } from '@/stores/auth-store'
import type { ColunaDeTarefa, ItemDeOrdem, PayloadTarefa, Tarefa } from '@/tipos'

type FiltroDeResponsavel = 'todos' | 'minhas' | 'sem' | number

interface ModalAberto {
  modo: 'criar' | 'editar'
  tarefa: Tarefa | null
  colunaInicial: ColunaDeTarefa
}

/**
 * O mural de tarefas da equipe (change kanban-da-equipe, spec tarefas-tela):
 * quadro de quatro colunas fixas, arrasto artesanal + movimentação por teclado
 * (menu do cartão, resultado em aria-live), comentários com menções, filtros
 * client-side e deep-link `?tarefa=` — o link que o bloco de notificações usa.
 */
export function PaginaTarefas() {
  const { notificar } = usarToast()
  const queryClient = useQueryClient()
  const [parametros, setParametros] = useSearchParams()
  const usuario = useAuthStore((estado) => estado.usuario)
  const temPermissao = useAuthStore((estado) => estado.temPermissao)

  const podeCriar = temPermissao('tarefas.criar')
  const podeEditar = temPermissao('tarefas.editar')
  const podeExcluir = temPermissao('tarefas.excluir')

  const [filtro, setFiltro] = useState<FiltroDeResponsavel>('todos')
  const [modal, setModal] = useState<ModalAberto | null>(null)
  const [conversaDe, setConversaDe] = useState<Tarefa | null>(null)
  const [excluindo, setExcluindo] = useState<Tarefa | null>(null)
  const [arquivadasAberto, setArquivadasAberto] = useState(false)
  const [anuncio, setAnuncio] = useState('')
  const deepLinkTratado = useRef(false)

  const hoje = hojeNaClinica(TIMEZONE_PADRAO)

  const quadro = useQuery({
    queryKey: chaves.tarefas(),
    queryFn: () => listarTarefas(),
    // quadro COLABORATIVO: voltar à janela recarrega o que os colegas moveram —
    // é a metade da mitigação do last-write-wins prometida no design D4
    // (o default global desliga o refetch no foco; aqui ele é a feature)
    refetchOnWindowFocus: true,
  })
  const participantes = useQuery({
    queryKey: chaves.participantesDoMural(),
    queryFn: listarParticipantes,
  })
  const arquivadas = useQuery({
    queryKey: chaves.tarefas({ arquivadas: true }),
    queryFn: () => listarTarefas(true),
    enabled: arquivadasAberto,
  })

  const invalidarQuadro = () =>
    queryClient.invalidateQueries({ queryKey: chaves.tarefas(), exact: true })

  /** Toda mutação de tarefa mexe também no bloco do centro de notificações. */
  const invalidarTudo = () => {
    void invalidarQuadro()
    void queryClient.invalidateQueries({ queryKey: chaves.tarefas({ arquivadas: true }), exact: true })
    void queryClient.invalidateQueries({ queryKey: chaves.notificacoes() })
  }

  /**
   * Abrir a tarefa É ler as novidades dela (alertas-do-mural D5) — como o GET
   * de comentários carimba a menção. Fire-and-forget deliberado: falhar em
   * marcar lido não pode atrapalhar o gesto de abrir; o evento só fica não
   * lido para a próxima. `useCallback` porque o deep-link a usa em effect.
   */
  const marcarEventosLidos = useCallback(
    (tarefaId: number) => {
      lerEventosDaTarefa(tarefaId)
        .then(() => queryClient.invalidateQueries({ queryKey: chaves.notificacoes() }))
        .catch(() => undefined)
    },
    [queryClient]
  )

  // deep-link do bloco de notificações: ?tarefa=<id> abre o detalhe UMA vez
  useEffect(() => {
    if (deepLinkTratado.current || !quadro.isSuccess) {
      return
    }
    const bruto = parametros.get('tarefa')
    if (bruto === null) {
      deepLinkTratado.current = true
      return
    }
    deepLinkTratado.current = true
    const id = Number(bruto)
    const alvo = Number.isInteger(id) ? quadro.data.find((t) => t.id === id) : undefined
    if (alvo === undefined) {
      // id estranho/arquivado: aviso DISCRETO e o quadro segue utilizável (spec)
      notificar({ tom: 'aviso', titulo: 'Tarefa não encontrada no quadro.' })
    } else {
      setModal({ modo: 'editar', tarefa: alvo, colunaInicial: alvo.coluna })
      marcarEventosLidos(alvo.id)
    }
    parametros.delete('tarefa')
    setParametros(parametros, { replace: true })
  }, [quadro.isSuccess, quadro.data, parametros, setParametros, notificar, marcarEventosLidos])

  const mover = useMutation({
    mutationFn: (plano: { itens: ItemDeOrdem[]; tarefas: Tarefa[] }) =>
      reordenarTarefas(plano.itens),
    // otimista com rollback — o padrão da remarcação da agenda (spec tarefas-tela)
    onMutate: async (plano) => {
      await queryClient.cancelQueries({ queryKey: chaves.tarefas(), exact: true })
      const anterior = queryClient.getQueryData<Tarefa[]>(chaves.tarefas())
      queryClient.setQueryData<Tarefa[]>(chaves.tarefas(), plano.tarefas)
      return { anterior }
    },
    onError: (_erro, _plano, contexto) => {
      if (contexto?.anterior !== undefined) {
        queryClient.setQueryData(chaves.tarefas(), contexto.anterior)
      }
      notificar({ tom: 'erro', titulo: 'Não foi possível mover a tarefa.', descricao: 'O quadro voltou ao estado anterior.' })
      setAnuncio('A movimentação falhou; o cartão voltou ao lugar.')
    },
    onSettled: () => invalidarTudo(),
  })

  function moverTarefa(tarefaId: number, coluna: ColunaDeTarefa, indice?: number) {
    if (!quadro.isSuccess) {
      return
    }
    const plano = planejarMovimento(quadro.data, tarefaId, coluna, indice)
    if (plano === null) {
      return
    }
    const tarefa = quadro.data.find((t) => t.id === tarefaId)
    const posicao = (plano.tarefas.find((t) => t.id === tarefaId)?.posicao ?? 0) + 1
    const total = plano.tarefas.filter((t) => t.coluna === coluna && t.arquivada_em === null).length
    mover.mutate(plano)
    setAnuncio(
      `${tarefa?.titulo ?? 'Tarefa'} movida para ${ROTULO_DA_COLUNA[coluna]}, posição ${posicao} de ${total}.`,
    )
  }

  function aoSoltar(tarefaId: number, coluna: ColunaDeTarefa, antesDeId: number | null) {
    if (!quadro.isSuccess) {
      return
    }
    if (antesDeId === tarefaId) {
      return // soltou sobre si mesmo: não-evento, nenhum request (CR-KB-01)
    }
    // traduz o cartão-alvo para índice do modelo puro no referencial SEM o
    // arrastado — imune ao filtro ativo (o modelo trabalha na lista INTEIRA)
    let indice: number | undefined
    if (antesDeId !== null) {
      const semOArrastado = quadro.data
        .filter((t) => t.coluna === coluna && t.id !== tarefaId && t.arquivada_em === null)
        .sort((a, b) => a.posicao - b.posicao || a.id - b.id)
      const posicaoDoAlvo = semOArrastado.findIndex((t) => t.id === antesDeId)
      indice = posicaoDoAlvo === -1 ? undefined : posicaoDoAlvo
    }
    moverTarefa(tarefaId, coluna, indice)
  }

  function moverNaColuna(tarefa: Tarefa, direcao: -1 | 1) {
    if (!quadro.isSuccess) {
      return
    }
    const daColuna = quadro.data
      .filter((t) => t.coluna === tarefa.coluna && t.arquivada_em === null)
      .sort((a, b) => a.posicao - b.posicao || a.id - b.id)
    const atual = daColuna.findIndex((t) => t.id === tarefa.id)
    const destino = atual + direcao
    if (atual === -1 || destino < 0 || destino >= daColuna.length) {
      setAnuncio(direcao === -1 ? 'A tarefa já está no topo da coluna.' : 'A tarefa já está no fim da coluna.')
      return
    }
    moverTarefa(tarefa.id, tarefa.coluna, destino)
  }

  const salvar = useMutation({
    mutationFn: (payload: PayloadTarefa) =>
      modal?.tarefa == null
        ? criarTarefa(payload)
        : atualizarTarefa(modal.tarefa.id, payload, modal.tarefa.updated_at),
    onSuccess: () => {
      setModal(null)
      invalidarTudo()
    },
    onError: (erro) =>
      notificar({
        tom: 'erro',
        titulo: modal?.tarefa == null ? 'Não foi possível criar a tarefa.' : 'Não foi possível salvar.',
        descricao: erro instanceof Error ? erro.message : undefined,
      }),
  })

  const assumir = useMutation({
    mutationFn: (tarefa: Tarefa) => assumirTarefa(tarefa.id),
    onSuccess: (atualizada) => {
      // reflete no cartão SEM esperar o refetch (spec: sem recarregar)
      queryClient.setQueryData<Tarefa[]>(chaves.tarefas(), (atuais) =>
        atuais?.map((t) => (t.id === atualizada.id ? atualizada : t)),
      )
      invalidarTudo()
    },
    onError: () => {
      notificar({ tom: 'erro', titulo: 'Não foi possível assumir a tarefa.' })
      // corrida real: outro colega assumiu antes (422) — recarregar tira o
      // "Assumir" do cartão na hora, em vez de esperar o próximo foco
      invalidarTudo()
    },
  })

  const arquivar = useMutation({
    mutationFn: (tarefa: Tarefa) => arquivarTarefa(tarefa.id),
    onSuccess: () => invalidarTudo(),
    onError: () => notificar({ tom: 'erro', titulo: 'Só tarefa concluída pode ser arquivada.' }),
  })

  const desarquivar = useMutation({
    mutationFn: (tarefa: Tarefa) => desarquivarTarefa(tarefa.id),
    onSuccess: () => invalidarTudo(),
    onError: () => notificar({ tom: 'erro', titulo: 'Não foi possível desarquivar.' }),
  })

  const excluir = useMutation({
    mutationFn: (tarefa: Tarefa) => excluirTarefa(tarefa.id),
    onSuccess: () => {
      setExcluindo(null)
      invalidarTudo()
    },
    onError: () => notificar({ tom: 'erro', titulo: 'Não foi possível excluir a tarefa.' }),
  })

  const listaFiltrada = (quadro.data ?? []).filter((tarefa) => {
    if (filtro === 'todos') {
      return true
    }
    if (filtro === 'sem') {
      return tarefa.responsaveis.length === 0
    }
    const alvoId = filtro === 'minhas' ? usuario?.id : filtro
    return tarefa.responsaveis.some((r) => r.id === alvoId)
  })

  const opcoesDeFiltro = [
    { valor: 'todos', rotulo: 'Toda a equipe' },
    { valor: 'minhas', rotulo: 'Minhas tarefas' },
    { valor: 'sem', rotulo: 'Sem responsável' },
    ...(participantes.data ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome })),
  ]

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-titulo font-semibold text-texto">Tarefas da equipe</h1>
          <p className="mt-1 text-corpo text-texto-suave">
            O mural interno da clínica — quem faz o quê, até quando.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <CampoSelect
            rotulo="Responsável"
            value={typeof filtro === 'number' ? String(filtro) : filtro}
            onChange={(evento) => {
              const valor = evento.target.value
              setFiltro(
                valor === 'todos' || valor === 'minhas' || valor === 'sem' ? valor : Number(valor),
              )
            }}
            opcoes={opcoesDeFiltro}
            className="w-52"
          />
          <Botao type="button" variante="secundario" onClick={() => setArquivadasAberto(true)}>
            <Archive aria-hidden="true" className="size-4" />
            Arquivadas
          </Botao>
          {podeCriar ? (
            <Botao
              type="button"
              onClick={() => setModal({ modo: 'criar', tarefa: null, colunaInicial: 'a_fazer' })}
            >
              <Plus aria-hidden="true" className="size-4" />
              Nova tarefa
            </Botao>
          ) : null}
        </div>
      </header>

      {/* o resultado da movimentação, para leitores de tela (WCAG 2.5.7 / 4.1.3) */}
      <p aria-live="polite" className="sr-only">
        {anuncio}
      </p>

      {quadro.isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {quadro.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar o mural de tarefas."
          aoTentarNovamente={() => void quadro.refetch()}
        />
      ) : null}

      {quadro.isSuccess ? (
        <QuadroTarefas
          tarefas={listaFiltrada}
          hoje={hoje}
          podeCriar={podeCriar}
          podeEditar={podeEditar}
          podeExcluir={podeExcluir}
          aoCriarNaColuna={(coluna) => setModal({ modo: 'criar', tarefa: null, colunaInicial: coluna })}
          aoSoltar={aoSoltar}
          aoAbrir={(tarefa) => {
            setModal({ modo: 'editar', tarefa, colunaInicial: tarefa.coluna })
            marcarEventosLidos(tarefa.id)
          }}
          aoAbrirComentarios={(tarefa) => {
            setConversaDe(tarefa)
            marcarEventosLidos(tarefa.id)
          }}
          aoAssumir={(tarefa) => assumir.mutate(tarefa)}
          aoMoverParaColuna={(tarefa, coluna) => moverTarefa(tarefa.id, coluna)}
          aoMoverNaColuna={moverNaColuna}
          aoArquivar={(tarefa) => arquivar.mutate(tarefa)}
          aoExcluir={setExcluindo}
        />
      ) : null}

      {modal !== null ? (
        <ModalTarefa
          key={modal.tarefa?.id ?? 'nova'}
          aberto
          aoMudarAberto={(aberto) => {
            if (!aberto) {
              setModal(null)
            }
          }}
          tarefa={modal.tarefa}
          colunaInicial={modal.colunaInicial}
          participantes={participantes.data ?? []}
          podeEditar={modal.tarefa === null ? podeCriar : podeEditar}
          salvando={salvar.isPending}
          aoSalvar={(payload) => salvar.mutate(payload)}
        />
      ) : null}

      {conversaDe !== null && usuario !== null ? (
        <PainelComentarios
          aberto
          aoMudarAberto={(aberto) => {
            if (!aberto) {
              setConversaDe(null)
              // ler carimbou lido_em no servidor — os contadores do quadro e do
              // centro refletem agora, sem esperar o próximo foco
              invalidarTudo()
            }
          }}
          tarefa={conversaDe}
          participantes={participantes.data ?? []}
          usuarioId={usuario.id}
          podeModerar={podeExcluir}
        />
      ) : null}

      <DialogConfirmacao
        aberto={excluindo !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) {
            setExcluindo(null)
          }
        }}
        titulo="Excluir tarefa?"
        consequencia={`"${excluindo?.titulo ?? ''}" e os comentários dela somem do mural. A exclusão fica na trilha de auditoria.`}
        rotuloConfirmar="Excluir"
        tom="perigo"
        carregando={excluir.isPending}
        aoConfirmar={() => {
          if (excluindo !== null) {
            excluir.mutate(excluindo)
          }
        }}
      />

      <Dialog
        aberto={arquivadasAberto}
        aoMudarAberto={setArquivadasAberto}
        titulo="Tarefas arquivadas"
        descricao="Concluídas que saíram do quadro. Desarquivar devolve a tarefa à coluna Concluída."
        className="max-w-2xl"
      >
        {arquivadas.isPending && arquivadasAberto ? <Skeleton className="h-32 w-full" /> : null}
        {arquivadas.isError ? (
          <EstadoErro
            mensagem="Não foi possível carregar as arquivadas."
            aoTentarNovamente={() => void arquivadas.refetch()}
          />
        ) : null}
        {arquivadas.isSuccess && arquivadas.data.length === 0 ? (
          <p className="text-corpo text-texto-suave">Nenhuma tarefa arquivada.</p>
        ) : null}
        {arquivadas.isSuccess && arquivadas.data.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {arquivadas.data.map((tarefa) => (
              <li
                key={tarefa.id}
                className="flex flex-wrap items-center gap-2 rounded-controle border border-linha px-3 py-2"
              >
                <span className="min-w-0 flex-1 text-corpo text-texto">{tarefa.titulo}</span>
                <span className="text-meta text-texto-suave">
                  arquivada em {dataLegivel(tarefa.arquivada_em?.slice(0, 10) ?? null)}
                </span>
                {podeEditar ? (
                  <Botao
                    type="button"
                    variante="secundario"
                    tamanho="sm"
                    carregando={desarquivar.isPending}
                    onClick={() => desarquivar.mutate(tarefa)}
                  >
                    Desarquivar
                  </Botao>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Dialog>
    </div>
  )
}
