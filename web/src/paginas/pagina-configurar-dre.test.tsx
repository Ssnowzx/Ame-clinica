import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { MENSAGEM_DE_CONFLITO } from '@/lib/http'
import { queryClient } from '@/lib/query-client'
import { O_QUE_E_O_DRE, PaginaConfigurarDre } from '@/paginas/pagina-configurar-dre'
import { useAuthStore } from '@/stores/auth-store'
import { configuracaoDoDreFicticia, handlersDoDre } from '@/test/dados-dre'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ConfiguracaoDoDre } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * Configurar DRE (change `dre-gerencial`): a escada explicada, cada categoria na linha em que cai,
 * o destaque do padrão, a troca filtrada pela natureza e a escada só para ler sem as permissões.
 * Dados FICTÍCIOS.
 */

const QUEM_CONFIGURA = ['lancamentos.ver', 'fluxo_caixa.ver', 'categorias.ver', 'categorias.editar']
const QUEM_SO_VE = ['lancamentos.ver', 'fluxo_caixa.ver', 'categorias.ver']

function renderizar(permissoes: string[], { leituraRecusada = false }: { leituraRecusada?: boolean } = {}) {
  const { handlers, registro } = handlersDoDre()
  servidor.use(...handlers)
  if (leituraRecusada) {
    servidor.use(msw.get('/api/dre/linhas', () => HttpResponse.json({ message: 'Sem permissão.' }, { status: 403 })))
  }
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  const tela = render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <PaginaConfigurarDre />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
  return { ...tela, registro }
}

/** O cartão de uma linha de valor, pelo título dela. */
async function cartaoDaLinha(rotulo: string): Promise<HTMLElement> {
  return screen.findByRole('region', { name: rotulo })
}

/** A configuração com o Aluguel gravado por OUTRA pessoa — a linha e a versão nova. */
function comOAluguelEm(linha: string | null, versao: string): ConfiguracaoDoDre {
  return configuracaoDoDreFicticia(
    configuracaoDoDreFicticia().categorias.map((categoria) =>
      categoria.id === 2 ? { ...categoria, linha_dre: linha, linha_efetiva: linha ?? 'administrativas', updated_at: versao } : categoria,
    ),
  )
}

/**
 * O rascunho "Impostos" no Aluguel, e a leitura da configuração nas mãos do teste: `servir` troca o
 * que o servidor tem, e `reconsultar` faz a tela ler de novo (o foco que volta à janela). A leitura
 * chega à tela por uma notificação AGENDADA do TanStack: quem depende de a tela ter desenhado a
 * leitura espera pelo que ela mostra — duas leituras seguidas podem virar um desenho só.
 */
