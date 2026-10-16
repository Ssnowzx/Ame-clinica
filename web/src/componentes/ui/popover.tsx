import { Popover as RadixPopover } from 'radix-ui'
import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface PopoverProps {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  /** Gatilho do painel — recebe `aria-haspopup`/`aria-expanded` do Radix via `asChild`. */
  gatilho: ReactNode
  /** Título SEMPRE presente — é o nome acessível do painel (`aria-labelledby`). */
  titulo: string
  /** Rodapé FIXO (ações). Some quando ausente. */
  rodape?: ReactNode
  /** Corpo ROLÁVEL. */
  children: ReactNode
  /**
   * O corpo vira a DESCRIÇÃO acessível do painel (`aria-describedby`). Para o painel que só
   * explica (a definição de um indicador): ao abrir, o leitor de tela anuncia o título E o texto,
   * sem que a pessoa precise navegar por dentro de um painel sem nenhum controle.
   *
   * E o corpo vira PARADA DE TECLADO (`tabIndex=0`) e recebe o foco ao abrir (A11Y-IND-01): sem
   * nenhum controle dentro, o foco caía no próprio painel, e com o texto mais alto que a tela
   * (zoom de 400%, celular deitado) não havia como rolar até o fim pelo teclado.
   */
  descreverPeloCorpo?: boolean
  className?: string
}

/**
 * A ALTURA é a que sobra na tela, não 70% dela: com o zoom de 400% (320 × 256) o painel de 70vh
 * passava da borda e o fim do texto ficava fora do alcance (A11Y-IND-01). A LARGURA cede à tela
 * estreita com 1rem de cada lado. A BORDA separa o painel branco do cartão branco em que ele pousa —
 * só a sombra o fundia no cartão (DQ-17).
 */
const CLASSE_DO_PAINEL =
  'z-(--z-menu) flex max-h-[min(70vh,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-janela border border-linha-forte bg-superficie-elevada shadow-e3 origin-(--radix-popover-content-transform-origin) data-[state=open]:animar-entrada'

/**
 * Primitivo de painel flutuante ancorado no gatilho (design-system.md · change
 * centro-de-notificacoes-painel).
 *
 * Sobre o Radix `Popover` (NÃO `Dialog`): o painel é leitura rápida ancorada em
 * quem o abriu — sem scrim, sem interromper a página. `modal` prende o foco
 * enquanto aberto (mesmo trade-off aceito no `Dialog`); `Esc` e clique fora
 * fecham e o foco VOLTA ao gatilho — tudo do Radix, nada à mão. Cabeçalho fixo,
 * corpo rolável com teto de altura. Só tokens — nenhum valor mágico.
 */
export function Popover({
  aberto,
  aoMudarAberto,
  gatilho,
  titulo,
  rodape,
  children,
  descreverPeloCorpo = false,
  className,
}: PopoverProps) {
  const idTitulo = useId()
  const idCorpo = useId()

  return (
    <RadixPopover.Root open={aberto} onOpenChange={aoMudarAberto} modal>
      <RadixPopover.Trigger asChild>{gatilho}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          aria-labelledby={idTitulo}
          aria-describedby={descreverPeloCorpo ? idCorpo : undefined}
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className={cn(CLASSE_DO_PAINEL, className)}
        >
          {/* `div`, não `header`: dentro de um painel, `header` vira um banner a mais (A11Y-IND-09) */}
          <div className="shrink-0 border-b border-linha px-4 py-3">
            <h2 id={idTitulo} className="text-corpo font-semibold text-texto">
              {titulo}
            </h2>
          </div>

          {/* parada de teclado no painel que só explica: o Radix abre o painel focando o PRIMEIRO alvo
              tabulável — que passa a ser este texto, rolável pelas setas */}
          <div
            id={idCorpo}
            tabIndex={descreverPeloCorpo ? 0 : undefined}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-corpo text-texto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foco"
          >
            {children}
          </div>

          {rodape === undefined ? null : <div className="shrink-0 border-t border-linha px-4 py-3">{rodape}</div>}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
