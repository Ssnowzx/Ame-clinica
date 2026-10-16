import { limitesDoMes, rotuloDoMes } from '@/lib/meses'
import { formatarBRL } from '@/lib/dinheiro'
import { formatarContagem } from '@/lib/numeros'
import type {
  BaseDoPainel,
  PainelDaAgenda,
  PainelDaEquipe,
  PainelDoDinheiro,
  PainelDosPacientes,
  ParDoPainel,
  PeriodoDoDia,
  PeriodoDoPainel,
} from '@/tipos'

/**
 * As FRASES dos indicadores (change indicadores-profissionais, D5): número → frase em pt-BR, por
 * REGRA. Nada de texto livre do servidor nem de IA: o servidor manda números, e cada frase aqui é
 * uma função pura com teste por tabela de casos.
 *
 * Moeda, porcentagem e plural passam por um helper ÚNICO cada — é o que impede o mesmo número de
 * sair "R$ 7.560" num cartão e "R$ 7.560,60" na frase ao lado.
 *
 * Uma frase é uma lista de TRECHOS, e o trecho em destaque vira negrito na tela: a frase do cartão lê
 * como texto corrido, com os números saltando, sem que a regra precise saber de JSX.
 */

export interface Trecho {
  texto: string
  destaque?: boolean
}

export type Frase = readonly Trecho[]

function t(texto: string): Trecho {
  return { texto }
}

function d(texto: string): Trecho {
  return { texto, destaque: true }
}

// ── Os helpers únicos ────────────────────────────────────────────────────────────────────────

/** `n` com o substantivo concordando: `1 sessão`, `2 sessões`, `1.024 sessões`. */
export function plural(n: number, singular: string, plurais: string): string {
  return `${formatarContagem(n)} ${n === 1 ? singular : plurais}`
}

/** A forma de dinheiro decimal (`"7560.60"`), igual à de `lib/dinheiro.ts`. */
const DECIMAL = /^[+-]?\d+(\.\d+)?$/

/** Centavos inteiros de uma string decimal — o que não tem forma de dinheiro vale zero. */
function centavos(valor: string): bigint {
  const texto = String(valor ?? '').trim()
  if (!DECIMAL.test(texto)) {
    return 0n
  }
  const negativo = texto.startsWith('-')
  const [inteiro = '0', decimal = ''] = texto.replace(/^[+-]/, '').split('.')
  const total = BigInt(inteiro) * 100n + BigInt(`${decimal}00`.slice(0, 2))

  return negativo ? -total : total
}

/**
 * Dinheiro do indicador: o BRL exato, sem o `,00` quando não há centavos (`R$ 21.300`,
 * `R$ 7.560,60`). Exato de propósito — a casa não arredonda dinheiro em tela que vai ao papel —, e
 * sem o `,00` porque, num número de manchete, ele é só ruído.
 */
export function formatarMoeda(valor: string): string {
  const formatado = formatarBRL(valor)

  return formatado.endsWith(',00') ? formatado.slice(0, -3) : formatado
}

/**
 * Dinheiro COMPACTO, só para rótulo de gráfico (`R$ 14,5 mil`). Arredondado em centavos inteiros,
 * nunca em ponto flutuante: o rótulo é aproximado por desenho, mas a conta não inventa centavo.
 * `semSimbolo` tira o `R$` quando o subtítulo do gráfico já diz "em reais" — numa coluna de 44px
 * do celular, `R$ 14,5 mil` virava três linhas.
 */
export function formatarMoedaCompacta(valor: string, { semSimbolo = false }: { semSimbolo?: boolean } = {}): string {
  if (semSimbolo) {
    return formatarMoedaCompacta(valor).replace('R$ ', '')
  }
  const total = centavos(valor)
  const negativo = total < 0n
  const absoluto = negativo ? -total : total
  const sinal = negativo ? '-' : ''

  if (absoluto < 100_000n) {
    return `${sinal}R$ ${formatarContagem(Number((absoluto + 50n) / 100n))}`
  }
  if (absoluto < 100_000_000n) {
    return `${sinal}R$ ${decimos((absoluto + 5_000n) / 10_000n)} mil`
  }

  return `${sinal}R$ ${decimos((absoluto + 5_000_000n) / 10_000_000n)} mi`
}

/** `145n` → `14,5`; `150n` → `15` (a casa decimal só aparece quando diz algo). */
function decimos(emDecimos: bigint): string {
  const inteiro = formatarContagem(Number(emDecimos / 10n))
  const resto = emDecimos % 10n

  return resto === 0n ? inteiro : `${inteiro},${String(resto)}`
}

/**
 * Taxa de 0 a 1 em porcentagem: inteira a partir de 10% (`87%`), com uma casa abaixo disso
 * (`4,5%`) — a diferença entre 4% e 5% de faltas importa, a entre 87% e 88% de ocupação não.
 */
export function formatarTaxa(taxa: number): string {
  const porcento = taxa * 100
  if (Math.abs(porcento) >= 10) {
    return `${formatarContagem(Math.round(porcento))}%`
  }
  const comUmaCasa = Math.round(porcento * 10) / 10

  return `${String(comUmaCasa).replace('.', ',')}%`
}

