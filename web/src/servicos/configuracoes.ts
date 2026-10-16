import { garantirCsrf, http } from '@/lib/http'
import type {
  AlvoEncadeamento,
  AprovacaoDeAcesso,
  LeituraDeConfiguracoes,
  ListasDeStatus,
  ResultadoDeMutacaoGovernada,
  StatusQueFinaliza,
} from '@/tipos'

/** Todas as configurações efetivas da clínica, com os metadados do catálogo e as seções. */
export async function listarConfiguracoes(): Promise<LeituraDeConfiguracoes> {
  const { data } = await http.get<LeituraDeConfiguracoes>('/api/configuracoes')
  return data
}

/**
 * Grava UM override (escrita chave a chave — o contrato do servidor). Devolve o valor
 * efetivo já tipado.
 */
export async function salvarConfiguracao(
  chave: string,
  valor: string | number | boolean,
): Promise<ResultadoDeMutacaoGovernada<{ chave: string; valor: string | number | boolean }>> {
  await garantirCsrf()
  const resposta = await http.put<{ chave: string; valor: string | number | boolean } | AprovacaoDeAcesso>(
    '/api/configuracoes',
    { chave, valor },
  )

  // maker-checker (AP-13/SEC-SD-08): desligar uma flag `seguranca.*` com a dupla
  // ligada responde 202 — a flag CONTINUA como estava até outro admin aprovar
  return resposta.status === 202
    ? { aplicado: false, aprovacao: resposta.data as AprovacaoDeAcesso }
    : { aplicado: true, dados: resposta.data as { chave: string; valor: string | number | boolean } }
}

/**
 * Alvos elegíveis do encadeamento (status que não descontam sessão), sob
 * `configuracoes.ver` — a tela valida o alvo NA LEITURA sem exigir
 * `status_agendamento.ver` (SEC-ADM-05 / CONFIG-SEM-FK).
 */
export async function listarAlvosEncadeamento(): Promise<ListasDeStatus> {
  const { data } = await http.get<{ alvos: AlvoEncadeamento[]; finalizam?: StatusQueFinaliza[] }>(
    '/api/configuracoes/alvos-encadeamento',
  )
  // payload anterior à lista `finalizam`: o ponteiro fica sem opções em vez de quebrar
  return { alvos: data.alvos, finalizam: data.finalizam ?? [] }
}

/**
 * Envia a logo da clínica (identidade-da-clinica) — multipart, sob
 * `configuracoes.editar`. O servidor valida formato/tamanho/medidas do CONTEÚDO;
 * a versão devolvida faz o cache-bust da imagem no shell.
 */
/**
 * `identidade_aplicada`: enviar a logo APLICA a logo na barra quando a clínica ainda exibia o
 * nome (change logo-aplicada-ao-enviar). O servidor informa se precisou aplicar, e a tela usa
 * isso para dizer o que aconteceu em vez de adivinhar.
 */
export interface RespostaDoEnvioDaLogo {
  logo_versao: string
  identidade_aplicada: boolean
}

export async function enviarLogoDaClinica(arquivo: File): Promise<RespostaDoEnvioDaLogo> {
  await garantirCsrf()
  const corpo = new FormData()
  corpo.append('arquivo', arquivo)
  const { data } = await http.post<RespostaDoEnvioDaLogo>('/api/clinica/logo', corpo)

  return data
}

export async function removerLogoDaClinica(): Promise<void> {
  await garantirCsrf()
  await http.delete('/api/clinica/logo')
}
