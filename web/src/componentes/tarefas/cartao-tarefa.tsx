import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  GripVertical,
  Hand,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Tag,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'

import { Popover } from '@/componentes/ui/popover'
import { cn } from '@/lib/cn'
import { iniciais } from '@/lib/iniciais'
import { dataLegivel } from '@/lib/datas'
import {
  ROTULO_DA_COLUNA,
  ROTULO_DA_PRIORIDADE,
  separarEtiquetas,
  tarefaAtrasada,
} from '@/lib/quadro-de-tarefas'
import type { ColunaDeTarefa, PrioridadeDeTarefa, Tarefa } from '@/tipos'
import { COLUNAS_DE_TAREFA } from '@/tipos'

export interface CartaoTarefaProps {
  tarefa: Tarefa
  /** "Y-m-d" no fuso da clínica — o atraso é derivado no modelo puro */
  hoje: string
  podeEditar: boolean
  podeExcluir: boolean
  /** o cartão está sendo arrastado (esmaecido no lugar de origem) */
  arrastando?: boolean
  aoAbrir: (tarefa: Tarefa) => void
  aoAbrirComentarios: (tarefa: Tarefa) => void
  aoAssumir: (tarefa: Tarefa) => void
  aoMoverParaColuna: (tarefa: Tarefa, coluna: ColunaDeTarefa) => void
  aoMoverNaColuna: (tarefa: Tarefa, direcao: -1 | 1) => void
  aoArquivar: (tarefa: Tarefa) => void
  aoDesarquivar?: (tarefa: Tarefa) => void
  aoExcluir: (tarefa: Tarefa) => void
}

/** Tom DISCRETO por prioridade (§2): texto + fundo suave, nunca só cor — a palavra diz. */
const TOM_DA_PRIORIDADE: Record<PrioridadeDeTarefa, string> = {
  baixa: 'bg-neutro-100 text-texto-suave',
  media: 'bg-neutro-100 text-texto',
  alta: 'bg-alerta-suave text-alerta-texto',
  urgente: 'bg-perigo-suave text-perigo-texto',
}

/**
 * Cartão do mural (kanban-da-equipe, spec tarefas-tela). O cartão INTEIRO
 * arrasta com o mouse (o limiar do quadro separa clique de arrasto); no toque a
 * ALAVANCA é o caminho (o dedo no corpo do cartão rola a página); por TECLADO,
 * o menu "⋯" (WCAG 2.5.7 — arrastar nunca é o único caminho). Sobriedade do §2:
 * chips discretos, nada da gamificação do original.
 */
