import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EXPLICACAO_DA_TRANSFERENCIA,
  RAZAO_DAS_CONTAS_IGUAIS,
} from '@/componentes/financeiro/dialogo-transferencia'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaFinanceiro } from '@/paginas/pagina-financeiro'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Transferencia } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * Transferir entre contas (change `caixa-do-dia-a-dia`, design D7): o depósito da gaveta no banco.
 * Criar pelo cabeçalho do Financeiro; editar e excluir pela linha do Fluxo de caixa. Dados FICTÍCIOS.
 */

const VERSAO = '2026-09-25T12:00:00.000000Z'

const DEPOSITO: Transferencia = {
  id: 7,
  conta_origem_id: 1,
  conta_destino_id: 2,
  valor: '2000.00',
  data: '2026-09-24',
  obs: 'Depósito da gaveta',
  updated_at: VERSAO,
}

const QUEM_VE_O_FLUXO = ['lancamentos.ver', 'fluxo_caixa.ver']
const QUEM_TRANSFERE = [
  ...QUEM_VE_O_FLUXO,
  // o diálogo lista as contas: sem vê-las, nem o botão aparece (SEC-CDD-02)
  'contas.ver',
  'transferencias.ver',
  'transferencias.criar',
  'transferencias.editar',
  'transferencias.excluir',
]

function extrato(valor: string) {
  return {
    de: '2026-09-01',
    ate: '2026-09-25',
    conta_id: null,
    saldo_anterior: '0.00',
    movimentos: [
      {
        movimento: 'transferencia',
        transferencia_id: DEPOSITO.id,
        conta_origem_id: 1,
        conta_destino_id: 2,
        valor,
        data: DEPOSITO.data,
        // sem conta, a transferência não muda o saldo da clínica (change `saldo-das-contas`)
        saldo: '0.00',
      },
    ],
    totais: { entradas: '0.00', saidas: '0.00', saldo_do_periodo: '0.00', transferido: valor },
  }
}

interface Registro {
  consultasDoFluxo: number
  envios: Array<{ metodo: string; corpo: Record<string, unknown> | null; versao: string | null }>
}

interface ContaDoServidor {
  id: number
  nome: string
  ativo: boolean
}

const DUAS_CONTAS: ContaDoServidor[] = [
  { id: 1, nome: 'Caixa', ativo: true },
  { id: 2, nome: 'Banco Fictício', ativo: true },
]

