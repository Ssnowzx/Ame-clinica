import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { delay, HttpResponse, http as msw } from 'msw'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AVISO_SEM_PROFISSIONAL,
  CRIANCA_SEM_TRATAMENTO,
  RAZAO_DO_FATURAMENTO,
  RAZAO_DO_PAGO_SEM_BAIXA,
  SELO_DA_SUGESTAO,
} from '@/componentes/financeiro/campo-tratamento'
import { AVISO_DO_PAGO, AVISO_DO_PAGO_SEM_BAIXA } from '@/componentes/financeiro/resumo-do-lancamento-pago'
import { FormularioLancamento } from '@/componentes/financeiro/formulario-lancamento'
import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { SELECAO_FICTICIA } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Convenio, LancamentoCaixaDetalhe, PaginaDeApi, TratamentoDaLista } from '@/tipos'

expect.extend(toHaveNoViolations)

function lancamento(sobrescritas: Partial<LancamentoCaixaDetalhe> = {}): LancamentoCaixaDetalhe {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    tipo: 'receita',
    competencia: '2026-07-01',
    vencimento: '2026-07-10',
    categoria_id: 1,
    subcategoria_id: null,
    valor: '150.00',
    juros: '0.00',
    multa: '0.00',
    desconto: '0.00',
    liquido: '150.00',
    tipo_pagamento_id: 1,
    conta_id: 1,
    contabil: true,
    documento: null,
    agendamento_id: null,
    grupo_parcelamento: null,
    parcela: null,
    parcelas_total: null,
    pago_em: null,
    obs: null,
    // forma REAL do DETALHE: o servidor sempre manda o booleano e o vínculo no `show`
    em_ciclo_fechado: false,
    tratamento_id: null,
    // a última cobrança pelo WhatsApp também vem SEMPRE no `show` (change `cobranca-pelo-whatsapp`)
    ultima_cobranca: null,
    ...sobrescritas,
  }
}

function mockCatalogos() {
  servidor.use(
    msw.get('/api/contas', () => HttpResponse.json([{ id: 1, nome: 'Caixa', ativo: true }])),
    msw.get('/api/categorias', () =>
      HttpResponse.json([{ id: 1, nome: 'Sessões', tipo: 'receita', subcategorias: [] }]),
    ),
    msw.get('/api/tipos-pagamento', () => HttpResponse.json([{ id: 1, nome: 'PIX' }])),
  )
}

function renderizar(
  lanc: LancamentoCaixaDetalhe | null,
  permissoes: string[] = ['lancamentos.ver', 'lancamentos.criar'],
  aoFechar: () => void = () => undefined,
) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <FormularioLancamento lancamento={lanc} aoFechar={aoFechar} />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Formulário de lançamento — parcelamento só na criação', () => {
  it('deve oferecer o campo Parcelas ao criar', () => {
    // ARRANGE + ACT
    mockCatalogos()
    renderizar(null)

    // ASSERT
    expect(screen.getByLabelText('Parcelas')).toBeInTheDocument()
  })

  it('deve NÃO oferecer Parcelas ao editar (a API o recusa no PUT)', () => {
    // ARRANGE + ACT — parcelamento é materializado na criação (D4)
    mockCatalogos()
    renderizar(lancamento())

    // ASSERT
    expect(screen.queryByLabelText('Parcelas')).not.toBeInTheDocument()
  })
})

describe('Formulário de lançamento — catálogo negado não fica mudo', () => {
  it('deve avisar quando um catálogo falha (403 por falta de permissão), não deixar select vazio mudo', async () => {
    // ARRANGE — contas.ver ausente: a API responde 403; sem aviso, o form nasceria morto
    servidor.use(
      msw.get('/api/contas', () => new HttpResponse(null, { status: 403 })),
      msw.get('/api/categorias', () => HttpResponse.json([])),
      msw.get('/api/tipos-pagamento', () => HttpResponse.json([])),
    )

    // ACT
    renderizar(null)

    // ASSERT
    expect(
      await screen.findByText(/permissão para vê-las/i),
    ).toBeInTheDocument()
  })
})

