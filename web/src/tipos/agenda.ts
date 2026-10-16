export type RealceDoPacote = 'nenhum' | 'acabando' | 'sem-saldo'

/** O card da grade (payload REAL de GET /api/agenda). */

export interface PacienteDoCard {
  id: number
  nome: string
  nome_social: string | null
  // Necessidade especial (dado de saúde, art. 11) NÃO cruza pelo card da grade: o
  // whitelist mínimo do `ResumoDoPaciente` é id/nome/nome_social. O marcador do painel
  // vem do `show` (CardAgendamento.necessidade_especial), sob demanda. NUNCA aqui.
}

export interface EspecialidadeDoCard {
  id: number
  nome: string
  cor: string
}

export interface StatusDoCard {
  id: number
  nome: string
  cor: string
  cor_borda: string | null
  /** Slug do ícone vindo do cadastro; desconhecido/null → ícone neutro */
  tipo: string | null
  /**
   * A situação segura o horário? É a MESMA flag que o servidor usa para decidir conflito, e é o
   * que deixa a grade concordar com ele: situação que libera devolve o slot ao "Marcar às".
   *
   * Só o cartão da GRADE a manda — os outros payloads que reusam este tipo (ficha, presença,
   * comparecimento) não precisam dela. E opcional também porque um deploy fora de ordem pode
   * servir o payload anterior: ausente vale OCUPA, que é a posição segura.
   */
  ocupa_horario?: boolean
}

/**
 * Convênio do tratamento — dado DESTE sistema (§14). `particular` é flag do
 * cadastro: distinguir particular NUNCA é comparar o nome.
 * Guia/autorização/glosa pertencem ao gestao_de_convenios (Fase 2).
 */
export interface ConvenioDoCard {
  id: number
  nome: string
  particular: boolean
}

/**
 * A resposta da família ao lembrete DAQUELA data (change lembrete-com-botoes-de-resposta, D8).
 * Decidida no SERVIDOR: a tela só escolhe o ícone e as palavras.
 */
export type EstadoDaConfirmacao = 'aguardando' | 'confirmado' | 'pediu_desmarque' | 'nao_entregue' | 'nao_enviado'

export interface ConfirmacaoDoCard {
  estado: EstadoDaConfirmacao
  /** ISO 8601 com fuso — só em `confirmado` e `pediu_desmarque` (a hora do toque) */
  em: string | null
  /** Só em `nao_enviado`: por que o lembrete não saiu, em pt-BR, como o servidor gravou */
  motivo?: string
  /**
   * Só em `confirmado`: quem confirmou — a família pelo botão, ou a clínica registrando o que a
   * família disse por telefone ou mensagem (change confirmacao-pela-clinica)
   */
  por?: 'familia' | 'clinica'
  /**
   * Só em `aguardando`, `nao_entregue` e `nao_enviado`: a clínica pode marcar a sessão como confirmada
   * AGORA — o servidor decide, com a hora da clínica (gate r1, CR-CC-04)
   */
  confirmavel?: boolean
}

