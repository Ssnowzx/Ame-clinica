import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { CartaoTarefa, type CartaoTarefaProps } from '@/componentes/tarefas/cartao-tarefa'
import { cn } from '@/lib/cn'
import { agruparPorColuna, DICA_DA_COLUNA, ROTULO_DA_COLUNA } from '@/lib/quadro-de-tarefas'
import type { ColunaDeTarefa, Tarefa } from '@/tipos'
import { COLUNAS_DE_TAREFA } from '@/tipos'

/** Distância mínima (px) antes de virar arrasto — clique continua clique. */
const LIMIAR_DE_ARRASTO = 6

interface EstadoDeArrasto {
  tarefaId: number
  titulo: string
  x: number
  y: number
  ativo: boolean
  sobreColuna: ColunaDeTarefa | null
  /** id do cartão SOB o ponteiro — inserir antes dele; null = fim da coluna */
  antesDeId: number | null
}

export interface QuadroTarefasProps
  extends Pick<
    CartaoTarefaProps,
    | 'hoje'
    | 'podeEditar'
    | 'podeExcluir'
    | 'aoAbrir'
    | 'aoAbrirComentarios'
    | 'aoAssumir'
    | 'aoMoverParaColuna'
    | 'aoMoverNaColuna'
    | 'aoArquivar'
    | 'aoExcluir'
  > {
  tarefas: Tarefa[]
  podeCriar: boolean
  aoCriarNaColuna: (coluna: ColunaDeTarefa) => void
  /** solta do ARRASTO — o teclado entra por aoMoverParaColuna/aoMoverNaColuna.
   * `antesDeId` é o cartão sob o ponteiro (inserir antes); null = fim da coluna. */
  aoSoltar: (tarefaId: number, coluna: ColunaDeTarefa, antesDeId: number | null) => void
}

/**
 * O quadro de quatro colunas (kanban-da-equipe, spec tarefas-tela). O arrasto é
 * artesanal com Pointer Events — o padrão da agenda, sem lib nova (design D6):
 * a alavanca do cartão inicia, `elementFromPoint` decide o alvo por
 * `data-coluna`/`data-cartao`, e o modelo puro (`planejarMovimento`, na página)
 * faz a matemática. Teclado move pelo menu do cartão — arrastar NUNCA é o único
 * caminho (WCAG 2.5.7).
 */
