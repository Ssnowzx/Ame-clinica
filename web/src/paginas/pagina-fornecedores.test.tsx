import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { FORNECEDORES } from '@/componentes/financeiro/modulos-de-interessado'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaFornecedores } from '@/paginas/pagina-fornecedores'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Fornecedor, FornecedorDaLista, PaginaDeApi } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * A tela de Fornecedores (change `caixa-do-dia-a-dia`): a quem a clínica paga. Dados FICTÍCIOS —
 * razões sociais inventadas, documento com dígito verificador válido de exemplo.
 */

const VERSAO = '2026-09-25T10:00:00.000000Z'

const IMOBILIARIA: Fornecedor = {
  id: 1,
  razao_social: 'Imobiliária Fictícia Ltda',
  nome_fantasia: 'Imobiliária do Centro',
  cpf_cnpj: '11222333000181',
  categoria_id: 5,
  subcategoria_id: 51,
  centro_custo: null,
  ativo: true,
  contatos_json: [{ tipo: 'telefone', valor: '(00) 0000-0000', obs: null }],
  endereco_json: null,
  updated_at: VERSAO,
}

const PAPELARIA: Fornecedor = {
  id: 2,
  razao_social: 'Papelaria Exemplo ME',
  nome_fantasia: null,
  cpf_cnpj: null,
  categoria_id: null,
  subcategoria_id: null,
  centro_custo: null,
  ativo: true,
  contatos_json: null,
  endereco_json: null,
  updated_at: VERSAO,
}

const CATEGORIAS = [
  { id: 4, nome: 'Atendimentos', tipo: 'receita', subcategorias: [] },
  { id: 5, nome: 'Despesas fixas', tipo: 'despesa', subcategorias: [{ id: 51, nome: 'Aluguel', categoria_id: 5 }] },
]

const QUEM_ADMINISTRA = [
  'fornecedores.ver',
  'fornecedores.criar',
  'fornecedores.editar',
  'fornecedores.excluir',
  'categorias.ver',
]

/** A LINHA como a API lista: sem documento, contatos, endereço nem `updated_at` (T-fin-05). */
function comoLinha(fornecedor: Fornecedor): FornecedorDaLista {
  return {
    id: fornecedor.id,
    razao_social: fornecedor.razao_social,
    nome_fantasia: fornecedor.nome_fantasia,
    categoria_id: fornecedor.categoria_id,
    subcategoria_id: fornecedor.subcategoria_id,
    centro_custo: fornecedor.centro_custo,
    ativo: fornecedor.ativo,
  }
}

