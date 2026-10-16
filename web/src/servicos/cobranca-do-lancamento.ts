import { garantirCsrf, http } from '@/lib/http'
import type { CobrancaDoLancamento } from '@/tipos'

/**
 * Cobrar pelo WhatsApp (change `cobranca-pelo-whatsapp`). O servidor monta os responsáveis com
 * telefone e a mensagem da clínica já preenchida (D1); a tela só abre o link de conversa. As duas
 * rotas exigem `lancamentos.ver` E `pacientes.ver` — o telefone é contato do cadastro da criança.
 */

/** Os responsáveis com telefone e a mensagem pronta de cada um. `422` em `lancamento` com a razão. */
export async function buscarCobranca(lancamentoId: number): Promise<CobrancaDoLancamento> {
  const { data } = await http.get<CobrancaDoLancamento>(`/api/lancamentos/${lancamentoId}/cobranca`)

  return data
}

/** Registra que a conversa foi ABERTA (não que a mensagem foi enviada): quem e quando, sem o texto. */
export async function registrarCobranca(lancamentoId: number): Promise<void> {
  await garantirCsrf()
  await http.post(`/api/lancamentos/${lancamentoId}/cobranca`)
}
