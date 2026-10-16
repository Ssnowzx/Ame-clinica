import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Botao } from '@/componentes/ui/botao'

export interface PaginacaoProps {
  pagina: number
  totalPaginas: number
  aoMudar: (pagina: number) => void
  /** "128 registros" — anunciado em role="status" ao mudar */
  totalItens?: number
}

// Janela numérica: primeira, vizinhas da atual e última; buracos viram
// reticências. Buraco de UMA página vira o próprio número (reticências que
// escondem um só número custam mais do que economizam).
function paginasVisiveis(pagina: number, totalPaginas: number): number[] {
  const candidatas = new Set([1, pagina - 1, pagina, pagina + 1, totalPaginas])
  const janela = [...candidatas]
    .filter((numero) => numero >= 1 && numero <= totalPaginas)
    .sort((a, b) => a - b)

  const completa: number[] = []
  for (const [indice, numero] of janela.entries()) {
    if (indice > 0 && numero - janela[indice - 1] === 2) {
      completa.push(numero - 1)
    }
    completa.push(numero)
  }
  return completa
}

/**
 * Paginação do design system (design-system.md §5.10) — página atual com
 * aria-current="page" e cor + peso (nunca só cor); disabled real nos extremos.
 */
export function Paginacao({ pagina, totalPaginas, aoMudar, totalItens }: PaginacaoProps) {
  const visiveis = paginasVisiveis(pagina, totalPaginas)

  return (
    <nav aria-label="Paginação" className="flex items-center gap-1">
      <Botao
        variante="fantasma"
        tamanho="sm"
        aria-label="Página anterior"
        disabled={pagina <= 1}
        onClick={() => {
          aoMudar(pagina - 1)
        }}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Botao>

      {visiveis.map((numero, indice) => {
        const anterior = visiveis[indice - 1]
        const haBuraco = indice > 0 && numero - anterior > 1
        const atual = numero === pagina
        return (
          <span key={numero} className="flex items-center gap-1">
            {haBuraco ? (
              <span aria-hidden="true" className="px-1 text-meta text-texto-suave">
                …
              </span>
            ) : null}
            <Botao
              variante="fantasma"
              tamanho="sm"
              aria-label={`Página ${numero}`}
              aria-current={atual ? 'page' : undefined}
              className={cn('min-w-8 px-2 tabular-nums', atual && 'bg-acento-suave font-semibold text-acento')}
              onClick={() => {
                aoMudar(numero)
              }}
            >
              {numero}
            </Botao>
          </span>
        )
      })}

      <Botao
        variante="fantasma"
        tamanho="sm"
        aria-label="Próxima página"
        disabled={pagina >= totalPaginas}
        onClick={() => {
          aoMudar(pagina + 1)
        }}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </Botao>

      {totalItens !== undefined ? (
        <p role="status" className="ml-2 text-meta text-texto-suave tabular-nums">
          {totalItens} registros
        </p>
      ) : null}
    </nav>
  )
}
