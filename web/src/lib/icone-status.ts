import {
  Ban,
  Bookmark,
  CalendarX,
  Check,
  CircleDashed,
  CircleDot,
  ClipboardCheck,
  Clock,
  Coffee,
  FileCheck,
  RotateCcw,
  Stethoscope,
  UserX,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * Ícone dirigido por DADO (design-system.md §2.3 · parecer T-sag-04) — irmão do
 * `cor-status`: `status_agendamento.tipo` é cadastro editável pela clínica e não
 * entra na UI sem passar por aqui.
 */

// Espelha o CatalogoIconesStatus do backend (a validação da escrita mora lá).
const ICONES_POR_TIPO: Record<string, LucideIcon> = {
  'circle-dot': CircleDot,
  'circle-dashed': CircleDashed,
  clock: Clock,
  check: Check,
  'clipboard-check': ClipboardCheck,
  'user-x': UserX,
  'file-check': FileCheck,
  'calendar-x': CalendarX,
  bookmark: Bookmark,
  stethoscope: Stethoscope,
  'rotate-ccw': RotateCcw,
  ban: Ban,
  coffee: Coffee,
  users: Users,
}

/**
 * Resolve o ícone do status a partir do `tipo` do cadastro.
 * `Object.hasOwn` barra a cadeia de protótipos: `__proto__`/`constructor`
 * devolveriam algo que não é componente e derrubariam a grade inteira.
 * @param tipo - Slug vindo do cadastro (nunca confiar no upstream)
 * @returns Sempre um ícone válido; desconhecido/ausente → neutro
 */
export function iconeSeguro(tipo: unknown): LucideIcon {
  if (typeof tipo !== 'string' || !Object.hasOwn(ICONES_POR_TIPO, tipo)) {
    return CircleDot
  }
  return ICONES_POR_TIPO[tipo]
}
