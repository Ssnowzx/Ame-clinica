import { TriangleAlert } from 'lucide-react'

import type { AvisoDoTelefone } from '@/lib/telefone-whatsapp'

/**
 * O aviso abaixo do campo de telefone (change telefone-que-chega-no-whatsapp, D2). Entra como a
 * `ajuda` do `CampoTexto` — é a DESCRIÇÃO do campo (`aria-describedby`), lida junto do rótulo ao
 * voltar a ele. O alerta tem ícone E texto: a cor nunca é o único sinal (1.4.1).
 */
export function TextoDoTelefone({ aviso }: { aviso: AvisoDoTelefone }) {
  if (!aviso.alerta) {
    return <span>{aviso.texto}</span>
  }

  return (
    <span className="inline-flex items-start gap-1 font-medium text-alerta-texto">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      {aviso.texto}
    </span>
  )
}
