import { ErroDeApi } from '@/lib/http'

/**
 * O 409 da concorrência otimista (EX-05), reconhecido de forma tipada.
 *
 * Quem edita a partir de uma LINHA de lista precisa disto no `onError`: sem
 * invalidar a query que hidratou a linha, fechar e reabrir o diálogo
 * re-hidrataria do MESMO registro velho — e o PUT levaria 409 para sempre, até
 * um F5 (gate da change `concorrencia-otimista`, B1). A invalidação NÃO mexe no
 * formulário aberto (o estado digitado é local); ela garante que REABRIR
 * re-hidrate fresco, com o token novo.
 */
export function ehConflitoDeEdicao(erro: unknown): boolean {
  return erro instanceof ErroDeApi && erro.motivo === 'conflito'
}
