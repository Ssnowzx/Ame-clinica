/**
 * O saldo do pacote **em palavras** — e só isso.
 *
 * Este arquivo já guardou o LIMIAR do fim de pacote. Não guarda mais: a regra virou dado
 * (`tratamentos.saldo_alerta_sessoes`), o servidor decide e manda o veredito pronto no payload
 * do card e do tratamento. O número chegou a existir em dois runtimes, com um teste que abria o
 * arquivo `.php` e comparava por regex — aquilo funcionava, e era o sintoma.
 *
 * O que sobra aqui é redação, que é assunto de tela.
 */

/**
 * O saldo em palavras na FILA do centro de notificações.
 *
 * Não é o mesmo texto do card, e a diferença é de sujeito: `avisoDeSaldo` fala do AGENDAMENTO
 * que está na tela ("Última sessão do tratamento"), e aqui o item é o PACOTE ("falta 1 sessão").
 * Reaproveitar a frase do card diria, na fila, que aquela linha é uma sessão — e ela é um
 * tratamento.
 */
export function saldoRestanteEmPalavras(saldo: number): string {
  if (saldo <= 0) {
    return 'sem saldo'
  }
  return saldo === 1 ? 'falta 1 sessão' : `faltam ${saldo} sessões`
}
