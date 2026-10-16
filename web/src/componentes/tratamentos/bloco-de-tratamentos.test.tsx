import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { BlocoDeTratamentos } from '@/componentes/tratamentos/bloco-de-tratamentos'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Convenio, TratamentoDaLista, TratamentoDetalhe } from '@/tipos'

const TUDO = ['tratamentos.ver', 'tratamentos.criar', 'tratamentos.editar', 'tratamentos.excluir']

/**
 * A LISTAGEM na forma REAL do servidor (`CAMPOS_LISTAGEM` + derivados do pedido).
 *
 * Sem `matricula`, `guia`, `pedido_emitido_em` nem `pedido_sessoes_por_semana`: são
 * detail-only (minimização SEC-LP-02/03). Foi a fixture MENTINDO sobre isso que deixou a
 * linha do pedido MORTA em produção com a suíte verde — o componente lia a emissão, que
 * na lista real nunca chega (gate B2, a mesma classe do `FeriadoDaAgenda`).
 *
 * Os DERIVADOS saem nas duas superfícies: a data-limite e o VEREDITO `pedido_vencido`,
 * decidido no servidor, no fuso da clínica.
 */
function tratamento(sobrescritas: Partial<TratamentoDaLista> = {}): TratamentoDaLista {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    paciente_id: 10,
    convenio_id: 1,
    especialidade_id: 1,
    profissional_id: 1,
    servico_id: null,
    sessoes_total: 10,
    sessoes_realizadas: 9,
    realce: 'nenhum' as const,
    sessoes_saldo: 1,
    vencido: false,
    data_inicio: '2026-06-01',
    validade_dias: 180,
    // null/false = tratamento sem pedido — o ciclo do pacote não muda (SEC-LP-11)
    pedido_vence_em: null,
    pedido_vencido: false,
    status: 'andamento',
    ...sobrescritas,
  }
}

/**
 * O DETALHE (`GET /api/tratamentos/{id}`) — a ÚNICA superfície com os campos que o
 * formulário hidrata. É por isso que a edição carrega o detalhe, nunca o item da lista.
 */
function detalhe(sobrescritas: Partial<TratamentoDetalhe> = {}): TratamentoDetalhe {
  return {
    ...tratamento(),
    matricula: null,
    guia: null,
    pedido_emitido_em: null,
    pedido_sessoes_por_semana: null,
    ...sobrescritas,
  }
}

