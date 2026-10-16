import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaContas } from '@/paginas/pagina-contas'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ContaFinanceira } from '@/tipos'

const TUDO = ['contas.ver', 'contas.criar', 'contas.editar', 'contas.excluir']

const CAIXA: ContaFinanceira = {
  id: 1,
  nome: 'Caixa',
  codigo_contabil: '1.1.01',
  ativo: true,
  updated_at: '2026-09-03T10:00:00.000000Z',
}

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/contas']}>
          <PaginaContas />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Contas — o padrão de cadastro da casa', () => {
  it('deve oferecer no topo o link de voltar para /cadastros', async () => {
    // ARRANGE + ACT
    servidor.use(msw.get('/api/contas', () => HttpResponse.json([CAIXA])))
    renderizar()

    // ASSERT
    const voltar = await screen.findByRole('link', { name: 'Cadastros' })
    expect(voltar).toHaveAttribute('href', '/cadastros')
  })

  it('deve esconder as ações de quem só pode ver', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/contas', () => HttpResponse.json([CAIXA])))

    // ACT
    renderizar(['contas.ver'])
    await screen.findByText('Caixa')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cadastrar conta/i })).not.toBeInTheDocument()
  })

  it('deve dizer o que fazer quando a lista está vazia — sem conta não se lança nada', async () => {
    // ARRANGE — é o estado REAL da clínica que motivou a change
    servidor.use(msw.get('/api/contas', () => HttpResponse.json([])))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhuma conta cadastrada')).toBeInTheDocument()
    expect(screen.getByText(/cadastre pelo menos o caixa da recepção/i)).toBeInTheDocument()
  })
})

describe('Contas — a recusa do servidor vira correção possível', () => {
  it('deve manter a conta na lista e sugerir desativar quando a exclusão é recusada', async () => {
    // ARRANGE — a recusa chega com a chave da ENTIDADE (`conta`), que não é campo de
    // formulário: cai em `gerais` e precisa aparecer onde a pessoa está olhando
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.delete('/api/contas/:id', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: {
              conta: [
                'Esta conta é referenciada por lançamentos, cartões ou transferências e não pode ser excluída.',
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Caixa')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir' }))
    const dialog = await screen.findByRole('alertdialog')
    // a consequência é dita ANTES do clique, e diz a saída honesta: desativar
    expect(within(dialog).getByText(/nesse caso, desative-a/i)).toBeInTheDocument()
    await usuario.click(within(dialog).getByRole('button', { name: /Excluir conta/i }))

    // ASSERT
    expect(
      await within(dialog).findByText(
        'Esta conta é referenciada por lançamentos, cartões ou transferências e não pode ser excluída.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Caixa')).toBeInTheDocument()
  })

  it('deve nomear a conta no diálogo de exclusão — nunca "este registro"', async () => {
    // ARRANGE (§2)
    servidor.use(msw.get('/api/contas', () => HttpResponse.json([CAIXA])))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Caixa')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir' }))

    // ASSERT
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Excluir Caixa?')).toBeInTheDocument()
  })
})

describe('Contas — o código contábil vazio é AUSÊNCIA, não string vazia', () => {
  it('deve enviar null quando o campo fica em branco', async () => {
    // ARRANGE — '' no lugar de null suja o relatório do contador com um código que não existe
    let enviado: unknown = null
    const noServidor: ContaFinanceira[] = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/contas', () => HttpResponse.json(noServidor)),
      msw.post('/api/contas', async ({ request }) => {
        enviado = await request.json()
        const criada = { ...CAIXA, id: 2, nome: 'Cofre', codigo_contabil: null }
        noServidor.push(criada)
        return HttpResponse.json(criada, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar conta/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Cofre')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT
    await screen.findByText('Cofre')
    expect(enviado).toEqual({ nome: 'Cofre', codigo_contabil: null, ativo: true })
  })
})

describe('Contas — conflito de edição (concorrência otimista)', () => {
  it('deve mandar a versão lida no If-Match e avisar no 409', async () => {
    // ARRANGE — outra pessoa salvou no meio; sem o If-Match a edição sobrescreveria em silêncio
    let ifMatchRecebido: string | null = null
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.put('/api/contas/:id', ({ request }) => {
        ifMatchRecebido = request.headers.get('If-Match')
        return HttpResponse.json({ message: 'Conflito.' }, { status: 409 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Caixa')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const campoNome = within(dialog).getByRole('textbox', { name: /^Nome/i })
    await usuario.clear(campoNome)
    await usuario.type(campoNome, 'Caixa da recepção')
    await usuario.click(within(dialog).getByRole('button', { name: /^Salvar$/i }))

    // ASSERT
    expect(await within(dialog).findByRole('button', { name: /Recarregar/i })).toBeInTheDocument()
    expect(ifMatchRecebido).toBe(CAIXA.updated_at)
  })
})