/** Um servidor com o fluxo, as contas e a transferência — com estado, como o de verdade. */
function comServidor(contas: ContaDoServidor[] = DUAS_CONTAS): Registro {
  const registro: Registro = { consultasDoFluxo: 0, envios: [] }
  let atual: Transferencia | null = DEPOSITO

  servidor.use(
    msw.get('/api/contas', () => HttpResponse.json(contas)),
    msw.get('/api/lancamentos', () =>
      HttpResponse.json({ data: [], current_page: 1, last_page: 1, per_page: 50, total: 0 }),
    ),
    msw.get('/api/fluxo-caixa', () => {
      registro.consultasDoFluxo += 1
      return HttpResponse.json(
        atual === null ? { ...extrato('0.00'), movimentos: [] } : extrato(atual.valor),
      )
    }),
    msw.get('/api/transferencias/:id', () => HttpResponse.json(atual)),
    msw.post('/api/transferencias', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      registro.envios.push({ metodo: 'POST', corpo, versao: null })
      return HttpResponse.json({ ...DEPOSITO, ...corpo, id: 8 }, { status: 201 })
    }),
    msw.put('/api/transferencias/:id', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      registro.envios.push({ metodo: 'PUT', corpo, versao: request.headers.get('If-Match') })
      atual = { ...DEPOSITO, ...corpo, updated_at: '2026-09-25T13:00:00.000000Z' } as Transferencia
      return HttpResponse.json(atual)
    }),
    msw.delete('/api/transferencias/:id', () => {
      registro.envios.push({ metodo: 'DELETE', corpo: null, versao: null })
      atual = null
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return registro
}

function renderizar(permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/financeiro']}>
          <PaginaFinanceiro />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** Abre a aba do Fluxo de caixa e espera a linha da transferência. */
async function abrirFluxo(usuario: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await usuario.click(screen.getByRole('tab', { name: 'Fluxo de caixa' }))
  const celula = await screen.findByRole('cell', { name: 'Caixa → Banco Fictício' })
  return celula.closest('tr') as HTMLElement
}

beforeEach(() => {
  queryClient.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Transferir entre contas — o botão e o diálogo', () => {
  it('deve oferecer "Transferir entre contas" a quem pode criar transferência e ver as contas', () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(['lancamentos.ver', 'transferencias.criar', 'contas.ver'])

    // ASSERT
    expect(screen.getByRole('button', { name: 'Transferir entre contas' })).toBeInTheDocument()
  })

  it('deve não oferecer a transferência a quem cria mas não vê as contas (SEC-CDD-02)', () => {
    // ARRANGE — o diálogo abriria sem nenhuma conta para escolher e nunca deixaria salvar
    comServidor()

    // ACT
    renderizar(['lancamentos.ver', 'transferencias.criar'])

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Transferir entre contas' })).not.toBeInTheDocument()
  })

  it('deve não oferecer a transferência a quem não pode criá-la', () => {
    // ARRANGE
    comServidor()

    // ACT
    renderizar(QUEM_VE_O_FLUXO)

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Transferir entre contas' })).not.toBeInTheDocument()
  })

  it('deve pedir De, Para, Valor, Data e Observação, e explicar o que é transferência', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Transferir entre contas' }))

    // ASSERT
    const dialogo = await screen.findByRole('alertdialog', { name: 'Transferir entre contas' })
    expect(dialogo).toHaveAccessibleDescription(EXPLICACAO_DA_TRANSFERENCIA)
    expect(within(dialogo).getByLabelText('De (conta de origem) (obrigatório)')).toBeInTheDocument()
    expect(within(dialogo).getByLabelText('Para (conta de destino) (obrigatório)')).toBeInTheDocument()
    expect(within(dialogo).getByLabelText('Valor (R$) (obrigatório)')).toBeInTheDocument()
    expect(within(dialogo).getByLabelText('Observação')).toBeInTheDocument()
  })

  it('deve abrir com a data de hoje no fuso da CLÍNICA, não no do aparelho', async () => {
    // ARRANGE — 20h UTC de 25/09: ainda dia 25 no Brasil (e em UTC), já dia 26 num fuso 14h à
    // frente. Com o relógio FIXO, a prova não depende da hora em que a suíte roda: nas horas em
    // que os dois fusos caem no mesmo dia, um teste de relógio solto passaria sem provar nada
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-25T20:00:00Z'))
    comServidor()
    servidor.use(
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({ configuracoes: [{ chave: 'clinica.timezone', valor: 'Pacific/Kiritimati' }] }),
      ),
    )
    const usuario = userEvent.setup()
    renderizar([...QUEM_TRANSFERE, 'agenda.ver'])

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Transferir entre contas' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByLabelText('Data (obrigatório)')).toHaveValue('2026-09-26')
    })
  })
})

