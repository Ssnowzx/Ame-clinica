/** Cadastros e configurações que a grade consome (payload REAL da API). */

import type { TipoDeCorteDoCiclo } from '@/tipos/ciclos'
import type { InteressadoDoLancamento, TipoLancamento } from '@/tipos/financeiro'
import type { BlocoTarefas } from '@/tipos/tarefas'

export interface Especialidade {
  id: number
  nome: string
  /** Hex do cadastro da clínica — NUNCA vira estilo sem passar pelo cor-status */
  cor: string
  tempo_sessao: number
  /** Exige termo de consentimento assinado antes do atendimento */
  exige_termo: boolean
  oculta_agendamento_online: boolean
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/** A especialidade como a GRADE a usa: cor do card e tempo da sessão. Sem as flags do cadastro. */
export interface EspecialidadeDaAgenda {
  id: number
  nome: string
  cor: string
  tempo_sessao: number
}

/**
 * O profissional como a GRADE o desenha — e nada além.
 *
 * Vem de `/agenda/selecao` (sob `agenda.ver`), que devolve **só os ativos**: por isso não há
 * `ativo` aqui. Um campo que é sempre `true` convida a um filtro que nunca filtra — código morto
 * que mente sobre o que garante.
 *
 * Conselho, CBO e contato NÃO entram: são CADASTRO, e continuam exigindo `profissionais.ver`.
 */
/** Um intervalo de atendimento num dia (formato "HH:MM"). */
export interface IntervaloDeAtendimento {
  inicio: string
  fim: string
}

/**
 * Horários de atendimento por dia (change horarios-por-dia-do-profissional): a chave é o dia
 * ISO ("1"=segunda…"7"=domingo) e o valor é a lista de intervalos daquele dia (turno partido).
 * Mapa VAZIO (`{}`) = sem horários = atende todos os dias na janela padrão da clínica.
 */
export type HorariosPorDia = Record<string, IntervaloDeAtendimento[]>

export interface ProfissionalDaAgenda {
  id: number
  nome: string
  /** Só com `?com_desligados=1` (sob `repasse.ver`): `false` = desligado. Sem o pedido, todos são ativos. */
  ativo?: boolean
  /** versão da foto do cadastro (`/api/profissionais/{id}/foto?v=`); `null` = iniciais no avatar */
  foto_versao: string | null
  /**
   * A linha da lista lateral ("Atende só pela manhã") — observação de AGENDA.
   *
   * OPCIONAL de verdade: a API só a manda sob `agenda.ver|agenda.criar`. Quem administra a FILA
   * recebe o profissional SEM ela — e um tipo que promete campo que a API não manda é exatamente
   * o mecanismo que fez a grade parar de pintar feriado (o `!undefined` que descartava tudo).
   */
  obs?: string | null
  /**
   * Horários de atendimento por dia (mapa dia→intervalos). `undefined`/ausente para quem só
   * administra a fila; `{}` = sem horários = todos os dias na janela padrão. Como a `obs`, só cruza
   * sob `agenda.ver|agenda.criar` — é o que a grade precisa para pintar o indisponível na coluna dele.
   */
  horarios?: HorariosPorDia
  /**
   * Quantos atendimentos este profissional sustenta no MESMO horário (change
   * atendimento-em-grupo). A grade decide com ele se a célula ainda convida a marcar.
   *
   * OPCIONAL como a `obs` e os `horarios`: só cruza sob `agenda.ver|agenda.criar`, e um
   * deploy fora de ordem pode servir um payload anterior. Ausente ⇒ 1, que é a posição
   * segura: a célula toma o horário no primeiro card, como sempre tomou.
   */
  atendimentos_simultaneos?: number
  especialidades: Array<{ id: number; nome: string }>
}

export interface StatusAgendamento {
  id: number
  nome: string
  cor: string
  cor_borda: string | null
  /** Slug do ícone (catálogo do backend); null → ícone neutro */
  tipo: string | null
  /** REGRA (§13): o agendamento neste status consome uma sessão do tratamento */
  desconta_sessao: boolean
  /** REGRA: o card bloqueia o slot (e portanto entra na verificação de conflito) */
  ocupa_horario: boolean
  /** REGRA: conta como falta nos alertas */
  marca_falta: boolean
  /** REGRA: é reserva de horário — só entra no lembrete quando a clínica pede que reservas sejam lembradas */
  marca_reserva: boolean
  /**
   * REGRA (change `baixa-em-lote-por-status`): o agendamento ainda não teve desfecho — é o que
   * ENTRA na baixa em lote da agenda. O servidor guarda os invariantes (em aberto não desconta,
   * não marca falta/reserva, não libera o horário; o inicial é em aberto).
   */
  em_aberto: boolean
  /** REGRA: aparece como opção no botão "Dar baixa" da agenda; nunca junto de `em_aberto`. */
  aplicavel_em_lote: boolean
  /**
   * REGRA DISFARÇADA DE DECORAÇÃO: o status de MENOR ordem é o status INICIAL —
   * é com ele que todo agendamento nasce. O servidor guarda o invariante
   * (`GuardaDoStatusInicial`); a tela avisa.
   */
  ordem: number
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface Feriado {
  id: number
  nome: string
  /** "Y-m-d" — se `recorrente`, só dia e mês importam */
  data: string
  recorrente: boolean
  ativo: boolean
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/**
 * O feriado como a GRADE o recebe — de `/agenda/selecao`, que só devolve os ATIVOS.
 *
 * Sem `ativo`, de propósito: um filtro no cliente sobre um campo que o servidor não manda é um
 * filtro que descarta TUDO. Foi o que aconteceu (gate, bloqueante): `!feriado.ativo` com
 * `undefined` é `true`, e a grade parou de pintar QUALQUER feriado — quebrando exatamente o que
 * esta change veio consertar. O tipo prometia um campo que a API não mandava, e o `tsc` ficou
 * verde porque a mentira estava no tipo.
 */
export interface FeriadoDaAgenda {
  id: number
  nome: string
  data: string
  recorrente: boolean
}

export type FimDeSemana = 'nenhum' | 'sabado' | 'domingo' | 'ambos'
export type VisaoAgenda = 'dia' | 'semana' | 'geral'

/** Configuração de EXIBIÇÃO da grade (GET /api/agenda/configuracoes) */
export interface ConfiguracaoAgenda {
  granularidadeMin: number
  fimDeSemana: FimDeSemana
  visaoPadrao: VisaoAgenda
  janelaPadraoInicio: string
  janelaPadraoFim: string
  timezone: string
  /**
   * REGRA É DADO (§13). O servidor recusa a evolução sem responsável técnico quando esta
   * flag está ligada — e a tela precisa LER o dado, não adivinhá-lo: sem isto, ligar a
   * configuração tornava impossível registrar qualquer evolução (422 num campo inexistente).
   */
  responsavelTecnicoObrigatorio: boolean
  /**
   * O status que salvar a evolução aplica (change evolucao-finaliza-a-sessao); 0 = desligado. A tela
   * só o usa para AVISAR antes do clique, conferindo as flags dele na seleção (gate CR-EVO-14: um id
   * positivo não basta — o status pode ter deixado de finalizar). Quem decide é o servidor.
   */
  statusAoSalvarEvolucao: number
  /**
   * Gesto de arrastar o card para remarcar (§6, change arrastar-para-remarcar): on/off pela
   * clínica. Default `false` (D4, fail-safe — sem config, sem gesto); a clínica liga no
   * go-live. A afordância ainda exige `agenda.editar` — a config sozinha não arrasta nada.
   */
  arrastarParaRemarcar: boolean
}

/** Aniversariante do mês — `{id, nome, dia}`: nunca o nascimento completo (dado de MENOR). */
export interface ItemAniversariante {
  id: number
  nome: string
  dia: number
}

/** Paciente ativo sem consentimento em especialidade com `exige_termo`. */
export interface ItemTermoPendente {
  id: number
  nome: string
  especialidade: { id: number; nome: string } | null
}

/** Lançamento vencido não-pago — payload mínimo (sem `obs`); valor como STRING decimal. */
export interface ItemLancamentoAtrasado {
  lancamento_id: number
  tipo: TipoLancamento
  /** "Y-m-d" */
  vencimento: string
  valor_liquido: string
  interessado: InteressadoDoLancamento | null
}

/** Paciente cuja sequência de faltas atingiu o limite configurado. */
export interface ItemFaltaConsecutiva {
  paciente: { id: number; nome: string | null }
  faltas_consecutivas: number
  /** "Y-m-d" | null */
  ultima_falta_em: string | null
}

/**
 * Paciente em tratamento ativo que parou de ser agendado (protocolo-de-pendencias).
 *
 * `dias_sem_agendamento` vem CALCULADO do servidor, no fuso da clínica — a tela exibe e
 * nunca refaz a conta. A âncora é `ultima_ocorrencia_em`; quando o pacote foi vendido e
 * NUNCA agendado ela é nula, e a contagem parte de `inicio_tratamento_em`.
 */
export interface ItemPendenciaDeRetorno {
  paciente: { id: number; nome: string; nome_social: string | null }
  dias_sem_agendamento: number | null
  /** "Y-m-d" | null — null quando nunca houve sessão */
  ultima_ocorrencia_em: string | null
  /** "Y-m-d" | null */
  inicio_tratamento_em: string | null
  /** Especialidades dos tratamentos ativos: orientam O QUE agendar */
  especialidades: Array<{ id: number; nome: string }>
}

/**
 * Um DIA com sessões cuja família pediu para desmarcar pelo botão do lembrete e a recepção ainda
 * não resolveu (change lembrete-com-botoes-de-resposta). Só a data e a contagem: o nome da criança
 * mora na agenda, não no centro de notificações.
 */
interface ItemPedidoDeDesmarque {
  /** "Y-m-d" na parede da clínica */
  dia: string
  total: number
}

export interface ItemInformativo {
  id: number
  titulo: string
  corpo: string
  /** "Y-m-d H:i" */
  publicado_em: string
}

/**
 * Pedido médico de um tratamento EM ANDAMENTO, vencido ou a vencer (change
 * limites-e-pedidos-por-convenio, D5). Whitelist do parecer SEC-LP-02: NUNCA
 * `pedido_sessoes_por_semana`, matrícula/guia, nascimento ou necessidade — o item
 * identifica o tratamento e o paciente no MESMO nível dos blocos existentes.
 * Linguagem §14 (SEC-LP-13): é "pedido médico", nunca "guia"/TISS.
 */
export interface ItemPedidoMedico {
  tratamento_id: number
  paciente: { id: number; nome: string; nome_social: string | null }
  convenio: { id: number; nome: string }
  especialidade: { id: number; nome: string } | null
  /** DECIDIDO NO SERVIDOR (fuso da clínica) — a tela exibe, nunca compara datas */
  vencido: boolean
  /**
   * "Y-m-d" — vencimento DERIVADO no servidor (emissão + validade do convênio).
   *
   * `null` porque o servidor o tipa `?string`: o bloco lista o pedido do tratamento em
   * andamento, e a data-limite pode não existir (convênio sem validade em meses). Prometer
   * `string` aqui era a mentira de tipo que a lição do `FeriadoDaAgenda` proíbe — a tela
   * formataria `undefined` e a linha viria quebrada, com o `tsc` verde.
   */
  vence_em: string | null
  /** Dias até vencer; `null` quando já vencido */
  vence_em_dias: number | null
}

/**
 * Pacote no FIM (change alerta-de-fim-de-pacote, D1) — sob `tratamentos.ver`.
 *
 * Whitelist deliberada: quem vai cobrar precisa saber QUEM, de QUE pacote e quanto FALTA.
 * Sem nascimento, sem CPF, sem carteirinha, sem observação — o resto está na ficha, atrás
 * da permissão dela. Mesma classe dos demais blocos que nomeiam menor.
 */
export interface ItemPacoteAcabando {
  tratamento_id: number
  paciente: { id: number; nome: string; nome_social: string | null }
  convenio: { id: number; nome: string; particular: boolean } | null
  especialidade: { id: number; nome: string } | null
  /** Sessões contratadas — SEMPRE > 1 aqui (sessão única não tem fim de pacote) */
  sessoes_total: number
  /** Quantas faltam */
  sessoes_saldo: number
}

/** Um bloco do centro de notificações — ausência ≠ zero (o bloco não vem) */
export interface BlocoNotificacao<T = unknown> {
  /** Total REAL do bloco — `itens` é amostra com teto (50); exiba o total, nunca o length */
  total: number
  itens: T[]
}

/**
 * Bloco de evoluções em aberto com o aviso da trava do finalizar (change
 * trava-de-evolucao, D3): os campos SÓ chegam para o usuário escopado a um
 * profissional, e chegam PRONTOS do servidor — a tela nunca lê a regra crua
 * (prazo/carência não são chaves de exibição).
 */
export interface BlocoEvolucoesEmAberto extends BlocoNotificacao {
  /** Pendências VENCIDAS do profissional (subconjunto do total em aberto). */
  vencidas?: number
  /** Dias até a trava do finalizar; `0` = já travado; `null` = sem vencida (sem alarme). */
  bloqueio_em_dias?: number | null
}

/**
 * Só os blocos que o usuário tem permissão de ver chegam nesta resposta.
 * Os itens de evoluções ficam `unknown` de propósito: o contador é LINK direto
 * para a fila — o painel nunca os renderiza (spec app-shell).
 */
export interface ItemConversaNaoLida {
  id: number
  /** nome da criança OU telefone — nunca os dois, nunca mais que isso */
  quem: string
  nao_lidas: number
  quando: string | null
}

/** Um envio esperando conferência — só o instante; o conteúdo mora na fila, não aqui. */
export interface ItemCadastroRecebido {
  id: number
  enviado_em: string
}

export interface Notificacoes {
  evolucoes_em_aberto?: BlocoEvolucoesEmAberto
  aniversariantes?: BlocoNotificacao<ItemAniversariante>
  termos_pendentes?: BlocoNotificacao<ItemTermoPendente>
  lancamentos_em_atraso?: BlocoNotificacao<ItemLancamentoAtrasado>
  faltas_consecutivas?: BlocoNotificacao<ItemFaltaConsecutiva>
  /** Só chega sob `agenda.ver` — a pendência é a AUSÊNCIA de horário (design D6) */
  pendencias_de_retorno?: BlocoNotificacao<ItemPendenciaDeRetorno>
  /**
   * Só chega sob `agenda.ver`, no escopo do eixo AGENDA (a escopada vê só a própria agenda). O
   * `total` é de SESSÕES; os `itens` são DIAS — o tamanho da lista não se compara com o total.
   */
  pedidos_de_desmarque?: BlocoNotificacao<ItemPedidoDeDesmarque>
  /** Só chega sob `tratamentos.ver` (SEC-LP-02) — ausente, o bloco não existe */
  pedidos_medicos?: BlocoNotificacao<ItemPedidoMedico>
  /** Só chega sob `tratamentos.ver` — pacotes que estão acabando e ninguém cobrou */
  pacotes_acabando?: BlocoNotificacao<ItemPacoteAcabando>
  /** Só chega sob `tarefas.ver` — ESTADO atual do mural (kanban-da-equipe, D5) */
  tarefas?: BlocoTarefas
  /**
   * Só chega sob `cadastro_online.conferir` — o que as famílias enviaram pelo link e ninguém
   * conferiu. SEM o nome da criança: o centro fica aberto em tela de balcão, e o item só precisa
   * dizer que há algo esperando (change cadastro-online-do-paciente).
   */
  cadastros_recebidos?: BlocoNotificacao<ItemCadastroRecebido>
  /**
   * Só chega sob `mensagens.ver` — conversas de WhatsApp esperando resposta.
   * SEM trecho do conteúdo: o centro fica aberto em tela compartilhada de balcão, e o
   * teor da conversa é dado de menor (mensageria-whatsapp).
   */
  mensagens?: BlocoNotificacao<ItemConversaNaoLida>
  informativos?: BlocoNotificacao<ItemInformativo>
}

// ── Cadastros de apoio (payload REAL das telas de catálogo) ──────────────────

export interface Sala {
  id: number
  nome: string
  /** quantos atendimentos sobrepostos a sala aceita (change atendimento-em-grupo); 1 = a de sempre */
  capacidade: number
  ativo: boolean
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface Equipamento {
  id: number
  nome: string
  quantidade_total: number
  especialidade_id: number | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/**
 * Convênio: cadastro e preço. Os campos de integração (ANS/TISS) são
 * **armazenamento dormente** (§14) — pontos de contato com o sistema irmão
 * `gestao_de_convenios`. Este sistema NÃO faz guia, TISS nem faturamento.
 */
export interface Convenio {
  id: number
  nome: string
  registro_ans: string | null
  codigo_operadora: string | null
  versao_tiss: string | null
  /** FLAG de configuração (a guia é numerada em sequência) — NUNCA um contador */
  guia_sequencial: boolean
  alerta_agend_mesmo_dia: boolean
  /** Blob sem shape na API: exibido como inerte, NUNCA editável (parecer SEC-CA-04) */
  flags_tiss_json: Record<string, unknown> | null
  /**
   * REGRA (§14/T-fin-17): convênio particular tem o tratamento LANÇADO NO CAIXA;
   * convênio de plano, não (o faturamento é do sistema irmão). A tela precisa
   * ENXERGAR essa flag — quem não a enxerga não tem como preservá-la, e o cadastro
   * a apagava a cada edição (gate CR-CA-01).
   */
  particular: boolean
  /**
   * Validade do pedido médico deste convênio, em MESES (1..36; change
   * limites-e-pedidos-por-convenio, D4). É o dado por operadora (Unimed 6 ·
   * SC Saúde 3) — entra por cadastro, nunca por código. `null` ⇒ o sistema não
   * deriva vencimento de pedido para tratamentos deste convênio (sem alarme falso).
   */
  pedido_validade_meses: number | null
  /**
   * Calendário do ciclo de faturamento (change fechamento-de-ciclo, D1) — DADO por
   * operadora, como a validade do pedido. `null` nos DOIS ⇒ o convênio não tem ciclo e
   * nada muda para ele (fail-safe): nenhum período é derivável, nada é congelado.
   *
   * `ciclo_dia_corte` só faz sentido com `ciclo_tipo_corte: 'dia_fixo'`, e vai de 1 a 28
   * (SEC-FC-21 — 29..31 abriria buraco no calendário em mês curto).
   */
  ciclo_dia_corte: number | null
  ciclo_tipo_corte: TipoDeCorteDoCiclo | null
  ativo: boolean
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/** Domínio FECHADO das regras de limite (§13 — regra é DADO, o enum é do banco). */
export type PeriodoDaRegraDeLimite = 'dia' | 'semana' | 'mes'
export type AcaoDaRegraDeLimite = 'bloquear' | 'avisar'

/**
 * Regra de limite do convênio (change limites-e-pedidos-por-convenio, D1) —
 * filha do convênio, como a tabela de serviços (rota aninhada, SEC-LP-07):
 * convênio × especialidade (ou todas) × período × limite × ação. A GUARDA roda no
 * servidor; a tela só cadastra o dado — nenhum payload de agenda serializa a
 * regra (SEC-LP-08), só o sinal derivado (`alerta_limite`).
 */
export interface RegraLimiteConvenio {
  id: number
  /** O convênio dono da regra — o serializer o envia (rota aninhada, mas o dado vem) */
  convenio_id: number
  /** `null` = vale para TODAS as especialidades (a específica vence a geral, D2) */
  especialidade_id: number | null
  especialidade: { id: number; nome: string } | null
  periodo: PeriodoDaRegraDeLimite
  /** 1..99 — sessões do MESMO paciente no período */
  limite: number
  acao: AcaoDaRegraDeLimite
  /** token da concorrência otimista (If-Match) — paridade com `servicos` */
  updated_at: string
}

export interface Servico {
  id: number
  convenio_id: number
  procedimento: string
  /**
   * Código do procedimento na tabela da OPERADORA (change codigo-do-procedimento-no-servico).
   * Opcional e SEM comportamento: referência para a clínica conferir com o portal do plano, e
   * ponto de integração da fase 2 (§14). Não entra em preço, recibo nem faturamento.
   */
  codigo_procedimento: string | null
  /** decimal(0,2) — chega como string ou número conforme o driver */
  valor: string | number
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

export interface Medico {
  id: number
  nome: string
  conselho: string
  uf_conselho: string
  num_conselho: string
  cbos_id: number | null
  codigos_operadora_json: Record<string, string> | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}
