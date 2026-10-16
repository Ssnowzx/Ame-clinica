import { dataEhValida } from '@/lib/grade-agenda'

/**
 * A data como o balcão DIGITA (`dd/mm/aaaa`) ↔ como o servidor fala (`AAAA-MM-DD`).
 * Funções puras do `SeletorDeData`, fora do arquivo do componente para o Fast Refresh.
 */

/** Só dígitos entram; as barras são postas pela máscara: `1407202` → `14/07/202`. */
export function mascararData(bruto: string): string {
  const digitos = bruto.replace(/\D/g, '').slice(0, 8)
  const partes = [digitos.slice(0, 2), digitos.slice(2, 4), digitos.slice(4, 8)]

  return partes.filter((parte, indice) => indice === 0 || parte !== '').join('/')
}

/** `dd/mm/aaaa` → `aaaa-mm-dd` de calendário REAL (30/02 não passa), ou `null`. */
export function isoDeTextoDigitado(texto: string): string | null {
  const achado = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto)
  if (achado === null) {
    return null
  }
  const iso = `${achado[3]}-${achado[2]}-${achado[1]}`

  return dataEhValida(iso) ? iso : null
}