function pagina(itens: TratamentoDaLista[]) {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

/** Os catálogos que os selects obrigatórios do formulário precisam ter. */
function catalogosFicticios() {
  return [
    msw.get('/api/convenios', () =>
      HttpResponse.json([
        // `satisfies Convenio`: fixture que mente sobre a forma do servidor foi a
        // causa do B2 (superfície morta em produção com o teste verde) — aqui o
        // compilador cobra o campo novo em vez de deixar a fixture envelhecer.
        {
          id: 1,
          nome: 'Unimed Fictícia',
          particular: false,
          ativo: true,
          registro_ans: null,
          codigo_operadora: null,
          versao_tiss: null,
          guia_sequencial: false,
          alerta_agend_mesmo_dia: false,
          flags_tiss_json: null,
          pedido_validade_meses: null,
          ciclo_dia_corte: null,
          ciclo_tipo_corte: null,
          updated_at: '2026-01-01T00:00:00.000000Z',
        } satisfies Convenio,
      ]),
    ),
    msw.get('/api/especialidades', () =>
      HttpResponse.json([
        {
          id: 1,
          nome: 'Fonoaudiologia',
          cor: '#A85550',
          tempo_sessao: 40,
          exige_termo: false,
          oculta_agendamento_online: false,
        },
      ]),
    ),
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
    msw.get('/api/convenios/:id/servicos', () => HttpResponse.json([])),
  ]
}

function renderizar(
  permissoes: string[] = TUDO,
  padraoDoCadastro?: { convenioId: number | null; carteirinha: string | null },
) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <BlocoDeTratamentos pacienteId={10} padraoDoCadastro={padraoDoCadastro} />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Tratamentos na criança — o saldo é do servidor', () => {
  it('deve exibir o saldo que o servidor mandou, sem refazer a conta', async () => {
    // ARRANGE: o servidor manda um `sessoes_saldo` que NÃO bate com total-realizadas.
    // A tela tem que mostrar o do servidor — é o mesmo número que a agenda usa para
    // recusar um agendamento sem sessões. Duas contas para o mesmo número garantem que
    // uma delas está errada na hora errada.
    servidor.use(
      msw.get('/api/tratamentos', () =>
        HttpResponse.json(
          pagina([
            tratamento({
              sessoes_total: 10,
              sessoes_realizadas: 4,
              sessoes_saldo: 1,
              // o SELO também vem decidido do servidor (§13 — o limiar é dado da clínica);
              // a tela não o recalcula a partir do saldo
              realce: 'acabando',
            }),
          ]),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT: o alerta de "última sessão" vem do saldo DO SERVIDOR (1), não de 10-4
    expect(await screen.findByText('Última sessão')).toBeInTheDocument()
  })

  it('deve marcar como vencido porque o servidor disse — não por comparar datas aqui', async () => {
    // ARRANGE: a data de início é recente; só o `vencido` do servidor manda (ele usa o
    // fuso da CLÍNICA, e o navegador da recepcionista pode estar em outro)
    servidor.use(
      msw.get('/api/tratamentos', () =>
        HttpResponse.json(pagina([tratamento({ data_inicio: '2026-07-01', vencido: true })])),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Vencido')).toBeInTheDocument()
  })
})

describe('Tratamentos na criança — o que a tela NÃO faz', () => {
  it('deve não oferecer campo de sessões realizadas', async () => {
    // ARRANGE: o único caminho de escrita dela é a reconciliação do atendimento
    servidor.use(msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento()]))))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('button', { name: /Novo tratamento/i })

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Novo tratamento/i }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(within(dialog).queryByLabelText(/sessões realizadas/i)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('spinbutton', { name: /Total de sessões/i })).toBeInTheDocument()
  })

  it('deve não oferecer troca de paciente — o pacote é da criança da página', async () => {
    // ARRANGE: o servidor recusa a troca; a tela nem oferece o botão
    servidor.use(msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento()]))))
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(within(dialog).queryByLabelText(/paciente/i)).not.toBeInTheDocument()
  })

  it('deve sumir INTEIRO — e não consultar — para quem não tem tratamentos.ver', async () => {
    // ARRANGE: o bloco é de OUTRO módulo que o cadastro do paciente. Antes, o teste só
    // conferia que o botão sumia — mas o título, a lista e o próprio `GET` continuavam de
    // pé (e voltariam 403). O bloco tem que se defender sozinho (gate CR-TR-07).
    let consultou = false
    servidor.use(
      msw.get('/api/tratamentos', () => {
        consultou = true
        return HttpResponse.json(pagina([tratamento()]))
      }),
    )

    // ACT
    renderizar(['pacientes.ver'])
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Novo tratamento/i })).not.toBeInTheDocument()
    })

    // ASSERT: nada do bloco existe, e a consulta nem sai
    expect(screen.queryByRole('heading', { name: 'Tratamentos' })).not.toBeInTheDocument()
    expect(consultou).toBe(false)
  })
})

