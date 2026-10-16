import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaCartoes } from '@/paginas/pagina-cartoes'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CartaoFinanceiro, ContaFinanceira } from '@/tipos'

const TUDO = ['cartoes.ver', 'cartoes.criar', 'cartoes.editar', 'cartoes.excluir', 'contas.ver']

const CAIXA: ContaFinanceira = {
  id: 4,
  nome: 'Banco do Brasil',
  codigo_contabil: null,
  ativo: true,
  updated_at: 'v1',
}

const CIELO: CartaoFinanceiro = {
  id: 1,
  nome: 'Cielo',
  tipo: 'credito',
  bandeira: null,
  pct_a_vista: '2.99',
  pct_parcelas: null,
  dias_recebimento: 30,
  conta_id: 4,
  liquidar_auto: false,
  antecipacao_credito: false,
  updated_at: 'v1',
}

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/cartoes']}>
          <PaginaCartoes />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Cartões — a lista traduz o cadastro em palavras da clínica', () => {
  it('deve mostrar tipo, taxa, prazo e a conta pelo NOME', async () => {
    // ARRANGE — `conta_id: 4` não diz nada a quem está no balcão
    servidor.use(
      msw.get('/api/cartoes', () => HttpResponse.json([CIELO])),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
    )

    // ACT
    renderizar()

    // ASSERT
    await screen.findByText('Cielo')
    expect(screen.getByText('Crédito')).toBeInTheDocument()
    expect(screen.getByText('2,99%')).toBeInTheDocument()
    expect(screen.getByText('30 dias')).toBeInTheDocument()
    expect(screen.getByText('Banco do Brasil')).toBeInTheDocument()
  })

  it('deve dizer "No mesmo dia" quando o prazo é zero', async () => {
    // ARRANGE — "0 dias" é o tipo de rótulo que faz a operadora reler duas vezes
    servidor.use(
      msw.get('/api/cartoes', () =>
        HttpResponse.json([{ ...CIELO, tipo: 'debito', dias_recebimento: 0 }]),
      ),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
    )

    // ACT
    renderizar()

    // ASSERT
    await screen.findByText('Cielo')
    expect(screen.getByText('No mesmo dia')).toBeInTheDocument()
    expect(screen.getByText('Débito')).toBeInTheDocument()
  })
})