function pagina(itens: FornecedorDaLista[]): PaginaDeApi<FornecedorDaLista> {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

interface Envio {
  metodo: string
  url: string
  corpo: Record<string, unknown> | null
  versao: string | null
}

/** Um servidor de fornecedores com estado — o que a tela manda chega aqui, e a lista reflete. */
function comServidor(inicial: Fornecedor[] = [IMOBILIARIA, PAPELARIA]) {
  const cadastro = new Map(inicial.map((fornecedor) => [fornecedor.id, fornecedor]))
  const buscas: string[] = []
  const envios: Envio[] = []

  servidor.use(
    msw.get('/api/categorias', () => HttpResponse.json(CATEGORIAS)),
    msw.get('/api/fornecedores', ({ request }) => {
      const busca = (new URL(request.url).searchParams.get('busca') ?? '').toLowerCase()
      buscas.push(busca)
      const achados = [...cadastro.values()].filter((fornecedor) =>
        fornecedor.razao_social.toLowerCase().includes(busca),
      )
      return HttpResponse.json(pagina(achados.map(comoLinha)))
    }),
    msw.get('/api/fornecedores/:id', ({ params }) => {
      const fornecedor = cadastro.get(Number(params.id))
      return fornecedor === undefined ? new HttpResponse(null, { status: 404 }) : HttpResponse.json(fornecedor)
    }),
    msw.post('/api/fornecedores', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      envios.push({ metodo: 'POST', url: request.url, corpo, versao: null })
      const novo = { ...PAPELARIA, ...corpo, id: 3, updated_at: VERSAO } as Fornecedor
      cadastro.set(3, novo)
      return HttpResponse.json(novo, { status: 201 })
    }),
    msw.put('/api/fornecedores/:id', async ({ request, params }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      envios.push({ metodo: 'PUT', url: request.url, corpo, versao: request.headers.get('If-Match') })
      const atual = cadastro.get(Number(params.id)) as Fornecedor
      const salvo = { ...atual, ...corpo, updated_at: '2026-09-25T11:00:00.000000Z' } as Fornecedor
      cadastro.set(atual.id, salvo)
      return HttpResponse.json(salvo)
    }),
    msw.delete('/api/fornecedores/:id', ({ request, params }) => {
      envios.push({ metodo: 'DELETE', url: request.url, corpo: null, versao: null })
      cadastro.delete(Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )

  return { buscas, envios }
}

function renderizar(permissoes: string[] = QUEM_ADMINISTRA) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/fornecedores']}>
          <PaginaFornecedores />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** A linha da tabela de um fornecedor, pelo nome. */
async function linhaDe(nome: string): Promise<HTMLElement> {
  const celula = await screen.findByRole('cell', { name: nome })
  return celula.closest('tr') as HTMLElement
}

beforeEach(() => {
  queryClient.clear()
})

describe('Fornecedores — a lista', () => {
  it('deve listar razão social, nome fantasia, categoria padrão e situação', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar()

    // ASSERT
    const linha = await linhaDe('Imobiliária Fictícia Ltda')
    expect(within(linha).getByRole('cell', { name: 'Imobiliária do Centro' })).toBeInTheDocument()
    expect(await within(linha).findByRole('cell', { name: 'Despesas fixas › Aluguel' })).toBeInTheDocument()
    expect(within(linha).getByRole('cell', { name: 'Ativo' })).toBeInTheDocument()
    expect(screen.getByText('2 fornecedores', { selector: 'p' })).toBeInTheDocument()
  })

  it('deve não mostrar o documento na lista', async () => {
    // ARRANGE — a lista é minimizada: documento, contatos e endereço só no formulário
    comServidor()

    // ACT
    renderizar()
    await linhaDe('Imobiliária Fictícia Ltda')

    // ASSERT
    expect(screen.queryByText(/11\.222\.333/)).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /CPF|CNPJ|Documento/ })).not.toBeInTheDocument()
  })

  it('deve dizer para que serve o cadastro', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar()

    // ASSERT — a frase de "o que é" (design D8)
    expect(await screen.findByText(FORNECEDORES.explicacao)).toBeInTheDocument()
  })

  it('deve buscar no servidor pelo termo digitado', async () => {
    // ARRANGE
    const { buscas } = comServidor()
    const usuario = userEvent.setup()
    renderizar()
    await linhaDe('Papelaria Exemplo ME')

    // ACT
    await usuario.type(screen.getByLabelText('Buscar fornecedor'), 'imob')

    // ASSERT — o filtro é do servidor, não da página já carregada
    await waitFor(() => {
      expect(buscas).toContain('imob')
    })
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Papelaria Exemplo ME' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('cell', { name: 'Imobiliária Fictícia Ltda' })).toBeInTheDocument()
  })

  it('deve oferecer cadastrar quando ainda não há fornecedor', async () => {
    // ARRANGE
    comServidor([])

    // ACT
    renderizar()

    // ASSERT — o estado vazio aponta o próximo passo
    expect(await screen.findByText('Nenhum fornecedor cadastrado')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Cadastrar fornecedor' })).toHaveLength(2)
  })
})

