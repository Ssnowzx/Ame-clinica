import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ExigePermissao } from '@/componentes/acesso-negado'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaTarefas } from '@/paginas/pagina-tarefas'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ItemDeOrdem, Tarefa } from '@/tipos'

expect.extend(toHaveNoViolations)

const TODAS = ['tarefas.ver', 'tarefas.criar', 'tarefas.editar', 'tarefas.excluir']

function tarefa(sobrescritas: Partial<Tarefa> & Pick<Tarefa, 'id' | 'titulo'>): Tarefa {
  return {
    descricao: null,
    coluna: 'a_fazer',
    prioridade: 'media',
    prazo: null,
    etiquetas: null,
    posicao: 0,
    concluida_em: null,
    arquivada_em: null,
    responsaveis: [],
    comentarios_count: 0,
    comentarios_nao_lidos_count: 0,
    updated_at: '2026-07-26T10:00:00.000000Z',
    ...sobrescritas,
  }
}

function prepararQuadro(tarefas: Tarefa[]) {
  servidor.use(
    msw.get('/api/tarefas', () => HttpResponse.json(tarefas)),
    msw.get('/api/tarefas/usuarios', () =>
      HttpResponse.json([
        { id: 1, nome: 'Operadora Fictícia' },
        { id: 2, nome: 'Colega Fictícia' },
      ]),
    ),
  )
}

function renderizar(permissoes: string[] = TODAS, rota = '/tarefas') {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[rota]}>
          <ExigePermissao permissao="tarefas.ver">
            <PaginaTarefas />
          </ExigePermissao>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

/** Stub do hit-test (jsdom não tem layout) — o padrão de pagina-agenda-arrastar. */
function stubElementFromPoint(alvo: Element | null): () => void {
  const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: () => alvo,
  })
  return () => {
    if (original === undefined) {
      Reflect.deleteProperty(document, 'elementFromPoint')
    } else {
      Object.defineProperty(document, 'elementFromPoint', original)
    }
  }
}

/** Pressiona a alavanca, cruza o limiar de 6px e solta sobre `alvo`. */
function arrastarPara(alavanca: Element, alvo: Element | null): void {
  const restaurar = stubElementFromPoint(alvo)
  fireEvent.pointerDown(alavanca, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 90, clientY: 90 })
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 90, clientY: 90 })
  restaurar()
}

function alavancaDoCartao(id: number): Element {
  const alavanca = document.querySelector(`[data-alavanca="${id}"]`)
  if (alavanca === null) {
    throw new Error(`alavanca do cartão ${id} não encontrada`)
  }
  return alavanca
}

