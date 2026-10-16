import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaTiposPagamento } from '@/paginas/pagina-tipos-pagamento'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { TipoDePagamento } from '@/tipos'

const TUDO = [
  'tipos_pagamento.ver',
  'tipos_pagamento.criar',
  'tipos_pagamento.editar',
  'tipos_pagamento.excluir',
]

const PIX: TipoDePagamento = { id: 1, nome: 'PIX', updated_at: '2026-09-03T10:00:00.000000Z' }

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/tipos-pagamento']}>
          <PaginaTiposPagamento />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Formas de pagamento — o padrão de cadastro da casa', () => {
  it('deve oferecer no topo o link de voltar para /cadastros', async () => {
    // ARRANGE + ACT
    servidor.use(msw.get('/api/tipos-pagamento', () => HttpResponse.json([PIX])))
    renderizar()

    // ASSERT
    expect(await screen.findByRole('link', { name: 'Cadastros' })).toHaveAttribute(
      'href',
      '/cadastros',
    )
  })

  it('deve esconder as ações de quem só pode ver', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/tipos-pagamento', () => HttpResponse.json([PIX])))

    // ACT
    renderizar(['tipos_pagamento.ver'])
    await screen.findByText('PIX')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Cadastrar forma de pagamento/i }),
    ).not.toBeInTheDocument()
  })
})

describe('Formas de pagamento — o 422 pousa no campo, e o formulário fica aberto', () => {
  it('deve mostrar o nome duplicado no campo Nome sem perder o que foi digitado', async () => {
    // ARRANGE — `nome` É campo do formulário: a mensagem tem de pousar NELE, não num
    // toast que passa. Fechar o formulário aqui apagaria o que a pessoa digitou.
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/tipos-pagamento', () => HttpResponse.json([PIX])),
      msw.post('/api/tipos-pagamento', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: { nome: ['Já existe uma forma de pagamento com este nome.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('PIX')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Cadastrar forma de pagamento/i }))
    const dialog = await screen.findByRole('alertdialog')
    const campoNome = within(dialog).getByRole('textbox', { name: /^Nome/i })
    await usuario.type(campoNome, 'PIX')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT
    expect(
      await within(dialog).findByText('Já existe uma forma de pagamento com este nome.'),
    ).toBeInTheDocument()
    expect(campoNome).toHaveValue('PIX')
  })
})

describe('Formas de pagamento — vazio diz o próximo passo', () => {
  it('deve explicar que sem forma de pagamento não se lança nada', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/tipos-pagamento', () => HttpResponse.json([])))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhuma forma de pagamento cadastrada')).toBeInTheDocument()
    expect(screen.getByText(/cadastre Dinheiro, PIX/i)).toBeInTheDocument()
  })
})

/**
 * O foco e o Esc do FORMULÁRIO valem para as treze telas de catálogo da casa — o
 * comportamento mora no `TelaDeCatalogo`, e esta tela é a mais simples para exercitá-lo.
 *
 * Os dois defeitos que estes testes existem para impedir foram medidos no gate:
 * a janela abria SEM foco (o Tab passeava por botões do fundo, sob `aria-hidden`), e
 * depois de uma recusa do servidor o Esc precisava de DOIS toques.
 */
describe('Formulário de catálogo — teclado (vale para as 13 telas)', () => {
  it('deve levar o foco para o primeiro campo ao abrir', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/tipos-pagamento', () => HttpResponse.json([PIX])))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('PIX')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Cadastrar forma de pagamento/i }))

    // ASSERT — quem usa leitor de tela precisa ouvir a janela; quem usa teclado não pode
    // tabular por controles do fundo
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('textbox', { name: /^Nome/i })).toHaveFocus()
  })

  it('deve devolver o foco ao botão que abriu, ao fechar', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/tipos-pagamento', () => HttpResponse.json([PIX])))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('PIX')
    const disparador = screen.getByRole('button', { name: /Cadastrar forma de pagamento/i })

    // ACT
    await usuario.click(disparador)
    await screen.findByRole('alertdialog')
    await usuario.keyboard('{Escape}')

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(disparador).toHaveFocus()
  })

  it('deve fechar com UM Esc mesmo depois de uma recusa do servidor', async () => {
    // ARRANGE — era preciso apertar Esc duas vezes, e o foco caía no corpo da página
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/tipos-pagamento', () => HttpResponse.json([PIX])),
      msw.post('/api/tipos-pagamento', () =>
        HttpResponse.json(
          { message: 'Recusado.', errors: { nome: ['Já existe uma forma de pagamento com este nome.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('PIX')
    const disparador = screen.getByRole('button', { name: /Cadastrar forma de pagamento/i })

    // ACT
    await usuario.click(disparador)
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'PIX')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))
    await within(dialog).findByText('Já existe uma forma de pagamento com este nome.')
    await usuario.keyboard('{Escape}')

    // ASSERT — UM toque
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(disparador).toHaveFocus()
    expect(screen.getByText('PIX')).toBeInTheDocument()
  })
})

/**
 * A contagem aparece em DOIS lugares — o contador visível do cabeçalho e a `<caption>`
 * sr-only da tabela — e o primeiro conserto só ensinou o singular ao visível: quem usa
 * leitor de tela continuava ouvindo "1 formas de pagamento".
 *
 * Estes dois testes são o detector: com o plural incondicional de volta, ambos caem.
 * (O gate provou que sem eles dava para desfazer o conserto com a suíte inteira verde.)
 */
describe('Catálogo — a contagem concorda em número, e o leitor de tela ouve o mesmo', () => {
  it('deve dizer "1 forma de pagamento" no contador e na legenda da tabela', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/tipos-pagamento', () => HttpResponse.json([PIX])))

    // ACT
    renderizar()

    // ASSERT — a legenda é o NOME ACESSÍVEL da tabela
    expect(await screen.findByRole('table', { name: '1 forma de pagamento' })).toBeInTheDocument()
    // DOIS: o contador visível do cabeçalho e a legenda sr-only da tabela. Exigir os dois
    // é o que impede o conserto de valer só para quem enxerga.
    expect(screen.getAllByText('1 forma de pagamento')).toHaveLength(2)
  })

  it('deve dizer "2 formas de pagamento" com dois registros', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/tipos-pagamento', () =>
        HttpResponse.json([PIX, { id: 2, nome: 'Dinheiro', updated_at: 'v1' }]),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByRole('table', { name: '2 formas de pagamento' })).toBeInTheDocument()
    expect(screen.getAllByText('2 formas de pagamento')).toHaveLength(2)
  })
})