/**
 * Uma taxa que pode não existir: o servidor manda NULO quando não há base (nenhuma sessão passou,
 * nenhum lembrete saiu). Nulo é "sem dados" — nunca 0%, que seria um resultado.
 */
export function taxaOuSemDados(taxa: number | null): string {
  return taxa === null ? 'sem dados' : formatarTaxa(taxa)
}

/** Diferença entre duas taxas, em pontos percentuais: `0.015` → `1,5 p.p.`. */
export function formatarPontos(diferenca: number): string {
  const pontos = Math.round(Math.abs(diferenca) * 1000) / 10

  return `${String(pontos).replace('.', ',')} p.p.`
}

// ── O período, em palavras ────────────────────────────────────────────────────────────────────

const NOMES_DOS_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const

/** O nome do mês de um `YYYY-MM` (ou `Y-m-d`), em minúsculas: `outubro`. Formato inesperado sai cru. */
export function nomeDoMes(mesOuDia: string): string {
  return NOMES_DOS_MESES[Number(mesOuDia.slice(5, 7)) - 1] ?? mesOuDia
}

function partes(ymd: string): { ano: string; mes: string; dia: number } {
  const [ano = '', mes = '01', dia = '1'] = ymd.split('-')

  return { ano, mes: NOMES_DOS_MESES[Number(mes) - 1] ?? mes, dia: Number(dia) }
}

function ordinal(dia: number): string {
  return dia === 1 ? '1º' : String(dia)
}

/** O mês INTEIRO? Rotular não é calcular: o servidor mandou as pontas, a tela só as nomeia. */
function cobreOMesInteiro(de: string, ate: string): boolean {
  return de.endsWith('-01') && limitesDoMes(de.slice(0, 7)).ate === ate
}

/**
 * Um intervalo em palavras: `1º a 5 de setembro`, `setembro` (mês inteiro), `5 de setembro` (um
 * dia). O ano só aparece quando difere de `anoDeReferencia` — "que em setembro" basta em outubro.
 */
export function intervaloEmPalavras(de: string, ate: string, anoDeReferencia?: string): string {
  const inicio = partes(de)
  const fim = partes(ate)
  const ano = anoDeReferencia === fim.ano ? '' : ` de ${fim.ano}`

  if (cobreOMesInteiro(de, ate)) {
    return `${fim.mes}${ano}`
  }
  if (de === ate) {
    return `${ordinal(fim.dia)} de ${fim.mes}${ano}`
  }
  if (inicio.mes !== fim.mes) {
    return `${ordinal(inicio.dia)} de ${inicio.mes} a ${ordinal(fim.dia)} de ${fim.mes}${ano}`
  }

  return `${ordinal(inicio.dia)} a ${ordinal(fim.dia)} de ${fim.mes}${ano}`
}

/** O período COMPARADO, sem o ano quando é o mesmo do medido: `1º a 5 de setembro`. */
export function rotuloDoComparado(periodo: PeriodoDoPainel): string {
  return intervaloEmPalavras(periodo.comparado_de, periodo.comparado_ate, periodo.ate.slice(0, 4))
}

/** Um dia por extenso, com o ano: `21 de agosto de 2026`, `1º de setembro de 2026`. */
export function diaEmPalavras(ymd: string): string {
  const { ano, mes, dia } = partes(ymd)

  return `${ordinal(dia)} de ${mes} de ${ano}`
}

/** O comparado começa ANTES do primeiro atendimento, mas no mesmo mês dele: o histórico começou no meio. */
function historicoComecouNoMeioDoComparado(base: BaseDoPainel): boolean {
  const dia = base.inicio_historico_dia

  return typeof dia === 'string' && base.periodo.comparado_de < dia
}

/**
 * O período comparado está inteiro dentro do histórico? Senão não há comparação justa — e o servidor
 * manda todo `anterior` nulo. Duas formas de ficar de fora: o comparado é de um mês anterior ao
 * histórico, ou o histórico começou NO MEIO dele (setembro contra agosto, com o sistema começando em
 * 21 de agosto — contrato 1 da rodada 1 do gate).
 */
export function comparadoAntesDoHistorico(base: BaseDoPainel): boolean {
  return (
    base.inicio_historico === null
    || base.periodo.comparado_de.slice(0, 7) < base.inicio_historico
    || historicoComecouNoMeioDoComparado(base)
  )
}

/**
 * POR QUE não há comparação, em palavras — só chame quando `comparadoAntesDoHistorico`. Diz a DATA em
 * que os indicadores começam, nunca "o sistema começou": a data pode ter sido configurada
 * (`indicadores.comparar_a_partir_de`, change inicio-dos-indicadores, D5), e quem lê só precisa dela.
 */
export function motivoDeSemComparacao(base: BaseDoPainel): string {
  if (base.inicio_historico === null) {
    return 'ainda não há histórico para comparar'
  }
  if (base.inicio_historico_dia === null) {
    return `os indicadores contam a partir de ${rotuloDoMes(base.inicio_historico)}`
  }

  return `os indicadores contam a partir de ${diaEmPalavras(base.inicio_historico_dia)}`
}

