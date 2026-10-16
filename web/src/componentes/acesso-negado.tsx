import { ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { possuiAlgumaPermissao } from '@/lib/permissoes'
import { useAuthStore } from '@/stores/auth-store'

interface ExigePermissaoProps {
  /** Uma permissão, ou uma lista — basta ter QUALQUER uma (o índice de cadastros) */
  permissao: string | readonly string[]
  children: ReactNode
}

/**
 * Guard de ROTA: sem a permissão, a tela mostra acesso negado em vez de
 * disparar consultas que voltariam 403. É experiência — a fronteira real de
 * autorização continua no servidor (o endpoint barra a URL digitada à mão).
 */
export function ExigePermissao({ permissao, children }: ExigePermissaoProps) {
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const permitido = possuiAlgumaPermissao(temPermissao, permissao)

  if (!permitido) {
    return (
      <div className="p-8">
        <EstadoVazio
          titulo="Você não tem acesso a esta tela"
          descricao="Peça ao administrador da clínica a permissão necessária para este módulo."
          icone={<ShieldAlert className="size-8" />}
        />
      </div>
    )
  }

  return <>{children}</>
}
