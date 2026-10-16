import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SecaoAtendimento } from '@/componentes/atendimento/secao-atendimento'
import { TEXTO_DO_SELO } from '@/componentes/ciclos/selo-de-ciclo-fechado'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { StatusDaSelecao } from '@/lib/baixa-em-lote'
import type { Atendimento, AtendimentoDetalhe } from '@/tipos'

const TUDO = [
  'atendimentos.ver',
  'atendimentos.criar',
  'atendimentos.editar',
  'atendimentos.excluir',
  'evolucoes.ver',
  'evolucoes.criar',
]

function pagina(itens: Atendimento[]) {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

/**
 * A LINHA DA LISTAGEM — e ela NÃO tem `em_ciclo_fechado` (SEC-FC-09): a API o mantém fora
 * de propósito. Fixture que o prometesse aqui mentiria sobre a forma do servidor, e é
 * exatamente esse tipo de mentira que custou o bloqueante B2.
 */
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

/** O DETALHE (`show`, `store`, `update`) — aqui o booleano do ciclo existe SEMPRE. */
function atendimentoDoDetalhe(sobrescritas: Partial<AtendimentoDetalhe> = {}): AtendimentoDetalhe {
  return {
    ...atendimentoDaLista(),
    em_ciclo_fechado: false,
    ...sobrescritas,
  } satisfies AtendimentoDetalhe
}

function renderizar(permissoes: string[] = TUDO, vinculo: number | null = null) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes, profissional_id: vinculo },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <SecaoAtendimento agendamentoId={7} nomeDaCrianca="Ana Fictícia" profissionalId={1} />
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

expect.extend(toHaveNoViolations)