describe('Tratamentos na criança — o payload real', () => {
  it('deve enviar a data no formato exato e NUNCA mandar sessoes_realizadas', async () => {
    // ARRANGE: `toISOString()` acrescentaria hora e "Z" — foi assim que TODO cadastro com
    // consentimento levou 422 numa change passada, com a suíte verde
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([]))),
      msw.get('/api/convenios', () =>
        HttpResponse.json([
          {
            id: 1,
            nome: 'Particular',
            particular: true,
            ativo: true,
            registro_ans: null,
            codigo_operadora: null,
            versao_tiss: null,
            guia_sequencial: false,
            alerta_agend_mesmo_dia: false,
            flags_tiss_json: null,
          },
        ]),
      ),
      msw.get('/api/especialidades', () =>
        HttpResponse.json([
          {
            id: 1,
            nome: 'Fonoaudiologia',
            cor: '#A85550',
            tempo_sessao: 40,
            exige_termo: false,
            oculta_agendamento_online: false,
          },
        ]),
      ),
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
      msw.get('/api/convenios/:id/servicos', () => HttpResponse.json([])),
      msw.post('/api/tratamentos', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(detalhe(), { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await usuario.click(await screen.findByRole('button', { name: /Novo tratamento/i }))
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByRole('option', { name: 'Particular' })

    // ACT: o formulário só submete completo — os três obrigatórios são de verdade
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Convênio/i }), '1')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Especialidade/i }), '1')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Profissional/i }), '1')
    await usuario.type(within(dialog).getByLabelText(/^Início/i), '2026-08-03')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    // `data_inicio: '2026-08-03'` já PROVA a ausência de hora e de "Z"
    expect(corpo).toMatchObject({ paciente_id: 10, data_inicio: '2026-08-03' })
    expect(corpo).not.toHaveProperty('sessoes_realizadas')
    // `tipo` também não vai — a API deixou de aceitá-lo (SEC-TR-17), e antes disso
    // mandar `null` nele derrubava TODO cadastro com 422
    expect(corpo).not.toHaveProperty('tipo')
  })
})

describe('Tratamentos na criança — o detalhe do convênio não se apaga sozinho', () => {
  it('deve preservar matrícula e guia ao editar sem tocá-las', async () => {
    // ARRANGE: a LISTAGEM omite `matricula` e `guia` (minimização — são identificadores
    // do MENOR no convênio). Montar o formulário sobre o item da lista fazia os dois
    // nascerem vazios e o PUT gravar `null` por cima: o dado sumia em silêncio, na
    // operação mais corriqueira da tela, e SEM recuperação (a auditoria mascara
    // justamente esses campos). Por isso a edição carrega o DETALHE (gate SEC-TR-14).
    let corpo: Record<string, unknown> | null = null
    // a fixture da lista JÁ não tem matrícula nem guia — é o tipo que garante agora
    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento()]))),
      // o DETALHE é quem tem os identificadores
      msw.get('/api/tratamentos/:id', () =>
        HttpResponse.json(detalhe({ matricula: 'MAT-1', guia: 'G-1' })),
      ),
      msw.get('/api/convenios', () =>
        HttpResponse.json([
          {
            id: 1,
            nome: 'Unimed Fictícia',
            particular: false,
            ativo: true,
            registro_ans: null,
            codigo_operadora: null,
            versao_tiss: null,
            guia_sequencial: false,
            alerta_agend_mesmo_dia: false,
            flags_tiss_json: null,
          },
        ]),
      ),
      msw.get('/api/especialidades', () =>
        HttpResponse.json([
          {
            id: 1,
            nome: 'Fonoaudiologia',
            cor: '#A85550',
            tempo_sessao: 40,
            exige_termo: false,
            oculta_agendamento_online: false,
          },
        ]),
      ),
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
      msw.get('/api/convenios/:id/servicos', () => HttpResponse.json([])),
      msw.put('/api/tratamentos/:id', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(detalhe())
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT: editar mexendo SÓ no total de sessões
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    // o campo tem que estar PREENCHIDO — sem isso não dá nem para ver o que se edita
    const matricula = await within(dialog).findByRole('textbox', { name: /Matrícula/i })
    expect(matricula).toHaveValue('MAT-1')

    const total = within(dialog).getByRole('spinbutton', { name: /Total de sessões/i })
    await usuario.clear(total)
    await usuario.type(total, '20')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: o payload leva os identificadores INTACTOS
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toMatchObject({ sessoes_total: 20, matricula: 'MAT-1', guia: 'G-1' })
  })
})

