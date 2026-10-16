import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * O nome acessível da tabela é a `<caption>` sr-only: "N regra(s) de limite", e ela
 * CONCORDA EM NÚMERO desde a change `cadastros-financeiros-tela`.
 *
 * Ancorado (`^…$`) e exigindo a CONTAGEM de propósito: a primeira tentativa afrouxou o
 * matcher para `/regras? de limite/i`, e isso apagou o único detector do singular — dava
 * para desfazer o conserto inteiro com os 1541 testes verdes (achado CR3-01 do gate). O
 * teste que fixa o singular por tela vive em `pagina-tipos-pagamento.test.tsx`; aqui o
 * papel é só não deixar a identidade da tabela virar um matcher que casa com qualquer coisa.
 */
const NOME_DA_TABELA_DE_REGRAS = /^\d+ regras? de limite$/


import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaConvenio } from '@/paginas/pagina-convenio'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Convenio, RegraLimiteConvenio } from '@/tipos'

expect.extend(toHaveNoViolations)

const CONVENIO: Convenio = {
  id: 1,
  updated_at: '2026-07-15T10:00:00.000000Z',
  nome: 'Convênio Fictício',
  registro_ans: null,
  codigo_operadora: null,
  versao_tiss: null,
  guia_sequencial: false,
  alerta_agend_mesmo_dia: false,
  flags_tiss_json: null,
  particular: false,
  pedido_validade_meses: 6,
  ciclo_dia_corte: 15,
  ciclo_tipo_corte: 'dia_fixo',
  ativo: true,
}

/** Regras no shape EXATO do contrato — a grade real da clínica entra como DADO. */
function regra(sobrescritas: Partial<RegraLimiteConvenio> = {}): RegraLimiteConvenio {
  return {
    id: 1,
    // o serializer do back manda o dono da regra — o mock espelha o payload REAL
    convenio_id: 1,
    especialidade_id: null,
    especialidade: null,
    periodo: 'dia',
    limite: 8,
    acao: 'bloquear',
    updated_at: '2026-07-15T10:00:00.000000Z',
    ...sobrescritas,
  }
}

function renderizar(permissoes: string[] = ['convenios.ver', 'convenios.editar']) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/convenios/1']}>
          <Routes>
            <Route path="/convenios/:id" element={<PaginaConvenio />} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  servidor.use(
    msw.get('/api/convenios/:id', () => HttpResponse.json(CONVENIO)),
    msw.get('/api/convenios/:id/servicos', () => HttpResponse.json([])),
    msw.get('/api/convenios/:id/regras', () => HttpResponse.json([regra()])),
    msw.get('/api/especialidades', () =>
      HttpResponse.json([
        {
          id: 1,
          nome: 'Fonoaudiologia',
          cor: '#A85550',
          tempo_sessao: 40,
          exige_termo: false,
          oculta_agendamento_online: false,
          updated_at: '2026-07-15T10:00:00.000000Z',
        },
      ]),
    ),
  )
})

