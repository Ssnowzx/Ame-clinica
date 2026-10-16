import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { delay, HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, CONFIGURACAO_FICTICIA, DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CardAgendamento } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * O gesto de arrastar-para-remarcar (change arrastar-para-remarcar).
 *
 * O jsdom não implementa `document.elementFromPoint` (não há layout): o
 * hit-test é STUBADO por teste — o que se prova aqui é o CONTRATO do gesto
 * (gates, recusa, confirmação, o PUT que sai). A fluidez ao vivo é da task 6.2.
 */

const CONFIG_COM_ARRASTO = {
  configuracoes: [
    ...CONFIGURACAO_FICTICIA.configuracoes,
    { chave: 'agenda.arrastar_para_remarcar', tipo: 'bool', valor: true },
  ],
}

interface OpcoesDeRender {
  cards?: CardAgendamento[]
  permissoes?: string[]
  arrastoLigado?: boolean
}

function renderizarAgenda({
  cards = [cardFicticio()],
  permissoes = ['agenda.ver', 'agenda.editar'],
  arrastoLigado = true,
}: OpcoesDeRender = {}) {
  servidor.use(
    // o override vem ANTES dos handlers da lista: no MSW, ganha o primeiro que casar
    ...(arrastoLigado
      ? [msw.get('/api/agenda/configuracoes', () => HttpResponse.json(CONFIG_COM_ARRASTO))]
      : []),
    ...handlersDaAgenda(cards),
  )
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}&visao=geral`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** Stub do hit-test (jsdom não tem layout); devolve a função de restauração. */
function stubElementFromPoint(alvo: Element | null): () => void {
  const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: () => alvo,
  })
  return () => {
    if (original === undefined) {
      Reflect.deleteProperty(document, 'elementFromPoint')
    } else {
      Object.defineProperty(document, 'elementFromPoint', original)
    }
  }
}

/** Sequência de mouse: pressiona na origem, cruza o limiar e solta sobre `celulaAlvo`. */
function arrastarPara(origem: Element, celulaAlvo: Element | null, soltar = true): void {
  const restaurar = stubElementFromPoint(celulaAlvo)
  fireEvent.pointerDown(origem, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 80 })
  if (soltar) {
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 80 })
  }
  restaurar()
}

/**
 * Finge a GEOMETRIA das linhas: o jsdom não calcula layout, e a resolução do slot passou a
 * depender do Y do ponteiro (change `arrastar-para-slot-coberto`, D1/D2).
 *
 * Cada `<tr>` ganha uma faixa de 40px na ordem em que aparece, então `clientY` escolhe a linha
 * de forma determinística. É o mesmo espírito de `fingirTelaEstreita`: o dublê descreve a tela
 * que o jsdom não tem.
 */
function fingirFaixasDasLinhas(alturaPorLinha = 40): void {
  const linhas = [...document.querySelectorAll<HTMLElement>('tr[data-horario]')]
  linhas.forEach((linha, indice) => {
    const topo = indice * alturaPorLinha
    linha.getBoundingClientRect = () =>
      ({ top: topo, bottom: topo + alturaPorLinha, height: alturaPorLinha }) as DOMRect
  })
}

function celulaDaGrade(slot: string): HTMLElement {
  const celula = document.querySelector<HTMLElement>(`[data-slot="${slot}"]`)
  if (celula === null) {
    throw new Error(`célula ${slot} não encontrada na grade`)
  }
  return celula
}

beforeEach(() => {
  queryClient.clear()
})

describe('Agenda — o arrasto é gated por config e permissão (spec agenda-grade)', () => {
  it('deve não expor o gesto com a config desligada', async () => {
    // ARRANGE: clínica sem `agenda.arrastar_para_remarcar` (default false, D4)
    renderizarAgenda({ arrastoLigado: false })
    await screen.findByRole('table')

    // ACT: a mesma sequência de ponteiro de um arrasto válido
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))

    // ASSERT: sem afordância, sem ghost, sem confirmação — e sem ação de teclado
    expect(document.querySelector('[data-arrastavel]')).toBeNull()
    expect(document.querySelector('[data-fantasma-arrasto]')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remarcar Paciente/ })).not.toBeInTheDocument()
  })

  it('deve não expor o gesto sem agenda.editar', async () => {
    // ARRANGE: config ligada, mas o usuário só LÊ a agenda
    renderizarAgenda({ permissoes: ['agenda.ver'] })
    await screen.findByRole('table')

    // ACT
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))

    // ASSERT: o gate do PUT é o gate da afordância
    expect(document.querySelector('[data-arrastavel]')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remarcar Paciente/ })).not.toBeInTheDocument()
  })

  it('deve continuar abrindo o painel de leitura no clique curto', async () => {
    // ARRANGE: gesto LIGADO — o threshold de ~4px protege o clique de leitura
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')

    // ACT: clique normal no nome (pointerdown+up sem movimento)
    await usuario.click(screen.getByRole('button', { name: 'Paciente Fictício' }))

    // ASSERT: o painel de leitura abre como sempre
    const painel = await screen.findByRole('dialog')
    expect(within(painel).getByText('Detalhes do agendamento')).toBeInTheDocument()
  })

  it('deve não arrastar a faixa de bloqueio', async () => {
    // ARRANGE: bloqueio segue abrindo o card de leitura, nunca arrasta
    renderizarAgenda({
      cards: [
        cardFicticio({
          tipo: 'bloqueio',
          obs: 'Reunião de equipe',
          paciente: null,
          especialidade: null,
          status: null,
          tratamento_id: null,
          tratamento_saldo: null,
          tratamento_total: null,
          convenio: null,
        }),
      ],
    })
    await screen.findByRole('table')

    // ACT
    arrastarPara(
      screen.getByRole('button', { name: 'Bloqueio: Reunião de equipe' }),
      celulaDaGrade(`2|${DIA_FICTICIO}|09:00`),
    )

    // ASSERT: nenhum ghost, nenhuma confirmação
    expect(document.querySelector('[data-fantasma-arrasto]')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Agenda — soltar abre a confirmação, nunca grava direto (D2)', () => {
  it('deve abrir a confirmação de→para ao soltar numa célula válida, sem emitir PUT', async () => {
    // ARRANGE
    let putEmitido = false
    renderizarAgenda()
    servidor.use(
      msw.put('/api/agendamentos/:id', () => {
        putEmitido = true
        return HttpResponse.json(cardFicticio())
      }),
    )
    await screen.findByRole('table')

    // ACT: arrasta o card das 08:00 (Profissional A) para as 09:00 do B
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))

    // ASSERT: a confirmação nomeia o alvo e mostra o de→para completo
    const confirmacao = await screen.findByRole('dialog')
    expect(within(confirmacao).getByText('Remarcar Paciente Fictício?')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(confirmacao).getByText(/13\/07\/2026 às 08:00 · Profissional Fictício A/)).toBeInTheDocument()
    })
    expect(within(confirmacao).getByText(/13\/07\/2026 às 09:00 · Profissional Fictício B/)).toBeInTheDocument()
    // soltar NÃO gravou nada
    expect(putEmitido).toBe(false)
  })

  it('deve sinalizar recusa na célula indisponível e não abrir confirmação ao soltar', async () => {
    // ARRANGE: Profissional A atende até 12:00 — a célula das 13:00 dele é indisponível
    renderizarAgenda()
    await screen.findByRole('table')
    const indisponivel = celulaDaGrade(`1|${DIA_FICTICIO}|13:00`)
    expect(indisponivel).toHaveAttribute('data-slot-indisponivel', 'true')

    // ACT: arrasta até a célula indisponível (sem soltar ainda)
    arrastarPara(screen.getByRole('article'), indisponivel, false)

    // ASSERT 1: a célula sinaliza a recusa enquanto o ponteiro está sobre ela
    expect(indisponivel).toHaveAttribute('data-alvo-arrasto', 'recusa')

    // ACT 2: solta ali mesmo
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 80 })

    // ASSERT 2: soltar em alvo recusado não inicia remarcação — e o highlight some
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(indisponivel).not.toHaveAttribute('data-alvo-arrasto')
  })

  it('deve não emitir requisição ao cancelar a confirmação', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let putEmitido = false
    renderizarAgenda()
    servidor.use(
      msw.put('/api/agendamentos/:id', () => {
        putEmitido = true
        return HttpResponse.json(cardFicticio())
      }),
    )
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ACT
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Cancelar' }))

    // ASSERT: nada saiu, o card permanece onde estava
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(putEmitido).toBe(false)
    expect(within(screen.getByRole('article')).getByText('08:00')).toBeInTheDocument()
  })
})

describe('Agenda — o PUT do arrasto (task 4.2)', () => {
  const VERSAO_FRESCA = '2026-07-19T09:30:00.000000Z'

  interface PutCapturado {
    id: string
    versao: string | null
    corpo: Record<string, unknown>
  }

  function capturarPuts(destino: PutCapturado[], resposta: () => Response = () => HttpResponse.json(cardFicticio())) {
    servidor.use(
      msw.put('/api/agendamentos/:id', async ({ request, params }) => {
        destino.push({
          id: String(params.id),
          versao: request.headers.get('If-Match'),
          corpo: (await request.json()) as Record<string, unknown>,
        })
        return resposta()
      }),
    )
  }

  it('deve enviar If-Match da versão FRESCA e payload parcial sem dados do paciente', async () => {
    // ARRANGE: entre a grade e o soltar, o registro mudou no servidor — a
    // leitura fresca traz outro `inicio` E outra versão (o card da grade mente)
    const usuario = userEvent.setup()
    const puts: PutCapturado[] = []
    renderizarAgenda()
    capturarPuts(puts)
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json(cardFicticio({ inicio: `${DIA_FICTICIO} 10:00`, updated_at: VERSAO_FRESCA })),
      ),
    )
    await screen.findByRole('table')

    // ACT
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')
    // a ORIGEM exibida é a fresca (10:00), não a da grade (08:00)
    await waitFor(() => {
      expect(within(confirmacao).getByText(/às 10:00/)).toBeInTheDocument()
    })
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' }))

    // ASSERT
    await waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    expect(puts[0].versao).toBe(VERSAO_FRESCA)
    expect(puts[0].corpo).toEqual({ inicio: `${DIA_FICTICIO} 09:00`, profissional_id: 2 })
    expect(await screen.findByText('Agendamento atualizado.')).toBeInTheDocument()
  })

  it('deve tratar o 409 com a mensagem padrão de conflito, sem sobrescrever', async () => {
    // ARRANGE: outra pessoa alterou entre o soltar e o confirmar
    const usuario = userEvent.setup()
    const puts: PutCapturado[] = []
    renderizarAgenda()
    capturarPuts(puts, () => new HttpResponse(null, { status: 409 }))
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ACT
    const botao = within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' })
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })
    await usuario.click(botao)

    // ASSERT: o tratamento padrão do 409 — orientação de recarregar, nada gravado
    expect((await screen.findAllByText(/alterado por outra pessoa/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument() // aberto para decidir de novo
    expect(screen.queryByText('Agendamento atualizado.')).not.toBeInTheDocument()
  })

  it('deve exibir a recusa de domínio do servidor e a grade não muda', async () => {
    // ARRANGE: conflito real quem decide é o servidor (D5) — a recusa volta
    const usuario = userEvent.setup()
    const puts: PutCapturado[] = []
    renderizarAgenda()
    capturarPuts(puts, () =>
      HttpResponse.json({ errors: { inicio: ['Horário ocupado do profissional.'] } }, { status: 422 }),
    )
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ACT
    const botao = within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' })
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })
    await usuario.click(botao)

    // ASSERT: a recusa aparece ONDE a pessoa está olhando; o card segue às 08:00
    // (`hidden: true` porque o diálogo modal marca o resto da página com aria-hidden)
    expect((await screen.findAllByText(/Horário ocupado do profissional/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('article', { hidden: true })).toHaveTextContent('08:00')
    expect(screen.queryByText('Agendamento atualizado.')).not.toBeInTheDocument()
  })

  it('deve oferecer "aplicar aos seguintes" quando há série e enviar aplicar_na_serie', async () => {
    // ARRANGE: o alcance vem do SERVIDOR (a grade não conta irmãos)
    const usuario = userEvent.setup()
    const puts: PutCapturado[] = []
    renderizarAgenda()
    capturarPuts(puts)
    servidor.use(
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 24, a_partir_deste: 20, futuros: 19 }),
      ),
    )
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ACT: marca a opção de série (o MESMO prompt do formulário) e confirma
    await usuario.click(
      await within(confirmacao).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }),
    )
    expect(within(confirmacao).getByText(/19 agendamentos seguintes/)).toBeInTheDocument()
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Remarcar série' }))

    // ASSERT
    await waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    expect(puts[0].corpo).toEqual({
      inicio: `${DIA_FICTICIO} 09:00`,
      profissional_id: 2,
      aplicar_na_serie: true,
    })
  })

  it('deve oferecer "Avisar a família pelo WhatsApp" desmarcado, sem mandar o pedido', async () => {
    // ARRANGE — a família só é avisada quando foi a CLÍNICA que mudou (avisos-do-agendamento)
    const usuario = userEvent.setup()
    const puts: PutCapturado[] = []
    renderizarAgenda()
    capturarPuts(puts)
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ACT
    const caixa = await within(confirmacao).findByRole('checkbox', { name: /Avisar a família pelo WhatsApp/ })
    expect(caixa).not.toBeChecked()
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' }))

    // ASSERT
    await waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    expect(puts[0].corpo).not.toHaveProperty('avisar_familia')
  })

  it('deve pedir o aviso quando a caixa é marcada e contar que a família foi avisada', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const puts: PutCapturado[] = []
    renderizarAgenda()
    capturarPuts(puts, () => HttpResponse.json({ ...cardFicticio(), aviso_familia: { enviado: true, motivo: null } }))
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ACT
    await usuario.click(await within(confirmacao).findByRole('checkbox', { name: /Avisar a família pelo WhatsApp/ }))
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' }))

    // ASSERT
    await waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    expect(puts[0].corpo).toEqual({ inicio: `${DIA_FICTICIO} 09:00`, profissional_id: 2, avisar_familia: true })
    expect(await screen.findByText('Aviso enviado ao WhatsApp da família.')).toBeInTheDocument()
  })

  it('deve dizer por que a família não foi avisada', async () => {
    // ARRANGE — o agendamento foi remarcado; o aviso é que não saiu
    const usuario = userEvent.setup()
    const puts: PutCapturado[] = []
    renderizarAgenda()
    capturarPuts(puts, () =>
      HttpResponse.json({ ...cardFicticio(), aviso_familia: { enviado: false, motivo: 'a criança não tem telefone cadastrado' } }),
    )
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ACT
    await usuario.click(await within(confirmacao).findByRole('checkbox', { name: /Avisar a família pelo WhatsApp/ }))
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' }))

    // ASSERT
    expect(
      await screen.findByText('A família não foi avisada pelo WhatsApp: a criança não tem telefone cadastrado.'),
    ).toBeInTheDocument()
  })

  it('deve produzir o MESMO PUT do formulário para o mesmo de→para', async () => {
    // ARRANGE: o risco "duas superfícies de escrita divergirem" — não há duas:
    // o arrasto converge no mesmo hook e no mesmo endpoint. Mesmo destino
    // (09:00, mesmo profissional) pelos DOIS iniciadores.
    const usuario = userEvent.setup()
    const puts: PutCapturado[] = []
    renderizarAgenda()
    capturarPuts(puts)
    await screen.findByRole('table')

    // ACT 1: pelo ARRASTO — para as 09:00 do MESMO profissional
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`1|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')
    const botaoConfirmar = within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' })
    await waitFor(() => {
      expect(botaoConfirmar).toBeEnabled()
    })
    await usuario.click(botaoConfirmar)
    await waitFor(() => {
      expect(puts).toHaveLength(1)
    })
    // a confirmação fecha no sucesso antes de abrirmos o painel de leitura
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // ACT 2: pelo FORMULÁRIO — o mesmo de→para
    await usuario.click(screen.getByRole('button', { name: 'Paciente Fictício' }))
    const painel = await screen.findByRole('dialog')
    await usuario.click(within(painel).getByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Editar' }))
    const formulario = await screen.findByRole('alertdialog')
    const hora = within(formulario).getByLabelText(/^Hora/)
    await usuario.clear(hora)
    await usuario.type(hora, '09:00')
    await usuario.click(within(formulario).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => {
      expect(puts).toHaveLength(2)
    })

    // ASSERT: mesmo endpoint, mesmo destino efetivo — o payload do arrasto é o
    // SUBCONJUNTO mínimo do que o formulário envia (nenhuma chave nova, nenhum
    // valor divergente)
    const [doArrasto, doFormulario] = puts
    expect(doArrasto.id).toBe(doFormulario.id)
    expect(doArrasto.corpo.inicio).toBe(`${DIA_FICTICIO} 09:00`)
    expect(doFormulario.corpo.inicio).toBe(doArrasto.corpo.inicio)
    // profissional NÃO mudou, e mesmo assim ele VAI: o contrato vivo do PUT o
    // exige `required` incondicional (Ana→Ana dava 422 quando o arrasto omitia)
    expect(doArrasto.corpo.profissional_id).toBe(1)
    expect(doFormulario.corpo.profissional_id).toBe(1)
    for (const [chave, valor] of Object.entries(doArrasto.corpo)) {
      expect(doFormulario.corpo[chave]).toEqual(valor)
    }
  })
})