describe('Tratamentos na criança — reabrir o formulário não reverte a edição', () => {
  it('deve levar a matrícula NOVA no segundo salvamento seguido', async () => {
    // ARRANGE: com o `gcTime` padrão de 5 min, reabrir o formulário monta sobre o CACHE
    // VELHO — o `useState` inicializa UMA vez, e o `useQuery` já devolve `isSuccess` no
    // primeiro render. A segunda edição seguida REVERTIA a primeira — matrícula e guia de um
    // MENOR inclusive, num campo que a auditoria mascara. "Editei, olhei, editei de novo" é
    // o gesto mais banal da recepção (gate CR-TR-02).
    //
    // A chave já foi consertada (`['tratamentos', id]` é alcançada pela invalidação da
    // lista), mas isso NÃO substitui o `gcTime: 0`: query inativa invalidada só fica stale, e
    // o primeiro render do remount ainda serve o cache. Este teste prende o COMPORTAMENTO —
    // a guarda da fábrica prende a FORMA da chave. Uma camada só seria proxy.
    const enviados: Array<Record<string, unknown>> = []
    let noServidor = detalhe({ matricula: 'MAT-1', guia: 'G-1' })

    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento()]))),
      msw.get('/api/tratamentos/:id', () => HttpResponse.json(noServidor)),
      ...catalogosFicticios(),
      msw.put('/api/tratamentos/:id', async ({ request }) => {
        const corpo = (await request.json()) as Record<string, unknown>
        enviados.push(corpo)
        noServidor = { ...noServidor, ...(corpo as Partial<TratamentoDetalhe>) }
        return HttpResponse.json(noServidor)
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT 1: troca a matrícula
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    let dialog = await screen.findByRole('alertdialog')
    const matricula = await within(dialog).findByRole('textbox', { name: /Matrícula/i })
    await usuario.clear(matricula)
    await usuario.type(matricula, 'MAT-2')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => {
      expect(enviados).toHaveLength(1)
    })

    // ACT 2: REABRE e mexe só na validade
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    dialog = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(within(dialog).getByRole('textbox', { name: /Matrícula/i })).toHaveValue('MAT-2')
    })
    const validade = within(dialog).getByRole('spinbutton', { name: /Validade/i })
    await usuario.clear(validade)
    await usuario.type(validade, '90')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: o segundo PUT leva a matrícula NOVA — não a do cache velho
    await waitFor(() => {
      expect(enviados).toHaveLength(2)
    })
    expect(enviados[1]).toMatchObject({ matricula: 'MAT-2', guia: 'G-1' })
  })
})

