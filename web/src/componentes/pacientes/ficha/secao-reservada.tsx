import { Lock } from 'lucide-react'

import { EstadoVazio } from '@/componentes/ui/estado-vazio'

interface SecaoReservadaProps {
  rotulo: string
  /** motivo/fase vindo do registro de seções (Decisão 2 — indisponibilidade é DADO) */
  motivo: string
}

/**
 * Slot RESERVADO (Decisão 2): a seção cujo domínio/fase ainda não existe não
 * renderiza UI funcional — mostra a indisponibilidade COM o motivo, nunca um
 * controle falso nem uma promessa de tela inexistente ("o botão não promete o
 * que o servidor nega", agora na navegação da ficha).
 */
export function SecaoReservada({ rotulo, motivo }: SecaoReservadaProps) {
  return (
    <EstadoVazio
      icone={<Lock aria-hidden className="size-8" />}
      titulo={`${rotulo} — indisponível`}
      descricao={motivo}
    />
  )
}
