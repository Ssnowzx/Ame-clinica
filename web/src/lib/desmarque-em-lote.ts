/**
 * Helpers PUROS do diálogo "Desmarcar a agenda" (change `desmarque-do-profissional`) — o que a
 * tela escreve a partir das chaves do servidor, partilhado com quem mais as lê: a trilha de
 * auditoria mostra os `recusados` da linha-mãe `desmarque_em_lote` com este mesmo dicionário.
 */

/**
 * Motivos constantes do servidor (`DesmarqueEmLote::RECUSA_*`) → frase em pt-BR, escrita para
 * vir depois de "hora — ". Duas chaves coincidem com as da baixa (`lib/baixa-em-lote`), as
 * frases não: o desmarque não desconta sessão, então "não pode virar falta" é razão da baixa,
 * nunca daqui — quem lê a trilha precisa da frase da operação que gravou a linha.
 */
export const MOTIVO_DA_RECUSA: Record<string, string> = {
  ciclo_fechado: 'faturamento do convênio já fechado',
  atendimento_registrado: 'atendimento já registrado',
}
