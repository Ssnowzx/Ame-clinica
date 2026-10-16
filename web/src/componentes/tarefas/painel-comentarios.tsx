import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare, Pencil, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { CampoMencao, type ValorComMencoes } from '@/componentes/tarefas/campo-mencao'
import { Botao } from '@/componentes/ui/botao'
import { Dialog } from '@/componentes/ui/dialog'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { dataHoraLegivel } from '@/lib/datas'
import { destacarMencoes } from '@/lib/mencoes-de-tarefa'
import {
  comentarTarefa,
  editarComentario,
  excluirComentario,
  listarComentarios,
} from '@/servicos/tarefas'
import type { ComentarioDeTarefa, ParticipanteDoMural, Tarefa } from '@/tipos'

const VAZIO: ValorComMencoes = { texto: '', escolhidos: [] }

export interface PainelComentariosProps {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  tarefa: Tarefa
  participantes: readonly ParticipanteDoMural[]
  /** id do usuário autenticado — decide as ações do dono */
  usuarioId: number
  /** `tarefas.excluir` modera: exclui comentário de terceiro (nunca edita) */
  podeModerar: boolean
}

/**
 * A conversa de uma tarefa (spec tarefas-tela). Abrir CARIMBA a leitura no
 * servidor (GET marca lido_em — design D7); quem zera os não lidos do quadro é
 * a página, invalidando o namespace ao fechar. Editar é SÓ do autor; excluir é
 * do autor ou da moderação.
 */
