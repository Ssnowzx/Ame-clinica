/**
 * Minutos → "37h40" (horas e minutos, sem casas decimais).
 *
 * A produtividade fala em HORAS porque é assim que a clínica pensa a grade ("ela atende
 * 20 horas por semana"); mas a conta é em minutos inteiros, e "37,67 h" ninguém confere
 * de cabeça. Zero sai como "0h" — é um valor (a grade não tem esse dia), não ausência.
 */
export function formatarMinutosEmHoras(minutos: number): string {
  const inteiros = Math.max(0, Math.round(minutos))
  const horas = Math.floor(inteiros / 60)
  const resto = inteiros % 60

  return resto === 0 ? `${String(horas)}h` : `${String(horas)}h${String(resto).padStart(2, '0')}`
}
