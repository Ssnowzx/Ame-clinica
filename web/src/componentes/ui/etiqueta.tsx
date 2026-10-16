import { cva, type VariantProps } from 'class-variance-authority'
import type { LucideIcon } from 'lucide-react'
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

const etiqueta = cva(
  'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-pilula px-2 text-meta font-medium',
  {
    variants: {
      tom: {
        neutro: 'bg-neutro-desativado text-texto-suave',
        sucesso: 'bg-sucesso-suave text-sucesso-texto',
        alerta: 'bg-alerta-suave text-alerta-texto',
        perigo: 'bg-perigo-suave text-perigo-texto',
        info: 'bg-info-suave text-info-texto',
        acento: 'bg-acento-suave text-acento',
      },
      tamanho: { sm: 'h-5', md: 'h-6' },
    },
    defaultVariants: { tom: 'neutro', tamanho: 'md' },
  },
)

export interface EtiquetaProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof etiqueta> {
  /** Ícone à esquerda do texto — o texto continua sendo o sinal; o ícone é reforço (1.4.1). */
  icone?: LucideIcon
}

/**
 * Etiqueta de estado FIXO do sistema (situação, prioridade, pendência): fundo suave + texto
 * forte no tom, sempre com PALAVRA — cor nunca é o único sinal (§2 da especificação).
 *
 * Não confundir com o `ChipStatus`: aquele pinta o status de agendamento com a cor que a
 * CLÍNICA escolheu (dado da clínica); esta pinta com os tons semânticos do design system.
 */
export function Etiqueta({ tom, tamanho, icone: Icone, className, children, ...props }: EtiquetaProps) {
  return (
    <span className={cn(etiqueta({ tom, tamanho }), className)} {...props}>
      {Icone === undefined ? null : <Icone aria-hidden="true" className="size-3.5 shrink-0" />}
      {children}
    </span>
  )
}
