/**
 * Fronteira do armazenamento local: nada daqui pode derrubar a tela.
 *
 * O `localStorage` é ENTRADA NÃO CONFIÁVEL — o valor é adulterável à mão pelo
 * DevTools, o JSON pode estar truncado, e o próprio acesso lança quando o
 * navegador está em modo privativo, com cota estourada ou com armazenamento de
 * terceiros bloqueado. No balcão isso significaria tela branca no meio do
 * atendimento; aqui significa "o usuário nunca escolheu".
 *
 * É o ÚNICO módulo do produto autorizado a falar com o disco (contrato T-ds-04
 * do design system). A API é fechada dos dois lados: a chave nasce de um id de
 * usuário — nunca de uma string arbitrária que pudesse carregar o nome de um
 * menor — e o valor gravado é peneirado campo a campo.
 */

/** Os painéis recolhíveis — a lista mora AQUI, e só aqui. */
const PAINEIS = ['menu', 'filaAgenda'] as const

export type PainelRecolhivel = (typeof PAINEIS)[number]

/** Preferência de layout de um usuário. `true` = recolhido. */
export type PreferenciaDeLayout = Partial<Record<PainelRecolhivel, boolean>>

/** Uma chave por usuário (o balcão compartilha a máquina), não uma por painel. */
export function chaveDeLayout(usuarioId: number): string {
  return `xiax:layout:${usuarioId}`
}

function ehIdDeUsuario(usuarioId: number): boolean {
  return Number.isInteger(usuarioId) && usuarioId > 0
}

/**
 * Só os booleanos dos painéis conhecidos atravessam — campo a campo, dos DOIS
 * lados da fronteira.
 *
 * Na escrita, é o que impede um `as` de contrabandear dado de paciente para o
 * disco (o tipo sozinho não segura). Na leitura, é o que impede que um campo
 * desconhecido — gravado por uma versão mais nova numa aba aberta ao lado, ou à
 * mão pelo DevTools — faça o objeto INTEIRO ser descartado, apagando as escolhas
 * que estavam lá.
 */
function peneirar(valor: unknown): PreferenciaDeLayout {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return {}

  const limpa: PreferenciaDeLayout = {}
  for (const painel of PAINEIS) {
    const recolhido: unknown = (valor as Record<string, unknown>)[painel]
    if (typeof recolhido === 'boolean') limpa[painel] = recolhido
  }
  return limpa
}

/**
 * Lê a preferência de layout de um usuário. NUNCA lança.
 * @param usuarioId - Id do usuário autenticado
 * @returns A preferência guardada, ou o padrão (tudo expandido) para usuário sem
 *   escolha, armazenamento indisponível, JSON inválido ou valor adulterado
 */
export function lerPreferenciaDeLayout(usuarioId: number): PreferenciaDeLayout {
  if (!ehIdDeUsuario(usuarioId)) return {}

  let bruto: string | null

  try {
    bruto = window.localStorage.getItem(chaveDeLayout(usuarioId))
  } catch {
    return {}
  }

  if (bruto === null) return {}

  try {
    return peneirar(JSON.parse(bruto))
  } catch {
    return {}
  }
}

/**
 * Grava a preferência de layout. NUNCA lança — disco que recusa a escrita deixa
 * a escolha valendo só para a sessão atual, e a tela segue funcionando.
 *
 * A escrita é PENEIRADA. É esse funil que sustenta as outras duas decisões da
 * change — a preferência sobreviver ao logout e não ser criptografada — porque o
 * que está no disco de uma máquina de balcão compartilhada é, comprovadamente,
 * só interface. O tipo sozinho não bastaria: um `as` faria contrabando.
 *
 * @param usuarioId - Id do usuário autenticado
 * @param preferencia - Estado de interface (o que não for layout é descartado)
 */
export function gravarPreferenciaDeLayout(
  usuarioId: number,
  preferencia: PreferenciaDeLayout,
): void {
  if (!ehIdDeUsuario(usuarioId)) return

  try {
    window.localStorage.setItem(chaveDeLayout(usuarioId), JSON.stringify(peneirar(preferencia)))
  } catch {
    // sem espaço, sem permissão, sem armazenamento: a sessão atual mantém a
    // escolha em memória e o próximo acesso volta ao padrão
  }
}

/**
 * Alterna UM painel lendo o disco na hora de gravar.
 *
 * Os painéis dividem a mesma chave e cada um tem sua própria cópia em memória:
 * gravar por cima de um snapshot velho fazia a escolha do outro painel evaporar
 * no recarregamento (o menu apagava a fila, e vice-versa). Ler → alternar →
 * gravar, tudo aqui, mantém o disco como a soma das escolhas.
 *
 * @param usuarioId - Id do usuário autenticado
 * @param painel - Painel a alternar
 * @returns A preferência resultante (já peneirada)
 */
export function alternarPreferenciaDeLayout(
  usuarioId: number,
  painel: PainelRecolhivel,
): PreferenciaDeLayout {
  const noDisco = lerPreferenciaDeLayout(usuarioId)
  const preferencia = peneirar({ ...noDisco, [painel]: noDisco[painel] !== true })

  gravarPreferenciaDeLayout(usuarioId, preferencia)

  return preferencia
}

// ── A recarga por VERSÃO NOVA (change indicadores-profissionais, PERF-12) ─────────────────────
// Depois de um redeploy, a aba aberta ainda pede os pedaços de código da versão VELHA, que o
// servidor já não tem (404). A saída é recarregar a página UMA vez — e o "uma vez" precisa de
// memória que sobreviva à própria recarga: a sessão do navegador (`sessionStorage`), com um
// carimbo de hora e nada mais. Mora aqui porque este é o único módulo que fala com o disco.

const CHAVE_DA_RECARGA = 'xiax:recarga-por-versao-nova'

/**
 * A janela em que uma segunda falha NÃO recarrega de novo: se a página acabou de recarregar e o
 * código ainda não veio, recarregar outra vez seria um laço — a falha é outra (rede, servidor).
 */
export const JANELA_DA_RECARGA_MS = 60_000

/**
 * Marca a recarga agora, se ela pode acontecer. NUNCA lança.
 * @param agora - O relógio (milissegundos), injetável no teste
 * @returns `true` quando a recarga está liberada E ficou marcada; `false` quando já houve uma na
 *   janela, ou quando o armazenamento recusa — sem memória não há como garantir que não vire laço
 */
export function marcarRecargaPorVersaoNova(agora: number = Date.now()): boolean {
  try {
    const anterior = Number(window.sessionStorage.getItem(CHAVE_DA_RECARGA) ?? '0')
    if (Number.isFinite(anterior) && anterior > 0 && agora - anterior < JANELA_DA_RECARGA_MS) {
      return false
    }
    window.sessionStorage.setItem(CHAVE_DA_RECARGA, String(agora))

    return true
  } catch {
    return false
  }
}
