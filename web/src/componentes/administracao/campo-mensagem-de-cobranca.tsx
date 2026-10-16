import { useId } from 'react'

import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'
import {
  MARCAS_DA_COBRANCA,
  preencherMensagemDeCobranca,
  TETO_DA_MENSAGEM_DE_COBRANCA,
} from '@/lib/cobranca-pelo-whatsapp'
import { useAuthStore } from '@/stores/auth-store'

/** A recusa que a tela antecipa: o servidor também recusa o texto vazio. */
export const MENSAGEM_DE_COBRANCA_VAZIA = 'Escreva a mensagem: ela não pode ficar vazia.'

/** Como as marcas se leem — a mesma lista que a prévia preenche. */
export const AJUDA_DAS_MARCAS = `Use ${MARCAS_DA_COBRANCA.map(({ marca, significado }) => `${marca} (${significado})`).join(', ')}. O sistema troca cada marca pelos dados do lançamento, e quem cobra ainda revisa o texto no WhatsApp antes de enviar.`

/**
 * Os dados da PRÉVIA — de exemplo, nenhum de paciente. O nome da clínica é o dela mesma (não é
 * dado pessoal), com o mesmo substituto do servidor quando ela ainda não tem nome.
 */
const EXEMPLO = {
  '{responsavel}': 'Juliana',
  '{crianca}': 'Pedro',
  '{valor}': 'R$ 450,00',
  '{vencimento}': '10/10/2026',
} as const

export interface CampoMensagemDeCobrancaProps {
  rotulo: string
  valor: string
  aoMudar: (valor: string) => void
  erro?: string
  desabilitado: boolean
}

/**
 * A mensagem de cobrança pelo WhatsApp (`financeiro.mensagem_cobranca`, change
 * `cobranca-pelo-whatsapp`): o texto da clínica, com a PRÉVIA de como ele chega à família. A
 * prévia troca as marcas conhecidas por dados de exemplo e deixa qualquer outra coisa entre chaves
 * como está — é assim que `{paciente}` aparece cru ali antes de o servidor recusá-lo ao salvar.
 */
export function CampoMensagemDeCobranca({ rotulo, valor, aoMudar, erro, desabilitado }: CampoMensagemDeCobrancaProps) {
  const idPrevia = useId()
  const nomeDaClinica = useAuthStore((estado) => estado.usuario?.marca.nome ?? '')
  const previa = preencherMensagemDeCobranca(valor, {
    ...EXEMPLO,
    '{clinica}': nomeDaClinica.trim() === '' ? 'clínica' : nomeDaClinica,
  })

  return (
    <div className="flex flex-col gap-3">
      <CampoTextoLongo
        rotulo={rotulo}
        value={valor}
        limite={TETO_DA_MENSAGEM_DE_COBRANCA}
        linhas={4}
        ajuda={AJUDA_DAS_MARCAS}
        erro={erro}
        disabled={desabilitado}
        onChange={(evento) => {
          aoMudar(evento.target.value)
        }}
      />
      <section aria-labelledby={idPrevia} className="flex flex-col gap-1.5">
        <h4 id={idPrevia} className="text-rotulo font-medium text-texto">
          Prévia com dados de exemplo
        </h4>
        <p className="whitespace-pre-wrap break-words rounded-campo border border-linha bg-fundo p-3 text-corpo text-texto">
          {previa.trim() === '' ? 'A prévia aparece quando houver texto.' : previa}
        </p>
      </section>
    </div>
  )
}