/** O mês pedido é anterior ao histórico? Então os números dele não existem — nunca são zero. */
export function mesAntesDoHistorico(base: BaseDoPainel): boolean {
  return base.inicio_historico === null || base.periodo.mes < base.inicio_historico
}

/** Por que um mês não tem números: antes do histórico, ou clínica sem histórico nenhum. */
export function motivoDeSemDados(base: BaseDoPainel): string {
  return base.inicio_historico === null
    ? 'Ainda não há histórico: a clínica não tem nenhum agendamento.'
    : `Este mês é anterior ao início dos indicadores, em ${rotuloDoMes(base.inicio_historico)}.`
}

/**
 * A linha que abre cada aba: o que foi medido e contra o quê.
 * `De 1º a 5 de outubro, até hoje, comparado com 1º a 5 de setembro.`
 */
export function fraseDoPeriodo(base: BaseDoPainel): string {
  const { periodo } = base
  const medido = intervaloEmPalavras(periodo.de, periodo.ate)
  const abertura = periodo.parcial
    ? periodo.de === periodo.ate
      ? `Em ${medido}, até agora`
      : `De ${medido}, até hoje`
    : capitalizar(medido)

  // o mês inteiro antes do histórico: o porquê é dito UMA vez, logo abaixo (motivoDeSemDados) — repetir
  // aqui "sem comparação: o histórico começa em…" era a mesma frase duas vezes (DQ-14)
  if (base.inicio_historico !== null && mesAntesDoHistorico(base)) {
    return `${abertura}.`
  }
  if (comparadoAntesDoHistorico(base)) {
    return base.inicio_historico === null
      ? `${abertura}. Ainda não há histórico para comparar.`
      : `${abertura}, sem comparação: ${motivoDeSemComparacao(base)}.`
  }

  return `${abertura}, comparado com ${intervaloEmPalavras(periodo.comparado_de, periodo.comparado_ate)}.`
}

export function capitalizar(texto: string): string {
  return texto.length === 0 ? texto : texto.charAt(0).toUpperCase() + texto.slice(1)
}

// ── A comparação ──────────────────────────────────────────────────────────────────────────────

/** Se SUBIR é bom (recebido), ruim (faltas) ou só um fato (pacientes ativos). */
export type Valencia = 'subir-e-bom' | 'subir-e-ruim' | 'neutra'

export interface Comparacao {
  /** `null` = sem comparação: o período comparado não está inteiro dentro do histórico */
  direcao: 'alta' | 'queda' | 'igual' | null
  /** `18% a mais`, `4 p.p. a menos`, `o mesmo`, `antes era zero`, `sem comparação` */
  variacao: string
  /**
   * A palavra entre a variação e o período: `que em` ("18% a mais que em …"), ou só `em` quando o
   * anterior era ZERO ("antes era zero em …") — "R$ 150 a mais" sobre um zero só repetia o valor.
   */
  conector: 'que em' | 'em'
  /** O anterior era ZERO: a variação não tem tamanho, a notícia é o zero de antes */
  anteriorZero?: boolean
  /** `1º a 5 de setembro` — vazio sem comparação */
  referencia: string
  /** A cor (que nunca vai sozinha: a seta e o texto dizem a mesma coisa) */
  tom: 'bom' | 'ruim' | 'neutro'
}

const SEM_COMPARACAO: Comparacao = { direcao: null, variacao: 'sem comparação', conector: 'que em', referencia: '', tom: 'neutro' }

/**
 * A variação contra um anterior ZERO não repete o valor: "37 a mais que em …" com 37 agora e zero
 * antes dizia o mesmo número duas vezes (DQ-09). O anterior é que é a notícia: "antes era zero em …".
 */
const CONTRA_ZERO = { variacao: 'antes era zero', conector: 'em', anteriorZero: true } as const

/** Monta a comparação com o período e o tom — o que todas as grandezas têm em comum. */
function comparacaoCom(
  { direcao, variacao, conector = 'que em', anteriorZero = false }: Variacao,
  periodo: PeriodoDoPainel,
  valencia: Valencia,
): Comparacao {
  return { direcao, variacao, conector, anteriorZero, referencia: rotuloDoComparado(periodo), tom: tomDa(direcao, valencia) }
}

function tomDa(direcao: 'alta' | 'queda' | 'igual', valencia: Valencia): Comparacao['tom'] {
  if (direcao === 'igual' || valencia === 'neutra') {
    return 'neutro'
  }
  const subiu = direcao === 'alta'

  return subiu === (valencia === 'subir-e-bom') ? 'bom' : 'ruim'
}

/**
 * Variação RELATIVA (`18% a mais`) entre duas grandezas não negativas, já em inteiros (contagem
 * ou centavos). Do zero não há porcentagem — sai a diferença absoluta, pelo formatador da grandeza.
 */
type Variacao = { direcao: 'alta' | 'queda' | 'igual'; variacao: string; conector?: Comparacao['conector']; anteriorZero?: boolean }

