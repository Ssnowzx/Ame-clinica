/**
 * Utilitários da anamnese partilhados pelo formulário e pelo leitor.
 *
 * Espelham o `ValidadorRespostasAnamnese` do servidor: o teto de texto por campo e
 * a leitura de um valor cru (booleano vira palavra — cor nunca é o único canal).
 */

/** Teto de texto por campo — igual ao `ValidadorRespostasAnamnese::TETO_TEXTO`. */
export const TETO_TEXTO_ANAMNESE = 2000

/**
 * Texto legível de um valor de resposta cujo TIPO se perdeu (órfã / degradação de
 * rótulo). Booleano vira "Sim"/"Não"; o resto vira sua forma de string. Nunca
 * devolve `undefined` — corpo em branco esconderia resposta de saúde de menor.
 */
export function valorCruLegivel(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') {
    return '—'
  }
  if (typeof valor === 'boolean') {
    return valor ? 'Sim' : 'Não'
  }
  return String(valor)
}
