/**
 * Ciclos de faturamento (change fechamento-de-ciclo) — payload REAL da API.
 *
 * O ciclo é **por CONVÊNIO**: cada operadora tem o seu calendário (Unimed fecha no dia
 * 15; SC Saúde no último dia do mês). Fechado o período, os registros daquele convênio
 * cuja competência cai dentro dele param de aceitar EDIÇÃO — criar retroativo continua
 * permitido. Quem reabre é o administrador, com motivo e trilha.
 *
 * §14 permanece intacta: fechar um ciclo é **registro interno** de "esta produção já foi
 * enviada". Não há guia, protocolo, lote nem valor faturado neste contrato — nem pode
 * haver (SEC-FC-19).
 */

/**
 * Domínio FECHADO do corte (§13 — o enum é do banco).
 *
 * `dia_fixo` 15 ⇒ períodos do dia 16 ao dia 15 do mês seguinte. `ultimo_dia` ⇒ mês
 * calendário. O dia para em 28 de propósito (SEC-FC-21): com corte 29–31 o clamp de mês
 * curto abriria buracos — dias que ciclo nenhum fecharia, eternamente editáveis.
 */
export type TipoDeCorteDoCiclo = 'dia_fixo' | 'ultimo_dia'

/** Período derivado do calendário do convênio — as duas pontas na parede da clínica. */
export interface PeriodoDoCiclo {
  /** `Y-m-d` */
  periodo_inicio: string
  /** `Y-m-d` */
  periodo_fim: string
}

/**
 * POR QUE não há próximo período — os dois estados que antes eram o MESMO `null`.
 *
 * `sem_calendario`: o convênio não tem corte configurado; o próximo passo é o cadastro.
 * `ja_fechado`: o calendário existe e o último período **já foi fechado**; não há o que
 * fazer até o próximo corte.
 *
 * Tratar os dois como "configure o corte" mandava a recepção configurar, no dia seguinte
 * ao 1º fechamento, um calendário que ESTÁ configurado — com a tabela de fechados logo
 * abaixo, desmentindo a própria tela (achado CR #2).
 */
export type MotivoSemProximoCiclo = 'sem_calendario' | 'ja_fechado'

/**
 * Resposta de `GET /ciclos/proximo`. O `motivo` só vem quando `periodo` é `null`, e é
 * o SERVIDOR quem o diz — a tela não reconstrói o estado a partir da lista de
 * fechamentos (duas leituras independentes divergiriam na virada do corte).
 */
export interface ProximoCiclo {
  periodo: PeriodoDoCiclo | null
  motivo: MotivoSemProximoCiclo | null
}

/** Quem fechou/reabriu: id + nome, e nada além (a trilha completa vive na auditoria). */
export interface AutorDoFechamento {
  id: number
  nome: string
}

/**
 * Uma linha de `fechamentos_ciclo`. A tabela é **append-only** (SEC-FC-02): reabrir
 * MARCA a linha, re-fechar cria uma NOVA — por isso o mesmo período pode aparecer mais
 * de uma vez, e a lista é a história, não o estado.
 */
export interface FechamentoDeCiclo extends PeriodoDoCiclo {
  id: number
  fechado_por: AutorDoFechamento
  /** `Y-m-d H:i` na parede da clínica — a tela FORMATA, nunca reinterpreta o fuso */
  fechado_em: string
  reaberto_por: AutorDoFechamento | null
  /** `Y-m-d H:i`; `null` enquanto o fechamento estiver de pé */
  reaberto_em: string | null
  /**
   * `true` = ainda congelando o período. É o SERVIDOR quem decide — a tela nunca deriva
   * o estado de `reaberto_em`, porque o dia em que a regra mudar (re-fechamento, ciclo
   * expirado) as duas leituras divergiriam e só uma delas seria a verdadeira.
   */
  aberto: boolean
}
