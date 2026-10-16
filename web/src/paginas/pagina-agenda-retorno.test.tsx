import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { entradaFicticia, handlersDaFila } from '@/test/dados-fila'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CardAgendamento } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * Modo RETORNO da agenda (`?paciente=<id>`) — o caminho que a fila de pendências abre para
 * marcar o retorno de uma criança.
 *
 * O que estas guardas prendem, e por quê:
 * - o NOME de um MENOR nunca vai para a query string (gatilho `LOG`): ele chega por leitura
 *   por-id, e nem o link da fila nem a busca do formulário podem levá-lo à URL;
 * - o modo é VISÍVEL (faixa) — modo invisível marcaria para a criança errada em silêncio;
 * - o modo não engata quando o id não resolve nem sem `agenda.criar` (fail-closed de UI);
 * - o encaixe PREVALECE: ele é a operação que o servidor consome.
 */

const PERMISSOES = ['agenda.ver', 'agenda.criar', 'agenda.editar', 'lista_espera.ver', 'lista_espera.excluir']

const CRIANCA = { id: 10, nome: 'Paciente Fictício', nome_social: null }

/** Folga sobre o debounce da busca (300ms) — o tempo que uma requisição teria para sair. */
const JANELA_DO_DEBOUNCE_MS = 500

/** Requisições à rota de seleção de pacientes, para provar o que a tela NÃO manda. */
let buscasDePaciente: string[] = []

/** Ids cujos tratamentos o formulário foi buscar — diz de QUEM é o horário que ele está montando. */
let tratamentosPedidosPara: string[] = []

/**
 * A rota de seleção com CONSCIÊNCIA de parâmetro: `?id=` nomeia (lista de 0 ou 1),
 * `?busca=` procura. É a forma real do servidor — um handler que devolve a mesma coisa
 * para qualquer parâmetro deixaria passar o modo ligando com id que não resolve.
 */
function handlerDaSelecaoDePacientes(pacientes = [CRIANCA], atrasarNomePorId?: Promise<void>) {
  return msw.get('/api/agenda/selecao/pacientes', async ({ request }) => {
    const url = new URL(request.url)
    buscasDePaciente.push(url.search)
    const id = url.searchParams.get('id')
    if (id !== null) {
      // o atraso simula a rede lenta da corrida do CR-AR-04 — a resposta só sai quando o teste solta
      if (atrasarNomePorId !== undefined) {
        await atrasarNomePorId
      }
      return HttpResponse.json(pacientes.filter((paciente) => String(paciente.id) === id))
    }
    return HttpResponse.json(pacientes)
  })
}

/**
 * O modo está LIGADO quando é anunciado (região viva) E visível (faixa com o cancelar) —
 * modo invisível marcaria para a criança errada em silêncio, e faixa sem anúncio deixaria
 * quem usa leitor de tela sem saber em que estado a agenda está.
 *
 * A grade vazia também usa `role="status"` ("Nenhum agendamento neste período"): por isso a
 * asserção procura o anúncio ENTRE as regiões vivas, em vez de exigir que só exista uma.
 */
async function esperarModoLigado(nome: string) {
  const cancelar = await screen.findByRole('button', { name: 'Cancelar retorno' })
  expect(cancelar.closest('div')).toHaveTextContent(new RegExp(`Marcando retorno de ${nome}`))

  const anuncios = screen.getAllByRole('status').map((no) => no.textContent ?? '')
  expect(anuncios.some((texto) => texto.includes(`Marcando retorno de ${nome}`))).toBe(true)
}

/** O modo DESLIGADO não deixa resíduo: nem faixa, nem anúncio. */
function esperarModoDesligado() {
  expect(screen.queryByRole('button', { name: 'Cancelar retorno' })).not.toBeInTheDocument()
  expect(screen.queryAllByText(/Marcando retorno de/)).toHaveLength(0)
}

