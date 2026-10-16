import { dataLegivel } from '@/lib/datas'
import { formatarBRL, formatarPercentual } from '@/lib/dinheiro'
import type { TipoDeColuna, ValorDeCelula } from '@/tipos'

/**
 * A célula pelo `tipo` da coluna (design D2) — a tela só FORMATA:
 * dinheiro pela função de moeda da casa (string decimal, sem `Number`), data em
 * dd/mm/aaaa, hora em HH:MM, percentual com `%`. Vazio é o marcador de ausência, nunca
 * a palavra `null` (contrato "valor ausente não vira texto").
 */

const DECIMAL = /^[+-]?\d+(\.\d+)?$/
const FORMATO_NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

function formatarNumero(valor: string | number): string {
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? FORMATO_NUMERO.format(valor) : '—'
  }
  // string numérica ("12" ou "12.5") — formato inesperado sai CRU (idioma de `datas.ts`)
  return DECIMAL.test(valor.trim()) ? FORMATO_NUMERO.format(Number(valor)) : valor
}

export function formatarCelula(valor: ValorDeCelula, tipo: TipoDeColuna): string {
  if (valor === null || valor === '') {
    return '—'
  }
  switch (tipo) {
    case 'dinheiro':
      return formatarBRL(String(valor))
    case 'data':
      return dataLegivel(String(valor))
    case 'hora':
      return String(valor).slice(0, 5)
    case 'percentual':
      return typeof valor === 'number' ? `${formatarNumero(valor)}%` : formatarPercentual(valor)
    case 'numero':
      return formatarNumero(valor)
    case 'texto':
      return String(valor)
  }
}

/** Colunas de número, dinheiro e percentual alinham à direita (`Tabela.Celula numerica`). */
export function ehColunaNumerica(tipo: TipoDeColuna): boolean {
  return tipo === 'numero' || tipo === 'dinheiro' || tipo === 'percentual'
}
