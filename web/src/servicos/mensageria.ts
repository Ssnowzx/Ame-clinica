import { garantirCsrf, http } from '@/lib/http'
import type {
  ConexaoWhatsapp,
  Conversa,
  FiltroDeConversas,
  ListaDeConversas,
  PayloadDaConexao,
  PayloadDeEnvio,
  TemplateDeMensagem,
  ThreadDaConversa,
} from '@/tipos'

/**
 * A caixa de entrada, PAGINADA: com ~400 pacientes ativos, passar de 200 conversas é
 * certeza — e um corte mudo esconderia famílias sem ninguém saber.
 */
export async function listarConversas(
  filtro: FiltroDeConversas = 'ativas',
  busca = '',
  pagina = 1,
): Promise<ListaDeConversas> {
  const { data } = await http.get<ListaDeConversas>('/api/mensagens/conversas', {
    // o TERMO da busca vai como parâmetro de query da API (não da URL do navegador):
    // nome de menor não entra em histórico nem em Referer
    params: { filtro, page: pagina, ...(busca === '' ? {} : { busca }) },
  })
  return data
}

/**
 * A thread — a JANELA mais recente, não a conversa inteira. `antes` pagina para trás.
 *
 * Dois anos de acompanhamento acumulam milhares de mensagens, e esta tela relê a thread a
 * cada 8 s: sem janela, cada ciclo arrastaria tudo pela rede e reconstruiria a lista no DOM.
 * Paginar para trás NÃO mexe no contador de não lidas (é leitura de histórico).
 */
export async function abrirConversa(id: number, antes?: number): Promise<ThreadDaConversa> {
  const { data } = await http.get<ThreadDaConversa>(`/api/mensagens/conversas/${id}`, {
    params: antes === undefined ? undefined : { antes },
  })
  return data
}

export async function enviarMensagem(conversaId: number, payload: PayloadDeEnvio): Promise<void> {
  await garantirCsrf()
  await http.post(`/api/mensagens/conversas/${conversaId}/mensagens`, payload)
}

/** Envio de arquivo — multipart, porque o conteúdo é validado pelo servidor. */
export async function enviarArquivo(conversaId: number, arquivo: File, legenda?: string): Promise<void> {
  await garantirCsrf()
  const corpo = new FormData()
  corpo.append('tipo', 'midia')
  corpo.append('arquivo', arquivo)
  if (legenda !== undefined && legenda !== '') corpo.append('legenda', legenda)
  await http.post(`/api/mensagens/conversas/${conversaId}/mensagens`, corpo)
}

export async function reenviarMensagem(id: number): Promise<void> {
  await garantirCsrf()
  await http.post(`/api/mensagens/${id}/reenviar`)
}

export async function vincularConversa(id: number, pacienteId: number | null): Promise<Conversa> {
  await garantirCsrf()
  const { data } = await http.post<Conversa>(`/api/mensagens/conversas/${id}/vincular`, {
    paciente_id: pacienteId,
  })
  return data
}

export async function arquivarConversa(id: number, arquivar: boolean): Promise<Conversa> {
  await garantirCsrf()
  const acao = arquivar ? 'arquivar' : 'desarquivar'
  const { data } = await http.post<Conversa>(`/api/mensagens/conversas/${id}/${acao}`)
  return data
}

/** Opt-out da família: cala o disparo AUTOMÁTICO, nunca o atendimento humano. */
export async function definirLembretes(id: number, semLembretes: boolean): Promise<Conversa> {
  await garantirCsrf()
  const { data } = await http.post<Conversa>(`/api/mensagens/conversas/${id}/lembretes`, {
    sem_lembretes: semLembretes,
  })
  return data
}

export async function listarTemplates(): Promise<TemplateDeMensagem[]> {
  const { data } = await http.get<TemplateDeMensagem[]>('/api/mensagens/templates')
  return data
}

export async function sincronizarTemplates(): Promise<TemplateDeMensagem[]> {
  await garantirCsrf()
  const { data } = await http.post<TemplateDeMensagem[]>('/api/mensagens/templates/sincronizar')
  return data
}

export function urlDaMidia(midiaId: number): string {
  return `/api/mensagens/midias/${midiaId}`
}

export async function lerConexao(): Promise<ConexaoWhatsapp> {
  const { data } = await http.get<ConexaoWhatsapp>('/api/mensagens/conexao')
  return data
}

/**
 * Grava a credencial — SEM `If-Match` de propósito (exceção classificada por URI): é uma
 * intenção única e indivisível ("esta é a credencial"), e gravar sempre devolve o estado a
 * `nao_conectado`.
 */
export async function gravarConexao(payload: PayloadDaConexao): Promise<ConexaoWhatsapp> {
  await garantirCsrf()
  const { data } = await http.put<ConexaoWhatsapp>('/api/mensagens/conexao', payload)
  return data
}

export async function testarConexao(): Promise<ConexaoWhatsapp> {
  await garantirCsrf()
  const { data } = await http.post<ConexaoWhatsapp>('/api/mensagens/conexao/testar')
  return data
}
