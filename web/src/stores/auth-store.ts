import { create } from 'zustand'

import type { Usuario } from '@/tipos'

import { esquecerCsrf, garantirCsrf, http, registrarAoExpirarSessao } from '@/lib/http'
import { queryClient } from '@/lib/query-client'

interface EstadoAuth {
  usuario: Usuario | null
  carregandoSessao: boolean
  login: (email: string, senha: string) => Promise<void>
  logout: () => Promise<void>
  carregarSessao: () => Promise<void>
  temPermissao: (permissao: string) => boolean
  atualizarAvatarVersao: (versao: string | null) => void
}

/**
 * Encerra a sessão LOCAL e apaga todo o cache de dados (T-sag-08): o balcão é
 * máquina compartilhada e as consultas guardam dado de menor — nada pode
 * sobreviver à troca de usuário nem a uma sessão expirada.
 */
function encerrarSessaoLocal(): void {
  queryClient.clear()
  // o cookie XSRF morre com a sessão; sem esquecer o token, o próximo login
  // levaria 419 para sempre (a SPA não recarrega o módulo)
  esquecerCsrf()
  useAuthStore.setState({ usuario: null, carregandoSessao: false })
}

export const useAuthStore = create<EstadoAuth>()((set, get) => ({
  usuario: null,
  carregandoSessao: true,

  login: async (email, senha) => {
    await garantirCsrf()
    const { data } = await http.post<Usuario>('/api/login', { email, senha })
    queryClient.clear() // o cache do usuário anterior nunca vaza para o novo
    set({ usuario: data, carregandoSessao: false })
  },

  logout: async () => {
    // Falha de rede não pode PRENDER o usuário na sessão: a saída local é
    // incondicional (o servidor invalida a sessão dele no próximo contato).
    try {
      await http.post('/api/logout')
    } catch {
      // sem rede: encerra localmente do mesmo jeito
    }
    encerrarSessaoLocal()
  },

  carregarSessao: async () => {
    try {
      const { data } = await http.get<Usuario>('/api/me')
      set({ usuario: data, carregandoSessao: false })
    } catch {
      set({ usuario: null, carregandoSessao: false })
    }
  },

  // guard de UI apenas — a fronteira real de autorização é o servidor
  temPermissao: (permissao) => get().usuario?.permissoes.includes(permissao) ?? false,

  // atualização otimista após enviar/remover a própria foto (foto-de-perfil-do-usuario):
  // a barra reflete na hora, sem refetch do /me
  atualizarAvatarVersao: (versao) => {
    const usuario = get().usuario
    if (usuario === null) return
    set({ usuario: { ...usuario, avatar_versao: versao } })
  },
}))

// 401 em qualquer consulta autenticada devolve o usuário ao login, sem laço
// (o interceptor ignora as próprias rotas de sessão).
registrarAoExpirarSessao(encerrarSessaoLocal)
