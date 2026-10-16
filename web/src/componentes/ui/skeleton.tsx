import { cn } from '@/lib/cn'

export interface SkeletonProps {
  /** Dimensiona pela CAIXA EXATA do conteúdo final — CLS 0 (design-system.md §5.9) */
  className?: string
}

/**
 * Estado de carregamento dos 4 estados async. O pulse morre em
 * prefers-reduced-motion (CSS global). O CONTAINER da superfície async deve
 * levar aria-busy="true" enquanto os skeletons estão visíveis.
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-campo bg-neutro-200', className)} />
}
