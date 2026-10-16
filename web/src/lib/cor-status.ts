/**
 * Cor dirigida por DADO (design-system.md §2.3/§2.4 · parecer T-ds-02).
 *
 * `status_agendamento.cor/cor_borda` e `especialidades.cor` são cadastro
 * editável da clínica. NENHUMA cor vinda de dado entra na UI sem passar por
 * este módulo: validação hex estrita (fail-safe → tom neutro, sem crash) e
 * normalização em OKLCH que garante o padrão suave com AA por construção —
 * mesmo que a clínica cadastre #FF0000.
 */

/** Semente neutra usada como fail-safe do ChipStatus quando a cor do cadastro
 *  é inválida (primitivo --neutro-500; a derivação produz trio suave AA). */
const COR_NEUTRA_FALLBACK = '#837E74'

/** Fail-safe do MarcadorEspecialidade: primitivo --neutro-450 (≥ 3:1 sobre
 *  --superficie e --fundo pela tabela §3) — os clamps de croma do marcador
 *  NÃO se aplicam ao fallback (forçariam cor num valor que deve ser neutro). */
const MARCADOR_NEUTRO_FALLBACK = '#8F8A80'

const HEX_ESTRITO = /^#[0-9A-Fa-f]{6}$/

/** Trio suave derivado para o ChipStatus (§2.3). */
export interface TonsStatus {
  /** Texto e ícone — sempre ≥ 4.5:1 sobre o fundo do chip, por construção */
  texto: string
  /** Fundo suave do chip */
  fundo: string
  /** Borda decorativa (1,3:1 — nunca canal de identificação) */
  borda: string
}

/**
 * Cor concreta para o `<input type="color">` enquanto o texto está inválido.
 *
 * O seletor nativo EXIGE um `#RRGGBB` de verdade — com valor inválido ele cai em
 * preto sem avisar, e a pessoa que está digitando vê a cor saltar sem entender.
 * O literal vive aqui, no módulo de cor (a fronteira do DS, allowlist §8.2), e
 * não solto num componente: o accent da marca tem um dono.
 */
export const COR_DE_RESERVA = '#16695F'

/**
 * Valida cor dinâmica vinda de dado como hex estrito (#RRGGBB).
 * Único caminho de cor dinâmica do design system (parecer §5.3).
 * @param valor - Valor cru do cadastro (qualquer tipo — nunca confiar no upstream)
 * @returns O hex validado, ou null para QUALQUER outra coisa (fail-safe)
 */
export function corHexSegura(valor: unknown): string | null {
  if (typeof valor !== 'string') {
    return null
  }
  // Normalizado em caixa alta: #f59e0b e #F59E0B são a mesma cor (uma entrada
  // de cache só) e a saída dos componentes fica estável
  return HEX_ESTRITO.test(valor) ? valor.toUpperCase() : null
}

interface Oklch {
  l: number
  c: number
  h: number
}

function hexParaRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]
}

function canalParaLinear(canal: number): number {
  return canal <= 0.04045 ? canal / 12.92 : Math.pow((canal + 0.055) / 1.055, 2.4)
}

function canalParaGama(canal: number): number {
  return canal <= 0.0031308 ? canal * 12.92 : 1.055 * Math.pow(canal, 1 / 2.4) - 0.055
}

// Conversão sRGB ↔ OKLab (matrizes de Björn Ottosson, referência do CSS Color 4)
function hexParaOklch(hex: string): Oklch {
  const [r, g, b] = hexParaRgb(hex).map(canalParaLinear) as [number, number, number]

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const lab = {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }

  return {
    l: lab.l,
    c: Math.sqrt(lab.a * lab.a + lab.b * lab.b),
    h: Math.atan2(lab.b, lab.a),
  }
}

function oklchParaHex({ l, c, h }: Oklch): string {
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)

  const l_ = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m_ = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s_ = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3)

  const canais = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
  ]

  const paraByte = (canal: number): string => {
    const limitado = Math.min(1, Math.max(0, canalParaGama(canal)))
    return Math.round(limitado * 255)
      .toString(16)
      .padStart(2, '0')
  }

  return `#${canais.map(paraByte).join('').toUpperCase()}`
}

const cacheStatus = new Map<string, TonsStatus>()
const cacheMarcador = new Map<string, string>()

/**
 * Deriva o trio suave do ChipStatus a partir da cor crua do cadastro (§2.3).
 * Clamps em OKLCH garantem texto ≥ 4.5:1 sobre o fundo do chip por construção.
 * Memoizada por entrada — roda uma vez por status, não por card (§16).
 * @param cor - Hex cru de `status_agendamento.cor` (inválido → tom neutro)
 * @param corBorda - Hex cru de `status_agendamento.cor_borda`; passa pelo MESMO clamp
 * @returns Trio { texto, fundo, borda } pronto para CSS vars/style object
 */
export function derivarTonsStatus(cor: unknown, corBorda?: unknown): TonsStatus {
  const corSegura = corHexSegura(cor) ?? COR_NEUTRA_FALLBACK
  const corBordaSegura = corHexSegura(corBorda ?? null)
  const chave = `${corSegura}|${corBordaSegura ?? ''}`

  const memoizado = cacheStatus.get(chave)
  if (memoizado !== undefined) {
    return memoizado
  }

  const base = hexParaOklch(corSegura)
  const baseBorda = corBordaSegura === null ? base : hexParaOklch(corBordaSegura)

  const tons: TonsStatus = {
    texto: oklchParaHex({ l: 0.4, c: Math.min(base.c, 0.09), h: base.h }),
    fundo: oklchParaHex({ l: 0.965, c: Math.min(base.c * 0.22, 0.026), h: base.h }),
    borda: oklchParaHex({ l: 0.87, c: Math.min(baseBorda.c * 0.55, 0.055), h: baseBorda.h }),
  }

  cacheStatus.set(chave, tons)
  return tons
}

/**
 * Normaliza a cor do MarcadorEspecialidade (§2.4): clamps de luminosidade e
 * croma em OKLCH garantem visibilidade ≥ 3:1 sobre --superficie e --fundo.
 * Memoizada por entrada.
 * @param cor - Hex cru de `especialidades.cor` (inválido → tom neutro)
 * @returns Hex normalizado pronto para CSS var/style object
 */
export function normalizarCorMarcador(cor: unknown): string {
  const corSegura = corHexSegura(cor)
  if (corSegura === null) {
    return MARCADOR_NEUTRO_FALLBACK
  }

  const memoizado = cacheMarcador.get(corSegura)
  if (memoizado !== undefined) {
    return memoizado
  }

  const base = hexParaOklch(corSegura)
  const normalizada = oklchParaHex({
    l: Math.min(0.55, Math.max(0.35, base.l)),
    c: Math.min(0.13, Math.max(0.08, base.c)),
    h: base.h,
  })

  cacheMarcador.set(corSegura, normalizada)
  return normalizada
}