function variacaoRelativa(atual: bigint, anterior: bigint, absoluta: (diferenca: bigint) => string): Variacao {
  if (atual === anterior) {
    return { direcao: 'igual', variacao: 'o mesmo' }
  }
  const direcao = atual > anterior ? 'alta' : 'queda'
  const sentido = direcao === 'alta' ? 'a mais' : 'a menos'
  const diferenca = atual > anterior ? atual - anterior : anterior - atual

  if (anterior === 0n) {
    return { direcao, ...CONTRA_ZERO }
  }
  if (anterior < 0n) {
    return { direcao, variacao: `${absoluta(diferenca)} ${sentido}` }
  }
  const porcento = Math.round((Number(diferenca) / Number(anterior)) * 100)

  return { direcao, variacao: porcento === 0 ? `menos de 1% ${sentido}` : `${formatarContagem(porcento)}% ${sentido}` }
}

/** Diferença em números entre duas contagens: `24` contra `20` → `4 a mais`; contra zero, "contra zero". */
function diferencaAbsoluta(atual: number, anterior: number): Variacao {
  if (atual === anterior) {
    return { direcao: 'igual', variacao: 'o mesmo' }
  }
  const direcao = atual > anterior ? 'alta' : 'queda'
  if (anterior === 0) {
    return { direcao, ...CONTRA_ZERO }
  }

  return { direcao, variacao: `${formatarContagem(Math.abs(atual - anterior))} ${direcao === 'alta' ? 'a mais' : 'a menos'}` }
}

/**
 * Compara duas CONTAGENS pela diferença em números: `24 contra 20` → `4 a mais`. Porcentagem de
 * contagem pequena engana — 37 contra 6 viraria "517% a mais", e o que a clínica quer saber é "31 a mais".
 */
export function compararContagem(
  par: ParDoPainel<number>,
  periodo: PeriodoDoPainel,
  valencia: Valencia,
): Comparacao {
  if (par.anterior === null) {
    return SEM_COMPARACAO
  }

  return comparacaoCom(diferencaAbsoluta(par.atual, par.anterior), periodo, valencia)
}

/** Compara dois valores em DINHEIRO (string decimal), sem passar por ponto flutuante na conta. */
export function compararMoeda(
  par: ParDoPainel<string | null>,
  periodo: PeriodoDoPainel,
  valencia: Valencia,
): Comparacao {
  if (par.anterior === null || par.atual === null) {
    return SEM_COMPARACAO
  }
  const variacao = variacaoRelativa(centavos(par.atual), centavos(par.anterior), (n) =>
    formatarMoeda(`${String(n / 100n)}.${String(n % 100n).padStart(2, '0')}`),
  )

  return comparacaoCom(variacao, periodo, valencia)
}

/** Compara duas TAXAS (0–1) em pontos percentuais: `0,87 contra 0,91` → `4 p.p. a menos`. */
export function compararTaxa(
  atual: number | null,
  anterior: number | null,
  periodo: PeriodoDoPainel,
  valencia: Valencia,
): Comparacao {
  if (atual === null || anterior === null) {
    return SEM_COMPARACAO
  }
  // a diferença que a tela MOSTRA (um décimo de ponto) é a que decide se é igual — senão
  // `0,0 p.p. a mais` apareceria para uma diferença invisível
  const decimosDePonto = Math.round((atual - anterior) * 1000)
  if (decimosDePonto === 0) {
    return comparacaoCom({ direcao: 'igual', variacao: 'o mesmo' }, periodo, valencia)
  }
  const direcao = decimosDePonto > 0 ? 'alta' : 'queda'
  // de 0% para 5%, "5 p.p. a mais" repetia o número do cartão: o anterior zero é a notícia
  if (anterior === 0) {
    return comparacaoCom({ direcao, ...CONTRA_ZERO }, periodo, valencia)
  }

  return comparacaoCom(
    { direcao, variacao: `${formatarPontos(atual - anterior)} ${direcao === 'alta' ? 'a mais' : 'a menos'}` },
    periodo,
    valencia,
  )
}

// ── Os nomes do calendário da agenda ──────────────────────────────────────────────────────────

/** Dia ISO (1 = segunda) por extenso. */
export const DIAS_POR_EXTENSO = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'] as const
/** Dia ISO (1 = segunda) no eixo de um gráfico. */
export const DIAS_CURTOS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'] as const
/** O dia na frase "a sexta à tarde": sem o "-feira", como se fala. */
const DIAS_FALADOS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] as const

export const PERIODOS_DO_DIA: ReadonlyArray<{ valor: PeriodoDoDia; rotulo: string; locucao: string }> = [
  { valor: 'manha', rotulo: 'Manhã', locucao: 'de manhã' },
  { valor: 'tarde', rotulo: 'Tarde', locucao: 'à tarde' },
  { valor: 'noite', rotulo: 'Noite', locucao: 'à noite' },
]

export function diaPorExtenso(dia: number): string {
  return DIAS_POR_EXTENSO[dia - 1] ?? String(dia)
}

