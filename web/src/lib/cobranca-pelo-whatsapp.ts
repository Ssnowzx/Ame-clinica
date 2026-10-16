import { aplicarMascara } from '@/lib/mascara'
import type { InteressadoDoLancamento, LancamentoCaixa, UltimaCobranca } from '@/tipos'

/**
 * Cobrar pelo WhatsApp (change `cobranca-pelo-whatsapp`) — o que a TELA decide. A mensagem de
 * verdade e o telefone são do servidor (D1); aqui mora só a prévia da configuração, o link de
 * conversa e o que cabe exibir.
 */

/**
 * As marcas que o servidor preenche (`MensagemDeCobranca::MARCAS`). Servem à PRÉVIA da
 * configuração e à legenda do campo; quem recusa marca desconhecida é o servidor, nomeando-a.
 */
export const MARCAS_DA_COBRANCA = [
  { marca: '{responsavel}', significado: 'o nome do responsável' },
  { marca: '{crianca}', significado: 'o nome da criança' },
  { marca: '{valor}', significado: 'o valor em reais' },
  { marca: '{vencimento}', significado: 'a data de vencimento' },
  { marca: '{clinica}', significado: 'o nome da clínica' },
] as const

type MarcaDaCobranca = (typeof MARCAS_DA_COBRANCA)[number]['marca']

/** O teto do texto (`MensagemDeCobranca::TETO`) — o mesmo número que o servidor recusa acima. */
export const TETO_DA_MENSAGEM_DE_COBRANCA = 1000

/**
 * A troca das marcas pelos valores, na régua do servidor (`strtr`): a marca conhecida vira o
 * valor, e qualquer outra coisa entre chaves fica como está — é assim que a prévia mostra
 * `{paciente}` cru, do jeito que a família o leria se o servidor deixasse passar.
 */
export function preencherMensagemDeCobranca(texto: string, valores: Readonly<Record<MarcaDaCobranca, string>>): string {
  return texto.replace(/\{[^{}]*\}/g, (marca) =>
    Object.hasOwn(valores, marca) ? valores[marca as MarcaDaCobranca] : marca,
  )
}

/**
 * O link de conversa do WhatsApp: abre o aplicativo (ou o WhatsApp Web) na conversa com o número,
 * com a mensagem escrita. O número já vem do servidor no formato do link (DDI 55, só dígitos).
 */
export function linkDoWhatsapp(telefone: string, mensagem: string): string {
  return `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`
}

/**
 * `5549998765432` → `+55 (49) 99876-5432`; o número de outro país (change telefone-estrangeiro) sai
 * com o `+` e sem máscara (`447700900123` → `+447700900123`), porque um celular do Reino Unido também
 * tem 12 dígitos e ganhava a máscara do Brasil. Fora do formato conhecido, sai como veio.
 */
export function telefoneLegivel(telefone: string): string {
  if (!telefone.startsWith('55')) {
    return /^[1-9]\d{7,14}$/.test(telefone) ? `+${telefone}` : telefone
  }
  if (telefone.length === 13) {
    return aplicarMascara('+00 (00) 00000-0000', telefone)
  }
  if (telefone.length === 12) {
    return aplicarMascara('+00 (00) 0000-0000', telefone)
  }

  return telefone
}

/** "Cobrança aberta em 24/09 por Fulana" — nunca "enviada": o sistema sabe que a conversa abriu. */
export function fraseDaUltimaCobranca(ultima: UltimaCobranca): string {
  const [ano, mes, dia] = ultima.em.slice(0, 10).split('-')
  const quando = dia === undefined || ano === undefined ? ultima.em : `${dia}/${mes}`

  return ultima.por === null ? `Cobrança aberta em ${quando}` : `Cobrança aberta em ${quando} por ${ultima.por}`
}

/** O que identifica UMA cobrança na tela: o lançamento, com a criança interessada. */
export type LancamentoCobravel = Pick<LancamentoCaixa, 'id' | 'liquido' | 'vencimento'> & {
  interessado: InteressadoDoLancamento & { tipo: 'paciente' }
}

/**
 * Só receita EM ABERTO de criança se cobra — a mesma régua que o servidor aplica com `422`. A
 * tela esconde a ação do resto para não oferecer o que vai ser recusado.
 */
export function ehCobravel(lancamento: LancamentoCaixa): lancamento is LancamentoCaixa & LancamentoCobravel {
  return lancamento.tipo === 'receita' && lancamento.pago_em === null && lancamento.interessado?.tipo === 'paciente'
}

/** As duas permissões da cobrança, em E: o telefone é contato do cadastro da criança. */
export const PERMISSOES_DA_COBRANCA = ['lancamentos.ver', 'pacientes.ver'] as const
