import { CircleAlert } from 'lucide-react'

import { cn } from '@/lib/cn'
import { Botao } from '@/componentes/ui/botao'

export interface EstadoErroProps {
  /** Humana, específica (copy pack) — nunca 'erro inesperado' nem dump do servidor */
  mensagem: string
  /** Retry é obrigatório */
  aoTentarNovamente: () => void
  className?: string
}

/**
 * Estado de erro dos 4 estados async (design-system.md §5.9) — fio de 3px no
 * tom perigo (assinatura §1.3) e retry obrigatório.
 */
export function EstadoErro({ mensagem, aoTentarNovamente, className }: EstadoErroProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-superficie border border-linha-forte bg-superficie p-6',
        'border-l-[3px] border-l-perigo-texto',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-perigo-texto" />
        <p className="text-corpo text-texto">{mensagem}</p>
      </div>
      <Botao variante="secundario" tamanho="lg" onClick={aoTentarNovamente}>
        Tentar novamente
      </Botao>
    </div>
  )
}
