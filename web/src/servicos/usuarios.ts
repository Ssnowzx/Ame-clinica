import { garantirCsrf, http, putComVersao } from '@/lib/http'
import type { AprovacaoDeAcesso, PayloadUsuario, ResultadoDeMutacaoGovernada, Usuario } from '@/tipos'

/** Lista os usuários da clínica (a API não pagina — a clínica tem dezenas). */
export async function listarUsuarios(): Promise<Usuario[]> {
  const { data } = await http.get<Usuario[]>('/api/usuarios')
  return data
}

/** Leitura FRESCA de um usuário — hidrata o formulário de edição (CHAVE-DETALHE). */
export async function buscarUsuario(id: number): Promise<Usuario> {
  const { data } = await http.get<Usuario>(`/api/usuarios/${id}`)
  return data
}

export async function criarUsuario(payload: PayloadUsuario): Promise<Usuario> {
  await garantirCsrf()
  const { data } = await http.post<Usuario>('/api/usuarios', payload)
  return data
}

export async function atualizarUsuario(id: number, payload: PayloadUsuario, versao: string): Promise<Usuario> {
  const data = await putComVersao<Usuario>(`/api/usuarios/${id}`, payload, versao)
  return data
}

/**
 * Atribui o nível ao usuário pelo endpoint DEDICADO (o payload de usuário nunca
 * carrega nível — parecer T-usr-02). `syncRoles` no servidor substitui o anterior.
 * EXCEÇÃO da concorrência otimista (SEC-OCC-06): operação de intenção única —
 * a última intenção vencer é o correto; sem If-Match, de propósito.
 */
export async function atribuirNivel(
  usuarioId: number,
  nivelPermissaoId: number,
): Promise<ResultadoDeMutacaoGovernada<Usuario>> {
  await garantirCsrf()
  const resposta = await http.put<Usuario | AprovacaoDeAcesso>(`/api/usuarios/${usuarioId}/nivel-permissao`, {
    nivel_permissao_id: nivelPermissaoId,
  })

  // maker-checker (AP-13): 202 = virou pendência, o nível NÃO colou ainda
  return resposta.status === 202
    ? { aplicado: false, aprovacao: resposta.data as AprovacaoDeAcesso }
    : { aplicado: true, dados: resposta.data as Usuario }
}
