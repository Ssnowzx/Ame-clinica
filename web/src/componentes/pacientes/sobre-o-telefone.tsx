import { ExternalLink, TriangleAlert } from 'lucide-react'

import { TextoDoTelefone } from '@/componentes/pacientes/texto-do-telefone'
import { FIM_DO_REPETIDO, INICIO_DO_REPETIDO, type AvisoDoTelefone } from '@/lib/telefone-whatsapp'
import type { TelefoneEmUso } from '@/tipos'

interface SobreOTelefoneProps {
  aviso: AvisoDoTelefone
  /** Os outros pacientes com o mesmo número (tela interna); `null` = nada a dizer */
  repetido?: TelefoneEmUso | null
}

/**
 * Tudo o que o campo de telefone diz abaixo dele (change telefone-que-chega-no-whatsapp): para onde
 * o WhatsApp vai e, na tela interna, se o número também está no cadastro de outro paciente.
 *
 * Entra como a `ajuda` do campo — a DESCRIÇÃO dele. O anúncio em voz é do `CampoDoTelefone`, numa
 * região de status própria. O link para a ficha do outro paciente abre em NOVA ABA (sair daqui no
 * meio de um cadastro perderia o que foi digitado), e diz isso com ícone e com texto para leitor de
 * tela (gate r1, A11Y-TEL-03).
 */
export function SobreOTelefone({ aviso, repetido = null }: SobreOTelefoneProps) {
  return (
    <>
      <TextoDoTelefone aviso={aviso} />
      {repetido !== null && repetido.total > 0 ? (
        // o espaço antes do bloco: a descrição é lida como UM texto, e sem ele as duas frases colavam
        <>
          {' '}
          <span className="mt-1 flex items-start gap-1 text-alerta-texto">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {INICIO_DO_REPETIDO}{' '}
              {repetido.tambem_em.map((outro, indice) => (
                <span key={outro.id}>
                  {indice > 0 ? ', ' : null}
                  <a
                    href={`/pacientes/${String(outro.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2"
                  >
                    {outro.nome}
                    {outro.ativo ? '' : ' (inativo)'}
                    <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                    <span className="sr-only"> (abre em nova aba)</span>
                  </a>
                </span>
              ))}
              {repetido.total > repetido.tambem_em.length
                ? ` e mais ${String(repetido.total - repetido.tambem_em.length)}`
                : ''}
              . {FIM_DO_REPETIDO}
            </span>
          </span>
        </>
      ) : null}
    </>
  )
}
