import { useId } from 'react'

import { EnvelopeCampo, descreverCampo, type BaseCampo } from '@/componentes/ui/envelope-campo'
import { cn } from '@/lib/cn'
import { COR_DE_RESERVA, corHexSegura } from '@/lib/cor-status'

export interface CampoCorProps extends BaseCampo {
  /** Valor controlado — `#RRGGBB` (o formato que a API exige) */
  valor: string
  aoMudar: (valor: string) => void
  disabled?: boolean
  className?: string
}

/**
 * Campo de cor do design system (design-system.md §5.3).
 *
 * Dois controles, um valor: o **seletor nativo** (a recepção escolhe com o olho,
 * usando o color picker do sistema operacional) e o **hexadecimal em texto** (a
 * clínica cola a cor que veio do manual de marca — coisa que o seletor nativo não
 * permite). O texto é a fonte da verdade; o seletor é uma forma de editá-lo.
 *
 * O seletor nativo **nunca recebe lixo**: `<input type="color">` com valor inválido
 * cai silenciosamente para preto e o usuário nunca entende por quê. Por isso o
 * valor passa por `corHexSegura` antes de chegar nele — a mesma peneira que os
 * componentes usam para a cor que vem do cadastro da clínica.
 */
export function CampoCor({
  rotulo,
  erro,
  ajuda,
  obrigatorio = false,
  valor,
  aoMudar,
  disabled = false,
  className,
}: CampoCorProps) {
  const id = useId()
  const idTexto = `${id}-hex`
  const segura = corHexSegura(valor)

  return (
    <EnvelopeCampo
      id={id}
      rotulo={rotulo}
      erro={erro}
      ajuda={ajuda}
      obrigatorio={obrigatorio}
      className={className}
    >
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          // o seletor só enxerga cor válida; quando o texto está pela metade
          // (a pessoa está digitando), ele segura a última cor conhecida
          value={segura ?? COR_DE_RESERVA}
          disabled={disabled}
          aria-invalid={erro !== undefined ? true : undefined}
          aria-describedby={descreverCampo(id, { ajuda, erro })}
          onChange={(evento) => {
            aoMudar(evento.target.value.toUpperCase())
          }}
          className={cn(
            'size-10 shrink-0 cursor-pointer rounded-campo border border-borda-campo bg-superficie p-1',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
            'disabled:cursor-not-allowed disabled:bg-neutro-desativado',
            erro !== undefined && 'border-perigo-texto',
          )}
        />

        <input
          id={idTexto}
          type="text"
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          value={valor}
          disabled={disabled}
          maxLength={7}
          placeholder={COR_DE_RESERVA}
          // o seletor nativo não tem nome acessível legível ("cor" é o tipo, não
          // o papel); é este campo que carrega o valor para quem não enxerga
          aria-label={`${rotulo} — código hexadecimal`}
          aria-invalid={erro !== undefined ? true : undefined}
          onChange={(evento) => {
            aoMudar(evento.target.value.toUpperCase())
          }}
          className={cn(
            'w-32 rounded-campo border border-borda-campo bg-superficie px-3 text-corpo-lg uppercase tabular-nums text-texto',
            'h-10 transition-colors duration-(--duracao-1) focus-visible:border-foco',
            'disabled:cursor-not-allowed disabled:bg-neutro-desativado disabled:text-texto-desativado',
            erro !== undefined && 'border-perigo-texto',
          )}
        />
      </div>
    </EnvelopeCampo>
  )
}
