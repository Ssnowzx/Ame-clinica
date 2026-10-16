import { HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import {
  buscarInteressados,
  cartoes,
  categorias,
  contas,
  subcategoriasDe,
  tiposPagamento,
} from '@/servicos/financeiro'
import { servidor } from '@/test/servidor-msw'

/** Envelope paginado do Laravel — os TRÊS endpoints de interessado o usam. */
function pagina<T>(itens: T[]) {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

/**
 * GUARDA DE CONTRATO da busca de interessado.
 *
 * O bug que ela impede é concreto: `/funcionarios` é PAGINADO (`{data:[...]}`), não array
 * cru — tratar como array fazia `data.map is not a function` no instante em que o usuário
 * escolhe "Funcionário" e digita. O tsc não pega (o generic do `http.get<...>` é uma
 * asserção que o compilador confia). Só um teste que exercita a resposta real pega.
 */
describe('buscarInteressados — normaliza os três tipos para {id, nome}', () => {
  it('deve mapear paciente usando nome_social quando houver', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes', () =>
        HttpResponse.json(pagina([{ id: 10, nome: 'Ana Maria', nome_social: 'Ana' }])),
      ),
    )

    // ACT
    const resultado = await buscarInteressados('paciente', 'ana')

    // ASSERT
    expect(resultado).toEqual([{ id: 10, nome: 'Ana' }])
  })

  it('deve mapear fornecedor pela razão social', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/fornecedores', () =>
        HttpResponse.json(pagina([{ id: 3, razao_social: 'Papelaria XYZ Ltda' }])),
      ),
    )

    // ACT
    const resultado = await buscarInteressados('fornecedor', 'pap')

    // ASSERT
    expect(resultado).toEqual([{ id: 3, nome: 'Papelaria XYZ Ltda' }])
  })

  it('deve mapear funcionário do ENVELOPE PAGINADO (não array cru)', async () => {
    // ARRANGE — /funcionarios devolve {data:[...]}; tratar como array quebrava em runtime
    servidor.use(
      msw.get('/api/funcionarios', () =>
        HttpResponse.json(pagina([{ id: 5, nome: 'João Silva', funcao: 'Recepção', ativo: true }])),
      ),
    )

    // ACT
    const resultado = await buscarInteressados('funcionario', 'joao')

    // ASSERT — se o serviço fizesse data.map no envelope, isto lançaria TypeError
    expect(resultado).toEqual([{ id: 5, nome: 'João Silva' }])
  })
})

/**
 * GUARDA DE CONTRATO do faturamento pela agenda (change faturar-pelo-painel-da-agenda).
 * O que ela impede: a tela mandar `valor` (T-fin-15 — a API recusa) ou bater na URL
 * errada; e perder o `liquido` que o servidor calcula e o diálogo anuncia.
 */
describe('faturarAgendamento — POST /api/agendamentos/{id}/faturamento', () => {
  it('deve faturar o agendamento sem enviar valor e devolver o lançamento com liquido', async () => {
    // ARRANGE
    const { faturarAgendamento } = await import('@/servicos/financeiro')
    let corpoRecebido: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/agendamentos/42/faturamento', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          { id: 900, tipo: 'receita', valor: '150.00', desconto: '10.00', liquido: '140.00', agendamento_id: 42 },
          { status: 201 },
        )
      }),
    )

    // ACT
    const resultado = await faturarAgendamento(42, {
      categoria_id: 1,
      tipo_pagamento_id: 2,
      conta_id: 3,
      desconto: '10.00',
    })

    // ASSERT
    expect(resultado.liquido).toBe('140.00')
    expect(resultado.agendamento_id).toBe(42)
    expect(corpoRecebido).toEqual({ categoria_id: 1, tipo_pagamento_id: 2, conta_id: 3, desconto: '10.00' })
    expect(corpoRecebido).not.toHaveProperty('valor')
  })
})

/**
 * GUARDA DE CONTRATO das subcategorias.
 *
 * Elas nascem numa rota aninhada (`POST /categorias/{id}/subcategorias`) e depois são
 * endereçadas SOZINHAS (`PUT|DELETE /subcategorias/{id}`) — endereço diferente para o
 * mesmo registro, na mesma tela. Trocar um pelo outro dá 404 ou, pior, edita a categoria.
 * A leitura, por sua vez, não tem endpoint: vem da mãe.
 */
