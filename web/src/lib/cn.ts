import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Os 7 papéis tipográficos do DS (§3 do contrato, `--text-*` no index.css).
 *
 * Sem esta lista, o tailwind-merge não tem como saber que `text-corpo` é
 * TAMANHO e `text-sobre-acento` é COR — classifica os dois como cor, e o último
 * vence. O estrago era silencioso e já estava em produção: o `Botao` primário
 * compõe `text-sobre-acento` (cor) com `text-corpo` (tamanho) e **perdia a
 * cor**, pintando o rótulo em `--texto` sobre o verde do acento — **2,52:1**,
 * medido na tela, contra o piso AA de 4,5:1. O contrato de contraste do DS não
 * via nada: ele confere os TOKENS, não o que a tela pinta.
 */
const PAPEIS_DE_TAMANHO = [
  'display',
  'titulo',
  'subtitulo',
  'corpo-lg',
  'corpo',
  'rotulo',
  'meta',
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...PAPEIS_DE_TAMANHO] }],
    },
  },
})

/**
 * Compõe classes condicionais e resolve conflitos de utilitários Tailwind.
 * Único compositor de classes do design system (design-system.md §0).
 * @param entradas - Classes, objetos e arrays condicionais (formato clsx)
 * @returns String de classes deduplicada (className externo vence sem duplicar)
 */
export function cn(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas))
}