export function CartaoTarefa({
  tarefa,
  hoje,
  podeEditar,
  podeExcluir,
  arrastando = false,
  aoAbrir,
  aoAbrirComentarios,
  aoAssumir,
  aoMoverParaColuna,
  aoMoverNaColuna,
  aoArquivar,
  aoDesarquivar,
  aoExcluir,
}: CartaoTarefaProps) {
  const [menuAberto, setMenuAberto] = useState(false)
  const atrasada = tarefaAtrasada(tarefa, hoje)
  const etiquetas = separarEtiquetas(tarefa.etiquetas)
  const demandaAberta = tarefa.responsaveis.length === 0 && tarefa.arquivada_em === null
  const arquivada = tarefa.arquivada_em !== null

  const fecharMenu = () => setMenuAberto(false)

  return (
    <article
      data-cartao={tarefa.id}
      aria-label={tarefa.titulo}
      className={cn(
        'rounded-superficie border border-linha bg-superficie p-3 shadow-e1',
        podeEditar && !arquivada && 'cursor-grab active:cursor-grabbing',
        arrastando && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-1.5">
        {podeEditar && !arquivada ? (
          <span
            data-alavanca={tarefa.id}
            aria-hidden="true"
            className="mt-0.5 shrink-0 cursor-grab touch-none rounded-controle p-0.5 text-texto-suave hover:bg-hover-de-linha active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => aoAbrir(tarefa)}
          className="min-w-0 flex-1 rounded-controle text-left text-corpo font-medium text-texto hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
        >
          {tarefa.titulo}
        </button>

        <span
          className={cn(
            'shrink-0 rounded-pilula px-1.5 py-0.5 text-meta font-medium',
            TOM_DA_PRIORIDADE[tarefa.prioridade],
          )}
        >
          {ROTULO_DA_PRIORIDADE[tarefa.prioridade]}
        </span>

        <Popover
          aberto={menuAberto}
          aoMudarAberto={setMenuAberto}
          titulo={`Ações de ${tarefa.titulo}`}
          gatilho={
            <button
              type="button"
              aria-label={`Ações de ${tarefa.titulo}`}
              className="shrink-0 rounded-controle p-1 text-texto-suave hover:bg-hover-de-linha focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </button>
          }
        >
          <ul className="flex min-w-48 flex-col gap-0.5">
            <li>
              <AcaoDoMenu
                icone={<Pencil aria-hidden="true" className="size-3.5" />}
                rotulo={podeEditar ? 'Abrir e editar' : 'Abrir'}
                aoAcionar={() => {
                  fecharMenu()
                  aoAbrir(tarefa)
                }}
              />
            </li>
            {/* mover por TECLADO — a alternativa ao arrasto (WCAG 2.5.7) */}
            {podeEditar && !arquivada ? (
              <>
                {COLUNAS_DE_TAREFA.filter((coluna) => coluna !== tarefa.coluna).map((coluna) => (
                  <li key={coluna}>
                    <AcaoDoMenu
                      rotulo={`Mover para ${ROTULO_DA_COLUNA[coluna]}`}
                      aoAcionar={() => {
                        fecharMenu()
                        aoMoverParaColuna(tarefa, coluna)
                      }}
                    />
                  </li>
                ))}
                <li>
                  <AcaoDoMenu
                    icone={<ArrowUp aria-hidden="true" className="size-3.5" />}
                    rotulo="Subir na coluna"
                    aoAcionar={() => {
                      fecharMenu()
                      aoMoverNaColuna(tarefa, -1)
                    }}
                  />
                </li>
                <li>
                  <AcaoDoMenu
                    icone={<ArrowDown aria-hidden="true" className="size-3.5" />}
                    rotulo="Descer na coluna"
                    aoAcionar={() => {
                      fecharMenu()
                      aoMoverNaColuna(tarefa, 1)
                    }}
                  />
                </li>
              </>
            ) : null}
            {podeEditar && !arquivada && tarefa.coluna === 'concluida' ? (
              <li>
                <AcaoDoMenu
                  icone={<Archive aria-hidden="true" className="size-3.5" />}
                  rotulo="Arquivar"
                  aoAcionar={() => {
                    fecharMenu()
                    aoArquivar(tarefa)
                  }}
                />
              </li>
            ) : null}
            {podeEditar && arquivada && aoDesarquivar !== undefined ? (
              <li>
                <AcaoDoMenu
                  icone={<ArchiveRestore aria-hidden="true" className="size-3.5" />}
                  rotulo="Desarquivar"
                  aoAcionar={() => {
                    fecharMenu()
                    aoDesarquivar(tarefa)
                  }}
                />
              </li>
            ) : null}
            {podeExcluir ? (
              <li>
                <AcaoDoMenu
                  icone={<Trash2 aria-hidden="true" className="size-3.5" />}
                  rotulo="Excluir"
                  tom="perigo"
                  aoAcionar={() => {
                    fecharMenu()
                    aoExcluir(tarefa)
                  }}
                />
              </li>
            ) : null}
          </ul>
        </Popover>
      </div>

      {tarefa.descricao !== null && tarefa.descricao !== '' ? (
        <p className="mt-1.5 line-clamp-2 text-meta text-texto-suave">{tarefa.descricao}</p>
      ) : null}

      {etiquetas.length > 0 ? (
        <ul aria-label="Etiquetas" className="mt-2 flex flex-wrap gap-1">
          {etiquetas.map((etiqueta) => (
            <li
              key={etiqueta}
              className="flex items-center gap-1 rounded-pilula bg-neutro-100 px-1.5 py-0.5 text-meta text-texto-suave"
            >
              <Tag aria-hidden="true" className="size-3" />
              {etiqueta}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {tarefa.prazo !== null ? (
          <span
            className={cn(
              'flex items-center gap-1 text-meta',
              atrasada ? 'font-medium text-perigo-texto' : 'text-texto-suave',
            )}
          >
            {atrasada ? (
              <TriangleAlert aria-hidden="true" className="size-3.5" />
            ) : (
              <CalendarClock aria-hidden="true" className="size-3.5" />
            )}
            {/* atraso não depende só de cor (1.4.1): a PALAVRA diz */}
            {atrasada ? `Atrasada · ${dataLegivel(tarefa.prazo)}` : dataLegivel(tarefa.prazo)}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => aoAbrirComentarios(tarefa)}
          className={cn(
            'flex items-center gap-1 rounded-controle text-meta hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
            tarefa.comentarios_nao_lidos_count > 0 ? 'font-medium text-acento' : 'text-texto-suave',
          )}
        >
          <MessageCircle aria-hidden="true" className="size-3.5" />
          <span aria-hidden="true">
            {tarefa.comentarios_count}
            {tarefa.comentarios_nao_lidos_count > 0 ? ` · ${tarefa.comentarios_nao_lidos_count} novos` : ''}
          </span>
          <span className="sr-only">
            {`${tarefa.comentarios_count} comentários${
              tarefa.comentarios_nao_lidos_count > 0
                ? `, ${tarefa.comentarios_nao_lidos_count} não lidos`
                : ''
            }`}
          </span>
        </button>

        <span className="ml-auto flex items-center">
          {demandaAberta ? (
            <button
              type="button"
              onClick={() => aoAssumir(tarefa)}
              className="flex items-center gap-1 rounded-pilula bg-acento-suave px-2 py-0.5 text-meta font-medium text-acento hover:bg-acento-suave/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
            >
              <Hand aria-hidden="true" className="size-3.5" />
              Assumir
            </button>
          ) : (
            <ul aria-label="Responsáveis" className="flex -space-x-1.5">
              {tarefa.responsaveis.map((responsavel) => (
                <li
                  key={responsavel.id}
                  title={responsavel.nome}
                  className="flex size-6 items-center justify-center rounded-full border border-superficie bg-neutro-200 text-[10px] font-medium text-texto"
                >
                  <span aria-hidden="true">{iniciais(responsavel.nome)}</span>
                  <span className="sr-only">{responsavel.nome}</span>
                </li>
              ))}
            </ul>
          )}
        </span>
      </div>
    </article>
  )
}

function AcaoDoMenu({
  rotulo,
  icone,
  tom,
  aoAcionar,
}: {
  rotulo: string
  icone?: React.ReactNode
  tom?: 'perigo'
  aoAcionar: () => void
}) {
  return (
    <button
      type="button"
      onClick={aoAcionar}
      className={cn(
        'flex w-full items-center gap-2 rounded-controle px-2 py-1.5 text-left text-corpo hover:bg-hover-de-linha focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
        tom === 'perigo' ? 'text-perigo-texto' : 'text-texto',
      )}
    >
      {icone}
      {rotulo}
    </button>
  )
}

