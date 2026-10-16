import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { DialogoFaturarSessao } from '@/componentes/agenda/dialogo-faturar-sessao'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CardAgendamento } from '@/tipos'

expect.extend(toHaveNoViolations)

// Dados FICTÍCIOS (LGPD — nunca paciente real).
const CARD: CardAgendamento = {
  id: 42,
  updated_at: '2026-07-15T10:00:00.000000Z',
  tipo: 'atendimento',
  profissional_id: 7,
  paciente_id: 3,
  tratamento_id: 9,
  status_id: 1,
  inicio: '2026-07-16 14:00',
  fim: '2026-07-16 14:40',
  duracao_minutos: 40,
  is_reposicao: false,
  paciente: { id: 3, nome: 'Paciente Fictício', nome_social: null },
  especialidade: { id: 2, nome: 'Fonoaudiologia', cor: '#448247' },
  status: { id: 1, nome: 'Em Aberto', cor: '#64748B', cor_borda: null, tipo: 'circle-dashed' },
  profissional: { id: 7, nome: 'Profissional Fictício' },
  sala: { id: 5, nome: 'Sala 3' },
  tratamento_saldo: 8,
  tratamento_total: 30,
  tratamento_realce: 'nenhum',
  convenio: { id: 1, nome: 'Particular Fictício', particular: true },
}

const CONTAS = [{ id: 3, nome: 'Caixa da recepção' }]
const CATEGORIAS = [
  { id: 1, nome: 'Atendimentos', tipo: 'receita', subcategorias: [{ id: 11, nome: 'Sessão avulsa' }] },
  { id: 2, nome: 'Aluguel', tipo: 'despesa', subcategorias: [] },
]
const TIPOS_PAGAMENTO = [{ id: 2, nome: 'Pix' }]

function comCatalogos(): void {
  servidor.use(
    msw.get('/api/contas', () => HttpResponse.json(CONTAS)),
    msw.get('/api/categorias', () => HttpResponse.json(CATEGORIAS)),
    msw.get('/api/tipos-pagamento', () => HttpResponse.json(TIPOS_PAGAMENTO)),
  )
}

