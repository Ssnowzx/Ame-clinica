import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import { ErroDeApi, esquecerCsrf } from '@/lib/http'
import { executarBaixaEmLote, preverBaixaEmLote } from '@/servicos/agenda'
import { servidor } from '@/test/servidor-msw'
import type { PreviaDaBaixa } from '@/tipos'

const ALCANCE = { profissionalId: 7, statusId: 3, de: '2026-09-04', ate: '2026-09-10' }

const PREVIA: PreviaDaBaixa = {
  status: { id: 3, nome: 'Finalizado', desconta_sessao: true, marca_falta: false },
  contagens: { agendamentos: 11, criancas: 8, sessoes_a_descontar: 10, sem_pacote: 1, ja_consumidas: 0, com_atendimento_registrado: 0 },
  recusados: [],
  avisos: { evolucoes_vencidas: 0 },
  assinatura: 'b'.repeat(64),
  referencia: '2026-09-10 19:01',
}

/**
 * GUARDA DE CONTRATO da baixa em lote (design D5): os dois 409 desta rota são perguntas ao
 * operador, e o interceptador global os traduziria como "alterado por outra pessoa enquanto você
 * editava" — mensagem sem sentido, e que joga fora a prévia nova que o corpo carrega.
 */
describe('executarBaixaEmLote — os 409 são discriminados pela chave `erro`', () => {
  it('deve enviar o alcance em snake_case com assinatura e referência, e devolver o resultado', async () => {
    // ARRANGE
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/agendamentos/baixa-em-lote', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ lote_id: 'x', aplicados: 11, contagens: { criancas: 8, sessoes_descontadas: 10 }, recusados: [] })
      }),
    )

    // ACT
    const desfecho = await executarBaixaEmLote(ALCANCE, { assinatura: PREVIA.assinatura, referencia: PREVIA.referencia })

    // ASSERT
    expect(corpo).toEqual({
      profissional_id: 7,
      status_id: 3,
      de: '2026-09-04',
      ate: '2026-09-10',
      assinatura: 'b'.repeat(64),
      referencia: '2026-09-10 19:01',
    })
    expect(desfecho).toEqual({
      tipo: 'aplicada',
      resultado: { lote_id: 'x', aplicados: 11, contagens: { criancas: 8, sessoes_descontadas: 10 }, recusados: [] },
    })
  })

  it('deve devolver a prévia NOVA no 409 previa_desatualizada, em vez de lançar conflito', async () => {
    // ARRANGE
    servidor.use(
      msw.post('/api/agendamentos/baixa-em-lote', () =>
        HttpResponse.json({ erro: 'previa_desatualizada', message: 'mudou', previa: PREVIA }, { status: 409 }),
      ),
    )

    // ACT
    const desfecho = await executarBaixaEmLote(ALCANCE, { assinatura: 'a'.repeat(64), referencia: '2026-09-10 18:59' })

    // ASSERT
    expect(desfecho).toEqual({ tipo: 'previa_desatualizada', previa: PREVIA })
  })

  it('deve devolver o fato ciclo_em_alteracao no 409 do fechamento', async () => {
    // ARRANGE
    servidor.use(
      msw.post('/api/agendamentos/baixa-em-lote', () =>
        HttpResponse.json({ erro: 'ciclo_em_alteracao', message: 'x' }, { status: 409 }),
      ),
    )

    // ACT
    const desfecho = await executarBaixaEmLote(ALCANCE, { assinatura: 'a'.repeat(64), referencia: '2026-09-10 18:59' })

    // ASSERT
    expect(desfecho).toEqual({ tipo: 'ciclo_em_alteracao' })
  })

  it('deve tratar um 409 desconhecido como conflito, nunca como a pergunta da prévia', async () => {
    // ARRANGE — uma regra futura qualquer não pode virar "agenda mudou" em silêncio
    servidor.use(
      msw.post('/api/agendamentos/baixa-em-lote', () => HttpResponse.json({ message: 'outra coisa' }, { status: 409 })),
    )

    // ACT / ASSERT
    await expect(
      executarBaixaEmLote(ALCANCE, { assinatura: 'a'.repeat(64), referencia: '2026-09-10 18:59' }),
    ).rejects.toMatchObject({ motivo: 'conflito' })
  })

  it('deve pedir o cookie CSRF antes da prévia e da execução', async () => {
    // ARRANGE — os POST do lote passam pelo `garantirCsrf()` (correção de carona da change);
    // o token é esquecido antes, senão outro teste do processo já o teria carregado
    esquecerCsrf()
    let pediuCsrf = false
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => {
        pediuCsrf = true
        return new HttpResponse(null, { status: 204 })
      }),
      msw.post('/api/agendamentos/baixa-em-lote/previa', () => HttpResponse.json(PREVIA)),
    )

    // ACT
    const previa = await preverBaixaEmLote(ALCANCE)

    // ASSERT
    expect(previa).toEqual(PREVIA)
    expect(pediuCsrf).toBe(true)
  })

  it('deve deixar o 422 seguir pelo funil normal (campos inválidos)', async () => {
    // ARRANGE
    servidor.use(
      msw.post('/api/agendamentos/baixa-em-lote/previa', () =>
        HttpResponse.json({ message: 'erro', errors: { ate: ['A baixa só alcança o que já aconteceu.'] } }, { status: 422 }),
      ),
    )

    // ACT / ASSERT
    await expect(preverBaixaEmLote(ALCANCE)).rejects.toBeInstanceOf(ErroDeApi)
    await expect(preverBaixaEmLote(ALCANCE)).rejects.toMatchObject({
      motivo: 'invalido',
      camposInvalidos: { ate: ['A baixa só alcança o que já aconteceu.'] },
    })
  })
})
