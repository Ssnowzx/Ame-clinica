import type { StatusAgendamento } from '@/tipos'

/**
 * As flags com que um status NOVO nasce — a fonte única.
 *
 * A confirmação de regra só dispara para o que FOGE deste padrão. Se a tela
 * derivasse os defaults por conta própria, alguém trocaria um deles um dia e a
 * confirmação sumiria sem nenhum teste quebrar (§2 furada em silêncio).
 */
export const FLAGS_DO_STATUS_NOVO = {
  desconta_sessao: false,
  ocupa_horario: true,
  marca_falta: false,
  marca_reserva: false,
  em_aberto: false,
  aplicavel_em_lote: false,
} as const

/** Os valores do formulário de status (strings, como todo formulário). */
export interface ValoresDoStatus {
  nome: string
  cor: string
  cor_borda: string
  desconta_sessao: boolean
  ocupa_horario: boolean
  marca_falta: boolean
  marca_reserva: boolean
  em_aberto: boolean
  aplicavel_em_lote: boolean
  tipo: string
  ordem: string
}

/**
 * O que a clínica vai VER acontecer ao mudar cada flag de regra (§13 + §2).
 *
 * Estas frases são o núcleo desta tela, e a versão óbvia delas MENTE. O
 * comportamento real do servidor (`ConsumoSessaoService`) é mais sutil:
 *
 * - o flip da flag **não varre** os agendamentos existentes — ninguém perde nem
 *   recupera sessão no instante em que a flag muda;
 * - **mas** `reconciliar()` roda em TODA mutação do agendamento e lê a flag
 *   **viva**. Um agendamento antigo, parado naquele status, que for editado
 *   depois (alguém corrige a observação, move o horário) será reconciliado sob a
 *   regra NOVA — e aí a sessão é consumida ou devolvida;
 * - e se aquele agendamento já foi **faturado**, o estorno é recusado (422): o
 *   agendamento fica **inéditavel** até o lançamento no caixa ser resolvido.
 *
 * Dizer "não afeta os agendamentos anteriores" seria, portanto, uma tela que
 * mente — e é a promessa que o balcão descobriria errada da pior maneira.
 */
export function consequenciasDaRegra(
  valores: ValoresDoStatus,
  original?: StatusAgendamento,
): readonly string[] {
  const consequencias: string[] = []
  const nome = valores.nome === '' ? 'este status' : valores.nome

  const mudou = (flag: keyof typeof FLAGS_DO_STATUS_NOVO): boolean =>
    original === undefined
      ? valores[flag] !== FLAGS_DO_STATUS_NOVO[flag]
      : valores[flag] !== original[flag]

  if (mudou('desconta_sessao')) {
    consequencias.push(
      valores.desconta_sessao
        ? `A partir de agora, pôr um agendamento em "${nome}" passa a consumir uma sessão do tratamento do paciente. Os agendamentos que já estão neste status não mudam agora — mas, ao serem salvos, os que estiverem em data FUTURA serão recusados (não se consome sessão de um atendimento que ainda não aconteceu), e os sem saldo no tratamento também.`
        : `As sessões já descontadas continuam descontadas. Mas o próximo salvamento de cada agendamento em "${nome}" vai DEVOLVER a sessão ao tratamento — e agendamentos já faturados não poderão ser editados até o lançamento ser resolvido.`,
    )
  }

  if (mudou('ocupa_horario')) {
    consequencias.push(
      valores.ocupa_horario
        ? `Agendamentos em "${nome}" voltam a bloquear o horário: o mesmo horário deixa de aceitar um segundo agendamento.`
        : `Agendamentos em "${nome}" deixam de bloquear o horário — o mesmo horário poderá ser marcado de novo, para outro paciente.`,
    )
  }

  if (mudou('marca_falta')) {
    consequencias.push(
      valores.marca_falta
        ? `Agendamentos em "${nome}" passam a contar como falta no alerta de faltas consecutivas.`
        : `Agendamentos em "${nome}" deixam de contar como falta no alerta de faltas consecutivas.`,
    )
  }

  if (mudou('marca_reserva')) {
    consequencias.push(
      valores.marca_reserva
        ? `Agendamentos em "${nome}" passam a ser reserva de horário: só recebem lembrete quando a clínica pede que reservas sejam lembradas.`
        : `Agendamentos em "${nome}" deixam de ser reserva de horário e voltam a receber o lembrete como qualquer agendamento.`,
    )
  }

  // change baixa-em-lote-por-status: as duas flags do lote. Os INVARIANTES (em aberto não
  // desconta, não marca falta/reserva, não libera o horário; em aberto e opção de baixa nunca
  // juntos; o inicial é em aberto) são do SERVIDOR — a tela diz a consequência e mostra a recusa.
  if (mudou('em_aberto')) {
    consequencias.push(
      valores.em_aberto
        ? `Agendamentos em "${nome}" passam a contar como ainda sem desfecho: entram na baixa em lote da agenda, pelo botão Dar baixa.`
        : `Agendamentos em "${nome}" deixam de entrar na baixa em lote da agenda — o botão Dar baixa não os alcança mais.`,
    )
  }

  if (mudou('aplicavel_em_lote')) {
    consequencias.push(
      valores.aplicavel_em_lote
        ? `"${nome}" passa a aparecer como opção no botão Dar baixa da agenda, para toda a agenda em aberto de um profissional de uma vez.`
        : `"${nome}" deixa de aparecer como opção no botão Dar baixa da agenda.`,
    )
  }

  return consequencias
}