function renderDialogo(props: { aoFechar?: () => void } = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProvedorToast>
          <DialogoFaturarSessao aberto card={CARD} aoFechar={props.aoFechar ?? (() => {})} />
        </ProvedorToast>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * Preenche os três obrigatórios (categoria de receita, forma de pagamento, conta). Espera a
 * OPÇÃO chegar — o select existe antes de o catálogo responder, e escolher nele vazio falha.
 */
async function preencherObrigatorios(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('option', { name: 'Atendimentos' })
  await screen.findByRole('option', { name: 'Pix' })
  await screen.findByRole('option', { name: 'Caixa da recepção' })
  await usuario.selectOptions(screen.getByLabelText(/^Categoria/), '1')
  await usuario.selectOptions(screen.getByLabelText(/^Forma de pagamento/), '2')
  await usuario.selectOptions(screen.getByLabelText(/^Conta/), '3')
}

beforeEach(() => {
  // os catálogos ficam em cache (TEMPO_CATALOGO_MS): cada teste parte do zero
  queryClient.clear()
})

describe('DialogoFaturarSessao — faturar a sessão pela agenda', () => {
  it('deve pedir só categoria de receita, forma de pagamento e conta, sem campo de valor', async () => {
    // ARRANGE
    comCatalogos()

    // ACT
    renderDialogo()

    // ASSERT
    expect(await screen.findByRole('dialog', { name: 'Faturar sessão' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Valor/)).not.toBeInTheDocument()
    // a categoria de DESPESA não é oferecida (a API a recusa no faturamento)
    const categoria = await screen.findByLabelText(/^Categoria/)
    expect(categoria).toContainHTML('Atendimentos')
    expect(categoria).not.toContainHTML('Aluguel')
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve enviar o faturamento sem valor e anunciar o valor lançado com atalho para o financeiro', async () => {
    // ARRANGE
    comCatalogos()
    let corpoRecebido: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/agendamentos/42/faturamento', async ({ request }) => {
        corpoRecebido = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          { id: 900, tipo: 'receita', valor: '150.00', desconto: '0.00', liquido: '150.00', agendamento_id: 42 },
          { status: 201 },
        )
      }),
    )
    const usuario = userEvent.setup()
    renderDialogo()

    // ACT
    await preencherObrigatorios(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Faturar' }))

    // ASSERT — o toast repete o anúncio; o que interessa é o que está DENTRO do diálogo
    const dialogo = await screen.findByRole('dialog', { name: 'Sessão faturada' })
    expect(within(dialogo).getByText(/Lançado no financeiro/)).toHaveTextContent('R$ 150,00')
    expect(within(dialogo).getByRole('link', { name: 'Ver no financeiro' })).toHaveAttribute('href', '/financeiro')
    expect(corpoRecebido).toEqual({ categoria_id: 1, tipo_pagamento_id: 2, conta_id: 3 })
    expect(corpoRecebido).not.toHaveProperty('valor')
  })

  it('deve mostrar o motivo do servidor quando a sessão não foi consumida, sem criar nada', async () => {
    // ARRANGE — a chave `agendamento_id` NÃO é campo do diálogo: precisa pousar no aviso geral
    comCatalogos()
    servidor.use(
      msw.post('/api/agendamentos/42/faturamento', () =>
        HttpResponse.json(
          {
            message: 'Os dados fornecidos são inválidos.',
            errors: { agendamento_id: ['Só atendimento com sessão consumida é faturável.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderDialogo()

    // ACT
    await preencherObrigatorios(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Faturar' }))

    // ASSERT — a mensagem aparece onde a pessoa está olhando (dentro do diálogo), não só no toast
    const dialogo = screen.getByRole('dialog', { name: 'Faturar sessão' })
    expect(
      await within(dialogo).findByText('Só atendimento com sessão consumida é faturável.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Sessão faturada' })).not.toBeInTheDocument()
  })

  it('deve pousar a recusa de categoria no próprio campo', async () => {
    // ARRANGE
    comCatalogos()
    servidor.use(
      msw.post('/api/agendamentos/42/faturamento', () =>
        HttpResponse.json(
          { message: 'Inválido.', errors: { categoria_id: ['Categoria inválida (o faturamento exige categoria de receita da clínica).'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderDialogo()

    // ACT
    await preencherObrigatorios(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Faturar' }))

    // ASSERT
    const dialogo = screen.getByRole('dialog', { name: 'Faturar sessão' })
    const categoria = await within(dialogo).findByLabelText(/^Categoria/)
    await waitFor(() => {
      expect(categoria).toHaveAttribute('aria-invalid', 'true')
    })
    expect(within(dialogo).getByText(/Categoria inválida/)).toBeInTheDocument()
  })

  it('deve mostrar aviso de permissão ou escopo no 403', async () => {
    // ARRANGE — SEC-VP-13: o profissional escopado não fatura a sessão de outro
    comCatalogos()
    servidor.use(
      msw.post('/api/agendamentos/42/faturamento', () =>
        HttpResponse.json({ message: 'This action is unauthorized.' }, { status: 403 }),
      ),
    )
    const usuario = userEvent.setup()
    renderDialogo()

    // ACT
    await preencherObrigatorios(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Faturar' }))

    // ASSERT
    expect(
      await screen.findByText('Você não tem permissão para faturar este atendimento — ou ele é de outro profissional.'),
    ).toBeInTheDocument()
  })

  it('deve avisar quando os catálogos do financeiro não estão acessíveis, em vez de nascer mudo', async () => {
    // ARRANGE — `lancamentos.criar` sem `contas.ver`: a API responde 403 nos catálogos
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json({ message: 'Forbidden' }, { status: 403 })),
      msw.get('/api/categorias', () => HttpResponse.json(CATEGORIAS)),
      msw.get('/api/tipos-pagamento', () => HttpResponse.json(TIPOS_PAGAMENTO)),
    )

    // ACT
    renderDialogo()

    // ASSERT
    expect(
      await screen.findByText(/Não foi possível carregar contas, categorias ou formas de pagamento/),
    ).toBeInTheDocument()
  })

  it('deve avisar o pai ao cancelar', async () => {
    // ARRANGE
    comCatalogos()
    let fechou = false
    const usuario = userEvent.setup()
    renderDialogo({
      aoFechar: () => {
        fechou = true
      },
    })
    await screen.findByRole('dialog', { name: 'Faturar sessão' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))

    // ASSERT
    expect(fechou).toBe(true)
  })
})

describe('Faturar sessão — catálogo VAZIO não é catálogo com erro', () => {
  /** 200 com lista vazia: o estado real de uma clínica que nunca cadastrou nada. */
  function semCatalogos(sobrescritas: Partial<Record<'contas' | 'categorias' | 'tipos', unknown[]>> = {}) {
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json(sobrescritas.contas ?? [])),
      msw.get('/api/categorias', () => HttpResponse.json(sobrescritas.categorias ?? [])),
      msw.get('/api/tipos-pagamento', () => HttpResponse.json(sobrescritas.tipos ?? [])),
    )
  }

  it('deve apontar o cadastro e travar o Faturar quando falta catálogo', async () => {
    // ARRANGE
    semCatalogos()
    useAuthStore.setState({
      usuario: {
        ...usuarioFicticio,
        permissoes: [
          'agenda.ver',
          'lancamentos.criar',
          'contas.ver',
          'contas.criar',
          'tipos_pagamento.ver',
          'tipos_pagamento.criar',
        ],
      },
      carregandoSessao: false,
    })

    // ACT
    renderDialogo()

    // ASSERT
    expect(await screen.findByText('Nenhuma conta cadastrada.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cadastros › Contas/ })).toHaveAttribute(
      'href',
      '/contas',
    )
    expect(screen.getByRole('button', { name: 'Faturar' })).toBeDisabled()
  })

  it('deve reconhecer que só falta categoria de RECEITA', async () => {
    // ARRANGE — há categoria de despesa; faturamento é receita e a API recusa o resto
    semCatalogos({
      contas: CONTAS,
      categorias: [{ id: 2, nome: 'Aluguel', tipo: 'despesa', subcategorias: [] }],
      tipos: TIPOS_PAGAMENTO,
    })
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver', 'lancamentos.criar'] },
      carregandoSessao: false,
    })

    // ACT
    renderDialogo()

    // ASSERT
    // regex: sem permissão de cadastrar, a frase e o "peça a quem administra" moram no
    // mesmo parágrafo, e o matcher exato compara o texto inteiro
    expect(await screen.findByText(/Nenhuma categoria de receita cadastrada\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Faturar' })).toBeDisabled()
  })

  it('deve fechar o diálogo ao seguir o atalho do cadastro', async () => {
    // ARRANGE — sair da rota com o diálogo aberto deixaria um modal órfão sobre a agenda
    semCatalogos({ categorias: CATEGORIAS, tipos: TIPOS_PAGAMENTO })
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver', 'lancamentos.criar', 'contas.ver', 'contas.criar'] },
      carregandoSessao: false,
    })
    let fechou = false
    const usuario = userEvent.setup()
    renderDialogo({ aoFechar: () => (fechou = true) })

    // ACT
    await usuario.click(await screen.findByRole('link', { name: /Cadastros › Contas/ }))

    // ASSERT
    expect(fechou).toBe(true)
  })

  it('deve liberar o Faturar quando os catálogos têm o que escolher', async () => {
    // ARRANGE
    comCatalogos()
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver', 'lancamentos.criar'] },
      carregandoSessao: false,
    })

    // ACT
    renderDialogo()

    // ASSERT
    await screen.findByRole('option', { name: 'Atendimentos' })
    expect(screen.getByRole('button', { name: 'Faturar' })).toBeEnabled()
  })
})