describe('Cartões — a conta de destino vem das contas da clínica', () => {
  it('deve oferecer no seletor as contas cadastradas', async () => {
    // ARRANGE — a API recusa conta inexistente com 422; a tela nem a oferece
    servidor.use(
      msw.get('/api/cartoes', () => HttpResponse.json([])),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    const seletor = within(dialog).getByRole('combobox', { name: /Conta de destino/i })
    expect(within(seletor).getByRole('option', { name: 'Banco do Brasil' })).toBeInTheDocument()
  })

  it('deve pousar no campo certo a recusa de taxa e de dias', async () => {
    // ARRANGE — faixas validadas pelo servidor (0..100 e 0..365); a tela só traduz
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json([])),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.post('/api/cartoes', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: {
              pct_a_vista: ['A taxa deve estar entre 0 e 100.'],
              dias_recebimento: ['Os dias de recebimento devem estar entre 0 e 365.'],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Stone')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Taxa à vista/i }), '150')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Dias para recebimento/i }), '999')
    await usuario.selectOptions(
      within(dialog).getByRole('combobox', { name: /Conta de destino/i }),
      '4',
    )
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT
    expect(await within(dialog).findByText('A taxa deve estar entre 0 e 100.')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Os dias de recebimento devem estar entre 0 e 365.'),
    ).toBeInTheDocument()
  })
})

describe('Cartões — mudar a conta de destino é REGRA', () => {
  it('deve confirmar dizendo que o dinheiro passa a ser considerado em outra conta', async () => {
    // ARRANGE
    let putRecebido = false
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json([CIELO])),
      msw.get('/api/contas', () =>
        HttpResponse.json([CAIXA, { ...CAIXA, id: 5, nome: 'Caixa da recepção' }]),
      ),
      msw.put('/api/cartoes/:id', () => {
        putRecebido = true
        return HttpResponse.json({ ...CIELO, conta_id: 5 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Cielo')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.selectOptions(
      within(dialog).getByRole('combobox', { name: /Conta de destino/i }),
      '5',
    )
    await usuario.click(within(dialog).getByRole('button', { name: /^Salvar$/i }))

    // ASSERT
    expect(putRecebido).toBe(false)
    expect(
      await screen.findByText(/passa a ser considerado em outra conta/i),
    ).toBeInTheDocument()
  })
})

describe('Cartões — o v1 é cadastro, e a tela não promete movimento', () => {
  it('deve avisar que a liquidação automática ainda não lança nada', async () => {
    // ARRANGE — a engine de recebíveis é fase 2; prometer baixa automática seria
    // a clínica esperar dinheiro entrando sozinho no caixa
    servidor.use(
      msw.get('/api/cartoes', () => HttpResponse.json([])),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(
      within(dialog).getByText(/Por enquanto nada é lançado automaticamente/i),
    ).toBeInTheDocument()
  })
})


describe('Cartões — a taxa fala português nos dois sentidos', () => {
  it('deve enviar 2.99 quando a operadora digita 2,99', async () => {
    // ARRANGE — "2,99" é como se escreve em português; mandar cru levava 422 do `numeric`
    let enviado: unknown = null
    const noServidor: CartaoFinanceiro[] = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json(noServidor)),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.post('/api/cartoes', async ({ request }) => {
        enviado = await request.json()
        const criado = { ...CIELO, id: 2, nome: 'Stone' }
        noServidor.push(criado)
        return HttpResponse.json(criado, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Stone')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Taxa à vista/i }), '2,99')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Dias para recebimento/i }), '30')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Conta de destino/i }), '4')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT
    await screen.findByText('Stone')
    expect(enviado).toMatchObject({ pct_a_vista: '2.99' })
  })

  it('deve hidratar a edição com vírgula, não com ponto', async () => {
    // ARRANGE — o mesmo campo é lido e reescrito pela MESMA pessoa
    servidor.use(
      msw.get('/api/cartoes', () => HttpResponse.json([CIELO])),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Cielo')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(within(dialog).getByRole('textbox', { name: /Taxa à vista/i })).toHaveValue('2,99')
  })
})

describe('Cartões — sem conta cadastrada a tela não fica muda', () => {
  it('deve apontar o cadastro de contas e travar o Cadastrar', async () => {
    // ARRANGE — a conta de destino decide PARA ONDE vai o dinheiro, e o servidor a exige.
    // Este era o beco sem saída que a própria change veio matar, renascido na tela nova.
    servidor.use(
      msw.get('/api/cartoes', () => HttpResponse.json([])),
      msw.get('/api/contas', () => HttpResponse.json([])),
    )
    const usuario = userEvent.setup()
    renderizar([...TUDO, 'contas.criar'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(within(dialog).getByText('Nenhuma conta cadastrada.')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /Cadastros › Contas/ })).toHaveAttribute(
      'href',
      '/contas',
    )
    expect(within(dialog).getByRole('button', { name: /^Cadastrar$/i })).toBeDisabled()
  })

  it('deve travar o Cadastrar também quando a consulta de contas é NEGADA', async () => {
    // ARRANGE — `cartoes.*` sem `contas.ver`: o seletor obrigatório fica sem opção, e
    // salvar mandaria `conta_id: 0`. O ramo do 403 não tinha guarda: apagar
    // `&& !contasComErro` deixava a suíte verde e o botão habilitado (achado SEC-CFT-07).
    servidor.use(
      msw.get('/api/cartoes', () => HttpResponse.json([])),
      msw.get('/api/contas', () => HttpResponse.json({ message: 'Negado.' }, { status: 403 })),
    )
    const usuario = userEvent.setup()
    renderizar(['cartoes.ver', 'cartoes.criar'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT — a frase é a do ACESSO, não a do vazio (são diagnósticos diferentes)
    expect(
      within(dialog).getByText(/Não foi possível carregar as contas/i),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText('Nenhuma conta cadastrada.')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^Cadastrar$/i })).toBeDisabled()
  })

  it('deve avisar quando não tem permissão de ver contas, em vez de mostrar "—"', async () => {
    // ARRANGE — `cartoes.ver` sem `contas.ver`: a API responde 403 e a coluna Conta
    // mostraria "—", mentindo (o cartão TEM conta; quem não a vê é a tela)
    servidor.use(
      msw.get('/api/cartoes', () => HttpResponse.json([CIELO])),
      msw.get('/api/contas', () => HttpResponse.json({ message: 'Negado.' }, { status: 403 })),
    )

    // ACT
    renderizar(['cartoes.ver', 'cartoes.criar'])
    await screen.findByText('Cielo')

    // ASSERT
    expect(await screen.findByText('Sem acesso às contas')).toBeInTheDocument()
  })

  it('deve esconder as ações de quem só pode ver', async () => {
    // ARRANGE — a única das quatro telas sem este caso (achado SEC-CFT-05 do gate)
    servidor.use(
      msw.get('/api/cartoes', () => HttpResponse.json([CIELO])),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
    )

    // ACT
    renderizar(['cartoes.ver', 'contas.ver'])
    await screen.findByText('Cielo')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cadastrar cartão/i })).not.toBeInTheDocument()
  })
})

describe('Cartões — bandeira, taxa por parcela e antecipação (change bandeira-e-parcelas-do-cartao)', () => {
  it('deve mostrar o selo da bandeira na lista quando o cartão tem uma', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/cartoes', () =>
        HttpResponse.json([{ ...CIELO, bandeira: 'mastercard' }]),
      ),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
    )

    // ACT
    renderizar()

    // ASSERT
    await screen.findByText('Cielo')
    expect(screen.getByText('Mastercard')).toBeInTheDocument()
  })

  it('deve não mostrar selo nenhum quando o cartão está sem bandeira', async () => {
    // ARRANGE — bandeira é opcional; ausência não é erro
    servidor.use(
      msw.get('/api/cartoes', () => HttpResponse.json([CIELO])),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
    )

    // ACT
    renderizar()

    // ASSERT
    await screen.findByText('Cielo')
    expect(screen.queryByText('Visa')).not.toBeInTheDocument()
    expect(screen.queryByText('Mastercard')).not.toBeInTheDocument()
  })

  it('deve enviar só a bandeira escolhida, sem exigir nenhuma', async () => {
    // ARRANGE
    let enviado: Record<string, unknown> = {}
    const noServidor: CartaoFinanceiro[] = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json(noServidor)),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.post('/api/cartoes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        const criado = { ...CIELO, id: 2, nome: 'Stone', bandeira: 'elo' as const }
        noServidor.push(criado)
        return HttpResponse.json(criado, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Stone')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Taxa à vista/i }), '2,99')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Dias para recebimento/i }), '30')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Conta de destino/i }), '4')
    await usuario.click(within(dialog).getByRole('button', { name: 'Elo' }))
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT
    await screen.findByText('Stone')
    expect(enviado.bandeira).toBe('elo')
  })

  it('deve enviar só as parcelas preenchidas, com chave ausente para as em branco', async () => {
    // ARRANGE — o servidor recusa chave fora de 2..12; enviar "" seria pior que omitir
    let enviado: Record<string, unknown> = {}
    const noServidor: CartaoFinanceiro[] = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json(noServidor)),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.post('/api/cartoes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        const criado = { ...CIELO, id: 2, nome: 'Stone', pct_parcelas: { '2': '3.50', '6': '4.20' } }
        noServidor.push(criado)
        return HttpResponse.json(criado, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Stone')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Taxa à vista/i }), '2,99')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Dias para recebimento/i }), '30')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Conta de destino/i }), '4')
    await usuario.type(within(dialog).getByRole('textbox', { name: '2x' }), '3,50')
    await usuario.type(within(dialog).getByRole('textbox', { name: '6x' }), '4,20')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT — nada de "3x": "", nem "12x ou mais": ""
    await screen.findByText('Stone')
    expect(enviado.pct_parcelas).toEqual({ '2': '3.50', '6': '4.20' })
  })

  it('deve pousar a recusa de uma faixa específica no campo certo', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json([])),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.post('/api/cartoes', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: { 'pct_parcelas.6': ['O campo pct parcelas.6 deve estar entre 0 e 100.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Stone')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Taxa à vista/i }), '2,99')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Dias para recebimento/i }), '30')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Conta de destino/i }), '4')
    await usuario.type(within(dialog).getByRole('textbox', { name: '6x' }), '150')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT — a mensagem é a DESCRIÇÃO do campo "6x" (aria-describedby), não um aviso
    // geral solto no topo do diálogo. Isso é o que prova que a chave "pct_parcelas" está
    // na raiz conhecida da tela — sem ela, a mensagem cai em erros.gerais e aparece em
    // QUALQUER lugar do diálogo, inclusive fora do campo, sem ninguém notar a diferença.
    const campo6x = within(dialog).getByRole('textbox', { name: '6x' })
    const descritoPor = campo6x.getAttribute('aria-describedby') ?? ''
    const idDoErro = descritoPor.split(' ').find((id) => id.endsWith('-erro'))
    expect(idDoErro).toBeDefined()
    expect(document.getElementById(idDoErro!)?.textContent).toContain(
      'O campo pct parcelas.6 deve estar entre 0 e 100.',
    )
  })

  it('deve marcar e desmarcar antecipação de crédito', async () => {
    // ARRANGE
    let enviado: Record<string, unknown> = {}
    const noServidor: CartaoFinanceiro[] = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json(noServidor)),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.post('/api/cartoes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        const criado = { ...CIELO, id: 2, nome: 'Stone', antecipacao_credito: true }
        noServidor.push(criado)
        return HttpResponse.json(criado, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Stone')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Taxa à vista/i }), '2,99')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Dias para recebimento/i }), '30')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Conta de destino/i }), '4')
    await usuario.click(within(dialog).getByRole('checkbox', { name: /Antecipação de crédito/i }))
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT
    await screen.findByText('Stone')
    expect(enviado.antecipacao_credito).toBe(true)
  })

  it('deve salvar sem preencher bandeira, parcela nenhuma nem antecipação (padrão de antes continua funcionando)', async () => {
    // ARRANGE — os campos novos não podem virar obrigatórios por acidente
    let enviado: Record<string, unknown> = {}
    const noServidor: CartaoFinanceiro[] = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json(noServidor)),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.post('/api/cartoes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        const criado = { ...CIELO, id: 2, nome: 'Stone' }
        noServidor.push(criado)
        return HttpResponse.json(criado, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Stone')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Taxa à vista/i }), '2,99')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Dias para recebimento/i }), '30')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Conta de destino/i }), '4')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT — a chave EXISTE, sinalizando "nada escolhido" (null/{}), nunca ausente
    await screen.findByText('Stone')
    expect(enviado.bandeira).toBeNull()
    expect(enviado.pct_parcelas).toEqual({})
    expect(enviado.antecipacao_credito).toBe(false)
  })
})