describe('Formulário de lançamento — a recusa do servidor pousa no campo', () => {
  it('deve exibir o 422 de valor no próprio campo valor', async () => {
    // ARRANGE
    mockCatalogos()
    servidor.use(
      msw.post('/api/lancamentos', () =>
        HttpResponse.json(
          { message: 'Inválido.', errors: { valor: ['Máximo de duas casas decimais.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(null)

    // aguarda os catálogos (queries assíncronas) popularem os selects
    await screen.findByRole('option', { name: 'Caixa' })
    await screen.findByRole('option', { name: 'Sessões' })
    await screen.findByRole('option', { name: 'PIX' })

    // ACT — preenche o mínimo e envia
    fireEvent.change(screen.getByLabelText('Competência (obrigatório)'), {
      target: { value: '2026-07-01' },
    })
    fireEvent.change(screen.getByLabelText('Vencimento (obrigatório)'), {
      target: { value: '2026-07-10' },
    })
    await usuario.selectOptions(screen.getByLabelText('Conta (obrigatório)'), '1')
    await usuario.selectOptions(screen.getByLabelText('Categoria (obrigatório)'), '1')
    await usuario.selectOptions(screen.getByLabelText('Forma de pagamento (obrigatório)'), '1')
    fireEvent.change(screen.getByLabelText('Valor (R$) (obrigatório)'), {
      target: { value: '150.999' },
    })
    await usuario.click(screen.getByRole('button', { name: 'Registrar' }))

    // ASSERT — a recusa pousa NO CAMPO valor (via aria-describedby), não só num toast que passa
    await screen.findAllByText('Máximo de duas casas decimais.')
    const campoValor = screen.getByLabelText('Valor (R$) (obrigatório)')
    const idsDescricao = campoValor.getAttribute('aria-describedby')?.split(' ') ?? []
    const idErro = idsDescricao.find((id) => id.endsWith('-erro'))
    expect(idErro).toBeDefined()
    expect(document.getElementById(idErro as string)?.textContent).toContain(
      'Máximo de duas casas decimais.',
    )
  })
})

describe('Formulário de lançamento — catálogo VAZIO não é catálogo com erro', () => {
  /** A consulta responde 200 com lista vazia: é o estado real de uma clínica sem cadastro. */
  function mockCatalogosVazios(sobrescritas: Partial<Record<'contas' | 'categorias' | 'tipos', unknown[]>> = {}) {
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json(sobrescritas.contas ?? [])),
      msw.get('/api/categorias', () => HttpResponse.json(sobrescritas.categorias ?? [])),
      msw.get('/api/tipos-pagamento', () => HttpResponse.json(sobrescritas.tipos ?? [])),
    )
  }

  it('deve apontar o cadastro para quem pode criar, e travar o registro', async () => {
    // ARRANGE — sem conta, categoria e forma de pagamento o servidor recusaria com 422
    // em campo obrigatório; deixar o botão ativo é convidar ao erro
    mockCatalogosVazios()

    // ACT
    renderizar(null, [
      'lancamentos.ver',
      'lancamentos.criar',
      'contas.ver',
      'contas.criar',
      'categorias.ver',
      'categorias.criar',
      'tipos_pagamento.ver',
      'tipos_pagamento.criar',
    ])

    // ASSERT
    expect(await screen.findByText('Nenhuma conta cadastrada.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Cadastros › Contas/ })).toHaveAttribute(
      'href',
      '/contas',
    )
    expect(screen.getByRole('link', { name: /Formas de pagamento/ })).toHaveAttribute(
      'href',
      '/tipos-pagamento',
    )
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeDisabled()
  })

  it('deve dizer a quem pedir quando a pessoa não pode cadastrar', async () => {
    // ARRANGE — mandar alguém a uma tela onde vai levar 403 é pior que não mandar
    mockCatalogosVazios()

    // ACT
    renderizar(null)

    // ASSERT
    // são TRÊS catálogos vazios: os três dizem a quem pedir, nenhum oferece atalho
    expect(
      await screen.findAllByText(/Peça a quem administra o sistema para cadastrar/),
    ).toHaveLength(3)
    expect(screen.queryByRole('link', { name: /Cadastros › Contas/ })).not.toBeInTheDocument()
  })

  it('deve distinguir "nenhuma categoria" de "nenhuma da natureza escolhida"', async () => {
    // ARRANGE — há categoria de despesa, mas o lançamento nasce como receita
    mockCatalogosVazios({
      contas: [{ id: 1, nome: 'Caixa', ativo: true, codigo_contabil: null, updated_at: 'v1' }],
      categorias: [{ id: 9, nome: 'Aluguel', tipo: 'despesa', subcategorias: [], updated_at: 'v1' }],
      tipos: [{ id: 1, nome: 'PIX', updated_at: 'v1' }],
    })

    // ACT
    renderizar(null, ['lancamentos.ver', 'lancamentos.criar', 'categorias.ver', 'categorias.criar'])

    // ASSERT — a frase nomeia a natureza que falta, não uma ausência que não existe
    expect(await screen.findByText('Nenhuma categoria de receita cadastrada.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeDisabled()
  })

  it('deve liberar o registro quando os três catálogos têm ao menos um item', async () => {
    // ARRANGE
    mockCatalogos()

    // ACT
    renderizar(null)

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Registrar' })).toBeEnabled()
    expect(screen.queryByText(/Nenhuma conta cadastrada/)).not.toBeInTheDocument()
  })
})

describe('Formulário de lançamento — o aviso de catálogo vazio é DESCRIÇÃO do campo', () => {
  it('deve ligar a frase ao seletor por aria-describedby, não só por proximidade', async () => {
    // ARRANGE — parágrafo irmão ao lado do campo é relação só visual: quem usa leitor de
    // tela chega a um campo obrigatório sem opção e nunca ouve o porquê (A11Y-CF-04)
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json([])),
      msw.get('/api/categorias', () => HttpResponse.json([])),
      msw.get('/api/tipos-pagamento', () => HttpResponse.json([])),
    )

    // ACT
    renderizar(null, ['lancamentos.ver', 'lancamentos.criar', 'contas.ver', 'contas.criar'])
    await screen.findByText('Nenhuma conta cadastrada.')

    // ASSERT
    const seletor = screen.getByRole('combobox', { name: /^Conta/ })
    const descrito = seletor.getAttribute('aria-describedby') ?? ''
    const primeiroId = descrito.split(' ')[0] ?? ''
    expect(primeiroId).not.toBe('')
    const descricao = document.getElementById(primeiroId)
    expect(descricao?.textContent).toContain('Nenhuma conta cadastrada.')
    expect(descricao?.textContent).toContain('Cadastros › Contas')
  })
})

// ── Vínculo com o tratamento (change `recebido-por-profissional`) ─────────────────────────

/** As duas crianças são FICTÍCIAS: nome nenhum aqui vem de paciente real. */
const CRIANCA_ALFA = { id: 21, nome: 'Criança Fictícia Alfa', nome_social: null }
const CRIANCA_BETA = { id: 22, nome: 'Criança Fictícia Beta', nome_social: null }

/** O que o servidor recusa no corpo do PAGO — a lista `FINANCEIROS` do `LancamentoCaixaService`. */
const CHAVES_FINANCEIRAS = [
  'tipo', 'competencia', 'vencimento', 'interessado_tipo', 'interessado_id',
  'categoria_id', 'subcategoria_id', 'valor', 'juros', 'multa', 'desconto',
  'tipo_pagamento_id', 'conta_id', 'contabil',
]

/** Com tudo que o campo usa para NOMEAR o pacote: especialidade, profissional e convênio. */
const QUEM_VINCULA = [
  'lancamentos.ver', 'lancamentos.criar', 'lancamentos.editar',
  'pacientes.ver', 'tratamentos.ver', 'agenda.ver', 'convenios.ver',
]

function convenioFicticio(id: number, nome: string, particular: boolean): Convenio {
  return {
    id,
    nome,
    registro_ans: null,
    codigo_operadora: null,
    versao_tiss: null,
    guia_sequencial: false,
    alerta_agend_mesmo_dia: false,
    flags_tiss_json: null,
    particular,
    pedido_validade_meses: null,
    ciclo_dia_corte: null,
    ciclo_tipo_corte: null,
    ativo: true,
    updated_at: '2026-07-15T10:00:00.000000Z',
  }
}

/** A forma da LISTAGEM de `/tratamentos` — nada de matrícula, guia ou pedido (detail-only). */
function tratamento(sobrescritas: Partial<TratamentoDaLista> = {}): TratamentoDaLista {
  return {
    realce: 'nenhum',
    id: 7,
    paciente_id: CRIANCA_ALFA.id,
    convenio_id: 3,
    especialidade_id: 2,
    profissional_id: 2,
    servico_id: null,
    sessoes_total: 10,
    sessoes_realizadas: 2,
    sessoes_saldo: 8,
    vencido: false,
    data_inicio: '2026-09-01',
    validade_dias: null,
    pedido_vence_em: null,
    pedido_vencido: false,
    status: 'andamento',
    updated_at: '2026-09-01T10:00:00.000000Z',
    ...sobrescritas,
  }
}

function pagina<T>(itens: T[]): PaginaDeApi<T> {
  return { data: itens, current_page: 1, last_page: 1, per_page: 100, total: itens.length }
}

/** Os rótulos esperados: especialidade · profissional · convênio · realizadas/total. */
const PACOTE_DA_ALFA = 'Psicologia · Profissional Fictício B · Particular · 2/10 sessões'
const OUTRO_PACOTE_DA_ALFA = 'Fonoaudiologia · Profissional Fictício A · Convênio Fictício · 0/10 sessões'
const PACOTE_DA_BETA = 'Fonoaudiologia · Profissional Fictício A · Particular · 3/8 sessões'

const TRATAMENTOS_POR_CRIANCA: Record<number, TratamentoDaLista[]> = {
  [CRIANCA_ALFA.id]: [
    tratamento(),
    tratamento({ id: 8, especialidade_id: 1, profissional_id: 1, convenio_id: 4, sessoes_realizadas: 0, sessoes_saldo: 10 }),
  ],
  [CRIANCA_BETA.id]: [
    tratamento({ id: 9, paciente_id: CRIANCA_BETA.id, especialidade_id: 1, profissional_id: 1, sessoes_total: 8, sessoes_realizadas: 3, sessoes_saldo: 5 }),
  ],
}

/**
 * Catálogos do caixa + as rotas do campo Tratamento. Devolve as query strings de cada consulta
 * a `/tratamentos` — é o que a tela PEDIU ao servidor.
 */
function mockVinculo(): string[] {
  const consultas: string[] = []
  mockCatalogos()
  servidor.use(
    msw.get('/api/tratamentos', ({ request }) => {
      const url = new URL(request.url)
      consultas.push(url.search)
      return HttpResponse.json(pagina(TRATAMENTOS_POR_CRIANCA[Number(url.searchParams.get('paciente_id'))] ?? []))
    }),
    msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)),
    msw.get('/api/convenios', () =>
      HttpResponse.json([convenioFicticio(3, 'Particular', true), convenioFicticio(4, 'Convênio Fictício', false)]),
    ),
    msw.get('/api/pacientes', ({ request }) => {
      const busca = (new URL(request.url).searchParams.get('busca') ?? '').toLowerCase()
      return HttpResponse.json(
        pagina([CRIANCA_ALFA, CRIANCA_BETA].filter((crianca) => crianca.nome.toLowerCase().includes(busca))),
      )
    }),
  )
  return consultas
}

/** Os corpos que chegaram ao servidor. O `PUT` aplica a MESMA recusa do pago que a API aplica. */
function capturarEnvios(): Array<Record<string, unknown>> {
  const corpos: Array<Record<string, unknown>> = []
  servidor.use(
    msw.post('/api/lancamentos', async ({ request }) => {
      corpos.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({ criados: 1, lancamentos: [] }, { status: 201 })
    }),
    msw.put('/api/lancamentos/:id', async ({ request }) => {
      const corpo = (await request.json()) as Record<string, unknown>
      corpos.push(corpo)
      if (Object.keys(corpo).some((chave) => CHAVES_FINANCEIRAS.includes(chave))) {
        return HttpResponse.json(
          {
            message: 'Inválido.',
            errors: { lancamento: ['Lançamento pago é documento contábil: estorne o pagamento antes de alterar valores.'] },
          },
          { status: 422 },
        )
      }
      return HttpResponse.json(lancamento())
    }),
  )
  return corpos
}

/** Escolhe a criança pela busca de interessado, como a recepção faz. */
async function escolherCrianca(usuario: ReturnType<typeof userEvent.setup>, nome: string): Promise<void> {
  await usuario.type(screen.getByPlaceholderText('Buscar paciente…'), nome.split(' ').at(-1) ?? nome)
  await usuario.click(await screen.findByRole('button', { name: nome }))
}

/** O valor de um item da lista de descrição (`<dt>` → `<dd>`), pelo rótulo. */
function valorDaDescricao(rotulo: string): string | null | undefined {
  return screen.getByText(rotulo, { selector: 'dt' }).nextElementSibling?.textContent
}

const LANCAMENTO_DA_ALFA = {
  interessado: { tipo: 'paciente' as const, id: CRIANCA_ALFA.id, nome: CRIANCA_ALFA.nome },
}

describe('Formulário de lançamento — pagamento de pacote escolhe o tratamento da criança', () => {
  it('deve oferecer os tratamentos da criança com especialidade, profissional e convênio, e mandar o escolhido no POST', async () => {
    // ARRANGE
    mockVinculo()
    const corpos = capturarEnvios()
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)
    await screen.findByRole('option', { name: 'PIX' })

    // ACT — a criança primeiro: sem ela não há de quem ser o tratamento
    expect(screen.queryByLabelText('Tratamento')).not.toBeInTheDocument()
    await usuario.selectOptions(screen.getByLabelText('Tipo de interessado'), 'paciente')
    await escolherCrianca(usuario, CRIANCA_ALFA.nome)
    await usuario.selectOptions(await screen.findByLabelText('Tratamento'), await screen.findByRole('option', { name: PACOTE_DA_ALFA }))
    fireEvent.change(screen.getByLabelText('Competência (obrigatório)'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Vencimento (obrigatório)'), { target: { value: '2026-09-10' } })
    await usuario.selectOptions(screen.getByLabelText('Conta (obrigatório)'), '1')
    await usuario.selectOptions(screen.getByLabelText('Categoria (obrigatório)'), '1')
    await usuario.selectOptions(screen.getByLabelText('Forma de pagamento (obrigatório)'), '1')
    fireEvent.change(screen.getByLabelText('Valor (R$) (obrigatório)'), { target: { value: '1200,00' } })
    await usuario.click(screen.getByRole('button', { name: 'Registrar' }))

    // ASSERT — o outro pacote da mesma criança também é oferecido, e o escolhido vai como número
    expect(screen.getByRole('option', { name: OUTRO_PACOTE_DA_ALFA })).toBeInTheDocument()
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).toMatchObject({
      interessado_tipo: 'paciente',
      interessado_id: CRIANCA_ALFA.id,
      tratamento_id: 7,
      valor: '1200.00',
    })
  })

  it('deve pedir a página cheia dos tratamentos DAQUELA criança', async () => {
    // ARRANGE — um pacote por mês e por especialidade passa de 50 em dois anos
    const consultas = mockVinculo()

    // ACT
    renderizar(lancamento(LANCAMENTO_DA_ALFA), QUEM_VINCULA)
    await screen.findByRole('option', { name: PACOTE_DA_ALFA })

    // ASSERT
    const parametros = new URLSearchParams(consultas[0])
    expect(parametros.get('paciente_id')).toBe(String(CRIANCA_ALFA.id))
    expect(parametros.get('per_page')).toBe('100')
  })
})

describe('Formulário de lançamento — trocar a criança limpa o tratamento', () => {
  it('deve limpar a escolha e passar a listar os tratamentos da nova criança', async () => {
    // ARRANGE — a Alfa com um pacote escolhido
    mockVinculo()
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)
    await usuario.selectOptions(await screen.findByLabelText('Tipo de interessado'), 'paciente')
    await escolherCrianca(usuario, CRIANCA_ALFA.nome)
    await usuario.selectOptions(await screen.findByLabelText('Tratamento'), await screen.findByRole('option', { name: PACOTE_DA_ALFA }))

    // ACT — troca pela Beta
    await usuario.click(screen.getByRole('button', { name: 'Remover interessado' }))
    await escolherCrianca(usuario, CRIANCA_BETA.nome)

    // ASSERT — a escolha foi limpa, e a lista é a da Beta (nada da Alfa sobrou)
    expect(await screen.findByRole('option', { name: PACOTE_DA_BETA })).toBeInTheDocument()
    expect(screen.getByLabelText('Tratamento')).toHaveValue('')
    expect(screen.queryByRole('option', { name: PACOTE_DA_ALFA })).not.toBeInTheDocument()
  })

  it('deve esconder o campo quando o interessado não é paciente', () => {
    // ARRANGE + ACT — pagamento a fornecedor não é dinheiro de criança
    mockVinculo()
    renderizar(
      lancamento({ interessado: { tipo: 'fornecedor', id: 3, nome: 'Fornecedor Fictício' } }),
      QUEM_VINCULA,
    )

    // ASSERT
    expect(screen.queryByLabelText('Tratamento')).not.toBeInTheDocument()
  })
})

describe('Formulário de lançamento — o campo Tratamento nos quatro estados da lista', () => {
  it('deve ficar desabilitado dizendo o porquê, e não consultar, sem `tratamentos.ver`', async () => {
    // ARRANGE — o servidor negaria a consulta; o campo não promete o que a API recusa
    const consultas = mockVinculo()

    // ACT
    renderizar(lancamento({ ...LANCAMENTO_DA_ALFA, tratamento_id: 7 }), ['lancamentos.ver', 'lancamentos.editar'])
    await screen.findByRole('option', { name: 'PIX' })

    // ASSERT — o vínculo gravado continua dito, sem inventar o nome que a tela não pode ler
    const campo = screen.getByLabelText('Tratamento')
    expect(campo).toBeDisabled()
    expect(campo).toHaveValue('7')
    expect(screen.getByRole('option', { name: 'Tratamento deste lançamento' })).toBeInTheDocument()
    expect(screen.getByText('Listar os tratamentos precisa da permissão de ver tratamentos.')).toBeInTheDocument()
    expect(consultas).toEqual([])
  })

  it('deve manter o vínculo gravado enquanto a lista está em voo, e enviá-lo como está', async () => {
    // ARRANGE — a lição CR-TNE-01: a lista em voo desvinculava o pacote em silêncio
    mockVinculo()
    servidor.use(
      msw.get('/api/tratamentos', async () => {
        await delay('infinite')
        return HttpResponse.json(pagina([]))
      }),
    )
    const corpos = capturarEnvios()
    const usuario = userEvent.setup()
    renderizar(lancamento({ ...LANCAMENTO_DA_ALFA, tratamento_id: 7 }), QUEM_VINCULA)
    await screen.findByRole('option', { name: 'PIX' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o `<select>` diz o que vai, e o que vai é o gravado
    expect(screen.getByLabelText('Tratamento')).toHaveValue('7')
    expect(screen.getByRole('option', { name: 'Carregando o tratamento deste lançamento…' })).toBeInTheDocument()
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]?.tratamento_id).toBe(7)
  })

  it('deve dizer que a lista falhou, oferecer tentar de novo, e listar quando volta', async () => {
    // ARRANGE — a primeira consulta falha; a segunda responde
    mockVinculo()
    let tentativas = 0
    servidor.use(
      msw.get('/api/tratamentos', () => {
        tentativas += 1
        return tentativas === 1
          ? HttpResponse.json({ message: 'Proibido.' }, { status: 403 })
          : HttpResponse.json(pagina(TRATAMENTOS_POR_CRIANCA[CRIANCA_ALFA.id] ?? []))
      }),
    )
    const usuario = userEvent.setup()
    renderizar(lancamento(LANCAMENTO_DA_ALFA), QUEM_VINCULA)

    // ACT
    expect(await screen.findByText(/Não foi possível carregar os tratamentos da criança/)).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT
    expect(await screen.findByRole('option', { name: PACOTE_DA_ALFA })).toBeInTheDocument()
  })

  it('deve dizer que a criança não tem tratamento só DEPOIS que a lista chegou vazia', async () => {
    // ARRANGE — a Beta sem pacote nenhum
    mockVinculo()
    servidor.use(msw.get('/api/tratamentos', () => HttpResponse.json(pagina([]))))

    // ACT
    renderizar(lancamento({ interessado: { tipo: 'paciente', id: CRIANCA_BETA.id, nome: CRIANCA_BETA.nome } }), QUEM_VINCULA)

    // ASSERT — a frase continua; o caminho para o pacote vem logo depois dela (o-sistema-avisa-o-que-falta)
    expect(await screen.findByText(/^Esta criança não tem tratamento cadastrado\./)).toBeInTheDocument()
    expect(screen.getByLabelText('Tratamento')).toHaveValue('')
  })

  it('deve pousar no próprio campo a recusa do servidor ao vínculo', async () => {
    // ARRANGE — tratamento de outra criança: 422 em `tratamento_id`
    mockVinculo()
    servidor.use(
      msw.put('/api/lancamentos/:id', () =>
        HttpResponse.json(
          { message: 'Inválido.', errors: { tratamento_id: ['O tratamento escolhido não é desta criança.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(lancamento({ ...LANCAMENTO_DA_ALFA, tratamento_id: 7 }), QUEM_VINCULA)
    await screen.findByRole('option', { name: PACOTE_DA_ALFA })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — ligada ao campo por aria-describedby, não solta na tela
    await screen.findAllByText('O tratamento escolhido não é desta criança.')
    const idsDescricao = screen.getByLabelText('Tratamento').getAttribute('aria-describedby')?.split(' ') ?? []
    const idErro = idsDescricao.find((id) => id.endsWith('-erro'))
    expect(document.getElementById(idErro ?? '')?.textContent).toContain('O tratamento escolhido não é desta criança.')
  })
})

describe('Formulário de lançamento — lançamento pago aceita só o vínculo', () => {
  const PAGO = { pago_em: '2026-09-10 14:30', juros: '5.00', liquido: '155.00' }

  it('deve mostrar os campos financeiros só para leitura e mandar no PUT apenas tratamento, obs e documento', async () => {
    // ARRANGE — o PUT deste teste aplica a recusa do servidor: chave financeira no corpo = 422
    mockVinculo()
    const corpos = capturarEnvios()
    const aoFechar = vi.fn()
    const usuario = userEvent.setup()
    renderizar(lancamento({ ...PAGO, ...LANCAMENTO_DA_ALFA }), [...QUEM_VINCULA, 'lancamentos.pagar'], aoFechar)

    // ACT
    await usuario.selectOptions(screen.getByLabelText('Tratamento'), await screen.findByRole('option', { name: PACOTE_DA_ALFA }))
    await usuario.type(screen.getByLabelText('Observações'), 'Pacote de setembro.')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — nenhum campo financeiro editável; o que era campo virou leitura
    expect(screen.queryByLabelText('Valor (R$) (obrigatório)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Conta (obrigatório)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tipo de interessado')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Contábil')).not.toBeInTheDocument()
    expect(valorDaDescricao('Valor')).toBe('R$ 150,00')
    expect(valorDaDescricao('Juros')).toBe('R$ 5,00')
    expect(valorDaDescricao('Líquido')).toBe('R$ 155,00')
    expect(valorDaDescricao('Pago em')).toBe('10/09/2026 às 14:30')
    expect(valorDaDescricao('Interessado')).toBe(CRIANCA_ALFA.nome)
    await waitFor(() => {
      expect(aoFechar).toHaveBeenCalled()
    })
    expect(corpos).toEqual([{ tratamento_id: 7, documento: null, obs: 'Pacote de setembro.' }])
  })

  it('deve mostrar o tratamento do pago só para leitura a quem não dá baixa, e reenviá-lo como está', async () => {
    // ARRANGE — SEC-RPP-03: trocar o vínculo do pago move dinheiro recebido entre profissionais;
    // o servidor exige `lancamentos.pagar`. Sem ela, oferecer a troca seria prometer um 403
    mockVinculo()
    const corpos = capturarEnvios()
    const aoFechar = vi.fn()
    const usuario = userEvent.setup()
    renderizar(lancamento({ ...PAGO, ...LANCAMENTO_DA_ALFA, tratamento_id: 7 }), QUEM_VINCULA, aoFechar)

    // ACT
    await usuario.type(screen.getByLabelText('Observações'), 'Pacote de setembro.')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — leitura com a razão, sem seletor; o vínculo vai igual (reenviar não é mexer)
    expect(screen.queryByRole('combobox', { name: 'Tratamento' })).not.toBeInTheDocument()
    expect(valorDaDescricao('Tratamento')).toContain(RAZAO_DO_PAGO_SEM_BAIXA)
    // e o aviso do topo não promete ajustar o tratamento (CR-RPP-21)
    expect(screen.getByText(AVISO_DO_PAGO_SEM_BAIXA)).toBeInTheDocument()
    expect(screen.queryByText(AVISO_DO_PAGO)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(aoFechar).toHaveBeenCalled()
    })
    expect(corpos).toEqual([{ tratamento_id: 7, documento: null, obs: 'Pacote de setembro.' }])
  })

  it('deve salvar a obs de lançamento pago, que o corpo inteiro fazia o servidor recusar', async () => {
    // ARRANGE — o defeito de antes: nenhuma edição de pago passava, nem a da observação
    mockCatalogos()
    const corpos = capturarEnvios()
    const aoFechar = vi.fn()
    const usuario = userEvent.setup()
    renderizar(lancamento(PAGO), ['lancamentos.ver', 'lancamentos.editar'], aoFechar)

    // ACT
    await usuario.type(screen.getByLabelText('Observações'), 'Recibo entregue à família.')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — sem criança, o vínculo vai vazio; e o servidor aceitou (o diálogo fechou)
    await waitFor(() => {
      expect(aoFechar).toHaveBeenCalled()
    })
    expect(corpos).toEqual([{ tratamento_id: null, documento: null, obs: 'Recibo entregue à família.' }])
    expect(screen.queryByText(/estorne o pagamento/)).not.toBeInTheDocument()
  })
})

describe('Formulário de lançamento — faturado pela agenda mostra o tratamento só para leitura', () => {
  const FATURADO = { ...LANCAMENTO_DA_ALFA, agendamento_id: 55, tratamento_id: 7 }

  it('deve mostrar o tratamento com a razão e NÃO mandá-lo no PUT', async () => {
    // ARRANGE — em aberto: o resto do lançamento continua editável e vai inteiro
    mockVinculo()
    const corpos = capturarEnvios()
    const usuario = userEvent.setup()
    renderizar(lancamento(FATURADO), QUEM_VINCULA)

    // ACT
    await waitFor(() => {
      expect(valorDaDescricao('Tratamento')).toContain(PACOTE_DA_ALFA)
    })
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    expect(valorDaDescricao('Tratamento')).toContain(RAZAO_DO_FATURAMENTO)
    expect(screen.queryByRole('combobox', { name: 'Tratamento' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).not.toHaveProperty('tratamento_id')
    expect(corpos[0]).toHaveProperty('valor', '150.00')
  })

  it('deve mandar só obs e documento quando o faturado também está pago', async () => {
    // ARRANGE
    mockVinculo()
    const corpos = capturarEnvios()
    const aoFechar = vi.fn()
    const usuario = userEvent.setup()
    renderizar(lancamento({ ...FATURADO, pago_em: '2026-09-10 14:30' }), QUEM_VINCULA, aoFechar)

    // ACT
    await usuario.type(screen.getByLabelText('Documento'), 'REC-0042')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(aoFechar).toHaveBeenCalled()
    })
    expect(corpos).toEqual([{ documento: 'REC-0042', obs: null }])
  })
})

describe('Formulário de lançamento — axe nos estados novos do vínculo', () => {
  it('deve não ter violações axe no lançamento PAGO com o campo Tratamento', async () => {
    // ARRANGE + ACT — o diálogo vai para um Portal: a varredura é no `document.body`
    mockVinculo()
    renderizar(lancamento({ pago_em: '2026-09-10 14:30', ...LANCAMENTO_DA_ALFA }), [...QUEM_VINCULA, 'lancamentos.pagar'])
    await screen.findByRole('option', { name: PACOTE_DA_ALFA })

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe no FATURADO com o tratamento só para leitura', async () => {
    // ARRANGE + ACT
    mockVinculo()
    renderizar(lancamento({ ...LANCAMENTO_DA_ALFA, agendamento_id: 55, tratamento_id: 7 }), QUEM_VINCULA)
    await waitFor(() => {
      expect(valorDaDescricao('Tratamento')).toContain(PACOTE_DA_ALFA)
    })

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  }, 30000)
})

// ── Sugestão do tratamento (change `vincular-pagamentos-ao-tratamento`) ──────────────────────

/** Os profissionais que a seleção fictícia nomeia — os pacotes da Alfa (7) e da Beta (9). */
const VAI_PARA_ALFA = 'Vai para: Profissional Fictício B'
const VAI_PARA_BETA = 'Vai para: Profissional Fictício A'

/**
 * A sugestão do servidor por criança (a regra é DELE: um só particular em andamento). Devolve as
 * crianças pedidas, na ordem — é o que a tela PERGUNTOU.
 */
function mockSugestao(porCrianca: Record<number, number | null>): number[] {
  const pedidas: number[] = []
  servidor.use(
    msw.get('/api/lancamentos/sugestao-de-tratamento', ({ request }) => {
      const pacienteId = Number(new URL(request.url).searchParams.get('paciente_id'))
      pedidas.push(pacienteId)
      return HttpResponse.json({ tratamento_id: porCrianca[pacienteId] ?? null })
    }),
  )
  return pedidas
}

/** O mínimo do lançamento novo que o servidor exige, além do interessado e do tratamento. */
async function preencherOResto(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  fireEvent.change(screen.getByLabelText('Competência (obrigatório)'), { target: { value: '2026-09-01' } })
  fireEvent.change(screen.getByLabelText('Vencimento (obrigatório)'), { target: { value: '2026-09-10' } })
  await usuario.selectOptions(screen.getByLabelText('Conta (obrigatório)'), '1')
  await usuario.selectOptions(screen.getByLabelText('Categoria (obrigatório)'), '1')
  await usuario.selectOptions(screen.getByLabelText('Forma de pagamento (obrigatório)'), '1')
  fireEvent.change(screen.getByLabelText('Valor (R$) (obrigatório)'), { target: { value: '1200,00' } })
}

/** Abre o lançamento novo, escolhe a criança e espera a lista de pacotes dela chegar. */
async function lancarPara(usuario: ReturnType<typeof userEvent.setup>, crianca: { nome: string }): Promise<void> {
  await screen.findByRole('option', { name: 'PIX' })
  await usuario.selectOptions(screen.getByLabelText('Tipo de interessado'), 'paciente')
  await escolherCrianca(usuario, crianca.nome)
}

describe('Formulário de lançamento — a sugestão do tratamento', () => {
  it('deve preencher o tratamento sugerido, dizer para quem vai, e mandá-lo no POST', async () => {
    // ARRANGE — a Alfa tem um só pacote particular em andamento: o 7, da Profissional B
    mockVinculo()
    const pedidas = mockSugestao({ [CRIANCA_ALFA.id]: 7 })
    const corpos = capturarEnvios()
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)

    // ACT
    await lancarPara(usuario, CRIANCA_ALFA)
    await screen.findByText(SELO_DA_SUGESTAO)
    await preencherOResto(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Registrar' }))

    // ASSERT — o campo mostra o que vai; e o que vai é o sugerido, como número
    expect(screen.getByLabelText('Tratamento')).toHaveValue('7')
    expect(screen.getByText(VAI_PARA_ALFA)).toBeInTheDocument()
    expect(screen.queryByText(AVISO_SEM_PROFISSIONAL)).not.toBeInTheDocument()
    expect(pedidas).toEqual([CRIANCA_ALFA.id])
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).toMatchObject({ interessado_id: CRIANCA_ALFA.id, tratamento_id: 7 })
  })

  it('deve respeitar "Sem tratamento": o POST vai sem vínculo, o aviso aparece e a sugestão não volta', async () => {
    // ARRANGE — a avaliação avulsa não é do pacote (design D2): quem lança tira a sugestão
    mockVinculo()
    const pedidas = mockSugestao({ [CRIANCA_ALFA.id]: 7 })
    const corpos = capturarEnvios()
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)
    await lancarPara(usuario, CRIANCA_ALFA)
    await screen.findByText(SELO_DA_SUGESTAO)

    // ACT — recusa; depois tira e escolhe a MESMA criança de novo
    await usuario.selectOptions(screen.getByLabelText('Tratamento'), '')
    // a recusa vale NA HORA, com a sugestão ainda no cache: sem a guarda do toque o pacote voltava
    // sozinho (CR-VPT-06) — o fim do teste não vê isso, porque o `gcTime: 0` apaga o cache
    expect(screen.getByLabelText('Tratamento')).toHaveValue('')
    expect(screen.queryByText(SELO_DA_SUGESTAO)).not.toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Remover interessado' }))
    await escolherCrianca(usuario, CRIANCA_ALFA.nome)
    await screen.findByRole('option', { name: PACOTE_DA_ALFA })
    await preencherOResto(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Registrar' }))

    // ASSERT — nada de selo, o aviso do fim do mês, e a sugestão não foi pedida de novo
    expect(screen.getByLabelText('Tratamento')).toHaveValue('')
    expect(screen.queryByText(SELO_DA_SUGESTAO)).not.toBeInTheDocument()
    expect(screen.getByText(AVISO_SEM_PROFISSIONAL)).toBeInTheDocument()
    expect(pedidas).toEqual([CRIANCA_ALFA.id])
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).toMatchObject({ interessado_id: CRIANCA_ALFA.id, tratamento_id: null })
  })

  it('deve manter "Sem tratamento" quando a sugestão chega DEPOIS da recusa', async () => {
    // ARRANGE — a sugestão da Alfa fica presa até o teste soltar
    mockVinculo()
    let soltar = (): void => undefined
    const presa = new Promise<void>((resolver) => {
      soltar = resolver
    })
    servidor.use(
      msw.get('/api/lancamentos/sugestao-de-tratamento', async () => {
        await presa
        return HttpResponse.json({ tratamento_id: 7 })
      }),
    )
    const corpos = capturarEnvios()
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)
    await lancarPara(usuario, CRIANCA_ALFA)
    await screen.findByRole('option', { name: PACOTE_DA_ALFA })

    // ACT — quem lança recusa antes de a resposta chegar; depois ela chega
    await usuario.selectOptions(screen.getByLabelText('Tratamento'), '')
    soltar()
    // a resposta ATERRISSOU no cache com o campo montado — sem isto o teste passaria sem ela
    await waitFor(() => {
      expect(queryClient.getQueryData(chaves.sugestaoDeTratamento(CRIANCA_ALFA.id))).toEqual({ tratamento_id: 7 })
    })
    await preencherOResto(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Registrar' }))

    // ASSERT — a resposta atrasada não atropela a recusa, na tela nem no POST
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(screen.getByLabelText('Tratamento')).toHaveValue('')
    expect(screen.queryByText(SELO_DA_SUGESTAO)).not.toBeInTheDocument()
    expect(corpos[0]).toMatchObject({ interessado_id: CRIANCA_ALFA.id, tratamento_id: null })
  })

  it('deve ligar o aviso de "Sem profissional" ao campo, por aria-describedby', async () => {
    // ARRANGE — a Beta sem sugestão: o campo nasce vazio numa receita
    mockVinculo()
    mockSugestao({})
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)

    // ACT
    await lancarPara(usuario, CRIANCA_BETA)
    await screen.findByRole('option', { name: PACOTE_DA_BETA })

    // ASSERT — quem usa leitor de tela ouve a consequência ao chegar no campo
    const descrito = screen.getByLabelText('Tratamento').getAttribute('aria-describedby') ?? ''
    const ajuda = document.getElementById(descrito.split(' ')[0] ?? '')
    expect(ajuda?.textContent).toContain(AVISO_SEM_PROFISSIONAL)
  })

  it('deve não avisar "Sem profissional" numa despesa da criança', async () => {
    // ARRANGE — o "Recebido por profissional" é de receitas; numa despesa o aviso seria falso
    mockVinculo()
    mockSugestao({})
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)
    await screen.findByRole('option', { name: 'PIX' })

    // ACT
    await usuario.selectOptions(screen.getByLabelText('Tipo (obrigatório)'), 'despesa')
    await lancarPara(usuario, CRIANCA_BETA)
    await screen.findByRole('option', { name: PACOTE_DA_BETA })

    // ASSERT
    expect(screen.queryByText(AVISO_SEM_PROFISSIONAL)).not.toBeInTheDocument()
  })

  it('deve não sugerir o pacote numa despesa da criança', async () => {
    // ARRANGE — a devolução sugerida ao pacote tiraria dinheiro do profissional sem ninguém ter
    // escolhido; a Alfa TEM sugestão, e mesmo assim a despesa não a recebe
    mockVinculo()
    const pedidas = mockSugestao({ [CRIANCA_ALFA.id]: 7 })
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)
    await screen.findByRole('option', { name: 'PIX' })

    // ACT
    await usuario.selectOptions(screen.getByLabelText('Tipo (obrigatório)'), 'despesa')
    await lancarPara(usuario, CRIANCA_ALFA)
    await screen.findByRole('option', { name: PACOTE_DA_ALFA })

    // ASSERT
    expect(pedidas).toEqual([])
    expect(screen.queryByText(SELO_DA_SUGESTAO)).not.toBeInTheDocument()
    expect((screen.getByLabelText('Tratamento') as HTMLSelectElement).value).toBe('')
  })

  it('deve dizer "Vai para" também no tratamento escolhido à mão, sem o selo de sugestão', async () => {
    // ARRANGE — a Beta não tem sugestão
    mockVinculo()
    mockSugestao({})
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)
    await lancarPara(usuario, CRIANCA_BETA)

    // ACT
    await usuario.selectOptions(screen.getByLabelText('Tratamento'), await screen.findByRole('option', { name: PACOTE_DA_BETA }))

    // ASSERT
    expect(screen.getByText(VAI_PARA_BETA)).toBeInTheDocument()
    expect(screen.queryByText(SELO_DA_SUGESTAO)).not.toBeInTheDocument()
    expect(screen.queryByText(AVISO_SEM_PROFISSIONAL)).not.toBeInTheDocument()
  })

  it('deve não pedir a sugestão sem `tratamentos.ver`', async () => {
    // ARRANGE — o servidor negaria (403): o campo não pergunta o que não pode ler
    mockVinculo()
    const pedidas = mockSugestao({ [CRIANCA_ALFA.id]: 7 })
    const usuario = userEvent.setup()
    renderizar(null, ['lancamentos.ver', 'lancamentos.criar', 'pacientes.ver'])

    // ACT
    await lancarPara(usuario, CRIANCA_ALFA)
    await screen.findByText('Listar os tratamentos precisa da permissão de ver tratamentos.')

    // ASSERT
    expect(screen.getByLabelText('Tratamento')).toHaveValue('')
    expect(screen.queryByText(SELO_DA_SUGESTAO)).not.toBeInTheDocument()
    expect(pedidas).toEqual([])
  })

  it('deve pedir de novo a sugestão para a criança nova ao trocar a criança', async () => {
    // ARRANGE — cada criança tem o seu pacote sugerido
    mockVinculo()
    const pedidas = mockSugestao({ [CRIANCA_ALFA.id]: 7, [CRIANCA_BETA.id]: 9 })
    const usuario = userEvent.setup()
    renderizar(null, QUEM_VINCULA)
    await lancarPara(usuario, CRIANCA_ALFA)
    await screen.findByText(VAI_PARA_ALFA)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Remover interessado' }))
    await escolherCrianca(usuario, CRIANCA_BETA.nome)

    // ASSERT — o pacote da Beta, sugerido; nada da Alfa sobrou
    expect(await screen.findByText(VAI_PARA_BETA)).toBeInTheDocument()
    expect(screen.getByLabelText('Tratamento')).toHaveValue('9')
    expect(screen.getByText(SELO_DA_SUGESTAO)).toBeInTheDocument()
    expect(pedidas).toEqual([CRIANCA_ALFA.id, CRIANCA_BETA.id])
  })

  it('deve sugerir na edição do PAGO a quem dá baixa, e mandar o sugerido no PUT', async () => {
    // ARRANGE — é o caso de setembro: pago, com a criança e sem o tratamento
    mockVinculo()
    mockSugestao({ [CRIANCA_ALFA.id]: 7 })
    const corpos = capturarEnvios()
    const aoFechar = vi.fn()
    const usuario = userEvent.setup()
    renderizar(
      lancamento({ pago_em: '2026-09-10 14:30', ...LANCAMENTO_DA_ALFA }),
      [...QUEM_VINCULA, 'lancamentos.pagar'],
      aoFechar,
    )

    // ACT
    await screen.findByText(VAI_PARA_ALFA)
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(aoFechar).toHaveBeenCalled()
    })
    expect(corpos).toEqual([{ tratamento_id: 7, documento: null, obs: null }])
  })

  it('deve não pedir a sugestão no PAGO de quem não dá baixa, nem no lançamento que já tem tratamento', async () => {
    // ARRANGE — o campo é leitura (SEC-RPP-03) num; no outro, a escolha já foi feita
    mockVinculo()
    const pedidas = mockSugestao({ [CRIANCA_ALFA.id]: 7 })
    const { unmount } = renderizar(lancamento({ pago_em: '2026-09-10 14:30', ...LANCAMENTO_DA_ALFA }), QUEM_VINCULA)
    await waitFor(() => {
      expect(valorDaDescricao('Tratamento')).toContain(RAZAO_DO_PAGO_SEM_BAIXA)
    })
    unmount()

    // ACT
    renderizar(lancamento({ ...LANCAMENTO_DA_ALFA, tratamento_id: 8 }), QUEM_VINCULA)
    await screen.findByRole('option', { name: OUTRO_PACOTE_DA_ALFA })

    // ASSERT — leitura continua "Sem tratamento" lá; aqui o 8 fica
    expect(screen.getByLabelText('Tratamento')).toHaveValue('8')
    expect(screen.queryByText(SELO_DA_SUGESTAO)).not.toBeInTheDocument()
    expect(pedidas).toEqual([])
  })

  it('deve não sugerir no lançamento em ciclo fechado, que não se salva daqui', async () => {
    // ARRANGE — sem o botão Salvar, "Vai para" diria algo sobre um vínculo que nunca foi gravado
    mockVinculo()
    const pedidas = mockSugestao({ [CRIANCA_ALFA.id]: 7 })

    // ACT
    renderizar(lancamento({ ...LANCAMENTO_DA_ALFA, em_ciclo_fechado: true }), QUEM_VINCULA)
    await screen.findByRole('option', { name: PACOTE_DA_ALFA })

    // ASSERT
    expect(screen.getByLabelText('Tratamento')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
    expect(pedidas).toEqual([])
  })

  it('deve não ter violações axe com o tratamento sugerido', async () => {
    // ARRANGE + ACT
    mockVinculo()
    mockSugestao({ [CRIANCA_ALFA.id]: 7 })
    renderizar(lancamento(LANCAMENTO_DA_ALFA), QUEM_VINCULA)
    await screen.findByText(VAI_PARA_ALFA)

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  }, 30000)
})

// ── O caminho para o pacote (change `o-sistema-avisa-o-que-falta`) ───────────────────────────

describe('Formulário de lançamento — a criança sem pacote ganha o caminho para cadastrá-lo', () => {
  /** O pacote mora no cadastro da criança: a tela exige editar o paciente E criar tratamento. */
  const QUEM_CADASTRA_PACOTE = [...QUEM_VINCULA, 'pacientes.editar', 'tratamentos.criar', 'especialidades.ver', 'profissionais.ver']
  const LANCAMENTO_DA_BETA = {
    interessado: { tipo: 'paciente' as const, id: CRIANCA_BETA.id, nome: CRIANCA_BETA.nome },
  }
  const CAMINHO_DO_PACOTE = 'Cadastrar o pacote no cadastro da criança'
  const PEDIDO_DO_PACOTE = 'Peça a quem administra o sistema para cadastrar o pacote.'

  /** A Beta sem pacote nenhum: a lista da criança chega VAZIA. */
  function semPacote(): void {
    mockVinculo()
    servidor.use(msw.get('/api/tratamentos', () => HttpResponse.json(pagina([]))))
  }

  /** O que o leitor de tela ouve junto do campo Tratamento: o primeiro id do `aria-describedby`. */
  function descricaoDoTratamento(): HTMLElement | null {
    const primeiroId = screen.getByLabelText('Tratamento').getAttribute('aria-describedby')?.split(' ')[0]
    return primeiroId === undefined ? null : document.getElementById(primeiroId)
  }

  it('deve levar ao cadastro do pacote DAQUELA criança, a quem pode cadastrar', async () => {
    // ARRANGE
    semPacote()

    // ACT
    renderizar(lancamento(LANCAMENTO_DA_BETA), QUEM_CADASTRA_PACOTE)

    // ASSERT — o caminho mora na descrição do campo, logo depois da frase que já existia
    const caminho = await screen.findByRole('link', { name: CAMINHO_DO_PACOTE })
    expect(caminho).toHaveAttribute('href', `/pacientes/${CRIANCA_BETA.id}/editar`)
    expect(descricaoDoTratamento()).toContainElement(caminho)
    expect(descricaoDoTratamento()?.textContent).toContain(`${CRIANCA_SEM_TRATAMENTO} ${CAMINHO_DO_PACOTE}`)
  })

  it('deve dizer a quem pedir, sem link, a quem não pode cadastrar o pacote', async () => {
    // ARRANGE — sem editar a criança ou sem criar tratamento, o link levaria a um 403
    semPacote()

    // ACT
    renderizar(lancamento(LANCAMENTO_DA_BETA), [...QUEM_VINCULA, 'pacientes.editar'])

    // ASSERT
    await waitFor(() => {
      expect(descricaoDoTratamento()?.textContent).toContain(`${CRIANCA_SEM_TRATAMENTO} ${PEDIDO_DO_PACOTE}`)
    })
    expect(screen.queryByRole('link', { name: CAMINHO_DO_PACOTE })).not.toBeInTheDocument()
  })

  it('deve não mudar nada quando a criança tem tratamento', async () => {
    // ARRANGE — a Alfa tem dois pacotes
    mockVinculo()

    // ACT
    renderizar(lancamento(LANCAMENTO_DA_ALFA), QUEM_CADASTRA_PACOTE)
    await screen.findByRole('option', { name: PACOTE_DA_ALFA })

    // ASSERT
    expect(screen.queryByText(/Esta criança não tem tratamento/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: CAMINHO_DO_PACOTE })).not.toBeInTheDocument()
  })

  it('deve fechar o formulário ao seguir o caminho para o pacote', async () => {
    // ARRANGE
    semPacote()
    const aoFechar = vi.fn()
    const usuario = userEvent.setup()
    renderizar(lancamento(LANCAMENTO_DA_BETA), QUEM_CADASTRA_PACOTE, aoFechar)

    // ACT
    await usuario.click(await screen.findByRole('link', { name: CAMINHO_DO_PACOTE }))

    // ASSERT
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('deve abrir com as mesmas requisições, com e sem o caminho (nenhuma requisição nova)', async () => {
    // ARRANGE — o caminho sai da lista que o campo já carregou (D6)
    async function requisicoesAoAbrir(comPacote: boolean): Promise<string[]> {
      queryClient.clear()
      if (comPacote) {
        mockVinculo()
      } else {
        semPacote()
      }
      const pedidas: string[] = []
      const anotar = ({ request }: { request: Request }): void => {
        pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
      }
      servidor.events.on('request:start', anotar)
      const { unmount } = renderizar(
        lancamento(comPacote ? LANCAMENTO_DA_ALFA : LANCAMENTO_DA_BETA),
        QUEM_CADASTRA_PACOTE,
      )
      await (comPacote
        ? screen.findByRole('option', { name: PACOTE_DA_ALFA })
        : screen.findByRole('link', { name: CAMINHO_DO_PACOTE }))
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      servidor.events.removeListener('request:start', anotar)
      unmount()
      return pedidas.sort()
    }

    // ACT
    const semCaminho = await requisicoesAoAbrir(true)
    const comCaminho = await requisicoesAoAbrir(false)

    // ASSERT — e a comparação não é trivial: o formulário de fato pede a lista da criança
    expect(comCaminho).toContain('GET /api/tratamentos')
    expect(comCaminho).toEqual(semCaminho)
  })

  it('deve não ter violações axe com o caminho para o pacote', async () => {
    // ARRANGE + ACT
    semPacote()
    renderizar(lancamento(LANCAMENTO_DA_BETA), QUEM_CADASTRA_PACOTE)
    await screen.findByRole('link', { name: CAMINHO_DO_PACOTE })

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  }, 30000)
})

/**
 * O `AlertDialog` do Radix só leva o foco ao `AlertDialog.Cancel`, e o lançamento não tem um: o "Novo
 * lançamento" abria com o foco atrás do véu (gate A11Y-AVI-02). Dados FICTÍCIOS.
 */
describe('Formulário de lançamento — o foco entra no diálogo e volta a quem abriu', () => {
  /** O botão do cabeçalho da página, que abre o formulário pelo estado. */
  function ComQuemAbre() {
    const [aberto, setAberto] = useState(false)

    return (
      <>
        <button
          type="button"
          onClick={() => {
            setAberto(true)
          }}
        >
          Abrir o formulário
        </button>
        {aberto ? (
          <FormularioLancamento
            lancamento={null}
            aoFechar={() => {
              setAberto(false)
            }}
          />
        ) : null}
      </>
    )
  }

  function renderizarComQuemAbre() {
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['lancamentos.ver', 'lancamentos.criar'] },
      carregandoSessao: false,
    })

    return render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <ComQuemAbre />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
  }

  it('deve levar o foco para o primeiro campo ao abrir o novo lançamento', async () => {
    // ARRANGE
    mockCatalogos()
    const usuario = userEvent.setup()
    renderizarComQuemAbre()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir o formulário' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Novo lançamento' })

    // ASSERT
    expect(dialogo).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(within(dialogo).getByRole('combobox', { name: /^Tipo\s*\(obrigatório\)$/ }))
  })

  it('deve devolver o foco a quem abriu ao cancelar', async () => {
    // ARRANGE
    mockCatalogos()
    const usuario = userEvent.setup()
    renderizarComQuemAbre()
    const abrir = screen.getByRole('button', { name: 'Abrir o formulário' })
    await usuario.click(abrir)
    const dialogo = await screen.findByRole('alertdialog', { name: 'Novo lançamento' })

    // ACT
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(abrir).toHaveFocus()
    })
  })
})
