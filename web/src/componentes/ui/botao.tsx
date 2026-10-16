import { cva, type VariantProps } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import { Slot } from 'radix-ui'
import type { ButtonHTMLAttributes, Ref } from 'react'

import { cn } from '@/lib/cn'

const botao = cva(
  [
    'inline-flex items-center justify-center gap-2 select-none whitespace-nowrap font-medium',
    // `rounded-botao`: no Padrão é o raio de controle; um tema de clínica pode fazê-lo pílula
    'rounded-botao transition-colors duration-(--duracao-1)',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
    'disabled:bg-neutro-desativado disabled:text-texto-desativado disabled:cursor-not-allowed disabled:pointer-events-none',
    // `aria-disabled` = inerte MAS focável (WCAG 2.4.3/3.3.1): a ação primária que o
    // consumidor ainda não liberou continua na sequência de Tab, para poder DIZER, pelo
    // `aria-describedby`, o que falta. `disabled` a tira do ciclo e o motivo some junto.
    'aria-disabled:bg-neutro-desativado aria-disabled:text-texto-desativado aria-disabled:cursor-not-allowed',
    'aria-disabled:hover:bg-neutro-desativado aria-disabled:active:translate-y-0',
    'active:translate-y-px',
  ],
  {
    variants: {
      variante: {
        // papel próprio (change tema-da-clinica): no Padrão é o acento com texto branco; um tema
        // pode preencher com cor clara e texto escuro sem tirar do acento o papel de cor de texto
        //
        // o ORNAMENTO e a ELEVAÇÃO (change tema-xclinicas) são papéis: no Padrão `none` não cria o
        // pseudo-elemento e `0px` não move. No tema Xclinicas, o losango rosé do manual depois do
        // rótulo e a subida de 2px no hover; o inerte não sobe nem mostra o "pronto para ir".
        primario: [
          'bg-botao-primario text-sobre-botao-primario shadow-botao-primario hover:bg-botao-primario-hover',
          // `transition` (e não `-colors`): no v4 ele inclui o `translate` da subida
          'transition',
          'hover:-translate-y-(--botao-primario-elevacao)',
          // a PONTE: a subida leva junto a área de clique, e com o cursor nos 2px de baixo o botão
          // subia, perdia o hover, descia e o ganhava de novo — tremia (code-reviewer r1). Um
          // `::before` da altura da subida, logo abaixo, segura o hover. Ele só tem altura DURANTE o
          // hover: sempre presente, ele mesmo dava o hover 2px abaixo do botão e o tremor só descia
          // (code-reviewer r2). No Padrão a altura é 0px de qualquer jeito.
          'relative before:absolute before:inset-x-0 before:top-full before:h-0 before:content-[\'\']',
          'hover:before:h-(--botao-primario-elevacao)',
          'aria-disabled:hover:translate-y-0 disabled:hover:translate-y-0',
          'after:size-2 after:shrink-0 after:rotate-45 after:bg-losango after:content-(--botao-primario-losango)',
          'disabled:after:hidden aria-disabled:after:hidden',
          // o filtro LIGADO (`aria-pressed`) usa a pele primária para dizer "escolhido", não "vá": sem
          // o losango de "ponto de chegada" e sem subir
          'aria-pressed:after:hidden aria-pressed:hover:translate-y-0',
        ],
        secundario: 'border border-borda-botao bg-superficie text-texto hover:bg-fundo',
        perigo: 'bg-perigo text-sobre-perigo hover:bg-perigo-intenso',
        // ação de IMPACTO fora do diálogo (desmarcar em lote, desativar): moldura e texto na
        // cor de perigo, sem o bloco sólido — que a regra §5.2 reserva ao DialogConfirmacao
        'perigo-suave':
          'border border-perigo bg-superficie text-perigo-texto hover:border-perigo-intenso hover:bg-perigo-suave',
        // terciária (cancelar, fechar, ver detalhes) — NUNCA a ação principal de uma região:
        // sem moldura ela é lida como rótulo, e a recepção passa direto (achado de 2026-09-02)
        fantasma: 'text-texto hover:bg-acento-suave',
      },
      tamanho: {
        sm: 'h-8 px-3 text-meta',
        md: 'h-10 px-4 text-corpo',
        lg: 'h-11 px-5 text-corpo',
      },
    },
    defaultVariants: { variante: 'primario', tamanho: 'md' },
  },
)

export interface BotaoProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof botao> {
  /** Spinner + aria-busy + disabled; largura preservada (o rótulo não some) */
  carregando?: boolean
  /** Radix Slot — vira <Link> mantendo a skin (carregando não se aplica) */
  asChild?: boolean
  ref?: Ref<HTMLButtonElement>
}

/**
 * Botão do design system (design-system.md §5.2). Um `primario` por região de
 * tela; `perigo` somente dentro do DialogConfirmacao ou após ele — FORA dele, a
 * ação de impacto é `perigo-suave` (moldura + texto de perigo). `fantasma` é
 * terciária: nunca a ação principal de uma região. Ícone-somente exige `aria-label`.
 */
export function Botao({
  variante,
  tamanho,
  carregando = false,
  asChild = false,
  className,
  children,
  type = 'button',
  disabled,
  onClick,
  ...props
}: BotaoProps) {
  const classes = cn(botao({ variante, tamanho }), className)

  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    )
  }

  return (
    <button
      type={type}
      className={classes}
      /* CARREGANDO usa `aria-disabled`, não `disabled` (2.4.3): elemento `disabled` PERDE o
         foco, e o focus scope do diálogo o recolhe no contêiner — quem acionou a ação era
         teleportado para o topo e precisava de ~20 Tabs para voltar ao botão que acabou de
         apertar (medido pelo gate). O padrão já estava documentado acima, para outro caso;
         faltava aplicá-lo aqui. `disabled` explícito do consumidor continua nativo. */
      disabled={disabled === true}
      aria-disabled={carregando || undefined}
      aria-busy={carregando || undefined}
      onClick={(evento) => {
        // `aria-disabled` é inerte por CONTRATO, não pelo navegador: o clique se barra à mão
        if (carregando) {
          evento.preventDefault()

          return
        }
        onClick?.(evento)
      }}
      {...props}
    >
      {carregando ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
      {children}
    </button>
  )
}
