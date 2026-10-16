import { dataEhValida, diaDaSemana } from '@/lib/grade-agenda'

/**
 * Datas do servidor → texto em pt-BR.
 *
 * **Nenhuma delas passa por `new Date()`.** A string que o servidor manda já é a PAREDE da
 * clínica (§13): o construtor a reinterpretaria no fuso do NAVEGADOR, e a data de um
 * vencimento — ou a hora do prontuário de uma criança — mudaria conforme a máquina que abre
 * a tela. Recortar a string é o cálculo certo, não o preguiçoso.
 */

/** `Y-m-d` (ou `Y-m-d H:i`) → `11/07/2026`. Formato inesperado sai CRU, nunca como `undefined`. */
export function dataLegivel(ymd: string | null): string {
  if (ymd === null || ymd === '') {
    return '—'
  }
  const [ano, mes, dia] = ymd.slice(0, 10).split('-')

  return dia !== undefined ? `${dia}/${mes}/${ano}` : ymd
}

/** `Y-m-d H:i` → `11/07/2026 às 22:13`. */
export function dataHoraLegivel(ymdHi: string | null): string {
  if (ymdHi === null || ymdHi === '') {
    return '—'
  }
  const [, hora = ''] = ymdHi.split(' ')

  return `${dataLegivel(ymdHi)}${hora === '' ? '' : ` às ${hora.slice(0, 5)}`}`
}

/**
 * `Y-m-d H:i` × 2 → `15/10/2026, das 08:40 às 09:20` (change horario-de-termino-no-card). Sem o
 * término (um deploy fora de ordem serve o payload anterior), cai no `dataHoraLegivel` de sempre.
 */
export function dataComHorarioLegivel(inicio: string, fim: string | null | undefined): string {
  if (fim == null || fim === '') {
    return dataHoraLegivel(inicio)
  }

  return `${dataLegivel(inicio)}, das ${inicio.slice(11, 16)} às ${fim.slice(11, 16)}`
}

/** O fuso da clínica quando a configuração ainda não chegou (ou veio inválida). */
export const TIMEZONE_PADRAO = 'America/Sao_Paulo'

/**
 * HOJE na PAREDE DA CLÍNICA, como `Y-m-d` — nunca "hoje no relógio de quem abriu a tela".
 *
 * Esta é a única função deste módulo que precisa de `new Date()`: ela responde "que dia é
 * agora", e isso é um INSTANTE. O que ela NÃO faz é deixar o navegador decidir em que DIA esse
 * instante cai — quem decide é o fuso da clínica (`clinica.timezone`, §13).
 *
 * **Por que isso importa, e muito:** em Brasília (UTC−3), `new Date().toISOString().slice(0, 10)`
 * — o atalho mais natural do mundo — a partir das 21h já devolve **o dia seguinte**. A agenda
 * abriria em amanhã, a recepção marcaria no dia errado, e de manhã o defeito some. O mesmo vale
 * para uma máquina configurada com o fuso de outro país. Preso por `datas.test.ts`, com relógio
 * hostil.
 *
 * `Intl` LANÇA com fuso inválido, e um throw em render deixaria a agenda em branco para a clínica
 * inteiro (SEC-R2) — daí o fallback.
 */
export function hojeNaClinica(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE_PADRAO }).format(new Date())
  }
}

/**
 * "HH:mm" AGORA na parede da CLÍNICA (§13) — relógio do aparelho, fuso da clínica.
 * Mesmo contrato de falha do `hojeNaClinica`: fuso inválido cai no padrão, nunca lança.
 */
export function horaAgoraNaClinica(timezone: string): string {
  const opcoes: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false }
  try {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, ...opcoes }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE_PADRAO, ...opcoes }).format(new Date())
  }
}

/** Dias da semana em ISO (1=segunda..7=domingo), na ordem de leitura da clínica. */
export const DIAS_DA_SEMANA: ReadonlyArray<{ valor: number; rotulo: string }> = [
  { valor: 1, rotulo: 'Segunda' },
  { valor: 2, rotulo: 'Terça' },
  { valor: 3, rotulo: 'Quarta' },
  { valor: 4, rotulo: 'Quinta' },
  { valor: 5, rotulo: 'Sexta' },
  { valor: 6, rotulo: 'Sábado' },
  { valor: 7, rotulo: 'Domingo' },
]

/** Nomes dos meses em pt-BR, índice 0 = janeiro (o calendário do `SeletorDeData` os lista). */
export const NOMES_DOS_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const

/** Índice de `getUTCDay` (0=domingo..6=sábado) — diferente do ISO de `DIAS_DA_SEMANA` acima. */
const DIAS_POR_EXTENSO = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado',
] as const

function partesLegiveis(ymd: string): { ano: number; mes: string; dia: string } {
  const [ano = 0, mes = 1, dia = 1] = ymd.split('-').map(Number)

  // "1º de fevereiro", nunca "1 de fevereiro" (convenção pt-BR; design-qa DQ-09)
  return { ano, mes: NOMES_DOS_MESES[mes - 1] ?? '', dia: dia === 1 ? '1º' : String(dia) }
}

/**
 * O período da agenda em PALAVRAS, para o título da tela:
 * - um dia: `2026-02-09` → `segunda-feira, 9 de fevereiro de 2026`;
 * - intervalo: `9 a 15 de fevereiro de 2026`; cruzando mês, `26 de janeiro a 1º de fevereiro
 *   de 2026`; cruzando ano, cada ponta com o próprio ano. O primeiro dia é `1º`.
 * O dia da semana vem de `diaDaSemana` (aritmética em UTC — o fuso do navegador não entra).
 * Data fora do calendário → `null`, e quem chama não pinta nada.
 */
export function periodoEmPalavras(de: string, ate: string = de): string | null {
  if (!dataEhValida(de) || !dataEhValida(ate)) {
    return null
  }
  const inicio = partesLegiveis(de)
  const fim = partesLegiveis(ate)

  if (de === ate) {
    return `${DIAS_POR_EXTENSO[diaDaSemana(de)]}, ${inicio.dia} de ${inicio.mes} de ${inicio.ano}`
  }
  if (inicio.ano !== fim.ano) {
    return `${inicio.dia} de ${inicio.mes} de ${inicio.ano} a ${fim.dia} de ${fim.mes} de ${fim.ano}`
  }
  if (inicio.mes !== fim.mes) {
    return `${inicio.dia} de ${inicio.mes} a ${fim.dia} de ${fim.mes} de ${fim.ano}`
  }

  return `${inicio.dia} a ${fim.dia} de ${fim.mes} de ${fim.ano}`
}
