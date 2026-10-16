import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { EXPLICACAO_DA_ABERTURA } from '@/componentes/financeiro/dialogo-saldo-de-abertura'
import { PainelFluxo } from '@/componentes/financeiro/painel-fluxo'
import { ORIGEM_DO_VALOR_DAS_CONTAS } from '@/componentes/financeiro/saldos-das-contas'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { SaldoDaConta, SaldosDasContas } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * Saldo das contas (change `saldo-das-contas`): os cartões "Quanto tem em cada conta", o filtro
 * pelo cartão, o convite e o diálogo da abertura, e o extrato com saldo anterior e saldo por linha.
 * Todos os valores vêm do SERVIDOR — as fixtures usam totais que NÃO são a soma das partes, para
 * que uma soma feita no navegador apareça como número errado. Dados FICTÍCIOS.
 */

const QUEM_VE_O_FLUXO = ['lancamentos.ver', 'fluxo_caixa.ver']
const QUEM_ACERTA_A_ABERTURA = [...QUEM_VE_O_FLUXO, 'contas.ver', 'contas.editar']

const VERSAO_DO_CAIXA = '2026-09-20T10:00:00.000000Z'

const CAIXA: SaldoDaConta = {
  id: 1,
  nome: 'Caixa Fictício',
  ativo: true,
  saldo: '1500.00',
  saldo_inicial: '0.00',
  saldo_inicial_em: null,
  updated_at: VERSAO_DO_CAIXA,
}

const BANCO: SaldoDaConta = {
  id: 2,
  nome: 'Banco Fictício',
  ativo: true,
  saldo: '2000.10',
  saldo_inicial: '1000.00',
  saldo_inicial_em: '2026-09-01',
  updated_at: '2026-09-02T10:00:00.000000Z',
}

/** O total é do servidor — e de propósito NÃO é 1500,00 + 2000,10 (3.500,10). */
function saldos(contas: SaldoDaConta[] = [CAIXA, BANCO], total = '9999.99'): SaldosDasContas {
  return { em: '2026-09-25', contas, total }
}

function extrato(contaId: number | null) {
  return {
    de: '2026-09-01',
    ate: '2026-09-25',
    conta_id: contaId,
    saldo_anterior: '1000.00',
    movimentos: [
      {
        movimento: 'receita',
        lancamento_id: 11,
        conta_id: 1,
        categoria_id: 1,
        valor_liquido: '100.00',
        pago_em: '2026-09-05 10:00',
        interessado: { tipo: 'paciente', id: 10, nome: 'Criança Fictícia' },
        // o saldo corrido é do servidor: 777,77 não é 1000 + 100
        saldo: '777.77',
      },
      {
        movimento: 'transferencia',
        transferencia_id: 3,
        conta_origem_id: 1,
        conta_destino_id: 2,
        valor: '50.00',
        data: '2026-09-06',
        saldo: '777.77',
      },
    ],
    totais: { entradas: '100.00', saidas: '0.00', saldo_do_periodo: '100.00', transferido: '50.00' },
  }
}

interface Registro {
  /** O `conta_id` de cada consulta do extrato (`null` = todas as contas). */
  extratos: Array<string | null>
  consultasDeSaldo: number
  envios: Array<{ corpo: Record<string, unknown>; versao: string | null }>
}