describe('Tratamentos na criança — pedido médico (limites-e-pedidos)', () => {
  it('deve mostrar o vencimento DERIVADO que veio na LISTAGEM', async () => {
    // ARRANGE — `pedido_vence_em` chega PRONTO do servidor (emissão + validade em meses
    // do convênio, fuso da clínica): a tela exibe, nunca refaz a conta. A emissão NÃO vem
    // na lista (detail-only), então a linha não fala dela — foi pedi-la aqui que deixou
    // este componente morto em produção.
    servidor.use(
      msw.get('/api/tratamentos', () =>
        HttpResponse.json(
          pagina([tratamento({ pedido_vence_em: '2099-12-01', pedido_vencido: false })]),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Pedido médico vence em 01/12/2099')).toBeInTheDocument()
  })

  it('deve marcar o pedido VENCIDO em tom de perigo, com ícone e orientação', async () => {
    // ARRANGE — o veredito é do SERVIDOR (`pedido_vencido`), não de uma conta local
    servidor.use(
      msw.get('/api/tratamentos', () =>
        HttpResponse.json(
          pagina([tratamento({ pedido_vence_em: '2020-01-10', pedido_vencido: true })]),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — palavra + ícone (canal não-só-cor), tom de perigo
    const aviso = await screen.findByText(/Pedido médico vencido em 10\/01\/2020/)
    expect(aviso).toHaveClass('text-perigo-texto')
    expect(aviso.querySelector('svg')).not.toBeNull()
  })

  it('deve obedecer ao veredito do SERVIDOR mesmo com a data no futuro', async () => {
    // ARRANGE — a data-limite é lá em 2099 e o servidor diz VENCIDO. Comparar `Y-m-d`
    // aqui diria o contrário: era o que a tela fazia, com o fuso PADRÃO cravado no código
    // (achado I4). Quem conhece o fuso da clínica é o servidor — a virada do dia na
    // recepcionista de outro fuso não pode mudar o que a tela afirma.
    servidor.use(
      msw.get('/api/tratamentos', () =>
        HttpResponse.json(
          pagina([tratamento({ pedido_vence_em: '2099-12-01', pedido_vencido: true })]),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(
      await screen.findByText(/Pedido médico vencido em 01\/12\/2099/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Pedido médico vence em 01/12/2099')).not.toBeInTheDocument()
  })

  it('deve não prometer vencimento quando o convênio não tem validade em meses', async () => {
    // ARRANGE — sem `pedido_validade_meses` o servidor não deriva data-limite: sem
    // alarme falso, e sem linha (a emissão é detail-only, não há o que dizer na lista)
    servidor.use(
      msw.get('/api/tratamentos', () =>
        HttpResponse.json(pagina([tratamento({ pedido_vence_em: null })])),
      ),
    )

    // ACT
    renderizar()
    await screen.findByText('9/10 sessões')

    // ASSERT
    expect(screen.queryByText(/Pedido médico/)).not.toBeInTheDocument()
  })

  it('deve degradar em silêncio se a listagem NÃO trouxer os campos do pedido', async () => {
    // ARRANGE — o servidor de um deploy antigo (ou um serializer que mude) devolve a
    // listagem SEM `pedido_vence_em`/`pedido_vencido`. A tela tem que se comportar como
    // "sem pedido": nada de linha, nada de `undefined` formatado, nada quebrado. É a
    // guarda contra o inverso do gate B2 — o tipo promete, a API não manda.
    const semOsCampos = tratamento()
    delete (semOsCampos as Partial<TratamentoDaLista>).pedido_vence_em
    delete (semOsCampos as Partial<TratamentoDaLista>).pedido_vencido

    servidor.use(msw.get('/api/tratamentos', () => HttpResponse.json(pagina([semOsCampos]))))

    // ACT
    renderizar()

    // ASSERT — o pacote aparece inteiro; só a linha do pedido não existe
    expect(await screen.findByText('9/10 sessões')).toBeInTheDocument()
    expect(screen.queryByText(/Pedido médico/)).not.toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })

  it('deve não mostrar nada de pedido quando o tratamento não tem', async () => {
    // ARRANGE — default: sem pedido, o ciclo segue como hoje (delta spec)
    servidor.use(msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento()]))))

    // ACT
    renderizar()
    await screen.findByText('9/10 sessões')

    // ASSERT
    expect(screen.queryByText(/Pedido médico/)).not.toBeInTheDocument()
  })

  it('deve enviar os campos do pedido no payload real (Y-m-d cru e número)', async () => {
    // ARRANGE
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([]))),
      ...catalogosFicticios(),
      msw.post('/api/tratamentos', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(detalhe(), { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await usuario.click(await screen.findByRole('button', { name: /Novo tratamento/i }))
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByRole('option', { name: 'Unimed Fictícia' })

    // ACT
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Convênio/i }), '1')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Especialidade/i }), '1')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Profissional/i }), '1')
    await usuario.type(within(dialog).getByLabelText(/Pedido médico emitido em/i), '2026-07-01')
    await usuario.type(
      within(dialog).getByRole('spinbutton', { name: /Sessões por semana do pedido/i }),
      '2',
    )
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — data crua (sem hora nem "Z") e inteiro; `pedido_vence_em` NUNCA vai
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toMatchObject({ pedido_emitido_em: '2026-07-01', pedido_sessoes_por_semana: 2 })
    expect(corpo).not.toHaveProperty('pedido_vence_em')
  })

  it('deve mandar null nos campos do pedido quando ficam vazios', async () => {
    // ARRANGE — tratamento sem pedido é o caso de hoje: nada muda (SEC-LP-11)
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([]))),
      ...catalogosFicticios(),
      msw.post('/api/tratamentos', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(detalhe(), { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await usuario.click(await screen.findByRole('button', { name: /Novo tratamento/i }))
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByRole('option', { name: 'Unimed Fictícia' })

    // ACT — só os obrigatórios; o pedido fica em branco
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Convênio/i }), '1')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Especialidade/i }), '1')
    await usuario.selectOptions(within(dialog).getByRole('combobox', { name: /Profissional/i }), '1')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toMatchObject({ pedido_emitido_em: null, pedido_sessoes_por_semana: null })
  })

  it('deve preservar o pedido ao editar sem tocá-lo (a lição da matrícula)', async () => {
    // ARRANGE — hidratar o pedido vazio faria o PUT gravar null por cima na edição
    // mais banal (a mesma classe do SEC-TR-14)
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento()]))),
      msw.get('/api/tratamentos/:id', () =>
        HttpResponse.json(
          detalhe({ pedido_emitido_em: '2026-06-01', pedido_sessoes_por_semana: 2 }),
        ),
      ),
      ...catalogosFicticios(),
      msw.put('/api/tratamentos/:id', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(detalhe())
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT — edita mexendo SÓ no total de sessões
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const emissao = await within(dialog).findByLabelText(/Pedido médico emitido em/i)
    expect(emissao).toHaveValue('2026-06-01')
    const total = within(dialog).getByRole('spinbutton', { name: /Total de sessões/i })
    await usuario.clear(total)
    await usuario.type(total, '20')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT — o pedido vai INTACTO
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toMatchObject({
      sessoes_total: 20,
      pedido_emitido_em: '2026-06-01',
      pedido_sessoes_por_semana: 2,
    })
  })

  it('deve explicar que o override do pedido substitui a regra semanal do convênio', async () => {
    // ARRANGE — o campo não é autoexplicativo: sem a ajuda, ninguém sabe que ele
    // VENCE a regra-default `semana` do convênio (caso Pladisa, D4)
    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([]))),
      ...catalogosFicticios(),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Novo tratamento/i }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(
      within(dialog).getByText(/substitui a regra semanal do convênio/),
    ).toBeInTheDocument()
  })
})

