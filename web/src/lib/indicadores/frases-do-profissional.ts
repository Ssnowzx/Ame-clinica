import { formatarMinutosEmHoras } from '@/lib/minutos'
import {
  capitalizar,
  compararContagem,
  compararMoeda,
  diaPorExtenso,
  formatarMoedaCompacta,
  listaEmPalavras,
  nomeDoMes,
  plural,
  tituloSemComparacao,
  type Frase,
} from '@/lib/indicadores/frases'
import type { BaseDoPainel, LinhaDeProdutividade, PainelDaAgenda, PainelDaEquipe, ParDoPainel } from '@/tipos'

/**
 * As FRASES do painel do profissional (change painel-do-profissional, D5) — a extensão das frases dos
 * Indicadores para a ficha de UMA pessoa. Mesma disciplina: o servidor manda números, cada frase aqui é
 * uma função pura com teste por tabela de casos, e moeda/plural/porcentagem passam pelos helpers únicos
 * de `frases.ts`.
 *
 * A VOZ muda com quem lê: na própria ficha o texto fala com o profissional ("seus atendimentos"); na
 * ficha de outro, fala com o gestor sobre ele ("atendimentos de Ana"). Quem decide é a página, pelo
 * vínculo do usuário — a frase só escreve.
 */

/** Quem a ficha descreve, e se quem lê é essa mesma pessoa. */
export interface VozDaFicha {
  ehProprio: boolean
  nome: string
}

/** `seus atendimentos` · `atendimentos de Ana`. */
export function atendimentosDe(voz: VozDaFicha): string {
  return voz.ehProprio ? 'seus atendimentos' : `atendimentos de ${voz.nome}`
}

/** `com você` · `com Ana`. */
export function comQuem(voz: VozDaFicha): string {
  return voz.ehProprio ? 'com você' : `com ${voz.nome}`
}

/** `a sua agenda` · `a agenda de Ana`. */
export function aAgendaDe(voz: VozDaFicha): string {
  return voz.ehProprio ? 'a sua agenda' : `a agenda de ${voz.nome}`
}

/** `da sua grade` · `da grade de Ana`. */
export function daGrade(voz: VozDaFicha): string {
  return voz.ehProprio ? 'da sua grade' : `da grade de ${voz.nome}`
}

/**
 * A BASE do financeiro, dita sempre ao lado dos números (spec profissionais-tela): o que entra é o pago
 * no caixa da clínica; o que a operadora do plano paga ao convênio não passa por aqui (§14).
 */
export function fraseDaBaseDoFinanceiro(voz: VozDaFicha): string {
  return `Pagamentos recebidos no caixa da clínica pelos ${atendimentosDe(voz)}; convênio de plano não passa por aqui.`
}

// ── As tendências de seis meses ────────────────────────────────────────────────────────────────

/** O dia de hoje no mês em curso (`5`), lido do período que o servidor mandou — a tela não conta dias. */
export function diaDeHojeDoPeriodo(base: BaseDoPainel): string {
  return String(Number(base.periodo.ate.slice(8, 10)))
}

/** ±5% é "no ritmo": uma semana de feriado não vira manchete — a régua de `tituloDaTendenciaDoRecebido`. */
const NO_RITMO = 0.05

function variacaoRelativa(atual: number, anterior: number): number {
  if (anterior === 0) {
    return atual === 0 ? 0 : 1
  }

  return (atual - anterior) / anterior
}

/** O que a série conta, com o gênero que a frase pede ("os mesmos atendimentos", "as mesmas faltas"). */
export interface CoisaContada {
  /** `atendimentos realizados` */
  plural: string
  /** `atendimento realizado` */
  singular: string
  /** `atendimentos` — a forma curta da frase de comparação */
  curto: string
  genero: 'masculino' | 'feminino'
}

export const ATENDIMENTOS: CoisaContada = {
  plural: 'atendimentos realizados',
  singular: 'atendimento realizado',
  curto: 'atendimentos',
  genero: 'masculino',
}

export const FALTAS: CoisaContada = { plural: 'faltas', singular: 'falta', curto: 'faltas', genero: 'feminino' }

/**
 * O título-conclusão de uma série de CONTAGEM, pela comparação JUSTA do painel (o mesmo período do mês
 * anterior — nunca o mês parcial contra o cheio):
 * - mês em curso: "Os atendimentos de outubro estão acima do ritmo de setembro";
 * - mês fechado: "Setembro teve mais faltas que agosto";
 * - sem comparação: "Outubro, primeiro mês dos indicadores, teve 24 atendimentos realizados até hoje".
 */
