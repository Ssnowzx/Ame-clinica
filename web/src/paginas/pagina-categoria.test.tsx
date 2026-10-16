import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaCategoria } from '@/paginas/pagina-categoria'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CategoriaFinanceira } from '@/tipos'

const TUDO = ['categorias.ver', 'categorias.criar', 'categorias.editar', 'categorias.excluir']

const RECEITA: CategoriaFinanceira = {
  id: 1,
  nome: 'Atendimentos',
  tipo: 'receita',
  subcategorias: [
    { id: 7, nome: 'Sessão de fono', categoria_id: 1, codigo_contabil: '3.1.01', updated_at: 'v1' },
  ],
  updated_at: 'v1',
}

const DESPESA: CategoriaFinanceira = {
  id: 2,
  nome: 'Despesas da clínica',
  tipo: 'despesa',
  subcategorias: [{ id: 9, nome: 'Aluguel', categoria_id: 2, codigo_contabil: null, updated_at: 'v1' }],
  updated_at: 'v1',
}

function renderizar(id = 1, permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[`/categorias/${id}`]}>
          <Routes>
            <Route path="/categorias/:id" element={<PaginaCategoria />} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Página da categoria — a subcategoria nunca aparece sem a mãe', () => {
  it('deve anunciar o nome e a natureza da categoria, e voltar para a lista', async () => {
    // ARRANGE — "Aluguel" sozinho não diz nada a quem classifica o caixa
    servidor.use(msw.get('/api/categorias', () => HttpResponse.json([RECEITA, DESPESA])))

    // ACT
    renderizar(2)

    // ASSERT
    expect(await screen.findByRole('heading', { level: 1, name: 'Despesas da clínica' })).toBeInTheDocument()
    expect(screen.getByText('Despesa')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Categorias do caixa' })).toHaveAttribute(
      'href',
      '/categorias',
    )
  })

  it('deve listar SÓ as subcategorias da mãe da rota', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/categorias', () => HttpResponse.json([RECEITA, DESPESA])))

    // ACT
    renderizar(2)

    // ASSERT
    expect(await screen.findByText('Aluguel')).toBeInTheDocument()
    expect(screen.queryByText('Sessão de fono')).not.toBeInTheDocument()
  })

  it('deve manter um único h1 na rota — a seção das subcategorias é h2', async () => {
    // ARRANGE — dois h1 apagam a hierarquia de quem navega por headings (A11Y-LP-01)
    servidor.use(msw.get('/api/categorias', () => HttpResponse.json([RECEITA])))

    // ACT
    renderizar()
    await screen.findByText('Sessão de fono')

    // ASSERT
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 2, name: /Subcategorias/i })).toBeInTheDocument()
  })
})

describe('Página da categoria — endereço que não existe', () => {
  it('deve oferecer a volta quando o id não é um número válido', async () => {
    // ARRANGE + ACT — botão "tentar novamente" que não faz nada é pior que não ter botão
    renderizar(0)

    // ASSERT
    expect(await screen.findByText('Categoria não encontrada')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar às categorias/i })).toBeInTheDocument()
  })

  it('deve distinguir categoria APAGADA de erro de rede', async () => {
    // ARRANGE — a consulta responde, mas sem a linha: é ausência, não falha
    servidor.use(msw.get('/api/categorias', () => HttpResponse.json([RECEITA])))

    // ACT
    renderizar(404)

    // ASSERT
    expect(await screen.findByText('Categoria não encontrada')).toBeInTheDocument()
    expect(screen.getByText(/pode ter sido excluída por outra pessoa/i)).toBeInTheDocument()
  })
})

