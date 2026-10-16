import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import { listarLancamentos } from '@/servicos/financeiro'
import { buscarItensDaAgenda } from '@/servicos/indicadores'
import { listarPacientes } from '@/servicos/pacientes'
import { listarTarefas } from '@/servicos/tarefas'
import { listarTratamentos } from '@/servicos/tratamentos'
import { servidor } from '@/test/servidor-msw'

/**
 * GUARDA DE CONTRATO — **booleano em query string é `1`/`0`, nunca `true`/`false`**.
 *
 * Nasceu de um defeito que chegou a produção com as duas suítes verdes (CR-12): a aba
 * "Acabando" de `/tratamentos` mandava `acabando=true` e a API devolvia **422**, deixando a
 * tela — que é o destino do rodapé "Ver tratamentos acabando" do centro de notificações —
 * abrindo em erro.
 *
 * A causa é uma assimetria que não se vê lendo um lado só: em **corpo JSON** um booleano
 * chega booleano e a regra `boolean` do Laravel o aceita; em **query string** tudo vira
 * texto, e essa regra compara em modo ESTRITO contra `[true, false, 0, 1, '0', '1']` —
 * a string `'true'` não está na lista.
 *
 * **Por que nenhuma das duas suítes pegou, e por que esta guarda é de COMPORTAMENTO:** o
 * teste do front fixava o fio errado contra o MSW (`toContain('acabando=true')`) e o da API
 * usava o fio certo (`?acabando=1`). Cada um provava metade, e as metades eram diferentes.
 * Guarda que lê o fonte teria o mesmo ponto cego — quem erra é a serialização, então é ela
 * que precisa ser exercida.
 *
 * A regra vale para TODO serviço de listagem: acrescentar um aqui é mais barato do que
 * descobrir o 422 pela recepcionista.
 */

/** Cada serviço com filtro booleano, chamado com o valor que produz o parâmetro no fio. */
const SERVICOS: Array<{ nome: string; rota: string; chamar: () => Promise<unknown> }> = [
  {
    nome: 'listarTratamentos({ acabando: true })',
    rota: '/api/tratamentos',
    chamar: () => listarTratamentos({ acabando: true }),
  },
  {
    nome: 'listarTratamentos({ vencido: true })',
    rota: '/api/tratamentos',
    chamar: () => listarTratamentos({ vencido: true }),
  },
  {
    nome: 'listarPacientes(ativo)',
    rota: '/api/pacientes',
    chamar: () => listarPacientes({ ativo: true }),
  },
  {
    nome: 'listarLancamentos({ pago: true })',
    rota: '/api/lancamentos',
    chamar: () => listarLancamentos({ pago: true }),
  },
  {
    nome: 'listarTarefas(arquivadas)',
    rota: '/api/tarefas',
    chamar: () => listarTarefas(true),
  },
  {
    nome: 'buscarItensDaAgenda(passadas)',
    rota: '/api/indicadores/agenda/itens',
    chamar: () => buscarItensDaAgenda('2026-10', 5, 1, true),
  },
]

describe('booleano em query string — o fio que a API aceita', () => {
  it.each(SERVICOS)('$nome NÃO deve pôr true/false no fio', async ({ rota, chamar }) => {
    // ARRANGE — o MSW guarda a query string REAL, depois do axios serializar
    let fio = ''
    servidor.use(
      msw.get(rota, ({ request }) => {
        fio = new URL(request.url).search
        return HttpResponse.json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
      }),
    )

    // ACT
    await chamar()

    // ASSERT — a regra `boolean` do Laravel recusa 'true'/'false' vindos de query string
    expect(fio).not.toMatch(/=(true|false)(&|$)/)
  })

  it('deve mandar acabando=1 no recorte que o contador aponta', async () => {
    /*
     * ARRANGE — o caso nomeado, porque foi o que quebrou: a asserção genérica acima diz o
     * que NÃO pode ir; esta diz o que TEM de ir, e é a que cai se alguém "simplificar" para
     * `acabando: filtro.acabando`.
     */
    let fio = ''
    servidor.use(
      msw.get('/api/tratamentos', ({ request }) => {
        fio = new URL(request.url).search
        return HttpResponse.json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
      }),
    )

    // ACT
    await listarTratamentos({ status: 'andamento', acabando: true })

    // ASSERT
    expect(fio).toContain('acabando=1')
  })

  it('deve mandar passadas=1 na lista que vem da "Situação das sessões que já passaram"', async () => {
    // ARRANGE — o corte das sessões que já passaram (contrato 2 da rodada 1 do gate)
    let fio = ''
    servidor.use(
      msw.get('/api/indicadores/agenda/itens', ({ request }) => {
        fio = new URL(request.url).search
        return HttpResponse.json({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
      }),
    )

    // ACT
    await buscarItensDaAgenda('2026-10', 5, 1, true)

    // ASSERT
    expect(fio).toContain('passadas=1')
  })
})