function renderizarAgenda(
  rota: string,
  permissoes: string[] = PERMISSOES,
  pacientes = [CRIANCA],
  opcoes: { cards?: CardAgendamento[]; atrasarNomePorId?: Promise<void> } = {},
) {
  // o handler instrumentado vem ANTES: dentro de um mesmo `use()`, o primeiro que casa vence —
  // e o de `handlersDaAgenda` devolve a lista inteira para QUALQUER parâmetro, o que esconderia
  // o caso do id que não resolve
  servidor.use(
    handlerDaSelecaoDePacientes(pacientes, opcoes.atrasarNomePorId),
    msw.get('/api/agenda/selecao/tratamentos', ({ request }) => {
      tratamentosPedidosPara.push(new URL(request.url).searchParams.get('paciente_id') ?? '')
      return HttpResponse.json([])
    }),
    ...handlersDaAgenda(opcoes.cards ?? []),
    ...handlersDaFila(),
  )
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[rota]}>
          <PaginaAgenda />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** O gesto do modo: escolher o primeiro horário livre da grade. */
async function marcarNoPrimeiroSlot(usuario: ReturnType<typeof userEvent.setup>) {
  const slots = await screen.findAllByRole('button', { name: /^Marcar às/ })
  await usuario.click(slots[0])

  return screen.findByRole('alertdialog')
}

beforeEach(() => {
  queryClient.clear()
  buscasDePaciente = []
  tratamentosPedidosPara = []
})