describe('Página da categoria — criar subcategoria usa a rota ANINHADA', () => {
  it('deve enviar o POST para dentro da categoria da rota', async () => {
    // ARRANGE
    let caminhoDoPost = ''
    const noServidor = [structuredClone(DESPESA)]
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/categorias', () => HttpResponse.json(noServidor)),
      msw.post('/api/categorias/:categoriaId/subcategorias', ({ request, params }) => {
        caminhoDoPost = new URL(request.url).pathname
        const criada = {
          id: 30,
          nome: 'Água e luz',
          categoria_id: Number(params.categoriaId),
          codigo_contabil: null,
          updated_at: 'v1',
        }
        noServidor[0]?.subcategorias.push(criada)
        return HttpResponse.json(criada, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar(2)
    await screen.findByText('Aluguel')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Cadastrar subcategoria/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Água e luz')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT
    expect(await screen.findByText('Água e luz')).toBeInTheDocument()
    expect(caminhoDoPost).toBe('/api/categorias/2/subcategorias')
  })
})

describe('Página da categoria — escrever na filha refresca a mãe', () => {
  it('deve invalidar TAMBÉM a lista de categorias ao cadastrar uma subcategoria', async () => {
    // ARRANGE — a subcategoria nova muda a CONTAGEM da lista de categorias e entra no
    // seletor do lançamento, que leem `['categorias']`. Sem invalidar o prefixo, as
    // duas ficam desatualizadas e ninguém percebe até alguém não achar a subcategoria
    // no formulário de caixa.
    let getsDepoisDoPost = 0
    let jaCriou = false
    const noServidor = [structuredClone(DESPESA)]
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/categorias', () => {
        if (jaCriou) getsDepoisDoPost += 1
        return HttpResponse.json(noServidor)
      }),
      msw.post('/api/categorias/:categoriaId/subcategorias', () => {
        jaCriou = true
        const criada = {
          id: 31,
          nome: 'Internet',
          categoria_id: 2,
          codigo_contabil: null,
          updated_at: 'v1',
        }
        noServidor[0]?.subcategorias.push(criada)
        return HttpResponse.json(criada, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar(2)
    await screen.findByText('Aluguel')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Cadastrar subcategoria/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Internet')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))
    await screen.findByText('Internet')

    // ASSERT — as DUAS consultas ativas releram (a da mãe e a das subcategorias);
    // invalidar só a chave da filha traria uma leitura só
    expect(getsDepoisDoPost).toBe(2)
  })
})

describe('Página da categoria — a subcategoria é gerida sob a permissão da CATEGORIA', () => {
  it('deve esconder as ações de escrita de quem só tem categorias.ver', async () => {
    // ARRANGE — subcategoria não tem módulo próprio (parecer §3: é agregado da
    // categoria). Passar o módulo errado aqui daria a alguém sem `categorias.criar`
    // um botão que o servidor nega — e o erro só apareceria no clique.
    servidor.use(msw.get('/api/categorias', () => HttpResponse.json([RECEITA])))

    // ACT
    renderizar(1, ['categorias.ver'])
    await screen.findByText('Sessão de fono')

    // ASSERT
    expect(screen.queryByRole('button', { name: /Cadastrar subcategoria/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('deve oferecer as ações a quem tem as permissões de categorias', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/categorias', () => HttpResponse.json([RECEITA])))

    // ACT
    renderizar(1)
    await screen.findByText('Sessão de fono')

    // ASSERT
    expect(screen.getByRole('button', { name: /Cadastrar subcategoria/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
  })
})


describe('Subcategoria — o nome repetido pousa no campo, com a string real do servidor', () => {
  it('deve mostrar a recusa 422 no campo Nome sem fechar o formulário', async () => {
    // ARRANGE — a mensagem estava asserida só no teste da API: os dois lados podiam
    // divergir sem ninguém ver (achado I-5 do gate). Aqui a string literal fixa o par.
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/categorias', () => HttpResponse.json([RECEITA])),
      msw.post('/api/categorias/:id/subcategorias', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: { nome: ['Já existe uma subcategoria com este nome nesta categoria.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(1)
    await screen.findByText('Sessão de fono')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Cadastrar subcategoria/i }))
    const dialog = await screen.findByRole('alertdialog')
    const campoNome = within(dialog).getByRole('textbox', { name: /^Nome/i })
    await usuario.type(campoNome, 'Sessão de fono')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT — o texto EXATO, e o que foi digitado continua lá
    expect(
      await within(dialog).findByText('Já existe uma subcategoria com este nome nesta categoria.'),
    ).toBeInTheDocument()
    expect(campoNome).toHaveValue('Sessão de fono')
  })
})
