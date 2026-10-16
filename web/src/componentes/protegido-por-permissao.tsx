import type { ReactNode } from 'react'

import { possuiAlgumaPermissao } from '@/lib/permissoes'
import { useAuthStore } from '@/stores/auth-store'

interface ProtegidoPorPermissaoProps {
  /** Uma permissão, ou uma lista — basta ter QUALQUER UMA delas (o índice de
   *  cadastros aparece para quem pode ver ao menos um catálogo) */
  permissao: string | readonly string[]
  children: ReactNode
}

/**
 * Esconde UI de quem não tem a permissão. Guard de experiência apenas —
 * toda rota da API valida a permissão no servidor (parecer T-rbac-05).
 */
export function ProtegidoPorPermissao({ permissao, children }: ProtegidoPorPermissaoProps) {
  const permitido = useAuthStore((estado) => possuiAlgumaPermissao(estado.temPermissao, permissao))

  if (!permitido) {
    return null
  }

  return <>{children}</>
}
