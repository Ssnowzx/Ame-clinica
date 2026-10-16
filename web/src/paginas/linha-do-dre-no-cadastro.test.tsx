import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { MENSAGEM_DE_CONFLITO } from '@/lib/http'
import { queryClient } from '@/lib/query-client'
import { PaginaCategoria } from '@/paginas/pagina-categoria'
import { PaginaCategorias } from '@/paginas/pagina-categorias'
import { useAuthStore } from '@/stores/auth-store'
import { configuracaoDoDreFicticia, handlersDoDre, type ServidorDoDre } from '@/test/dados-dre'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CategoriaFinanceira } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * A linha do DRE no cadastro (change `dre-gerencial`, spec `financeiro-cadastros`): a linha em
 * vigor e de onde ela vem, na página da categoria e na lista; a troca com as mesmas permissões da
 * configuração; nada disso para quem não vê o resultado da clínica. Dados FICTÍCIOS.
 */

const QUEM_VE_O_CAIXA = ['categorias.ver', 'fluxo_caixa.ver']
const QUEM_CONFIGURA = [...QUEM_VE_O_CAIXA, 'categorias.editar']

const DA_LISTA: CategoriaFinanceira[] = [
  { id: 1, nome: 'Sessões', tipo: 'receita', subcategorias: [], updated_at: 'v-sessoes' },
  { id: 2, nome: 'Aluguel', tipo: 'despesa', subcategorias: [], updated_at: 'v-aluguel' },
  {
    id: 3,
    nome: 'Pessoal',
    tipo: 'despesa',
    subcategorias: [
      { id: 31, nome: 'Salários', categoria_id: 3, codigo_contabil: null, updated_at: 'v-salarios' },
      { id: 32, nome: 'Tarifa do banco', categoria_id: 3, codigo_contabil: null, updated_at: 'v-tarifa' },
    ],
    updated_at: 'v-pessoal',
  },
]

interface Registro extends ServidorDoDre {
  leiturasDaLista: number
}

function servir(): Registro {
  const { handlers, registro } = handlersDoDre()
  const completo: Registro = Object.assign(registro, { leiturasDaLista: 0 })
  servidor.use(
    ...handlers,
    msw.get('/api/categorias', () => {
      completo.leiturasDaLista += 1
      return HttpResponse.json(DA_LISTA)
    }),
  )
  return completo
}

/**
 * O PUT da linha fica no ar até `liberar()`: o teste vê a tela DURANTE o envio. O resolvedor não
 * responde — o MSW passa ao próximo, o do `servir`, que registra o envio e grava.
 */
function segurarOEnvio(): { liberar: () => void } {
  let liberar = (): void => undefined
  const liberado = new Promise<void>((resolver) => {
    liberar = resolver
  })
  servidor.use(
    msw.put('/api/categorias/:id/linha-dre', async () => {
      await liberado
    }),
  )

  return { liberar: () => liberar() }
}