export interface CardAgendamento {
  id: number
  tipo: 'atendimento' | 'bloqueio'
  profissional_id: number
  paciente_id: number | null
  tratamento_id: number | null
  status_id: number
  /** "Y-m-d H:i" no fuso da clínica (naive — nunca ISO com Z) */
  inicio: string
  fim: string
  duracao_minutos: number
  is_reposicao: boolean
  /** Só em bloqueio: o rótulo da faixa na grade */
  obs?: string | null
  /**
   * Sinal de SÉRIE (o serializador da API sempre o manda; `null` fora de série).
   * A confirmação da remarcação o usa para RESERVAR a caixa do bloco de série
   * enquanto o tamanho REAL carrega — o alcance continua vindo só do servidor
   * (`GET /agendamentos/{id}/serie`), nunca contado por aqui.
   */
  recorrencia_grupo_id?: string | null
  paciente: PacienteDoCard | null
  especialidade: EspecialidadeDoCard | null
  status: StatusDoCard | null
  profissional: { id: number; nome: string } | null
  sala: { id: number; nome: string } | null
  /** Sessões que ainda restam no tratamento (realizadas = total − saldo) */
  tratamento_saldo: number | null
  tratamento_total: number | null
  /**
   * O VEREDITO do realce de fim de pacote, decidido no SERVIDOR (§13 — o limiar é dado da
   * clínica). A tela só escolhe a pele: âmbar avisa, vermelho bloqueia.
   *
   * O front refazia esta conta com uma constante própria, e faltava-lhe o `status` do
   * tratamento — um pacote parado com saldo baixo ficava realçado na grade enquanto o
   * contador dizia "nenhum".
   */
  tratamento_realce: RealceDoPacote
  convenio: ConvenioDoCard | null
  /**
   * Faltas consecutivas do paciente — só no DETALHE (`show`), nunca no card da grade.
   * O servidor já decide o disparo (`N` é DADO da clínica, §13): presente ⇒ atingiu o
   * limite; `null`/ausente ⇒ não alerta (nunca a tela conta a sequência).
   */
  alerta_faltas?: { consecutivas: number; limite: number } | null
  /**
   * Necessidade especial do paciente — só no DETALHE (`show`), nunca no card da grade
   * (art. 11, SEC-NC-01). BOOLEANO minimizado (nunca a categoria de saúde crua): `true`
   * ⇒ marcador de leitura no painel; `false`/`null`/ausente ⇒ o slot não renderiza.
   */
  necessidade_especial?: boolean | null
  /**
   * Pedido médico do tratamento deste agendamento — só no DETALHE (`show`), nunca no
   * card da grade (SEC-LP-03). O SERVIDOR decide o disparo e conta os dias no fuso da
   * clínica; a tela exibe. `null`/ausente ⇒ sem destaque. "Pedido médico", nunca
   * "guia" (§14/SEC-LP-13).
   */
  alerta_pedido?: { vencido: boolean; vence_em_dias: number | null } | null
  /**
   * Limite do convênio atingido (regra `avisar`, D3) — DERIVADO a cada leitura, só no
   * `show` e na resposta da escrita; nada persiste. Minimizado a limite + período +
   * nome do convênio (SEC-LP-01): NUNCA a contagem atual nem as demais sessões.
   */
  alerta_limite?: { convenio: string; periodo: string; limite: number } | null
  /**
   * Datas (`Y-m-d`) em que a criança já tinha atendimento sobreposto, com a clínica em
   * `agenda.conflito_paciente = avisar` (conflito-do-paciente, D4). Viaja SÓ na resposta da
   * ESCRITA — nunca no `show`, nunca persistido. Lista porque a série avisa por ocorrência.
   */
  alerta_paciente?: string[] | null
  /**
   * Se a família foi avisada pelo WhatsApp (change avisos-do-agendamento-por-whatsapp) — só na
   * resposta da ESCRITA, e só quando um aviso foi tentado (confirmação, remarcação, cancelamento).
   */
  aviso_familia?: AvisoAFamilia
  /**
   * Produção em período fechado do convênio (SEC-TS/SEC-FC-09) — só no DETALHE
   * (`show`), nunca no card da grade. BOOLEANO derivado (nunca a lista de fechamentos):
   * `true` ⇒ a troca de status não é oferecida (a guarda do servidor recusaria com 422
   * `ciclo_fechado`); os demais campos seguem a régua existente.
   */
  em_ciclo_fechado?: boolean
  /**
   * A resposta da família ao lembrete (change lembrete-com-botoes-de-resposta) — só no cartão da
   * GRADE, carregada de uma vez com o período. `null` é sessão sem lembrete daquela data ou que
   * não está mais marcada; ausente é um payload que não a traz (detalhe, deploy fora de ordem).
   */
  confirmacao?: ConfirmacaoDoCard | null
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/**
 * O DETALHE (`GET /agendamentos/{id}`): os ESCALARES do agendamento e os alertas que só o detalhe traz —
 * SEM as relações do cartão da grade (paciente, especialidade, status, profissional, sala, convênio,
 * saldo do pacote, confirmação). Tipado como `CardAgendamento`, ele deixava o `tsc` verde com
 * `profissional.nome` de `undefined`, e a tela inteira caiu ao finalizar pela evolução (gate
 * CR-EVO-R2-01 / A11Y-EVO-R2-01).
 */
export type DetalheDoAgendamento = Omit<
  CardAgendamento,
  | 'paciente'
  | 'especialidade'
  | 'status'
  | 'profissional'
  | 'sala'
  | 'tratamento_saldo'
  | 'tratamento_total'
  | 'tratamento_realce'
  | 'convenio'
  | 'confirmacao'
>

/** Uma linha do comparecimento recente (GET /pacientes/{id}/comparecimento-recente). */
export interface ItemComparecimento {
  id: number
  /** `Y-m-d` na parede da clínica */
  data: string
  especialidade: EspecialidadeDoCard | null
  profissional: { id: number; nome: string } | null
  status: StatusDoCard | null
}

/** O mini-histórico de comparecimento (90 dias) — payload minimizado, sem nada clínico. */
export interface ComparecimentoRecente {
  itens: ItemComparecimento[]
}

/**
 * Um agendamento do paciente na FICHA — como o item do painel, mas com HORA: duas
 * sessões no mesmo dia precisam se distinguir (change agendamentos-na-ficha).
 */
export interface ItemAgendamentoDaFicha {
  id: number
  /** `Y-m-d H:i` na parede da clínica */
  inicio: string
  /**
   * O término, `Y-m-d H:i` (change horario-de-termino-no-card). Opcional porque um deploy fora de
   * ordem pode servir o payload anterior — a tela cai no início sozinho.
   */
  fim?: string
  especialidade: EspecialidadeDoCard | null
  profissional: { id: number; nome: string } | null
  status: StatusDoCard | null
  /**
   * SE existe evolução — nunca o que ela diz. `null` é "não posso saber" (sem `evolucoes.ver`
   * ou fora do escopo clínico daquela linha), e é diferente de `false`. Opcional porque um
   * deploy fora de ordem pode servir o payload anterior.
   */
  tem_evolucao?: boolean | null
}

/** Um bloco da seção Agendamentos — a janela que o servidor respondeu, e os itens dela. */
export interface BlocoDeAgendamentos {
  /** `ate` nulo nos próximos: janela ABERTA declarada, não dado faltando */
  janela: { de: string; ate: string | null }
  total: number
  itens: ItemAgendamentoDaFicha[]
}

/** A seção Agendamentos da ficha: as próximas sessões e os atendimentos recentes. */
export interface AgendamentosDoPaciente {
  proximos: BlocoDeAgendamentos
  recentes: BlocoDeAgendamentos
}

/** Uma FALTA da janela de assiduidade — data + status, nada além. */
export interface FaltaDaPresenca {
  id: number
  /** `Y-m-d` na parede da clínica */
  data: string
  status: StatusDoCard | null
}

/**
 * A assiduidade do paciente (seção Presença da ficha) — TUDO calculado no
 * SERVIDOR (§13): a tela exibe e formata, nunca reconta.
 */
export interface PresencaDoPaciente {
  janela: { de: string; ate: string }
  totais: { compareceu: number; faltas: number; outros: number; total: number }
  /** String decimal ("87.5"); `null` sem base (só "outros") — nunca "0%" fabricado */
  taxa_comparecimento: string | null
  /** A MESMA fonte única do alerta do painel (`ContadorDeFaltasConsecutivas`) */
  faltas_consecutivas: { consecutivas: number; limite: number }
  /** `Y-m-d` | null — a última falta da JANELA (comparecer depois não a apaga) */
  ultima_falta_em: string | null
  /** As faltas itemizadas (teto 50 — `totais.faltas` é o número real) */
  faltas: FaltaDaPresenca[]
  /**
   * A quebra das finalizadas por profissional×especialidade (pedido da clínica) —
   * a soma de `finalizadas` é o PRÓPRIO `totais.compareceu` (uma régua só).
   */
  sessoes_por_profissional: SessaoPorProfissional[]
}

/** Linha da quebra: {id, nome} de EQUIPE apenas — nunca dado novo do menor. */
export interface SessaoPorProfissional {
  profissional: { id: number; nome: string | null } | null
  especialidade: { id: number; nome: string | null } | null
  finalizadas: number
}

/** O resultado de um aviso à família pelo WhatsApp: saiu, ou o motivo de não ter saído. */
export interface AvisoAFamilia {
  enviado: boolean
  motivo: string | null
}