function comServidor({ contas = [CAIXA, BANCO], total = '9999.99' }: { contas?: SaldoDaConta[]; total?: string } = {}): Registro {
  const registro: Registro = { extratos: [], consultasDeSaldo: 0, envios: [] }
  servidor.use(
    msw.get('/api/contas', () =>
      HttpResponse.json(contas.map((conta) => ({ id: conta.id, nome: conta.nome, ativo: conta.ativo, codigo_contabil: null }))),
    ),
    msw.get('/api/contas/saldos', () => {
      registro.consultasDeSaldo += 1
      return HttpResponse.json(saldos(contas, total))
    }),
    msw.get('/api/fluxo-caixa', ({ request }) => {
      const contaId = new URL(request.url).searchParams.get('conta_id')
      registro.extratos.push(contaId)
      return HttpResponse.json(extrato(contaId === null ? null : Number(contaId)))
    }),
    msw.put('/api/contas/:id/saldo-de-abertura', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      registro.envios.push({ corpo, versao: request.headers.get('If-Match') })
      return HttpResponse.json({ id: 1, ...corpo, updated_at: '2026-09-25T13:00:00.000000Z' })
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
          <PainelFluxo />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** O cartão de uma conta — o botão que filtra, pelo nome dela. */
async function cartao(nome: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole('button', { name: nome })
}

beforeEach(() => {
  queryClient.clear()
})

describe('Quanto tem em cada conta — os cartões', () => {
  it('deve mostrar o saldo de cada conta e o total como o servidor os somou', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(QUEM_VE_O_FLUXO)

    // ASSERT — o total é o do servidor; a soma das partes (3.500,10) não existe na tela
    expect(await cartao(/^Todas as contas/)).toHaveTextContent('R$ 9.999,99')
    expect(screen.getByRole('button', { name: /^Caixa Fictício/ })).toHaveTextContent('R$ 1.500,00')
    expect(screen.getByRole('button', { name: /^Banco Fictício/ })).toHaveTextContent('R$ 2.000,10')
    expect(screen.queryByText('R$ 3.500,10')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Quanto tem em cada conta' })).toBeInTheDocument()
    expect(screen.getByText(ORIGEM_DO_VALOR_DAS_CONTAS)).toBeInTheDocument()
    expect(screen.getByText('Total em 25/09/2026')).toBeInTheDocument()
  })

  it('deve filtrar o extrato pela conta do cartão, e voltar a todas pelo mesmo cartão', async () => {
    // ARRANGE
    const registro = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_VE_O_FLUXO)
    const doCaixa = await cartao(/^Caixa Fictício/)

    // ACT
    await usuario.click(doCaixa)

    // ASSERT — o extrato é pedido com a conta, e o seletor diz a mesma coisa
    await waitFor(() => {
      expect(registro.extratos.at(-1)).toBe('1')
    })
    expect(doCaixa).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^Todas as contas/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Conta')).toHaveValue('1')

    // ACT — o cartão escolhido, de novo, devolve o extrato a todas as contas
    await usuario.click(doCaixa)

    // ASSERT
    await waitFor(() => {
      expect(registro.extratos.at(-1)).toBeNull()
    })
    expect(doCaixa).toHaveAttribute('aria-pressed', 'false')
  })

  it('deve mostrar no seletor a conta do cartão mesmo para quem não vê o cadastro de contas', async () => {
    // ARRANGE — vê o fluxo, não o cadastro: a lista de contas é recusada, os saldos não
    const registro = comServidor()
    servidor.use(msw.get('/api/contas', () => HttpResponse.json({ message: 'Sem permissão.' }, { status: 403 })))
    const usuario = userEvent.setup()
    renderizar(QUEM_VE_O_FLUXO)

    // ACT
    await usuario.click(await cartao(/^Banco Fictício/))

    // ASSERT — o seletor diz a verdade sobre o filtro que está valendo
    await waitFor(() => {
      expect(registro.extratos.at(-1)).toBe('2')
    })
    expect(screen.getByLabelText('Conta')).toHaveValue('2')
    expect(within(screen.getByLabelText('Conta')).getByRole('option', { name: 'Banco Fictício' })).toBeInTheDocument()
  })

  it('deve voltar a todas as contas pelo cartão do total', async () => {
    // ARRANGE
    const registro = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_VE_O_FLUXO)
    await usuario.click(await cartao(/^Banco Fictício/))
    await waitFor(() => {
      expect(registro.extratos.at(-1)).toBe('2')
    })

    // ACT
    await usuario.click(screen.getByRole('button', { name: /^Todas as contas/ }))

    // ASSERT
    await waitFor(() => {
      expect(registro.extratos.at(-1)).toBeNull()
    })
    expect(screen.getByLabelText('Conta')).toHaveValue('')
  })

  it('deve convidar a definir a abertura na conta que nunca teve, a quem pode acertá-la', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(QUEM_ACERTA_A_ABERTURA)

    // ASSERT — a conta sem abertura explica por que o número pode não bater; a outra diz a dela
    expect(await screen.findByRole('button', { name: 'Definir saldo de abertura de Caixa Fictício' })).toBeInTheDocument()
    expect(screen.getByText('Sem saldo de abertura: o número parte de zero e pode não bater com o banco.')).toBeInTheDocument()
    expect(screen.getByText('Abertura de R$ 1.000,00 em 01/09/2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ajustar abertura de Banco Fictício' })).toBeInTheDocument()
  })

  it('deve manter a explicação e esconder a ação de quem não pode editar contas', async () => {
    // ARRANGE
    comServidor()

    // ACT — vê o fluxo, mas não edita contas (design D5)
    renderizar(QUEM_VE_O_FLUXO)

    // ASSERT
    expect(await screen.findByText(/^Sem saldo de abertura/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Definir saldo de abertura/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ajustar abertura/ })).not.toBeInTheDocument()
  })

  it('deve marcar a conta inativa e o saldo negativo com palavra e sinal', async () => {
    // ARRANGE — a inativa só vem porque tem saldo; o negativo é cheque especial
    comServidor({
      contas: [{ ...BANCO, id: 5, nome: 'Conta Antiga Fictícia', ativo: false, saldo: '-350.00' }],
      total: '-350.00',
    })

    // ACT
    renderizar(QUEM_VE_O_FLUXO)

    // ASSERT
    const antiga = await cartao(/^Conta Antiga Fictícia/)
    expect(within(antiga).getByText('Inativa')).toBeInTheDocument()
    expect(within(antiga).getByText('-R$ 350,00')).toBeInTheDocument()
  })

  it('deve dizer que o saldo não carregou e oferecer tentar de novo — nunca "nenhuma conta"', async () => {
    // ARRANGE
    comServidor()
    servidor.use(msw.get('/api/contas/saldos', () => HttpResponse.json({ message: 'Falha' }, { status: 500 })))

    // ACT
    renderizar(QUEM_VE_O_FLUXO)

    // ASSERT
    // o 500 é repetido uma vez antes de virar erro (a regra do cliente): a espera cobre a repetição
    expect(await screen.findByText('Não foi possível carregar o saldo das contas.', undefined, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma conta para mostrar.')).not.toBeInTheDocument()
  })

  it('deve levar ao cadastro de contas quando a clínica ainda não tem nenhuma', async () => {
    // ARRANGE
    comServidor({ contas: [], total: '0.00' })

    // ACT
    renderizar([...QUEM_VE_O_FLUXO, 'contas.criar'])

    // ASSERT
    expect(await screen.findByText('Nenhuma conta para mostrar.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cadastrar conta' })).toHaveAttribute('href', '/contas')
  })

  it('deve não ter violações axe nos cartões com o convite e a conta escolhida', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    const { container } = renderizar(QUEM_ACERTA_A_ABERTURA)

    // ACT
    await usuario.click(await cartao(/^Caixa Fictício/))
    await screen.findByRole('rowheader', { name: /^Saldo anterior/ })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Extrato com saldo — os números são do servidor', () => {
  it('deve abrir o extrato pelo saldo anterior e mostrar o saldo depois de cada linha', async () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(QUEM_VE_O_FLUXO)

    // ASSERT — a primeira linha é o saldo anterior; cada movimento traz o saldo que o servidor mandou
    const anterior = await screen.findByRole('rowheader', { name: 'Saldo anterior, no fim de 31/08/2026' })
    const linhaDoAnterior = anterior.closest('tr') as HTMLElement
    expect(within(linhaDoAnterior).getByRole('cell', { name: 'R$ 1.000,00' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Saldo' })).toBeInTheDocument()
    const linhaDaReceita = screen.getByRole('cell', { name: 'Criança Fictícia' }).closest('tr') as HTMLElement
    expect(within(linhaDaReceita).getByRole('cell', { name: 'R$ 777,77' })).toBeInTheDocument()
    // a soma no navegador (1.000 + 100) não aparece em lugar nenhum
    expect(screen.queryByText('R$ 1.100,00')).not.toBeInTheDocument()
  })

  it('deve dizer de quem é o saldo de cada linha, com e sem conta escolhida', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_VE_O_FLUXO)
    expect(await screen.findByText(/^Todas as contas: o saldo de cada linha é o da clínica/)).toBeInTheDocument()

    // ACT
    await usuario.click(await cartao(/^Banco Fictício/))

    // ASSERT
    expect(await screen.findByText(/^Extrato de Banco Fictício: o saldo de cada linha é o desta conta/)).toBeInTheDocument()
  })

  it('deve dizer em quanto o saldo segue quando o período não teve movimento', async () => {
    // ARRANGE
    comServidor()
    servidor.use(
      msw.get('/api/fluxo-caixa', () => HttpResponse.json({ ...extrato(null), saldo_anterior: '432.10', movimentos: [] })),
    )

    // ACT
    renderizar(QUEM_VE_O_FLUXO)

    // ASSERT
    expect(await screen.findByText('Sem movimentos no período')).toBeInTheDocument()
    expect(screen.getByText(/O saldo segue em R\$ 432,10\./)).toBeInTheDocument()
  })
})

