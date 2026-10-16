import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { ErroDeApi, http, putComVersao, registrarAoExpirarSessao } from '@/lib/http'
import { servidor } from '@/test/servidor-msw'

describe('cliente HTTP — concorrência otimista (putComVersao)', () => {
  it('deve enviar o token VERBATIM no If-Match — a string da leitura, sem reformatação', async () => {
    // ARRANGE — o token tem microssegundos; qualquer passagem por Date os perderia
    const tokenDaLeitura = '2026-07-15T10:00:00.123456Z'
    let ifMatchRecebido: string | null = null
    servidor.use(
      msw.put('/api/pacientes/1', ({ request }) => {
        ifMatchRecebido = request.headers.get('If-Match')
        return HttpResponse.json({ id: 1 })
      }),
    )

    // ACT
    await putComVersao('/api/pacientes/1', { nome: 'Paciente Fictício' }, tokenDaLeitura)

    // ASSERT
    expect(ifMatchRecebido).toBe(tokenDaLeitura)
  })

  it('deve traduzir o 409 no motivo `conflito`, com a mensagem que manda recarregar', async () => {
    // ARRANGE — o corpo do servidor é FIXO e não deve vazar para a tela
    servidor.use(
      msw.put('/api/pacientes/1', () =>
        HttpResponse.json({ message: 'corpo fixo do servidor' }, { status: 409 }),
      ),
    )

    // ACT
    const erro = await putComVersao('/api/pacientes/1', {}, '2026-07-15T10:00:00.000000Z')
      .catch((excecao: unknown) => excecao)

    // ASSERT — mutações têm retry: 0; o `conflito` nunca entra em predicate de retry
    expect(erro).toBeInstanceOf(ErroDeApi)
    const erroDeApi = erro as ErroDeApi
    expect(erroDeApi.motivo).toBe('conflito')
    expect(erroDeApi.message).toContain('Recarregue')
    expect(erroDeApi.message).not.toContain('corpo fixo')
  })

  it('deve tratar o 428 (faltou a versão) como erro de aplicação, nunca como conflito', async () => {
    // ARRANGE
    servidor.use(
      msw.put('/api/pacientes/1', () => HttpResponse.json({ message: 'sem If-Match' }, { status: 428 })),
    )

    // ACT
    const erro = await putComVersao('/api/pacientes/1', {}, '').catch((excecao: unknown) => excecao)

    // ASSERT — 428 é bug de integração (formulário sem token), não corrida
    expect(erro).toBeInstanceOf(ErroDeApi)
    expect((erro as ErroDeApi).motivo).toBe('invalido')
  })
})

describe('cliente HTTP — erros normalizados', () => {
  it('deve traduzir 403 em erro de acesso sem vazar a resposta do servidor', async () => {
    // ARRANGE: o servidor devolve detalhe interno junto do 403
    servidor.use(
      msw.get('/api/agenda', () =>
        HttpResponse.json({ message: 'SQLSTATE[42000] permission denied on table pacientes' }, { status: 403 }),
      ),
    )

    // ACT
    const erro = await http.get('/api/agenda').catch((excecao: unknown) => excecao)

    // ASSERT: a tela recebe texto humano nosso — nunca o dump do servidor (T-ds-05)
    expect(erro).toBeInstanceOf(ErroDeApi)
    const erroDeApi = erro as ErroDeApi
    expect(erroDeApi.motivo).toBe('sem_acesso')
    expect(erroDeApi.message).not.toContain('SQLSTATE')
    expect(erroDeApi.message).toBe('Você não tem acesso a este recurso.')
  })

  it('deve traduzir falha de rede em mensagem humana', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/agenda', () => HttpResponse.error()))

    // ACT
    const erro = (await http.get('/api/agenda').catch((excecao: unknown) => excecao)) as ErroDeApi

    // ASSERT
    expect(erro.motivo).toBe('rede')
  })

  it('deve expor os campos inválidos do 422 para o formulário', async () => {
    // ARRANGE
    servidor.use(
      msw.put('/api/configuracoes', () =>
        HttpResponse.json({ errors: { valor: ['Valor incompatível.'] } }, { status: 422 }),
      ),
    )

    // ACT
    const erro = (await http.put('/api/configuracoes', {}).catch((excecao: unknown) => excecao)) as ErroDeApi

    // ASSERT
    expect(erro.motivo).toBe('invalido')
    expect(erro.camposInvalidos.valor).toEqual(['Valor incompatível.'])
  })
})

describe('cliente HTTP — sessão expirada (401)', () => {
  it('deve reagir ao 401 de uma consulta autenticada', async () => {
    // ARRANGE
    const aoExpirar = vi.fn()
    registrarAoExpirarSessao(aoExpirar)
    servidor.use(msw.get('/api/agenda', () => new HttpResponse(null, { status: 401 })))

    // ACT
    const erro = (await http.get('/api/agenda').catch((excecao: unknown) => excecao)) as ErroDeApi

    // ASSERT
    expect(erro.motivo).toBe('sessao_expirada')
    expect(aoExpirar).toHaveBeenCalledTimes(1)
  })

  it('deve não reagir ao 401 das próprias rotas de sessão (sem laço)', async () => {
    // ARRANGE: /api/me responde 401 para visitante — é resposta ESPERADA
    const aoExpirar = vi.fn()
    registrarAoExpirarSessao(aoExpirar)

    // ACT
    await http.get('/api/me').catch(() => undefined)

    // ASSERT: reagir aqui geraria laço de logout/redirect
    expect(aoExpirar).not.toHaveBeenCalled()
  })

  it('deve reagir ao 401 de rota com prefixo parecido com a de sessão', async () => {
    // ARRANGE: `/api/medicos` começa com `/api/me` — com startsWith, um 401 ali
    // deixava a sessão ZUMBI (cache de menor vivo, usuário sem saber que caiu)
    const aoExpirar = vi.fn()
    registrarAoExpirarSessao(aoExpirar)
    servidor.use(msw.get('/api/medicos', () => new HttpResponse(null, { status: 401 })))

    // ACT
    await http.get('/api/medicos').catch(() => undefined)

    // ASSERT
    expect(aoExpirar).toHaveBeenCalledTimes(1)
  })

  it('deve tratar 419 (token CSRF expirado) como sessão expirada', async () => {
    // ARRANGE
    const aoExpirar = vi.fn()
    registrarAoExpirarSessao(aoExpirar)
    servidor.use(msw.post('/api/agendamentos', () => new HttpResponse(null, { status: 419 })))

    // ACT
    const erro = (await http.post('/api/agendamentos', {}).catch((excecao: unknown) => excecao)) as ErroDeApi

    // ASSERT
    expect(erro.motivo).toBe('sessao_expirada')
    expect(aoExpirar).toHaveBeenCalledTimes(1)
  })
})