export function tituloDaTendenciaDaContagem(par: ParDoPainel<number>, base: BaseDoPainel, coisa: CoisaContada): string {
  const comparacao = compararContagem(par, base.periodo, 'neutra')
  if (comparacao.direcao === null || par.anterior === null) {
    return tituloSemComparacao(base, par.atual === 0 ? `não teve ${coisa.plural}` : `teve ${plural(par.atual, coisa.singular, coisa.plural)}`)
  }
  const mes = nomeDoMes(base.periodo.mes)
  const comparado = nomeDoMes(base.periodo.comparado_de)
  const artigo = coisa.genero === 'masculino' ? 'Os' : 'As'

  if (par.atual === 0 && par.anterior === 0) {
    return `Nenhum${coisa.genero === 'feminino' ? 'a' : ''} ${coisa.singular.split(' ')[0]} em ${mes}, como em ${comparado}`
  }
  const relativa = variacaoRelativa(par.atual, par.anterior)
  if (base.periodo.parcial) {
    const ritmo = Math.abs(relativa) < NO_RITMO ? 'no' : relativa > 0 ? 'acima do' : 'abaixo do'

    return `${artigo} ${coisa.curto} de ${mes} estão ${ritmo} ritmo de ${comparado}`
  }
  if (Math.abs(relativa) < NO_RITMO) {
    const mesmos = coisa.genero === 'masculino' ? 'os mesmos' : 'as mesmas'

    return `${capitalizar(mes)} teve quase ${mesmos} ${coisa.curto} que ${comparado}`
  }

  return `${capitalizar(mes)} teve ${relativa > 0 ? 'mais' : 'menos'} ${coisa.curto} que ${comparado}`
}

/** O título-conclusão do recebido, pela mesma régua: "O recebido de outubro está acima do ritmo de setembro". */
export function tituloDaTendenciaDoRecebidoDoProfissional(par: ParDoPainel<string>, base: BaseDoPainel): string {
  const comparacao = compararMoeda(par, base.periodo, 'subir-e-bom')
  if (comparacao.direcao === null || par.anterior === null) {
    return tituloSemComparacao(base, `recebeu ${formatarMoedaCompacta(par.atual)}`)
  }
  const mes = nomeDoMes(base.periodo.mes)
  const comparado = nomeDoMes(base.periodo.comparado_de)
  // o valor como número só para a RAZÃO entre os dois — nada aqui é exibido nem somado
  const relativa = variacaoRelativa(Number(par.atual), Number(par.anterior))

  if (base.periodo.parcial) {
    const ritmo = Math.abs(relativa) < NO_RITMO ? 'no' : relativa > 0 ? 'acima do' : 'abaixo do'

    return `O recebido de ${mes} está ${ritmo} ritmo de ${comparado}`
  }
  if (Math.abs(relativa) < NO_RITMO) {
    return `${capitalizar(mes)} recebeu quase o mesmo que ${comparado}`
  }

  return `${capitalizar(mes)} recebeu ${relativa > 0 ? 'mais' : 'menos'} que ${comparado}`
}

// ── A semana ───────────────────────────────────────────────────────────────────────────────────

/** "A quarta-feira é o dia com mais atendimentos" — os dias empatados juntos; nenhum, a frase do nada. */
export function tituloDoDiaMaisCheio(dias: LinhaDeProdutividade['por_dia_da_semana']): string {
  const maior = Math.max(0, ...dias.map((dia) => dia.realizados))
  if (maior === 0) {
    return 'Nenhum atendimento realizado no mês'
  }
  const cheios = dias.filter((dia) => dia.realizados === maior).map((dia) => diaPorExtenso(dia.dia))
  if (cheios.length > 2) {
    return 'Os atendimentos se espalham igualmente pela semana'
  }

  return cheios.length === 2
    ? `${capitalizar(listaEmPalavras(cheios))} são os dias com mais atendimentos`
    : `${capitalizar(cheios[0] ?? '')} é o dia com mais atendimentos`
}

/** A ocupação de UM profissional, em palavras: sobre a grade dele — ou por que não há o que medir. */
export function fraseDaOcupacaoDoProfissional(painel: PainelDaAgenda, voz: VozDaFicha): Frase {
  if (painel.ocupacao.profissionais === 0) {
    return [{ texto: 'Nenhuma sessão marcada no período.' }]
  }
  if (painel.ocupacao.profissionais_com_grade === 0) {
    return [{ texto: 'Sem horário ou especialidade cadastrados não há grade para medir a ocupação.' }]
  }

  return [{ texto: `Sessões marcadas sobre os horários ${daGrade(voz)}, já sem feriados e bloqueios.` }]
}