describe('Transferir entre contas — falta conta (o-sistema-avisa-o-que-falta)', () => {
  const SO_O_CAIXA: ContaDoServidor[] = [{ id: 1, nome: 'Caixa', ativo: true }]

  async function abrirTransferencia(usuario: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await usuario.click(screen.getByRole('button', { name: 'Transferir entre contas' }))
    return screen.findByRole('alertdialog', { name: 'Transferir entre contas' })
  }

  it('deve dizer que falta uma conta, citar o Caixa e levar ao cadastro, sem os campos', async () => {
    // ARRANGE — a clínica de 2026-10-02: só o Caixa
    comServidor(SO_O_CAIXA)
    const usuario = userEvent.setup()
    renderizar([...QUEM_TRANSFERE, 'contas.criar'])

    // ACT
    const dialogo = await abrirTransferencia(usuario)

    // ASSERT
    expect(await within(dialogo).findByRole('heading', { name: 'Falta uma conta para transferir' })).toBeInTheDocument()
    expect(within(dialogo).getByText(/só tem a conta “Caixa” ativa/)).toBeInTheDocument()
    // o motivo entra na descrição do diálogo — o leitor de tela o ouve ao abrir (A11Y-AVI-03)
    expect(dialogo).toHaveAccessibleDescription(/Falta uma conta para transferir/)
    const link = within(dialogo).getByRole('link', { name: 'Cadastrar conta' })
    expect(link).toHaveAttribute('href', '/contas')
    // o foco abre no TEXTO do aviso (não acionável): o leitor ouve o motivo, e um Enter não sai da tela (A11Y-AVI-R2-01)
    expect(within(dialogo).getByRole('heading', { name: 'Falta uma conta para transferir' }).parentElement).toHaveFocus()
    // a descrição traz o motivo, e não repete o nome do botão (A11Y-AVI-R2-02)
    expect(dialogo).not.toHaveAccessibleDescription(/Cadastrar conta/)
    expect(within(dialogo).queryByLabelText(/De \(conta de origem\)/)).not.toBeInTheDocument()
    expect(within(dialogo).queryByRole('button', { name: 'Transferir' })).not.toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
  })

  it('deve fechar o diálogo ao seguir o caminho para o cadastro', async () => {
    // ARRANGE
    comServidor(SO_O_CAIXA)
    const usuario = userEvent.setup()
    renderizar([...QUEM_TRANSFERE, 'contas.criar'])
    const dialogo = await abrirTransferencia(usuario)

    // ACT
    await usuario.click(await within(dialogo).findByRole('link', { name: 'Cadastrar conta' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('deve dizer a quem pedir, sem link, a quem não pode cadastrar conta', async () => {
    // ARRANGE — mandar a uma tela que responde 403 é pior que não mandar
    comServidor(SO_O_CAIXA)
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)

    // ACT
    const dialogo = await abrirTransferencia(usuario)

    // ASSERT
    expect(await within(dialogo).findByText('Peça a quem administra o sistema para cadastrar.')).toBeInTheDocument()
    expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve tratar uma ativa e uma inativa como uma conta só, e lembrar que a inativa se reativa', async () => {
    // ARRANGE
    comServidor([...SO_O_CAIXA, { id: 3, nome: 'Banco Antigo Fictício', ativo: false }])
    const usuario = userEvent.setup()
    renderizar([...QUEM_TRANSFERE, 'contas.editar'])

    // ACT
    const dialogo = await abrirTransferencia(usuario)

    // ASSERT
    expect(await within(dialogo).findByRole('heading', { name: 'Falta uma conta para transferir' })).toBeInTheDocument()
    expect(within(dialogo).getByText(/reative-a em Cadastros › Contas/)).toBeInTheDocument()
  })

  it('deve pedir a reativação a quem administra quando a pessoa não pode editar contas (CR-AVI-07)', async () => {
    // ARRANGE
    comServidor([...SO_O_CAIXA, { id: 3, nome: 'Banco Antigo Fictício', ativo: false }])
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)

    // ACT
    const dialogo = await abrirTransferencia(usuario)

    // ASSERT
    // um pedido só, no lugar do botão: dois "Peça a quem administra" seguidos (DQA-AVI-R2-02)
    expect(await within(dialogo).findByText('Peça a quem administra o sistema para reativá-la ou cadastrar outra conta.')).toBeInTheDocument()
    expect(within(dialogo).getAllByText(/peça a quem administra/i)).toHaveLength(1)
    expect(within(dialogo).queryByText(/reative-a em Cadastros › Contas/)).not.toBeInTheDocument()
    // sem botão, a frase de a quem pedir ENTRA na descrição do diálogo
    expect(dialogo).toHaveAccessibleDescription(/reativá-la ou cadastrar outra conta/)
  })

  it('deve esperar as contas com um esqueleto e levar o foco ao aviso quando ele chega (DQA-AVI-02, A11Y-AVI-R2-01)', async () => {
    // ARRANGE — a lista demora: o diálogo NÃO abre o formulário para trocá-lo depois
    comServidor(SO_O_CAIXA)
    let soltar: () => void = () => {}
    const segura = new Promise<void>((resolver) => {
      soltar = resolver
    })
    servidor.use(
      msw.get('/api/contas', async () => {
        await segura
        return HttpResponse.json(SO_O_CAIXA)
      }),
    )
    const usuario = userEvent.setup()
    renderizar([...QUEM_TRANSFERE, 'contas.criar'])

    // ACT
    const dialogo = await abrirTransferencia(usuario)

    // ASSERT — esperando: nem campos nem "Transferir" disponível
    expect(within(dialogo).getByText('Carregando as contas…')).toBeInTheDocument()
    expect(within(dialogo).queryByLabelText(/De \(conta de origem\)/)).not.toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Transferir' })).toBeDisabled()
    soltar()
    const titulo = await within(dialogo).findByRole('heading', { name: 'Falta uma conta para transferir' })
    await waitFor(() => {
      expect(titulo.parentElement).toHaveFocus()
    })
  })

  it('deve oferecer só as contas ativas numa transferência nova', async () => {
    // ARRANGE
    comServidor([...DUAS_CONTAS, { id: 3, nome: 'Banco Antigo Fictício', ativo: false }])
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)

    // ACT
    const dialogo = await abrirTransferencia(usuario)

    // ASSERT
    const origem = await within(dialogo).findByLabelText('De (conta de origem) (obrigatório)')
    await within(origem).findByRole('option', { name: 'Banco Fictício' })
    expect(within(origem).getByRole('option', { name: 'Caixa' })).toBeInTheDocument()
    expect(within(origem).queryByRole('option', { name: 'Banco Antigo Fictício' })).not.toBeInTheDocument()
  })

  it('deve manter a conta gravada ao editar, mesmo inativa', async () => {
    // ARRANGE — o banco do depósito foi desativado depois
    comServidor([{ id: 1, nome: 'Caixa', ativo: true }, { id: 2, nome: 'Banco Fictício', ativo: false }])
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)
    const linha = await abrirFluxo(usuario)

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Editar transferência' })

    // ASSERT — a edição não vira aviso nem perde o destino
    const destino = within(dialogo).getByLabelText('Para (conta de destino) (obrigatório)')
    await waitFor(() => {
      expect(destino).toHaveValue('2')
    })
    expect(within(dialogo).queryByRole('heading', { name: 'Falta uma conta para transferir' })).not.toBeInTheDocument()
  })

  it('deve abrir o diálogo com as mesmas requisições, com e sem o aviso (nenhuma requisição nova)', async () => {
    // ARRANGE — o aviso sai do que a tela já carrega (D6)
    async function requisicoesAoAbrir(contas: ContaDoServidor[]): Promise<string[]> {
      queryClient.clear()
      comServidor(contas)
      const usuario = userEvent.setup()
      const { unmount } = renderizar(QUEM_TRANSFERE)
      await screen.findByRole('button', { name: 'Transferir entre contas' })
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      const pedidas: string[] = []
      const anotar = ({ request }: { request: Request }): void => {
        pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
      }
      servidor.events.on('request:start', anotar)
      const dialogo = await abrirTransferencia(usuario)
      await within(dialogo).findByRole('button', { name: /Fechar|Cancelar/ })
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      servidor.events.removeListener('request:start', anotar)
      unmount()
      return pedidas.sort()
    }

    // ACT
    const comAviso = await requisicoesAoAbrir(SO_O_CAIXA)
    const semAviso = await requisicoesAoAbrir(DUAS_CONTAS)

    // ASSERT
    expect(comAviso).toEqual(semAviso)
  })

  it('deve passar no axe com o aviso, com e sem a permissão de cadastrar', async () => {
    for (const permissoes of [[...QUEM_TRANSFERE, 'contas.criar'], QUEM_TRANSFERE]) {
      // ARRANGE
      queryClient.clear()
      comServidor(SO_O_CAIXA)
      const usuario = userEvent.setup()
      const { unmount } = renderizar(permissoes)

      // ACT
      const dialogo = await abrirTransferencia(usuario)
      await within(dialogo).findByRole('heading', { name: 'Falta uma conta para transferir' })

      // ASSERT
      expect(await axe(dialogo)).toHaveNoViolations()
      unmount()
    }
  })
})

describe('Transferir entre contas — a mesma conta nos dois lados', () => {
  it('deve deixar "Transferir" indisponível e dizer por quê', async () => {
    // ARRANGE
    const registro = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)
    await usuario.click(screen.getByRole('button', { name: 'Transferir entre contas' }))
    await screen.findAllByRole('option', { name: 'Banco Fictício' })

    // ACT
    await usuario.selectOptions(screen.getByLabelText('De (conta de origem) (obrigatório)'), '1')
    await usuario.selectOptions(screen.getByLabelText('Para (conta de destino) (obrigatório)'), '1')

    // ASSERT — a razão é a mensagem do campo (anunciada), e o envio não sai
    expect(screen.getByRole('button', { name: 'Transferir' })).toBeDisabled()
    expect(screen.getByLabelText('Para (conta de destino) (obrigatório)')).toHaveAccessibleDescription(
      expect.stringContaining(RAZAO_DAS_CONTAS_IGUAIS),
    )
    expect(registro.envios).toHaveLength(0)
  })
})