describe('Agenda — foco pós-confirmação (WCAG 2.4.3)', () => {
  it('deve devolver o foco ao card remarcado no DESTINO após o sucesso', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    servidor.use(msw.put('/api/agendamentos/:id', () => HttpResponse.json(cardFicticio())))
    await screen.findByRole('table')

    // ACT: arrasta, confirma e espera a gravação concluir
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')
    const botao = within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' })
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })
    await usuario.click(botao)
    await screen.findByText('Agendamento atualizado.')

    // ASSERT: o foco pousa no card remarcado (a grade re-renderizada) — nunca
    // evapora para o <body> depois que o diálogo fecha
    await waitFor(() => {
      expect(document.querySelector('[data-card-id="1"]')).toHaveFocus()
    })
  })

  it('deve devolver o foco ao gatilho "Remarcar…" de origem ao cancelar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ACT
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // ASSERT: cancelar devolve ao GATILHO do card de origem (não ao body)
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Remarcar Paciente Fictício para outro horário' }),
      ).toHaveFocus()
    })
  })
})

describe('Agenda — gesto de TOQUE (pan nativo × arrasto)', () => {
  it('deve segurar o pan nativo com touchmove NÃO-passivo só enquanto o gesto está ativo', async () => {
    // ARRANGE
    renderizarAgenda()
    await screen.findByRole('table')
    const restaurar = stubElementFromPoint(null)
    fireEvent.pointerDown(screen.getByRole('article'), {
      button: 0,
      pointerId: 7,
      pointerType: 'touch',
      clientX: 10,
      clientY: 10,
    })

    // ASSERT 1: antes do press-and-hold, o scroll é do navegador
    const antesDoHold = new Event('touchmove', { bubbles: true, cancelable: true })
    window.dispatchEvent(antesDoHold)
    expect(antesDoHold.defaultPrevented).toBe(false)

    // ACT: o hold de 250ms ativa o gesto (act: o timer dispara setState)
    await act(async () => {
      await new Promise((resolver) => {
        setTimeout(resolver, 300)
      })
    })
    expect(document.querySelector('[data-fantasma-arrasto]')).not.toBeNull()

    // ASSERT 2: com o gesto ativo, o touchmove é prevenido — sem isto o
    // navegador dispararia pointercancel e mataria o arrasto pós-hold
    const duranteOGesto = new Event('touchmove', { bubbles: true, cancelable: true })
    window.dispatchEvent(duranteOGesto)
    expect(duranteOGesto.defaultPrevented).toBe(true)

    // ASSERT 3: soltar encerra e devolve o scroll ao navegador
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 10, clientY: 10 })
    const depoisDoGesto = new Event('touchmove', { bubbles: true, cancelable: true })
    window.dispatchEvent(depoisDoGesto)
    expect(depoisDoGesto.defaultPrevented).toBe(false)
    restaurar()
  })
})

