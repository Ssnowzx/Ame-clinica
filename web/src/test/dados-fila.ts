import { HttpResponse, http as msw } from 'msw'

import type { EntradaDaFila } from '@/tipos'

/** Fixtures da fila — 100% fictícias (LGPD: nunca dado que possa ser real). */

export function entradaFicticia(sobrescritas: Partial<EntradaDaFila> = {}): EntradaDaFila {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    paciente_id: 10,
    especialidade_id: 1,
    profissional_id: 1,
    prioridade: 0,
    obs: null,
    created_at: '2026-07-06T09:00:00.000000Z',
    paciente: { id: 10, nome: 'Paciente Fictício', nome_social: null },
    especialidade: { id: 1, nome: 'Fonoaudiologia' },
    profissional: { id: 1, nome: 'Profissional Fictício A' },
    ...sobrescritas,
  }
}

/**
 * Handlers da fila **com estado**: o encaixe e a saída REMOVEM a entrada, como o
 * servidor faz.
 *
 * Um handler estático devolveria a mesma fila para sempre — e a asserção "o
 * paciente continua na fila depois da recusa" passaria mesmo se o código o
 * tivesse removido (parecer code-review §5). Aqui, quem não remove some, e quem
 * remove aparece.
 */
export function handlersDaFila(fila: EntradaDaFila[] = [entradaFicticia()]) {
  let atual = [...fila]

  return [
    msw.get('/api/lista-espera', () => HttpResponse.json(atual)),
    msw.post('/api/lista-espera', () => HttpResponse.json(entradaFicticia(), { status: 201 })),
    msw.put('/api/lista-espera/:id', () => HttpResponse.json(entradaFicticia())),
    msw.delete('/api/lista-espera/:id', ({ params }) => {
      atual = atual.filter((entrada) => entrada.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    msw.post('/api/lista-espera/:id/encaixar', ({ params }) => {
      // o encaixe é UMA operação: agendou ⇒ saiu da fila
      atual = atual.filter((entrada) => entrada.id !== Number(params.id))
      return HttpResponse.json({ id: 99 }, { status: 201 })
    }),
  ]
}