export function diaCurto(dia: number): string {
  return DIAS_CURTOS[dia - 1] ?? String(dia)
}

/** `[a]` → `a`; `[a, b]` → `a e b`; `[a, b, c]` → `a, b e c`. */
export function listaEmPalavras(itens: readonly string[]): string {
  if (itens.length <= 1) {
    return itens[0] ?? ''
  }

  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}

// ── Os títulos que dizem a conclusão ──────────────────────────────────────────────────────────

/** "na segunda", "no sábado" — o artigo do dia como se fala. */
function noDia(dia: number, forma: 'extenso' | 'falado'): string {
  const nome = forma === 'extenso' ? diaPorExtenso(dia) : (DIAS_FALADOS[dia - 1] ?? String(dia))

  return `${dia >= 6 ? 'no' : 'na'} ${nome}`
}

/** `as faltas se concentram na segunda-feira` — o pior dia, ou os dois empatados; `null` sem faltas. */
function fragmentoDasFaltas(linhas: PainelDaAgenda['faltas_por_dia_semana']): string | null {
  const maior = Math.max(0, ...linhas.map((linha) => linha.taxa))
  if (maior === 0) {
    return null
  }
  const piores = linhas.filter((linha) => linha.taxa === maior)
  if (piores.length > 2) {
    return 'as faltas se espalham igualmente pela semana'
  }
  if (piores.length === 2) {
    return `as faltas se concentram ${noDia(piores[0].dia, 'falado')} e ${noDia(piores[1].dia, 'falado')}`
  }

  return `as faltas se concentram ${noDia(piores[0].dia, 'extenso')}`
}

/** O título do gráfico de faltas por dia: "As faltas se concentram na segunda-feira". */
export function tituloDasFaltasPorDia(linhas: PainelDaAgenda['faltas_por_dia_semana']): string {
  const fragmento = fragmentoDasFaltas(linhas)

  return fragmento === null ? 'Nenhuma falta no período' : capitalizar(fragmento)
}

/** A célula com MENOR ocupação, entre as que têm grade — `null` quando nenhuma tem. */
export function celulaMaisVazia(
  celulas: PainelDaAgenda['ocupacao_por_periodo'],
): PainelDaAgenda['ocupacao_por_periodo'][number] | null {
  const medidas = celulas.filter((celula) => celula.taxa !== null)
  // todas em 0%: não existe "a mais vazia" — nenhum horário foi ocupado (DQ-22)
  if (medidas.length === 0 || nenhumHorarioOcupado(celulas)) {
    return null
  }

  return medidas.reduce((menor, celula) => ((celula.taxa ?? 0) < (menor.taxa ?? 0) ? celula : menor))
}

/** `a sexta à tarde é o horário mais vazio` — `null` quando nenhuma célula tem grade. */
function fragmentoDoVazio(celulas: PainelDaAgenda['ocupacao_por_periodo']): string | null {
  const vazia = celulaMaisVazia(celulas)
  if (vazia === null) {
    return null
  }
  const periodo = PERIODOS_DO_DIA.find((item) => item.valor === vazia.periodo)?.locucao ?? ''
  const artigo = vazia.dia >= 6 ? 'o' : 'a'

  return `${artigo} ${DIAS_FALADOS[vazia.dia - 1] ?? ''} ${periodo} é o horário mais vazio`
}

/** Há horário na grade e TODOS ficaram vazios (0%)? */
export function nenhumHorarioOcupado(celulas: PainelDaAgenda['ocupacao_por_periodo']): boolean {
  const medidas = celulas.filter((celula) => celula.taxa !== null)

  return medidas.length > 0 && medidas.every((celula) => celula.taxa === 0)
}

/** O título do mapa de ocupação: "A sexta à tarde é o horário mais vazio". */
export function tituloDoMapa(celulas: PainelDaAgenda['ocupacao_por_periodo']): string {
  if (nenhumHorarioOcupado(celulas)) {
    return 'Nenhum horário ocupado no período'
  }
  const fragmento = fragmentoDoVazio(celulas)

  return fragmento === null ? 'Sem grade cadastrada para medir a ocupação' : capitalizar(fragmento)
}

/** "SC Saúde tem a maior taxa de faltas e desmarques" — a linha agregada "Outros" não conta. */
export function tituloDosConvenios(linhas: PainelDaAgenda['por_convenio']): string {
  const nomeadas = linhas.filter((linha) => linha.outros === undefined && linha.taxa !== null)
  const maior = Math.max(0, ...nomeadas.map((linha) => linha.taxa ?? 0))
  if (maior === 0) {
    return 'Nenhuma falta nem desmarque por convênio'
  }
  const pior = nomeadas.find((linha) => linha.taxa === maior)

  return `${pior?.nome ?? ''} tem a maior taxa de faltas e desmarques`
}