describe('PaginaTarefas — o quadro', () => {
  it('deve renderizar as quatro colunas com cartões na ordem e contadores', async () => {
    // ARRANGE
    prepararQuadro([
      tarefa({ id: 1, titulo: 'Trocar tinta da impressora', posicao: 1 }),
      tarefa({ id: 2, titulo: 'Ligar para o fornecedor fictício', posicao: 0 }),
      tarefa({ id: 3, titulo: 'Conferir agenda de agosto', coluna: 'em_andamento' }),
    ])

    // ACT
    renderizar()

    // ASSERT — colunas nomeadas; ordem por posição dentro de a_fazer
    const colunaAFazer = await screen.findByRole('region', { name: /A fazer \(2\)/ })
    const cartoes = within(colunaAFazer).getAllByRole('article')
    expect(cartoes[0]).toHaveAccessibleName('Ligar para o fornecedor fictício')
    expect(cartoes[1]).toHaveAccessibleName('Trocar tinta da impressora')
    expect(screen.getByRole('region', { name: /Em andamento \(1\)/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Aguardando \(0\)/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Concluída \(0\)/ })).toBeInTheDocument()
  })

  it('deve convidar discretamente na coluna vazia', async () => {
    // ARRANGE
    prepararQuadro([])

    // ACT
    renderizar()

    // ASSERT
    const convites = await screen.findAllByText('Nada aqui — crie ou arraste uma tarefa para cá.')
    expect(convites).toHaveLength(4)
  })

  it('deve mostrar erro com repetir quando o quadro não carrega', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/tarefas', () => HttpResponse.json({}, { status: 500 })))

    // ACT
    renderizar()

    // ASSERT — o client re-tenta 1× no 5xx antes de assumir o erro (timeout folgado)
    expect(
      await screen.findByText('Não foi possível carregar o mural de tarefas.', undefined, {
        timeout: 4000,
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument()
  })

  it('deve negar a tela a quem não tem tarefas.ver', async () => {
    // ARRANGE + ACT — guard de rota (o servidor continua decidindo de verdade)
    renderizar(['agenda.ver'])

    // ASSERT
    expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  })

  it('deve dizer o atraso em PALAVRA e marcar não lidos de forma acessível', async () => {
    // ARRANGE — prazo vencido fora de concluída + 2 comentários não lidos
    prepararQuadro([
      tarefa({
        id: 5,
        titulo: 'Tarefa atrasada fictícia',
        prazo: '2020-01-10',
        comentarios_count: 3,
        comentarios_nao_lidos_count: 2,
      }),
    ])

    // ACT
    renderizar()

    // ASSERT — 1.4.1: a palavra diz, não só a cor
    expect(await screen.findByText(/Atrasada ·/)).toBeInTheDocument()
    expect(screen.getByText('3 comentários, 2 não lidos')).toBeInTheDocument()
  })
})

describe('PaginaTarefas — mover sem mouse', () => {
  it('deve mover pelo menu do cartão com lote denso e anúncio em aria-live', async () => {
    // ARRANGE
    const lotes: ItemDeOrdem[][] = []
    prepararQuadro([
      tarefa({ id: 1, titulo: 'Cartão do topo', posicao: 0 }),
      tarefa({ id: 2, titulo: 'Cartão de baixo', posicao: 1 }),
    ])
    servidor.use(
      msw.patch('/api/tarefas/ordem', async ({ request }) => {
        const corpo = (await request.json()) as { itens: ItemDeOrdem[] }
        lotes.push(corpo.itens)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const usuaria = userEvent.setup()
    renderizar()

    // ACT — teclado: menu do cartão → "Mover para Em andamento"
    await usuaria.click(await screen.findByRole('button', { name: 'Ações de Cartão do topo' }))
    await usuaria.click(await screen.findByRole('button', { name: 'Mover para Em andamento' }))

    // ASSERT — lote com as DUAS colunas densas + anúncio para leitor de tela
    await waitFor(() => expect(lotes).toHaveLength(1))
    expect(lotes[0]).toEqual(
      expect.arrayContaining([
        { id: 1, coluna: 'em_andamento', posicao: 0 },
        { id: 2, coluna: 'a_fazer', posicao: 0 },
      ]),
    )
    expect(
      screen.getByText('Cartão do topo movida para Em andamento, posição 1 de 1.'),
    ).toBeInTheDocument()
  })
})

describe('PaginaTarefas — arrastar com o ponteiro', () => {
  it('deve mover por arrasto com lote denso das duas colunas', async () => {
    // ARRANGE
    const lotes: ItemDeOrdem[][] = []
    prepararQuadro([
      tarefa({ id: 1, titulo: 'Arrastável fictícia', posicao: 0 }),
      tarefa({ id: 2, titulo: 'Vizinha fictícia', posicao: 1 }),
    ])
    servidor.use(
      msw.patch('/api/tarefas/ordem', async ({ request }) => {
        const corpo = (await request.json()) as { itens: ItemDeOrdem[] }
        lotes.push(corpo.itens)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderizar()
    await screen.findByRole('region', { name: /A fazer \(2\)/ })

    // ACT — solta na área vazia de Em andamento (fim da coluna)
    arrastarPara(
      alavancaDoCartao(1),
      screen.getByRole('region', { name: /Em andamento/ }),
    )

    // ASSERT — o lote com as DUAS colunas densas (o refetch do onSettled devolve
    // o mock estático, então o contrato provado aqui é o REQUEST, não o pixel)
    await waitFor(() => expect(lotes).toHaveLength(1))
    expect(lotes[0]).toEqual(
      expect.arrayContaining([
        { id: 1, coluna: 'em_andamento', posicao: 0 },
        { id: 2, coluna: 'a_fazer', posicao: 0 },
      ]),
    )
  })

  it('deve tratar soltar sobre SI MESMO como não-evento — nenhum request', async () => {
    // ARRANGE — regressão do CR-KB-01: o arrasto abortado não pode reordenar
    const lotes: ItemDeOrdem[][] = []
    prepararQuadro([
      tarefa({ id: 1, titulo: 'Cartão parado fictício', posicao: 0 }),
      tarefa({ id: 2, titulo: 'Cartão de baixo fictício', posicao: 1 }),
    ])
    servidor.use(
      msw.patch('/api/tarefas/ordem', async ({ request }) => {
        lotes.push(((await request.json()) as { itens: ItemDeOrdem[] }).itens)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderizar()
    await screen.findByRole('region', { name: /A fazer \(2\)/ })

    // ACT — cruza o limiar e solta SOBRE o próprio cartão
    const cartao = document.querySelector('[data-cartao="1"]')
    arrastarPara(alavancaDoCartao(1), cartao)

    // ASSERT — nada foi enviado e a ordem não mudou
    await new Promise((resolver) => setTimeout(resolver, 50))
    expect(lotes).toHaveLength(0)
    const coluna = screen.getByRole('region', { name: /A fazer \(2\)/ })
    const cartoes = within(coluna).getAllByRole('article')
    expect(cartoes[0]).toHaveAccessibleName('Cartão parado fictício')
  })

  it('deve devolver o cartão e avisar quando a persistência do arrasto falha', async () => {
    // ARRANGE — otimista com rollback (spec tarefas-tela)
    prepararQuadro([tarefa({ id: 1, titulo: 'Volta ao lugar fictícia', posicao: 0 })])
    servidor.use(
      msw.patch('/api/tarefas/ordem', () => HttpResponse.json({}, { status: 500 })),
      // o refetch do onSettled devolve o estado do SERVIDOR (inalterado)
      msw.get('/api/tarefas', () =>
        HttpResponse.json([tarefa({ id: 1, titulo: 'Volta ao lugar fictícia', posicao: 0 })]),
      ),
    )
    renderizar()
    await screen.findByRole('region', { name: /A fazer \(1\)/ })

    // ACT
    arrastarPara(
      alavancaDoCartao(1),
      screen.getByRole('region', { name: /Aguardando/ }),
    )

    // ASSERT — aviso + cartão de volta à coluna de origem
    expect(await screen.findByText('Não foi possível mover a tarefa.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /A fazer \(1\)/ })).toBeInTheDocument(),
    )
    expect(screen.getByRole('region', { name: /Aguardando \(0\)/ })).toBeInTheDocument()
  })
})

describe('PaginaTarefas — demanda aberta e filtros', () => {
  it('deve assumir a demanda pelo cartão e refletir sem recarregar', async () => {
    // ARRANGE — handler COM estado: o refetch da invalidação devolve o novo dono
    const aberta = tarefa({ id: 7, titulo: 'Demanda sem dono fictícia' })
    const assumida = { ...aberta, responsaveis: [{ id: 1, nome: 'Operadora Fictícia' }] }
    let quadroAtual = [aberta]
    prepararQuadro(quadroAtual)
    servidor.use(
      msw.get('/api/tarefas', () => HttpResponse.json(quadroAtual)),
      msw.post('/api/tarefas/7/assumir', () => {
        quadroAtual = [assumida]
        return HttpResponse.json(assumida)
      }),
    )
    const usuaria = userEvent.setup()
    renderizar()

    // ACT
    await usuaria.click(await screen.findByRole('button', { name: 'Assumir' }))

    // ASSERT — o avatar da responsável aparece; o botão some
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Assumir' })).not.toBeInTheDocument(),
    )
    const responsaveis = screen.getByRole('list', { name: 'Responsáveis' })
    expect(within(responsaveis).getByText('Operadora Fictícia')).toBeInTheDocument()
  })

  it('deve filtrar por responsável com contadores acompanhando', async () => {
    // ARRANGE
    prepararQuadro([
      tarefa({ id: 1, titulo: 'Com dona', responsaveis: [{ id: 2, nome: 'Colega Fictícia' }] }),
      tarefa({ id: 2, titulo: 'Sem dono', posicao: 1 }),
    ])
    const usuaria = userEvent.setup()
    renderizar()
    await screen.findByRole('region', { name: /A fazer \(2\)/ })

    // ACT — filtro "Sem responsável"
    await usuaria.selectOptions(screen.getByLabelText('Responsável'), 'sem')

    // ASSERT — só a demanda aberta fica; o contador da coluna acompanha
    expect(screen.getByRole('region', { name: /A fazer \(1\)/ })).toBeInTheDocument()
    expect(screen.queryByText('Com dona')).not.toBeInTheDocument()
  })
})

describe('PaginaTarefas — deep-link e modal', () => {
  it('deve abrir a tarefa do ?tarefa= e avisar discretamente para id estranho', async () => {
    // ARRANGE
    prepararQuadro([tarefa({ id: 42, titulo: 'Alvo do deep-link' })])

    // ACT — deep-link válido
    renderizar(TODAS, '/tarefas?tarefa=42')

    // ASSERT — o modal de edição abre com o formulário hidratado
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Alvo do deep-link')).toBeInTheDocument()
  })

  it('deve marcar os eventos da tarefa como lidos ao abrir pelo deep-link', async () => {
    // ARRANGE — abrir a tarefa é LER as novidades dela (alertas-do-mural)
    prepararQuadro([tarefa({ id: 42, titulo: 'Alvo com novidade' })])
    let marcadaComoLida = false
    servidor.use(
      msw.post('/api/tarefas/42/eventos/ler', () => {
        marcadaComoLida = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    // ACT
    renderizar(TODAS, '/tarefas?tarefa=42')

    // ASSERT — modal aberto E leitura carimbada no servidor
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(marcadaComoLida).toBe(true))
  })

  it('deve avisar sem quebrar o quadro quando o id não existe', async () => {
    // ARRANGE
    prepararQuadro([tarefa({ id: 1, titulo: 'Única do quadro' })])

    // ACT
    renderizar(TODAS, '/tarefas?tarefa=999')

    // ASSERT — aviso discreto e o quadro segue utilizável
    expect(await screen.findByText('Tarefa não encontrada no quadro.')).toBeInTheDocument()
    expect(screen.getByText('Única do quadro')).toBeInTheDocument()
  })

  it('deve exigir título com erro específico e manter a orientação LGPD visível', async () => {
    // ARRANGE
    prepararQuadro([])
    const usuaria = userEvent.setup()
    renderizar()

    // ACT — abre "Nova tarefa" e submete vazio
    await usuaria.click(await screen.findByRole('button', { name: 'Nova tarefa' }))
    const dialogo = await screen.findByRole('dialog')

    // ASSERT — microcopy de minimização SEMPRE visível no formulário
    expect(
      within(dialogo).getByText(/Não registre dado clínico nem pessoal de paciente/),
    ).toBeInTheDocument()

    await usuaria.click(within(dialogo).getByRole('button', { name: 'Criar tarefa' }))
    expect(
      await within(dialogo).findByText('Dê um título de pelo menos 2 caracteres.'),
    ).toBeInTheDocument()
  })
})

describe('PaginaTarefas — acessibilidade', () => {
  it('deve passar no axe com o quadro populado', async () => {
    // ARRANGE
    prepararQuadro([
      tarefa({ id: 1, titulo: 'Cartão acessível fictício', prazo: '2099-01-01', etiquetas: 'recepção' }),
      tarefa({
        id: 2,
        titulo: 'Outro cartão fictício',
        coluna: 'concluida',
        responsaveis: [{ id: 2, nome: 'Colega Fictícia' }],
      }),
    ])

    // ACT
    const { container } = renderizar()
    await screen.findByRole('region', { name: /A fazer \(1\)/ })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})
