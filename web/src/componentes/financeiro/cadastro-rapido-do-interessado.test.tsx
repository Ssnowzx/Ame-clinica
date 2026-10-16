import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { FormularioLancamento } from '@/componentes/financeiro/formulario-lancamento'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { FornecedorDaLista, PaginaDeApi } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * O Interessado do lançamento (change `caixa-do-dia-a-dia`): o cadastro rápido de quem a clínica
 * paga (design D5) e a categoria padrão do fornecedor (design D6). Dados FICTÍCIOS (LGPD).
 */

const CATEGORIAS = [
  { id: 4, nome: 'Atendimentos', tipo: 'receita', subcategorias: [] },
  { id: 5, nome: 'Despesas fixas', tipo: 'despesa', subcategorias: [{ id: 51, nome: 'Aluguel', categoria_id: 5 }] },
  { id: 6, nome: 'Material', tipo: 'despesa', subcategorias: [] },
]

const DONO_DA_SALA: FornecedorDaLista = {
  id: 1,
  razao_social: 'Imobiliária Fictícia Ltda',
  nome_fantasia: null,
  categoria_id: 5,
  subcategoria_id: 51,
  centro_custo: null,
  ativo: true,
}

const QUEM_LANCA_DESPESA = ['lancamentos.ver', 'lancamentos.criar', 'fornecedores.ver', 'funcionarios.ver']
const QUEM_TAMBEM_CADASTRA = [...QUEM_LANCA_DESPESA, 'fornecedores.criar', 'funcionarios.criar']

function pagina<T>(itens: T[]): PaginaDeApi<T> {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

interface Registro {
  fornecedores: Array<Record<string, unknown>>
  funcionarios: Array<Record<string, unknown>>
  lancamentos: Array<Record<string, unknown>>
}

/** Catálogos do caixa + as buscas e as criações que o lançamento pode disparar. */
function comServidor(fornecedores: FornecedorDaLista[] = [DONO_DA_SALA]): Registro {
  const registro: Registro = { fornecedores: [], funcionarios: [], lancamentos: [] }
  servidor.use(
    msw.get('/api/contas', () => HttpResponse.json([{ id: 1, nome: 'Caixa', ativo: true }])),
    msw.get('/api/categorias', () => HttpResponse.json(CATEGORIAS)),
    msw.get('/api/tipos-pagamento', () => HttpResponse.json([{ id: 1, nome: 'PIX' }])),
    msw.get('/api/fornecedores', ({ request }) => {
      const busca = (new URL(request.url).searchParams.get('busca') ?? '').toLowerCase()
      return HttpResponse.json(pagina(fornecedores.filter((um) => um.razao_social.toLowerCase().includes(busca))))
    }),
    msw.get('/api/funcionarios', () => HttpResponse.json(pagina([]))),
    msw.post('/api/fornecedores', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      registro.fornecedores.push(corpo)
      return HttpResponse.json(
        {
          id: 40,
          razao_social: corpo.razao_social,
          nome_fantasia: null,
          cpf_cnpj: corpo.cpf_cnpj,
          categoria_id: corpo.categoria_id,
          subcategoria_id: corpo.subcategoria_id,
          centro_custo: null,
          ativo: true,
          contatos_json: null,
          endereco_json: null,
          updated_at: '2026-09-25T10:00:00.000000Z',
        },
        { status: 201 },
      )
    }),
    msw.post('/api/funcionarios', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      registro.funcionarios.push(corpo)
      return HttpResponse.json(
        { id: 41, nome: corpo.nome, funcao: corpo.funcao, ativo: true, cpf: null, nascimento: null, contatos_json: null, endereco_json: null, updated_at: '2026-09-25T10:00:00.000000Z' },
        { status: 201 },
      )
    }),
    msw.post('/api/lancamentos', async ({ request }) => {
      registro.lancamentos.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({}, { status: 201 })
    }),
  )
  return registro
}

