import { Check, CircleAlert } from 'lucide-react'
import { Checkbox } from 'radix-ui'
import { useId } from 'react'

import { cn } from '@/lib/cn'
import { descreverCampo, temAjuda, type BaseCampo } from '@/componentes/ui/envelope-campo'

export interface CampoCheckboxProps extends BaseCampo {
  marcado: boolean
  aoMudar: (marcado: boolean) => void
  desabilitado?: boolean
  className?: string
}

/**
 * Checkbox do design system (design-system.md §5.3) — Radix Checkbox, caixa
 * 20×20, área clicável estendida ao rótulo (alvo ≥ 24).
 */
export function CampoCheckbox({
  rotulo,
  erro,
  ajuda,
  obrigatorio = false,
  marcado,
  aoMudar,
  desabilitado = false,
  className,
}: CampoCheckboxProps) {
  const id = useId()

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2 py-0.5">
        <Checkbox.Root
          id={id}
          checked={marcado}
          onCheckedChange={(estado) => {
            aoMudar(estado === true)
          }}
          disabled={desabilitado}
          required={obrigatorio}
          aria-invalid={erro !== undefined ? true : undefined}
          aria-describedby={descreverCampo(id, { ajuda, erro })}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-caixa border bg-superficie',
            'transition-colors duration-(--duracao-1)',
            erro !== undefined ? 'border-perigo-texto' : 'border-borda-campo',
            'data-[state=checked]:border-acento data-[state=checked]:bg-acento',
            'disabled:cursor-not-allowed disabled:border-linha-forte disabled:bg-neutro-desativado',
          )}
        >
          <Checkbox.Indicator>
            <Check aria-hidden="true" className="size-3.5 text-sobre-acento" />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <label
          htmlFor={id}
          className={cn('text-corpo', desabilitado ? 'cursor-not-allowed text-texto-desativado' : 'text-texto')}
        >
          {rotulo}
          {obrigatorio ? <span className="text-texto-suave"> (obrigatório)</span> : null}
        </label>
      </div>
      {temAjuda(ajuda) ? (
        <p id={`${id}-ajuda`} className="pl-7 text-meta text-texto-suave">
          {ajuda}
        </p>
      ) : null}
      {erro !== undefined ? (
        <p id={`${id}-erro`} role="alert" className="flex items-center gap-1 pl-7 text-meta text-perigo-texto">
          <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {erro}
        </p>
      ) : null}
    </div>
  )
}