describe('Fornecedores — cadastrar e editar', () => {
  it('deve cadastrar com o documento em dígitos e o fornecedor aparecer na lista', async () => {
    // ARRANGE
    const { envios } = comServidor([PAPELARIA])
    const usuario = userEvent.setup()
    renderizar()
    await linhaDe('Papelaria Exemplo ME')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar fornecedor' }))
    await usuario.type(screen.getByLabelText('Razão social (obrigatório)'), 'Contabilidade Modelo SS')
    await usuario.type(screen.getByLabelText('CPF ou CNPJ'), '11.222.333/0001-81')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    expect(await screen.findByRole('cell', { name: 'Contabilidade Modelo SS' })).toBeInTheDocument()
    expect(envios[0]?.corpo).toMatchObject({
      razao_social: 'Contabilidade Modelo SS',
      cpf_cnpj: '11222333000181',
      ativo: true,
      contatos_json: [],
      endereco_json: null,
    })
  })

  it('deve editar relendo o cadastro e mandando o If-Match da leitura', async () => {
    // ARRANGE
    const { envios } = comServidor()
    const usuario = userEvent.setup()
    renderizar()
    const linha = await linhaDe('Imobiliária Fictícia Ltda')

    // ACT — o formulário traz o que a LISTA não tem (o contato), lido agora do servidor
    await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))
    expect(await screen.findByDisplayValue('(00) 0000-0000')).toBeInTheDocument()
    const fantasia = screen.getByLabelText('Nome fantasia')
    await usuario.clear(fantasia)
    await usuario.type(fantasia, 'Imobiliária Nova')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o contato volta igual: editar um campo não apaga o resto do cadastro
    await waitFor(() => {
      expect(envios).toHaveLength(1)
    })
    expect(envios[0]?.versao).toBe(VERSAO)
    expect(envios[0]?.corpo).toMatchObject({
      nome_fantasia: 'Imobiliária Nova',
      cpf_cnpj: '11222333000181',
      categoria_id: 5,
      subcategoria_id: 51,
      contatos_json: [{ tipo: 'telefone', valor: '(00) 0000-0000', obs: null }],
    })
  })

  it('deve inativar pelo formulário', async () => {
    // ARRANGE
    const { envios } = comServidor()
    const usuario = userEvent.setup()
    renderizar()
    const linha = await linhaDe('Papelaria Exemplo ME')

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))
    await usuario.click(await screen.findByRole('checkbox', { name: 'Ativo' }))
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    expect(await within(await linhaDe('Papelaria Exemplo ME')).findByRole('cell', { name: 'Inativo' })).toBeInTheDocument()
    expect(envios[0]?.corpo).toMatchObject({ ativo: false })
  })

  it('deve avisar o conflito e recarregar a versão de agora', async () => {
    // ARRANGE — outra pessoa salvou entre a leitura e o salvar
    const { envios } = comServidor()
    servidor.use(
      msw.put('/api/fornecedores/:id', () =>
        HttpResponse.json({ message: 'Este registro foi alterado por outra pessoa.' }, { status: 409 }),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    const linha = await linhaDe('Papelaria Exemplo ME')
    await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))
    await usuario.type(await screen.findByLabelText('Nome fantasia'), 'Papelaria da Esquina')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))
    await usuario.click(await screen.findByRole('button', { name: 'Recarregar' }))

    // ASSERT — o que foi digitado só some porque a pessoa pediu para recarregar
    await waitFor(() => {
      expect(screen.getByLabelText('Nome fantasia')).toHaveValue('')
    })
    expect(envios).toHaveLength(0)
  })
})

