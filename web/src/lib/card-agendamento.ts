import type { CardAgendamento as DadosDoCard, SelecaoDaAgenda } from '@/tipos'


/**
 * O que a grade e a lista calculam IGUAL sobre um agendamento (change agenda-no-celular, D5).
 *
 * Vive em `lib/` e não ao lado dos componentes porque módulo que exporta componente E função
 * quebra o fast refresh do Vite — e porque isto aqui não tem nada de visual: é a leitura dos
 * dados do card, e serve a qualquer arranjo que venha depois.
 */

/**
 * O que a grade e a lista mostram sobre um agendamento — **sem refazer regra**.
 *
 * O realce vem DECIDIDO do servidor (`tratamento_realce`). Já foi calculado aqui, com uma
 * constante própria, e isso custou duas coisas: o limiar virou código em dois runtimes (contra
 * a §13, que manda regra configurável ser DADO) e a conta do front não enxergava o `status` do
 * tratamento — um pacote parado com saldo baixo ficava realçado na grade enquanto o contador
 * dizia "nenhum". Quem decide precisa ver tudo, e quem vê tudo é o servidor.
 */
/**
 * O saldo em palavras no CARD — e ele CONTA as sessões, nunca as adivinha.
 *
 * Dizia "Penúltima sessão do tratamento" para qualquer saldo maior que 1, o que só era verdade
 * enquanto o limiar valia 2 e estava em código. O limiar virou dado
 * (`tratamentos.saldo_alerta_sessoes`, 1–20): com a clínica em 5, um card de saldo 4 anunciava
 * "penúltima" com "6/10 sessões" impresso na linha de cima. Texto que contradiz o número ao
 * lado dele não é impreciso, é falso — e é o mesmo defeito que a cor teve, agora na palavra.
 *
 * As duas superfícies irmãs já contavam: `saldoRestanteEmPalavras` na fila do centro e
 * `situacao-do-tratamento` na tela de tratamentos. Este era o único que estimava.
 */
export function avisoDeSaldo(saldo: number): string {
  if (saldo <= 0) {
    return 'Tratamento sem saldo de sessões'
  }
  return saldo === 1 ? 'Última sessão do tratamento' : `Faltam ${saldo} sessões no tratamento`
}

/**
 * Como a troca de status NOMEIA o agendamento (menu do chip, título da confirmação): o nome social
 * vence o de registro, e bloqueio sem criança vira "este agendamento". Uma definição — estava
 * copiada no menu e no diálogo.
 */
export function nomeCurtoDoAgendamento(card: DadosDoCard): string {
  return card.paciente?.nome_social ?? card.paciente?.nome ?? 'este agendamento'
}

/** O que a escrita do agendamento DEVOLVE de verdade: os escalares (`SerializadorDeAgendamento`). */
export type RespostaDaTrocaDeStatus = Pick<DadosDoCard, 'status_id' | 'updated_at'>

/**
 * A FOTO do cartão depois de uma troca de status feita pelo painel.
 *
 * O `PUT /agendamentos/{id}` devolve só os ESCALARES — `status_id`, `updated_at`… —, nunca o objeto
 * `status`, o paciente ou a resposta ao lembrete. Trocar a foto inteira pela resposta deixaria o chip
 * sem status e o painel sem criança. Então a foto anterior FICA, e muda só o que a troca mudou:
 * - o status, pelo que a pessoa escolheu na seleção (nome, cor e ícone vêm dela);
 * - a resposta ao lembrete, pela MESMA régua do servidor (`EstadoDaConfirmacao`): ela só existe
 *   em sessão MARCADA. Status que não é de sessão marcada apaga o estado; status marcado o mantém;
 *   seleção sem a flag (payload antigo) mantém — quem decide de verdade é a grade, na próxima busca.
 */
export function cartaoDepoisDaTroca(
  anterior: DadosDoCard,
  resposta: RespostaDaTrocaDeStatus,
  alvo: SelecaoDaAgenda['status'][number],
): DadosDoCard {
  return {
    ...anterior,
    status_id: resposta.status_id,
    updated_at: resposta.updated_at,
    status: { id: alvo.id, nome: alvo.nome, cor: alvo.cor, cor_borda: alvo.cor_borda, tipo: alvo.tipo },
    confirmacao: alvo.sessao_marcada === false ? null : anterior.confirmacao,
  }
}

export function derivarDoCard(card: DadosDoCard) {
  const realizadas =
    card.tratamento_total !== null && card.tratamento_saldo !== null
      ? card.tratamento_total - card.tratamento_saldo
      : null

  return {
    nomeDoPaciente: card.paciente?.nome_social ?? card.paciente?.nome ?? null,
    realizadas,
    /** `nenhum` · `acabando` (âmbar, cobre) · `sem-saldo` (vermelho, não pode atender) */
    realce: card.tratamento_realce,
  }
}
