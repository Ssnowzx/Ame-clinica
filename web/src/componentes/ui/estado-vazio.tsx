import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface EstadoVazioProps {
  titulo: string
  descricao?: string
  /** SEMPRE que existir próximo passo — Botao primario */
  acao?: ReactNode
  /** lucide 32px text-texto-suave */
  icone?: ReactNode
  /** Nível do título: 3 (padrão, dentro de uma seção com h2) ou 2 (logo abaixo do h1 da página). */
  nivel?: 2 | 3
  /**
   * Id do TEXTO do vazio (título + descrição, sem a ação), focável por programa: quando o vazio é um
   * aviso de pré-requisito no lugar do formulário, o diálogo o põe na descrição acessível e leva o foco a
   * ele — o leitor de tela ouve o motivo, e não "Cadastrar conta, link" sozinho (A11Y-AVI-R2-01/02).
   */
  idDoTexto?: string
  className?: string
}

/**
 * Estado vazio dos 4 estados async (design-system.md §5.9) — primeira
 * impressão com investimento de sucesso: sempre que houver próximo passo,
 * passe `acao`.
 */
export function EstadoVazio({ titulo, descricao, acao, icone, nivel = 3, idDoTexto, className }: EstadoVazioProps) {
  const Titulo = nivel === 2 ? 'h2' : 'h3'
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-superficie border border-dashed border-linha-forte p-10 text-center',
        className,
      )}
    >
      {icone !== undefined ? (
        // a bolha só aparece se o tema der fundo e respiro (change tema-da-clinica); no Padrão, nada
        <div aria-hidden="true" className="mb-3 rounded-pilula bg-vazio-icone-fundo p-vazio-icone text-vazio-icone">
          {icone}
        </div>
      ) : null}
      <div id={idDoTexto} tabIndex={idDoTexto === undefined ? undefined : -1} className="outline-none">
        <Titulo className="text-subtitulo font-semibold text-texto">{titulo}</Titulo>
        {descricao !== undefined ? <p className="mt-1 text-corpo text-texto-suave">{descricao}</p> : null}
      </div>
      {acao !== undefined ? <div className="mt-4">{acao}</div> : null}
    </div>
  )
}