describe('Convênio — regras de limite são DADO gerido na página (§13)', () => {
  it('deve listar as regras com especialidade, período, limite e ação', async () => {
    // ARRANGE — "todas as especialidades" (null) e uma específica, no mesmo convênio
    servidor.use(
      msw.get('/api/convenios/:id/regras', () =>
        HttpResponse.json([
          regra(),
          regra({
            id: 2,
            especialidade_id: 1,
            especialidade: { id: 1, nome: 'Fonoaudiologia' },
            periodo: 'mes',
            limite: 4,
            acao: 'avisar',
          }),
        ]),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — legível para o balcão: quem, quanto, quando e o que acontece
    const tabela = await screen.findByRole('table', { name: NOME_DA_TABELA_DE_REGRAS })
    expect(tabela).toHaveTextContent('Todas as especialidades')
    expect(tabela).toHaveTextContent('8 por dia')
    expect(tabela).toHaveTextContent('Bloquear o agendamento')
    expect(tabela).toHaveTextContent('Fonoaudiologia')
    expect(tabela).toHaveTextContent('4 por mês')
    expect(tabela).toHaveTextContent('Avisar e deixar marcar')
  })

  it('deve criar a regra com o payload real ("todas" vira especialidade_id null)', async () => {
    // ARRANGE
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/convenios/:id/regras', () => HttpResponse.json([])),
      msw.post('/api/convenios/:id/regras', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(regra({ periodo: 'mes', limite: 4, acao: 'avisar' }), {
          status: 201,
        })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT — especialidade fica em "Todas"; período/ação são selects de domínio fechado
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar regra de limite/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Período/i }), 'mes')
    await usuario.type(within(dialog).getByRole('spinbutton', { name: /Limite de sessões/i }), '4')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Ação/i }), 'avisar')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — o shape do contrato, cru
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toEqual({ especialidade_id: null, periodo: 'mes', limite: 4, acao: 'avisar' })
  })

  it('deve fechar o domínio dos selects de período e ação', async () => {
    // ARRANGE — domínio FECHADO (D1): nada de "quinzena" nem de ação inventada; o
    // select só oferece o que o banco aceita (o servidor recusa o resto com 422)
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar regra de limite/i }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    const periodo = within(dialog).getByRole('combobox', { name: /Período/i })
    expect(within(periodo).getAllByRole('option').map((opcao) => opcao.textContent)).toEqual([
      'Selecione…',
      'Por dia',
      'Por semana',
      'Por mês',
    ])
    const acao = within(dialog).getByRole('combobox', { name: /Ação/i })
    expect(within(acao).getAllByRole('option').map((opcao) => opcao.textContent)).toEqual([
      'Selecione…',
      'Bloquear o agendamento',
      'Avisar e deixar marcar',
    ])
  })

  it('deve esconder TODA afordância de escrita de quem não tem convenios.editar', async () => {
    // ARRANGE + ACT — a regra é gerida INTEIRA sob `convenios.editar` (delta spec):
    // sem ela, a tabela é leitura — nem Cadastrar, nem Editar, nem Excluir
    renderizar(['convenios.ver'])
    await screen.findByRole('table', { name: NOME_DA_TABELA_DE_REGRAS })

    // ASSERT
    expect(
      screen.queryByRole('button', { name: /Cadastrar regra de limite/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
    // a leitura permanece — quem pode ver o convênio vê a regra que vale na agenda
    expect(screen.getByRole('table', { name: NOME_DA_TABELA_DE_REGRAS })).toHaveTextContent('8 por dia')
  })

  it('deve editar a regra preservando a especialidade e enviando o payload real', async () => {
    // ARRANGE
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/convenios/:id/regras', () =>
        HttpResponse.json([
          regra({
            especialidade_id: 1,
            especialidade: { id: 1, nome: 'Fonoaudiologia' },
          }),
        ]),
      ),
      msw.put('/api/convenios/:id/regras/:regraId', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(regra({ limite: 6 }))
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT — muda SÓ o limite
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const limite = within(dialog).getByRole('spinbutton', { name: /Limite de sessões/i })
    await usuario.clear(limite)
    await usuario.type(limite, '6')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT — a especialidade da regra vai INTACTA, não um null inventado
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toEqual({ especialidade_id: 1, periodo: 'dia', limite: 6, acao: 'bloquear' })
  })

  it('deve excluir com confirmação que NOMEIA a regra e diz a consequência', async () => {
    // ARRANGE
    let excluiu = false
    servidor.use(
      msw.delete('/api/convenios/:id/regras/:regraId', () => {
        excluiu = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Excluir' }))
    const confirmacao = await screen.findByRole('alertdialog')

    // ASSERT — o alvo pelo nome (§2), e a consequência REAL na agenda
    expect(confirmacao).toHaveTextContent('Excluir 8 por dia — todas as especialidades?')
    expect(confirmacao).toHaveTextContent('a agenda deixa de conferir este limite')

    // ACT — confirmar exclui de fato
    await usuario.click(within(confirmacao).getByRole('button', { name: /Excluir regra de limite/i }))
    await waitFor(() => {
      expect(excluiu).toBe(true)
    })
  })
})

describe('Convênio — hierarquia de headings e acessibilidade (A11Y-LP-01/02)', () => {
  it('deve ter UM h1 (o convênio) com as duas seções como h2', async () => {
    // ARRANGE — a página monta DUAS TelaDeCatalogo. Com o `h1` cravado no
    // `CabecalhoDeCadastro`, a rota passou a ter dois `h1`: quem navega por headings
    // perde a noção do que é a página e do que é seção dentro dela (1.3.1 / 2.4.6).
    renderizar()

    // ACT
    await screen.findByRole('table', { name: NOME_DA_TABELA_DE_REGRAS })

    // ASSERT — um h1 só, e é o nome do convênio; as seções ficam abaixo dele
    const titulos = screen.getAllByRole('heading', { level: 1 })
    expect(titulos).toHaveLength(1)
    expect(titulos[0]).toHaveTextContent('Convênio Fictício')
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((titulo) => titulo.textContent),
    ).toEqual(['Tabela de serviços', 'Regras de limite'])
  })

  it('deve não ter violações axe com o diálogo de regras ABERTO', async () => {
    // ARRANGE — o diálogo é o estado novo desta change, e é onde os campos vivem.
    // A varredura é no `document.body` porque o AlertDialog do Radix vai para um
    // Portal: passar só o `container` do render auditaria a página SEM o diálogo.
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar regra de limite/i }))
    await screen.findByRole('alertdialog')
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})

// ── Código do procedimento da operadora (change codigo-do-procedimento-no-servico) ──────────
describe('Convênio — código do procedimento na tabela de serviços', () => {
  /** Serviço no shape do contrato (o back devolve `codigo_procedimento`, nullable). */
  function servico(sobrescritas: Record<string, unknown> = {}) {
    return {
      id: 1,
      convenio_id: 1,
      procedimento: 'Sessão de Fonoaudiologia',
      codigo_procedimento: '50000470',
      valor: '150.00',
      updated_at: '2026-07-15T10:00:00.000000Z',
      ...sobrescritas,
    }
  }

  it('deve listar o código antes do procedimento, com travessão quando não há', async () => {
    // ARRANGE — é como a clínica lê a tabela da operadora: código → descrição → valor
    servidor.use(
      msw.get('/api/convenios/:id/servicos', () =>
        HttpResponse.json([servico(), servico({ id: 2, procedimento: 'Sessão avulsa', codigo_procedimento: null })]),
      ),
    )

    // ACT
    renderizar(['convenios.ver', 'servicos.ver'])

    // ASSERT
    expect(await screen.findByRole('columnheader', { name: 'Código' })).toBeInTheDocument()
    expect(await screen.findByText('50000470')).toBeInTheDocument()
    const linhaSemCodigo = (await screen.findByText('Sessão avulsa')).closest('tr')
    expect(within(linhaSemCodigo as HTMLElement).getByText('—')).toBeInTheDocument()
  })

  it('deve cadastrar o serviço enviando o código digitado', async () => {
    // ARRANGE
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/convenios/:id/servicos', () => HttpResponse.json([])),
      msw.post('/api/convenios/:id/servicos', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(servico(), { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar(['convenios.ver', 'servicos.ver', 'servicos.criar'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar serviço/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Procedimento/i }), 'Sessão de Fonoaudiologia')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Código do procedimento/i }), ' 50000470 ')
    await usuario.type(within(dialog).getByRole('spinbutton', { name: /Valor/i }), '150')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — o código vai aparado; o resto do contrato intacto
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toEqual({
      procedimento: 'Sessão de Fonoaudiologia',
      codigo_procedimento: '50000470',
      valor: 150,
    })
  })

  it('deve enviar null quando o código fica em branco (ausência, nunca string vazia)', async () => {
    // ARRANGE
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/convenios/:id/servicos', () => HttpResponse.json([])),
      msw.post('/api/convenios/:id/servicos', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(servico({ codigo_procedimento: null }), { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar(['convenios.ver', 'servicos.ver', 'servicos.criar'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar serviço/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /^Procedimento/i }), 'Sessão avulsa')
    await usuario.type(within(dialog).getByRole('spinbutton', { name: /Valor/i }), '100')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toHaveProperty('codigo_procedimento', null)
  })
})
