/**
 * Os temas de cor que o design system CONHECE (change tema-da-clinica). Cada um tem a paleta
 * curada num bloco `[data-tema="…"]` do `index.css`, com contraste AA conferido pela guarda
 * `tema-da-clinica.contrato.test.ts`. O Padrão não está na lista: no `<html>` ele é a ausência do
 * atributo.
 */
export const TEMAS_DA_CLINICA = ['menta', 'xclinicas'] as const

export type TemaDaClinica = (typeof TEMAS_DA_CLINICA)[number]

/** Só tema conhecido vira atributo: valor estranho (deploy fora de ordem, chave nova) cai no Padrão. */
export function temaConhecido(tema: string | null | undefined): TemaDaClinica | null {
  return TEMAS_DA_CLINICA.find((conhecido) => conhecido === tema) ?? null
}

/** O que cada tema promete, em uma linha — o nome sozinho não diz que cor vem. */
const DESCRICAO_DO_TEMA: Record<string, string> = {
  padrao: 'As cores do sistema',
  menta: 'Menta e rosa, com fonte arredondada',
  xclinicas: 'Ameixa e rosé da marca, com títulos em serifa',
}

export function descricaoDoTema(tema: string): string {
  return DESCRICAO_DO_TEMA[tema] ?? ''
}
