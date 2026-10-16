/**
 * Vistas agregadas do dashboard (§11) — números e rótulos de apoio (status,
 * especialidade, convênio, mês). NUNCA dado de cadastro de paciente.
 */

export interface IndicadoresDeAtendimentos {
  mes: string
  total: number
  por_especialidade: Array<{ especialidade: { id: number; nome: string | null }; total: number }>
  /** `convenio: null` = atendimento sem convênio (linha própria — a tela rotula) */
  por_convenio: Array<{ convenio: { id: number; nome: string | null } | null; total: number }>
}

export interface IndicadoresDePacientes {
  mes: string
  ativos: number
  novos_no_mes: number
  /** Novos cadastros por mês, 6 buckets sem buracos — o crescimento da clínica */
  serie: Array<{ mes: string; total: number }>
  /** Quebras da base ATIVA (foto do momento) — contagens agregadas, nunca dado de um paciente */
  por_sexo: Array<{ sexo: string; total: number }>
  /** Bandas etárias fixas, sempre as 7 (mesmo zeradas), em ordem de banda */
  por_faixa_etaria: Array<{ faixa: string; total: number }>
  /** `indicacao: null` = "não informado". `total` = base ativa; `mensal` = novos do mês */
  por_indicacao: {
    total: Array<{ indicacao: string | null; total: number }>
    mensal: Array<{ indicacao: string | null; total: number }>
  }
  /** Pacientes distintos por convênio (via tratamentos) — soma NÃO particiona a base */
  por_convenio: Array<{ convenio: { id: number; nome: string | null }; total: number }>
}

/** Produção do período por profissional — o contrato da vista de relatório reusada. */
export interface ProducaoDoMes {
  de: string
  ate: string
  linhas: Array<{
    profissional: { id: number; nome: string | null }
    atendimentos: number
    sessoes_consumidas: number
    evolucoes_preenchidas: number
  }>
}

/**
 * Uma linha da quebra por categoria › subcategoria. `subcategoria` NULA significa
 * que o lançamento não tem esse nível — a tela mostra a categoria sozinha, nunca
 * um "—" que pareça subcategoria vazia.
 */
export interface LinhaDeCategoria {
  categoria_id: number
  categoria: string | null
  subcategoria_id: number | null
  subcategoria: string | null
  /** decimal string — nunca float (D1) */
  total: string
}

/**
 * A tela Gráficos Financeiros (§11). Um parâmetro só (`mes`): as duas quebras são
 * DO MÊS, as duas séries são do ANO dele.
 *
 * **`serie_do_ano` e `previsao_do_ano` são REGIMES DIFERENTES** — a primeira é caixa
 * (o que foi pago, por `pago_em`), a segunda é o que ainda não foi pago, pelo
 * `vencimento`. Não existe campo aqui somando os dois, e a tela não pode criar um:
 * seria um número que não aparece em relatório nenhum. Mesma disciplina do T-fin-19.
 */
export interface GraficosFinanceiros {
  mes: string
  ano: string
  recebido_por_categoria: LinhaDeCategoria[]
  pago_por_categoria: LinhaDeCategoria[]
  serie_do_ano: Array<{ mes: string; recebidas: string; pagas: string }>
  previsao_do_ano: Array<{ mes: string; a_receber: string; a_pagar: string }>
  /** RECORTE de `previsao_do_ano` (vencimento já passado), nunca uma parcela a mais. */
  vencido: { a_receber: string; a_pagar: string }
}

/** Referência mínima nome+id — o item de drill NUNCA carrega cadastro além disso. */
export interface ReferenciaDoItem {
  id: number
  nome: string | null
}

/** Item do drill da agenda (`/indicadores/agenda/itens`) — whitelist do servidor. */
export interface ItemDaAgenda {
  id: number
  /** `Y-m-d H:i` */
  inicio: string
  paciente: ReferenciaDoItem | null
  profissional: ReferenciaDoItem | null
}

/** Item do drill de atendimentos (`/indicadores/atendimentos/itens`). */
export interface ItemDeAtendimento {
  id: number
  /** `Y-m-d H:i` */
  finalizado_em: string | null
  paciente: ReferenciaDoItem | null
  profissional: ReferenciaDoItem | null
  especialidade: ReferenciaDoItem | null
  /** `null` = atendimento sem convênio */
  convenio: ReferenciaDoItem | null
}

