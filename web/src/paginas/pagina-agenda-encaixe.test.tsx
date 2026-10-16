import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { entradaFicticia, handlersDaFila } from '@/test/dados-fila'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

const PERMISSOES = [
  'agenda.ver',
  'agenda.criar',
  'agenda.editar',
  'agenda.excluir',
  'lista_espera.ver',
  'lista_espera.excluir',
]

function renderizarAgenda(rota = `/agenda?data=${DIA_FICTICIO}`, permissoes: string[] = PERMISSOES) {
  servidor.use(...handlersDaAgenda([]), ...handlersDaFila())
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

/** Painel → "Encaixar" → primeiro horário livre da grade. */
async function encaixarNoPrimeiroSlot(usuario: ReturnType<typeof userEvent.setup>) {
  const painel = await screen.findByRole('region', { name: 'Lista de espera' })
  await usuario.click(await within(painel).findByRole('button', { name: /Encaixar/ }))

  const slots = await screen.findAllByRole('button', { name: /^Marcar às/ })
  await usuario.click(slots[0])

  return screen.findByRole('alertdialog')
}

beforeEach(() => {
  queryClient.clear()
})

describe('Agenda — encaixe da lista de espera', () => {
  it('deve não mandar pacote de outra especialidade no payload do encaixe (CR-TNE-03)', async () => {
    // ARRANGE: o encaixe monta payload PRÓPRIO — a derivação do pacote efetivo tem de valer nele
    // também, senão o id de um pacote que a tela já não mostra viaja escondido
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizarAgenda()
    servidor.use(
      msw.post('/api/lista-espera/:id/encaixar', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    const dialog = await encaixarNoPrimeiroSlot(usuario)

    // ACT: escolhe o pacote de Fonoaudiologia e depois troca para o profissional de Psicologia
    await usuario.selectOptions(within(dialog).getByLabelText(/Tratamento/), '5')
    await usuario.selectOptions(within(dialog).getByLabelText(/Profissional/), '2')
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade/), '2')
    await usuario.click(within(dialog).getByRole('button', { name: /^Encaixar/ }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ especialidade_id: 2, tratamento_id: null })
  })

  it('deve encaixar o paciente da fila num horário livre', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let enviado: unknown = null
    let urlDoEncaixe = ''
    // fila com estado: encaixou ⇒ o servidor a esvazia (é a mesma operação)
    const fila = [entradaFicticia()]
    renderizarAgenda()
    servidor.use(
      msw.get('/api/lista-espera', () => HttpResponse.json(fila)),
      msw.post('/api/lista-espera/:id/encaixar', async ({ request, params }) => {
        enviado = await request.json()
        urlDoEncaixe = String(params.id)
        fila.length = 0
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )

    // ACT
    const dialog = await encaixarNoPrimeiroSlot(usuario)

    // ASSERT — o paciente NÃO se escolhe: é quem estava na fila
    expect(within(dialog).getByRole('heading', { name: 'Encaixar da lista de espera' })).toBeInTheDocument()
    expect(within(dialog).getByText('Paciente Fictício')).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: /Paciente/ })).not.toBeInTheDocument()
    // encaixe é UM horário que abriu — recorrência nem aparece (a API recusa)
    // encaixe é um horário que abriu, não uma série: a repetição não aparece
    expect(within(dialog).queryByLabelText('Repetir')).not.toBeInTheDocument()

    await usuario.click(within(dialog).getByRole('button', { name: 'Encaixar' }))

    // uma operação só: o servidor cria o agendamento E tira da fila
    await waitFor(() => {
      expect(urlDoEncaixe).toBe('1')
    })
    expect(enviado).toMatchObject({
      inicio: `${DIA_FICTICIO} 08:00`,
      profissional_id: 1,
      especialidade_id: 1,
    })
    // `paciente_id` no payload é 422 no servidor — a tela não o manda
    expect(enviado).not.toHaveProperty('paciente_id')

    // e a fila anda na tela, sem recarregar a página (cenário da spec)
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })
    await waitFor(() => {
      expect(within(painel).queryAllByRole('listitem')).toHaveLength(0)
    })
  })

  it('deve manter o paciente na fila quando o servidor recusa o horário', async () => {
    // ARRANGE — a recusa do domínio derruba a transação inteira: ninguém perde
    // o lugar na fila, e a tela precisa dizer POR QUÊ, no campo certo
    const usuario = userEvent.setup()
    renderizarAgenda()
    servidor.use(
      msw.post('/api/lista-espera/:id/encaixar', () =>
        HttpResponse.json(
          {
            message: 'Horário ocupado do profissional.',
            errors: { profissional_id: ['Horário ocupado do profissional.'] },
          },
          { status: 422 },
        ),
      ),
    )

    // ACT
    const dialog = await encaixarNoPrimeiroSlot(usuario)
    await usuario.click(within(dialog).getByRole('button', { name: 'Encaixar' }))

    // ASSERT — a recusa aparece no campo que a causou, e o dialog fica aberto
    // para corrigir (o horário é o errado, não o paciente)
    expect(await within(dialog).findByText('Horário ocupado do profissional.')).toBeInTheDocument()

    // e o paciente continua esperando: o handler REMOVE quem é encaixado (a fila
    // do MSW tem estado), então a linha da fila só sobrevive se nada saiu
    await usuario.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })
    const naFila = within(painel).getAllByRole('listitem')
    expect(naFila).toHaveLength(1)
    expect(within(naFila[0]).getByText('Paciente Fictício')).toBeInTheDocument()
  })

  it('não deve entrar em modo encaixe sem a permissão que o servidor exige', async () => {
    // ARRANGE — `lista_espera.ver` sem `lista_espera.excluir`: a URL pode ser
    // digitada à mão, mas o botão não pode prometer um 403
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&encaixe=1`, [
      'agenda.ver',
      'agenda.criar',
      'lista_espera.ver',
    ])

    // ACT
    const slots = await screen.findAllByRole('button', { name: /^Marcar às/ })
    await usuario.click(slots[0])
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT — agendamento novo comum, sem paciente travado
    expect(within(dialog).getByRole('heading', { name: 'Novo agendamento' })).toBeInTheDocument()
    const painel = screen.queryByRole('region', { name: 'Lista de espera' })
    expect(painel).not.toBeInTheDocument() // dialog esconde o resto; basta o título
  })

  it('deve ignorar um parâmetro de encaixe inválido na URL', async () => {
    // ARRANGE — `?encaixe=abc` vem da URL: valor não confiável
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&encaixe=abc`)

    // ACT
    const slots = await screen.findAllByRole('button', { name: /^Marcar às/ })
    await usuario.click(slots[0])
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT — a agenda não quebra: é um agendamento novo comum
    expect(within(dialog).getByRole('heading', { name: 'Novo agendamento' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toBeInTheDocument()
  })

  it('não deve mostrar o painel a quem não pode ver a fila', async () => {
    // ARRANGE — sem lista_espera.ver, a agenda é exatamente o que era
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}`, ['agenda.ver', 'agenda.criar'])

    // ACT
    await screen.findByRole('table')

    // ASSERT
    expect(screen.queryByRole('region', { name: 'Lista de espera' })).not.toBeInTheDocument()
  })
})
