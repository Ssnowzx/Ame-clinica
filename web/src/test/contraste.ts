/**
 * Razão de contraste WCAG 2.x calculada sem dependência (design.md D1).
 * Usada pelos testes de contrato dos tokens e do cor-status.
 */

function luminanciaRelativa(hex: string): number {
  const canais = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((par) => {
    const canal = parseInt(par, 16) / 255
    return canal <= 0.04045 ? canal / 12.92 : Math.pow((canal + 0.055) / 1.055, 2.4)
  })
  const [r, g, b] = canais as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Calcula a razão de contraste WCAG entre duas cores hex (#RRGGBB).
 * @param corA - Primeira cor (ordem não importa)
 * @param corB - Segunda cor
 * @returns Razão no intervalo [1, 21] (ex.: 4.5 = piso AA para texto)
 */
export function razaoContraste(corA: string, corB: string): number {
  const luminancias = [luminanciaRelativa(corA), luminanciaRelativa(corB)]
  const clara = Math.max(...luminancias)
  const escura = Math.min(...luminancias)
  return (clara + 0.05) / (escura + 0.05)
}