describe('Definir o saldo de abertura', () => {
  it('deve salvar a abertura negativa com a versão lida e refazer os saldos e o extrato', async () => {
    // ARRANGE
    const registro = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_ACERTA_A_ABERTURA)
    await screen.findByRole('rowheader', { name: /^Saldo anterior/ })
    await usuario.click(await screen.findByRole('button', { name: 'Definir saldo de abertura de Caixa Fictício' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Definir saldo de abertura — Caixa Fictício' })
    const consultasAntes = registro.consultasDeSaldo
    const extratosAntes = registro.extratos.length

    // ACT — o dia nasce com o "hoje" do servidor; a pessoa troca e digita no cheque especial
    expect(within(dialogo).getByText(EXPLICACAO_DA_ABERTURA)).toBeInTheDocument()
    const dia = within(dialogo).getByLabelText('Dia da abertura (obrigatório)')
    expect(dia).toHaveValue('2026-09-25')
    await usuario.clear(dia)
    await usuario.type(dia, '2026-10-01')
    await usuario.type(within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)'), '-1.350,50')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar abertura' }))

    // ASSERT — o corpo em decimal da API, a versão da leitura, e os saldos pedidos de novo
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(registro.envios).toEqual([
      { corpo: { saldo_inicial: '-1350.50', saldo_inicial_em: '2026-10-01' }, versao: VERSAO_DO_CAIXA },
    ])
    await waitFor(() => {
      expect(registro.consultasDeSaldo).toBeGreaterThan(consultasAntes)
    })
    // o saldo corrido de cada linha do extrato parte da abertura: ele também é pedido de novo
    await waitFor(() => {
      expect(registro.extratos.length).toBeGreaterThan(extratosAntes)
    })
    expect(await screen.findByText('Saldo de abertura de Caixa Fictício salvo.')).toBeInTheDocument()
  })

  it('deve abrir o ajuste com a abertura que a conta já tem', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_ACERTA_A_ABERTURA)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Ajustar abertura de Banco Fictício' }))

    // ASSERT
    const dialogo = await screen.findByRole('alertdialog', { name: 'Ajustar saldo de abertura — Banco Fictício' })
    expect(within(dialogo).getByLabelText('Dia da abertura (obrigatório)')).toHaveValue('2026-09-01')
    expect(within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)')).toHaveValue('1000,00')
  })

  it('deve pousar a recusa do servidor no campo do valor', async () => {
    // ARRANGE
    comServidor()
    servidor.use(
      msw.put('/api/contas/:id/saldo-de-abertura', () =>
        HttpResponse.json(
          { message: 'O valor deve ter no máximo duas casas.', errors: { saldo_inicial: ['O valor deve ter no máximo duas casas.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_ACERTA_A_ABERTURA)
    await usuario.click(await screen.findByRole('button', { name: 'Definir saldo de abertura de Caixa Fictício' }))
    const dialogo = await screen.findByRole('alertdialog')

    // ACT
    const valor = within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)')
    await usuario.type(valor, '10,999')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar abertura' }))

    // ASSERT — a mensagem fica no campo, ligada a ele, e o diálogo continua aberto; UMA vez só:
    // sem o toast repetindo a frase por cima (e roubando o Esc do diálogo)
    await waitFor(() => {
      expect(valor).toHaveAttribute('aria-invalid', 'true')
    })
    expect(valor).toHaveAccessibleDescription(/O valor deve ter no máximo duas casas\./)
    expect(screen.getAllByText('O valor deve ter no máximo duas casas.')).toHaveLength(1)
  })

  it('deve avisar do conflito sem gravar por cima, e recarregar a versão atual quando a pessoa pede', async () => {
    // ARRANGE — outra pessoa acertou o Caixa enquanto o diálogo estava aberto
    const registro = comServidor()
    let atualizada = false
    servidor.use(
      msw.put('/api/contas/:id/saldo-de-abertura', () => {
        atualizada = true
        return HttpResponse.json({ message: 'Conflito de versão.' }, { status: 409 })
      }),
      msw.get('/api/contas/saldos', () => {
        registro.consultasDeSaldo += 1
        return HttpResponse.json(
          saldos(atualizada ? [{ ...CAIXA, saldo_inicial: '200.00', saldo_inicial_em: '2026-09-10', updated_at: 'nova' }, BANCO] : [CAIXA, BANCO]),
        )
      }),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_ACERTA_A_ABERTURA)
    await usuario.click(await screen.findByRole('button', { name: 'Definir saldo de abertura de Caixa Fictício' }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.type(within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)'), '500,00')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar abertura' }))

    // ACT
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Recarregar' }))

    // ASSERT — o formulário passa a mostrar o que está gravado agora
    await waitFor(() => {
      expect(within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)')).toHaveValue('200,00')
    })
    expect(within(dialogo).getByLabelText('Dia da abertura (obrigatório)')).toHaveValue('2026-09-10')
    expect(within(dialogo).queryByRole('button', { name: 'Recarregar' })).not.toBeInTheDocument()
  })

  it('deve salvar de novo com a versão RECARREGADA depois do conflito', async () => {
    // ARRANGE — o primeiro PUT volta em conflito; o segundo, com a versão nova, grava
    const registro = comServidor()
    const versoesEnviadas: Array<string | null> = []
    let conflitou = false
    servidor.use(
      msw.put('/api/contas/:id/saldo-de-abertura', ({ request }) => {
        versoesEnviadas.push(request.headers.get('If-Match'))
        if (!conflitou) {
          conflitou = true
          return HttpResponse.json({ message: 'Conflito de versão.' }, { status: 409 })
        }
        return HttpResponse.json({ id: 1, updated_at: '2026-09-25T13:00:00.000000Z' })
      }),
      msw.get('/api/contas/saldos', () => {
        registro.consultasDeSaldo += 1
        return HttpResponse.json(
          saldos(conflitou ? [{ ...CAIXA, saldo_inicial: '200.00', saldo_inicial_em: '2026-09-10', updated_at: 'nova' }, BANCO] : [CAIXA, BANCO]),
        )
      }),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_ACERTA_A_ABERTURA)
    await usuario.click(await screen.findByRole('button', { name: 'Definir saldo de abertura de Caixa Fictício' }))
    const dialogo = await screen.findByRole('alertdialog')
    const valor = within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)')
    await usuario.type(valor, '500,00')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar abertura' }))
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Recarregar' }))
    await waitFor(() => {
      expect(within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)')).toHaveValue('200,00')
    })

    // ACT — a pessoa reaplica a alteração sobre a versão atual
    const recarregado = within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)')
    await usuario.clear(recarregado)
    await usuario.type(recarregado, '300,00')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar abertura' }))

    // ASSERT — o segundo PUT leva a versão RECARREGADA, não a da primeira leitura
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(versoesEnviadas).toEqual([VERSAO_DO_CAIXA, 'nova'])
  })

  it('deve dizer dentro do diálogo quando o "Recarregar" falha', async () => {
    // ARRANGE — o conflito, e a releitura recusada
    comServidor()
    let conflitou = false
    servidor.use(
      msw.put('/api/contas/:id/saldo-de-abertura', () => {
        conflitou = true
        return HttpResponse.json({ message: 'Conflito de versão.' }, { status: 409 })
      }),
      msw.get('/api/contas/saldos', () =>
        conflitou ? HttpResponse.json({ message: 'Sem permissão.' }, { status: 403 }) : HttpResponse.json(saldos()),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_ACERTA_A_ABERTURA)
    await usuario.click(await screen.findByRole('button', { name: 'Definir saldo de abertura de Caixa Fictício' }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.type(within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)'), '500,00')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar abertura' }))

    // ACT
    await usuario.click(await within(dialogo).findByRole('button', { name: 'Recarregar' }))

    // ASSERT — a falha fica ao lado do botão que falhou, e o que foi digitado continua lá
    expect(await within(dialogo).findByText('Não foi possível recarregar a conta. Tente de novo em instantes.')).toBeInTheDocument()
    expect(within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)')).toHaveValue('500,00')
    expect(within(dialogo).getByRole('button', { name: 'Recarregar' })).toBeInTheDocument()
  })

  it('deve não ter violações axe no diálogo com a recusa no campo', async () => {
    // ARRANGE
    comServidor()
    servidor.use(
      msw.put('/api/contas/:id/saldo-de-abertura', () =>
        HttpResponse.json(
          { message: 'O valor deve ter no máximo duas casas.', errors: { saldo_inicial: ['O valor deve ter no máximo duas casas.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(QUEM_ACERTA_A_ABERTURA)
    await usuario.click(await screen.findByRole('button', { name: 'Definir saldo de abertura de Caixa Fictício' }))
    const dialogo = await screen.findByRole('alertdialog')
    const valor = within(dialogo).getByLabelText('Valor no início desse dia (R$) (obrigatório)')
    await usuario.type(valor, '10,999')

    // ACT
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar abertura' }))
    await waitFor(() => {
      expect(valor).toHaveAttribute('aria-invalid', 'true')
    })

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve não ter violações axe no diálogo da abertura', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_ACERTA_A_ABERTURA)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Definir saldo de abertura de Caixa Fictício' }))
    await screen.findByRole('alertdialog')

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