/** O título da tendência do recebido, pela comparação JUSTA (nunca o mês parcial contra o cheio). */
export function tituloDaTendenciaDoRecebido(painel: PainelDoDinheiro): string {
  const mes = NOMES_DOS_MESES[Number(painel.periodo.mes.slice(5, 7)) - 1] ?? painel.periodo.mes
  const comparado = NOMES_DOS_MESES[Number(painel.periodo.comparado_de.slice(5, 7)) - 1] ?? ''
  const comparacao = compararMoeda(painel.recebido, painel.periodo, 'subir-e-bom')

  if (comparacao.direcao === null) {
    return tituloSemComparacao(painel, `recebeu ${formatarMoedaCompacta(painel.recebido.atual)}`)
  }
  const variacao = Number(centavos(painel.recebido.atual) - centavos(painel.recebido.anterior ?? '0'))
  const base = Number(centavos(painel.recebido.anterior ?? '0'))
  // ±5% é "no ritmo": uma semana de feriado não vira manchete
  const relativa = base === 0 ? (variacao === 0 ? 0 : 1) : variacao / base
  if (painel.periodo.parcial) {
    if (Math.abs(relativa) < 0.05) {
      return `O recebido de ${mes} está no ritmo de ${comparado}`
    }

    return `O recebido de ${mes} está ${relativa > 0 ? 'acima' : 'abaixo'} do ritmo de ${comparado}`
  }
  if (Math.abs(relativa) < 0.05) {
    return `${capitalizar(mes)} recebeu quase o mesmo que ${comparado}`
  }

  return `${capitalizar(mes)} recebeu ${relativa > 0 ? 'mais' : 'menos'} que ${comparado}`
}

/**
 * O título de um gráfico SEM comparação diz a CONCLUSÃO, não o aviso (DQ-21): "Setembro, primeiro mês
 * inteiro dos indicadores, recebeu R$ 22,3 mil". O mês do início é "o primeiro mês dos indicadores"; o
 * seguinte, sem comparação porque os indicadores começaram no meio (ou depois) do período comparado, é
 * "o primeiro mês inteiro". O porquê de não haver comparação vai para o subtítulo (`avisoDeSemComparacao`).
 */
export function tituloSemComparacao(base: BaseDoPainel, oQueAconteceu: string): string {
  const mes = capitalizar(NOMES_DOS_MESES[Number(base.periodo.mes.slice(5, 7)) - 1] ?? base.periodo.mes)
  const qual = base.periodo.mes === base.inicio_historico ? 'primeiro mês dos indicadores' : 'primeiro mês inteiro dos indicadores'

  return `${mes}, ${qual}, ${oQueAconteceu}${base.periodo.parcial ? ' até hoje' : ''}`
}

/** O aviso do subtítulo quando não há comparação: "Sem comparação: os indicadores contam a partir de …". Vazio com ela. */
export function avisoDeSemComparacao(base: BaseDoPainel): string {
  return comparadoAntesDoHistorico(base) ? ` Sem comparação: ${motivoDeSemComparacao(base)}.` : ''
}

/** O título da série de cadastros novos, pela comparação justa. */
export function tituloDosNovos(painel: PainelDosPacientes): string {
  const comparacao = compararContagem(painel.novos, painel.periodo, 'subir-e-bom')
  if (comparacao.direcao === null) {
    return painel.inicio_historico === null
      ? 'Ainda não há histórico de cadastros'
      : tituloSemComparacao(
          painel,
          painel.novos.atual === 0 ? 'não teve cadastro novo' : `teve ${plural(painel.novos.atual, 'cadastro novo', 'cadastros novos')}`,
        )
  }
  if (comparacao.direcao === 'igual') {
    return `Os cadastros novos ficaram iguais aos de ${comparacao.referencia}`
  }

  return `Os cadastros novos ${comparacao.direcao === 'alta' ? 'subiram' : 'caíram'} em relação a ${comparacao.referencia}`
}

// ── As frases de cada frente ──────────────────────────────────────────────────────────────────

/**
 * O que as famílias devem à clínica: `R$ 1.240 a receber estão em atraso, em 4 lançamentos.` Só
 * RECEITAS — o aviso do sino junta receitas e despesas, e por isso as duas telas nunca escrevem a
 * mesma frase: aqui é "a receber em atraso", lá são "lançamentos vencidos (a receber e a pagar)".
 */
export function fraseDoAtraso(painel: PainelDoDinheiro): Frase {
  if (painel.em_atraso.quantidade === 0) {
    return [t('Nenhuma receita em atraso.')]
  }

  return [
    d(formatarMoeda(painel.em_atraso.valor)),
    t(` a receber ${painel.em_atraso.quantidade === 1 ? 'está' : 'estão'} em atraso, em ${plural(painel.em_atraso.quantidade, 'lançamento', 'lançamentos')}.`),
  ]
}

/** A frase DENTRO do cartão Dinheiro: o previsto e o atraso — o recebido já é o número. */
export function fraseDoCartaoDoDinheiro(painel: PainelDoDinheiro): Frase {
  const previsto =
    painel.periodo.parcial && centavos(painel.a_receber_no_mes) > 0n
      ? [t('Ainda estão previstos '), d(formatarMoeda(painel.a_receber_no_mes)), t(' até o fim do mês. ')]
      : []

  return [...previsto, ...fraseDoAtraso(painel)]
}

