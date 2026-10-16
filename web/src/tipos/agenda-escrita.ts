import type { AvisoAFamilia } from '@/tipos/agenda'
import type { EspecialidadeDaAgenda, FeriadoDaAgenda, ProfissionalDaAgenda } from '@/tipos/catalogos'

/** Payloads de ESCRITA da agenda (o tipo de leitura vive em `agenda.ts`). */

/**
 * Campos que o formulário envia. Tudo opcional porque o payload é montado pelo
 * MODO (bloqueio proíbe os campos clínicos) e pela mutação de série (que envia
 * só o que mudou) — mandar `undefined` é diferente de mandar `null`.
 */
export interface PayloadAgendamento {
  tipo?: 'atendimento' | 'bloqueio'
  /** "Y-m-d H:i" no fuso da clínica — nunca ISO com Z */
  inicio: string
  fim?: string | null
  duracao_minutos?: number | null
  profissional_id: number
  paciente_id?: number | null
  especialidade_id?: number | null
  tratamento_id?: number | null
  sala_id?: number | null
  equipamento_id?: number | null
  medico_id?: number | null
  status_id?: number | null
  obs?: string | null
  is_reposicao?: boolean
  reposicao_de_id?: number | null
  /** Só no POST: série semanal até esta data ("Y-m-d") */
  /**
   * A série (change `repeticao-da-serie`): o intervalo em SEMANAS (1 = semanal, 2 = quinzenal;
   * omitido vale 1) e o término por UM dos dois modos — `ate` OU `ocorrencias`. O servidor
   * recusa os dois juntos e a ausência dos dois.
   */
  recorrencia?: { intervalo_semanas?: number; ate?: string; ocorrencias?: number }
  /** Só no PUT/DELETE: alcança os seguintes da série */
  aplicar_na_serie?: boolean
  /** Pedido explícito de avisar a família pelo WhatsApp (a clínica mudou o horário) */
  avisar_familia?: boolean
}

/**
 * Payload PARCIAL da remarcação por arrasto/teclado (change arrastar-para-remarcar, D2,
 * corrigido na verificação ao vivo de 2026-07-19): SOMENTE o alvo tempo/profissional cruza —
 * paciente, especialidade e demais vínculos JAMAIS entram (o UPDATE trata os vínculos como
 * `sometimes` e a edição parcial preserva o que não foi tocado). `profissional_id` vai
 * SEMPRE: o contrato do PUT o exige `required` incondicional (arrasto Ana→Ana dava 422).
 */
export interface PayloadRemarcacao {
  /** "Y-m-d H:i" no fuso da clínica — nunca ISO com Z */
  inicio: string
  /** SEMPRE o do alvo — sem troca de profissional, é o mesmo id que já estava no card */
  profissional_id: number
  /** Alcança os seguintes da série (o MESMO prompt do formulário) */
  aplicar_na_serie?: boolean
  /** Pedido explícito de avisar a família pelo WhatsApp (a clínica mudou o horário) */
  avisar_familia?: boolean
}

/** Resposta da criação em série. */
export interface SerieCriada {
  criados: number
  recorrencia_grupo_id: string
  /** ver `CardAgendamento.alerta_paciente` — aqui vem uma data por ocorrência em choque */
  alerta_paciente?: string[] | null
  /** a confirmação do primeiro agendamento, uma pela série */
  aviso_familia?: AvisoAFamilia
}

/**
 * Tamanho REAL da série (GET /api/agendamentos/{id}/serie).
 * A tela NÃO conta irmãos: ela só conhece o período consultado.
 */
export interface TamanhoDaSerie {
  em_serie: boolean
  total: number
  /** Alcance do DELETE em série (inclui este) */
  a_partir_deste: number
  /** Alcance do `aplicar_na_serie` do PUT (não inclui este) */
  futuros: number
}

