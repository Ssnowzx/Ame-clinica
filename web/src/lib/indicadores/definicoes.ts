import { formatarContagem } from '@/lib/numeros'
import { listaEmPalavras, plural } from '@/lib/indicadores/frases'
import type { PainelDaAgenda, PainelDaEquipe } from '@/tipos'

/**
 * O "i" de cada cartão (change indicadores-profissionais, D4/D6): a definição EXATA da conta — o
 * que entra, o que não entra e de que período. Cada parágrafo é uma frase curta; quem discorda de
 * uma definição (a Mariana, no aceite) lê aqui a regra que a função do servidor aplica.
 *
 * Os nomes dos status vêm do CADASTRO (`status_que_contam`), nunca escritos aqui: a clínica muda a
 * flag e o "i" passa a dizer o que conta sem mudar código (§13).
 */
export type Definicao = readonly string[]

const PERIODO =
  'No mês em curso, conta do dia 1 até hoje e compara com os mesmos dias do mês anterior. Mês fechado compara com o mês anterior inteiro. Não há comparação quando o período comparado começa antes do primeiro atendimento da clínica no sistema.'

export const DEFINICAO_DO_RECEBIDO: Definicao = [
  'Tudo o que a clínica recebeu de fato no período, pela data do pagamento (regime de caixa).',
  PERIODO,
]

export const DEFINICAO_DO_A_RECEBER: Definicao = [
  'Receitas ainda não pagas com vencimento entre hoje e o fim do mês.',
  'É outra conta: nada daqui está somado ao recebido.',
]

export const DEFINICAO_DO_ATRASO: Definicao = [
  'Receitas com o vencimento já passado e ainda sem pagamento — o que as famílias e os convênios devem à clínica.',
  'Só o que a clínica tem a RECEBER: as contas a pagar ficam fora. Um lançamento que vence hoje ainda não está em atraso.',
]

export const DEFINICAO_DO_VALOR_MEDIO: Definicao = [
  'A soma das sessões faturadas no período dividida pelo número dessas sessões.',
  'Sem sessão faturada, não há média.',
  PERIODO,
]

export function definicaoDaOcupacao(painel: PainelDaAgenda): Definicao {
  const { profissionais_com_grade: comGrade, profissionais } = painel.ocupacao

  return [
    'Sessões marcadas no período ÷ horários disponíveis na grade dos profissionais.',
    'A grade já desconta feriados e bloqueios. Desmarques não ocupam horário.',
    comGrade >= profissionais
      ? 'Todos os profissionais com sessão têm horário e especialidade cadastrados.'
      : `Só entram os profissionais com horário e especialidade cadastrados: ${formatarContagem(comGrade)} de ${plural(profissionais, 'profissional', 'profissionais')}.`,
    PERIODO,
  ]
}

export const DEFINICAO_DAS_REALIZADAS: Definicao = [
  'Sessões que já passaram com status que desconta a sessão do pacote e não marca falta — a mesma régua da produtividade.',
  'Uma sessão que desconta E marca falta conta como falta, não como realizada.',
  PERIODO,
]

/** Os status pelo nome, em palavras: "Não Compareceu", ou "A e B". */
function statusEmPalavras(nomes: readonly string[]): string {
  return nomes.length === 0 ? 'nenhum status está marcado para isso no cadastro' : listaEmPalavras(nomes.map((nome) => `"${nome}"`))
}

export function definicaoDasFaltas(painel: PainelDaAgenda): Definicao {
  return [
    `Sessões que já passaram com status que marca falta: ${statusEmPalavras(painel.status_que_contam.falta)}.`,
    `A porcentagem é sobre as sessões que já passaram (${formatarContagem(painel.sessoes_passadas.atual)}); as futuras não entram.`,
    'Quem decide o que conta como falta é o cadastro de status.',
  ]
}

export function definicaoDosDesmarques(painel: PainelDaAgenda): Definicao {
  return [
    `Sessões que já passaram com status que libera o horário: ${statusEmPalavras(painel.status_que_contam.desmarque)}.`,
    `A porcentagem é sobre as sessões que já passaram (${formatarContagem(painel.sessoes_passadas.atual)}); as futuras não entram.`,
  ]
}

export function definicaoDasConfirmadas(painel: PainelDaAgenda): Definicao {
  return [
    `Lembretes enviados pelo WhatsApp no período cuja sessão foi confirmada ÷ lembretes enviados (${formatarContagem(painel.confirmadas.atual.enviados)}).`,
    'Conta a confirmação da família, tocando em "Confirmo" no WhatsApp, e a da recepção, marcando a sessão como confirmada.',
    'Conta pela data da sessão lembrada.',
  ]
}

