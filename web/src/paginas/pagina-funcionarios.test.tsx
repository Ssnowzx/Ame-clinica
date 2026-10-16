import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { FUNCIONARIOS } from '@/componentes/financeiro/modulos-de-interessado'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaFuncionarios } from '@/paginas/pagina-funcionarios'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Funcionario, FuncionarioDaLista, PaginaDeApi } from '@/tipos'

expect.extend(toHaveNoViolations)

/** A tela de Funcionários (change `caixa-do-dia-a-dia`). Dados FICTÍCIOS (LGPD). */

const VERSAO = '2026-09-25T10:00:00.000000Z'

const AUXILIAR: Funcionario = {
  id: 1,
  nome: 'Funcionária Fictícia A',
  funcao: 'Auxiliar administrativa',
  ativo: true,
  cpf: null,
  nascimento: null,
  contatos_json: null,
  endereco_json: null,
  updated_at: VERSAO,
}

const QUEM_ADMINISTRA = ['funcionarios.ver', 'funcionarios.criar', 'funcionarios.editar', 'funcionarios.excluir']

function pagina(itens: FuncionarioDaLista[]): PaginaDeApi<FuncionarioDaLista> {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

/** Um servidor de funcionários com estado; devolve os corpos que chegaram a ele. */
function comServidor(): Array<Record<string, unknown>> {
  const cadastro = new Map([[AUXILIAR.id, AUXILIAR]])
  const corpos: Array<Record<string, unknown>> = []

  servidor.use(
    msw.get('/api/funcionarios', () =>
      HttpResponse.json(
        pagina([...cadastro.values()].map(({ id, nome, funcao, ativo }) => ({ id, nome, funcao, ativo }))),
      ),
    ),
    msw.get('/api/funcionarios/:id', ({ params }) => HttpResponse.json(cadastro.get(Number(params.id)))),
    msw.post('/api/funcionarios', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      corpos.push(corpo)
      const novo = { ...AUXILIAR, ...corpo, id: 2 } as Funcionario
      cadastro.set(2, novo)
      return HttpResponse.json(novo, { status: 201 })
    }),
    msw.put('/api/funcionarios/:id', async ({ request, params }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      corpos.push(corpo)
      const salvo = { ...(cadastro.get(Number(params.id)) as Funcionario), ...corpo }
      cadastro.set(salvo.id, salvo)
      return HttpResponse.json(salvo)
    }),
    msw.delete('/api/funcionarios/:id', () =>
      HttpResponse.json(
        { message: 'Inválido.', errors: { funcionario: ['Funcionário com lançamentos não pode ser excluído — inative-o.'] } },
        { status: 422 },
      ),
    ),
  )

  return corpos
}

function renderizar(permissoes: string[] = QUEM_ADMINISTRA) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/funcionarios']}>
          <PaginaFuncionarios />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Funcionários — a lista', () => {
  it('deve listar nome, função e situação', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar()

    // ASSERT
    const linha = (await screen.findByRole('cell', { name: 'Funcionária Fictícia A' })).closest('tr') as HTMLElement
    expect(within(linha).getByRole('cell', { name: 'Auxiliar administrativa' })).toBeInTheDocument()
    expect(within(linha).getByRole('cell', { name: 'Ativo' })).toBeInTheDocument()
  })

  it('deve dizer que o cadastro é de quem recebe da clínica, e não acesso ao sistema', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText(FUNCIONARIOS.explicacao)).toBeInTheDocument()
  })
})

describe('Funcionários — cadastrar a recepcionista', () => {
  it('deve cadastrar com nome e função e mostrá-la na lista', async () => {
    // ARRANGE
    const corpos = comServidor()
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('cell', { name: 'Funcionária Fictícia A' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }))
    await usuario.type(screen.getByLabelText('Nome (obrigatório)'), 'Recepcionista Fictícia B')
    await usuario.type(screen.getByLabelText('Função (obrigatório)'), 'Recepcionista')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    expect(await screen.findByRole('cell', { name: 'Recepcionista Fictícia B' })).toBeInTheDocument()
    expect(corpos[0]).toEqual({
      nome: 'Recepcionista Fictícia B',
      funcao: 'Recepcionista',
      cpf: null,
      nascimento: null,
      ativo: true,
      contatos_json: [],
      endereco_json: null,
    })
  })

  it('deve mandar o CPF em dígitos, mesmo digitado com pontuação', async () => {
    // ARRANGE
    const corpos = comServidor()
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('cell', { name: 'Funcionária Fictícia A' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }))
    await usuario.type(screen.getByLabelText('Nome (obrigatório)'), 'Recepcionista Fictícia B')
    await usuario.type(screen.getByLabelText('Função (obrigatório)'), 'Recepcionista')
    await usuario.type(screen.getByLabelText('CPF'), '529.982.247-25')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — a tela mostra pontuado, o servidor recebe dígitos (e confere o dígito verificador)
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).toMatchObject({ cpf: '52998224725' })
  })
})

describe('Funcionários — excluir quem já recebeu', () => {
  it('deve mostrar a recusa do servidor e inativar pela oferta', async () => {
    // ARRANGE
    const corpos = comServidor()
    const usuario = userEvent.setup()
    renderizar()
    const linha = (await screen.findByRole('cell', { name: 'Funcionária Fictícia A' })).closest('tr') as HTMLElement

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))
    await usuario.click(await screen.findByRole('button', { name: 'Excluir funcionário' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Inativar Funcionária Fictícia A?' })
    expect(within(dialogo).getByText('Funcionário com lançamentos não pode ser excluído — inative-o.')).toBeInTheDocument()
    await usuario.click(within(dialogo).getByRole('button', { name: 'Inativar funcionário' }))

    // ASSERT
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).toMatchObject({ nome: 'Funcionária Fictícia A', funcao: 'Auxiliar administrativa', ativo: false })
  })
})

describe('Funcionários — axe', () => {
  it('deve passar no axe no formulário de cadastro', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('cell', { name: 'Funcionária Fictícia A' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }))

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
