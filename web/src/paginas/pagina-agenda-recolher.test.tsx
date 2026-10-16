import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { useAuthStore } from '@/stores/auth-store'
import { DIA_FICTICIO, handlersDaAgenda } from '@/test/dados-agenda'
import { entradaFicticia, handlersDaFila } from '@/test/dados-fila'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

const PERMISSOES = [
  'agenda.ver',
  'agenda.criar',
  'agenda.excluir',
  'lista_espera.ver',
  'lista_espera.excluir',
]

function renderizarAgenda(rota = `/agenda?data=${DIA_FICTICIO}`, permissoes: string[] = PERMISSOES) {
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

describe('Agenda — o painel da fila recolhe', () => {
  it('deve nascer aberto e recolher para o trilho', async () => {
    // ARRANGE
    servidor.use(...handlersDaAgenda([]), ...handlersDaFila())
    const usuario = userEvent.setup()
    renderizarAgenda()
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })

    // ACT
    await usuario.click(within(painel).getByRole('button', { name: 'Recolher a lista de espera' }))

    // ASSERT: a grade fica com a largura que o painel devolveu
    expect(painel).toHaveClass('xl:w-14')
    const botao = within(painel).getByRole('button', { name: 'Expandir a lista de espera' })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    expect(botao).toHaveAttribute('aria-controls', 'corpo-lista-espera')
  })

  it('deve manter o contador à vista no trilho — fila que some ninguém olha', async () => {
    // ARRANGE: duas pessoas esperando pelo mesmo profissional
    servidor.use(
      ...handlersDaAgenda([]),
      ...handlersDaFila([
        entradaFicticia({ id: 1, paciente_id: 10 }),
        entradaFicticia({
          id: 2,
          paciente_id: 11,
          paciente: { id: 11, nome: 'Outro Paciente Fictício', nome_social: null },
          profissional_id: null,
          especialidade_id: null,
        }),
      ]),
    )
    const usuario = userEvent.setup()
    renderizarAgenda()
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })
    await within(painel).findByText('Paciente Fictício')

    // ACT
    await usuario.click(within(painel).getByRole('button', { name: 'Recolher a lista de espera' }))

    // ASSERT: o número continua, o NOME do menor não — o trilho é cromo
    // permanente num balcão onde outras pessoas enxergam a tela, e o nome nem
    // pendurado no DOM fica
    expect(within(painel).getByText('2')).toBeInTheDocument()
    expect(within(painel).queryByText('Paciente Fictício')).not.toBeInTheDocument()
    expect(within(painel).queryByText('Outro Paciente Fictício')).not.toBeInTheDocument()
  })

  it('deve não pintar "0" no trilho quando a fila falhou ao carregar', async () => {
    // ARRANGE: um "0" diria à recepção que a fila está VAZIA
    servidor.use(
      ...handlersDaAgenda([]),
      msw.get('/api/lista-espera', () => new HttpResponse(null, { status: 500 })),
    )
    const usuario = userEvent.setup()
    renderizarAgenda()
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })
    // 500 é falha transitória: o cliente ainda repete uma vez antes de desistir
    await within(painel).findByText('Não foi possível carregar a lista de espera.', undefined, {
      timeout: 5000,
    })

    // ACT
    await usuario.click(within(painel).getByRole('button', { name: 'Recolher a lista de espera' }))

    // ASSERT
    expect(within(painel).queryByText('0')).not.toBeInTheDocument()
    expect(
      within(painel).getByText('Não foi possível carregar a lista de espera'),
    ).toBeInTheDocument()
  })

  it('deve manter o encaixe em andamento visível no trilho', async () => {
    // ARRANGE: a página está esperando um clique num horário livre
    servidor.use(...handlersDaAgenda([]), ...handlersDaFila())
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&encaixe=1`)
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })
    await within(painel).findByText(/Escolha um horário livre/)

    // ACT
    await usuario.click(within(painel).getByRole('button', { name: 'Recolher a lista de espera' }))

    // ASSERT
    expect(
      within(painel).getByText('Encaixe em andamento: escolha um horário livre na grade'),
    ).toBeInTheDocument()
    expect(within(painel).getByRole('button', { name: 'Cancelar encaixe' })).toBeInTheDocument()
    // o encaixe é o único caminho por onde um NOME poderia escorrer para o trilho
    expect(within(painel).queryByText('Paciente Fictício')).not.toBeInTheDocument()
  })

  it('deve não mexer na fila nem cancelar o encaixe ao recolher', async () => {
    // ARRANGE: recolher é decisão de LAYOUT. O handler da fila tem ESTADO — quem
    // sair da fila some de verdade, então "continua na fila" prova alguma coisa.
    servidor.use(...handlersDaAgenda([]), ...handlersDaFila())
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&encaixe=1`)
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })
    // o nome aparece no aviso do encaixe TAMBÉM — a prova é a entrada na LISTA
    const entrada = await within(painel).findByRole('listitem')
    expect(within(entrada).getByText('Paciente Fictício')).toBeInTheDocument()

    // ACT: recolhe e expande de volta
    await usuario.click(within(painel).getByRole('button', { name: 'Recolher a lista de espera' }))
    await usuario.click(within(painel).getByRole('button', { name: 'Expandir a lista de espera' }))

    // ASSERT: a entrada continua na fila E o encaixe continua em andamento
    const aindaNaFila = await within(painel).findByRole('listitem')
    expect(within(aindaNaFila).getByText('Paciente Fictício')).toBeInTheDocument()
    expect(within(painel).getByText(/Escolha um horário livre/)).toBeInTheDocument()
  })

  it('deve cancelar o encaixe pelo trilho', async () => {
    // ARRANGE
    servidor.use(...handlersDaAgenda([]), ...handlersDaFila())
    const usuario = userEvent.setup()
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}&encaixe=1`)
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })
    await within(painel).findByText(/Escolha um horário livre/)
    await usuario.click(within(painel).getByRole('button', { name: 'Recolher a lista de espera' }))

    // ACT
    await usuario.click(within(painel).getByRole('button', { name: 'Cancelar encaixe' }))

    // ASSERT
    await waitFor(() => {
      expect(
        within(painel).queryByText('Encaixe em andamento: escolha um horário livre na grade'),
      ).not.toBeInTheDocument()
    })
  })

  it('deve não oferecer trilho nem botão a quem não pode ver a fila', async () => {
    // ARRANGE: não se recolhe um painel que não existe
    servidor.use(...handlersDaAgenda([]))

    // ACT
    renderizarAgenda(`/agenda?data=${DIA_FICTICIO}`, ['agenda.ver'])
    await screen.findByRole('heading', { name: /Agenda/ })

    // ASSERT
    expect(screen.queryByRole('region', { name: 'Lista de espera' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /(Recolher|Expandir) a lista de espera/ }),
    ).not.toBeInTheDocument()
  })
})

describe('Agenda — o trilho é legível como lista de espera (agenda-com-presenca)', () => {
  it('deve mostrar o rótulo no trilho sem duplicar o nome acessível', async () => {
    // ARRANGE
    servidor.use(...handlersDaAgenda([]), ...handlersDaFila())
    const usuario = userEvent.setup()
    renderizarAgenda()
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })

    // ACT
    await usuario.click(within(painel).getByRole('button', { name: 'Recolher a lista de espera' }))

    // ASSERT: um rótulo VISÍVEL (aria-hidden) e um único nome acessível — o h2
    const rotulos = within(painel).getAllByText('Lista de espera')
    const visiveis = rotulos.filter((elemento) => elemento.getAttribute('aria-hidden') === 'true')
    const acessiveis = rotulos.filter((elemento) => elemento.getAttribute('aria-hidden') !== 'true')
    expect(visiveis).toHaveLength(1)
    expect(acessiveis).toHaveLength(1)
    expect(acessiveis[0]?.tagName).toBe('H2')
  })

  it('deve dar moldura ao controle de expandir e pintar o contador como selo', async () => {
    // ARRANGE
    servidor.use(...handlersDaAgenda([]), ...handlersDaFila([entradaFicticia(), entradaFicticia({ id: 2 })]))
    const usuario = userEvent.setup()
    const { container } = renderizarAgenda()
    const painel = await screen.findByRole('region', { name: 'Lista de espera' })
    await within(painel).findByText('2')

    // ACT
    await usuario.click(within(painel).getByRole('button', { name: 'Recolher a lista de espera' }))

    // ASSERT
    expect(within(painel).getByRole('button', { name: 'Expandir a lista de espera' })).toHaveClass('border')
    expect(within(painel).getByText('2')).toHaveClass('bg-chip-de-marca')
    expect(painel).toHaveClass('border', 'shadow-e1')
    // o trilho recolhido nunca era varrido pelo axe (a11y-auditor ACP-06). Escopo = o
    // contêiner, como nos demais testes da página: a página sem o shell não tem landmark.
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Painel da fila — o controle de recolher devolve o nome aos olhos (botoes-com-nome-na-agenda)', () => {
  it('deve mostrar a dica "Recolher a lista de espera" ao passar o mouse, decorativa', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    const controle = await screen.findByRole('button', { name: 'Recolher a lista de espera' })

    // ACT
    await usuario.hover(controle)

    // ASSERT
    const dica = within(controle).getByText('Recolher a lista de espera', {
      selector: '[aria-hidden="true"]',
    })
    expect(dica).toHaveAttribute('data-visivel', 'sim')
    expect(controle).toHaveAccessibleName('Recolher a lista de espera')
  })
})