describe('Atendimento na agenda — registrar a sessão que aconteceu', () => {
  it('deve registrar SEM mandar finalizado_em — quem carimba é o servidor', async () => {
    // ARRANGE: o relógio do navegador não é o relógio da CLÍNICA. Mandá-lo faria a hora do
    // prontuário de uma criança ser a hora da máquina de quem digitou — noutro fuso.
    const usuario = userEvent.setup()
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(pagina([]))),
      msw.post('/api/agendamentos/:id/atendimento', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(atendimentoDoDetalhe(), { status: 201 })
      }),
    )
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Registrar atendimento' }))

    // ASSERT
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).not.toHaveProperty('finalizado_em')
    expect(corpo).not.toHaveProperty('iniciado_em')
  })

  it('deve proteger a observação clínica do corretor do navegador', async () => {
    // ARRANGE: o corretor "enhanced" do Chrome e o Editor do Edge ENVIAM o texto do campo
    // para os servidores do fornecedor. Dado clínico não sai da clínica por um default.
    servidor.use(msw.get('/api/atendimentos', () => HttpResponse.json(pagina([]))))
    renderizar()

    // ASSERT
    const campo = await screen.findByRole('textbox', { name: /Observações do atendimento/i })
    expect(campo).toHaveAttribute('spellcheck', 'false')
    expect(campo).toHaveAttribute('autocomplete', 'off')
  })

  it('deve mostrar a recusa da trava de evolução dentro do diálogo, via gerais', async () => {
    // ARRANGE: o 422 novo do finalizar (change trava-de-evolucao) chega na chave
    // `evolucoes_vencidas`, que não tem campo no formulário — fora do set de campos,
    // ela pousa em `gerais` e o AvisoErro a mostra onde a pessoa está olhando.
    // Contrato EXISTENTE: nenhuma mudança no front, e este teste o prova.
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(pagina([]))),
      msw.post('/api/agendamentos/:id/atendimento', () =>
        HttpResponse.json(
          {
            errors: {
              evolucoes_vencidas: [
                'O profissional deste agendamento tem 2 evoluções vencidas há mais de 3 dias além do prazo — registre as evoluções pendentes para voltar a finalizar.',
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )
    renderizar()

    // ACT
    const secao = (await screen.findByRole('heading', { name: 'Atendimento' })).closest('section')
    if (secao === null) {
      throw new Error('A seção de atendimento não foi renderizada.')
    }
    await usuario.click(await screen.findByRole('button', { name: 'Registrar atendimento' }))

    // ASSERT: a mensagem aparece no AvisoErro DA SEÇÃO (o toast é reforço, não o lugar)
    expect(await within(secao).findByText(/2 evoluções vencidas/)).toBeInTheDocument()
    expect(within(secao).getByRole('alert')).toHaveTextContent('registre as evoluções pendentes')
  })

  it('deve mostrar a recusa do servidor DENTRO do diálogo de desfazer', async () => {
    // ARRANGE: as chaves com que o servidor recusa (`atendimento`) não têm campo na tela.
    // Mapeadas a um campo inexistente, a mensagem não apareceria em lugar NENHUM.
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(pagina([atendimentoDaLista()]))),
      msw.delete('/api/atendimentos/:id', () =>
        HttpResponse.json(
          { errors: { atendimento: ['Atendimento com evolução registrada não pode ser excluído.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Desfazer registro' }))
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Desfazer registro' }))

    // ASSERT: a mensagem aparece onde a pessoa está olhando
    expect(await within(confirmacao).findByText(/não pode ser excluído/)).toBeInTheDocument()
  })
})

describe('Atendimento na agenda — o que cada permissão vê', () => {
  it('deve esconder a seção inteira sem atendimentos.ver', () => {
    // ARRANGE + ACT
    renderizar(['agenda.ver'])

    // ASSERT
    expect(screen.queryByRole('heading', { name: 'Atendimento' })).not.toBeInTheDocument()
  })

  it('deve exigir evolucoes.criar para oferecer o passo de escrever', async () => {
    // ARRANGE: botão não promete o que o servidor nega — a escrita é composta
    servidor.use(msw.get('/api/atendimentos', () => HttpResponse.json(pagina([atendimentoDaLista()]))))
    renderizar(['atendimentos.ver', 'atendimentos.criar'])

    // ASSERT: a seção existe (o atendimento aparece), mas o passo da evolução não
    expect(await screen.findByText(/Sessão registrada em/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Escrever evolução' })).not.toBeInTheDocument()
  })

  it('deve oferecer VER a evolução quando ela já existe', async () => {
    // ARRANGE: `evolucao_id` diz que o prontuário existe — sem revelar o que ele diz
    servidor.use(
      msw.get('/api/atendimentos', () =>
        HttpResponse.json(pagina([atendimentoDaLista({ evolucao_id: 42 })])),
      ),
    )
    renderizar()

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Ver evolução' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Escrever evolução' })).not.toBeInTheDocument()
  })

  it('deve decidir o campo AUSENTE como "não posso saber" — nunca como "não existe"', async () => {
    // ARRANGE — re-review I-1. A API OMITE `evolucao_id` de quem não tem permissão nenhuma
    // de evolução (gate SEC F-03). `undefined` NÃO é `null`: tratar os dois como iguais
    // fazia a tela cair no ramo errado — e o servidor é quem decide o que este usuário
    // pode saber, não a crença local de permissão.
    const base = atendimentoDaLista()
    const semOCampo: Atendimento = {
      id: base.id,
      updated_at: '2026-07-15T10:00:00.000000Z',
      agendamento_id: base.agendamento_id,
      iniciado_em: base.iniciado_em,
      finalizado_em: base.finalizado_em,
    }
    servidor.use(msw.get('/api/atendimentos', () => HttpResponse.json(pagina([semOCampo]))))
    renderizar()

    // ASSERT — a seção existe, mas nenhuma ação de evolução é oferecida
    expect(await screen.findByText(/Sessão registrada em/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Escrever evolução' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver evolução' })).not.toBeInTheDocument()
  })
})