function renderizar(permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <FormularioLancamento lancamento={null} aoFechar={() => undefined} />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** Abre a DESPESA — o aluguel, a papelaria — com os catálogos já carregados. */
async function abrirDespesa(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('option', { name: 'PIX' })
  await usuario.selectOptions(screen.getByLabelText('Tipo (obrigatório)'), 'despesa')
}

/** Escolhe o tipo de interessado e digita na busca. */
async function buscar(usuario: ReturnType<typeof userEvent.setup>, tipo: string, termo: string): Promise<void> {
  await usuario.selectOptions(screen.getByLabelText('Tipo de interessado'), tipo)
  await usuario.type(screen.getByRole('searchbox'), termo)
}

beforeEach(() => {
  queryClient.clear()
})

describe('Interessado — cadastro rápido do fornecedor', () => {
  it('deve cadastrar pelo lançamento e devolver o fornecedor escolhido', async () => {
    // ARRANGE — a Mariana lança o aluguel e não acha o dono da sala
    const registro = comServidor([])
    const usuario = userEvent.setup()
    renderizar(QUEM_TAMBEM_CADASTRA)
    await abrirDespesa(usuario)
    await buscar(usuario, 'fornecedor', 'Locadora')
    await screen.findByText('Nenhum resultado.')

    // ACT — o nome digitado na busca já vem no cadastro
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar novo fornecedor' }))
    const cadastro = await screen.findByRole('alertdialog', { name: 'Cadastrar fornecedor' })
    const razao = within(cadastro).getByLabelText('Razão social (obrigatório)')
    expect(razao).toHaveValue('Locadora')
    await usuario.type(razao, ' Fictícia Ltda')
    await usuario.click(within(cadastro).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    expect(await screen.findByText('Fornecedor: Locadora Fictícia Ltda')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog', { name: 'Cadastrar fornecedor' })).not.toBeInTheDocument()
    expect(registro.fornecedores[0]).toMatchObject({ razao_social: 'Locadora Fictícia Ltda' })
  })

  it('deve abrir o formulário CURTO: razão social, documento e categoria padrão', async () => {
    // ARRANGE
    comServidor([])
    const usuario = userEvent.setup()
    renderizar([...QUEM_TAMBEM_CADASTRA, 'categorias.ver'])
    await abrirDespesa(usuario)
    await buscar(usuario, 'fornecedor', 'Lo')

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Cadastrar novo fornecedor' }))

    // ASSERT — contato e endereço se completam depois, na tela de Fornecedores
    const cadastro = await screen.findByRole('alertdialog', { name: 'Cadastrar fornecedor' })
    expect(within(cadastro).getByLabelText('CPF ou CNPJ')).toBeInTheDocument()
    expect(within(cadastro).getByLabelText('Categoria padrão')).toBeInTheDocument()
    expect(within(cadastro).queryByLabelText('Nome fantasia')).not.toBeInTheDocument()
    expect(within(cadastro).queryByText('Contatos')).not.toBeInTheDocument()
    expect(within(cadastro).queryByText('Endereço')).not.toBeInTheDocument()
  })

  it('deve preservar o lançamento e não registrá-lo ao salvar o fornecedor', async () => {
    // ARRANGE — valor e data já digitados antes de descobrir que o fornecedor não existe
    const registro = comServidor([])
    const usuario = userEvent.setup()
    renderizar(QUEM_TAMBEM_CADASTRA)
    await abrirDespesa(usuario)
    fireEvent.change(screen.getByLabelText('Valor (R$) (obrigatório)'), { target: { value: '2.500,00' } })
    fireEvent.change(screen.getByLabelText('Vencimento (obrigatório)'), { target: { value: '2026-10-05' } })
    await buscar(usuario, 'fornecedor', 'Locadora')

    // ACT — salvar pelo Enter no campo: o submit do cadastro NÃO pode subir ao lançamento
    await usuario.click(await screen.findByRole('button', { name: 'Cadastrar novo fornecedor' }))
    const cadastro = await screen.findByRole('alertdialog', { name: 'Cadastrar fornecedor' })
    await usuario.type(within(cadastro).getByLabelText('Razão social (obrigatório)'), ' Fictícia{Enter}')
    await screen.findByText('Fornecedor: Locadora Fictícia')

    // ASSERT
    expect(screen.getByLabelText('Valor (R$) (obrigatório)')).toHaveValue('2.500,00')
    expect(screen.getByLabelText('Vencimento (obrigatório)')).toHaveValue('2026-10-05')
    expect(screen.getByLabelText('Tipo (obrigatório)')).toHaveValue('despesa')
    expect(registro.fornecedores).toHaveLength(1)
    expect(registro.lancamentos).toHaveLength(0)
  })

  it('deve fechar só o cadastro no Esc, com o lançamento aberto', async () => {
    // ARRANGE
    comServidor([])
    const usuario = userEvent.setup()
    renderizar(QUEM_TAMBEM_CADASTRA)
    await abrirDespesa(usuario)
    await buscar(usuario, 'fornecedor', 'Lo')
    await usuario.click(await screen.findByRole('button', { name: 'Cadastrar novo fornecedor' }))
    await screen.findByRole('alertdialog', { name: 'Cadastrar fornecedor' })

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT — a janela de baixo continua, e o foco volta a quem abriu o cadastro
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Cadastrar fornecedor' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('alertdialog', { name: 'Novo lançamento' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cadastrar novo fornecedor' })).toHaveFocus()
    })
  })

  it('deve não oferecer "Cadastrar novo" a quem não pode criar fornecedor', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_DESPESA)
    await abrirDespesa(usuario)

    // ACT
    await buscar(usuario, 'fornecedor', 'Imob')
    await screen.findByRole('button', { name: 'Imobiliária Fictícia Ltda' })

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Cadastrar novo fornecedor' })).not.toBeInTheDocument()
  })

  it('deve não oferecer cadastro rápido de paciente', async () => {
    // ARRANGE — a criança tem a ficha dela; o balcão não a cria pelo caixa
    comServidor()
    servidor.use(msw.get('/api/pacientes', () => HttpResponse.json(pagina([]))))
    const usuario = userEvent.setup()
    renderizar([...QUEM_TAMBEM_CADASTRA, 'pacientes.ver', 'pacientes.criar'])
    await screen.findByRole('option', { name: 'PIX' })

    // ACT
    await buscar(usuario, 'paciente', 'Ana')
    await screen.findByText('Nenhum resultado.')

    // ASSERT
    expect(screen.queryByRole('button', { name: /Cadastrar novo/ })).not.toBeInTheDocument()
  })
})

