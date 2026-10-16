import axios, { AxiosError } from 'axios'

import type { EnvioDeCadastro, FormularioPublico } from '@/tipos'

/**
 * O cliente da PÁGINA PÚBLICA (change `cadastro-online-do-paciente`).
 *
 * Instância PRÓPRIA, e a diferença para o `http` do sistema é uma linha que importa:
 * `withCredentials` fica FALSO. A rota pública não aceita sessão — aceitar credencial ali criaria
 * dois comportamentos para o mesmo endereço, e o mais perigoso deles seria o da recepcionista com
 * o sistema aberto no mesmo navegador.
 *
 * Mandar o cookie e o servidor ignorá-lo já funcionaria; não mandar é melhor por dois motivos: o
 * navegador não carrega credencial para uma página que estranhos abrem, e ninguém pode "consertar"
 * a rota depois achando que a sessão estava sendo usada.
 */
const publico = axios.create({
  withCredentials: false,
  headers: { Accept: 'application/json' },
})

/** O erro que a página trata como "este link não vale": endereço inexistente, desligado ou de clínica inativa. */
export function ehLinkIndisponivel(erro: unknown): boolean {
  return erro instanceof AxiosError && erro.response?.status === 404
}

/**
 * Se a falha é este código HTTP.
 *
 * A causa muda o que a família deve FAZER: 429 é o balde de throttle (e a família na sala de
 * espera divide o IP da clínica, então ele é cenário real, não hipótese), 413 é observação longa
 * demais. Culpar a conexão nos dois casos manda corrigir o que está certo.
 */
export function ehStatus(erro: unknown, codigo: number): boolean {
  return erro instanceof AxiosError && erro.response?.status === codigo
}

/** Os erros por campo devolvidos pelo servidor, já em português. */
export function errosDoServidor(erro: unknown): Record<string, string[]> {
  if (erro instanceof AxiosError && erro.response?.status === 422) {
    return (erro.response.data as { errors?: Record<string, string[]> }).errors ?? {}
  }

  return {}
}

/** O formulário que esta clínica publica: marca, seções e campos. */
export async function buscarFormularioPublico(slug: string): Promise<FormularioPublico> {
  const { data } = await publico.get<FormularioPublico>(`/api/publico/cadastro/${slug}`)
  return data
}

/** O endereço da logo — a página só o usa quando a identidade da clínica é `logo`. */
export function urlDaLogoPublica(slug: string): string {
  return `/api/publico/cadastro/${slug}/logo`
}

/**
 * Envia o cadastro.
 *
 * A resposta é sempre a mesma, por desenho: coincidir com alguém que já é paciente não muda nada.
 * A tela não tem como saber se houve duplicata, e é assim que tem de ser — quem resolve isso é a
 * recepção, na fila, com permissão para saber quem é paciente da clínica.
 */
export async function enviarCadastroPublico(slug: string, dados: EnvioDeCadastro): Promise<{ mensagem: string }> {
  const { data } = await publico.post<{ mensagem: string }>(`/api/publico/cadastro/${slug}`, dados)
  return data
}