describe('Atendimento — a observação não é write-only', () => {
  it('deve LER a observação sob demanda, e só ao pedir (a leitura é auditada)', async () => {
    // ARRANGE — gate SEC F-04. Escrever e nunca mais conseguir reler empurra a profissional
    // a manter a própria cópia fora do sistema, e aí o dado clínico sai da clínica pela via
    // humana. Mas o `show` é AUDITADO: abrir o diálogo não pode gravar na trilha uma leitura
    // que ninguém pediu — por isso a busca é SOB DEMANDA.
    const usuario = userEvent.setup()
    let leituras = 0
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(pagina([atendimentoDaLista()]))),
      msw.get('/api/atendimentos/:id', () => {
        leituras += 1
        return HttpResponse.json(atendimentoDoDetalhe({ observacoes: 'Observacao ficticia da sessao.' }))
      }),
    )
    renderizar()

    // ASSERT 1 — o detalhe NÃO é buscado ao abrir
    expect(await screen.findByRole('button', { name: 'Ver observações da sessão' })).toBeInTheDocument()
    expect(leituras).toBe(0)

    // ACT — só ao PEDIR
    await usuario.click(screen.getByRole('button', { name: 'Ver observações da sessão' }))

    // ASSERT 2 — o texto aparece, e a leitura foi UMA
    const campo = await screen.findByRole('textbox', { name: /Observações da sessão/i })
    expect(campo).toHaveValue('Observacao ficticia da sessao.')
    expect(leituras).toBe(1)
    expect(campo).toHaveAttribute('spellcheck', 'false')
  })

  it('deve deixar EDITAR a observação de uma sessão já registrada', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(pagina([atendimentoDaLista()]))),
      msw.get('/api/atendimentos/:id', () =>
        HttpResponse.json(atendimentoDoDetalhe({ observacoes: 'Primeira.' })),
      ),
      msw.put('/api/atendimentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(atendimentoDoDetalhe())
      }),
    )
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Ver observações da sessão' }))
    const campo = await screen.findByRole('textbox', { name: /Observações da sessão/i })
    await usuario.type(campo, ' Segunda.')
    await usuario.click(screen.getByRole('button', { name: 'Salvar observações' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ observacoes: 'Primeira. Segunda.' })
  })
})

describe('Atendimento — abrir as observações não pode largar o foco no body (2.4.3)', () => {
  function mockarComDetalhe(detalhe: AtendimentoDetalhe): void {
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(pagina([atendimentoDaLista()]))),
      msw.get('/api/atendimentos/:id', () => HttpResponse.json(detalhe)),
    )
  }

  it('deve levar o foco para o painel recém-aberto — o gatilho é SUBSTITUÍDO por ele', async () => {
    // ARRANGE — o botão "Ver observações da sessão" some no mesmo clique que abre o
    // painel: o foco cairia no `body`, e quem navega por teclado recomeça o diálogo
    // inteiro. O padrão é anterior a esta change, mas ela o agravou — no mesmo instante
    // "Desfazer registro" some e o selo aparece: três mudanças de estado num clique.
    const usuario = userEvent.setup()
    mockarComDetalhe(atendimentoDoDetalhe({ observacoes: 'Observacao ficticia.' }))
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Ver observações da sessão' }))

    // ASSERT — o painel é o destino, nomeado (o `group` diz ONDE a pessoa chegou)
    const painel = await screen.findByRole('group', { name: 'Observações da sessão' })
    await waitFor(() => {
      expect(document.activeElement).toBe(painel)
    })
    expect(document.activeElement).not.toBe(document.body)
  })

  it('deve ANUNCIAR a abertura enquanto o detalhe ainda carrega', async () => {
    // ARRANGE — entre o clique e a resposta há um esqueleto, que é `aria-hidden`: sem a
    // live region, a espera é silêncio absoluto.
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(pagina([atendimentoDaLista()]))),
      msw.get('/api/atendimentos/:id', async () => {
        await new Promise((resolver) => setTimeout(resolver, 60))
        return HttpResponse.json(atendimentoDoDetalhe())
      }),
    )
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Ver observações da sessão' }))

    // ASSERT
    expect(await screen.findByRole('status')).toHaveTextContent('Abrindo as observações da sessão.')

    // e o teste não termina com a requisição no ar: resposta entregue depois do teardown
    // vira ruído de `unhandled rejection` que mascara falha de verdade
    expect(await screen.findByRole('textbox', { name: /Observações da sessão/i })).toBeInTheDocument()
  })

  it('deve ANUNCIAR o selo de ciclo fechado, que é quem explica as ações que sumiram', async () => {
    // ARRANGE — IMP-3: o selo nasce de uma resposta assíncrona e era um `<p>` mudo. Ele é
    // a explicação de "Desfazer registro" e "Salvar observações" terem desaparecido.
    const usuario = userEvent.setup()
    mockarComDetalhe(atendimentoDoDetalhe({ em_ciclo_fechado: true }))
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Ver observações da sessão' }))
    await screen.findByRole('textbox', { name: /Observações da sessão/i })

    // ASSERT — o selo se anuncia sozinho, e as duas ações realmente sumiram
    const selo = await screen.findByText(TEXTO_DO_SELO)
    expect(selo).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button', { name: 'Desfazer registro' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvar observações' })).not.toBeInTheDocument()
  })
})