/** Os números da aba Pacientes são da CLÍNICA INTEIRA — só os pacotes no fim seguem a agenda (CR-IND-11). */
const DA_CLINICA_INTEIRA = 'Conta a clínica inteira, mesmo para quem vê só a própria agenda.'

export const DEFINICAO_DOS_ATIVOS: Definicao = [
  'Pacientes com o cadastro ativo hoje. É uma foto do momento, sem comparação.',
  DA_CLINICA_INTEIRA,
]

export const DEFINICAO_DOS_NOVOS: Definicao = [
  'Pacientes cadastrados no período.',
  'Os que vieram do sistema anterior na importação da virada não contam: já eram pacientes da clínica.',
  DA_CLINICA_INTEIRA,
  PERIODO,
]

export const DEFINICAO_DOS_QUE_SAIRAM: Definicao = [
  'Pacientes que passaram de ativo a inativo no período, pela trilha de auditoria. Cada paciente conta uma vez.',
  DA_CLINICA_INTEIRA,
  PERIODO,
]

export const DEFINICAO_DOS_PACOTES_NO_FIM: Definicao = [
  'Pacotes em andamento perto do fim — a mesma regra do aviso "Pacotes acabando".',
  'Segue a agenda de quem olha: quem vê só a própria agenda conta só os pacotes dos próprios pacientes.',
]

export const DEFINICAO_DA_FILA: Definicao = ['Entradas ativas da lista de espera, hoje.', DA_CLINICA_INTEIRA]

export const DEFINICAO_DAS_EVOLUCOES_EM_DIA: Definicao = [
  'Sessões realizadas no período que já têm evolução registrada ÷ sessões realizadas.',
  PERIODO,
]

export function definicaoDasEvolucoesAtrasadas(painel: PainelDaEquipe): Definicao {
  return [
    `Atrasada: atendimento sem evolução há mais de ${plural(painel.evolucoes.prazo_dias, 'dia', 'dias')} (o prazo da clínica, nas configurações).`,
    'Sem evolução: todo atendimento cuja evolução ainda não foi escrita, dentro ou fora do prazo — a mesma conta do aviso de evoluções em aberto.',
  ]
}

export const DEFINICAO_DA_CAPACIDADE: Definicao = [
  'O que cabe na grade do mês: os horários cadastrados, menos feriados e bloqueios.',
  'Quem atende em grupo soma as vagas de cada horário.',
]

export const DEFINICAO_DA_PRODUTIVIDADE: Definicao = [
  'O que foi realizado ÷ a capacidade da grade.',
  'A ocupação mede o que foi MARCADO; a produtividade, o que de fato aconteceu.',
]

// ── O painel do profissional (change painel-do-profissional) ──────────────────────────────────

export const DEFINICAO_DA_OCUPACAO_DO_PROFISSIONAL: Definicao = [
  'Sessões marcadas no período ÷ horários disponíveis na grade deste profissional.',
  'A grade já desconta feriados e bloqueios. Desmarques não ocupam horário. Sem horário ou especialidade cadastrados, não há grade para medir.',
  PERIODO,
]

export const DEFINICAO_DO_EM_ATENDIMENTO: Definicao = [
  'Tratamentos em andamento com este profissional, hoje. É uma foto do momento, sem comparação.',
  'Uma criança com dois pacotes em andamento com o mesmo profissional conta duas vezes.',
]

export const DEFINICAO_DOS_PACOTES_NO_FIM_DO_PROFISSIONAL: Definicao = [
  'Pacotes em andamento deste profissional perto do fim — a mesma regra do aviso "Pacotes acabando".',
  'A partir de quantas sessões restantes o pacote entra aqui é escolha da clínica, nas Configurações.',
]

export const DEFINICAO_DO_RECEBIDO_DO_PROFISSIONAL: Definicao = [
  'O que entrou no caixa da clínica no período pelos atendimentos deste profissional, pela data do pagamento.',
  'Conta quem atendeu a sessão cobrada; no pacote pago adiantado, o profissional do tratamento.',
  'O que a operadora do plano paga ao convênio não passa pelo caixa e não entra. Não é a parte do profissional: o acerto continua com a clínica.',
  PERIODO,
]

export const DEFINICAO_DO_SEM_PAGAMENTO: Definicao = [
  'Sessões realizadas no mês por este profissional cujo pagamento ainda não entrou no caixa.',
  'É só leitura: quem cobra a família é o financeiro da clínica.',
]
