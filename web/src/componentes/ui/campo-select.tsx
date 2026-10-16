import { cva } from 'class-variance-authority'
import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import type { ReactNode, Ref, SelectHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'
import { EnvelopeCampo, descreverCampo, type BaseCampo } from '@/componentes/ui/envelope-campo'

const controle = cva(
  [
    'w-full appearance-none bg-superficie text-texto text-corpo-lg pl-3 pr-9',
    'border border-borda-campo rounded-campo',
    'transition-colors duration-(--duracao-1)',
    'focus-visible:border-foco',
    'disabled:bg-neutro-desativado disabled:text-texto-desativado disabled:cursor-not-allowed',
  ],
  {
    variants: {
      tamanho: { md: 'h-10', lg: 'h-11' },
      comErro: { true: 'border-perigo-texto', false: '' },
    },
    defaultVariants: { tamanho: 'md', comErro: false },
  },
)

export interface CampoSelectProps extends BaseCampo, SelectHTMLAttributes<HTMLSelectElement> {
  opcoes: ReadonlyArray<{ valor: string; rotulo: string }>
  /** Vira <option value="" disabled> */
  placeholder?: string
  tamanho?: 'md' | 'lg'
  /** Ação na linha do controle (o "Salvar" das configurações) — ver `EnvelopeCampo`. */
  acaoAoLado?: ReactNode
  /** Continuação do rótulo só para leitor de tela — ver `EnvelopeCampo`. */
  complementoDoRotulo?: string
  ref?: Ref<HTMLSelectElement>
}

/**
 * Select NATIVO estilizado (design-system.md §5.3) — teclado/AT do browser de
 * graça; Radix Select só entra por change quando houver busca/combobox.
 */
export function CampoSelect({
  rotulo,
  complementoDoRotulo,
  erro,
  ajuda,
  obrigatorio = false,
  opcoes,
  placeholder,
  tamanho,
  acaoAoLado,
  className,
  id: idExterno,
  ...props
}: CampoSelectProps) {
  const idGerado = useId()
  const id = idExterno ?? idGerado

  return (
    <EnvelopeCampo
      id={id}
      rotulo={rotulo}
      complementoDoRotulo={complementoDoRotulo}
      erro={erro}
      ajuda={ajuda}
      obrigatorio={obrigatorio}
      acaoAoLado={acaoAoLado}
      className={className}
    >
      <div className="relative">
        <select
          id={id}
          required={obrigatorio}
          aria-invalid={erro !== undefined ? true : undefined}
          aria-describedby={descreverCampo(id, { ajuda, erro })}
          className={cn(controle({ tamanho, comErro: erro !== undefined }))}
          {...props}
        >
          {placeholder !== undefined ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {opcoes.map((opcao) => (
            <option key={opcao.valor} value={opcao.valor}>
              {opcao.rotulo}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-texto-suave"
        />
      </div>
    </EnvelopeCampo>
  )
}
