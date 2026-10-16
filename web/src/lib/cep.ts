import { digitosDaMascara } from '@/lib/mascara'

/**
 * O CEP como formato — a mesma escolha que `data-brasileira.ts` fez para a data
 * (change `cep-preenche-o-endereco`).
 *
 * O que o formulário guarda são os **oito dígitos**, sem o hífen; a tela mostra formatado. Colar
 * `88501-050` tem de funcionar: é assim que o CEP aparece em conta de luz, em site de loja e no
 * WhatsApp da família — recusar o formato mais comum de todos seria máscara brigando com quem
 * digita.
 */

/** O formato para `aplicarMascara`. */
export const FORMATO_DO_CEP = '00000-000'

/** Quantos dígitos tem um CEP completo. */
export const DIGITOS_DO_CEP = 8

/** Os dígitos de um CEP, venha ele digitado, colado com hífen ou vindo do banco. */
export function digitosDoCep(valor: string): string {
  return digitosDaMascara(FORMATO_DO_CEP, valor)
}

/** O CEP está completo o bastante para consultar? */
export function cepCompleto(valor: string): boolean {
  return digitosDoCep(valor).length === DIGITOS_DO_CEP
}
