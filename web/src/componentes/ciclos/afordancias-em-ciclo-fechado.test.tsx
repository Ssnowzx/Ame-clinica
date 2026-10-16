import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { SecaoAtendimento } from '@/componentes/atendimento/secao-atendimento'
import { TEXTO_DO_SELO } from '@/componentes/ciclos/selo-de-ciclo-fechado'
import { DialogoDeEvolucao } from '@/componentes/evolucoes/formulario-evolucao'
import { FormularioLancamento } from '@/componentes/financeiro/formulario-lancamento'
import { PainelLancamentos } from '@/componentes/financeiro/painel-lancamentos'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type {
  Atendimento,
  AtendimentoDetalhe,
  EvolucaoDetalhe,
  LancamentoCaixa,
  LancamentoCaixaDetalhe,
} from '@/tipos'

/**
 * As afordâncias que somem em período fechado (tasks 4.3/4.4 · D7 · SEC-FC-09).
 *
 * O contrato que estes testes fiscalizam tem TRÊS pernas, e as três precisam ser verdade
 * ao mesmo tempo:
 *
 * 1. **A ação some** onde a tela sabe — e ela só sabe pelo booleano do PRÓPRIO registro,
 *    que existe apenas no DETALHE (a listagem não o carrega, de propósito).
 * 2. **O estado fica legível**: some o botão, aparece o selo. Ação que some calada vira
 *    suspeita de bug, e a pessoa procura a porta do lado.
 * 3. **A recusa que chega por outro caminho** (aba antiga, ciclo fechado entre o GET e o
 *    PUT) pousa no lugar padrão de erro daquela superfície — sem tocar no contrato de erro:
 *    `ciclo_fechado` não é campo de formulário nenhum, então cai em `gerais`.
 *
 * E a invariante que atravessa tudo (**SEC-FC-09**): nenhuma destas telas consulta os
 * ciclos do convênio. O calendário e a lista de fechamentos vivem sob `ciclos.fechar` /
 * `convenios.ver` — buscá-los aqui faria a afordância virar oráculo do cadastro de
 * convênios para quem tem só `lancamentos.editar`.
 */

// ── Fixtures: a forma REAL do servidor, e a fronteira lista×detalhe no TIPO ──────────

/** A linha da LISTAGEM — sem `em_ciclo_fechado`, como a API responde de verdade. */
function atendimentoDaLista(sobrescritas: Partial<Atendimento> = {}): Atendimento {
  return {
    id: 3,
    updated_at: '2026-07-15T10:00:00.000000Z',
    agendamento_id: 7,
    iniciado_em: null,
    finalizado_em: '2026-07-11 09:40',
    evolucao_id: null,
    ...sobrescritas,
  } satisfies Atendimento
}

function atendimentoDoDetalhe(
  sobrescritas: Partial<AtendimentoDetalhe> = {},
): AtendimentoDetalhe {
  return {
    ...atendimentoDaLista(),
    observacoes: 'Observacao ficticia da sessao.',
    em_ciclo_fechado: false,
    ...sobrescritas,
  } satisfies AtendimentoDetalhe
}

function evolucaoDoDetalhe(sobrescritas: Partial<EvolucaoDetalhe> = {}): EvolucaoDetalhe {
  return {
    id: 42,
    updated_at: '2026-07-15T10:00:00.000000Z',
    atendimento_id: 3,
    profissional_id: 1,
    responsavel_tecnico_id: null,
    conteudo: 'Evolução fictícia: a criança respondeu bem às atividades propostas.',
    preenchida_em: '2026-07-11 10:00',
    em_ciclo_fechado: false,
    ...sobrescritas,
  } satisfies EvolucaoDetalhe
}

function lancamentoDaLista(sobrescritas: Partial<LancamentoCaixa> = {}): LancamentoCaixa {
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
    ...sobrescritas,
  } satisfies LancamentoCaixa
}

function lancamentoDoDetalhe(
  sobrescritas: Partial<LancamentoCaixaDetalhe> = {},
): LancamentoCaixaDetalhe {
  return {
    ...lancamentoDaLista(),
    obs: null,
    em_ciclo_fechado: false,
    // o `show` sempre manda o vínculo (change `recebido-por-profissional`)
    tratamento_id: null,
    // e a última cobrança pelo WhatsApp (change `cobranca-pelo-whatsapp`)
    ultima_cobranca: null,
    ...sobrescritas,
  } satisfies LancamentoCaixaDetalhe
}

