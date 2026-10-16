import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { Dialog as RadixDialog } from 'radix-ui'
import { useId, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * Primitivo de diálogo DISPENSÁVEL (design-system.md · change detalhe-do-agendamento).
 *
 * Sobre o Radix `Dialog` (NÃO `AlertDialog`): ler é dispensável — `Esc` e clique no
 * overlay fecham, o foco volta ao gatilho. O `AlertDialog`/`DialogConfirmacao` fica
 * só para decisão obrigatória (destrutivas). Cabeçalho e rodapé FIXOS, corpo rolável.
 * Só tokens — nenhum valor mágico.
 */
const conteudo = cva(
  'fixed z-(--z-dialogo) flex flex-col overflow-hidden bg-superficie-elevada shadow-e3 data-[state=open]:animar-entrada-janela',
  {
    variants: {
      variante: {
        // modal centrado de leitura (desktop-first)
        centrado:
          'left-1/2 top-1/2 max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-janela',
        // sheet: inferior no 390, lateral (direita) a partir do 768
        sheet:
          'inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-janela md:inset-y-0 md:bottom-auto md:left-auto md:right-0 md:h-full md:max-h-none md:w-full md:max-w-md md:rounded-none md:rounded-l-janela',
      },
    },
    defaultVariants: { variante: 'centrado' },
  },
)

export type DialogVariante = NonNullable<VariantProps<typeof conteudo>['variante']>

export interface DialogProps {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  /** Título do diálogo — SEMPRE presente (a11y: `Dialog.Title`); mostrado no cabeçalho fixo. */
  titulo: string
  /** Descrição opcional para leitores de tela (`aria-describedby`). */
  descricao?: string
  /** `centrado` (modal `max-w-2xl`) · `sheet` (inferior 390 / lateral 768+). */
  variante?: DialogVariante
  /** Rodapé FIXO (ações). Some quando ausente. */
  rodape?: ReactNode
  /** Corpo ROLÁVEL. */
  children: ReactNode
  className?: string
  /**
   * Destino EXPLÍCITO do foco ao fechar (2.4.3). O default devolve ao elemento
   * focado na abertura — mas fluxos que MUDAM o alvo certo durante a vida do
   * diálogo (ex.: remarcação por arrasto, em que o card re-renderiza em outra
   * célula) resolvem o destino aqui; retornar `null` cai no default.
   */
  focoAoFechar?: () => HTMLElement | null
  /**
   * O aviso que tomou o lugar do corpo (um estado vazio sem o pré-requisito): entra na descrição
   * acessível do diálogo, junto da `descricao` — quem usa leitor de tela ouve o motivo ao abrir, e não
   * só o título (A11Y-AVI-03, como o `idsDoAviso` da `JanelaDeFormulario`). Um ou mais ids separados
   * por espaço (o texto do vazio e a frase de a quem pedir); id ausente da tela é ignorado.
   */
  idDoAviso?: string
}

export function Dialog({
  aberto,
  aoMudarAberto,
  titulo,
  descricao,
  variante = 'centrado',
  rodape,
  children,
  className,
  focoAoFechar,
  idDoAviso,
}: DialogProps) {
  const refFechar = useRef<HTMLButtonElement>(null)
  const idDaDescricao = useId()
  const descritoPor = [descricao === undefined ? null : idDaDescricao, idDoAviso ?? null]
    .filter((id): id is string => id !== null)
    .join(' ')
  // O diálogo é aberto pelo estado (não por `Dialog.Trigger`): o Radix não conhece
  // o gatilho, então guardamos e devolvemos o foco à mão (mesmo padrão do DialogConfirmacao).
  const refDisparador = useRef<HTMLElement | null>(null)

  return (
    <RadixDialog.Root open={aberto} onOpenChange={aoMudarAberto}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
        <RadixDialog.Content
          className={cn(conteudo({ variante }), className)}
          // A descrição acessível é a `descricao` e/ou o aviso do corpo. Sem nenhum, dizemos ao Radix que
          // é intencional (suprime o aviso dele) — o `undefined` explícito tira o atributo.
          aria-describedby={descritoPor === '' ? undefined : descritoPor}
          onOpenAutoFocus={(evento) => {
            evento.preventDefault()
            refDisparador.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null
            refFechar.current?.focus()
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault()
            // O restore roda no UNMOUNT — depois de qualquer foco que a página
            // tenha posto. O destino explícito vence para não roubá-lo de volta.
            const alvoExplicito = focoAoFechar?.() ?? null
            if (alvoExplicito !== null) {
              alvoExplicito.focus()
            } else {
              refDisparador.current?.focus()
            }
            refDisparador.current = null
          }}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-linha px-6 py-4">
            <div className="min-w-0">
              <RadixDialog.Title className="text-titulo font-semibold text-texto">
                {titulo}
              </RadixDialog.Title>
              {descricao === undefined ? null : (
                <RadixDialog.Description id={idDaDescricao} className="mt-1 text-corpo text-texto-suave">
                  {descricao}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <button
                ref={refFechar}
                type="button"
                aria-label="Fechar"
                className="-mr-1 shrink-0 rounded-controle p-1 text-texto-suave transition-colors duration-(--duracao-1) hover:bg-hover-de-linha hover:text-texto"
              >
                <X aria-hidden className="size-5" />
              </button>
            </RadixDialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-corpo text-texto">
            {children}
          </div>

          {rodape === undefined ? null : (
            <footer className="shrink-0 border-t border-linha px-6 py-4">{rodape}</footer>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
