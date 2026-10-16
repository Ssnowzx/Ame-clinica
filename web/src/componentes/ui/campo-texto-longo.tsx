import { cva } from 'class-variance-authority'
import { useId } from 'react'
import type { Ref, TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'
import { EnvelopeCampo, descreverCampo, type BaseCampo } from '@/componentes/ui/envelope-campo'

const controle = cva(
  [
    'w-full bg-superficie text-texto text-corpo-lg px-3 py-2',
    'border border-borda-campo rounded-campo',
    'placeholder:text-texto-suave transition-colors duration-(--duracao-1)',
    'focus-visible:border-foco',
    'disabled:bg-neutro-desativado disabled:text-texto-desativado disabled:cursor-not-allowed',
  ],
  {
    variants: {
      comErro: { true: 'border-perigo-texto', false: '' },
    },
    defaultVariants: { comErro: false },
  },
)

export interface CampoTextoLongoProps
  extends BaseCampo,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  /** Controlado — o contador precisa do valor */
  value: string
  /** Limite do servidor; com ele, o contador aparece */
  limite?: number
  linhas?: number
  ref?: Ref<HTMLTextAreaElement>
}

/**
 * Campo de texto longo do design system (§8.1 — contribuição da change
 * cadastros-pessoas).
 *
 * A observação do paciente tem 2000 caracteres: num `input` de linha única, quem
 * escreve não enxerga o que escreveu — e trunca sem perceber. O contador diz
 * quanto ainda cabe; o `maxLength` do limite impede o 422 por tamanho, que seria
 * uma viagem inútil ao servidor.
 */
export function CampoTextoLongo({
  rotulo,
  erro,
  ajuda,
  obrigatorio = false,
  value,
  limite,
  linhas = 4,
  className,
  id: idExterno,
  ...props
}: CampoTextoLongoProps) {
  const idGerado = useId()
  const id = idExterno ?? idGerado
  const idContador = `${id}-contador`

  const restantes = limite !== undefined ? limite - value.length : undefined

  return (
    <EnvelopeCampo id={id} rotulo={rotulo} erro={erro} ajuda={ajuda} obrigatorio={obrigatorio} className={className}>
      <textarea
        id={id}
        value={value}
        rows={linhas}
        required={obrigatorio}
        maxLength={limite}
        aria-invalid={erro !== undefined ? true : undefined}
        aria-describedby={
          [descreverCampo(id, { ajuda, erro }), limite !== undefined ? idContador : null]
            .filter((valor): valor is string => valor != null)
            .join(' ') || undefined
        }
        className={cn(controle({ comErro: erro !== undefined }))}
        {...props}
      />
      {restantes !== undefined ? (
        // status: quem usa leitor de tela é avisado ao se aproximar do limite,
        // sem que cada tecla vire um anúncio
        <p id={idContador} role="status" className="mt-1 text-right text-meta text-texto-suave">
          {restantes} {restantes === 1 ? 'caractere restante' : 'caracteres restantes'}
        </p>
      ) : null}
    </EnvelopeCampo>
  )
}
