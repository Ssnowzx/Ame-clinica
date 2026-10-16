import { useId, useRef, useState } from 'react'

import { cn } from '@/lib/cn'
import {
  detectarGatilho,
  filtrarParticipantes,
  inserirMencao,
  mencoesAindaNoTexto,
  type GatilhoDeMencao,
} from '@/lib/mencoes-de-tarefa'
import type { ParticipanteDoMural } from '@/tipos'

export interface ValorComMencoes {
  texto: string
  /** menções escolhidas E ainda presentes no texto — o payload manda os ids */
  escolhidos: ParticipanteDoMural[]
}

export interface CampoMencaoProps {
  rotulo: string
  valor: ValorComMencoes
  participantes: readonly ParticipanteDoMural[]
  aoMudar: (valor: ValorComMencoes) => void
  /** Enter (sem Shift) envia — Shift+Enter quebra linha (spec tarefas-tela) */
  aoSubmeter?: () => void
  placeholder?: string
  desabilitado?: boolean
  linhas?: number
}

/**
 * Composer com menções @ (kanban-da-equipe, design D7): o modelo puro
 * (`mencoes-de-tarefa`) decide gatilho/filtro/inserção; aqui vive só o DOM —
 * textarea controlada + listbox navegável por teclado (setas/Enter/Escape),
 * `aria-activedescendant` e opções com `role="option"`.
 */
export function CampoMencao({
  rotulo,
  valor,
  participantes,
  aoMudar,
  aoSubmeter,
  placeholder,
  desabilitado = false,
  linhas = 2,
}: CampoMencaoProps) {
  const id = useId()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [gatilho, setGatilho] = useState<GatilhoDeMencao | null>(null)
  const [ativo, setAtivo] = useState(0)

  const opcoes = gatilho === null ? [] : filtrarParticipantes(participantes, gatilho.consulta)
  const aberto = gatilho !== null && opcoes.length > 0

  function sincronizar(texto: string, cursor: number) {
    setGatilho(detectarGatilho(texto, cursor))
    setAtivo(0)
  }

  function mudarTexto(texto: string, cursor: number) {
    aoMudar({ texto, escolhidos: mencoesAindaNoTexto(texto, valor.escolhidos) })
    sincronizar(texto, cursor)
  }

  function escolher(participante: ParticipanteDoMural) {
    if (gatilho === null) {
      return
    }
    const cursor = areaRef.current?.selectionStart ?? valor.texto.length
    const resultado = inserirMencao(valor.texto, gatilho, cursor, participante.nome)
    const escolhidos = mencoesAindaNoTexto(
      resultado.texto,
      [...valor.escolhidos.filter((e) => e.id !== participante.id), participante],
    )
    aoMudar({ texto: resultado.texto, escolhidos })
    setGatilho(null)
    requestAnimationFrame(() => {
      areaRef.current?.focus()
      areaRef.current?.setSelectionRange(resultado.cursor, resultado.cursor)
    })
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (aberto) {
      if (evento.key === 'ArrowDown') {
        evento.preventDefault()
        setAtivo((atual) => (atual + 1) % opcoes.length)
        return
      }
      if (evento.key === 'ArrowUp') {
        evento.preventDefault()
        setAtivo((atual) => (atual - 1 + opcoes.length) % opcoes.length)
        return
      }
      if (evento.key === 'Enter' || evento.key === 'Tab') {
        evento.preventDefault()
        escolher(opcoes[ativo] ?? opcoes[0])
        return
      }
      if (evento.key === 'Escape') {
        evento.preventDefault()
        setGatilho(null)
        return
      }
    }

    if (evento.key === 'Enter' && !evento.shiftKey && aoSubmeter !== undefined) {
      evento.preventDefault()
      aoSubmeter()
    }
  }

  return (
    <div className="relative">
      <label htmlFor={`${id}-area`} className="mb-1 block text-meta font-medium text-texto">
        {rotulo}
      </label>
      <textarea
        ref={areaRef}
        id={`${id}-area`}
        value={valor.texto}
        placeholder={placeholder}
        disabled={desabilitado}
        rows={linhas}
        role="combobox"
        aria-expanded={aberto}
        aria-controls={`${id}-opcoes`}
        aria-activedescendant={aberto ? `${id}-opcao-${ativo}` : undefined}
        aria-describedby={`${id}-dica`}
        onChange={(evento) => mudarTexto(evento.target.value, evento.target.selectionStart)}
        onKeyDown={aoTeclar}
        onClick={(evento) =>
          sincronizar(evento.currentTarget.value, evento.currentTarget.selectionStart)
        }
        onBlur={() => setGatilho(null)}
        className="w-full resize-y rounded-campo border border-linha bg-superficie px-3 py-2 text-corpo text-texto placeholder:text-texto-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco disabled:opacity-60"
      />
      <p id={`${id}-dica`} className="mt-0.5 text-meta text-texto-suave">
        @ menciona um colega · Enter envia · Shift+Enter quebra linha
      </p>

      {aberto ? (
        <ul
          id={`${id}-opcoes`}
          role="listbox"
          aria-label="Colegas para mencionar"
          className="absolute left-0 top-full z-(--z-menu) mt-1 max-h-56 w-64 overflow-y-auto rounded-campo border border-linha-forte bg-superficie-elevada p-1 shadow-e2"
        >
          {opcoes.map((participante, indice) => (
            <li key={participante.id} role="presentation">
              <button
                type="button"
                id={`${id}-opcao-${indice}`}
                role="option"
                aria-selected={indice === ativo}
                // onMouseDown com preventDefault: escolher SEM tirar o foco da textarea
                onMouseDown={(evento) => {
                  evento.preventDefault()
                  escolher(participante)
                }}
                className={cn(
                  'w-full rounded-controle px-2 py-1.5 text-left text-corpo text-texto',
                  // `aria-selected` é SELEÇÃO (o mesmo papel das demais listas): com o acento suave, no tema
                  // ela ficava idêntica ao hover do mouse (gate r4)
                  indice === ativo ? 'bg-selecao' : 'hover:bg-hover-de-linha',
                )}
              >
                {participante.nome}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
