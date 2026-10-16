import type { HorariosPorDia, IntervaloDeAtendimento } from '@/tipos'

/** Os horários COMO O FORMULÁRIO os edita: dia (número 1..7) → lista de intervalos. */
export type FormHorarios = Record<number, IntervaloDeAtendimento[]>

/** Dias da semana em ordem ISO, para as linhas do editor. */
export const DIAS_SEMANA_HORARIOS: ReadonlyArray<{ valor: number; rotulo: string }> = [
  { valor: 1, rotulo: 'Segunda' },
  { valor: 2, rotulo: 'Terça' },
  { valor: 3, rotulo: 'Quarta' },
  { valor: 4, rotulo: 'Quinta' },
  { valor: 5, rotulo: 'Sexta' },
  { valor: 6, rotulo: 'Sábado' },
  { valor: 7, rotulo: 'Domingo' },
]

/** Teto de intervalos por dia (espelha o servidor). */
export const MAX_INTERVALOS_DIA = 10

const DIAS_ABREV = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

/**
 * Resumo compacto dos horários para listas e fichas: dias atendidos + o span geral, com "turnos"
 * quando há intervalo partido em algum dia. Vazio/ausente = "Todos os dias" (janela padrão).
 */
export function resumoDeHorarios(horarios: HorariosPorDia | undefined): string {
  if (horarios === undefined || Object.keys(horarios).length === 0) {
    return 'Todos os dias'
  }
  const dias = Object.keys(horarios)
    .map(Number)
    .filter((dia) => (horarios[String(dia)]?.length ?? 0) > 0)
    .sort((a, b) => a - b)
  if (dias.length === 0) {
    return 'Todos os dias'
  }
  const rotuloDias =
    dias.length === 5 && dias.every((dia, indice) => dia === indice + 1)
      ? 'Seg–Sex'
      : dias.map((dia) => DIAS_ABREV[dia]).join(', ')
  const intervalos = dias.flatMap((dia) => horarios[String(dia)] ?? [])
  const inicio = [...intervalos.map((item) => item.inicio)].sort()[0]
  const fim = [...intervalos.map((item) => item.fim)].sort().at(-1)
  const temTurnos = dias.some((dia) => (horarios[String(dia)]?.length ?? 0) > 1)
  return `${rotuloDias} · ${inicio}–${fim}${temTurnos ? ' · turnos' : ''}`
}

/** Um intervalo em branco (o ponto de partida ao marcar um dia / adicionar). */
export function intervaloNovo(): IntervaloDeAtendimento {
  return { inicio: '08:00', fim: '12:00' }
}

/** Mapa da API (chaves "1".."7") → estado do form (chaves número). */
export function mapaParaForm(mapa?: HorariosPorDia): FormHorarios {
  const form: FormHorarios = {}
  for (const [dia, intervalos] of Object.entries(mapa ?? {})) {
    form[Number(dia)] = intervalos.map((intervalo) => ({ inicio: intervalo.inicio, fim: intervalo.fim }))
  }
  return form
}

/** Estado do form → mapa da API. Só dias COM intervalo entram; vazio ⇒ `{}` (todos os dias). */
export function formParaMapa(form: FormHorarios): HorariosPorDia {
  const mapa: HorariosPorDia = {}
  for (const [dia, intervalos] of Object.entries(form)) {
    if (intervalos.length > 0) {
      mapa[String(dia)] = intervalos.map((intervalo) => ({ inicio: intervalo.inicio, fim: intervalo.fim }))
    }
  }
  return mapa
}

/** "HH:MM" → minutos, ou null se malformado. */
function emMinutos(hora: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hora)
  return m === null ? null : Number(m[1]) * 60 + Number(m[2])
}

/**
 * Validação de CLIENTE espelhando o servidor: início<fim e sem sobreposição no mesmo dia. Retorna
 * erros por chave `${dia}.${indice}.fim` (invertido) / `${dia}.${indice}.inicio` (sobreposto) —
 * a mesma forma indexada do servidor, para a tela ancorar no intervalo certo.
 */
export function validarHorarios(form: FormHorarios): Map<string, string> {
  const erros = new Map<string, string>()

  for (const [dia, intervalos] of Object.entries(form)) {
    const ordenados: Array<{ inicio: number; fim: number; indice: number }> = []
    intervalos.forEach((intervalo, indice) => {
      const inicio = emMinutos(intervalo.inicio)
      const fim = emMinutos(intervalo.fim)
      if (inicio === null || fim === null) {
        return // o input `type=time` já barra o formato
      }
      if (inicio >= fim) {
        erros.set(`${dia}.${indice}.fim`, 'O fim deve ser depois do início.')
        return
      }
      ordenados.push({ inicio, fim, indice })
    })

    ordenados.sort((a, b) => a.inicio - b.inicio)
    for (let k = 1; k < ordenados.length; k++) {
      if (ordenados[k].inicio < ordenados[k - 1].fim) {
        erros.set(`${dia}.${ordenados[k].indice}.inicio`, 'Os intervalos de um mesmo dia não podem se sobrepor.')
      }
    }
  }

  return erros
}
