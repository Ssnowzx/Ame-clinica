import { useEffect, useState } from 'react'

import { cn } from '@/lib/cn'

/**
 * O relógio da janela de 24h da Meta (change mensageria-whatsapp).
 *
 * Fora dessa janela a Meta só aceita template aprovado — e é por isso que ele fica VISÍVEL
 * em vez de a recepção descobrir pelo erro: quem vê "faltam 40 min" escreve agora.
 *
 * O relógio corre no cliente, mas ele NÃO decide nada: quem recusa o texto livre é o
 * servidor, que não depende de um contador que pode estar atrasado.
 */
export function RelogioDaJanela({
  expiraEm,
  aberta,
  desconectado = false,
}: {
  expiraEm: string | null
  aberta: boolean
  /** Sem canal, o relógio CALA: anunciar "resta 39 min para responder" seria mentira. */
  desconectado?: boolean
}) {
  const [agora, setAgora] = useState(() => Date.now())

  useEffect(() => {
    if (!aberta) return
    // de minuto em minuto: o que importa é a ORDEM DE GRANDEZA que resta, não o segundo
    const intervalo = window.setInterval(() => setAgora(Date.now()), 60_000)
    return () => window.clearInterval(intervalo)
  }, [aberta])

  if (desconectado) {
    return (
      <p className="text-meta font-medium text-alerta-texto">
        Enquanto o WhatsApp não estiver conectado, nada pode ser enviado.
      </p>
    )
  }

  if (expiraEm === null) {
    return (
      <p className="text-meta text-texto-suave">
        Esta família ainda não escreveu. Só é possível iniciar a conversa por template aprovado.
      </p>
    )
  }

  if (!aberta) {
    return (
      <p className="text-meta font-medium text-alerta-texto">
        Janela de 24&nbsp;h encerrada — para retomar o contato, envie um template aprovado.
      </p>
    )
  }

  const minutos = Math.max(0, Math.floor((new Date(expiraEm).getTime() - agora) / 60_000))
  const horas = Math.floor(minutos / 60)
  const restante = horas > 0 ? `${horas} h ${minutos % 60} min` : `${minutos} min`

  return (
    <p className={cn('text-meta', minutos <= 60 ? 'font-medium text-alerta-texto' : 'text-texto-suave')}>
      Janela aberta — resta {restante} para responder livremente.
    </p>
  )
}