async function rascunhoDoAluguelComOServidorNaMao(usuario: ReturnType<typeof userEvent.setup>) {
  let servida = configuracaoDoDreFicticia()
  servidor.use(msw.get('/api/dre/linhas', () => HttpResponse.json(servida)))
  await usuario.selectOptions(await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' }), 'impostos')
  expect(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' })).toBeInTheDocument()

  return {
    servir: (configuracao: ConfiguracaoDoDre) => {
      servida = configuracao
    },
    reconsultar: () => act(() => queryClient.invalidateQueries({ queryKey: chaves.configuracaoDoDre() })),
  }
}

/** Salários (segue Pessoal) com o rascunho "Impostos", e Pessoal aplicado de volta ao padrão. */
async function rascunhoDeSalariosComAMaeAplicada(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.selectOptions(await screen.findByRole('combobox', { name: 'Pessoal › Salários: linha do DRE' }), 'impostos')
  await usuario.selectOptions(screen.getByRole('combobox', { name: 'Pessoal: linha do DRE' }), '')
  await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Pessoal' }))
  expect(await screen.findByText('Pessoal voltou a: Padrão da despesa (Despesas administrativas).')).toBeInTheDocument()
}

describe('Configurar DRE — a escada explicada', () => {
  it('deve mostrar a escada com as explicações e cada categoria na linha em que cai', async () => {
    // ARRANGE + ACT
    renderizar(QUEM_SO_VE)

    // ASSERT — grupos, subtotais e linhas, cada um com a frase do que entra nele
    expect(screen.getByText(O_QUE_E_O_DRE)).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Receita bruta' })).toBeInTheDocument()
    // o subtotal se reconhece pela forma; o "=" é enfeite desenhado pela tela, fora do texto
    expect(screen.getByText('Receita líquida')).toBeInTheDocument()
    expect(screen.getByText('O que sobra depois dos impostos.')).toBeInTheDocument()
    const servicos = await cartaoDaLinha('Prestação de serviços')
    expect(within(servicos).getByText('O que as famílias e os convênios pagam.')).toBeInTheDocument()
    expect(within(servicos).getByText('Sessões')).toBeInTheDocument()
    expect(within(await cartaoDaLinha('Outras receitas operacionais')).getByText('Nenhuma categoria cai aqui.')).toBeInTheDocument()
  })

  it('deve destacar as categorias no padrão e dizer quantas são', async () => {
    // ARRANGE + ACT
    renderizar(QUEM_SO_VE)

    // ASSERT — a do padrão ganha o selo; a escolhida (Pessoal) não
    const aviso = await screen.findByText(/^2 categorias estão na linha padrão da natureza/)
    expect(aviso).toHaveTextContent('receita em Prestação de serviços, despesa em Despesas administrativas')
    const administrativas = await cartaoDaLinha('Despesas administrativas')
    expect(within(administrativas).getByText('No padrão')).toBeInTheDocument()
    expect(within(await cartaoDaLinha('Despesas com pessoal')).queryByText('No padrão')).not.toBeInTheDocument()
  })

  it('deve pôr a subcategoria com linha própria onde o dinheiro dela cai, e a que segue, sob a categoria', async () => {
    // ARRANGE + ACT
    renderizar(QUEM_SO_VE)

    // ASSERT — "Tarifa do banco" escolheu as administrativas; "Salários" segue Pessoal
    expect(within(await cartaoDaLinha('Despesas administrativas')).getByText('Pessoal › Tarifa do banco')).toBeInTheDocument()
    const pessoal = await cartaoDaLinha('Despesas com pessoal')
    expect(within(pessoal).getByRole('list', { name: 'Subcategorias de Pessoal' })).toHaveTextContent(
      'Salários — Despesas com pessoal (segue a categoria)',
    )
  })

  it('deve mostrar a escada só para ler, sem seletor, a quem não edita categorias', async () => {
    // ARRANGE + ACT
    renderizar(QUEM_SO_VE)
    await cartaoDaLinha('Prestação de serviços')

    // ASSERT
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText(/^Você vê onde cada categoria cai\./)).toBeInTheDocument()
  })
})

describe('Configurar DRE — trocar a linha', () => {
  it('deve oferecer à despesa só as linhas de despesa, com o padrão da natureza primeiro', async () => {
    // ARRANGE + ACT
    renderizar(QUEM_CONFIGURA)

    // ASSERT — receita nunca vira opção de despesa (a API recusaria com 422)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    expect(within(aluguel).getAllByRole('option').map((opcao) => opcao.textContent)).toEqual([
      'Padrão da despesa (Despesas administrativas)',
      'Impostos sobre o faturamento',
      'Despesas com pessoal',
      'Despesas administrativas',
    ])
    expect(aluguel).toHaveValue('')
    // sem rascunho, não há o que aplicar
    expect(screen.queryByRole('button', { name: /^Aplicar/ })).not.toBeInTheDocument()
  })

  it('deve trocar a linha com a versão lida ao aplicar, levar a categoria ao lugar novo e o foco junto', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { registro } = renderizar(QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'pessoal')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' }))

    // ASSERT — o PUT leva a linha e o If-Match; a categoria passa a morar em "Despesas com pessoal"
    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'Despesas com pessoal' })).getByRole('combobox', { name: 'Aluguel: linha do DRE' }),
      ).toHaveFocus()
    })
    expect(registro.envios).toEqual([{ caminho: '/categorias/2', corpo: { linha_dre: 'pessoal' }, versao: 'v-aluguel' }])
    expect(
      within(screen.getByRole('region', { name: 'Despesas administrativas' })).queryByRole('combobox', { name: 'Aluguel: linha do DRE' }),
    ).toBeNull()
    expect(await screen.findByText('Aluguel agora entra em Despesas com pessoal.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Aplicar/ })).not.toBeInTheDocument()
  })

  it('deve só guardar o rascunho ao escolher — nada é enviado e o item não muda de lugar', async () => {
    // ARRANGE — o rascunho do Aluguel, e DEPOIS uma troca aplicada no Pessoal: quando o PUT do
    // Pessoal volta, um envio do Aluguel no `onChange` já teria saído antes dele
    const usuario = userEvent.setup()
    const { registro } = renderizar(QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })

    // ACT
    await usuario.selectOptions(aluguel, 'pessoal')
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Pessoal: linha do DRE' }), '')
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Pessoal' }))
    expect(await screen.findByText('Pessoal voltou a: Padrão da despesa (Despesas administrativas).')).toBeInTheDocument()

    // ASSERT — só o PUT do Pessoal; o Aluguel continua onde estava, com o rascunho e os botões
    expect(registro.envios).toEqual([{ caminho: '/categorias/3', corpo: { linha_dre: null }, versao: 'v-pessoal' }])
    const administrativas = screen.getByRole('region', { name: 'Despesas administrativas' })
    expect(within(administrativas).getByRole('combobox', { name: 'Aluguel: linha do DRE' })).toHaveValue('pessoal')
    expect(within(administrativas).getByRole('button', { name: 'Aplicar a linha de Aluguel' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Despesas com pessoal' })).queryByRole('combobox', { name: 'Aluguel: linha do DRE' }),
    ).toBeNull()
  })

  it('deve manter o rascunho da subcategoria que segue a mãe quando a mãe troca de linha (CR-WEB-R2-01)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { registro } = renderizar(QUEM_CONFIGURA)

    // ACT — Salários é desenhada DENTRO do item de Pessoal: muda de cartão com ela e remonta
    await rascunhoDeSalariosComAMaeAplicada(usuario)

    // ASSERT — o rascunho foi junto, com os botões; só o PUT da mãe saiu
    const administrativas = await cartaoDaLinha('Despesas administrativas')
    expect(within(administrativas).getByRole('combobox', { name: 'Pessoal › Salários: linha do DRE' })).toHaveValue('impostos')
    expect(within(administrativas).getByRole('button', { name: 'Aplicar a linha de Pessoal › Salários' })).toBeInTheDocument()
    expect(registro.envios).toEqual([{ caminho: '/categorias/3', corpo: { linha_dre: null }, versao: 'v-pessoal' }])
  })

  it('deve descartar o rascunho quando o gravado muda por fora — aplicar gravaria por cima sem 409', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar(QUEM_CONFIGURA)
    const tela = await rascunhoDoAluguelComOServidorNaMao(usuario)
    tela.servir(comOAluguelEm('pessoal', 'v-aluguel-outra'))

    // ACT
    await tela.reconsultar()

    // ASSERT — o Aluguel mostra a linha da outra pessoa, sem nada a aplicar
    const pessoal = await cartaoDaLinha('Despesas com pessoal')
    expect(await within(pessoal).findByRole('combobox', { name: 'Aluguel: linha do DRE' })).toHaveValue('pessoal')
    expect(screen.queryByRole('button', { name: 'Aplicar a linha de Aluguel' })).not.toBeInTheDocument()
  })

  it('deve manter "enviando" no seletor que remonta com o envio no ar — uma escolha e um envio só (CR-WEB-R3-01)', async () => {
    // ARRANGE — o PUT de Salários fica no ar enquanto Pessoal é aplicada e leva Salários a outro cartão
    const usuario = userEvent.setup()
    const { registro } = renderizar(QUEM_CONFIGURA)
    let liberar = (): void => undefined
    const liberado = new Promise<void>((resolver) => {
      liberar = resolver
    })
    let segurar = true
    servidor.use(
      msw.put('/api/subcategorias/:id/linha-dre', async () => {
        if (segurar) {
          segurar = false
          await liberado
        }
        // sem resposta: segue para o handler que grava e registra o envio
      }),
    )
    await usuario.selectOptions(await screen.findByRole('combobox', { name: 'Pessoal › Salários: linha do DRE' }), 'impostos')
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Pessoal › Salários' }))
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Pessoal: linha do DRE' }), '')
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Pessoal' }))
    expect(await screen.findByText('Pessoal voltou a: Padrão da despesa (Despesas administrativas).')).toBeInTheDocument()
    const administrativas = await cartaoDaLinha('Despesas administrativas')
    const salarios = within(administrativas).getByRole('combobox', { name: 'Pessoal › Salários: linha do DRE' })

    // ACT — com o envio ainda no ar, o seletor REMONTADO recebe outra escolha e outro clique
    await usuario.selectOptions(salarios, 'pessoal')
    await usuario.click(within(administrativas).getByRole('button', { name: 'Aplicar a linha de Pessoal › Salários' }))
    liberar()

    // ASSERT — o remontado sabia do envio: recusou a escolha, não mandou de novo
    expect(within(administrativas).getByRole('button', { name: 'Aplicar a linha de Pessoal › Salários' })).toHaveAttribute('aria-busy', 'true')
    expect(salarios).toHaveValue('impostos')
    expect(await screen.findByText('Salários agora entra em Impostos sobre o faturamento.')).toBeInTheDocument()
    expect(registro.envios.filter((envio) => envio.caminho === '/subcategorias/31')).toEqual([
      { caminho: '/subcategorias/31', corpo: { linha_dre: 'impostos' }, versao: 'v-salarios' },
    ])
  })

  it('deve dizer a recusa (422) no aviso quando o campo desmontou durante o envio (CR-WEB-R4-01)', async () => {
    // ARRANGE — o PUT de Salários fica no ar e volta recusado depois de Salários mudar de cartão
    const usuario = userEvent.setup()
    renderizar(QUEM_CONFIGURA)
    const razao = 'Esta linha do DRE é de receita, e a categoria é de despesa.'
    let liberar = (): void => undefined
    const liberado = new Promise<void>((resolver) => {
      liberar = resolver
    })
    servidor.use(
      msw.put('/api/subcategorias/:id/linha-dre', async () => {
        await liberado
        return HttpResponse.json({ message: razao, errors: { linha_dre: [razao] } }, { status: 422 })
      }),
    )
    await usuario.selectOptions(await screen.findByRole('combobox', { name: 'Pessoal › Salários: linha do DRE' }), 'impostos')
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Pessoal › Salários' }))
    await usuario.selectOptions(screen.getByRole('combobox', { name: 'Pessoal: linha do DRE' }), '')
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Pessoal' }))
    expect(await screen.findByText('Pessoal voltou a: Padrão da despesa (Despesas administrativas).')).toBeInTheDocument()

    // ACT
    liberar()

    // ASSERT — a razão chega à pessoa, e o campo remontado diz o gravado
    expect(await screen.findByText(razao)).toBeInTheDocument()
    const administrativas = await cartaoDaLinha('Despesas administrativas')
    expect(within(administrativas).getByRole('combobox', { name: 'Pessoal › Salários: linha do DRE' })).toHaveValue('')
  })

  it('deve descartar o rascunho quando a NATUREZA da categoria muda por fora, mesmo com a linha igual (CR-WEB-R3-02)', async () => {
    // ARRANGE — o Aluguel (sem linha) virou receita pelas mãos de outra pessoa: a linha continua nula
    const usuario = userEvent.setup()
    renderizar(QUEM_CONFIGURA)
    const tela = await rascunhoDoAluguelComOServidorNaMao(usuario)
    tela.servir(
      configuracaoDoDreFicticia(
        configuracaoDoDreFicticia().categorias.map((categoria) =>
          categoria.id === 2 ? { ...categoria, tipo: 'receita', linha_efetiva: 'servicos', updated_at: 'v-aluguel-receita' } : categoria,
        ),
      ),
    )

    // ACT
    await tela.reconsultar()

    // ASSERT — nada a aplicar: "Impostos" nem é mais uma opção do Aluguel
    const servicos = await cartaoDaLinha('Prestação de serviços')
    expect(await within(servicos).findByRole('combobox', { name: 'Aluguel: linha do DRE' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Aplicar a linha de Aluguel' })).not.toBeInTheDocument()
  })

  it('deve levar junto o rascunho do item que sumiu — ele não volta com o item (CR-WEB-R3-03)', async () => {
    // ARRANGE — o Aluguel sai da configuração (excluído) e volta igual
    const usuario = userEvent.setup()
    renderizar(QUEM_CONFIGURA)
    const tela = await rascunhoDoAluguelComOServidorNaMao(usuario)
    tela.servir(configuracaoDoDreFicticia(configuracaoDoDreFicticia().categorias.filter((categoria) => categoria.id !== 2)))
    await tela.reconsultar()
    await waitFor(() => {
      expect(screen.queryByRole('combobox', { name: 'Aluguel: linha do DRE' })).not.toBeInTheDocument()
    })
    tela.servir(configuracaoDoDreFicticia())

    // ACT
    await tela.reconsultar()

    // ASSERT
    expect(await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Aplicar a linha de Aluguel' })).not.toBeInTheDocument()
  })

  it('deve não trazer de volta o rascunho descartado quando o gravado volta ao de antes', async () => {
    // ARRANGE — o rascunho foi descartado pela troca da outra pessoa
    const usuario = userEvent.setup()
    renderizar(QUEM_CONFIGURA)
    const tela = await rascunhoDoAluguelComOServidorNaMao(usuario)
    tela.servir(comOAluguelEm('pessoal', 'v-aluguel-outra'))
    await tela.reconsultar()
    // a tela DESENHOU a troca da outra pessoa (sem isso, as duas leituras podem virar um desenho só)
    await within(await cartaoDaLinha('Despesas com pessoal')).findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    tela.servir(comOAluguelEm(null, 'v-aluguel-outra-2'))

    // ACT — a outra pessoa desfaz
    await tela.reconsultar()

    // ASSERT — de volta ao lugar de antes, com o gravado: o descartado não ressuscita
    const administrativas = await cartaoDaLinha('Despesas administrativas')
    expect(await within(administrativas).findByRole('combobox', { name: 'Aluguel: linha do DRE' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Aplicar a linha de Aluguel' })).not.toBeInTheDocument()
  })

  it('deve desfazer o rascunho de volta ao gravado, sem enviar nada, com o foco no campo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { registro } = renderizar(QUEM_CONFIGURA)
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'impostos')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Desfazer a escolha de Aluguel' }))

    // ASSERT — o botão que tinha o foco sumiu: o foco fica no campo, nunca no `body`
    expect(aluguel).toHaveValue('')
    expect(aluguel).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Aplicar a linha de Aluguel' })).not.toBeInTheDocument()
    expect(registro.envios).toEqual([])
  })

  it('deve voltar ao padrão mandando nulo', async () => {
    // ARRANGE — Pessoal escolheu a sua linha
    const usuario = userEvent.setup()
    const { registro } = renderizar(QUEM_CONFIGURA)
    await usuario.selectOptions(await screen.findByRole('combobox', { name: 'Pessoal: linha do DRE' }), '')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Pessoal' }))

    // ASSERT
    await waitFor(() => {
      expect(registro.envios).toEqual([{ caminho: '/categorias/3', corpo: { linha_dre: null }, versao: 'v-pessoal' }])
    })
    expect(await screen.findByText('Pessoal voltou a: Padrão da despesa (Despesas administrativas).')).toBeInTheDocument()
  })

  it('deve trocar a linha da subcategoria pela rota dela', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { registro } = renderizar(QUEM_CONFIGURA)
    const salarios = await screen.findByRole('combobox', { name: 'Pessoal › Salários: linha do DRE' })
    expect(within(salarios).getAllByRole('option')[0]).toHaveTextContent('Segue a categoria (Despesas com pessoal)')
    await usuario.selectOptions(salarios, 'impostos')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Pessoal › Salários' }))

    // ASSERT
    await waitFor(() => {
      expect(registro.envios).toEqual([{ caminho: '/subcategorias/31', corpo: { linha_dre: 'impostos' }, versao: 'v-salarios' }])
    })
  })

  it('deve pousar a recusa do servidor no campo e mostrar o que está gravado', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar(QUEM_CONFIGURA)
    servidor.use(
      msw.put('/api/categorias/:id/linha-dre', () =>
        HttpResponse.json(
          { message: 'Esta linha do DRE é de receita, e a categoria é de despesa.', errors: { linha_dre: ['Esta linha do DRE é de receita, e a categoria é de despesa.'] } },
          { status: 422 },
        ),
      ),
    )
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'impostos')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' }))

    // ASSERT — a razão fica no campo, o seletor volta ao que o servidor tem e o foco fica nele
    await waitFor(() => {
      expect(aluguel).toHaveAttribute('aria-invalid', 'true')
    })
    expect(aluguel).toHaveValue('')
    expect(aluguel).toHaveAccessibleDescription('Esta linha do DRE é de receita, e a categoria é de despesa.')
    expect(aluguel).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Aplicar a linha de Aluguel' })).not.toBeInTheDocument()
  })

  it('deve dizer a recusa do campo (422) só no campo, sem o toast repeti-la (A11Y-FIN-R2-04)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { registro } = renderizar(QUEM_CONFIGURA)
    const razao = 'Esta linha do DRE é de receita, e a categoria é de despesa.'
    servidor.use(
      msw.put('/api/categorias/:id/linha-dre', () => HttpResponse.json({ message: razao, errors: { linha_dre: [razao] } }, { status: 422 })),
    )
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'impostos')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' }))

    // ASSERT — espera a reconsulta que a recusa dispara: o toast, se houvesse, já estaria na tela
    await waitFor(() => {
      expect(registro.leituras).toBe(2)
    })
    expect(aluguel).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText(razao)).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent(razao)
  })

  it('deve levar o foco ao seletor no lugar novo quando outra pessoa mudou antes (409)', async () => {
    // ARRANGE — enquanto a tela estava aberta, outra pessoa pôs o Aluguel em "Despesas com pessoal"
    const usuario = userEvent.setup()
    renderizar(QUEM_CONFIGURA)
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
    await usuario.selectOptions(await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' }), 'impostos')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' }))

    // ASSERT — o item foi redesenhado noutro cartão: o foco o reencontra, nunca cai no `body`
    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'Despesas com pessoal' })).getByRole('combobox', { name: 'Aluguel: linha do DRE' }),
      ).toHaveFocus()
    })
    expect(screen.getByRole('combobox', { name: 'Aluguel: linha do DRE' })).toHaveValue('pessoal')
    // a razão ainda chega: o campo que a receberia desmontou, o aviso não
    expect(await screen.findByText(MENSAGEM_DE_CONFLITO)).toBeInTheDocument()
  })

  it('deve não ter violações axe na escada com os seletores', async () => {
    // ARRANGE + ACT
    const { container } = renderizar(QUEM_CONFIGURA)
    await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe com um rascunho pendente, os dois botões à vista', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { container } = renderizar(QUEM_CONFIGURA)
    await usuario.selectOptions(await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' }), 'pessoal')

    // ACT
    await screen.findByRole('button', { name: 'Aplicar a linha de Aluguel' })

    // ASSERT
    expect(screen.getByRole('button', { name: 'Desfazer a escolha de Aluguel' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe com a subcategoria que manteve o rascunho no cartão novo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { container } = renderizar(QUEM_CONFIGURA)

    // ACT
    await rascunhoDeSalariosComAMaeAplicada(usuario)

    // ASSERT
    expect(screen.getByRole('button', { name: 'Aplicar a linha de Pessoal › Salários' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe com a recusa do servidor no campo, sem toast', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { container } = renderizar(QUEM_CONFIGURA)
    servidor.use(
      msw.put('/api/categorias/:id/linha-dre', () =>
        HttpResponse.json({ message: 'Linha recusada.', errors: { linha_dre: ['Linha recusada.'] } }, { status: 422 }),
      ),
    )
    const aluguel = await screen.findByRole('combobox', { name: 'Aluguel: linha do DRE' })
    await usuario.selectOptions(aluguel, 'impostos')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Aplicar a linha de Aluguel' }))
    await waitFor(() => {
      expect(aluguel).toHaveAttribute('aria-invalid', 'true')
    })

    // ASSERT — o estado é o do 422 sem toast: a razão existe uma vez só, no campo
    expect(screen.getAllByText('Linha recusada.')).toHaveLength(1)
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)
})

describe('Configurar DRE — os estados', () => {
  it('deve dizer que não carregou e oferecer tentar de novo — nunca uma escada vazia', async () => {
    // ARRANGE + ACT
    renderizar(QUEM_SO_VE, { leituraRecusada: true })

    // ASSERT
    expect(await screen.findByText('Não foi possível carregar a configuração do DRE.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Receita bruta' })).not.toBeInTheDocument()
  })
})