/** Catálogos do formulário (GET /api/agenda/selecao). */
export interface SelecaoDaAgenda {
  profissionais: ProfissionalDaAgenda[]
  especialidades: EspecialidadeDaAgenda[]
  /**
   * Os feriados que a GRADE pinta. Vinham de `GET /feriados` (atrás de `feriados.ver`), e um
   * nível com `agenda.ver` e nada mais levava 403: a permissão que dá a TELA não dava o que a
   * tela precisa para EXIBIR.
   */
  feriados: FeriadoDaAgenda[]
  salas: Array<{ id: number; nome: string }>
  equipamentos: Array<{ id: number; nome: string; especialidade_id: number | null }>
  medicos: Array<{ id: number; nome: string }>
  /** `desconta_sessao` é o que decide se a mudança de status precisa confirmar (§2) */
  status: Array<{
    id: number
    nome: string
    cor: string
    cor_borda: string | null
    tipo: string | null
    ordem: number
    desconta_sessao: boolean
    /** Status de falta: o painel deriva dele que NÃO se oferece "Iniciar atendimento" (Decisão 2b) */
    marca_falta: boolean
    /** Opção oferecida pelo "Dar baixa" da agenda (change `baixa-em-lote-por-status`, D13) */
    aplicavel_em_lote: boolean
    /**
     * Sem desfecho — a sessão que salvar a evolução pode finalizar (evolucao-finaliza-a-sessao). O
     * painel só AVISA antes do clique. Ausente (payload anterior) = não promete nada.
     */
    em_aberto?: boolean
    /**
     * É o status do desmarque do profissional configurado pela clínica: escolhê-lo pelo card
     * pergunta antes, com "Avisar a família pelo WhatsApp" já marcado (avisos-do-agendamento).
     */
    desmarque_da_clinica?: boolean
    /**
     * É o status do desmarque PELA FAMÍLIA configurado pela clínica (change
     * lembrete-com-botoes-de-resposta): o "Desmarcar (a família pediu)" do cartão aplica este.
     * No máximo um vem `true`; nenhum, e o botão abre o menu de status.
     */
    desmarque_da_familia?: boolean
    /**
     * Ocupa o horário e não é reserva: só a partir de uma sessão MARCADA a tela oferece o aviso de
     * cancelamento — "cancelado pela clínica" sobre sessão já desmarcada é mensagem falsa (SEC-AV-16).
     */
    sessao_marcada?: boolean
  }>
}

// ── Baixa em lote por status (change `baixa-em-lote-por-status`) ─────────────

/** O alcance da baixa — o MESMO objeto na prévia e na execução (design D1/D3). */
export interface AlcanceDaBaixa {
  profissionalId: number
  statusId: number
  /** "Y-m-d" — inclusivo; o servidor recusa `ate` depois de hoje na parede da clínica */
  de: string
  ate: string
}

/**
 * Uma linha que fica de fora, SEM nome de criança (D17): `id` e `inicio` bastam para o gesto
 * "Ver na agenda". `motivo` é uma das constantes `RECUSA_*` do servidor ou a frase crua de uma
 * recusa do domínio que a prévia não antecipa.
 */
export interface RecusaDaBaixa {
  id: number
  /** "Y-m-d H:i" na parede da clínica */
  inicio: string
  motivo: string
}

/** Prévia da baixa (POST /agendamentos/baixa-em-lote/previa) — não escreve nada. */
export interface PreviaDaBaixa {
  status: { id: number; nome: string; desconta_sessao: boolean; marca_falta: boolean }
  contagens: {
    agendamentos: number
    criancas: number
    sessoes_a_descontar: number
    sem_pacote: number
    ja_consumidas: number
    com_atendimento_registrado: number
  }
  recusados: RecusaDaBaixa[]
  /**
   * `evolucoes_vencidas` só é calculado quando o alvo DESCONTA (spec "Evoluções vencidas são
   * informadas, não travam"); para "Falta Justificada" a API devolve `avisos: {}` — a chave-mãe
   * é sempre objeto, a filha é opcional (conferido ao vivo contra a API real em 2026-09-11).
   */
  avisos: { evolucoes_vencidas?: number }
  /** O número que ela leu é o número que roda (D5): os dois voltam na execução. */
  assinatura: string
  /** "Y-m-d H:i" — o minuto em que a prévia foi calculada */
  referencia: string
}

/** Resultado da execução (POST /agendamentos/baixa-em-lote). */
export interface ResultadoDaBaixa {
  lote_id: string
  aplicados: number
  contagens: { criancas: number; sessoes_descontadas: number }
  recusados: RecusaDaBaixa[]
}

/**
 * O que a execução pode devolver SEM ser falha de rede/servidor. Os dois 409 desta rota são
 * PERGUNTAS ao operador (a prévia envelheceu; o ciclo está sendo fechado), não conflitos de
 * concorrência otimista — por isso não passam pelo funil do interceptador (T-ds-05: a tela é
 * dona do texto, daqui sai o FATO).
 */
export type DesfechoDaBaixa =
  | { tipo: 'aplicada'; resultado: ResultadoDaBaixa }
  | { tipo: 'previa_desatualizada'; previa: PreviaDaBaixa }
  | { tipo: 'ciclo_em_alteracao' }

/** Paciente na busca do formulário — nome e nada mais (LGPD). */
export interface PacienteDaBusca {
  id: number
  nome: string
  nome_social: string | null
}

/** Tratamento na seleção do formulário. */
export interface TratamentoDaSelecao {
  id: number
  especialidade_id: number
  status: string
  sessoes_total: number
  sessoes_saldo: number
  vencido: boolean
}
