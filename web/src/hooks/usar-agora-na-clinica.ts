import { useEffect, useState } from 'react'

import { hojeNaClinica, horaAgoraNaClinica } from '@/lib/datas'

export interface AgoraNaClinica {
  /** `AAAA-MM-DD` de hoje na parede da clínica. */
  data: string
  /** `HH:mm` de agora na parede da clínica. */
  hora: string
}

const UM_MINUTO_MS = 60_000

function lerAgora(timezone: string): AgoraNaClinica {
  return { data: hojeNaClinica(timezone), hora: horaAgoraNaClinica(timezone) }
}

/**
 * "Agora" na parede da CLÍNICA (§13), atualizado a cada minuto — o relógio do aparelho, o fuso da
 * clínica. É o que a grade usa para desenhar a linha do agora; nunca `new Date()` cru na tela.
 *
 * Declarado `use*` (a regra `rules-of-hooks` lê o nome declarado) e exportado em pt-BR, como os
 * demais hooks da casa.
 */
function useAgoraNaClinica(timezone: string): AgoraNaClinica {
  const [agora, setAgora] = useState(() => lerAgora(timezone))

  useEffect(() => {
    const id = window.setInterval(() => {
      // mesmo minuto (disparo duplo ao voltar de aba oculta) = mesmo objeto = nenhum render
      setAgora((anterior) => {
        const proximo = lerAgora(timezone)

        return anterior.data === proximo.data && anterior.hora === proximo.hora ? anterior : proximo
      })
    }, UM_MINUTO_MS)

    return () => {
      window.clearInterval(id)
    }
  }, [timezone])

  return agora
}

export { useAgoraNaClinica as usarAgoraNaClinica }