describe('Interessado — cadastro rápido do funcionário', () => {
  it('deve cadastrar só com nome e função e devolver o funcionário escolhido', async () => {
    // ARRANGE
    const registro = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_TAMBEM_CADASTRA)
    await abrirDespesa(usuario)
    await buscar(usuario, 'funcionario', 'Recep')

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Cadastrar novo funcionário' }))
    const cadastro = await screen.findByRole('alertdialog', { name: 'Cadastrar funcionário' })
    expect(within(cadastro).queryByLabelText('CPF')).not.toBeInTheDocument()
    await usuario.clear(within(cadastro).getByLabelText('Nome (obrigatório)'))
    await usuario.type(within(cadastro).getByLabelText('Nome (obrigatório)'), 'Recepcionista Fictícia')
    await usuario.type(within(cadastro).getByLabelText('Função (obrigatório)'), 'Recepcionista')
    await usuario.click(within(cadastro).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — o corpo curto não leva contato nem endereço
    expect(await screen.findByText('Funcionário: Recepcionista Fictícia')).toBeInTheDocument()
    expect(registro.funcionarios[0]).toEqual({
      nome: 'Recepcionista Fictícia',
      funcao: 'Recepcionista',
      cpf: null,
      nascimento: null,
      ativo: true,
    })
  })
})

describe('Interessado — o fornecedor traz a categoria', () => {
  it('deve preencher categoria e subcategoria numa despesa com a categoria vazia', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_DESPESA)
    await abrirDespesa(usuario)

    // ACT
    await buscar(usuario, 'fornecedor', 'Imob')
    await usuario.click(await screen.findByRole('button', { name: 'Imobiliária Fictícia Ltda' }))

    // ASSERT
    expect(screen.getByLabelText('Categoria (obrigatório)')).toHaveValue('5')
    expect(screen.getByLabelText('Subcategoria')).toHaveValue('51')
  })

  it('deve manter a categoria que já estava escolhida', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_DESPESA)
    await abrirDespesa(usuario)
    await usuario.selectOptions(screen.getByLabelText('Categoria (obrigatório)'), '6')

    // ACT
    await buscar(usuario, 'fornecedor', 'Imob')
    await usuario.click(await screen.findByRole('button', { name: 'Imobiliária Fictícia Ltda' }))

    // ASSERT — conveniência, nunca regra: a escolha de quem lança não é sobrescrita
    expect(screen.getByLabelText('Categoria (obrigatório)')).toHaveValue('6')
    expect(screen.getByLabelText('Subcategoria')).toHaveValue('')
  })

  it('deve não preencher a categoria numa receita', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_LANCA_DESPESA)
    await screen.findByRole('option', { name: 'PIX' })

    // ACT — receita é o padrão do formulário
    await buscar(usuario, 'fornecedor', 'Imob')
    await usuario.click(await screen.findByRole('button', { name: 'Imobiliária Fictícia Ltda' }))

    // ASSERT
    expect(screen.getByLabelText('Categoria (obrigatório)')).toHaveValue('')
  })

  it('deve preencher a categoria do fornecedor recém-cadastrado pelo lançamento', async () => {
    // ARRANGE
    comServidor([])
    const usuario = userEvent.setup()
    renderizar([...QUEM_TAMBEM_CADASTRA, 'categorias.ver'])
    await abrirDespesa(usuario)
    await buscar(usuario, 'fornecedor', 'Locadora')

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Cadastrar novo fornecedor' }))
    const cadastro = await screen.findByRole('alertdialog', { name: 'Cadastrar fornecedor' })
    await within(cadastro).findByRole('option', { name: 'Despesas fixas' })
    await usuario.selectOptions(within(cadastro).getByLabelText('Categoria padrão'), '5')
    await usuario.click(within(cadastro).getByRole('button', { name: 'Cadastrar' }))
    await screen.findByText('Fornecedor: Locadora')

    // ASSERT
    expect(screen.getByLabelText('Categoria (obrigatório)')).toHaveValue('5')
  })
})

describe('Interessado — axe no cadastro rápido', () => {
  it('deve passar no axe com o cadastro aberto por cima do lançamento', async () => {
    // ARRANGE
    comServidor([])
    const usuario = userEvent.setup()
    renderizar([...QUEM_TAMBEM_CADASTRA, 'categorias.ver'])
    await abrirDespesa(usuario)
    await buscar(usuario, 'fornecedor', 'Lo')

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Cadastrar novo fornecedor' }))
    await screen.findByRole('alertdialog', { name: 'Cadastrar fornecedor' })

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