describe('Agenda — supressão determinística do clique do soltar', () => {
  it('deve engolir só o clique-fantasma do soltar; o próximo pointerdown desarma', async () => {
    // ARRANGE: soltar em célula RECUSADA também engole o clique que se segue
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`1|${DIA_FICTICIO}|13:00`))

    // ACT 1: o clique que o navegador emite após o soltar (SEM pointerdown)
    fireEvent.click(screen.getByRole('button', { name: 'Paciente Fictício' }))

    // ASSERT 1: engolido — o painel de leitura NÃO abre por causa do soltar
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // ACT 2 + ASSERT 2: o próximo gesto REAL (pointerdown desarma a flag) abre
    await usuario.click(screen.getByRole('button', { name: 'Paciente Fictício' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('Agenda — a confirmação e a série (estados)', () => {
  const CARD_EM_SERIE = { recorrencia_grupo_id: 'serie-ficticia' }

  it('deve reservar a caixa da série e só habilitar o confirmar com o alcance resolvido', async () => {
    // ARRANGE: agendamento EM série; o tamanho real demora a chegar
    renderizarAgenda({ cards: [cardFicticio(CARD_EM_SERIE)] })
    servidor.use(
      msw.get('/api/agendamentos/:id', () => HttpResponse.json(cardFicticio(CARD_EM_SERIE))),
      msw.get('/api/agendamentos/:id/serie', async () => {
        await delay(400)
        return HttpResponse.json({ em_serie: true, total: 24, a_partir_deste: 20, futuros: 19 })
      }),
    )
    await screen.findByRole('table')

    // ACT: solta e espera o DETALHE chegar (o de→para aparece)
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(within(confirmacao).getByText(/13\/07\/2026 às 08:00/)).toBeInTheDocument()
    })

    // ASSERT 1: a caixa do bloco de série está RESERVADA (skeleton) e quem
    // confirma rápido não grava antes de ver a opção
    expect(confirmacao.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' })).toBeDisabled()

    // ASSERT 2: alcance resolvido — a opção aparece no MESMO lugar e o confirmar habilita
    expect(
      await within(confirmacao).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' })).toBeEnabled()
    })
  })

  it('deve avisar com retry quando a consulta da série falha, em vez de sumir mudo', async () => {
    // ARRANGE: as duas primeiras tentativas caem (a query re-tenta 1x); o
    // retry MANUAL encontra o servidor de volta
    const usuario = userEvent.setup()
    let chamadas = 0
    renderizarAgenda({ cards: [cardFicticio(CARD_EM_SERIE)] })
    servidor.use(
      msw.get('/api/agendamentos/:id', () => HttpResponse.json(cardFicticio(CARD_EM_SERIE))),
      msw.get('/api/agendamentos/:id/serie', () => {
        chamadas += 1
        if (chamadas <= 2) {
          return new HttpResponse(null, { status: 500 })
        }
        return HttpResponse.json({ em_serie: true, total: 24, a_partir_deste: 20, futuros: 19 })
      }),
    )
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ASSERT 1: a falha aparece ONDE a pessoa está olhando, com saída (o
    // timeout largo cobre o re-tento automático da query, ~1s de espera)
    expect(
      await within(confirmacao).findByText(/Não foi possível verificar a série/, undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument()
    // resolvida (com erro), a confirmação não fica refém: dá para remarcar SÓ este
    await waitFor(() => {
      expect(within(confirmacao).getByRole('button', { name: 'Remarcar agendamento' })).toBeEnabled()
    })

    // ACT + ASSERT 2: o retry recupera a opção de série
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Tentar novamente' }))
    expect(
      await within(confirmacao).findByRole('checkbox', { name: /Aplicar também nos seguintes/ }),
    ).toBeInTheDocument()
  })

  it('deve nomear a ORIGEM pelo catálogo quando o detalhe vem sem a relação profissional', async () => {
    // ARRANGE: o `show` real só manda escalares — nada de objeto `profissional`
    renderizarAgenda()
    servidor.use(
      msw.get('/api/agendamentos/:id', () => HttpResponse.json(cardFicticio({ profissional: null }))),
    )
    await screen.findByRole('table')

    // ACT
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')

    // ASSERT: o nome sai do catálogo que a página já carrega — nunca "—"
    await waitFor(() => {
      expect(
        within(confirmacao).getByText(/13\/07\/2026 às 08:00 · Profissional Fictício A/),
      ).toBeInTheDocument()
    })
  })
})

describe('Agenda — axe da confirmação aberta', () => {
  it('deve não ter violações axe com a confirmação aberta e a opção de série visível', async () => {
    // ARRANGE: série resolvida — o estado de conteúdo COMPLETO do diálogo
    renderizarAgenda({ cards: [cardFicticio({ recorrencia_grupo_id: 'serie-ficticia' })] })
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json(cardFicticio({ recorrencia_grupo_id: 'serie-ficticia' })),
      ),
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 24, a_partir_deste: 20, futuros: 19 }),
      ),
    )
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')
    await within(confirmacao).findByRole('checkbox', { name: /Aplicar também nos seguintes/ })

    // ACT: o diálogo vive num portal — o axe corre no body, não no container
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe no estado de ERRO da confirmação', async () => {
    // ARRANGE: o detalhe fresco falha — o diálogo mostra o erro com retry
    renderizarAgenda()
    servidor.use(
      msw.get('/api/agendamentos/:id', () => new HttpResponse(null, { status: 500 })),
    )
    await screen.findByRole('table')
    arrastarPara(screen.getByRole('article'), celulaDaGrade(`2|${DIA_FICTICIO}|09:00`))
    const confirmacao = await screen.findByRole('dialog')
    // o timeout largo cobre o re-tento automático da query (~1s de espera)
    await within(confirmacao).findByText(
      'Não foi possível carregar o agendamento para remarcar.',
      undefined,
      { timeout: 5000 },
    )

    // ACT
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})

/**
 * O SLOT COBERTO PELO PRÓPRIO CARD (change `arrastar-para-slot-coberto`).
 *
 * Uma sessão que ocupa mais de um slot não podia ser adiantada nem atrasada em UM slot: a linha
 * coberta não é renderizada (é `continuacao`, e quem desenha os dois slots é o `rowSpan`), então
 * o hit-test subia até o `<td>` do card e resolvia o INÍCIO dele. O modelo reconhecia "mesmo
 * profissional, mesmo início", recusava o não-movimento — corretamente — e o gesto morria em
 * silêncio.
 *
 * Reportado pelo usuário com o caso exato, e medido: as linhas de continuação têm ZERO `<td>`.
 * Na clínica a Musicoterapia tem sessão de 80 min, então TODA sessão longa sofria.
 */
describe('Agenda — arrastar uma sessão longa para o slot que ela mesma cobre', () => {
  const CARD_LONGO = cardFicticio({
    inicio: `${DIA_FICTICIO} 08:00`,
    fim: `${DIA_FICTICIO} 10:00`,
    duracao_minutos: 120, // granularidade da fixture é 60 → dois slots
  })

  it('deve resolver o slot pela POSIÇÃO, e não pelo início do card que cobre a faixa', async () => {
    /*
     * ARRANGE — o ponteiro cai na faixa visual das 09:00, que o card cobre. O hit-test devolve
     * um elemento DE DENTRO do card (é o que o navegador faz: ali não há célula), e o
     * `closest('[data-slot]')` sobe até o `<td rowspan="2">`, cujo slot é 08:00.
     */
    renderizarAgenda({ cards: [CARD_LONGO] })
    await screen.findByText('Paciente Fictício')
    fingirFaixasDasLinhas()
    const dentroDoCard = screen.getByRole('article')

    // ACT — solta na SEGUNDA faixa (y=40..80 → a linha das 09:00)
    const restaurar = stubElementFromPoint(dentroDoCard)
    fireEvent.pointerDown(dentroDoCard, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 60 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 60 })
    restaurar()

    // ASSERT — a confirmação abre, e o DESTINO é 09:00. Antes disso o alvo resolvia para
    // 08:00 (o início do próprio card), o modelo recusava o não-movimento e nada acontecia.
    const confirmacao = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(within(confirmacao).getByText(/às 08:00 · Profissional Fictício A/)).toBeInTheDocument()
    })
    expect(within(confirmacao).getByText(/às 09:00 · Profissional Fictício A/)).toBeInTheDocument()
  })

  it('deve continuar recusando quando a faixa resolvida É a posição atual', async () => {
    /*
     * ARRANGE — o outro lado da guarda. Sem ele, o conserto poderia ter passado a aceitar
     * QUALQUER soltura sobre o próprio card, inclusive a que não move nada — e o modelo recusar
     * o não-movimento é comportamento CERTO, que a change não pode ter quebrado.
     */
    renderizarAgenda({ cards: [CARD_LONGO] })
    await screen.findByText('Paciente Fictício')
    fingirFaixasDasLinhas()
    const dentroDoCard = screen.getByRole('article')

    // ACT — solta na PRIMEIRA faixa (y=0..40 → a linha das 08:00, onde o card já está)
    const restaurar = stubElementFromPoint(dentroDoCard)
    fireEvent.pointerDown(dentroDoCard, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 20 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 80, clientY: 20 })
    restaurar()

    // ASSERT — nenhuma confirmação: mover para onde já está não é remarcar
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
