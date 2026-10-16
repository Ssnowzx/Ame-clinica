import { garantirCsrf, http } from '@/lib/http'

/**
 * Envia a foto de perfil do PRÓPRIO usuário (foto-de-perfil-do-usuario) — multipart,
 * sob `/me/avatar` (sempre o autenticado). O servidor valida formato/tamanho/medidas do
 * CONTEÚDO; a versão devolvida faz o cache-bust da imagem no shell.
 */
export async function enviarAvatar(arquivo: File): Promise<{ avatar_versao: string }> {
  await garantirCsrf()
  const corpo = new FormData()
  corpo.append('arquivo', arquivo)
  const { data } = await http.post<{ avatar_versao: string }>('/api/me/avatar', corpo)

  return data
}

/** Remove a foto de perfil do próprio usuário — a barra volta ao ícone. */
export async function removerAvatar(): Promise<void> {
  await garantirCsrf()
  await http.delete('/api/me/avatar')
}