function renderizar(caminho: string, permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[caminho]}>
          <Routes>
            <Route path="/categorias" element={<PaginaCategorias />} />
            <Route path="/categorias/:id" element={<PaginaCategoria />} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('Linha do DRE na página da categoria', () => {
  it('deve dizer a linha em vigor e que ela é o padrão da natureza', async () => {
    // ARRANGE
    servir()

    // ACT
    renderizar('/categorias/2', QUEM_VE_O_CAIXA)

    // ASSERT — sem editar categorias, a linha é texto; a troca não aparece
    const secao = await screen.findByRole('region', { name: 'Linha do DRE' })
    expect(await within(secao).findByText('Despesas administrativas (padrão da despesa)')).toBeInTheDocument()
    expect(within(secao).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(secao).getByRole('link', { name: 'Ver a escada inteira em Configurar DRE' })).toHaveAttribute(
      'href',
      '/financeiro/dre/configurar',
    )
  })

  it('deve dizer, em cada subcategoria, se ela segue a categoria ou tem a sua', async () => {
    // ARRANGE
    servir()

    // ACT
    renderizar('/categorias/3', QUEM_VE_O_CAIXA)

    // ASSERT
    const secao = await screen.findByRole('region', { name: 'Linha do DRE' })
    expect(await within(secao).findByText('Despesas com pessoal (segue a categoria)')).toBeInTheDocument()
    expect(within(secao).getByText(/Pessoal › Tarifa do banco/).closest('p')).toHaveTextContent('Despesas administrativas')
  })

  it('deve trocar a linha a quem edita categorias e vê o caixa, e refazer o cadastro junto', async () => {
    // ARRANGE — a troca muda a versão da categoria: o formulário do cadastro não pode ficar com a velha
    const usuario = userEvent.setup()
    const registro = servir()
    renderizar('/categorias/2', QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    expect(screen.getByText('Em vigor: Despesas administrativas (padrão da despesa).')).toBeInTheDocument()
    const leiturasAntes = registro.leiturasDaLista
    await usuario.selectOptions(aluguel, 'pessoal')
    // escolher é rascunho: nada vai ao servidor até "Aplicar"
    expect(registro.envios).toEqual([])

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' }))

    // ASSERT — e o foco fica no campo: o botão que o tinha sumiu com o rascunho
    await waitFor(() => {
      expect(screen.getByText('Em vigor: Despesas com pessoal.')).toBeInTheDocument()
    })
    expect(registro.envios).toEqual([{ caminho: '/categorias/2', corpo: { linha_dre: 'pessoal' }, versao: 'v-aluguel' }])
    expect(registro.leiturasDaLista).toBeGreaterThan(leiturasAntes)
    expect(screen.queryByRole('button', { name: 'Aplicar a linha de Aluguel' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Aluguel: linha do DRE' })).toHaveFocus()
  })

  it('deve não ter violações axe com um rascunho pendente sob a linha em vigor', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servir()
    const { container } = renderizar('/categorias/2', QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })

    // ACT
    await usuario.selectOptions(aluguel, 'impostos')

    // ASSERT
    expect(screen.getByRole('button', { name: 'Desfazer a escolha de Aluguel' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)

  it('deve mostrar o que outra pessoa gravou quando a troca volta em conflito (409), com o foco no campo', async () => {
    // ARRANGE — enquanto a página estava aberta, outra pessoa pôs o Aluguel em "Despesas com pessoal"
    const usuario = userEvent.setup()
    servir()
    let recusou = false
    const lida = configuracaoDoDreFicticia()
    const gravadaPorOutra = configuracaoDoDreFicticia(
      lida.categorias.map((categoria) =>
        categoria.id === 2 ? { ...categoria, linha_dre: 'pessoal', linha_efetiva: 'pessoal', updated_at: 'v-aluguel-outra' } : categoria,
      ),
    )
    servidor.use(
      msw.put('/api/categorias/:id/linha-dre', () => {
        recusou = true
        return HttpResponse.json({ message: 'Esta categoria foi alterada por outra pessoa.' }, { status: 409 })
      }),
      msw.get('/api/dre/linhas', () => HttpResponse.json(recusou ? gravadaPorOutra : lida)),
    )
    renderizar('/categorias/2', QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'impostos')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' }))

    // ASSERT — o campo diz o gravado de HOJE, sem rascunho a aplicar; o foco não cai no `body`
    await waitFor(() => {
      expect(aluguel).toHaveValue('pessoal')
    })
    expect(screen.getByText('Em vigor: Despesas com pessoal.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Aplicar/ })).not.toBeInTheDocument()
    expect(aluguel).toHaveFocus()
    // o conflito não tem campo onde pousar: a razão vem pelo aviso
    expect(await screen.findByText(MENSAGEM_DE_CONFLITO)).toBeInTheDocument()
  })

  it('deve descartar o rascunho quando a natureza da categoria muda por fora, também sem a página da configuração (CR-WEB-R4-02)', async () => {
    // ARRANGE — o Aluguel (sem linha) vira receita pelas mãos de outra pessoa: a linha continua nula
    const usuario = userEvent.setup()
    servir()
    let servida = configuracaoDoDreFicticia()
    servidor.use(msw.get('/api/dre/linhas', () => HttpResponse.json(servida)))
    renderizar('/categorias/2', QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'impostos')
    expect(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' })).toBeInTheDocument()
    servida = configuracaoDoDreFicticia(
      configuracaoDoDreFicticia().categorias.map((categoria) =>
        categoria.id === 2 ? { ...categoria, tipo: 'receita', linha_efetiva: 'servicos', updated_at: 'v-aluguel-receita' } : categoria,
      ),
    )

    // ACT
    await act(() => queryClient.invalidateQueries({ queryKey: chaves.configuracaoDoDre() }))

    // ASSERT — "Impostos" nem é mais opção: nada a aplicar
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Aluguel: linha do DRE' })).toHaveValue('')
    })
    expect(screen.queryByRole('button', { name: 'Aplicar a linha de Aluguel' })).not.toBeInTheDocument()
  })

  it('deve tirar a marca de inválido do campo quando a pessoa escolhe outra linha depois da recusa (422)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servir()
    const razao = 'Esta linha do DRE é de receita, e a categoria é de despesa.'
    servidor.use(
      msw.put('/api/categorias/:id/linha-dre', () => HttpResponse.json({ message: razao, errors: { linha_dre: [razao] } }, { status: 422 })),
    )
    renderizar('/categorias/2', QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'impostos')
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' }))
    await waitFor(() => {
      expect(aluguel).toHaveAttribute('aria-invalid', 'true')
    })

    // ACT
    await usuario.selectOptions(aluguel, 'pessoal')

    // ASSERT — a recusa era do valor tentado; com outra escolha, ela não diz mais nada
    expect(aluguel).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText(razao)).not.toBeInTheDocument()
    expect(aluguel).toHaveValue('pessoal')
  })

  it('deve mostrar o Aplicar carregando enquanto a troca não volta', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servir()
    const envio = segurarOEnvio()
    renderizar('/categorias/2', QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'pessoal')
    const aplicar = screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' })

    // ACT
    await usuario.click(aplicar)

    // ASSERT — ocupado e inerte, mas focável (`aria-disabled`, não `disabled`), e o campo ocupado
    expect(aplicar).toHaveAttribute('aria-busy', 'true')
    expect(aplicar).toHaveAttribute('aria-disabled', 'true')
    expect(aplicar).toBeEnabled()
    expect(aluguel).toHaveAttribute('aria-busy', 'true')
    envio.liberar()
    await waitFor(() => {
      expect(screen.getByText('Em vigor: Despesas com pessoal.')).toBeInTheDocument()
    })
  })

  it('deve enviar uma vez só quando o segundo clique chega com o primeiro envio no ar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const registro = servir()
    const envio = segurarOEnvio()
    renderizar('/categorias/2', QUEM_CONFIGURA)
    await usuario.selectOptions(await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' }), 'pessoal')
    const aplicar = screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' })

    // ACT — o segundo sairia com a versão já vencida e voltaria em conflito
    await usuario.click(aplicar)
    await usuario.click(aplicar)
    envio.liberar()

    // ASSERT
    await waitFor(() => {
      expect(screen.getByText('Em vigor: Despesas com pessoal.')).toBeInTheDocument()
    })
    expect(registro.envios).toEqual([{ caminho: '/categorias/2', corpo: { linha_dre: 'pessoal' }, versao: 'v-aluguel' }])
  })

  it('deve recusar outra escolha enquanto a troca está no ar — ela sumiria calada no sucesso', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const registro = servir()
    const envio = segurarOEnvio()
    renderizar('/categorias/2', QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'pessoal')
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' }))

    // ACT
    await usuario.selectOptions(aluguel, 'impostos')

    // ASSERT — o select controlado desfaz a escolha à vista, e o sucesso mostra o que foi gravado
    expect(aluguel).toHaveValue('pessoal')
    envio.liberar()
    await waitFor(() => {
      expect(screen.getByText('Em vigor: Despesas com pessoal.')).toBeInTheDocument()
    })
    expect(aluguel).toHaveValue('pessoal')
    expect(screen.queryByRole('button', { name: /^Aplicar/ })).not.toBeInTheDocument()
    expect(registro.envios).toEqual([{ caminho: '/categorias/2', corpo: { linha_dre: 'pessoal' }, versao: 'v-aluguel' }])
  })

  it('deve esconder a seção de quem não vê o resultado da clínica, sem nem pedir a configuração', async () => {
    // ARRANGE
    const registro = servir()

    // ACT
    renderizar('/categorias/2', ['categorias.ver', 'categorias.editar'])
    await screen.findByRole('heading', { level: 1, name: 'Aluguel' })

    // ASSERT
    expect(screen.queryByRole('region', { name: 'Linha do DRE' })).not.toBeInTheDocument()
    expect(registro.leituras).toBe(0)
  })

  it('deve não ter violações axe na seção com os seletores', async () => {
    // ARRANGE + ACT
    servir()
    const { container } = renderizar('/categorias/3', QUEM_CONFIGURA)
    await screen.findByRole('combobox', { name: 'Pessoal › Salários: linha do DRE' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)
})

describe('Linha do DRE na lista de categorias', () => {
  it('deve mostrar a coluna com a linha em vigor a quem vê o caixa', async () => {
    // ARRANGE
    servir()

    // ACT
    renderizar('/categorias', QUEM_VE_O_CAIXA)

    // ASSERT
    expect(await screen.findByRole('columnheader', { name: 'Linha do DRE' })).toBeInTheDocument()
    const linhaDoAluguel = (await screen.findByRole('link', { name: 'Aluguel' })).closest('tr') as HTMLElement
    expect(await within(linhaDoAluguel).findByText('Despesas administrativas (padrão da despesa)')).toBeInTheDocument()
  })

  it('deve não ter a coluna para quem não vê o caixa', async () => {
    // ARRANGE
    servir()

    // ACT
    renderizar('/categorias', ['categorias.ver'])
    await screen.findByRole('link', { name: 'Aluguel' })

    // ASSERT
    expect(screen.queryByRole('columnheader', { name: 'Linha do DRE' })).not.toBeInTheDocument()
  })
})