export function QuadroTarefas({
  tarefas,
  hoje,
  podeCriar,
  podeEditar,
  podeExcluir,
  aoCriarNaColuna,
  aoSoltar,
  ...acoesDoCartao
}: QuadroTarefasProps) {
  const [arrasto, setArrasto] = useState<EstadoDeArrasto | null>(null)
  // desfazer os listeners do gesto corrente — também no unmount no meio do arrasto
  const limparGesto = useRef<(() => void) | null>(null)
  // um arrasto REAL acabou de soltar: engole o click fantasma do mesmo gesto
  // (senão soltar o cartão sobre o próprio título abriria o modal)
  const suprimirClique = useRef(false)
  const grupos = agruparPorColuna(tarefas)

  useEffect(() => () => limparGesto.current?.(), [])

  /**
   * O gesto inteiro vive numa closure iniciada no pointerdown: o alvo corrente
   * fica em variável local (nunca lido de setState — side effect em updater
   * dobraria a mutação no StrictMode) e o estado React só pinta o fantasma.
   *
   * O CARTÃO INTEIRO arrasta com o mouse (pedido do usuário 2026-07-26): o
   * limiar de 6px separa clique de arrasto, então título/menu continuam
   * clicáveis. No TOQUE só a alavanca arrasta (`touch-none` vive nela) — o dedo
   * no corpo do cartão precisa continuar rolando a página.
   */
  function aoApertarPonteiro(evento: React.PointerEvent<HTMLDivElement>) {
    if (!podeEditar || evento.button !== 0 || limparGesto.current !== null) {
      return
    }
    const origem = evento.target as HTMLElement
    const cartaoEl = origem.closest('[data-cartao]')
    if (cartaoEl === null) {
      return
    }
    if (origem.closest('[data-alavanca]') === null && evento.pointerType !== 'mouse') {
      return // toque fora da alavanca: deixa a página rolar
    }
    const tarefaId = Number(cartaoEl.getAttribute('data-cartao'))
    const tarefa = tarefas.find((t) => t.id === tarefaId)
    if (tarefa === undefined || tarefa.arquivada_em !== null) {
      return
    }
    evento.preventDefault()

    const inicio = { x: evento.clientX, y: evento.clientY }
    let ativo = false
    let alvo: { sobreColuna: ColunaDeTarefa | null; antesDeId: number | null } = {
      sobreColuna: null,
      antesDeId: null,
    }

    const aoMover = (movimento: PointerEvent) => {
      if (!ativo) {
        if (Math.hypot(movimento.clientX - inicio.x, movimento.clientY - inicio.y) < LIMIAR_DE_ARRASTO) {
          return
        }
        ativo = true
      }
      alvo = alvoSobOPonteiro(movimento.clientX, movimento.clientY)
      setArrasto({
        tarefaId,
        titulo: tarefa.titulo,
        x: movimento.clientX,
        y: movimento.clientY,
        ativo: true,
        ...alvo,
      })
    }

    const limpar = () => {
      window.removeEventListener('pointermove', aoMover)
      window.removeEventListener('pointerup', aoSoltarPonteiro)
      window.removeEventListener('pointercancel', aoCancelar)
      limparGesto.current = null
      setArrasto(null)
    }

    const aoSoltarPonteiro = () => {
      const soltarEm = ativo ? alvo : null
      if (ativo) {
        // o clique-fantasma do MESMO gesto dispara síncrono logo após o
        // pointerup — a flag expira no próximo tick, senão um arrasto solto
        // FORA do elemento de origem (sem click) deixaria a supressão armada
        // engolindo o próximo clique legítimo
        suprimirClique.current = true
        setTimeout(() => {
          suprimirClique.current = false
        }, 0)
      }
      limpar()
      if (soltarEm !== null && soltarEm.sobreColuna !== null) {
        aoSoltar(tarefaId, soltarEm.sobreColuna, soltarEm.antesDeId)
      }
    }

    const aoCancelar = () => limpar()

    window.addEventListener('pointermove', aoMover)
    window.addEventListener('pointerup', aoSoltarPonteiro)
    window.addEventListener('pointercancel', aoCancelar)
    limparGesto.current = limpar
  }

  return (
    <div
      onPointerDown={aoApertarPonteiro}
      onClickCapture={(evento) => {
        if (suprimirClique.current) {
          suprimirClique.current = false
          evento.preventDefault()
          evento.stopPropagation()
        }
      }}
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
    >
      {COLUNAS_DE_TAREFA.map((coluna) => {
        const cartoes = grupos[coluna]
        const alvo = arrasto?.ativo === true && arrasto.sobreColuna === coluna
        return (
          <section
            key={coluna}
            data-coluna={coluna}
            aria-label={`${ROTULO_DA_COLUNA[coluna]} (${cartoes.length})`}
            className={cn(
              'flex min-h-64 flex-col gap-2 rounded-superficie border border-linha bg-fundo p-2.5',
              alvo && 'border-acento bg-acento-suave/40',
            )}
          >
            <header className="flex items-center gap-2 px-1">
              <h2 className="text-corpo font-semibold text-texto">{ROTULO_DA_COLUNA[coluna]}</h2>
              <span
                aria-hidden="true"
                className="rounded-pilula bg-neutro-100 px-1.5 text-meta tabular-nums text-texto-suave"
              >
                {cartoes.length}
              </span>
              {podeCriar ? (
                <button
                  type="button"
                  aria-label={`Nova tarefa em ${ROTULO_DA_COLUNA[coluna]}`}
                  onClick={() => aoCriarNaColuna(coluna)}
                  className="ml-auto rounded-controle p-1 text-texto-suave hover:bg-hover-de-linha focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                >
                  <Plus aria-hidden="true" className="size-4" />
                </button>
              ) : null}
            </header>
            <p className="px-1 text-meta text-texto-suave">{DICA_DA_COLUNA[coluna]}</p>

            {cartoes.length === 0 ? (
              <p className="rounded-controle border border-dashed border-linha px-3 py-6 text-center text-meta text-texto-suave">
                {podeEditar ? 'Nada aqui — crie ou arraste uma tarefa para cá.' : 'Nada aqui.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {cartoes.map((tarefa) => (
                  <li key={tarefa.id}>
                    <CartaoTarefa
                      tarefa={tarefa}
                      hoje={hoje}
                      podeEditar={podeEditar}
                      podeExcluir={podeExcluir}
                      arrastando={arrasto?.ativo === true && arrasto.tarefaId === tarefa.id}
                      {...acoesDoCartao}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {/* o fantasma do arrasto — decorativo (a AT acompanha pelo aria-live da página) */}
      {arrasto?.ativo === true ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-(--z-toast) max-w-56 -translate-x-1/2 -translate-y-1/2 rounded-controle border border-acento bg-superficie-elevada px-3 py-2 text-corpo font-medium text-texto shadow-e3"
          style={{ left: arrasto.x, top: arrasto.y }}
        >
          {arrasto.titulo}
        </div>
      ) : null}
    </div>
  )
}

/** O alvo sob o ponteiro, lido do DOM por data-attribute (entrada não confiável → null). */
function alvoSobOPonteiro(
  x: number,
  y: number,
): { sobreColuna: ColunaDeTarefa | null; antesDeId: number | null } {
  const elemento = document.elementFromPoint?.(x, y) ?? null
  if (elemento === null) {
    return { sobreColuna: null, antesDeId: null }
  }

  const coluna = elemento.closest('[data-coluna]')?.getAttribute('data-coluna') ?? null
  if (coluna === null || !ehColuna(coluna)) {
    return { sobreColuna: null, antesDeId: null }
  }

  // sobre um cartão → inserir ANTES dele; a página traduz o id para índice no
  // modelo puro — imune ao filtro ativo da tela. O PRÓPRIO cartão arrastado
  // também é devolvido (CR-KB-01): soltar sobre si mesmo é NÃO-EVENTO na página
  // — excluí-lo aqui viraria "fim da coluna" e um arrasto abortado reordenaria
  // o quadro do time inteiro em silêncio.
  const idSob = Number(elemento.closest('[data-cartao]')?.getAttribute('data-cartao'))
  if (Number.isInteger(idSob) && idSob > 0) {
    return { sobreColuna: coluna, antesDeId: idSob }
  }

  return { sobreColuna: coluna, antesDeId: null }
}

function ehColuna(valor: string): valor is ColunaDeTarefa {
  return (COLUNAS_DE_TAREFA as readonly string[]).includes(valor)
}