/** A frase DENTRO do cartão Agenda: as perdas e sobre quantos profissionais a ocupação vale. */
export function fraseDoCartaoDaAgenda(painel: PainelDaAgenda): Frase {
  if (painel.sessoes_passadas.atual === 0) {
    return [t(NENHUMA_PASSOU), ...comEspaco(fraseDaGrade(painel))]
  }
  const faltas = compararTaxa(painel.faltas.atual.taxa, painel.faltas.anterior?.taxa ?? null, painel.periodo, 'subir-e-ruim')
  const desmarques = compararTaxa(
    painel.desmarques.atual.taxa,
    painel.desmarques.anterior?.taxa ?? null,
    painel.periodo,
    'subir-e-ruim',
  )
  const mesmaDirecao = faltas.direcao !== null && faltas.direcao !== 'igual' && faltas.direcao === desmarques.direcao
  const sentido = mesmaDirecao ? `, ${faltas.direcao === 'alta' ? 'acima' : 'abaixo'} de ${faltas.referencia}` : ''

  return [
    t('Faltas em '),
    d(taxaOuSemDados(painel.faltas.atual.taxa)),
    t(' e desmarques em '),
    d(taxaOuSemDados(painel.desmarques.atual.taxa)),
    t(` das sessões que já passaram${sentido}.`),
    ...comEspaco(fraseDaGrade(painel)),
  ]
}

/** Uma frase que continua outra: o espaço entre as duas, só quando há o que continuar. */
function comEspaco(frase: Frase): Frase {
  return frase.length === 0 ? frase : [t(' '), ...frase]
}

/** "Calculada sobre 9 de 12 profissionais, os que têm horário." — só quando falta grade a alguém. */
export function fraseDaGrade(painel: PainelDaAgenda): Frase {
  const { profissionais_com_grade: comGrade, profissionais } = painel.ocupacao
  if (comGrade >= profissionais) {
    return []
  }

  return [
    t('A ocupação foi calculada sobre '),
    d(`${formatarContagem(comGrade)} de ${plural(profissionais, 'profissional', 'profissionais')}`),
    t(', os que têm horário e especialidade cadastrados.'),
  ]
}

const NENHUMA_PASSOU = 'Nenhuma sessão do período já passou.'

/** "28 de 288 sessões que já passaram." — a parte das passadas que um cartão da agenda conta. */
export function fraseDaParteDasPassadas(quantidade: number, painel: PainelDaAgenda): Frase {
  const passadas = painel.sessoes_passadas.atual
  if (passadas === 0) {
    return [t(NENHUMA_PASSOU)]
  }

  return [d(formatarContagem(quantidade)), t(` de ${plural(passadas, 'sessão que já passou', 'sessões que já passaram')}.`)]
}

/**
 * A frase do cartão Ocupação, SEMPRE presente (a linha de cartões tem a mesma anatomia — DQ-05):
 * sobre quantos profissionais a ocupação foi calculada, com ou sem pendência de horário.
 */
export function fraseDoCartaoDaOcupacao(painel: PainelDaAgenda): Frase {
  const { profissionais_com_grade: comGrade, profissionais } = painel.ocupacao
  if (profissionais === 0) {
    return [t('Nenhum profissional com sessão no período.')]
  }
  if (comGrade < profissionais) {
    return fraseDaGrade(painel)
  }

  return profissionais === 1
    ? [t('Calculada sobre o único profissional com sessão, que tem horário e especialidade cadastrados.')]
    : [t('Calculada sobre os '), d(plural(profissionais, 'profissional', 'profissionais')), t(' com sessão, todos com horário e especialidade cadastrados.')]
}

/** As confirmadas em contagem: "180 de 288 lembretes enviados, pela família ou pela recepção." */
export function fraseDasConfirmadas(painel: PainelDaAgenda): Frase {
  const { confirmadas, enviados } = painel.confirmadas.atual
  if (enviados === 0) {
    return [t('Nenhum lembrete enviado no período.')]
  }

  return [
    d(formatarContagem(confirmadas)),
    t(` de ${plural(enviados, 'lembrete enviado', 'lembretes enviados')}, confirmados pela família ou pela recepção.`),
  ]
}

/** "9 pacotes estão no fim" — `null` quando a chave não veio (sem `tratamentos.ver`: ausente não é zero). */
function pacotesNoFim(painel: PainelDosPacientes): Frase | null {
  const pacotes = painel.pacotes_no_fim
  if (pacotes === undefined) {
    return null
  }
  if (pacotes === 0) {
    return [t('Nenhum pacote no fim.')]
  }

  return [d(plural(pacotes, 'pacote', 'pacotes')), t(` ${pacotes === 1 ? 'está' : 'estão'} no fim.`)]
}