/** As evoluções que passaram do prazo — a parte que pede ação; a fila inteira mora no bloco próprio. */
export function fraseDasEvolucoesAtrasadas(equipe: PainelDaEquipe): Frase {
  const { atrasadas, prazo_dias: prazo } = equipe.evolucoes
  const doPrazo = plural(prazo, 'dia', 'dias')
  if (atrasadas === 0) {
    return [{ texto: `Nenhuma sessão passou do prazo de ${doPrazo} sem evolução.` }]
  }

  return [
    { texto: plural(atrasadas, 'sessão', 'sessões'), destaque: true },
    { texto: ` ${atrasadas === 1 ? 'passou' : 'passaram'} do prazo de ${doPrazo} sem evolução.` },
  ]
}

// ── Onde a agenda não rendeu ───────────────────────────────────────────────────────────────────

interface PerdaDoMes {
  chave: 'faltas' | 'liberados' | 'outros'
  rotulo: string
  quantidade: number
}

/** As três perdas que se CONTAM em sessões — as horas ociosas vão à parte (outra unidade). */
export function perdasDoMes(linha: LinhaDeProdutividade): PerdaDoMes[] {
  return [
    { chave: 'faltas', rotulo: 'Faltas', quantidade: linha.faltas },
    { chave: 'liberados', rotulo: 'Horários liberados (desmarcados)', quantidade: linha.liberados },
    { chave: 'outros', rotulo: 'Outros, sem cobrança', quantidade: linha.em_aberto },
  ]
}

const TITULO_DA_PERDA: Record<PerdaDoMes['chave'], string> = {
  faltas: 'As faltas foram a maior perda do mês',
  liberados: 'Os horários liberados foram a maior perda do mês',
  outros: 'Os horários sem cobrança foram a maior perda do mês',
}

/** O título-conclusão das perdas: a maior delas — ou, sem nenhuma, que nada se perdeu em sessão. */
export function tituloDaPerda(perdas: readonly PerdaDoMes[]): string {
  const maior = Math.max(0, ...perdas.map((perda) => perda.quantidade))
  if (maior === 0) {
    return 'Nenhuma sessão perdida no mês'
  }
  const piores = perdas.filter((perda) => perda.quantidade === maior)

  return piores.length === 1 ? TITULO_DA_PERDA[piores[0].chave] : 'As perdas do mês se dividem por igual'
}

/** As horas da grade sem marcação, depois das perdas: "Além delas, 26h40 da grade ficaram sem marcação." */
export function fraseDasHorasOciosas(linha: LinhaDeProdutividade): string {
  return linha.minutos_ociosos <= 0
    ? 'Nenhuma hora da grade ficou sem marcação.'
    : `Além delas, ${formatarMinutosEmHoras(linha.minutos_ociosos)} da grade ficaram sem marcação.`
}

// ── Pacientes ──────────────────────────────────────────────────────────────────────────────────

/** "Convênio Alfa concentra a maior parte das sessões" — a linha agregada "Outros" nunca é a conclusão. */
export function tituloDasSessoesPorConvenio(linhas: PainelDaAgenda['por_convenio']): string {
  const nomeadas = linhas.filter((linha) => linha.outros === undefined)
  const maior = Math.max(0, ...nomeadas.map((linha) => linha.sessoes))
  if (maior === 0) {
    return 'Ainda não há sessões que já passaram'
  }
  const donos = nomeadas.filter((linha) => linha.sessoes === maior)

  return donos.length === 1
    ? `${donos[0].nome} concentra a maior parte das sessões`
    : `${listaEmPalavras(donos.map((linha) => linha.nome))} dividem a maior parte das sessões`
}

/** O título da lista sem pagamento: quantas — a lista é só leitura, a cobrança é do financeiro. */
export function tituloDoSemPagamento(quantidade: number): string {
  return quantidade === 0
    ? 'Todas as sessões realizadas no mês têm pagamento'
    : `${capitalizar(plural(quantidade, 'sessão realizada', 'sessões realizadas'))} no mês ainda sem pagamento`
}

// ── Financeiro ─────────────────────────────────────────────────────────────────────────────────

/** Uma fatia do recebido (por forma de pagamento, por convênio) — `rotulo` já dito para a tela. */
export interface FatiaDoRecebido {
  rotulo: string
  /** decimal string — nunca float na conta exibida */
  valor: string
}

/** "Pix trouxe a maior parte do recebido" — empatadas, as duas; nenhuma, a frase do nada. */
export function tituloDaMaiorParteDoRecebido(fatias: readonly FatiaDoRecebido[]): string {
  // o valor como número só para ORDENAR — nada aqui é exibido nem somado
  const maior = Math.max(0, ...fatias.map((fatia) => Number(fatia.valor)))
  if (maior <= 0) {
    return 'Nenhum pagamento recebido no período'
  }
  const donas = fatias.filter((fatia) => Number(fatia.valor) === maior).map((fatia) => fatia.rotulo)

  return donas.length === 1
    ? `${donas[0]} trouxe a maior parte do recebido`
    : `${listaEmPalavras(donas)} dividem a maior parte do recebido`
}