/**
 * evolucao-finaliza-a-sessao (D5): a clínica pediu "finalizar com evolução direto". Quem pode
 * registrar E escrever vê "Escrever evolução" como ação principal antes do registro; salvar
 * registra, evolui e — com a chave ligada — finaliza. A recusa do status é dita e FICA na seção.
 */
describe('Atendimento — a evolução direto da sessão', () => {
  const EVOLUCAO = {
    id: 9,
    atendimento_id: 3,
    profissional_id: 1,
    responsavel_tecnico_id: null,
    conteudo: 'Evolução fictícia.',
    preenchida_em: '2026-10-02 10:00',
    updated_at: '2026-10-02T13:00:00.000000Z',
  }

  /** Os status da seleção que a agenda já carregou: as flags reais decidem o aviso (CR-EVO-14). */
  const STATUS_DA_SELECAO: StatusDaSelecao[] = [
    { id: 1, nome: 'Em Aberto', cor: '#64748B', cor_borda: null, tipo: null, ordem: 1, desconta_sessao: false, marca_falta: false, aplicavel_em_lote: false, em_aberto: true, sessao_marcada: true },
    { id: 4, nome: 'Finalizado com Evolução', cor: '#10B981', cor_borda: null, tipo: null, ordem: 4, desconta_sessao: true, marca_falta: false, aplicavel_em_lote: true, em_aberto: false, sessao_marcada: true },
    { id: 5, nome: 'Não Compareceu', cor: '#EF4444', cor_borda: null, tipo: null, ordem: 5, desconta_sessao: true, marca_falta: true, aplicavel_em_lote: false, em_aberto: false, sessao_marcada: true },
    { id: 6, nome: 'Falta Justificada', cor: '#F59E0B', cor_borda: null, tipo: null, ordem: 6, desconta_sessao: false, marca_falta: false, aplicavel_em_lote: true, em_aberto: false, sessao_marcada: true },
  ]

  function elementoDaSessao({
    sessaoEmAberto = true,
    statusAtualId,
    pacoteSemSaldo,
    aoFinalizar,
  }: { sessaoEmAberto?: boolean; statusAtualId?: number; pacoteSemSaldo?: boolean; aoFinalizar?: () => void } = {}) {
    return (
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <SecaoAtendimento
            agendamentoId={7}
            nomeDaCrianca="Ana Fictícia"
            profissionalId={1}
            statusDaSelecao={STATUS_DA_SELECAO}
            statusAtualId={statusAtualId ?? (sessaoEmAberto ? 1 : 6)}
            pacoteSemSaldo={pacoteSemSaldo}
            aoFinalizar={aoFinalizar}
          />
        </ProvedorToast>
      </QueryClientProvider>
    )
  }

  function renderizarDaSessao({
    permissoes = TUDO,
    ...props
  }: {
    permissoes?: string[]
    sessaoEmAberto?: boolean
    statusAtualId?: number
    pacoteSemSaldo?: boolean
    aoFinalizar?: () => void
  } = {}) {
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes, profissional_id: 1 },
      carregandoSessao: false,
    })

    return render(elementoDaSessao(props))
  }

  /** A sessão sem registro, a chave da finalização e o POST da rota da sessão, que responde `sessao`. */
  function mockDaSessao(sessao: { finalizada: boolean; motivo: string | null }, statusAoSalvar = 4) {
    let registrado = false
    const pedidos: string[] = []
    servidor.use(
      msw.get('/api/atendimentos', () =>
        HttpResponse.json(pagina(registrado ? [atendimentoDaLista({ evolucao_id: 9 })] : [])),
      ),
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({ configuracoes: [{ chave: 'evolucoes.status_ao_salvar', tipo: 'int', valor: statusAoSalvar }] }),
      ),
      msw.get('/api/profissionais', () =>
        HttpResponse.json([{ id: 1, nome: 'Profissional Fictício', horarios: {}, obs: null, ativo: true, especialidades: [] }]),
      ),
      msw.post('/api/agendamentos/:id/evolucao', ({ params }) => {
        pedidos.push(`/api/agendamentos/${String(params.id)}/evolucao`)
        registrado = true
        return HttpResponse.json({ ...EVOLUCAO, sessao }, { status: 201 })
      }),
    )
    return pedidos
  }

  async function escreverESalvar(usuario: ReturnType<typeof userEvent.setup>) {
    await usuario.click(await screen.findByRole('button', { name: 'Escrever evolução' }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.type(within(dialogo).getByRole('textbox', { name: /Evolução da sessão/ }), 'Evolução fictícia.')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar evolução' }))
  }

  it('deve oferecer "Escrever evolução" como ação principal antes do registro', async () => {
    // ARRANGE
    mockDaSessao({ finalizada: true, motivo: null })

    // ACT
    renderizarDaSessao()

    // ASSERT — a principal é escrever; registrar sem evolução é secundária e não abre o campo sozinha
    const escrever = await screen.findByRole('button', { name: 'Escrever evolução' })
    expect(escrever.className).toContain('bg-botao-primario')
    expect(screen.getByRole('button', { name: 'Registrar sem evolução' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: /Observações do atendimento/ })).not.toBeInTheDocument()
  })

  it('não deve oferecer escrever antes do registro sem a permissão de registrar atendimento', async () => {
    // ARRANGE — a rota da sessão exige as DUAS permissões: o botão não promete o 403
    mockDaSessao({ finalizada: true, motivo: null })

    // ACT
    renderizarDaSessao({ permissoes: TUDO.filter((permissao) => permissao !== 'atendimentos.criar') })

    // ASSERT
    await screen.findByText(/A sessão ainda não foi registrada/)
    expect(screen.queryByRole('button', { name: 'Escrever evolução' })).not.toBeInTheDocument()
  })

  it('deve abrir as observações só em "Registrar sem evolução"', async () => {
    // ARRANGE
    mockDaSessao({ finalizada: true, motivo: null })
    const usuario = userEvent.setup()
    renderizarDaSessao()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Registrar sem evolução' }))

    // ASSERT
    expect(screen.getByRole('button', { name: 'Registrar sem evolução' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: /Observações do atendimento/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar atendimento' })).toBeInTheDocument()
  })

  it.each([
    [true, true, 'A sessão ainda não foi registrada. Ao salvar a evolução, a sessão é registrada e finalizada — e desconta do pacote.'],
    [true, false, 'A sessão ainda não foi registrada. Ao salvar a evolução, a sessão é registrada junto.'],
    [false, true, 'A sessão ainda não foi registrada. Ao salvar a evolução, a sessão é registrada junto.'],
  ])('deve avisar antes do clique que o pacote desconta só com a chave ligada (%s) e a sessão em aberto (%s)', async (ligada, emAberto, texto) => {
    // ARRANGE
    mockDaSessao({ finalizada: true, motivo: null }, ligada ? 4 : 0)

    // ACT
    renderizarDaSessao({ sessaoEmAberto: emAberto })

    // ASSERT
    expect(await screen.findByText(texto)).toBeInTheDocument()
  })

  it('deve salvar pela rota da sessão e dizer que a sessão foi finalizada', async () => {
    // ARRANGE
    const pedidos = mockDaSessao({ finalizada: true, motivo: null })
    const usuario = userEvent.setup()
    renderizarDaSessao()

    // ACT
    await escreverESalvar(usuario)

    // ASSERT — UMA chamada, na rota que registra e evolui junto; o diálogo fecha
    expect(await screen.findByText('Evolução salva e sessão finalizada.')).toBeInTheDocument()
    expect(pedidos).toEqual(['/api/agendamentos/7/evolucao'])
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('deve levar o foco ao registro quando o botão que abriu o diálogo some (2.4.3)', async () => {
    // ARRANGE — medido no navegador: sem isto, o foco caía no `body` depois de salvar
    mockDaSessao({ finalizada: true, motivo: null })
    const usuario = userEvent.setup()
    renderizarDaSessao()

    // ACT
    await escreverESalvar(usuario)

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Sessão registrada' })).toHaveFocus()
    })
  })

  it('deve devolver o foco ao botão quando o diálogo fecha sem registrar', async () => {
    // ARRANGE
    mockDaSessao({ finalizada: true, motivo: null })
    const usuario = userEvent.setup()
    renderizarDaSessao()
    await usuario.click(await screen.findByRole('button', { name: 'Escrever evolução' }))
    const dialogo = await screen.findByRole('alertdialog')

    // ACT
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    // ASSERT — nada mudou na seção: o padrão do Radix (o gatilho) continua certo
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Escrever evolução' })).toHaveFocus()
    })
  })

  it('deve manter na seção o motivo quando a sessão não foi finalizada', async () => {
    // ARRANGE — a evolução foi salva; o status, recusado (D2)
    mockDaSessao({ finalizada: false, motivo: 'Pacote fictício sem saldo.' })
    const usuario = userEvent.setup()
    renderizarDaSessao()

    // ACT
    await escreverESalvar(usuario)

    // ASSERT — o toast diz, e a seção GUARDA o motivo depois que ele some
    expect(await screen.findByText('Evolução salva. A sessão não foi finalizada:')).toBeInTheDocument()
    expect(await screen.findByText(/Sessão registrada em/)).toBeInTheDocument()
    const aviso = screen.getByText('A sessão não foi finalizada:', { exact: false, selector: 'strong' }).closest('p')
    expect(aviso).toHaveTextContent('Pacote fictício sem saldo.')
  })

  it('deve fechar o diálogo e guardar a recusa mesmo quando o registro aparece ANTES da resposta', async () => {
    // ARRANGE — a corrida do achado do `idCongelado`: o atendimento nasce no servidor e a tela o vê
    // (foco na janela, outra aba) enquanto a resposta do POST ainda não chegou. Um diálogo por ramo
    // REMONTARIA aí, e o React Query descarta os callbacks de quem desmontou
    const motivo = 'Pacote fictício sem saldo.'
    mockDaSessao({ finalizada: false, motivo })
    let registrado = false
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(pagina(registrado ? [atendimentoDaLista()] : []))),
      msw.post('/api/agendamentos/:id/evolucao', async () => {
        registrado = true
        await queryClient.invalidateQueries({ queryKey: ['atendimentos'] })
        await waitFor(() => {
          expect(screen.getByText(/Sessão registrada em/)).toBeInTheDocument()
        })
        return HttpResponse.json({ ...EVOLUCAO, sessao: { finalizada: false, motivo } }, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizarDaSessao()

    // ACT
    await escreverESalvar(usuario)

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(screen.getByText('A sessão não foi finalizada:', { exact: false, selector: 'strong' }).closest('p')).toHaveTextContent(motivo)
  })

  it('não deve prometer o desconto quando o status configurado deixou de finalizar', async () => {
    // ARRANGE — gate CR-EVO-14: a chave aponta para "Não Compareceu" (é falta); o id sozinho não basta
    mockDaSessao({ finalizada: false, motivo: null }, 5)

    // ACT
    renderizarDaSessao()

    // ASSERT
    expect(await screen.findByText('A sessão ainda não foi registrada. Ao salvar a evolução, a sessão é registrada junto.')).toBeInTheDocument()
  })

  it('deve ligar o aviso do desconto ao botão "Escrever evolução" (A11Y-EVO-03)', async () => {
    // ARRANGE
    mockDaSessao({ finalizada: true, motivo: null })

    // ACT
    renderizarDaSessao()

    // ASSERT — quem chega pelo Tab ouve o efeito no pacote junto do botão
    expect(await screen.findByRole('button', { name: 'Escrever evolução' })).toHaveAccessibleDescription(/desconta do pacote/)
  })

  it('deve avisar o desconto também na sessão já registrada sem evolução (CR-EVO-05)', async () => {
    // ARRANGE — o caminho de hoje: a recepção registrou, a profissional escreve depois
    mockDaSessao({ finalizada: true, motivo: null })
    servidor.use(msw.get('/api/atendimentos', () => HttpResponse.json(pagina([atendimentoDaLista({ evolucao_id: null })]))))

    // ACT
    renderizarDaSessao()

    // ASSERT
    expect(await screen.findByText('Ao salvar a evolução, a sessão é finalizada — e desconta do pacote.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Escrever evolução' })).toHaveAccessibleDescription(/desconta do pacote/)
  })

  it('deve levar o foco para dentro do diálogo ao abrir (A11Y-EVO-01)', async () => {
    // ARRANGE — o padrão do AlertDialog foca um Cancel que este diálogo não tem: o foco ficava atrás
    mockDaSessao({ finalizada: true, motivo: null })
    const usuario = userEvent.setup()
    renderizarDaSessao()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Escrever evolução' }))

    // ASSERT
    const dialogo = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dialogo).getByRole('textbox', { name: /Evolução da sessão/ })).toHaveFocus()
    })
    expect(dialogo).toHaveAccessibleDescription(/finalizada e desconta do pacote/)
  })

  it('deve levar o foco ao registro depois de "Registrar atendimento" (A11Y-EVO-02)', async () => {
    // ARRANGE — o botão some quando a sessão é registrada; o foco voltava ao topo do painel
    let registrado = false
    mockDaSessao({ finalizada: true, motivo: null })
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(pagina(registrado ? [atendimentoDaLista()] : []))),
      msw.post('/api/agendamentos/:id/atendimento', () => {
        registrado = true
        return HttpResponse.json(atendimentoDoDetalhe(), { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizarDaSessao()
    await usuario.click(await screen.findByRole('button', { name: 'Registrar sem evolução' }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Registrar atendimento' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Sessão registrada' })).toHaveFocus()
    })
  })

  it('deve fazer o grupo do registro dizer a recusa ao receber o foco (A11Y-EVO-05)', async () => {
    // ARRANGE
    mockDaSessao({ finalizada: false, motivo: 'Pacote fictício sem saldo.' })
    const usuario = userEvent.setup()
    renderizarDaSessao()

    // ACT
    await escreverESalvar(usuario)

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Sessão registrada' })).toHaveAccessibleDescription(/Pacote fictício sem saldo/)
    })
  })

  it('deve tirar a recusa quando o status da sessão muda pelo chip (CR-EVO-13)', async () => {
    // ARRANGE
    mockDaSessao({ finalizada: false, motivo: 'Pacote fictício sem saldo.' })
    const usuario = userEvent.setup()
    const { rerender } = renderizarDaSessao()
    await escreverESalvar(usuario)
    await screen.findByText('Pacote fictício sem saldo.', { exact: false, selector: 'p' })

    // ACT — alguém finalizou pelo chip: o painel passa o status novo
    rerender(elementoDaSessao({ statusAtualId: 4 }))

    // ASSERT
    expect(screen.queryByText('A sessão não foi finalizada:', { exact: false, selector: 'strong' })).not.toBeInTheDocument()
  })

  it.each([
    [true, 1],
    [false, 0],
  ])('deve avisar quem mostra o cartão só quando a sessão foi finalizada (finalizada: %s) (CR-EVO-03)', async (finalizada, chamadas) => {
    // ARRANGE — o painel e o Editar trocam a foto pelo cartão da grade, que a invalidação já releu
    mockDaSessao({ finalizada, motivo: finalizada ? null : 'Pacote fictício sem saldo.' })
    const aoFinalizar = vi.fn()
    const usuario = userEvent.setup()
    renderizarDaSessao({ aoFinalizar })

    // ACT
    await escreverESalvar(usuario)
    await screen.findByText(/^Evolução salva/)

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(aoFinalizar).toHaveBeenCalledTimes(chamadas)
  })

  it.each([
    [true, true],
    [false, false],
  ])('deve atualizar a grade só quando a sessão foi finalizada (finalizada: %s → invalida: %s) (CR-EVO-08)', async (finalizada, invalida) => {
    // ARRANGE
    mockDaSessao({ finalizada, motivo: finalizada ? null : 'Pacote fictício sem saldo.' })
    const invalidacoes = vi.spyOn(queryClient, 'invalidateQueries')
    const usuario = userEvent.setup()
    renderizarDaSessao()

    // ACT
    await escreverESalvar(usuario)
    await screen.findByText(/^Evolução salva/)

    // ASSERT
    const daAgenda = invalidacoes.mock.calls.filter(([filtro]) => JSON.stringify(filtro?.queryKey) === JSON.stringify(['agenda']))
    expect(daAgenda.length > 0).toBe(invalida)
    invalidacoes.mockRestore()
  })

  it('deve dizer, antes do clique, que o pacote sem saldo não deixa finalizar', async () => {
    // ARRANGE — observação do gate de acessibilidade (r2): o aviso prometia o desconto, e o servidor recusava
    mockDaSessao({ finalizada: false, motivo: 'Pacote fictício sem saldo.' })

    // ACT
    renderizarDaSessao({ pacoteSemSaldo: true })

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Escrever evolução' })).toHaveAccessibleDescription(/sem saldo, e a sessão não será finalizada/)
    expect(screen.queryByText(/desconta do pacote/)).not.toBeInTheDocument()
  })

  it('deve avisar o desconto no ramo registrado também para quem só escreve evolução (CR-EVO-R2-05)', async () => {
    // ARRANGE — sem `atendimentos.criar`: não registra, mas escreve a evolução da sessão já registrada
    mockDaSessao({ finalizada: true, motivo: null })
    servidor.use(msw.get('/api/atendimentos', () => HttpResponse.json(pagina([atendimentoDaLista({ evolucao_id: null })]))))

    // ACT
    renderizarDaSessao({ permissoes: TUDO.filter((permissao) => permissao !== 'atendimentos.criar') })

    // ASSERT
    expect(await screen.findByText('Ao salvar a evolução, a sessão é finalizada — e desconta do pacote.')).toBeInTheDocument()
  })

  it('deve pedir para salvar de novo, e manter o texto, quando a sessão estava sendo alterada (CR-EVO-R2-03)', async () => {
    // ARRANGE — o 409 da corrida pela sessão: nada foi salvo; "Recarregue" faria perder o que foi escrito
    mockDaSessao({ finalizada: true, motivo: null })
    servidor.use(
      msw.post('/api/agendamentos/:id/evolucao', () =>
        HttpResponse.json({ message: 'O ciclo está sendo alterado.', erro: 'ciclo_em_alteracao' }, { status: 409 }),
      ),
    )
    const usuario = userEvent.setup()
    renderizarDaSessao()

    // ACT
    await escreverESalvar(usuario)

    // ASSERT
    const dialogo = await screen.findByRole('alertdialog')
    expect(await within(dialogo).findByText(/nada foi salvo\. O texto continua aqui: salve de novo/)).toBeInTheDocument()
    expect(within(dialogo).getByRole('textbox', { name: /Evolução da sessão/ })).toHaveValue('Evolução fictícia.')
  })

  it('deve passar no axe com o registro sem evolução aberto', async () => {
    // ARRANGE
    mockDaSessao({ finalizada: true, motivo: null })
    const usuario = userEvent.setup()
    const { container } = renderizarDaSessao()
    await usuario.click(await screen.findByRole('button', { name: 'Registrar sem evolução' }))

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