/** A 422 do servidor, com o teto do SEC-FC-07: período + estado + caminho, sem convênio. */
const RECUSA_DO_CICLO = {
  errors: {
    ciclo_fechado: [
      'A produção deste período (16/06/2026 a 15/07/2026) já foi fechada; a reabertura é do administrador.',
    ],
  },
}

function paginaDeApi<T>(itens: T[]) {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

function autenticar(permissoes: string[], vinculo: number | null = null): void {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes, profissional_id: vinculo },
    carregandoSessao: false,
  })
}

function envolver(conteudo: React.ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>{conteudo}</ProvedorToast>
    </QueryClientProvider>,
  )
}

/**
 * O contador de requisições de CICLO — a prova do SEC-FC-09.
 *
 * Registrado em TODO teste deste arquivo (não só no dedicado): a violação apareceria em
 * qualquer fluxo, e uma guarda que só olha o cenário que a espera é uma guarda que não
 * olha. Qualquer rota de ciclo/calendário de convênio conta.
 */
expect.extend(toHaveNoViolations)

let pedidosDeCiclo: string[] = []

function espionarCiclos(): void {
  servidor.use(
    msw.get('/api/convenios/:convenioId/ciclos', ({ request }) => {
      pedidosDeCiclo.push(request.url)
      return HttpResponse.json([])
    }),
    msw.get('/api/convenios/:convenioId/ciclos/proximo', ({ request }) => {
      pedidosDeCiclo.push(request.url)
      return HttpResponse.json(null)
    }),
    msw.get('/api/convenios/:convenioId', ({ request }) => {
      pedidosDeCiclo.push(request.url)
      return HttpResponse.json({})
    }),
    msw.get('/api/convenios', ({ request }) => {
      pedidosDeCiclo.push(request.url)
      return HttpResponse.json([])
    }),
  )
}

beforeEach(() => {
  queryClient.clear()
  pedidosDeCiclo = []
  espionarCiclos()
})

// ── Atendimento ──────────────────────────────────────────────────────────────────────

function mockarAtendimento(detalhe: AtendimentoDetalhe): void {
  servidor.use(
    msw.get('/api/atendimentos', () => HttpResponse.json(paginaDeApi([atendimentoDaLista()]))),
    msw.get('/api/atendimentos/:id', () => HttpResponse.json(detalhe)),
  )
}

function renderizarAtendimento() {
  autenticar([
    'atendimentos.ver',
    'atendimentos.criar',
    'atendimentos.editar',
    'atendimentos.excluir',
  ])

  return envolver(
    <SecaoAtendimento agendamentoId={7} nomeDaCrianca="Ana Fictícia" profissionalId={1} />,
  )
}

describe('Atendimento em período fechado — a ação some, o estado fica legível', () => {
  it('deve sumir com "Desfazer registro" e "Salvar observações", e explicar por quê', async () => {
    // ARRANGE — a seção só descobre o ciclo pelo DETALHE, que é lido sob demanda (o `show`
    // é auditado). Antes de pedir, ela não sabe — e não finge saber.
    const usuario = userEvent.setup()
    mockarAtendimento(atendimentoDoDetalhe({ em_ciclo_fechado: true }))
    renderizarAtendimento()

    // ACT — o clique que já existia é o que traz o booleano junto com a observação
    await usuario.click(await screen.findByRole('button', { name: 'Ver observações da sessão' }))
    await screen.findByRole('textbox', { name: /Observações da sessão/i })

    // ASSERT — as duas ações somem, e o selo diz o estado e a saída
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Desfazer registro' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Salvar observações' })).not.toBeInTheDocument()
    expect(screen.getByText(TEXTO_DO_SELO)).toBeInTheDocument()
  })

  it('deve manter o texto da observação LEGÍVEL — some a ação, não o campo', async () => {
    // ARRANGE — D7: esconder a AÇÃO, nunca desabilitar campo por regra de servidor. Campo
    // travado empurra a profissional a manter a própria cópia fora do sistema.
    const usuario = userEvent.setup()
    mockarAtendimento(atendimentoDoDetalhe({ em_ciclo_fechado: true }))
    renderizarAtendimento()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Ver observações da sessão' }))

    // ASSERT
    const campo = await screen.findByRole('textbox', { name: /Observações da sessão/i })
    expect(campo).toHaveValue('Observacao ficticia da sessao.')
    expect(campo).toBeEnabled()
  })

  it('deve manter as duas ações quando o período está aberto', async () => {
    // ARRANGE — o contrapositivo: sem ele, um componente que escondesse SEMPRE passaria
    const usuario = userEvent.setup()
    mockarAtendimento(atendimentoDoDetalhe({ em_ciclo_fechado: false }))
    renderizarAtendimento()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Ver observações da sessão' }))
    await screen.findByRole('textbox', { name: /Observações da sessão/i })

    // ASSERT
    expect(screen.getByRole('button', { name: 'Salvar observações' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desfazer registro' })).toBeInTheDocument()
    expect(screen.queryByText(TEXTO_DO_SELO)).not.toBeInTheDocument()
  })

  it('deve mostrar a recusa `ciclo_fechado` DENTRO do diálogo de desfazer', async () => {
    // ARRANGE — quem chega por outro caminho: a listagem não carrega o booleano (SEC-FC-09),
    // então quem não abriu as observações ainda enxerga "Desfazer registro". Quem responde
    // é o servidor, e a mensagem tem de pousar onde a pessoa está olhando.
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(paginaDeApi([atendimentoDaLista()]))),
      msw.delete('/api/atendimentos/:id', () => HttpResponse.json(RECUSA_DO_CICLO, { status: 422 })),
    )
    renderizarAtendimento()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Desfazer registro' }))
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Desfazer registro' }))

    // ASSERT — `ciclo_fechado` não é campo do formulário: cai em `gerais` e o AvisoErro
    // a mostra. Contrato de erro INTOCADO — é o mesmo caminho do `atendimento`/`evolucoes_vencidas`.
    expect(await within(confirmacao).findByText(/já foi fechada/)).toBeInTheDocument()
  })
})

