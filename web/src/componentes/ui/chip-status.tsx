import type { ButtonHTMLAttributes, Ref } from 'react'

import { cn } from '@/lib/cn'
import { derivarTonsStatus } from '@/lib/cor-status'
import { iconeSeguro } from '@/lib/icone-status'

export interface ChipStatusProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'title'> {
  /** Rótulo SEMPRE visível */
  nome: string
  /** Hex cru do cadastro da clínica (status_agendamento.cor) */
  cor: string
  /** Idem; passa pelo mesmo clamp */
  corBorda?: string | null
  /** Slug do ícone no cadastro (§2.3); desconhecido/ausente → ícone neutro */
  tipo?: string | null
  /** sm: só na grade compacta */
  tamanho?: 'sm' | 'md'
  /** Torna o chip ACIONÁVEL: vira <button> com os 5 estados (§5.4) */
  aoAcionar?: () => void
  /** Nome acessível quando acionável — deve CONTER o rótulo visível (2.5.3) */
  rotuloDaAcao?: string
  ref?: Ref<HTMLButtonElement>
}

/**
 * Chip de status dirigido por DADO (design-system.md §5.4) — enforcement do
 * §2: mesmo que a clínica cadastre vermelho puro, o chip renderiza o trio
 * suave com AA por construção (derivarTonsStatus, memoizado). Nunca bloco
 * saturado. Cor sozinha nunca é canal (1.4.1): ícone + rótulo sempre.
 *
 * Com `aoAcionar`, vira um controle real (foco, teclado, nome acessível) —
 * é assim que o fluxo do dia troca o status pela grade.
 */
export function ChipStatus({
  nome,
  cor,
  corBorda = null,
  tipo = null,
  tamanho = 'md',
  aoAcionar,
  rotuloDaAcao,
  ...props
}: ChipStatusProps) {
  const tons = derivarTonsStatus(cor, corBorda)
  const Icone = iconeSeguro(tipo)

  const classes = cn(
    'inline-flex max-w-full items-center rounded-pilula border font-medium',
    tamanho === 'sm' ? 'h-5 gap-1 px-1.5 text-meta' : 'h-6 gap-1.5 px-2 text-meta',
    aoAcionar !== undefined &&
      'cursor-pointer transition-shadow duration-(--duracao-1) hover:shadow-e1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco active:translate-y-px',
  )
  const estilo = { backgroundColor: tons.fundo, borderColor: tons.borda, color: tons.texto }

  const conteudo = (
    <>
      <Icone aria-hidden="true" className={cn('shrink-0', tamanho === 'sm' ? 'size-3' : 'size-3.5')} />
      <span className="truncate">{nome}</span>
    </>
  )

  if (aoAcionar !== undefined) {
    return (
      <button
        type="button"
        aria-label={rotuloDaAcao}
        title={nome}
        className={classes}
        style={estilo}
        // as props entram ANTES do onClick para que um `asChild` (Radix) possa
        // instalar o seu próprio handler sem perder o nosso
        {...props}
        onClick={(evento) => {
          props.onClick?.(evento)
          aoAcionar()
        }}
      >
        {conteudo}
      </button>
    )
  }

  return (
    <span title={nome} className={classes} style={estilo}>
      {conteudo}
    </span>
  )
}
