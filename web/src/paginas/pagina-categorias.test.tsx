import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaCategorias } from '@/paginas/pagina-categorias'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CategoriaFinanceira } from '@/tipos'

const TUDO = ['categorias.ver', 'categorias.criar', 'categorias.editar', 'categorias.excluir']

const ATENDIMENTOS: CategoriaFinanceira = {
  id: 1,
  nome: 'Atendimentos',
  tipo: 'receita',
  subcategorias: [{ id: 7, nome: 'Sessão de fono', categoria_id: 1, codigo_contabil: null, updated_at: 'v1' }],
  updated_at: '2026-09-03T10:00:00.000000Z',
}

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/categorias']}>
          <PaginaCategorias />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Categorias — a lista leva às subcategorias', () => {
  it('deve mostrar a natureza em PALAVRA e linkar a categoria', async () => {
    // ARRANGE — cor nunca é o único canal (§2): a etiqueta traz a palavra
    servidor.use(msw.get('/api/categorias', () => HttpResponse.json([ATENDIMENTOS])))

    // ACT
    renderizar()

    // ASSERT
    const link = await screen.findByRole('link', { name: 'Atendimentos' })
    expect(link).toHaveAttribute('href', '/categorias/1')
    expect(screen.getByText('Receita')).toBeInTheDocument()
    // a contagem escopada à LINHA: um `getByText('1')` solto casaria qualquer "1" da tela
    const linha = screen.getByRole('row', { name: /Atendimentos/ })
    expect(within(linha).getByText('1')).toBeInTheDocument()
  })

  it('deve esconder as ações de quem só pode ver', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/categorias', () => HttpResponse.json([ATENDIMENTOS])))

    // ACT
    renderizar(['categorias.ver'])
    await screen.findByRole('link', { name: 'Atendimentos' })

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('Categorias — trocar a natureza é REGRA, não preferência', () => {
  it('deve confirmar a troca dizendo o que acontece com os lançamentos já feitos', async () => {
    // ARRANGE — o servidor ACEITA a troca (conferido no CategoriaController); o efeito
    // aparece depois, quando alguém tentar EDITAR um lançamento antigo e o servidor
    // recusar por coerência categoria×tipo (T-fin-11). A clínica precisa saber ANTES.
    let putRecebido = false
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/categorias', () => HttpResponse.json([ATENDIMENTOS])),
      msw.put('/api/categorias/:id', () => {
        putRecebido = true
        return HttpResponse.json({ ...ATENDIMENTOS, tipo: 'despesa' })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Atendimentos' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const formulario = await screen.findByRole('alertdialog')
    await usuario.selectOptions(
      within(formulario).getByRole('combobox', { name: /Natureza/i }),
      'despesa',
    )
    await usuario.click(within(formulario).getByRole('button', { name: /^Salvar$/i }))

    // ASSERT — nada foi enviado ainda: primeiro a clínica lê a consequência
    expect(putRecebido).toBe(false)
    expect(
      await screen.findByText(/passarão a recusar edição enquanto a natureza não bater/i),
    ).toBeInTheDocument()
  })

  it('deve salvar direto quando só o nome muda', async () => {
    // ARRANGE — confirmação em toda edição vira ruído que ninguém lê
    let putRecebido = false
    let noServidor: CategoriaFinanceira = ATENDIMENTOS
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/categorias', () => HttpResponse.json([noServidor])),
      msw.put('/api/categorias/:id', () => {
        putRecebido = true
        noServidor = { ...ATENDIMENTOS, nome: 'Atendimentos particulares' }
        return HttpResponse.json(noServidor)
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Atendimentos' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const formulario = await screen.findByRole('alertdialog')
    const campoNome = within(formulario).getByRole('textbox', { name: /^Nome/i })
    await usuario.clear(campoNome)
    await usuario.type(campoNome, 'Atendimentos particulares')
    await usuario.click(within(formulario).getByRole('button', { name: /^Salvar$/i }))

    // ASSERT
    expect(await screen.findByRole('link', { name: 'Atendimentos particulares' })).toBeInTheDocument()
    expect(putRecebido).toBe(true)
  })
})

describe('Categorias — a recusa do servidor vira correção possível', () => {
  it('deve manter a categoria na lista quando a exclusão é recusada', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/categorias', () => HttpResponse.json([ATENDIMENTOS])),
      msw.delete('/api/categorias/:id', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: {
              categoria: ['Esta categoria tem subcategorias ou lançamentos e não pode ser excluída.'],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Atendimentos' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Excluir Atendimentos?')).toBeInTheDocument()
    await usuario.click(within(dialog).getByRole('button', { name: /Excluir categoria/i }))

    // ASSERT
    expect(
      await within(dialog).findByText(
        'Esta categoria tem subcategorias ou lançamentos e não pode ser excluída.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Atendimentos')).toBeInTheDocument()
  })
})