// ── Evolução ─────────────────────────────────────────────────────────────────────────

function HarnessDeEvolucao({ evolucaoId }: { evolucaoId: number }) {
  const [aberto, setAberto] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAberto(true)
        }}
      >
        Abrir evolução
      </button>
      <DialogoDeEvolucao
        aberto={aberto}
        aoMudarAberto={setAberto}
        destino={{ atendimentoId: 3 }}
        evolucaoId={evolucaoId}
        profissionalSugerido={1}
        nomeDaCrianca="Ana Fictícia"
      />
    </>
  )
}

function renderizarEvolucao(detalhe: EvolucaoDetalhe) {
  servidor.use(
    msw.get('/api/evolucoes/:id', () => HttpResponse.json(detalhe)),
    msw.get('/api/profissionais', () =>
      HttpResponse.json([
        {
          id: 1,
          nome: 'Profissional Fictício',
          horarios: {},
          obs: null,
          ativo: true,
          especialidades: [],
        },
      ]),
    ),
  )
  autenticar(['evolucoes.ver', 'evolucoes.criar', 'evolucoes.editar'], 1)

  return envolver(<HarnessDeEvolucao evolucaoId={detalhe.id} />)
}

describe('Evolução em período fechado — o prontuário se lê, não se reescreve', () => {
  it('deve sumir com "Salvar evolução" e manter o conteúdo legível', async () => {
    // ARRANGE — a competência da evolução é a do atendimento-mãe (D3); a tela só recebe o
    // veredito, nunca a data nem o convênio.
    const usuario = userEvent.setup()
    renderizarEvolucao(evolucaoDoDetalhe({ em_ciclo_fechado: true }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))

    // ASSERT
    const campo = await screen.findByRole('textbox', { name: /Evolução da sessão/i })
    expect(campo).toHaveValue(evolucaoDoDetalhe().conteudo)
    expect(campo).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Salvar evolução' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
    expect(screen.getByText(TEXTO_DO_SELO)).toBeInTheDocument()
  })

  it('deve manter "Salvar evolução" quando o período está aberto', async () => {
    // ARRANGE + ACT
    const usuario = userEvent.setup()
    renderizarEvolucao(evolucaoDoDetalhe({ em_ciclo_fechado: false }))
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Salvar evolução' })).toBeInTheDocument()
    expect(screen.queryByText(TEXTO_DO_SELO)).not.toBeInTheDocument()
  })

  it('deve mostrar a recusa `ciclo_fechado` no aviso do formulário', async () => {
    // ARRANGE — a corrida real: o GET disse "aberto", alguém fechou o ciclo, o PUT chega
    // depois. A tela não pode engolir a recusa em silêncio.
    const usuario = userEvent.setup()
    renderizarEvolucao(evolucaoDoDetalhe({ em_ciclo_fechado: false }))
    servidor.use(
      msw.put('/api/evolucoes/:id', () => HttpResponse.json(RECUSA_DO_CICLO, { status: 422 })),
    )

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    await usuario.click(await screen.findByRole('button', { name: 'Salvar evolução' }))

    // ASSERT — a mensagem aparece DENTRO do diálogo (o toast é reforço, não o lugar), e o
    // formulário segue aberto com o texto clínico intacto
    const dialogo = await screen.findByRole('alertdialog')
    expect(await within(dialogo).findByText(/já foi fechada/)).toBeInTheDocument()
    expect(within(dialogo).getByRole('textbox', { name: /Evolução da sessão/i })).toHaveValue(
      evolucaoDoDetalhe().conteudo,
    )
  })
})