export function PainelComentarios({
  aberto,
  aoMudarAberto,
  tarefa,
  participantes,
  usuarioId,
  podeModerar,
}: PainelComentariosProps) {
  const { notificar } = usarToast()
  const queryClient = useQueryClient()
  const [composer, setComposer] = useState<ValorComMencoes>(VAZIO)
  const [editando, setEditando] = useState<ComentarioDeTarefa | null>(null)
  const [edicao, setEdicao] = useState<ValorComMencoes>(VAZIO)

  const conversa = useQuery({
    queryKey: chaves.comentariosDaTarefa(tarefa.id),
    queryFn: () => listarComentarios(tarefa.id),
    enabled: aberto,
  })

  const invalidarConversa = () =>
    queryClient.invalidateQueries({ queryKey: chaves.comentariosDaTarefa(tarefa.id) })

  const enviar = useMutation({
    mutationFn: () =>
      comentarTarefa(
        tarefa.id,
        composer.texto.trim(),
        composer.escolhidos.map((e) => e.id),
      ),
    onSuccess: () => {
      setComposer(VAZIO)
      void invalidarConversa()
    },
    onError: () => notificar({ tom: 'erro', titulo: 'Não foi possível comentar.' }),
  })

  const salvarEdicao = useMutation({
    mutationFn: (comentario: ComentarioDeTarefa) =>
      editarComentario(
        comentario.id,
        edicao.texto.trim(),
        edicao.escolhidos.map((e) => e.id),
        comentario.updated_at,
      ),
    onSuccess: () => {
      setEditando(null)
      void invalidarConversa()
    },
    onError: () => notificar({ tom: 'erro', titulo: 'Não foi possível salvar a edição.' }),
  })

  const excluir = useMutation({
    mutationFn: (comentario: ComentarioDeTarefa) => excluirComentario(comentario.id),
    onSuccess: () => void invalidarConversa(),
    onError: () => notificar({ tom: 'erro', titulo: 'Não foi possível excluir o comentário.' }),
  })

  function comecarEdicao(comentario: ComentarioDeTarefa) {
    setEditando(comentario)
    setEdicao({ texto: comentario.corpo, escolhidos: comentario.mencionados })
  }

  function submeterComposer() {
    if (composer.texto.trim() === '' || enviar.isPending) {
      return
    }
    enviar.mutate()
  }

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={aoMudarAberto}
      titulo={`Comentários — ${tarefa.titulo}`}
      className="max-w-2xl"
    >
      <div className="flex max-h-[60dvh] flex-col gap-3 overflow-y-auto pr-1">
        {conversa.isPending ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        ) : null}

        {conversa.isError ? (
          <EstadoErro
            mensagem="Não foi possível carregar os comentários."
            aoTentarNovamente={() => void conversa.refetch()}
          />
        ) : null}

        {conversa.isSuccess && conversa.data.length === 0 ? (
          <p className="flex items-center gap-2 rounded-controle bg-neutro-100 px-3 py-4 text-corpo text-texto-suave">
            <MessageSquare aria-hidden="true" className="size-4 shrink-0" />
            Nenhum comentário ainda — comece a conversa.
          </p>
        ) : null}

        {conversa.isSuccess ? (
          <ul className="flex flex-col gap-3">
            {conversa.data.map((comentario) => {
              const ehAutor = comentario.autor?.id === usuarioId
              const emEdicao = editando?.id === comentario.id
              return (
                <li key={comentario.id} className="rounded-controle border border-linha p-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-corpo font-medium text-texto">
                      {comentario.autor?.nome ?? 'Usuário removido'}
                    </span>
                    <span className="text-meta text-texto-suave">
                      {dataHoraLegivel(comentario.created_at)}
                    </span>
                    <span className="ml-auto flex gap-1">
                      {ehAutor ? (
                        <button
                          type="button"
                          aria-label="Editar comentário"
                          onClick={() => (emEdicao ? setEditando(null) : comecarEdicao(comentario))}
                          className="rounded-controle p-1 text-texto-suave hover:bg-hover-de-linha focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                        >
                          <Pencil aria-hidden="true" className="size-3.5" />
                        </button>
                      ) : null}
                      {ehAutor || podeModerar ? (
                        <button
                          type="button"
                          aria-label="Excluir comentário"
                          onClick={() => excluir.mutate(comentario)}
                          className="rounded-controle p-1 text-perigo-texto hover:bg-perigo-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                        </button>
                      ) : null}
                    </span>
                  </div>

                  {emEdicao ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <CampoMencao
                        rotulo="Editar comentário"
                        valor={edicao}
                        participantes={participantes}
                        aoMudar={setEdicao}
                        aoSubmeter={() => salvarEdicao.mutate(comentario)}
                      />
                      <div className="flex justify-end gap-2">
                        <Botao
                          type="button"
                          variante="secundario"
                          tamanho="sm"
                          onClick={() => setEditando(null)}
                        >
                          Cancelar
                        </Botao>
                        <Botao
                          type="button"
                          tamanho="sm"
                          carregando={salvarEdicao.isPending}
                          onClick={() => salvarEdicao.mutate(comentario)}
                        >
                          Salvar
                        </Botao>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap text-corpo text-texto">
                      {destacarMencoes(comentario.corpo, comentario.mencionados).map(
                        (segmento, indice) =>
                          segmento.tipo === 'mencao' ? (
                            <mark
                              // menção destacada sem depender só de cor: <mark> tem semântica
                              key={`${segmento.usuarioId}-${indice}`}
                              className="rounded-pilula bg-acento-suave px-1 font-medium text-acento"
                            >
                              {segmento.valor}
                            </mark>
                          ) : (
                            <span key={indice}>{segmento.valor}</span>
                          ),
                      )}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>

      <form
        className={cn('mt-4 flex flex-col gap-2', editando !== null && 'opacity-60')}
        onSubmit={(evento) => {
          evento.preventDefault()
          submeterComposer()
        }}
      >
        <CampoMencao
          rotulo="Novo comentário"
          valor={composer}
          participantes={participantes}
          aoMudar={setComposer}
          aoSubmeter={submeterComposer}
          placeholder="Escreva para a equipe…"
          desabilitado={editando !== null}
        />
        {/* microcopy PERMANENTE de minimização também aqui (LGPD — a mitigação
            registrada em GATILHOS é "modal E composer"; o comentário é o texto
            livre mais corrido do mural) */}
        <p className="text-meta text-texto-suave">
          Sem dado clínico nem pessoal de paciente aqui — o prontuário é o lugar certo.
        </p>
        <div className="flex justify-end">
          <Botao
            type="submit"
            tamanho="sm"
            carregando={enviar.isPending}
            disabled={composer.texto.trim() === '' || editando !== null}
          >
            <Send aria-hidden="true" className="size-3.5" />
            Comentar
          </Botao>
        </div>
      </form>
    </Dialog>
  )
}