describe('Transferir entre contas — registrar', () => {
  it('deve registrar a transferência e reconsultar o Fluxo de caixa', async () => {
    // ARRANGE — a recepção deposita a gaveta no banco
    const registro = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)
    await abrirFluxo(usuario)
    const consultasAntes = registro.consultasDoFluxo

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Transferir entre contas' }))
    await screen.findAllByRole('option', { name: 'Banco Fictício' })
    await usuario.selectOptions(screen.getByLabelText('De (conta de origem) (obrigatório)'), '1')
    await usuario.selectOptions(screen.getByLabelText('Para (conta de destino) (obrigatório)'), '2')
    await usuario.type(screen.getByLabelText('Valor (R$) (obrigatório)'), '2.000,00')
    fireEvent.change(screen.getByLabelText('Data (obrigatório)'), { target: { value: '2026-09-25' } })
    await usuario.click(screen.getByRole('button', { name: 'Transferir' }))

    // ASSERT
    await waitFor(() => {
      expect(registro.consultasDoFluxo).toBeGreaterThan(consultasAntes)
    })
    expect(registro.envios).toEqual([
      {
        metodo: 'POST',
        corpo: { conta_origem_id: 1, conta_destino_id: 2, valor: '2000.00', data: '2026-09-25', obs: null },
        versao: null,
      },
    ])
    expect(screen.queryByRole('alertdialog', { name: 'Transferir entre contas' })).not.toBeInTheDocument()
  })
})