// ── Lançamento ───────────────────────────────────────────────────────────────────────

function mockarCatalogosDoCaixa(): void {
  servidor.use(
    msw.get('/api/contas', () => HttpResponse.json([{ id: 1, nome: 'Caixa', ativo: true }])),
    msw.get('/api/categorias', () =>
      HttpResponse.json([{ id: 1, nome: 'Sessões', tipo: 'receita', subcategorias: [] }]),
    ),
    msw.get('/api/tipos-pagamento', () => HttpResponse.json([{ id: 1, nome: 'PIX' }])),
  )
}

describe('Lançamento em período fechado — o dinheiro enviado não se reescreve', () => {
  it('deve sumir com "Salvar" no formulário de edição, e explicar por quê', async () => {
    // ARRANGE — o formulário recebe o DETALHE (é ele que traz `obs` e o booleano). O tipo
    // `LancamentoCaixaDetalhe` é quem impede passar uma linha da LISTA aqui e a tela
    // concluir "aberto" por ausência de campo.
    mockarCatalogosDoCaixa()
    autenticar(['lancamentos.ver', 'lancamentos.editar'])
    envolver(
      <FormularioLancamento
        lancamento={lancamentoDoDetalhe({ em_ciclo_fechado: true })}
        aoFechar={() => undefined}
      />,
    )

    // ASSERT
    expect(await screen.findByText(TEXTO_DO_SELO)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument()
    // o campo não é desabilitado por regra de servidor (D7) — some a AÇÃO
    expect(screen.getByLabelText(/Competência/)).toBeEnabled()
  })

  it('deve manter "Salvar" quando o período está aberto', async () => {
    // ARRANGE + ACT
    mockarCatalogosDoCaixa()
    autenticar(['lancamentos.ver', 'lancamentos.editar'])
    envolver(
      <FormularioLancamento
        lancamento={lancamentoDoDetalhe({ em_ciclo_fechado: false })}
        aoFechar={() => undefined}
      />,
    )

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Salvar' })).toBeInTheDocument()
    expect(screen.queryByText(TEXTO_DO_SELO)).not.toBeInTheDocument()
  })

  it('deve mostrar a recusa `ciclo_fechado` DENTRO do diálogo de excluir', async () => {
    // ARRANGE — a linha da listagem não carrega o booleano (SEC-FC-09: seriam 100 consultas
    // por página, e a linha viraria oráculo do calendário). Quem recusa é o servidor.
    const usuario = userEvent.setup()
    mockarCatalogosDoCaixa()
    servidor.use(
      msw.get('/api/lancamentos', () => HttpResponse.json(paginaDeApi([lancamentoDaLista()]))),
      msw.delete('/api/lancamentos/:id', () =>
        HttpResponse.json(RECUSA_DO_CICLO, { status: 422 }),
      ),
    )
    autenticar(['lancamentos.ver', 'lancamentos.excluir'])
    envolver(<PainelLancamentos />)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Excluir/ }))
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Excluir' }))

    // ASSERT
    expect(await within(confirmacao).findByText(/já foi fechada/)).toBeInTheDocument()
  })

  it('deve mostrar a recusa `ciclo_fechado` DENTRO do diálogo de baixa', async () => {
    // ARRANGE — pagar e estornar também são recusados (eles deslocam a linha no extrato).
    const usuario = userEvent.setup()
    mockarCatalogosDoCaixa()
    servidor.use(
      msw.get('/api/lancamentos', () => HttpResponse.json(paginaDeApi([lancamentoDaLista()]))),
      msw.post('/api/lancamentos/:id/pagamento', () =>
        HttpResponse.json(RECUSA_DO_CICLO, { status: 422 }),
      ),
    )
    autenticar(['lancamentos.ver', 'lancamentos.pagar'])
    envolver(<PainelLancamentos />)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Pagar/ }))
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Dar baixa' }))

    // ASSERT
    expect(await within(confirmacao).findByText(/já foi fechada/)).toBeInTheDocument()
  })
})