/** Página de itens de indicador: a página do Laravel + o contexto do cabeçalho. */
export interface ItensDeIndicador<T> {
  mes: string
  contexto: { rotulo: string; total: number }
  data: T[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

/** Filtro de dimensão dos itens de atendimentos (ids apenas — nunca nome na URL). */
export interface FiltroDeAtendimentos {
  profissional_id?: number
  especialidade_id?: number
  convenio_id?: number
}

/** A quebra de UM dia da semana (ISO 1=segunda … 7=domingo) da produtividade. */
export interface ProdutividadePorDia {
  dia: number
  minutos_na_grade: number
  marcados: number
  minutos_marcados: number
  realizados: number
  minutos_realizados: number
}

/**
 * Os números da produtividade (a produção da aba Equipe, §11) — os mesmos campos valem para a
 * linha de um profissional e para os totais da clínica. Percentuais vêm PRONTOS e inteiros
 * (0–100) ou `null` quando não há denominador; a tela nunca divide.
 */
export interface NumerosDeProdutividade {
  /** Tempo de RELÓGIO na escala do profissional (menos feriado e bloqueio). */
  minutos_na_grade: number
  /**
   * A capacidade em VAGAS: `minutos_na_grade × atendimentos_simultaneos` (change
   * atendimento-em-grupo). É o denominador dos percentuais E a régua de `minutos_ociosos` —
   * quem atende em grupo tem mais vaga do que relógio, e medir marcação contra relógio daria
   * 400%. Opcional no tipo porque um payload anterior à change não o traz.
   */
  minutos_de_vaga?: number
  minutos_marcados: number
  minutos_realizados: number
  /** Vaga não usada: `minutos_de_vaga − minutos_marcados`, na MESMA régua do disponível. */
  minutos_ociosos: number
  capacidade_atendimentos: number
  marcados: number
  realizados: number
  faltas: number
  liberados: number
  em_aberto: number
  ocupacao_pct: number | null
  produtividade_pct: number | null
  aproveitamento_pct: number | null
}

export interface LinhaDeProdutividade extends NumerosDeProdutividade {
  profissional: { id: number; nome: string; foto_versao: string | null }
  /** A especialidade PRINCIPAL (a que dá a cor do avatar na agenda) — `null` sem cadastro */
  especialidade: { id: number; nome: string; cor: string } | null
  /** `tempo_sessao` da especialidade principal — o divisor da capacidade; `null` sem especialidade */
  duracao_referencia_min: number | null
  /** Quantos atendimentos sustenta ao mesmo tempo; 1 = um por vez (change atendimento-em-grupo) */
  atendimentos_simultaneos?: number
  minutos_em_feriados: number
  minutos_em_bloqueios: number
  por_dia_da_semana: ProdutividadePorDia[]
}

export interface ProdutividadeDoMes {
  mes: string
  totais: NumerosDeProdutividade
  linhas: LinhaDeProdutividade[]
}

// ── Os PAINÉIS por frente (change indicadores-profissionais, contrato D9) ─────────────────────
// A tela e a API constroem contra este JSON. Dinheiro é STRING decimal; taxa é número de 0 a 1;
// contagem é inteiro. O servidor decide o período e a comparação — a tela só escreve.

/** O período medido e o comparado. Mês em curso: 1..hoje contra o mesmo intervalo do anterior. */
export interface PeriodoDoPainel {
  /** `YYYY-MM` */
  mes: string
  /** `Y-m-d` */
  de: string
  ate: string
  /** Mês em curso (medido até hoje, não até o fim do mês) */
  parcial: boolean
  comparado_de: string
  comparado_ate: string
}

/** O que todo painel devolve junto: o período e quando o histórico da clínica começa. */
export interface BaseDoPainel {
  periodo: PeriodoDoPainel
  /** `YYYY-MM` do início dos indicadores (o dia abaixo); `null` sem atendimento nenhum */
  inicio_historico: string | null
  /**
   * `Y-m-d` em que os indicadores começam: o MAIS TARDE entre o primeiro agendamento de tipo
   * ATENDIMENTO (bloqueio não conta) e a data de `indicadores.comparar_a_partir_de` (change
   * inicio-dos-indicadores); `null` sem atendimento nenhum. Quando o período comparado começa antes
   * deste dia, ele não está inteiro dentro do histórico, e o servidor manda TODO `anterior` nulo.
   */
  inicio_historico_dia: string | null
}

/**
 * Um número e o do período comparado. `anterior` nulo = o período comparado não está inteiro dentro
 * do histórico (começa antes do primeiro atendimento).
 */
export interface ParDoPainel<T> {
  atual: T
  anterior: T | null
}

export interface PainelDoDinheiro extends BaseDoPainel {
  recebido: ParDoPainel<string>
  /** Receitas em aberto vencendo de hoje até o fim do mês */
  a_receber_no_mes: string
  em_atraso: { valor: string; quantidade: number }
  /** Nulo sem sessão faturada no período (D4) */
  valor_medio_sessao: ParDoPainel<string | null>
  /** 6 meses terminando no mês pedido; `valor` nulo antes do histórico */
  serie_recebido: Array<{ mes: string; valor: string | null }>
}

/** Contagem com a taxa sobre as sessões que já passaram (0–1). */
export interface ContagemComTaxa {
  quantidade: number
  taxa: number | null
}

export type PeriodoDoDia = 'manha' | 'tarde' | 'noite'

export interface PainelDaAgenda extends BaseDoPainel {
  ocupacao: {
    atual: number | null
    anterior: number | null
    /** Sobre quantos a ocupação foi calculada */
    profissionais_com_grade: number
    /** Quantos têm sessão no período */
    profissionais: number
  }
  realizadas: ParDoPainel<number>
  /** A BASE de toda porcentagem: as futuras nunca entram */
  sessoes_passadas: ParDoPainel<number>
  faltas: ParDoPainel<ContagemComTaxa>
  desmarques: ParDoPainel<ContagemComTaxa>
  /** Sessões que já passaram e seguem num status "em aberto" (a flag da baixa em lote) — foto, sem par */
  sem_baixa: number
  confirmadas: ParDoPainel<{ confirmadas: number; enviados: number; taxa: number | null }>
  /** Os nomes dos status que entram em cada conta, lidos do cadastro (§13) */
  status_que_contam: { falta: string[]; desmarque: string[] }
  /** `dia` ISO: 1 = segunda … 7 = domingo; só dias com sessão */
  faltas_por_dia_semana: Array<{ dia: number; sessoes: number; faltas: number; taxa: number }>
  /** `taxa` nula sem capacidade naquele dia e período */
  ocupacao_por_periodo: Array<{ dia: number; periodo: PeriodoDoDia; marcadas: number; capacidade: number; taxa: number | null }>
  /** As 8 maiores; o resto numa linha `nome: "Outros"` com `outros` = quantos convênios agregou */
  por_convenio: Array<{
    nome: string
    particular?: boolean
    outros?: number
    sessoes: number
    faltas: number
    desmarques: number
    taxa: number | null
  }>
  /** Só as sessões que já passaram, uma linha por status com quantidade, na ordem do cadastro */
  /** `cor` é DADO do cadastro (§13) e pode faltar — só entra na tela por `derivarTonsStatus` */
  situacao: Array<{ status_id: number; nome: string; cor: string | null; quantidade: number }>
}

export interface PainelDosPacientes extends BaseDoPainel {
  ativos: number
  novos: ParDoPainel<number>
  /** Passaram de ativo a inativo no período (pela trilha de auditoria) */
  sairam: ParDoPainel<number>
  /**
   * AUSENTE sem `tratamentos.ver` (SEC-IND-01): o servidor não manda a chave, e ausente NÃO é zero —
   * a tela some com o cartão e a frase, em vez de escrever "nenhum pacote no fim".
   */
  pacotes_no_fim?: number
  /** AUSENTE sem `lista_espera.ver` — mesma regra: ausente não é zero */
  fila_de_espera?: number
  /** `quantidade` nula antes do histórico */
  serie_novos: Array<{ mes: string; quantidade: number | null }>
}

export interface LinhaDaEquipe {
  id: number
  nome: string
  especialidades: string[]
  tem_grade: boolean
  /** Nula sem grade */
  ocupacao: number | null
  marcadas: number
  realizadas: number
  faltas: number
  evolucoes_em_dia: number | null
  evolucoes_atrasadas: number
}

export interface PainelDaEquipe extends BaseDoPainel {
  evolucoes: {
    em_dia: ParDoPainel<number | null>
    /** Sem evolução e com o prazo já vencido */
    atrasadas: number
    profissionais_com_atraso: number
    /** TODOS os atendimentos ainda sem evolução — a mesma conta do aviso do sino */
    sem_evolucao: number
    /** A configuração `evolucoes.prazo_dias` (§13): quantos dias até a evolução ficar atrasada */
    prazo_dias: number
  }
  /** Em ordem de realizadas, decrescente. A escopada recebe só a própria linha */
  profissionais: LinhaDaEquipe[]
}

export type FrenteDoPainel = 'dinheiro' | 'agenda' | 'pacientes' | 'equipe'

// ── O PAINEL DO PROFISSIONAL (change painel-do-profissional, contrato D7) ───────────────────────
// `GET /api/profissionais/{id}/painel?mes=AAAA-MM`. O painel EMBUTE as saídas dos painéis acima,
// calculadas pelo servidor com o recorte de UM profissional — por isso a tela reusa os tipos (e os
// componentes) que já desenham esses painéis. Cada bloco opcional só VEM com a permissão do módulo
// dono: ausente não é zero, é bloco que não se mostra.

/**
 * Um mês da série de seis (D2). A série vem com a `produtividade` OU com o `financeiro`, e cada valor só
 * com o bloco DONO dele: `realizados`/`faltas` com a produtividade, `recebido` com o financeiro — a
 * faturista recebe a série só com o recebido, e "sem as contagens" não é "zero atendimentos".
 * `sem_dados`: o mês é anterior ao início dos indicadores — os valores vêm nulos, nunca zero.
 * `parcial`: o mês em curso, medido até hoje.
 */
export interface MesDaSerieDoProfissional {
  /** `YYYY-MM` */
  mes: string
  parcial: boolean
  sem_dados: boolean
  /** SÓ com a `produtividade`; nulo antes do histórico */
  realizados?: number | null
  /** SÓ com a `produtividade`; nulo antes do histórico */
  faltas?: number | null
  /** SÓ com o `financeiro`; nulo antes do histórico */
  recebido?: string | null
}

/** Uma sessão realizada do profissional, no mês, ainda sem pagamento — LEITURA, nenhuma ação. */
interface SessaoSemPagamento {
  atendimento_id: number
  /** `Y-m-d` (ou `Y-m-d H:i`) — a data da sessão */
  data: string
  /** O nome da criança — o profissional já a vê na agenda (D4) */
  paciente: string
  /** `null` = a sessão não tem valor de tabela para mostrar */
  valor: string | null
}

/**
 * O financeiro do PRÓPRIO profissional (D4): o pago no caixa da clínica pelos atendimentos dele. Nunca
 * o total da clínica, nunca outro profissional, nunca "Sem profissional", nunca convênio de plano (§14).
 */
export interface FinanceiroDoProfissional {
  /** Pago no caixa da clínica; o que a operadora do plano paga não passa por aqui */
  base: 'caixa'
  recebido: ParDoPainel<string>
  /** O servidor já nomeia "Sem forma de pagamento" — nunca vem nulo */
  por_forma: Array<{ forma: string; valor: string }>
  /** O servidor já nomeia "Sem convênio" — nunca vem nulo */
  por_convenio: Array<{ convenio: string; valor: string }>
  /**
   * `itens` (a data e a criança de cada sessão) SÓ com `agenda.ver`: sem ela vem só a `quantidade` —
   * e a tela diz por que a lista não está ali, em vez de desenhar uma lista vazia.
   */
  sem_pagamento: { quantidade: number; itens?: SessaoSemPagamento[] }
}

export interface PainelDoProfissional extends BaseDoPainel {
  profissional: { id: number; nome: string; foto_versao: string | null }
  /** `agenda.ver` + o eixo agenda alcançando este profissional */
  agenda?: PainelDaAgenda
  /** A LINHA dele na produtividade do mês inteiro; `null` = permitido, mas sem linha no mês */
  produtividade?: LinhaDeProdutividade | null
  /** `agenda.ver` + `atendimentos.ver` + os dois eixos */
  equipe?: PainelDaEquipe
  /**
   * `pacientes.ver` + `tratamentos.ver` + o eixo agenda: só os pacotes no fim. Sem `tratamentos.ver` a
   * chave nem vem (nunca `{}`). `ativos`, `novos`, `sairam` e `serie_novos` do `PainelDosPacientes` são da
   * CLÍNICA INTEIRA e o servidor os tira da resposta do painel dele (integração, 2026-10-15).
   */
  pacientes?: Required<Pick<PainelDosPacientes, 'pacotes_no_fim'>>
  /** Vem com a `produtividade` OU com o `financeiro` — ver `MesDaSerieDoProfissional` */
  serie?: MesDaSerieDoProfissional[]
  financeiro?: FinanceiroDoProfissional
}