describe('Cartões — limpar bandeira ou a última parcela precisa limpar de verdade', () => {
  it('deve enviar bandeira null ao escolher "Nenhuma" num cartão que já tinha bandeira', async () => {
    // ARRANGE — a chave AUSENTE e `null` explícito significam coisas diferentes para o
    // servidor (`sometimes`): omitir preserva o valor antigo. "Nenhuma" tem de mandar null.
    let enviado: Record<string, unknown> = {}
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json([{ ...CIELO, bandeira: 'visa' }])),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.put('/api/cartoes/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...CIELO, bandeira: null })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Cielo')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: 'Nenhuma' }))
    await usuario.click(within(dialog).getByRole('button', { name: /^Salvar$/i }))

    // ASSERT — a chave existe e é null, nunca ausente
    await waitFor(() => {
      expect(enviado.bandeira).toBeNull()
    })
    expect('bandeira' in enviado).toBe(true)
  })

  it('deve enviar pct_parcelas vazio ao apagar a ÚNICA faixa preenchida', async () => {
    // ARRANGE
    let enviado: Record<string, unknown> = {}
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () =>
        HttpResponse.json([{ ...CIELO, pct_parcelas: { '6': '4.20' } }]),
      ),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.put('/api/cartoes/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...CIELO, pct_parcelas: {} })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Cielo')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const campo6x = within(dialog).getByRole('textbox', { name: '6x' })
    expect(campo6x).toHaveValue('4,20')
    await usuario.clear(campo6x)
    await usuario.click(within(dialog).getByRole('button', { name: /^Salvar$/i }))

    // ASSERT — a chave existe e é {}, nunca ausente (o que preservaria "6" no servidor)
    await waitFor(() => {
      expect(enviado.pct_parcelas).toEqual({})
    })
    expect('pct_parcelas' in enviado).toBe(true)
  })

  it('deve continuar enviando bandeira null e pct_parcelas {} num cartão NOVO, sem nenhum dos dois preenchido', async () => {
    // ARRANGE — regressão do "salvar sem preencher nada" (era `undefined`, agora é
    // `null`/`{}`, mas a intenção — não travar o cadastro — continua a mesma)
    let enviado: Record<string, unknown> = {}
    const noServidor: CartaoFinanceiro[] = []
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.get('/api/cartoes', () => HttpResponse.json(noServidor)),
      msw.get('/api/contas', () => HttpResponse.json([CAIXA])),
      msw.post('/api/cartoes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        const criado = { ...CIELO, id: 2, nome: 'Stone' }
        noServidor.push(criado)
        return HttpResponse.json(criado, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar cartão/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Nome/i }), 'Stone')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Taxa à vista/i }), '2,99')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Dias para recebimento/i }), '30')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Conta de destino/i }), '4')
    await usuario.click(within(dialog).getByRole('button', { name: /^Cadastrar$/i }))

    // ASSERT
    await screen.findByText('Stone')
    expect(enviado.bandeira).toBeNull()
    expect(enviado.pct_parcelas).toEqual({})
  })
})