/** Quem saiu e os pacotes no fim: `3 saíram no período. 9 pacotes estão no fim.` */
export function fraseDasSaidasEPacotes(painel: PainelDosPacientes): Frase {
  const sairam: Frase =
    painel.sairam.atual === 0
      ? [t('Ninguém saiu no período.')]
      : [d(formatarContagem(painel.sairam.atual)), t(` ${painel.sairam.atual === 1 ? 'saiu' : 'saíram'} no período.`)]
  const pacotes = pacotesNoFim(painel)

  return pacotes === null ? sairam : [...sairam, t(' '), ...pacotes]
}

/**
 * A LINHA do cartão Pacientes da Visão geral, no lugar da comparação (DQ-05): os novos do período,
 * SEM seta — o número do cartão são os ativos, e uma seta ali seria lida como crescimento deles.
 */
export function linhaDosNovos(painel: PainelDosPacientes): string {
  const novos = painel.novos.atual
  if (novos === 0) {
    return 'nenhum paciente novo no período'
  }

  return `+${formatarContagem(novos)} ${novos === 1 ? 'novo' : 'novos'} no período`
}

/** Os novos comparados, como frase que segue a linha "+24 novos no período". */
function comparacaoDosNovos(painel: PainelDosPacientes): Frase {
  const comparacao = compararContagem(painel.novos, painel.periodo, 'subir-e-bom')
  switch (comparacao.direcao) {
    case null:
      return []
    case 'igual':
      return [t(`Os novos são tantos quanto em ${comparacao.referencia}. `)]
    default:
      return comparacao.anteriorZero === true
        ? [t(`Em ${comparacao.referencia}, nenhum paciente novo. `)]
        : [t('Os novos são '), d(comparacao.variacao), t(` que em ${comparacao.referencia}. `)]
  }
}

/**
 * A frase DENTRO do cartão Pacientes. O número do cartão são os ATIVOS (uma foto, sem comparação); os
 * NOVOS ficam na linha de baixo, sem seta, e a comparação deles mora aqui, escrita — solta junto do
 * número, "−397 vs mês anterior" era lida como queda dos pacientes em atendimento.
 */
export function fraseDoCartaoDosPacientes(painel: PainelDosPacientes): Frase {
  return [...comparacaoDosNovos(painel), ...fraseDasSaidasEPacotes(painel)]
}

/** O prazo da evolução em palavras: `3 dias`, `1 dia`. */
function prazoEmDias(painel: PainelDaEquipe): string {
  return plural(painel.evolucoes.prazo_dias, 'dia', 'dias')
}

/**
 * As EVOLUÇÕES em uma frase: o que passou do prazo E o que ainda espera dentro dele.
 *
 * "Nenhuma evolução atrasada" sozinho, ao lado do "Pede atenção" dizendo "255 atendimentos sem
 * evolução registrada", parecia contradição (validação local de 05/10): as duas são verdade —
 * atrasada é a que passou do prazo; sem evolução é toda a que ainda não foi escrita. A frase diz
 * as duas, com o prazo em dias, e a contagem total é a MESMA do sino.
 */
export function fraseDasEvolucoes(painel: PainelDaEquipe): Frase {
  const { atrasadas, sem_evolucao: semEvolucao, profissionais_com_atraso: profissionais } = painel.evolucoes

  if (atrasadas > 0) {
    return [
      d(plural(atrasadas, 'sessão', 'sessões')),
      t(
        ` ${atrasadas === 1 ? 'passou' : 'passaram'} do prazo de ${prazoEmDias(painel)}, de ${plural(profissionais, 'profissional', 'profissionais')}; `,
      ),
      d(formatarContagem(semEvolucao)),
      t(' ainda sem evolução no total.'),
    ]
  }
  if (semEvolucao === 0) {
    return [t('Todas as sessões realizadas têm evolução.')]
  }

  return [
    d(plural(semEvolucao, 'sessão', 'sessões')),
    t(` ainda sem evolução; nenhuma passou do prazo de ${prazoEmDias(painel)}.`),
  ]
}

/**
 * A frase do cartão "Evoluções atrasadas" da aba Equipe — o número do cartão já são as atrasadas;
 * a frase diz de quantos profissionais e quantas ainda esperam dentro do prazo.
 */
export function fraseDoCartaoDeAtrasadas(painel: PainelDaEquipe): Frase {
  const { atrasadas, sem_evolucao: semEvolucao, profissionais_com_atraso: profissionais } = painel.evolucoes
  if (semEvolucao === 0) {
    return [t('Todas as sessões realizadas têm evolução.')]
  }
  const total: Frase = [d(plural(semEvolucao, 'sessão', 'sessões')), t(' ainda sem evolução no total.')]

  return atrasadas === 0
    ? [d(plural(semEvolucao, 'sessão', 'sessões')), t(' ainda sem evolução, todas dentro do prazo.')]
    : [t(`De ${plural(profissionais, 'profissional', 'profissionais')}. `), ...total]
}

// ── O painel rotulado pela frente ─────────────────────────────────────────────────────────────

export type PainelDaFrente =
  | { frente: 'dinheiro'; painel: PainelDoDinheiro }
  | { frente: 'agenda'; painel: PainelDaAgenda }
  | { frente: 'pacientes'; painel: PainelDosPacientes }
  | { frente: 'equipe'; painel: PainelDaEquipe }