describe('Fornecedores — excluir quem já recebeu', () => {
  it('deve excluir quem ainda não tem lançamento', async () => {
    // ARRANGE
    const { envios } = comServidor()
    const usuario = userEvent.setup()
    renderizar()
    const linha = await linhaDe('Papelaria Exemplo ME')

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))
    await usuario.click(await screen.findByRole('button', { name: 'Excluir fornecedor' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('cell', { name: 'Papelaria Exemplo ME' })).not.toBeInTheDocument()
    })
    expect(envios.map((envio) => envio.metodo)).toEqual(['DELETE'])
  })

  it('deve pousar o foco no título quando a linha excluída leva o botão junto', async () => {
    // ARRANGE — sem âncora, o foco cairia no `body` e o leitor de tela ficaria mudo (2.4.3)
    comServidor()
    const usuario = userEvent.setup()
    renderizar()
    const linha = await linhaDe('Papelaria Exemplo ME')

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))
    await usuario.click(await screen.findByRole('button', { name: 'Excluir fornecedor' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Fornecedores' })).toHaveFocus()
    })
  })

  it('deve mostrar a recusa do servidor e oferecer inativar', async () => {
    // ARRANGE — com lançamento, o servidor recusa (retenção fiscal)
    comServidor()
    servidor.use(
      msw.delete('/api/fornecedores/:id', () =>
        HttpResponse.json(
          {
            message: 'Inválido.',
            errors: { fornecedor: ['Fornecedor com lançamentos não pode ser excluído — inative-o.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    const linha = await linhaDe('Imobiliária Fictícia Ltda')

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))
    await usuario.click(await screen.findByRole('button', { name: 'Excluir fornecedor' }))

    // ASSERT — a razão do servidor à vista, e a saída que ela aponta a um clique
    const dialogo = await screen.findByRole('alertdialog', { name: 'Inativar Imobiliária Fictícia Ltda?' })
    expect(within(dialogo).getByText('Fornecedor com lançamentos não pode ser excluído — inative-o.')).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Inativar fornecedor' })).toBeInTheDocument()
  })

  it('deve inativar pela oferta, relendo o cadastro e mandando o If-Match', async () => {
    // ARRANGE
    const { envios } = comServidor()
    servidor.use(
      msw.delete('/api/fornecedores/:id', () =>
        HttpResponse.json(
          { message: 'Inválido.', errors: { fornecedor: ['Fornecedor com lançamentos não pode ser excluído — inative-o.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    const linha = await linhaDe('Imobiliária Fictícia Ltda')
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))
    await usuario.click(await screen.findByRole('button', { name: 'Excluir fornecedor' }))

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Inativar fornecedor' }))

    // ASSERT — o cadastro inteiro volta igual, só com ativo: false
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(envios).toHaveLength(1)
    expect(envios[0]?.versao).toBe(VERSAO)
    expect(envios[0]?.corpo).toMatchObject({
      razao_social: 'Imobiliária Fictícia Ltda',
      cpf_cnpj: '11222333000181',
      ativo: false,
    })
    expect(await within(await linhaDe('Imobiliária Fictícia Ltda')).findByRole('cell', { name: 'Inativo' })).toBeInTheDocument()
  })

  it('deve não oferecer inativar a quem não pode editar', async () => {
    // ARRANGE
    comServidor()
    servidor.use(
      msw.delete('/api/fornecedores/:id', () =>
        HttpResponse.json(
          { message: 'Inválido.', errors: { fornecedor: ['Fornecedor com lançamentos não pode ser excluído — inative-o.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(['fornecedores.ver', 'fornecedores.excluir'])
    const linha = await linhaDe('Imobiliária Fictícia Ltda')

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))
    await usuario.click(await screen.findByRole('button', { name: 'Excluir fornecedor' }))

    // ASSERT — a razão aparece; a saída que exige outra permissão, não
    const dialogo = await screen.findByRole('alertdialog', { name: 'Excluir Imobiliária Fictícia Ltda?' })
    expect(await within(dialogo).findByText(/não pode ser excluído/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Inativar fornecedor' })).not.toBeInTheDocument()
  })
})

describe('Fornecedores — permissões', () => {
  it('deve esconder cadastrar, editar e excluir de quem só pode ver', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(['fornecedores.ver'])
    await linhaDe('Imobiliária Fictícia Ltda')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Cadastrar fornecedor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).not.toBeInTheDocument()
  })

  it('deve esconder a coluna da categoria de quem não pode ver as categorias', async () => {
    // ARRANGE — um "—" ali diria "sem categoria", o que seria mentira
    comServidor()

    // ACT
    renderizar(['fornecedores.ver'])
    await linhaDe('Imobiliária Fictícia Ltda')

    // ASSERT
    expect(screen.queryByRole('columnheader', { name: 'Categoria padrão' })).not.toBeInTheDocument()
  })
})

describe('Fornecedores — axe', () => {
  it('deve passar no axe na lista', async () => {
    // ARRANGE
    comServidor()

    // ACT — a página, sem a moldura do app (os marcos de região são do shell)
    const { container } = renderizar()
    await screen.findByRole('cell', { name: 'Despesas fixas › Aluguel' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe no formulário cheio, com contato e endereço', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar()
    const linha = await linhaDe('Imobiliária Fictícia Ltda')

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))
    await screen.findByDisplayValue('(00) 0000-0000')

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve passar no axe na oferta de inativar', async () => {
    // ARRANGE
    comServidor()
    servidor.use(
      msw.delete('/api/fornecedores/:id', () =>
        HttpResponse.json(
          { message: 'Inválido.', errors: { fornecedor: ['Fornecedor com lançamentos não pode ser excluído — inative-o.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    const linha = await linhaDe('Imobiliária Fictícia Ltda')
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Excluir fornecedor' }))
    await screen.findByRole('button', { name: 'Inativar fornecedor' })

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