// ── SEC-FC-09 ────────────────────────────────────────────────────────────────────────

describe('SEC-FC-09 — a afordância não vira oráculo do calendário do convênio', () => {
  it('deve decidir o sumiço SEM pedir os ciclos do convênio em nenhuma das três telas', async () => {
    // ARRANGE — o único sinal permitido é o booleano DERIVADO do próprio registro. Se
    // qualquer destas telas buscasse `/convenios/{id}/ciclos` ou o cadastro do convênio,
    // quem tem só `lancamentos.editar` aprenderia, pela tela, quando cada operadora fecha
    // e quem fechou o quê — o vínculo paciente↔operadora por via travessa.
    const usuario = userEvent.setup()

    // ACT 1 — atendimento (com a produção fechada, o caminho que mais "quereria" saber)
    mockarAtendimento(atendimentoDoDetalhe({ em_ciclo_fechado: true }))
    const atendimento = renderizarAtendimento()
    await usuario.click(await screen.findByRole('button', { name: 'Ver observações da sessão' }))
    expect(await screen.findByText(TEXTO_DO_SELO)).toBeInTheDocument()
    atendimento.unmount()

    // ACT 2 — evolução
    queryClient.clear()
    const evolucao = renderizarEvolucao(evolucaoDoDetalhe({ em_ciclo_fechado: true }))
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    expect(await screen.findByText(TEXTO_DO_SELO)).toBeInTheDocument()
    evolucao.unmount()

    // ACT 3 — lançamento
    queryClient.clear()
    mockarCatalogosDoCaixa()
    autenticar(['lancamentos.ver', 'lancamentos.editar'])
    envolver(
      <FormularioLancamento
        lancamento={lancamentoDoDetalhe({ em_ciclo_fechado: true })}
        aoFechar={() => undefined}
      />,
    )
    expect(await screen.findByText(TEXTO_DO_SELO)).toBeInTheDocument()

    // ASSERT — nenhuma requisição de ciclo/calendário/cadastro de convênio partiu daqui
    expect(pedidosDeCiclo).toEqual([])
  })
})

// ── Varredura axe das TRÊS telas com selo (IMP-5) ────────────────────────────────────

/**
 * O run axe que a change tinha era um só, e com o AlertDialog ABERTO — estado em que o
 * Radix põe `aria-hidden` no resto da página, e a varredura acaba auditando quase só o
 * diálogo. As três superfícies onde o selo entra (atendimento, evolução, lançamento)
 * mudam de forma nesta change — a ação some, o selo aparece — e nenhuma tinha varredura.
 *
 * Cada uma é medida no ESTADO DE CICLO FECHADO, que é o estado novo.
 */
describe('Selo de ciclo fechado — axe nas três telas em que ele aparece', () => {
  it('deve não ter violações axe no ATENDIMENTO com o período fechado', async () => {
    // ARRANGE + ACT
    const usuario = userEvent.setup()
    mockarAtendimento(atendimentoDoDetalhe({ em_ciclo_fechado: true }))
    const { container } = renderizarAtendimento()
    await usuario.click(await screen.findByRole('button', { name: 'Ver observações da sessão' }))
    await screen.findByText(TEXTO_DO_SELO)

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe na EVOLUÇÃO com o período fechado', async () => {
    // ARRANGE + ACT — o diálogo vai para um Portal: a varredura é no `document.body`
    const usuario = userEvent.setup()
    renderizarEvolucao(evolucaoDoDetalhe({ em_ciclo_fechado: true }))
    await usuario.click(screen.getByRole('button', { name: 'Abrir evolução' }))
    await screen.findByText(TEXTO_DO_SELO)

    // ASSERT
    expect(await axe(document.body)).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe no LANÇAMENTO com o período fechado', async () => {
    // ARRANGE + ACT
    mockarCatalogosDoCaixa()
    autenticar(['lancamentos.ver', 'lancamentos.editar'])
    const { container } = envolver(
      <FormularioLancamento
        lancamento={lancamentoDoDetalhe({ em_ciclo_fechado: true })}
        aoFechar={() => undefined}
      />,
    )
    await screen.findByText(TEXTO_DO_SELO)

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)
})
