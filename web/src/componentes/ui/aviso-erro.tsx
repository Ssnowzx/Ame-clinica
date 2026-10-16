import { CircleAlert } from 'lucide-react'

import { cn } from '@/lib/cn'

export interface AvisoErroProps {
  /** Texto tratado (mensagem do servidor ou nossa) — string plana, nunca HTML */
  mensagens: readonly string[]
  className?: string
}

/**
 * Erro GERAL do formulário (design-system §8 — contribuição da change
 * agenda-escrita): o que não pertence a nenhum campo — uma exclusão recusada
 * porque a sessão já foi consumida, uma série que conflita em datas.
 *
 * Diferente do `EstadoErro`, que substitui a tela: este vive DENTRO do
 * formulário, que continua visível e editável. É anunciado ao aparecer.
 */
export function AvisoErro({ mensagens, className }: AvisoErroProps) {
  if (mensagens.length === 0) {
    return null
  }

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-campo border border-l-[3px] border-linha-forte border-l-perigo-texto bg-perigo-suave p-3',
        className,
      )}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-perigo-texto" />
      <div className="flex flex-col gap-1">
        {mensagens.map((mensagem) => (
          <p key={mensagem} className="text-corpo text-perigo-texto">
            {mensagem}
          </p>
        ))}
      </div>
    </div>
  )
}
