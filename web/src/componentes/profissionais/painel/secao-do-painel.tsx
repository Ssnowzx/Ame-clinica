import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { ContextoDoNivelDoTitulo } from '@/componentes/indicadores/nivel-do-titulo'
import { cn } from '@/lib/cn'

/**
 * Um BLOCO do painel do profissional (change painel-do-profissional, D5): o título do bloco, a linha que
 * diz o que ele mede e o conteúdo — cartões, quadros de gráfico ou a lista. Os blocos seguem a ordem da
 * pergunta do profissional (hoje → o mês → seis meses → a semana → onde não rendeu → pacientes →
 * evoluções → tratamentos → financeiro), e um bloco cuja chave não veio simplesmente não existe: o
 * chamador não o monta, e nada fica no lugar dele.
 *
 * No papel, o título nunca fica sozinho no pé da folha (`print:break-after-avoid`); os quadros e os
 * cartões de dentro já não se partem (`print:break-inside-avoid` neles).
 */
export function SecaoDoPainel({
  id,
  titulo,
  subtitulo,
  children,
  className,
}: {
  id: string
  titulo: string
  subtitulo?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-4', className)}>
      <div className="flex flex-col gap-1 print:break-after-avoid">
        <h2 id={id} className="text-titulo font-semibold text-texto">
          {titulo}
        </h2>
        {subtitulo === undefined ? null : <p className="text-pretty text-meta text-texto-suave">{subtitulo}</p>}
      </div>
      {/* os cartões e os quadros de dentro ficam um nível abaixo do título do bloco (h3) */}
      <ContextoDoNivelDoTitulo.Provider value={3}>{children}</ContextoDoNivelDoTitulo.Provider>
    </section>
  )
}

/**
 * Um bloco PEQUENO em cartão (Hoje, Evoluções, Tratamentos): a moldura de superfície da ficha, inteiro
 * numa folha só.
 */
export function CartaoDaFicha({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-superficie border border-linha bg-superficie p-4 print:break-inside-avoid"
    >
      <h2 id={id} className="text-titulo font-semibold text-texto">
        {titulo}
      </h2>
      {children}
    </section>
  )
}

/** A PORTA de um bloco para a tela de origem — um link real, fora do papel. */
export function PortaDoBloco({ para, children }: { para: string; children: ReactNode }) {
  return (
    <Link
      data-nao-imprimir
      to={para}
      className="flex w-fit items-center gap-1 rounded-controle text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
    >
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  )
}
