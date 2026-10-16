import { type ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * Primitivo `DescriptionList` (design-system.md · change detalhe-do-agendamento).
 *
 * Metadados de LEITURA em `<dl>`/`<dt>`/`<dd>` — substitui o antipadrão de forjar
 * leitura com campos de formulário desabilitados (semântica de escrita para conteúdo
 * estático). Uma coluna em 390px, duas em 768px+. Só tokens.
 */
export interface ItemDescricao {
  /**
   * Aceita `ReactNode`, não só string: uma resposta ÓRFÃ da anamnese lê como id cru +
   * ícone de aviso + texto (`campo removido do modelo`). `string` é subtipo de
   * `ReactNode` — os consumidores existentes (ex.: `secao-cadastro`) seguem intactos.
   */
  rotulo: ReactNode
  valor: ReactNode
  /** Ocupa as duas colunas em 768px+ (ex.: observação longa). */
  larguraTotal?: boolean
  /** Chave estável de lista quando o rótulo não é string (ex.: rótulo com ícone). */
  chave?: string
}

export interface ListaDescricaoProps {
  itens: readonly ItemDescricao[]
  className?: string
}

export function ListaDescricao({ itens, className }: ListaDescricaoProps) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-2.5 md:gap-y-4 md:grid-cols-2', className)}>
      {itens.map((item, indice) => {
        const chave = item.chave ?? (typeof item.rotulo === 'string' ? item.rotulo : String(indice))
        // valor longo (endereço, observação) continua EMPILHADO mesmo em tela estreita: posto
        // na mesma linha do rótulo ele quebraria em três linhas espremidas contra a direita
        const empilhado = item.larguraTotal === true

        return (
          <div
            key={chave}
            className={cn(
              /*
                Em tela estreita, rótulo e valor na MESMA linha — rótulo à esquerda, valor à
                direita, com um filete separando. Empilhados, cada fato ocupava duas linhas mais
                o vão, e cinco fatos viravam uma coluna alta e solta ("está tudo muito solto no
                card", 2026-08-26). Acima do breakpoint nada muda: duas colunas, valor sob o
                rótulo, como sempre foi.
              */
              !empilhado
                && 'flex items-baseline justify-between gap-4 border-b border-linha pb-2.5 md:block md:border-0 md:pb-0',
              item.larguraTotal === true && 'md:col-span-2',
            )}
          >
            <dt className={cn('text-rotulo text-texto-suave', !empilhado && 'shrink-0')}>
              {item.rotulo}
            </dt>
            <dd
              className={cn(
                'text-corpo text-texto',
                empilhado ? 'mt-0.5' : 'min-w-0 text-right md:mt-0.5 md:text-left',
              )}
            >
              {item.valor}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
