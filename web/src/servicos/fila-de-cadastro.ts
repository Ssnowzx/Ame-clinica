import { garantirCsrf, http } from '@/lib/http'
import type { EnvioNaFila, LinkDeCadastro } from '@/tipos'

/**
 * A fila de conferência e o endereço público, do lado de DENTRO
 * (change `cadastro-online-do-paciente`).
 *
 * Aqui o cliente é o do sistema, com sessão: quem confere é gente da clínica. A página pública
 * usa outro cliente, sem credencial nenhuma.
 */

interface PaginaDaFila {
  data: EnvioNaFila[]
  total: number
}

export async function buscarFilaDeCadastro(): Promise<PaginaDaFila> {
  const { data } = await http.get<PaginaDaFila>('/api/cadastro-online/fila')
  return data
}

/**
 * Aceitar NÃO cria o paciente: devolve o conteúdo para a tela abrir o cadastro pré-preenchido,
 * que é onde a recepção conserta o que a família digitou antes de a base receber.
 */
export async function aceitarEnvio(id: number): Promise<{ id: number; dados: Record<string, unknown> }> {
  await garantirCsrf()
  const { data } = await http.post<{ id: number; dados: Record<string, unknown> }>(
    `/api/cadastro-online/fila/${String(id)}/aceitar`,
  )
  return data
}

/** Descartar exige motivo — decisão sem razão registrada é decisão que ninguém consegue revisar. */
export async function descartarEnvio(id: number, motivo: string): Promise<void> {
  await garantirCsrf()
  await http.post(`/api/cadastro-online/fila/${String(id)}/descartar`, { motivo })
}

export async function buscarLinkDeCadastro(): Promise<LinkDeCadastro> {
  const { data } = await http.get<LinkDeCadastro>('/api/cadastro-online/link')
  return data
}

/** Gerar e rotacionar são a mesma operação: o que muda é a tela pedir confirmação ou não. */
export async function rotacionarLinkDeCadastro(): Promise<LinkDeCadastro> {
  await garantirCsrf()
  const { data } = await http.post<LinkDeCadastro>('/api/cadastro-online/link/rotacionar')
  return data
}

/**
 * O conteúdo de um envio já aceito que ainda não virou ficha.
 *
 * Existe para o formulário sobreviver a um F5 depois do aceite: aceitar CONSOME o envio, e sem
 * esta leitura o preenchimento da família só existia no `state` da navegação — que morre no
 * recarregamento. Guardá-lo no navegador seria pior: o balcão é máquina compartilhada e o dado é
 * o cadastro de uma criança.
 */
export async function buscarRascunhoDoEnvio(envio: number): Promise<{ id: number; dados: Record<string, unknown> }> {
  const { data } = await http.get<{ id: number; dados: Record<string, unknown> }>(
    `/api/cadastro-online/fila/${String(envio)}/rascunho`,
  )

  return data
}
