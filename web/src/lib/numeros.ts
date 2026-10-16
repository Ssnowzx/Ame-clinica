/**
 * Contagens em pt-BR — fonte única (`2045` → `2.045`). Dinheiro NÃO passa aqui
 * (dinheiro é string decimal e vive em `lib/dinheiro.ts`); isto é só contagem
 * inteira, onde `Intl` é seguro.
 */
const FORMATO_PT_BR = new Intl.NumberFormat('pt-BR')

export function formatarContagem(total: number): string {
  return Number.isFinite(total) ? FORMATO_PT_BR.format(total) : '0'
}