describe('Tratamentos na criança — a exclusão recusada', () => {
  it('deve mostrar a recusa no diálogo e manter o tratamento na lista', async () => {
    // ARRANGE: pacote com sessões consumidas ou agendamentos NÃO se exclui
    servidor.use(
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento()]))),
      msw.delete('/api/tratamentos/:id', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: {
              tratamento: ['Tratamento com sessões realizadas não pode ser excluído.'],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('9/10 sessões')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: /Excluir tratamento/i }))

    // ASSERT
    expect(
      await within(dialog).findByText('Tratamento com sessões realizadas não pode ser excluído.'),
    ).toBeInTheDocument()
    expect(screen.getByText('9/10 sessões')).toBeInTheDocument()
  })
})

/**
 * O PACOTE NOVO PARTE DO CADASTRO (change convenio-no-cadastro-do-paciente, D2/D3).
 *
 * Pré-preencher é conveniência, não trava: a criança que é convênio na fono e particular
 * na psico existe, e quem abre o pacote tem de poder dizer isso. O que for salvo vale
 * para AQUELE tratamento, e trocar o convênio do cadastro depois não o alcança.
 */
describe('Tratamentos — o pacote novo herda o convênio do cadastro', () => {
  /** DOIS convênios: sem o segundo, "herdou do cadastro" e "leu do pacote" são a mesma coisa. */
  function doisConvenios() {
    const molde = {
      particular: false,
      ativo: true,
      registro_ans: null,
      codigo_operadora: null,
      versao_tiss: null,
      guia_sequencial: false,
      alerta_agend_mesmo_dia: false,
      flags_tiss_json: null,
      pedido_validade_meses: null,
      ciclo_dia_corte: null,
      ciclo_tipo_corte: null,
      updated_at: '2026-01-01T00:00:00.000000Z',
    }
    return msw.get('/api/convenios', () =>
      HttpResponse.json([
        { ...molde, id: 1, nome: 'Unimed Fictícia' } satisfies Convenio,
        { ...molde, id: 2, nome: 'Convênio Fictício B' } satisfies Convenio,
      ]),
    )
  }

  it('deve abrir a criação já com o convênio e a carteirinha da criança', async () => {
    // ARRANGE
    servidor.use(doisConvenios(), msw.get('/api/tratamentos', () => HttpResponse.json(pagina([]))))
    const usuario = userEvent.setup()
    renderizar(TUDO, { convenioId: 2, carteirinha: '778899' })

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Novo tratamento/i }))
    const dialogo = await screen.findByRole('alertdialog')
    await within(dialogo).findByRole('option', { name: 'Convênio Fictício B' })

    // ASSERT — os dois vêm preenchidos, sem ninguém digitar
    expect(within(dialogo).getByRole('combobox', { name: /Convênio/i })).toHaveValue('2')
    expect(within(dialogo).getByRole('textbox', { name: /Matrícula/i })).toHaveValue('778899')
  })

  it('deve abrir a criação EM BRANCO quando a criança não tem convênio no cadastro', async () => {
    // ARRANGE — paciente particular, ou recém-cadastrado: não herda nada, e não é impedido
    servidor.use(doisConvenios(), msw.get('/api/tratamentos', () => HttpResponse.json(pagina([]))))
    const usuario = userEvent.setup()
    renderizar(TUDO, { convenioId: null, carteirinha: null })

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Novo tratamento/i }))
    const dialogo = await screen.findByRole('alertdialog')
    await within(dialogo).findByRole('option', { name: 'Convênio Fictício B' })

    // ASSERT
    expect(within(dialogo).getByRole('combobox', { name: /Convênio/i })).toHaveValue('')
    expect(within(dialogo).getByRole('textbox', { name: /Matrícula/i })).toHaveValue('')
  })

  it('NÃO deve herdar o convênio do cadastro ao EDITAR um pacote existente', async () => {
    /*
     * ARRANGE — o pacote guarda o que valia quando foi vendido. Herdar na edição
     * reescreveria o histórico com o convênio de hoje, e o fechamento de ciclo passaria a
     * mentir: um pacote de junho na Unimed viraria particular retroativamente.
     *
     * Cadastro no convênio 2, pacote no 1 — a divergência é o ponto do teste.
     */
    servidor.use(
      doisConvenios(),
      msw.get('/api/tratamentos', () => HttpResponse.json(pagina([tratamento({ convenio_id: 1 })]))),
      msw.get('/api/tratamentos/1', () =>
        HttpResponse.json(detalhe({ convenio_id: 1, matricula: '111000' })),
      ),
    )
    const usuario = userEvent.setup()
    renderizar(TUDO, { convenioId: 2, carteirinha: '778899' })

    // ACT — abre a EDIÇÃO, não a criação
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialogo = await screen.findByRole('alertdialog')
    await within(dialogo).findByRole('option', { name: 'Convênio Fictício B' })

    // ASSERT — o que aparece é o do PACOTE, não o do cadastro
    expect(within(dialogo).getByRole('combobox', { name: /Convênio/i })).toHaveValue('1')
    expect(within(dialogo).getByRole('textbox', { name: /Matrícula/i })).toHaveValue('111000')
  })
})
