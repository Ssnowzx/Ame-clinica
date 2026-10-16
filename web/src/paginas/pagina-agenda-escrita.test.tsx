import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { delay, HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import {
  cardFicticio,
  DIA_FICTICIO,
  handlersDaAgenda,
  SELECAO_FICTICIA,
  TRATAMENTOS_DO_PACIENTE,
} from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CardAgendamento } from '@/tipos'

expect.extend(toHaveNoViolations)

const PERMISSOES = ['agenda.ver', 'agenda.criar', 'agenda.editar', 'agenda.excluir']

function renderizarAgenda(cards: CardAgendamento[] = []) {
  servidor.use(...handlersDaAgenda(cards))
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes: PERMISSOES },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** Abre o formulário pelo primeiro horário livre da grade. */
async function marcarNoPrimeiroSlot(usuario: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('table')
  const slots = screen.getAllByRole('button', { name: /^Marcar às/ })
  await usuario.click(slots[0])
  return screen.findByRole('alertdialog')
}

/**
 * Abre a EDIÇÃO de um agendamento existente: clicar no card abre o PAINEL DE
 * LEITURA, e a edição é destino — "Mais ações → Editar" abre o formulário.
 */
async function abrirEdicao(usuario: ReturnType<typeof userEvent.setup>, nome = 'Paciente Fictício') {
  await usuario.click(screen.getByRole('button', { name: nome }))
  const painel = await screen.findByRole('dialog')
  await usuario.click(within(painel).getByRole('button', { name: 'Mais ações' }))
  await usuario.click(await screen.findByRole('menuitem', { name: 'Editar' }))
  return screen.findByRole('alertdialog')
}

/** Preenche o mínimo obrigatório (paciente e especialidade). */
async function preencherObrigatorios(usuario: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Pac')
  await usuario.click(await screen.findByRole('option', { name: 'Paciente Fictício' }))
  await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '1')
}

beforeEach(() => {
  queryClient.clear()
})

