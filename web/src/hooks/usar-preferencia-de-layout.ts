import { useState } from 'react'

import {
  alternarPreferenciaDeLayout,
  lerPreferenciaDeLayout,
  type PainelRecolhivel,
  type PreferenciaDeLayout,
} from '@/lib/preferencias-locais'
import { useAuthStore } from '@/stores/auth-store'

interface EstadoDoLayout {
  usuarioId: number | null
  preferencia: PreferenciaDeLayout
}

function carregar(usuarioId: number | null): EstadoDoLayout {
  return {
    usuarioId,
    // sem usuário não existe "layout do ninguém": padrão em memória, sem ler
    // nem gravar sob chave anônima
    preferencia: usuarioId === null ? {} : lerPreferenciaDeLayout(usuarioId),
  }
}

/**
 * Recolher/expandir um painel, com a escolha guardada POR USUÁRIO.
 *
 * O balcão compartilha o computador: a recepcionista que recolheu o menu não
 * pode recolher o menu da colega. E a SPA não recarrega entre um logout e o
 * login seguinte — por isso a preferência é relida quando o usuário muda, ainda
 * durante o render, e não uma vez só na montagem.
 *
 * A leitura inicial é SÍNCRONA (nada de `useEffect`, que pintaria o painel
 * aberto e o recolheria depois, piscando na cara da recepção).
 *
 * @param painel - Qual painel esta instância governa
 * @returns `[recolhido, alternar]`
 */
function usePreferenciaDeLayout(painel: PainelRecolhivel): [boolean, () => void] {
  const usuarioId = useAuthStore((estado) => estado.usuario?.id ?? null)
  const [estado, setEstado] = useState<EstadoDoLayout>(() => carregar(usuarioId))

  // troca de usuário na MESMA aba (a SPA não recarrega): a preferência da colega
  // não sobrevive à troca, e o toggle de quem entrou não escreve na chave de quem saiu
  const atual = estado.usuarioId === usuarioId ? estado : carregar(usuarioId)
  if (atual !== estado) setEstado(atual)

  const recolhido = atual.preferencia[painel] === true

  // o disco é tocado AQUI, no evento — nunca dentro do updater do `setState`,
  // que o StrictMode invoca duas vezes (e o segundo alternar desfaria o primeiro)
  function alternar(): void {
    if (atual.usuarioId === null) {
      setEstado({ ...atual, preferencia: { ...atual.preferencia, [painel]: !recolhido } })
      return
    }

    setEstado({
      usuarioId: atual.usuarioId,
      preferencia: alternarPreferenciaDeLayout(atual.usuarioId, painel),
    })
  }

  return [recolhido, alternar]
}

export { usePreferenciaDeLayout as usarPreferenciaDeLayout }