describe('Transferir entre contas — editar e excluir pela linha do Fluxo', () => {
  it('deve editar lendo a transferência e mandando o If-Match da leitura', async () => {
    // ARRANGE
    const registro = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)
    const linha = await abrirFluxo(usuario)

    // ACT — o formulário traz a observação, que o extrato não tem
    await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Editar transferência' })
    expect(within(dialogo).getByLabelText('Observação')).toHaveValue('Depósito da gaveta')
    const valor = within(dialogo).getByLabelText('Valor (R$) (obrigatório)')
    expect(valor).toHaveValue('2000,00')
    await usuario.clear(valor)
    await usuario.type(valor, '2.500,00')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Salvar' }))

    // ASSERT — e o Fluxo mostra o valor novo
    expect(await screen.findByRole('cell', { name: 'R$ 2.500,00' })).toBeInTheDocument()
    expect(registro.envios).toEqual([
      {
        metodo: 'PUT',
        corpo: { conta_origem_id: 1, conta_destino_id: 2, valor: '2500.00', data: '2026-09-24', obs: 'Depósito da gaveta' },
        versao: VERSAO,
      },
    ])
  })

  it('deve excluir só depois de confirmar, dizendo o efeito, e reconsultar o Fluxo', async () => {
    // ARRANGE
    const registro = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)
    const linha = await abrirFluxo(usuario)

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))
    const confirmacao = await screen.findByRole('alertdialog', { name: 'Excluir a transferência de R$ 2.000,00?' })
    expect(within(confirmacao).getByText(/volta a constar na conta de origem/)).toBeInTheDocument()
    expect(registro.envios).toHaveLength(0)
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Excluir transferência' }))

    // ASSERT
    expect(await screen.findByText('Sem movimentos no período')).toBeInTheDocument()
    expect(registro.envios.map((envio) => envio.metodo)).toEqual(['DELETE'])
  })

  it('deve pousar o foco no início do painel quando a linha excluída leva o botão junto', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)
    const linha = await abrirFluxo(usuario)

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Excluir' }))
    await usuario.click(await screen.findByRole('button', { name: 'Excluir transferência' }))

    // ASSERT — o gatilho saiu da tela com a linha: o foco não pode cair no `body` (2.4.3)
    await waitFor(() => {
      expect(screen.getByLabelText('De')).toHaveFocus()
    })
  })

  it('deve mostrar os nomes das contas na linha da transferência', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_VE_O_FLUXO)

    // ACT
    const linha = await abrirFluxo(usuario)

    // ASSERT — "Conta 1 → 2" não dizia de onde para onde o dinheiro foi
    expect(within(linha).getByRole('cell', { name: 'Caixa → Banco Fictício' })).toBeInTheDocument()
  })

  it('deve esconder editar e excluir de quem só vê o fluxo', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_VE_O_FLUXO)

    // ACT
    const linha = await abrirFluxo(usuario)

    // ASSERT
    expect(within(linha).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(within(linha).queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Ações' })).not.toBeInTheDocument()
  })

  it('deve não oferecer Editar a quem edita e lê a transferência mas não vê as contas (SEC-CDD-02)', async () => {
    // ARRANGE — o diálogo de edição lista as contas; sem vê-las, abriria e nunca salvaria
    comServidor()
    const usuario = userEvent.setup()
    renderizar([...QUEM_VE_O_FLUXO, 'transferencias.ver', 'transferencias.editar', 'transferencias.excluir'])

    // ACT
    const linha = await abrirFluxo(usuario)

    // ASSERT — o Excluir não depende das contas e continua
    expect(within(linha).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(within(linha).getByRole('button', { name: 'Excluir' })).toBeInTheDocument()
  })

  it('deve reconsultar o Fluxo quando abrir a edição falha, para a linha sumida sair da tela (CR-CDD-07)', async () => {
    // ARRANGE — outra pessoa excluiu a transferência depois que o Fluxo carregou
    const registro = comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)
    const linha = await abrirFluxo(usuario)
    const consultasAntes = registro.consultasDoFluxo
    servidor.use(
      msw.get('/api/transferencias/:id', () => HttpResponse.json({ message: 'Não encontrado.' }, { status: 404 })),
      msw.get('/api/fluxo-caixa', () => {
        registro.consultasDoFluxo += 1
        return HttpResponse.json({ ...extrato('0.00'), movimentos: [] })
      }),
    )

    // ACT
    await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))

    // ASSERT — o aviso, e o extrato pedido de novo: a linha velha sai, o "Editar" que falharia sempre some
    expect(await screen.findByText('Não foi possível abrir a transferência. Tente de novo em instantes.')).toBeInTheDocument()
    await waitFor(() => {
      expect(registro.consultasDoFluxo).toBeGreaterThan(consultasAntes)
    })
    expect(await screen.findByText('Sem movimentos no período')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog', { name: 'Editar transferência' })).not.toBeInTheDocument()
  })

  it('deve não oferecer Editar a quem pode editar mas não pode ler a transferência', async () => {
    // ARRANGE — a edição lê pela rota própria, sob a permissão de ver: sem ela, seria só um 403
    comServidor()
    const usuario = userEvent.setup()
    renderizar([...QUEM_VE_O_FLUXO, 'transferencias.editar', 'transferencias.excluir'])

    // ACT
    const linha = await abrirFluxo(usuario)

    // ASSERT
    expect(within(linha).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(within(linha).getByRole('button', { name: 'Excluir' })).toBeInTheDocument()
  })
})

describe('Transferir entre contas — axe', () => {
  it('deve passar no axe no diálogo com a mesma conta nos dois lados', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    renderizar(QUEM_TRANSFERE)
    await usuario.click(screen.getByRole('button', { name: 'Transferir entre contas' }))
    await screen.findAllByRole('option', { name: 'Banco Fictício' })

    // ACT
    await usuario.selectOptions(screen.getByLabelText('De (conta de origem) (obrigatório)'), '2')
    await usuario.selectOptions(screen.getByLabelText('Para (conta de destino) (obrigatório)'), '2')

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve passar no axe no Fluxo com as ações da transferência', async () => {
    // ARRANGE
    comServidor()
    const usuario = userEvent.setup()
    const { container } = renderizar(QUEM_TRANSFERE)

    // ACT
    await abrirFluxo(usuario)

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})