describe('Agenda — marcar pelo horário livre', () => {
  it('deve abrir o formulário com profissional e hora do slot', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()

    // ACT
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ASSERT: é assim que a recepção marca — sem redigitar o que já sabe
    expect(within(dialog).getByRole('heading', { name: 'Novo agendamento' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Profissional/)).toHaveValue('1')
    expect(within(dialog).getByLabelText(/^Hora/)).toHaveValue('08:00')
  })

  it('deve oferecer marcar também na visão Semana (I-03)', async () => {
    // ARRANGE: na Semana as colunas são DIAS — o profissional é o da visão.
    // Antes, o botão simplesmente não existia nessa visão.
    const usuario = userEvent.setup()
    servidor.use(...handlersDaAgenda([]))
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: PERMISSOES },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={[`/agenda?visao=semana&data=${DIA_FICTICIO}`]}>
            <PaginaAgenda />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await screen.findByRole('table')

    // ACT
    const slots = screen.getAllByRole('button', { name: /^Marcar às/ })
    await usuario.click(slots[0])

    // ASSERT
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByLabelText(/Profissional/)).toHaveValue('1')
  })

  it('deve não convidar a marcar quem não tem agenda.criar', async () => {
    // ARRANGE
    servidor.use(...handlersDaAgenda([]))
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'] },
      carregandoSessao: false,
    })

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}`]}>
            <PaginaAgenda />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await screen.findByRole('table')

    // ASSERT
    expect(screen.queryByRole('button', { name: /^Marcar às/ })).not.toBeInTheDocument()
  })
})

describe('Agenda — a busca não mente enquanto espera', () => {
  it('deve não dizer "nenhum resultado" antes de a busca rodar', async () => {
    // ARRANGE: o debounce cria uma janela em que a busca ainda não saiu. Sem
    // contá-la como carregando, o campo anunciaria "nenhum resultado" para um
    // paciente que existe — e a lista sumiria a cada tecla.
    const usuario = userEvent.setup()
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT: digita e olha IMEDIATAMENTE (dentro da janela do debounce)
    await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Pa')

    // ASSERT
    expect(screen.queryByText(/Nenhum resultado/)).not.toBeInTheDocument()

    // e, passada a espera, o paciente aparece
    expect(await screen.findByRole('option', { name: 'Paciente Fictício' })).toBeInTheDocument()
  })
})

describe('Agenda — a ajuda da duração diz a verdade', () => {
  it('deve prometer herança da especialidade só na criação', async () => {
    // ARRANGE + ACT
    const usuario = userEvent.setup()
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '1')

    // ASSERT
    expect(within(dialog).getByText(/herda 40 min da especialidade/)).toBeInTheDocument()
  })

  it('deve prometer preservação da duração na edição', async () => {
    // ARRANGE: depois do gate, a API PRESERVA a duração na edição parcial —
    // prometer herança aqui faria o usuário encolher a sessão sem querer
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7, duracao_minutos: 90 })])

    // ACT
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)

    // ASSERT
    expect(within(dialog).getByText(/mantém a duração atual \(90 min\)/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/herda/)).not.toBeInTheDocument()
  })
})

describe('Agenda — criar', () => {
  it('deve enviar o agendamento e confirmar ao usuário', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/agendamentos', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT: escolhe paciente pela busca e a especialidade
    await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Pac')
    await usuario.click(await screen.findByRole('option', { name: 'Paciente Fictício' }))
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '1')
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({
      tipo: 'atendimento',
      profissional_id: 1,
      paciente_id: 10,
      especialidade_id: 1,
      inicio: `${DIA_FICTICIO} 08:00`,
    })
    expect(await screen.findByText('Agendamento criado.')).toBeInTheDocument()
  })

  it('deve mostrar a recusa do servidor no campo que a causou', async () => {
    // ARRANGE: a recusa mais comum do balcão
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/agendamentos', () =>
        HttpResponse.json({ errors: { profissional_id: ['Horário ocupado do profissional.'] } }, { status: 422 }),
      ),
    )
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await preencherObrigatorios(usuario, dialog)
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT: no campo do profissional, não num toast genérico
    const erro = await within(dialog).findByRole('alert')
    expect(erro).toHaveTextContent('Horário ocupado do profissional.')
    expect(dialog).toBeInTheDocument() // o formulário continua aberto para corrigir
  })

  it('deve mostrar no aviso geral as datas em conflito da série', async () => {
    // ARRANGE: a série é tudo-ou-nada — e `recorrencia` não é campo do formulário
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/agendamentos', () =>
        HttpResponse.json(
          { errors: { recorrencia: ['Conflito de horário nas datas: 2026-07-20, 2026-07-27.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await preencherObrigatorios(usuario, dialog)
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT
    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('2026-07-20, 2026-07-27')
    })
  })

  it('deve mostrar no aviso geral a recusa de limite do convênio (regra bloquear)', async () => {
    // ARRANGE — a guarda de limite (limites-e-pedidos) recusa na chave
    // `limite_convenio`, que NÃO é campo do formulário: ela cai no tratamento padrão
    // (gerais → AvisoErro), sem mudança de contrato. A mensagem é MINIMIZADA no
    // servidor (SEC-LP-01): limite + período + convênio — nunca a contagem atual.
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/agendamentos', () =>
        HttpResponse.json(
          {
            errors: {
              limite_convenio: ['Limite do convênio atingido: 4 por mês — Convênio Fictício.'],
            },
          },
          { status: 422 },
        ),
      ),
    )
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await preencherObrigatorios(usuario, dialog)
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT — a recusa aparece no AvisoErro e o formulário segue aberto para ajustar
    const aviso = await within(dialog).findByRole('alert')
    expect(aviso).toHaveTextContent('Limite do convênio atingido: 4 por mês — Convênio Fictício.')
    expect(dialog).toBeInTheDocument()
  })

  it('deve montar o payload do BLOQUEIO sem os campos clínicos', async () => {
    // ARRANGE: a API PROÍBE paciente/especialidade/tratamento/médico/status no
    // bloqueio — não basta deixá-los vazios (T-aes-11)
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/agendamentos', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await usuario.click(within(dialog).getByRole('checkbox', { name: /Bloqueio de agenda/ }))
    await usuario.type(within(dialog).getByLabelText(/Duração/), '60')
    await usuario.type(within(dialog).getByLabelText(/Rótulo do bloqueio/), 'Supervisão da equipe')
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    const corpo = enviado as unknown as Record<string, unknown>
    expect(corpo.tipo).toBe('bloqueio')
    expect(corpo.obs).toBe('Supervisão da equipe')
    for (const proibido of ['paciente_id', 'especialidade_id', 'tratamento_id', 'medico_id', 'status_id']) {
      expect(corpo).not.toHaveProperty(proibido)
    }
  })
})

describe('Agenda — editar e série', () => {
  const cardEmSerie = cardFicticio({ id: 7 })

  function comSerie(futuros: number, aPartirDeste: number) {
    servidor.use(
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: aPartirDeste + 5, a_partir_deste: aPartirDeste, futuros }),
      ),
    )
  }

  it('deve enviar na série SÓ o que mudou (nunca status nem observação)', async () => {
    // ARRANGE: o servidor propaga o que o payload traz — mandar o formulário
    // inteiro ressuscitaria ocorrências desmarcadas e consumiria sessão delas
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizarAgenda([cardEmSerie])
    comSerie(19, 20)
    servidor.use(
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(cardEmSerie)
      }),
    )

    // ACT: abre o card, muda a hora e pede para aplicar na série
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    const hora = within(dialog).getByLabelText(/^Hora/)
    await usuario.clear(hora)
    await usuario.type(hora, '09:00')
    await usuario.click(await within(dialog).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // confirma (a operação atinge ocorrências fora da tela)
    const confirmacao = await screen.findByRole('alertdialog', { name: /Aplicar a mudança/ })
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Aplicar na série' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    const corpo = enviado as unknown as Record<string, unknown>
    expect(corpo.aplicar_na_serie).toBe(true)
    expect(corpo.inicio).toBe(`${DIA_FICTICIO} 09:00`)
    expect(corpo).not.toHaveProperty('status_id')
    expect(corpo).not.toHaveProperty('obs')
  })

  it('deve confirmar a série com o número que veio do SERVIDOR', async () => {
    // ARRANGE: a grade só conhece o dia; a série tem 19 seguintes
    const usuario = userEvent.setup()
    renderizarAgenda([cardEmSerie])
    comSerie(19, 20)

    // ACT
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    await usuario.click(await within(dialog).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: o número do dialog é o do servidor — contar pela grade diria "0"
    const confirmacao = await screen.findByRole('alertdialog', { name: /Aplicar a mudança aos 19 seguintes/ })
    expect(confirmacao).toHaveTextContent('fora do período que você está vendo')
  })
})

describe('Agenda — excluir', () => {
  it('deve dizer a verdade sobre o alcance da exclusão em série', async () => {
    // ARRANGE: o DELETE em série apaga ESTE e todos os seguintes — 20 no total,
    // enquanto a grade enxerga 1. Um dialog que mente fabrica consentimento.
    const usuario = userEvent.setup()
    const card = cardFicticio({ id: 7 })
    renderizarAgenda([card])
    servidor.use(
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 24, a_partir_deste: 20, futuros: 19 }),
      ),
    )

    // ACT: o escopo da exclusão é DECIDIDO NA EXCLUSÃO — quem marcou "aplicar
    // na série" para reagendar não chega aqui com a série pré-armada
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    await usuario.click(await within(dialog).findByRole('checkbox', { name: /Excluir também os seguintes/ }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    // ASSERT
    const confirmacao = await screen.findByRole('alertdialog', { name: /Excluir o agendamento/ })
    expect(confirmacao).toHaveTextContent('20 no total')
    expect(confirmacao).toHaveTextContent('Os anteriores permanecem')
  })

  it('deve não pré-armar a exclusão da série (a ação padrão é a mais estreita)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 24, a_partir_deste: 20, futuros: 19 }),
      ),
    )

    // ACT: marca "aplicar na série" pensando em REAGENDAR, e então clica Excluir
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    await usuario.click(await within(dialog).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Excluir' }))

    // ASSERT: a exclusão é só deste — a série não foi armada por tabela
    const confirmacao = await screen.findByRole('alertdialog', { name: /Excluir o agendamento/ })
    expect(confirmacao).toHaveTextContent('Só o agendamento')
    expect(confirmacao).toHaveTextContent('permanecem')
  })

  it('deve explicar a recusa quando o agendamento é protegido', async () => {
    // ARRANGE: sessão consumida — a API recusa e o motivo é ACIONÁVEL
    const usuario = userEvent.setup()
    const card = cardFicticio({ id: 7 })
    renderizarAgenda([card])
    servidor.use(
      msw.delete('/api/agendamentos/:id', () =>
        HttpResponse.json(
          {
            errors: {
              agendamento: [
                'Agendamento com sessão consumida não pode ser excluído — estorne primeiro mudando o status.',
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )

    // ACT
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    await usuario.click(within(dialog).getByRole('button', { name: 'Excluir' }))
    const confirmacao = await screen.findByRole('alertdialog', { name: /Excluir o agendamento/ })
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Excluir agendamento' }))

    // ASSERT: o caminho da solução aparece (estornar mudando o status)
    await waitFor(() => {
      expect(screen.getAllByText(/estorne primeiro mudando o status/).length).toBeGreaterThan(0)
    })
  })
})

describe('Agenda — trocar status pelo chip', () => {
  it('deve usar leitura FRESCA do agendamento, não o card em cache', async () => {
    // ARRANGE: outra pessoa reagendou o card para 10:00 enquanto esta tela
    // mostrava 08:00. O PUT exige `inicio` — mandar o do cache DESFARIA aquele
    // reagendamento, em silêncio (T-aes-06).
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json(cardFicticio({ id: 7, inicio: `${DIA_FICTICIO} 10:00` })),
      ),
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(cardFicticio({ id: 7 }))
      }),
    )

    // ACT
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Em Aberto/ }))

    // ASSERT: o `inicio` enviado é o do SERVIDOR (10:00), não o da tela (08:00)
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect((enviado as unknown as Record<string, unknown>).inicio).toBe(`${DIA_FICTICIO} 10:00`)
  })

  it('deve explicar e NÃO enviar quando o detalhe fresco diz período fechado (SEC-TS)', async () => {
    // ARRANGE: a produção deste agendamento está em ciclo fechado — a leitura FRESCA
    // que o fluxo já faz é a porta: o gesto explica e o PUT nunca sai (o servidor
    // recusaria com 422 `ciclo_fechado`).
    const usuario = userEvent.setup()
    let enviado = false
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json({ ...cardFicticio({ id: 7 }), em_ciclo_fechado: true }),
      ),
      msw.put('/api/agendamentos/:id', () => {
        enviado = true
        return HttpResponse.json(cardFicticio({ id: 7 }))
      }),
    )

    // ACT — caminho direto (Em Aberto não desconta: sem dialog no meio)
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Em Aberto/ }))

    // ASSERT — a explicação aparece e NADA foi enviado
    await screen.findByText(/produção deste período já foi fechada/i)
    expect(enviado).toBe(false)
  })

  it('deve confirmar quando o status desconta sessão, com o efeito no saldo', async () => {
    // ARRANGE: mexe no saldo do tratamento do paciente (§2)
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7, tratamento_saldo: 9, tratamento_total: 12 })])

    // ACT
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Finalizado/ }))

    // ASSERT
    const confirmacao = await screen.findByRole('alertdialog')
    expect(confirmacao).toHaveTextContent('saldo: 9 → 8')
  })

  it('deve não afirmar desconto de sessão quando não há tratamento', async () => {
    // ARRANGE: sem tratamento não há saldo — a consequência não pode mentir
    const usuario = userEvent.setup()
    let enviado = false
    renderizarAgenda([
      cardFicticio({ id: 7, tratamento_id: null, tratamento_saldo: null, tratamento_total: null }),
    ])
    servidor.use(
      msw.put('/api/agendamentos/:id', () => {
        enviado = true
        return HttpResponse.json(cardFicticio({ id: 7 }))
      }),
    )

    // ACT
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Finalizado/ }))

    // ASSERT: muda direto, sem dialog que fale de saldo inexistente
    await waitFor(() => {
      expect(enviado).toBe(true)
    })
    expect(screen.queryByText(/saldo:/)).not.toBeInTheDocument()
  })
})

describe('Agenda — a recusa do servidor NUNCA some (SEC-A1)', () => {
  it('deve mostrar a recusa da troca de status e manter o dialog aberto', async () => {
    // ARRANGE: o repro do parecer — a recusa chega em `status_id`, que É campo,
    // e o menu de status não tem campo onde pousar a mensagem. Sem o fallback
    // no toast, a recepcionista não saberia que o servidor disse não.
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7, tratamento_saldo: 9, tratamento_total: 12 })])
    servidor.use(
      msw.put('/api/agendamentos/:id', () =>
        HttpResponse.json(
          {
            errors: {
              status_id: ['Status que desconta sessão não pode ser aplicado a agendamento em data futura.'],
            },
          },
          { status: 422 },
        ),
      ),
    )

    // ACT
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Finalizado/ }))
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Mudar status' }))

    // ASSERT: a mensagem aparece E o dialog continua aberto para nova tentativa
    expect(await screen.findByText(/não pode ser aplicado a agendamento em data futura/)).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('deve dizer o 422 ciclo_fechado da CORRIDA com um fechamento concorrente (SEC-TS)', async () => {
    // ARRANGE: o detalhe fresco ainda diz LIVRE (a corrida — outro usuário fecha o
    // período entre a leitura e o PUT); a guarda do servidor recusa com a chave
    // `ciclo_fechado`, que NÃO é campo — sem o fallback do toast, a recusa sumiria.
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json({ ...cardFicticio({ id: 7 }), em_ciclo_fechado: false }),
      ),
      msw.put('/api/agendamentos/:id', () =>
        HttpResponse.json(
          {
            errors: {
              ciclo_fechado: [
                'A produção deste período (01/06/2026–30/06/2026) já foi fechada; a reabertura é do administrador.',
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )

    // ACT — caminho direto (Em Aberto não desconta: sem dialog no meio)
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Em Aberto/ }))

    // ASSERT — a mensagem do SERVIDOR é dita, e o card permanece no status anterior
    expect(
      await screen.findByText(/produção deste período \(01\/06\/2026–30\/06\/2026\) já foi fechada/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Em Aberto — mudar status/i })).toBeInTheDocument()
  })

  it('deve não prometer saldo negativo quando o tratamento está sem saldo (SEC-A3)', async () => {
    // ARRANGE: saldo 0 — o servidor VAI recusar; prometer "0 → -1" seria mentir
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7, tratamento_saldo: 0, tratamento_total: 12 })])

    // ACT
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Finalizado/ }))

    // ASSERT
    const confirmacao = await screen.findByRole('alertdialog')
    expect(confirmacao).toHaveTextContent('sem saldo de sessões')
    expect(confirmacao).not.toHaveTextContent('-1')
  })
})

describe('Agenda — a série não descarta em silêncio (SEC-A2)', () => {
  it('deve avisar e travar o salvar quando a alteração não vai para a série', async () => {
    // ARRANGE: o repro do parecer — digitar uma observação, marcar "aplicar na
    // série" e salvar dava um toast de SUCESSO sem que a observação fosse
    // enviada. O payload estava certo; a tela é que mentia.
    const usuario = userEvent.setup()
    const card = cardFicticio({ id: 7 })
    renderizarAgenda([card])
    servidor.use(
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 24, a_partir_deste: 20, futuros: 19 }),
      ),
    )

    // ACT
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    await usuario.type(within(dialog).getByLabelText(/Observação/), 'Trazer laudo da escola')
    await usuario.click(await within(dialog).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }))

    // ASSERT: o usuário é avisado, e não consegue salvar um descarte silencioso
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/observação.*NÃO será salva/s)
    expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('deve barrar a conversão para bloqueio com "aplicar na série" (SEC-A5)', async () => {
    // ARRANGE: o payload de série não leva `tipo`; omiti-lo faria o servidor
    // manter o tipo atual, a API responder 200 e a tela dizer "salvo" — sem
    // conversão nenhuma, contornando a guarda explícita do servidor
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 24, a_partir_deste: 20, futuros: 19 }),
      ),
    )

    // ACT
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    await usuario.click(within(dialog).getByRole('checkbox', { name: /Bloqueio de agenda/ }))
    await usuario.click(await within(dialog).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }))

    // ASSERT
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/bloqueio de agenda.*NÃO será salva/s)
    expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('deve liberar o salvar quando a alteração é aplicável na série', async () => {
    // ARRANGE: mudar só a hora é propagável — nada é descartado
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 24, a_partir_deste: 20, futuros: 19 }),
      ),
    )

    // ACT
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    const hora = within(dialog).getByLabelText(/^Hora/)
    await usuario.clear(hora)
    await usuario.type(hora, '09:00')
    await usuario.click(await within(dialog).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }))

    // ASSERT
    expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeEnabled()
  })
})

describe('Agenda — a11y da escrita', () => {
  it('deve não ter violações axe no formulário aberto', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    await marcarNoPrimeiroSlot(usuario)

    // ACT
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})

describe('Agenda — trocar a criança do agendamento (PAC-REP)', () => {
  /** Duas crianças na busca: é a troca que precisa ser testada, não a escolha inicial. */
  const DUAS_CRIANCAS = [
    { id: 10, nome: 'Paciente Fictício', nome_social: null },
    { id: 11, nome: 'Irmão Fictício', nome_social: null },
  ]

  it('deve exigir a palavra CORRIGIR digitada — e não enviar nada sem ela', async () => {
    // ARRANGE: o erro que esta barreira existe para pegar é, ele próprio, um CLIQUE
    // ERRADO (irmãos, nomes parecidos no autocomplete). Um "tem certeza?" de um clique
    // seria respondido pelo mesmo reflexo que causou o engano.
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizarAgenda([cardFicticio({ id: 7 })])
    // DEPOIS do render: `renderizarAgenda` registra os handlers da agenda por dentro, e
    // no MSW o último `use()` vence — registrar antes seria sobrescrito em silêncio
    servidor.use(
      msw.get('/api/agenda/selecao/pacientes', () => HttpResponse.json(DUAS_CRIANCAS)),
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(cardFicticio())
      }),
    )

    // ACT: abre o card e troca a criança
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    await usuario.clear(within(dialog).getByRole('combobox', { name: /Paciente/ }))
    await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Irm')
    await usuario.click(await screen.findByRole('option', { name: 'Irmão Fictício' }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT 1: a confirmação NOMEIA as duas crianças — texto genérico é confirmado
    // sem que se saiba o que se está confirmando
    const confirmacao = await screen.findByRole('alertdialog', { name: /Corrigir a criança/i })
    expect(within(confirmacao).getByText(/deixa de ser de Paciente Fictício/)).toBeInTheDocument()
    expect(within(confirmacao).getByText(/passa a ser de Irmão Fictício/)).toBeInTheDocument()

    // ASSERT 2: enquanto a palavra não é digitada, NADA sai
    const confirmar = within(confirmacao).getByRole('button', { name: 'Corrigir paciente' })
    // `aria-disabled` (não `disabled`): a ação primária bloqueada continua na sequência
    // de Tab para poder dizer o que falta — contrato do DS (IMP-4)
    expect(confirmar).toHaveAttribute('aria-disabled', 'true')
    expect(enviado).toBeNull()

    // ACT: digita a palavra
    await usuario.type(within(confirmacao).getByRole('textbox', { name: /Digite CORRIGIR/i }), 'CORRIGIR')
    await usuario.click(confirmar)

    // ASSERT 3: só ENTÃO o PUT sai, com a criança nova
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ paciente_id: 11 })
  })

  it('deve salvar direto quando a criança NÃO muda — a fricção só cai onde o risco está', async () => {
    // ARRANGE: fricção que aparece onde o risco não está vira ruído, e o usuário
    // aprende a atravessá-la sem ler — inclusive onde ela importa.
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(cardFicticio())
      }),
    )

    // ACT: mexe só na observação
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    await usuario.type(within(dialog).getByLabelText(/Observação/i), 'Chegou cedo.')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: nenhuma confirmação digitada; o PUT sai direto
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(screen.queryByRole('textbox', { name: /Digite CORRIGIR/i })).not.toBeInTheDocument()
  })

  it('deve mostrar a recusa do PAC-REP DENTRO do diálogo, não atrás dele', async () => {
    // ARRANGE: o 422 chega na chave `paciente_id`, e o campo dela fica ATRÁS do diálogo
    // de confirmação. Sem trazer a mensagem para cá, o servidor recusaria e o usuário
    // veria o diálogo intacto — "não aconteceu nada".
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.get('/api/agenda/selecao/pacientes', () => HttpResponse.json(DUAS_CRIANCAS)),
      msw.put('/api/agendamentos/:id', () =>
        HttpResponse.json(
          {
            errors: {
              paciente_id: [
                'Este agendamento já tem atendimento registrado e não pode mudar de paciente: '
                + 'a evolução clínica pertence a esta criança. Para corrigir, exclua o atendimento primeiro.',
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )

    // ACT
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)
    await usuario.clear(within(dialog).getByRole('combobox', { name: /Paciente/ }))
    await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Irm')
    await usuario.click(await screen.findByRole('option', { name: 'Irmão Fictício' }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    const confirmacao = await screen.findByRole('alertdialog', { name: /Corrigir a criança/i })
    await usuario.type(within(confirmacao).getByRole('textbox', { name: /Digite CORRIGIR/i }), 'CORRIGIR')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Corrigir paciente' }))

    // ASSERT: a recusa aparece ONDE a pessoa está olhando, e o diálogo continua aberto
    expect(await within(confirmacao).findByText(/exclua o atendimento primeiro/)).toBeInTheDocument()
  })
})

describe('Agenda — o campo Tratamento diz a especialidade (pedido da clínica, 2026-09-09)', () => {
  /** O campo do formulário, sempre buscado pelo rótulo — nunca por posição. */
  function campoTratamento(dialog: HTMLElement): HTMLSelectElement {
    return within(dialog).getByLabelText(/Tratamento/) as HTMLSelectElement
  }

  it('deve nomear a especialidade do pacote, sem o código interno', async () => {
    // ARRANGE: a queixa era "#140 · 10/10 sessões" — código não diz qual terapia é
    const usuario = userEvent.setup()
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await preencherObrigatorios(usuario, dialog)

    // ASSERT
    const campo = campoTratamento(dialog)
    expect(within(campo).getByRole('option', { name: 'Fonoaudiologia · 3/12 sessões' })).toBeInTheDocument()
    for (const opcao of within(campo).getAllByRole('option')) {
      expect(opcao).not.toHaveTextContent('#')
    }
  })

  it('deve oferecer só os pacotes da especialidade escolhida', async () => {
    // ARRANGE: o paciente tem pacote em Fonoaudiologia (5) e em Psicologia (6 e 7);
    // o servidor SEMPRE recusa pacote de outra especialidade
    const usuario = userEvent.setup()
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await preencherObrigatorios(usuario, dialog)

    // ASSERT: só o da especialidade escolhida, mais o "Sem tratamento"
    const valores = within(campoTratamento(dialog))
      .getAllByRole('option')
      .map((opcao) => (opcao as HTMLOptionElement).value)
    expect(valores).toEqual(['', '5'])
  })

  it('deve trocar a lista quando a especialidade troca', async () => {
    // ARRANGE: o profissional B atende Psicologia, onde estão os pacotes 6 e 7
    const usuario = userEvent.setup()
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)
    await preencherObrigatorios(usuario, dialog)

    // ACT
    await usuario.selectOptions(within(dialog).getByLabelText(/Profissional/), '2')
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '2')

    // ASSERT: os empatados aparecem COM o código, e o pacote de Fonoaudiologia sumiu
    const campo = campoTratamento(dialog)
    expect(within(campo).getByRole('option', { name: 'Psicologia · 0/10 sessões · #6' })).toBeInTheDocument()
    expect(within(campo).getByRole('option', { name: 'Psicologia · 0/10 sessões · #7' })).toBeInTheDocument()
    expect(within(campo).queryByRole('option', { name: /Fonoaudiologia/ })).not.toBeInTheDocument()
  })

  /*
   * UM defeito por vez (parecer CR-TNE-10): empilhar `finalizado` + `vencido` + saldo 0 no mesmo
   * pacote provava a conjunção — tirar qualquer condição do recorte deixava as outras duas
   * filtrando, e a suíte não via. Cada caso abaixo isola a SUA razão.
   */
  it.each([
    ['fechado', { status: 'finalizado', sessoes_total: 10, sessoes_saldo: 4, vencido: false }],
    ['vencido', { status: 'andamento', sessoes_total: 10, sessoes_saldo: 4, vencido: true }],
    ['sem saldo', { status: 'andamento', sessoes_total: 10, sessoes_saldo: 0, vencido: false }],
  ])('deve não oferecer o pacote %s, e dizer por quê', async (_razao, pacote) => {
    // ARRANGE: a clínica abre um pacote de 10 por MÊS (Mariana, 2026-09-09) — os antigos ficam
    // fechados na ficha da criança e não podem entulhar o campo na hora de marcar
    const usuario = userEvent.setup()
    renderizarAgenda()
    servidor.use(
      msw.get('/api/agenda/selecao/tratamentos', () =>
        HttpResponse.json([{ id: 5, especialidade_id: 1, ...pacote }]),
      ),
    )
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await preencherObrigatorios(usuario, dialog)

    // ASSERT: fora da lista, com a razão à vista — senão a recepção procura o pacote que sabe que existe
    const campo = campoTratamento(dialog)
    expect(within(campo).getAllByRole('option')).toHaveLength(1)
    // a frase COMEÇA a ajuda: depois dela vem o caminho para cadastrar o pacote (o-sistema-avisa-o-que-falta)
    expect(within(dialog).getByText(/^Os pacotes desta especialidade estão fechados, vencidos ou sem saldo\./)).toBeInTheDocument()
  })

  it('deve manter o pacote GRAVADO que a agenda já não aceitaria (CR/SEC — nada some sozinho)', async () => {
    // ARRANGE: o pacote da sessão venceu depois que ela foi marcada
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    const card = cardFicticio({ id: 7 })
    renderizarAgenda([card])
    servidor.use(
      msw.get('/api/agenda/selecao/tratamentos', () =>
        HttpResponse.json([
          { id: 5, especialidade_id: 1, status: 'andamento', sessoes_total: 12, sessoes_saldo: 3, vencido: true },
        ]),
      ),
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(card)
      }),
    )
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)

    // ASSERT: continua na lista, marcado, e a ajuda explica
    const campo = campoTratamento(dialog)
    expect(campo).toHaveValue('5')
    expect(within(campo).getByRole('option', { name: 'Fonoaudiologia · 9/12 sessões · vencido' })).toBeInTheDocument()
    // uma vez só: sem a cerca do `!pacoteUsavel`, o gravado entrava pela lista E pela exceção,
    // com a mesma `key` do React (parecer CR-TNE-11)
    expect(
      within(campo)
        .getAllByRole('option')
        .filter((opcao) => (opcao as HTMLOptionElement).value === '5'),
    ).toHaveLength(1)
    expect(within(dialog).getByText(/não aceita mais/)).toBeInTheDocument()

    // ACT: salva mexendo só na hora
    const hora = within(dialog).getByLabelText(/^Hora/)
    await usuario.clear(hora)
    await usuario.type(hora, '09:00')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ tratamento_id: 5 })
  })

  it('deve dizer o que falta escolher antes de oferecer pacote', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ASSERT: sem paciente, o campo diz o que vem primeiro
    expect(within(campoTratamento(dialog)).getByRole('option', { name: 'Escolha o paciente antes' })).toBeInTheDocument()

    // ACT: escolhe só o paciente
    await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Pac')
    await usuario.click(await screen.findByRole('option', { name: 'Paciente Fictício' }))

    // ASSERT: agora falta a especialidade — e nenhum pacote é oferecido antes dela
    const campo = campoTratamento(dialog)
    expect(within(campo).getByRole('option', { name: 'Escolha a especialidade antes' })).toBeInTheDocument()
    expect(within(campo).getAllByRole('option')).toHaveLength(1)
  })

  it('deve não mandar pacote escondido quando a especialidade muda', async () => {
    // ARRANGE: escolher o pacote e depois trocar a especialidade deixava o id antigo
    // no payload — 422 apontando para um campo que a recepção vê vazio
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/agendamentos', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)
    await preencherObrigatorios(usuario, dialog)
    await usuario.selectOptions(campoTratamento(dialog), '5')

    // ACT: troca o profissional (que zera a especialidade) e escolhe a outra
    await usuario.selectOptions(within(dialog).getByLabelText(/Profissional/), '2')
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '2')
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ especialidade_id: 2, tratamento_id: null })
  })

  it('deve deixar desvincular o pacote pela tela', async () => {
    // ARRANGE: "Sem tratamento" era placeholder (option disabled) — não havia volta,
    // embora o servidor aceite `tratamento_id: null` como desvincular
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(cardFicticio({ id: 7 }))
      }),
    )
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)

    // ACT
    await usuario.selectOptions(campoTratamento(dialog), '')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ tratamento_id: null })
  })

  it('deve não desvincular em silêncio o pacote gravado de outra especialidade (SEC-TNE-01)', async () => {
    // ARRANGE: estado alcançável pela propagação de série, que grava as irmãs sem validar o
    // domínio — especialidade 1 no card, pacote 6 (especialidade 2). Esconder o pacote faria o
    // campo dizer "Sem tratamento" e o primeiro Salvar mandaria `tratamento_id: null`
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    const incoerente = cardFicticio({ id: 7, tratamento_id: 6 })
    renderizarAgenda([incoerente])
    servidor.use(
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(incoerente)
      }),
    )
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)

    // ASSERT: o pacote está na lista, marcado, e a ajuda avisa
    const campo = campoTratamento(dialog)
    expect(campo).toHaveValue('6')
    expect(
      within(campo).getByRole('option', { name: 'Psicologia · 0/10 sessões · #6 · de outra especialidade' }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/pacote de outra especialidade/)).toBeInTheDocument()

    // ACT: mexe só na hora e salva
    const hora = within(dialog).getByLabelText(/^Hora/)
    await usuario.clear(hora)
    await usuario.type(hora, '09:00')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: o vínculo vai inteiro — quem recusa é o servidor, em voz alta
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ tratamento_id: 6 })
  })

  it('deve não afirmar que o paciente não tem pacote enquanto a lista carrega (SEC-TNE-04)', async () => {
    // ARRANGE: resposta lenta — a ajuda não pode dizer uma frase falsa sobre uma criança real
    const usuario = userEvent.setup()
    renderizarAgenda()
    servidor.use(
      msw.get('/api/agenda/selecao/tratamentos', async () => {
        await delay(400)
        return HttpResponse.json([])
      }),
    )
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await preencherObrigatorios(usuario, dialog)

    // ASSERT: durante o carregamento, só a regra do campo
    expect(within(dialog).getByText('Só os pacotes da especialidade escolhida.')).toBeInTheDocument()
    expect(within(dialog).queryByText(/não tem pacote cadastrado/)).not.toBeInTheDocument()

    // e, quando a lista chega vazia, aí sim a afirmação
    expect(await within(dialog).findByText(/^Este paciente não tem pacote cadastrado\./)).toBeInTheDocument()
  })

  it('deve não desvincular o pacote enquanto a lista de pacotes não chegou (CR-TNE-01)', async () => {
    // ARRANGE: rota lenta. Antes desta guarda o campo já NASCIA "Sem tratamento" — ninguém via
    // esvaziar — e o primeiro Salvar mandava `tratamento_id: null`, que o servidor lê como
    // desvincular (e, em sessão consumida, DEVOLVE a sessão ao pacote)
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    const card = cardFicticio({ id: 7 })
    renderizarAgenda([card])
    servidor.use(
      msw.get('/api/agenda/selecao/tratamentos', async () => {
        await delay(3000)
        return HttpResponse.json(TRATAMENTOS_DO_PACIENTE)
      }),
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(card)
      }),
    )
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)

    // ASSERT: o campo diz que está carregando ESTE pacote, nunca "Sem tratamento"
    const campo = campoTratamento(dialog)
    expect(campo).toHaveValue('5')
    expect(within(campo).getByRole('option', { name: /Carregando o pacote/ })).toBeInTheDocument()

    // ACT: salva antes da lista chegar
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ tratamento_id: 5 })
  })

  it('deve não desvincular o pacote quando a lista de pacotes FALHA (CR-TNE-01)', async () => {
    // ARRANGE: 500 na rota dos pacotes — o vínculo não pode depender dela
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    const card = cardFicticio({ id: 7 })
    renderizarAgenda([card])
    servidor.use(
      msw.get('/api/agenda/selecao/tratamentos', () => new HttpResponse(null, { status: 500 })),
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(card)
      }),
    )
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)

    // ACT: espera o estado de erro ASSENTADO — o rótulo abaixo é o único DOM que exige
    // `isError`. Clicar antes disso testava o RETRY ainda em voo, ou seja, o carregamento de
    // novo: com a asserção fraca, trocar a guarda por `!isPending` reintroduzia o bloqueante
    // com a suíte verde (parecer CR-TNE-09)
    await within(dialog).findByRole(
      'option',
      { name: 'Pacote deste agendamento — não foi possível carregar a lista' },
      { timeout: 5000 },
    )
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: o vínculo foi inteiro
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ tratamento_id: 5 })
  })

  it('deve não acusar mudança de tratamento na série quando quem mudou foi a especialidade (CR-TNE-02)', async () => {
    // ARRANGE: com o valor EFETIVO nessa comparação, trocar a especialidade com "aplicar na série"
    // marcado acusava o campo Tratamento — que ninguém tocou — e travava o Salvar
    const usuario = userEvent.setup()
    const card = cardFicticio({ id: 7 })
    renderizarAgenda([card])
    servidor.use(
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 6, a_partir_deste: 6, futuros: 5 }),
      ),
    )
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)

    // ACT
    await usuario.click(await within(dialog).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }))
    await usuario.selectOptions(within(dialog).getByLabelText(/Profissional/), '2')
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '2')

    // ASSERT: nenhum aviso sobre tratamento, e o Salvar continua vivo
    expect(within(dialog).queryByText(/em tratamento NÃO será salva/i)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeEnabled()
  })

  it('deve sugerir a série pelo saldo do pacote escolhido (CR-TNE-03)', async () => {
    // ARRANGE: a sugestão de "quantas sessões" sai do pacote — e do pacote EFETIVO
    const usuario = userEvent.setup()
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)
    await preencherObrigatorios(usuario, dialog)
    await usuario.selectOptions(campoTratamento(dialog), '5')

    // ACT
    await usuario.selectOptions(within(dialog).getByLabelText(/Repetir/), '1')

    // ASSERT: 9 é o saldo do pacote 5 (12 totais, 3 realizadas)
    expect(within(dialog).getByText(/O pacote tem 9 sessões a fazer/)).toBeInTheDocument()

    // ACT: troca a especialidade — o pacote sai da lista
    await usuario.selectOptions(within(dialog).getByLabelText(/Profissional/), '2')
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '2')

    // ASSERT: a sugestão não pode continuar prometendo o saldo de um pacote que não vai junto
    expect(within(dialog).queryByText(/O pacote tem 9 sessões a fazer/)).not.toBeInTheDocument()
  })

  it('deve não acusar "outra especialidade" quando quem não atende é o PROFISSIONAL (SEC-TNE-05)', async () => {
    // ARRANGE: o profissional deixou de atender a especialidade do agendamento. A especialidade do
    // pacote BATE — quem não a atende é ele. Dizer "pacote de outra especialidade" seria falso
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          profissionais: SELECAO_FICTICIA.profissionais.map((profissional) =>
            profissional.id === 1
              ? { ...profissional, especialidades: [{ id: 2, nome: 'Psicologia' }] }
              : profissional,
          ),
        }),
      ),
    )
    await screen.findByRole('table')

    // ACT
    const dialog = await abrirEdicao(usuario)

    // ASSERT: o campo pede a especialidade, e nenhuma frase acusa o pacote
    expect(
      within(campoTratamento(dialog)).getByRole('option', { name: 'Escolha a especialidade antes' }),
    ).toBeInTheDocument()
    expect(within(dialog).queryByText(/pacote de outra especialidade/)).not.toBeInTheDocument()
  })

  it('deve preservar o pacote quando a edição não mexe na especialidade', async () => {
    // ARRANGE: a change não pode desvincular nada sozinha
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizarAgenda([cardFicticio({ id: 7 })])
    servidor.use(
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(cardFicticio({ id: 7 }))
      }),
    )
    await screen.findByRole('table')
    const dialog = await abrirEdicao(usuario)

    // ASSERT: o pacote USÁVEL entra pela lista e NÃO pela exceção — uma opção só. Sem a cerca do
    // `!pacoteUsavel` ele entraria pelos dois caminhos, com a mesma `key` do React (CR-TNE-11);
    // a asserção precisa estar num pacote usável, que é onde os dois caminhos se cruzam
    expect(
      within(campoTratamento(dialog))
        .getAllByRole('option')
        .filter((opcao) => (opcao as HTMLOptionElement).value === '5'),
    ).toHaveLength(1)

    // ACT: mexe só na hora
    const hora = within(dialog).getByLabelText(/^Hora/)
    await usuario.clear(hora)
    await usuario.type(hora, '09:00')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ tratamento_id: 5 })
  })
})

describe('Agenda — o vazio da busca de paciente explica o inativo', () => {
  it('deve dizer que existe cadastro inativo quando o servidor sinaliza', async () => {
    // ARRANGE — paciente inativo não é oferecido (a trava do servidor não muda); o que muda é a
    // caixa parar de sumir com ele em silêncio (change paciente-inativo-com-saida)
    const usuario = userEvent.setup()
    renderizarAgenda()
    // DEPOIS do render: no MSW o último `use()` vence
    servidor.use(
      msw.get('/api/agenda/selecao/pacientes', ({ request }) => {
        const busca = new URL(request.url).searchParams.get('busca')
        if (busca === null) {
          return HttpResponse.json([])
        }

        return HttpResponse.json([], { headers: { 'X-Pacientes-Inativos': '1' } })
      }),
    )

    // ACT
    const dialog = await marcarNoPrimeiroSlot(usuario)
    await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Valmiro')

    // ASSERT — diz o motivo e para onde ir, sem nomear criança nenhuma
    expect(await within(dialog).findByText(/Existe cadastro/)).toBeInTheDocument()
    expect(within(dialog).getByText(/reative na ficha dele/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Nenhum resultado para/)).not.toBeInTheDocument()
  })
})

describe('Agenda — avisos à família pelo WhatsApp (avisos-do-agendamento)', () => {
  /** A seleção com o status do desmarque da clínica — o que a tela precisa para perguntar antes. */
  function comStatusDoDesmarque() {
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: [
            ...SELECAO_FICTICIA.status,
            {
              id: 7, nome: 'Desmarcado pelo Profissional', cor: '#94A3B8', cor_borda: null, tipo: 'x', ordem: 7,
              // sem `sessao_marcada`: o teste do "mesmo status de novo" prova a guarda do id sozinha
              desconta_sessao: false, marca_falta: false, aplicavel_em_lote: false, desmarque_da_clinica: true,
            },
            {
              id: 8, nome: 'Desmarcado pelo Paciente', cor: '#94A3B8', cor_borda: null, tipo: 'x', ordem: 8,
              desconta_sessao: false, marca_falta: false, aplicavel_em_lote: false, sessao_marcada: false,
            },
          ],
        }),
      ),
    )
  }

  function capturarPut(corpos: Record<string, unknown>[]) {
    servidor.use(
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        corpos.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(cardFicticio({ id: 7 }))
      }),
    )
  }

  it('deve perguntar antes do desmarque da clínica, com "Avisar a família" já marcado', async () => {
    // ARRANGE — um clique errado no status não pode, sozinho, avisar a família (SEC-AV-02)
    const usuario = userEvent.setup()
    const corpos: Record<string, unknown>[] = []
    renderizarAgenda([cardFicticio({ id: 7, tratamento_id: null })])
    comStatusDoDesmarque()
    capturarPut(corpos)

    // ACT
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Desmarcado pelo Profissional/ }))
    const dialog = await screen.findByRole('alertdialog')
    const caixa = within(dialog).getByRole('checkbox', { name: /Avisar a família pelo WhatsApp/ })
    const pediuAntes = corpos.length
    expect(caixa).toBeChecked()
    // a consequência não afirma o que a tela não sabe (liberar o horário é do status configurado)
    expect(within(dialog).getByText('Confira abaixo se a família deve ser avisada.')).toBeInTheDocument()
    expect(within(dialog).queryByText(/horário fica livre/)).not.toBeInTheDocument()
    await usuario.click(within(dialog).getByRole('button', { name: 'Mudar status' }))

    // ASSERT — nada saiu antes da confirmação; confirmado, o pedido vai
    expect(pediuAntes).toBe(0)
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).toMatchObject({ status_id: 7, avisar_familia: true })
  })

  it('deve desmarcar sem pedir o aviso quando a recepção desmarca a caixa', async () => {
    // ARRANGE — foi a família que pediu: ela já sabe
    const usuario = userEvent.setup()
    const corpos: Record<string, unknown>[] = []
    renderizarAgenda([cardFicticio({ id: 7, tratamento_id: null })])
    comStatusDoDesmarque()
    capturarPut(corpos)

    // ACT
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Desmarcado pelo Profissional/ }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('checkbox', { name: /Avisar a família pelo WhatsApp/ }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Mudar status' }))

    // ASSERT
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).not.toHaveProperty('avisar_familia')
  })

  it('não deve oferecer o aviso quando o card já está no desmarque da clínica', async () => {
    // ARRANGE — escolher o mesmo status de novo não cancela nada: a caixa prometeria um aviso que
    // não sai (CR3-02)
    const usuario = userEvent.setup()
    const corpos: Record<string, unknown>[] = []
    renderizarAgenda([cardFicticio({ id: 7, tratamento_id: null, status_id: 7 })])
    comStatusDoDesmarque()
    capturarPut(corpos)

    // ACT
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Desmarcado pelo Profissional/ }))

    // ASSERT — sem pergunta (não há pacote nem aviso em jogo) e sem pedido de aviso
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(corpos[0]).not.toHaveProperty('avisar_familia')
  })

  it('não deve oferecer o aviso quando a sessão já foi desmarcada pela família', async () => {
    // ARRANGE — "cancelado pela clínica" sobre sessão que a família já desmarcou é mensagem falsa
    // (SEC-AV-16)
    const usuario = userEvent.setup()
    const corpos: Record<string, unknown>[] = []
    renderizarAgenda([cardFicticio({ id: 7, tratamento_id: null, status_id: 8 })])
    comStatusDoDesmarque()
    capturarPut(corpos)

    // ACT
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: /mudar status de Paciente Fictício/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Desmarcado pelo Profissional/ }))

    // ASSERT
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(corpos[0]).toMatchObject({ status_id: 7 })
    expect(corpos[0]).not.toHaveProperty('avisar_familia')
  })

  it('deve contar à recepção que a confirmação foi enviada ao criar', async () => {
    // ARRANGE — o aviso mais frequente: a criança nova ganha o primeiro agendamento
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/agendamentos', () =>
        HttpResponse.json({ id: 99, aviso_familia: { enviado: true, motivo: null } }, { status: 201 }),
      ),
    )
    renderizarAgenda()
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await preencherObrigatorios(usuario, dialog)
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT
    expect(await screen.findByText('Aviso enviado ao WhatsApp da família.')).toBeInTheDocument()
  })
})
