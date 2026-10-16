/** O atendimento (a sessão que ACONTECEU) e a evolução clínica dela — §7. */

export interface Atendimento {
  id: number
  agendamento_id: number
  /** `Y-m-d H:i` — carimbado pelo SERVIDOR quando a tela não o envia */
  iniciado_em: string | null
  finalizado_em: string
  /**
   * Dado CLÍNICO: a API o cifra em repouso, o mascara na auditoria e o omite das
   * listagens. Só existe no detalhe — e na tela, só no corpo do detalhe.
   */
  observacoes?: string | null
  /**
   * Diz se o prontuário JÁ EXISTE, e por onde buscá-lo. É identificador, nunca
   * conteúdo: revela que a evolução existe, jamais o que ela diz.
   *
   * OPCIONAL de verdade: a API o OMITE de quem não tem `evolucoes.ver` nem
   * `evolucoes.criar` (gate SEC F-03) — `undefined` é "você não pode saber",
   * `null` é "não existe ainda". Tratar os dois como iguais escondia o botão
   * "Escrever evolução" de quem podia escrever (re-review I-1).
   */
  evolucao_id?: number | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/**
 * O DETALHE do atendimento — `GET /atendimentos/{id}`.
 *
 * É um tipo PRÓPRIO porque `em_ciclo_fechado` existe **só aqui** (SEC-FC-09): a API o
 * deixa fora da LISTAGEM de propósito (seriam N consultas por página para pintar um botão
 * que a lista não tem). Prometê-lo na `Atendimento` faria a tela ler `undefined` como
 * `false` numa linha de lista — "pode editar" dito por ausência de dado.
 */
export interface AtendimentoDetalhe extends Atendimento {
  /**
   * A produção do período deste registro já foi fechada? **Booleano DERIVADO pelo
   * servidor**, por registro. É o ÚNICO sinal de ciclo que estas telas recebem: nem a
   * lista de fechamentos, nem o calendário do convênio — senão a afordância viraria
   * oráculo do cadastro de convênios para quem não tem `convenios.ver`.
   */
  em_ciclo_fechado: boolean
}

export interface PayloadAtendimento {
  /**
   * Ausentes de propósito quando o usuário não editou o horário: quem carimba é o
   * servidor, no relógio da CLÍNICA. Mandar o relógio do navegador seria mandar outro fuso.
   */
  iniciado_em?: string
  finalizado_em?: string
  observacoes: string | null
}

export interface Evolucao {
  id: number
  atendimento_id: number
  profissional_id: number
  responsavel_tecnico_id: number | null
  /**
   * Dado de saúde de MENOR (LGPD art. 11). Cifrado em repouso, mascarado na auditoria,
   * fora de toda listagem. Na tela: **só** no corpo do formulário/leitura — nunca em
   * título, toast, erro, URL ou disco.
   */
  conteudo: string
  /** `Y-m-d H:i` — do SERVIDOR, nunca aceito da tela */
  preenchida_em: string
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/**
 * O que salvar a evolução fez com a sessão (change evolucao-finaliza-a-sessao, D2). O status vem
 * DEPOIS da evolução e nunca a derruba: `finalizada: false` com `motivo` é a recusa (pacote sem
 * saldo, data futura, período fechado); sem `motivo`, nada foi tentado (a chave está desligada, ou
 * a sessão já tinha desfecho).
 */
export interface SessaoAoSalvarEvolucao {
  finalizada: boolean
  motivo: string | null
  /**
   * A versão do agendamento (o `updated_at` do If-Match) antes e depois da finalização, lidas sob a
   * trava; `null` quando não finalizou. Quem tem a sessão aberta num formulário só adota a de depois se
   * a de antes for a que ele abriu (gate CR-EVO-R3-02). Ausentes numa API anterior.
   */
  versao_antes?: string | null
  versao_depois?: string | null
}

/** A resposta de registrar a evolução: a evolução e o que aconteceu com a sessão. */
export interface EvolucaoRegistrada extends Evolucao {
  /** Ausente só numa API anterior a esta change — a tela então não promete nada sobre a sessão. */
  sessao?: SessaoAoSalvarEvolucao
}

/** Onde a evolução nasce: no atendimento registrado, ou direto na sessão, que é registrada junto (D1). */
export type DestinoDaEvolucao = { atendimentoId: number } | { agendamentoId: number }

/**
 * O DETALHE da evolução — `GET /evolucoes/{id}`. Mesmo recorte do atendimento: o booleano
 * do ciclo só existe aqui (SEC-FC-09), e a competência dela é a do atendimento-mãe (D3).
 */
export interface EvolucaoDetalhe extends Evolucao {
  /** Derivado pelo servidor a partir do `finalizado_em` do atendimento-mãe (D3). */
  em_ciclo_fechado: boolean
}

/** O que a tela envia ao REGISTRAR — a autoria se define aqui, uma vez. */
export interface PayloadEvolucao {
  profissional_id: number
  responsavel_tecnico_id?: number | null
  conteudo: string
  /**
   * SÓ no ramo da exceção de autoria (FA-04): usuário sem vínculo assinando em
   * nome de outro. Para quem assina em nome próprio, a chave é `missing` no
   * servidor — enviá-la é 422.
   */
  motivo_assinatura?: string
}

/**
 * O que a tela envia ao EDITAR — e `profissional_id` NÃO está aqui, de propósito.
 *
 * Ele é a AUTORIA do prontuário de uma criança. Mandá-lo no PUT com o vínculo de quem abriu
 * fazia quem editasse a evolução de outra profissional **assiná-la com o próprio nome**, em
 * silêncio (a produção e a pendência de evolução migravam junto). O `sometimes` do servidor
 * preserva o valor: **chave ausente é chave preservada**.
 */
export interface PayloadEvolucaoEdicao {
  conteudo: string
  /** SÓ para preencher a lacuna de evolução sem responsável (re-review I-2) — autoria, nunca. */
  responsavel_tecnico_id?: number
}

/** Uma linha da fila: metadados apenas. Conteúdo aqui não existe — a fila é a dos SEM evolução. */
export interface EvolucaoEmAberto {
  atendimento_id: number
  agendamento_id: number
  finalizado_em: string
  paciente: { id: number; nome: string } | null
  profissional: { id: number; nome: string } | null
  /** `Y-m-d` — CALCULADO PELO SERVIDOR (fuso da clínica); a tela não refaz a conta */
  prazo_ate: string | null
  /** CALCULADO PELO SERVIDOR — o navegador pode estar em outro fuso */
  vencida: boolean
}
