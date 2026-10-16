import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import { http } from '@/lib/http'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

/** Semeia o cache com dado sensível, como uma consulta da agenda faria. */
function semearCacheComDadoDeMenor(): void {
  queryClient.setQueryData(['agenda', { de: '2026-07-13', ate: '2026-07-13' }], [
    { id: 1, paciente: { id: 9, nome: 'Paciente Fictício' } },
  ])
}

describe('auth-store — o cache não sobrevive à troca de usuário (T-sag-08)', () => {
  it('deve apagar todo o cache no logout', async () => {
    // ARRANGE: sessão ativa com dado de menor em cache
    useAuthStore.setState({ usuario: usuarioFicticio, carregandoSessao: false })
    semearCacheComDadoDeMenor()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)

    // ACT
    await useAuthStore.getState().logout()

    // ASSERT: o balcão é máquina compartilhada — nada fica para o próximo
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(useAuthStore.getState().usuario).toBeNull()
  })

  it('deve apagar o cache mesmo quando o logout falha no servidor', async () => {
    // ARRANGE
    servidor.use(msw.post('/api/logout', () => HttpResponse.error()))
    useAuthStore.setState({ usuario: usuarioFicticio, carregandoSessao: false })
    semearCacheComDadoDeMenor()

    // ACT
    await useAuthStore.getState().logout()

    // ASSERT: a sessão local sempre cai — rede não pode reter dado na máquina
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(useAuthStore.getState().usuario).toBeNull()
  })

  it('deve apagar o cache quando a sessão expira (401 em consulta)', async () => {
    // ARRANGE
    useAuthStore.setState({ usuario: usuarioFicticio, carregandoSessao: false })
    semearCacheComDadoDeMenor()
    servidor.use(msw.get('/api/agenda', () => new HttpResponse(null, { status: 401 })))

    // ACT
    await http.get('/api/agenda').catch(() => undefined)

    // ASSERT
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(useAuthStore.getState().usuario).toBeNull()
  })

  it('deve rebuscar o token CSRF no login seguinte a uma sessão encerrada (B-02)', async () => {
    // ARRANGE: o cookie XSRF morre com a sessão, mas a SPA não recarrega — sem
    // esquecer o token, garantirCsrf() vira no-op e todo login seguinte leva
    // 419 (só F5 destravaria). Contamos as buscas do cookie.
    let buscasDoCsrf = 0
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => {
        buscasDoCsrf++
        return new HttpResponse(null, { status: 204 })
      }),
    )

    // ACT: entra, sai (sessão encerrada) e entra de novo
    await useAuthStore.getState().login(usuarioFicticio.email, 'senha-de-teste-123')
    await useAuthStore.getState().logout()
    await useAuthStore.getState().login(usuarioFicticio.email, 'senha-de-teste-123')

    // ASSERT: o token foi buscado de novo — o segundo login não vai sem CSRF
    expect(buscasDoCsrf).toBe(2)
    expect(useAuthStore.getState().usuario?.email).toBe(usuarioFicticio.email)
  })

  it('deve apagar o cache do usuário anterior ao entrar outro', async () => {
    // ARRANGE: cache do turno anterior ainda em memória
    semearCacheComDadoDeMenor()

    // ACT
    await useAuthStore.getState().login(usuarioFicticio.email, 'senha-de-teste-123')

    // ASSERT
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(useAuthStore.getState().usuario?.email).toBe(usuarioFicticio.email)
  })
})