describe('Agenda — modo retorno', () => {
  it('deve anunciar de quem é o retorno que está sendo marcado', async () => {
    // ARRANGE + ACT
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`)

    // ASSERT — a faixa nomeia a criança, diz o próximo gesto, e o modo é anunciado
    await esperarModoLigado('Paciente Fictício')
  })

  it('deve resolver o nome por id, sem o nome passar pela URL', async () => {
    // ARRANGE + ACT
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`)
    await esperarModoLigado('Paciente Fictício')

    // ASSERT — a leitura foi por id, e nenhuma requisição levou o nome do menor
    expect(buscasDePaciente).toContain('?id=10')
    expect(buscasDePaciente.every((busca) => !busca.includes('busca='))).toBe(true)
    expect(buscasDePaciente.join(' ')).not.toContain('Fict')
  })

  it('deve abrir o formulário com a criança escolhida e EDITÁVEL', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`)
    await esperarModoLigado('Paciente Fictício')

    // ACT
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ASSERT — criação COMUM (não encaixe): campo de busca presente, com a criança dentro
    expect(within(dialog).getByRole('heading', { name: 'Novo agendamento' })).toBeInTheDocument()
    const campo = within(dialog).getByRole('combobox', { name: /Paciente/ })
    expect(campo).toHaveValue('Paciente Fictício')
    expect(campo).toBeEnabled()
    // recorrência continua disponível: retorno é um agendamento comum, não um encaixe
    // a repetição existe no formulário de criação (o rótulo virou "Repetir" com o intervalo,
    // change `repeticao-da-serie`)
    expect(within(dialog).getByLabelText('Repetir')).toBeInTheDocument()
  })

  it('não deve buscar o nome do menor por ter pré-preenchido o campo', async () => {
    // ARRANGE — o campo exibe o nome; se isso alimentasse a BUSCA, o nome de um MENOR iria
    // para a query string (e para o access log) sem ninguém ter digitado nada
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`)
    await esperarModoLigado('Paciente Fictício')

    // ACT — abrir o formulário e FOCAR o campo (o momento em que a lista abriria)
    const dialog = await marcarNoPrimeiroSlot(usuario)
    const campo = within(dialog).getByRole('combobox', { name: /Paciente/ })
    await usuario.click(campo)

    // A janela do debounce tem de PASSAR antes de uma asserção negativa. Sem esperá-la, o teste
    // afirmaria silêncio por ter chegado antes de a requisição ter chance de sair — proxy do
    // relógio, não do comportamento. (Foi exatamente assim que ele passou com a guarda erodida.)
    await new Promise((resolver) => setTimeout(resolver, JANELA_DO_DEBOUNCE_MS))

    // ASSERT — nada saiu, e o campo não mente dizendo "nenhum resultado" para quem ESTÁ escolhido
    expect(buscasDePaciente.filter((busca) => busca.includes('busca='))).toHaveLength(0)
    expect(within(dialog).queryByText(/Nenhum resultado/)).not.toBeInTheDocument()

    // ...e a busca continua FUNCIONANDO: digitar por cima procura de verdade (a guarda silencia o
    // pré-preenchido, não o campo). Sem esta metade, a guarda poderia ter matado a busca inteira.
    await usuario.clear(campo)
    await usuario.type(campo, 'Ou')
    await waitFor(() => {
      expect(buscasDePaciente.some((busca) => busca.includes('busca=Ou'))).toBe(true)
    })
    expect(buscasDePaciente.join(' ')).not.toContain('Fict')
  })

  it('deve permitir trocar a criança pré-selecionada', async () => {
    // ARRANGE — quem acionou a linha errada da fila precisa poder corrigir
    const usuario = userEvent.setup()
    const outra = { id: 11, nome: 'Outra Criança Fictícia', nome_social: null }
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`, PERMISSOES, [CRIANCA, outra])
    await esperarModoLigado('Paciente Fictício')
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT — digitar por cima desfaz a escolha e busca de novo
    const campo = within(dialog).getByRole('combobox', { name: /Paciente/ })
    await usuario.clear(campo)
    await usuario.type(campo, 'Outra')
    await usuario.click(await within(dialog).findByRole('option', { name: 'Outra Criança Fictícia' }))

    // ASSERT
    expect(campo).toHaveValue('Outra Criança Fictícia')
  })

  it('deve ignorar um parâmetro de paciente inválido na URL', async () => {
    // ARRANGE — `?paciente=abc` viraria NaN: a agenda não pode quebrar por isso
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=abc`)

    // ACT
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ASSERT — sem faixa, e o formulário abre para escolher
    esperarModoDesligado()
    expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toHaveValue('')
    // ...e a guarda numérica é do CLIENTE: `?paciente=abc` não vira requisição de IDENTIFICAÇÃO
    // nenhuma. Sem esta asserção o teste passava com a guarda erodida — o modo ficava desligado
    // porque o SERVIDOR devolvia vazio para `?id=NaN`, não porque a tela recusou (achado CR-AR-02).
    //
    // O que o formulário PODE pedir ao abrir são os modos sem identificação (`?recentes=1`,
    // `?pagina=`), que a change `busca-de-paciente-com-lista` trouxe: eles não carregam id nem
    // nome — são LOG-safe por construção, e é isso que a asserção separa.
    expect(buscasDePaciente.filter((busca) => busca.includes('id=') || busca.includes('busca='))).toEqual([])
    expect(buscasDePaciente.join(' ')).not.toContain('Fict')
  })

  it('não deve engatar o modo quando o id não resolve', async () => {
    // ARRANGE — inativado ou apagado: o servidor responde vazio-uniforme
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=404`, PERMISSOES, [CRIANCA])

    // ACT
    await screen.findByRole('table')
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ASSERT — nunca um modo meio ligado: sem faixa e sem criança pré-escolhida
    esperarModoDesligado()
    expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toHaveValue('')
  })

  it('não deve engatar o modo sem a permissão de criar', async () => {
    // ARRANGE — a URL pode ser digitada à mão; marcar é o que o modo existe para fazer
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`, ['agenda.ver'])

    // ACT
    await screen.findByRole('table')

    // ASSERT
    esperarModoDesligado()
  })

  it('deve encerrar o modo quando o agendamento é criado', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let enviado: unknown = null
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`)
    servidor.use(
      msw.post('/api/agendamentos', async ({ request }) => {
        enviado = await request.json()
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    await esperarModoLigado('Paciente Fictício')
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT — a especialidade NÃO vem pré-escolhida de propósito (design D7: ela depende do
    // profissional do slot), então é a recepção que a escolhe, como em qualquer criação
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '1')
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT — o `paciente_id` sai do FORMULÁRIO (criação comum), e a faixa some
    await waitFor(() => {
      expect(enviado).toMatchObject({ paciente_id: 10, profissional_id: 1 })
    })
    await waitFor(() => {
      esperarModoDesligado()
    })
  })

  it('deve manter o modo quando o formulário é fechado sem criar', async () => {
    // ARRANGE — o slot era o errado: a recepção precisa escolher outro horário
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`)
    await esperarModoLigado('Paciente Fictício')
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ACT
    await usuario.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    // ASSERT — a faixa continua: o modo sobrevive ao formulário
    await esperarModoLigado('Paciente Fictício')
  })

  it('deve encerrar o modo pela faixa, sem escrever nada', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let criou = false
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`)
    servidor.use(
      msw.post('/api/agendamentos', () => {
        criou = true
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    await esperarModoLigado('Paciente Fictício')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Cancelar retorno' }))

    // ASSERT
    await waitFor(() => {
      esperarModoDesligado()
    })
    expect(criou).toBe(false)
    // a agenda continua no mesmo dia e visão — cancelar o modo não navega
    expect(screen.getByLabelText('Data da agenda')).toHaveValue('13/07/2026')
  })

  it('deve dar precedência ao encaixe quando os dois modos vêm na URL', async () => {
    // ARRANGE — combinação sem sentido de produto, mas precisa de resposta determinística:
    // o encaixe é a OPERAÇÃO que o servidor consome (tira da fila) e traz paciente próprio
    const usuario = userEvent.setup()
    servidor.use(msw.get('/api/lista-espera', () => HttpResponse.json([entradaFicticia()])))
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&encaixe=1&paciente=10`)

    // ACT
    await screen.findByRole('table')
    const dialog = await marcarNoPrimeiroSlot(usuario)

    // ASSERT — formulário de ENCAIXE (paciente em leitura), e nenhuma faixa de retorno
    expect(within(dialog).getByRole('heading', { name: 'Encaixar da lista de espera' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: /Paciente/ })).not.toBeInTheDocument()
    esperarModoDesligado()
  })

  it('não deve dar ao card em EDIÇÃO a criança que o modo trouxe', async () => {
    // ARRANGE — abrir um card existente é edição, e a criança dele é a que está GRAVADA. Herdar a
    // do modo faria a tela mentir sobre de quem é o horário e armaria o caminho "corrigir a
    // criança" — o único fluxo que muda DE QUEM é o registro (achado CR-AR-03). A proteção tem
    // duas camadas (página e formulário) e nenhum teste a prendia.
    const usuario = userEvent.setup()
    const cardDeOutraCrianca = cardFicticio({
      paciente_id: 20,
      tratamento_id: null,
      paciente: { id: 20, nome: 'Criança Fictícia do Card', nome_social: null },
    })
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`, PERMISSOES, [CRIANCA], {
      cards: [cardDeOutraCrianca],
    })
    await esperarModoLigado('Paciente Fictício')
    // a faixa nasce ANTES da grade (ela é do modo, não da grade — CR-AR-09): esperar a grade
    await screen.findByRole('table')

    // ACT — clicar no card abre o painel de LEITURA; a edição é destino (Mais ações → Editar)
    await usuario.click(screen.getByRole('button', { name: 'Criança Fictícia do Card' }))
    const painel = await screen.findByRole('dialog')
    await usuario.click(within(painel).getByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT — a criança do CARD, e os tratamentos dela; nunca a do modo
    expect(within(dialog).getByRole('heading', { name: 'Editar agendamento' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toHaveValue('Criança Fictícia do Card')
    expect(tratamentosPedidosPara).toContain('20')
    expect(tratamentosPedidosPara).not.toContain('10')
  })

  it('deve adotar a criança que chega DEPOIS de o formulário abrir', async () => {
    // ARRANGE — a corrida: numa rede lenta o slot é clicado antes de a leitura por-id resolver. O
    // pré-preenchimento roda uma vez na abertura, então sem adoção tardia a criança nunca entraria
    // — e a faixa prometeria alguém que o campo não mostra (achado CR-AR-04, "modo meio ligado").
    const usuario = userEvent.setup()
    let liberarNome = () => {}
    const nomeAtrasado = new Promise<void>((resolver) => {
      liberarNome = resolver
    })
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`, PERMISSOES, [CRIANCA], {
      atrasarNomePorId: nomeAtrasado,
    })

    // ACT — clicar no slot ANTES de o nome chegar; só então o servidor responde
    const dialog = await marcarNoPrimeiroSlot(usuario)
    expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toHaveValue('')
    liberarNome()

    // ASSERT — o formulário aberto recebe a criança, sem a recepção redigitar nada
    await waitFor(() => {
      expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toHaveValue('Paciente Fictício')
    })
  })

  it('não deve trocar a criança que a recepção escolheu enquanto o nome não chegava', async () => {
    // ARRANGE — a outra metade da corrida (achado SEC-AR-06 da rodada 2 do gate): campo vazio na
    // abertura, a recepção escolhe OUTRA criança ("não é essa, é a irmã") e SÓ ENTÃO o nome do modo
    // chega. Trocar a escolha aqui marcaria sessão no menor errado — e, como rótulo e id trocariam
    // JUNTOS, nada no servidor detectaria (o vínculo tratamento↔paciente é barrado lá; o paciente
    // escolhido, não). Era a única perna da guarda sem teste: apagá-la deixava a suíte verde.
    const usuario = userEvent.setup()
    const irma = { id: 11, nome: 'Irmã Fictícia da Criança', nome_social: null }
    let liberarNome = () => {}
    const nomeAtrasado = new Promise<void>((resolver) => {
      liberarNome = resolver
    })
    let enviado: unknown = null
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`, PERMISSOES, [CRIANCA, irma], {
      atrasarNomePorId: nomeAtrasado,
    })
    servidor.use(
      msw.post('/api/agendamentos', async ({ request }) => {
        enviado = await request.json()
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )

    // ACT — escolher a irmã ANTES de o nome do modo chegar
    const dialog = await marcarNoPrimeiroSlot(usuario)
    const campo = within(dialog).getByRole('combobox', { name: /Paciente/ })
    expect(campo).toHaveValue('')
    await usuario.type(campo, 'Irmã')
    await usuario.click(await within(dialog).findByRole('option', { name: 'Irmã Fictícia da Criança' }))
    liberarNome()

    // ASSERT — a escolha da recepção RESISTE à chegada do nome...
    await waitFor(() => {
      expect(buscasDePaciente.some((busca) => busca.includes('id=10'))).toBe(true)
    })
    expect(campo).toHaveValue('Irmã Fictícia da Criança')

    // ...e é ela que vai no payload
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '1')
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))
    await waitFor(() => {
      expect(enviado).toMatchObject({ paciente_id: irma.id })
    })
  })

  it('deve manter o modo quando o encaixe da URL não é candidato', async () => {
    // ARRANGE — `?encaixe=abc` (ou um encaixe sem `lista_espera.excluir`) NUNCA engataria; enquanto
    // a precedência olhava só a PRESENÇA do parâmetro, ele matava os dois modos — o retorno morria
    // por um encaixe que não existia. Hoje os dois pontos leem o mesmo predicado (achado CR-AR-05);
    // esta é a guarda que faltava para o conserto não se desfazer em silêncio (CR-AR-12).
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&encaixe=abc&paciente=10`)

    // ASSERT
    await esperarModoLigado('Paciente Fictício')
  })

  it('não deve ter violações de acessibilidade com o modo ligado', async () => {
    // ARRANGE
    const { container } = renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&paciente=10`)
    await esperarModoLigado('Paciente Fictício')

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
