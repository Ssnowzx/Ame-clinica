/**
 * Aritmética de mês (`YYYY-MM`) como STRING — sem `new Date()`: o fuso do
 * navegador não decide o mês da clínica (o DIA de hoje vem de `hojeNaClinica`;
 * daqui em diante é só contagem de meses).
 */

const NOMES_DOS_MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

const MES_VALIDO = /^(\d{4})-(0[1-9]|1[0-2])$/

/** `'2026-01'` − 1 → `'2025-12'`; formato inesperado sai CRU (idioma de `datas.ts`). */
export function somarMeses(mes: string, delta: number): string {
  const combinacao = MES_VALIDO.exec(mes)
  if (!combinacao) {
    return mes
  }

  const indice = Number(combinacao[1]) * 12 + (Number(combinacao[2]) - 1) + delta
  const ano = Math.floor(indice / 12)
  const numeroDoMes = (indice % 12) + 1

  return `${String(ano).padStart(4, '0')}-${String(numeroDoMes).padStart(2, '0')}`
}

/** `'2026-07'` → `'julho de 2026'`; formato inesperado sai CRU. */
export function rotuloDoMes(mes: string): string {
  const combinacao = MES_VALIDO.exec(mes)
  if (!combinacao) {
    return mes
  }

  return `${NOMES_DOS_MESES[Number(combinacao[2]) - 1]} de ${combinacao[1]}`
}

/** `'2026-07'` → `'jul'` — rótulo curto dos eixos das séries. */
export function rotuloCurtoDoMes(mes: string): string {
  const combinacao = MES_VALIDO.exec(mes)
  if (!combinacao) {
    return mes
  }

  return NOMES_DOS_MESES[Number(combinacao[2]) - 1].slice(0, 3)
}

const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/** `'2026-07'` → `{ de: '2026-07-01', ate: '2026-07-31' }` — período do mês para vistas por `de`/`ate`. */
export function limitesDoMes(mes: string): { de: string; ate: string } {
  const combinacao = MES_VALIDO.exec(mes)
  if (!combinacao) {
    return { de: mes, ate: mes }
  }

  const ano = Number(combinacao[1])
  const numeroDoMes = Number(combinacao[2])
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0
  const dias = numeroDoMes === 2 && bissexto ? 29 : DIAS_POR_MES[numeroDoMes - 1]

  return { de: `${mes}-01`, ate: `${mes}-${String(dias).padStart(2, '0')}` }
}

/** O formato `YYYY-MM` de entrada NÃO confiável (URL) — uma régua só para as telas. */
export function ehMesValido(mes: string): boolean {
  return MES_VALIDO.test(mes)
}