describe('subcategoriasDe — agregado da categoria, endereços diferentes por verbo', () => {
  it('deve listar as subcategorias da mãe certa, lendo a categoria', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/categorias', () =>
        HttpResponse.json([
          {
            id: 1,
            nome: 'Atendimentos',
            tipo: 'receita',
            updated_at: 'v1',
            subcategorias: [{ id: 7, nome: 'Sessão de fono', categoria_id: 1 }],
          },
          {
            id: 2,
            nome: 'Despesas da clínica',
            tipo: 'despesa',
            updated_at: 'v1',
            subcategorias: [{ id: 9, nome: 'Aluguel', categoria_id: 2 }],
          },
        ]),
      ),
    )

    // ACT
    const daMae = await subcategoriasDe(2).listar()

    // ASSERT
    expect(daMae).toEqual([{ id: 9, nome: 'Aluguel', categoria_id: 2 }])
  })

  it('deve devolver lista vazia quando a categoria não existe mais', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/categorias', () => HttpResponse.json([])))

    // ACT
    const resultado = await subcategoriasDe(404).listar()

    // ASSERT — nunca `undefined.map` na tela
    expect(resultado).toEqual([])
  })

  it('deve criar na rota ANINHADA e editar na rota SOLTA, mandando a versão', async () => {
    // ARRANGE
    const chamadas: string[] = []
    let versaoEnviada: string | null = null
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/categorias/3/subcategorias', async ({ request }) => {
        chamadas.push(`POST ${new URL(request.url).pathname}`)
        return HttpResponse.json({ id: 11, nome: 'Avaliação', categoria_id: 3 }, { status: 201 })
      }),
      msw.put('/api/subcategorias/11', ({ request }) => {
        chamadas.push(`PUT ${new URL(request.url).pathname}`)
        versaoEnviada = request.headers.get('If-Match')
        return HttpResponse.json({ id: 11, nome: 'Avaliação inicial', categoria_id: 3 })
      }),
      msw.delete('/api/subcategorias/11', ({ request }) => {
        chamadas.push(`DELETE ${new URL(request.url).pathname}`)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const recurso = subcategoriasDe(3)

    // ACT
    await recurso.criar({ nome: 'Avaliação', codigo_contabil: null })
    await recurso.atualizar(11, { nome: 'Avaliação inicial', codigo_contabil: null }, 'v9')
    await recurso.excluir(11)

    // ASSERT
    expect(chamadas).toEqual([
      'POST /api/categorias/3/subcategorias',
      'PUT /api/subcategorias/11',
      'DELETE /api/subcategorias/11',
    ])
    expect(versaoEnviada).toBe('v9')
  })
})

/**
 * Os quatro catálogos financeiros compartilham a fábrica de CRUD; o que se prova aqui
 * é o CAMINHO de cada um (um `/api/contas` trocado por `/api/cartoes` compila) e que a
 * edição leva o `If-Match` que as quatro controladoras exigem.
 */
describe('catálogos financeiros — caminho certo e versão na edição', () => {
  it.each([
    ['contas', contas, '/api/contas'],
    ['tiposPagamento', tiposPagamento, '/api/tipos-pagamento'],
    ['categorias', categorias, '/api/categorias'],
    ['cartoes', cartoes, '/api/cartoes'],
  ])('deve endereçar %s em %s', async (_nome, recurso, caminho) => {
    // ARRANGE
    let versaoEnviada: string | null = null
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get(caminho, () => HttpResponse.json([{ id: 1 }])),
      msw.put(`${caminho}/1`, ({ request }) => {
        versaoEnviada = request.headers.get('If-Match')
        return HttpResponse.json({ id: 1 })
      }),
    )

    // ACT
    const listados = await recurso.listar()
    await recurso.atualizar(1, {} as never, 'v3')

    // ASSERT
    expect(listados).toEqual([{ id: 1 }])
    expect(versaoEnviada).toBe('v3')
  })
})
