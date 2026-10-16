import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaListaEspera } from '@/paginas/pagina-lista-espera'
import { useAuthStore } from '@/stores/auth-store'
import { handlersDaAgenda } from '@/test/dados-agenda'
import { entradaFicticia, handlersDaFila } from '@/test/dados-fila'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { EntradaDaFila } from '@/tipos'

const TUDO = [
  'lista_espera.ver',
  'lista_espera.criar',
  'lista_espera.editar',
  'lista_espera.excluir',
  'agenda.criar',
]

function renderizarFila(fila: EntradaDaFila[] = [entradaFicticia()], permissoes: string[] = TUDO) {
  servidor.use(...handlersDaAgenda([]), ...handlersDaFila(fila))
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/lista-espera']}>
          <PaginaListaEspera />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

// relógio falso que vaza fixa o "hoje" dos testes seguintes
afterEach(() => {
  vi.useRealTimers()
})

describe('Lista de espera — a fila', () => {
  it('deve mostrar a fila na ordem de atendimento com o contador', async () => {
    // ARRANGE — o urgente entrou DEPOIS do normal
    renderizarFila([
      entradaFicticia({ id: 1, prioridade: 0, paciente: { id: 10, nome: 'Primeiro Fictício', nome_social: null } }),
      entradaFicticia({
        id: 2,
        prioridade: 10,
        created_at: '2026-07-10T09:00:00.000000Z',
        paciente: { id: 11, nome: 'Urgente Fictício', nome_social: null },
      }),
    ])

    // ACT
    const linhas = await screen.findAllByRole('row')

    // ASSERT — quem é urgente é chamado primeiro, mesmo tendo chegado depois
    expect(within(linhas[1]).getByText('Urgente Fictício')).toBeInTheDocument()
    expect(within(linhas[2]).getByText('Primeiro Fictício')).toBeInTheDocument()
    expect(screen.getByText('2 pacientes esperando')).toBeInTheDocument()
  })

  it('deve mostrar há quanto tempo o paciente espera', async () => {
    // ARRANGE — entrou há 5 dias (hoje fictício: 2026-07-11)
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'))
    renderizarFila([entradaFicticia({ created_at: '2026-07-06T09:00:00.000000Z' })])

    // ACT + ASSERT — "esperando" é o dado que decide quem chamar
    expect(await screen.findByText('há 5 dias')).toBeInTheDocument()
  })

  it('deve manter na tela a prioridade que não é um dos três degraus', async () => {
    // ARRANGE — a prioridade é 0–10 no dado (D7): a tela não pode fingir que 7
    // não existe, nem rebaixá-la a Normal ao editar
    const usuario = userEvent.setup()
    renderizarFila([entradaFicticia({ prioridade: 7 })])

    // ACT
    expect(await screen.findByText('Prioridade 7')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT — o select carrega o valor REAL, não o vazio
    expect(within(dialog).getByLabelText(/Prioridade/)).toHaveValue('7')
  })

  it('deve oferecer entrar na fila quando ela está vazia', async () => {
    // ARRANGE
    renderizarFila([])

    // ACT + ASSERT
    expect(await screen.findByText('Ninguém na lista de espera.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Entrar na fila' }).length).toBeGreaterThan(0)
  })

  it('deve pedir confirmação nomeando o paciente ao sair da fila', async () => {
    // ARRANGE — sair da fila é destrutivo: o dialog nomeia o alvo (§2)
    const usuario = userEvent.setup()
    let excluiu = false
    renderizarFila()
    servidor.use(
      msw.delete('/api/lista-espera/:id', () => {
        excluiu = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Sair da fila' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT — o nome está no dialog, e cancelar NÃO exclui
    expect(
      within(dialog).getByRole('heading', { name: /Tirar Paciente Fictício da lista de espera\?/ }),
    ).toBeInTheDocument()
    await usuario.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(excluiu).toBe(false)
  })

  it('deve remover da fila ao confirmar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let excluiu = false
    renderizarFila()
    servidor.use(
      msw.delete('/api/lista-espera/:id', () => {
        excluiu = true
        return new HttpResponse(null, { status: 204 })
      }),
    )

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Sair da fila' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: 'Sair da fila' }))

    // ASSERT
    await waitFor(() => {
      expect(excluiu).toBe(true)
    })
  })

  it('deve entrar na fila pelo formulário', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let enviado: unknown = null
    renderizarFila([])
    servidor.use(
      msw.post('/api/lista-espera', async ({ request }) => {
        enviado = await request.json()
        return HttpResponse.json(entradaFicticia(), { status: 201 })
      }),
    )

    // ACT
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Pac')
    await usuario.click(await screen.findByRole('option', { name: 'Paciente Fictício' }))
    await usuario.selectOptions(within(dialog).getByLabelText(/Prioridade/), '10')
    await usuario.click(within(dialog).getByRole('button', { name: 'Entrar na fila' }))

    // ASSERT — o paciente vem da seleção (id), nunca do texto digitado
    await waitFor(() => {
      expect(enviado).toMatchObject({ paciente_id: 10, prioridade: 10 })
    })
  })

  it('deve abrir a escolha de paciente já com a lista, sem digitar nada', async () => {
    // ARRANGE — reconhecer é mais barato que lembrar (change busca-de-paciente-com-lista)
    const usuario = userEvent.setup()
    renderizarFila([])

    // ACT: abre o formulário e só CLICA no campo — nada é digitado
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('combobox', { name: /Paciente/ }))

    // ASSERT: a seção de atalho e o catálogo, ambos escolhíveis
    expect(await screen.findByRole('option', { name: 'Paciente Fictício Recente' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Paciente Fictício' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toHaveValue('')
  })

  it('deve não repetir a mesma criança nas duas seções', async () => {
    // ARRANGE: o catálogo A→Z do servidor inclui quem está nos recentes — quem impede a
    // duplicata é o dedupe do hook. Duplicata numa caixa de escolha de MENOR é o cenário do
    // I-01 com nome idêntico: dois itens, um id certo e um errado (achado CR-BPL-05).
    const usuario = userEvent.setup()
    renderizarFila([])

    // ACT
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('combobox', { name: /Paciente/ }))
    await screen.findByRole('option', { name: 'Paciente Fictício Recente' })

    // ASSERT: aparece UMA vez, na seção de atalho
    expect(screen.getAllByRole('option', { name: 'Paciente Fictício Recente' })).toHaveLength(1)
    expect(
      within(screen.getByRole('group', { name: 'Recentes' })).getByRole('option', { name: 'Paciente Fictício Recente' }),
    ).toBeInTheDocument()
  })

  it('deve escolher pela lista sem que o nome do menor vá para a URL', async () => {
    // ARRANGE — nome de MENOR não entra em query string (gatilho LOG): o modo lista não
    // tem termo, e é a tela quem tem de garantir isso, não a sorte
    const usuario = userEvent.setup()
    const urlsDaSelecao: string[] = []
    renderizarFila([])
    servidor.use(
      msw.get('/api/agenda/selecao/pacientes', ({ request }) => {
        const url = new URL(request.url)
        urlsDaSelecao.push(url.search)
        return HttpResponse.json(
          url.searchParams.get('recentes') === '1'
            ? [{ id: 11, nome: 'Paciente Fictício Recente', nome_social: null }]
            : [{ id: 10, nome: 'Paciente Fictício', nome_social: null }],
        )
      }),
    )
    let enviado: unknown = null
    servidor.use(
      msw.post('/api/lista-espera', async ({ request }) => {
        enviado = await request.json()
        return HttpResponse.json(entradaFicticia(), { status: 201 })
      }),
    )

    // ACT: abrir, escolher da lista e enviar — sem digitar uma letra
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('combobox', { name: /Paciente/ }))
    await usuario.click(await screen.findByRole('option', { name: 'Paciente Fictício Recente' }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Entrar na fila' }))

    // ASSERT: o id veio da escolha, e nenhuma URL levou nome nem termo
    await waitFor(() => {
      expect(enviado).toMatchObject({ paciente_id: 11 })
    })
    expect(urlsDaSelecao.length).toBeGreaterThan(0)
    expect(urlsDaSelecao.filter((url) => url.includes('busca='))).toEqual([])
    expect(urlsDaSelecao.join(' ')).not.toContain('Fict')
  })

  it('deve esconder as ações de escrita de quem só pode ver', async () => {
    // ARRANGE — botão que o servidor negaria não é exibido (o servidor decide)
    renderizarFila([entradaFicticia()], ['lista_espera.ver'])

    // ACT
    await screen.findByRole('table')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Entrar na fila' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sair da fila' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Encaixar/ })).not.toBeInTheDocument()
  })

  it('deve esconder o encaixe de quem não pode criar agendamento', async () => {
    // ARRANGE — encaixe exige as DUAS permissões no servidor; sem agenda.criar,
    // oferecer o botão seria prometer um 403
    renderizarFila([entradaFicticia()], ['lista_espera.ver', 'lista_espera.excluir'])

    // ACT
    await screen.findByRole('table')

    // ASSERT
    expect(screen.queryByRole('button', { name: /Encaixar/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sair da fila' })).toBeInTheDocument()
  })
})

describe('Lista de espera — a fila não guarda um desejo impossível', () => {
  it('deve oferecer só os profissionais que ATENDEM a especialidade escolhida', async () => {
    // ARRANGE — foi assim que nasceu "Psicologia · Carla Fictícia Nunes" na demo, com a Carla
    // sendo de Terapia Ocupacional: uma espera que o AGENDAMENTO sempre recusaria ("O
    // profissional não atende a esta especialidade"), e que a recepcionista só descobria na
    // hora do encaixe — tendo de trocar em silêncio o que a família pediu.
    //
    // No fixture, o Fictício A é de Fonoaudiologia (id 1) e o Fictício B é de Psicologia (2).
    const usuario = userEvent.setup()
    renderizarFila([])

    // ACT — abre o formulário e escolhe Fonoaudiologia
    await usuario.click(await screen.findByRole('button', { name: 'Entrar na fila' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.selectOptions(within(dialog).getByLabelText(/Especialidade desejada/i), '1')

    // ASSERT — só quem atende Fonoaudiologia aparece
    const profissional = within(dialog).getByLabelText(/Profissional desejado/i)
    expect(within(profissional).getByRole('option', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    expect(within(profissional).queryByRole('option', { name: /Profissional Fictício B/ })).not.toBeInTheDocument()
  })

  it('deve LIMPAR o profissional que deixa de atender quando a especialidade muda', async () => {
    // ARRANGE: escolher o profissional ANTES da especialidade não pode deixar um par
    // impossível pendurado — ele sai, em vez de virar uma espera que ninguém pode cumprir.
    const usuario = userEvent.setup()
    renderizarFila([])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Entrar na fila' }))
    const dialog = await screen.findByRole('alertdialog')
    const especialidade = within(dialog).getByLabelText(/Especialidade desejada/i)
    const profissional = within(dialog).getByLabelText(/Profissional desejado/i)

    await usuario.selectOptions(especialidade, '1')
    await usuario.selectOptions(profissional, '1') // Fictício A, que faz Fonoaudiologia
    expect(profissional).toHaveValue('1')

    // ...e agora a especialidade vira Psicologia, que o A NÃO atende
    await usuario.selectOptions(especialidade, '2')

    // ASSERT — o profissional saiu junto
    expect(within(dialog).getByLabelText(/Profissional desejado/i)).toHaveValue('')
  })

  it('deve oferecer TODOS quando nenhuma especialidade foi escolhida', async () => {
    // ARRANGE: "quero uma vaga, com quem der" é o caso mais comum da fila — ela é uma
    // ESPERA, não um agendamento.
    const usuario = userEvent.setup()
    renderizarFila([])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Entrar na fila' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    const profissional = within(dialog).getByLabelText(/Profissional desejado/i)
    expect(within(profissional).getByRole('option', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    expect(within(profissional).getByRole('option', { name: /Profissional Fictício B/ })).toBeInTheDocument()
  })
})

describe('Lista de espera — pré-cadastro pelo card de entrada (pre-cadastro-de-paciente)', () => {
  it('não deve oferecer "Novo paciente" sem pacientes.criar', async () => {
    // ARRANGE — quem só administra a fila não cria paciente
    const usuario = userEvent.setup()
    renderizarFila()

    // ACT
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(within(dialog).queryByRole('button', { name: /Novo paciente/ })).not.toBeInTheDocument()
  })

  it('deve pré-cadastrar e deixar o paciente selecionado na busca, sem sair da tela', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let criado: unknown = null
    servidor.use(
      msw.post('/api/pacientes/pre-cadastro', async ({ request }) => {
        criado = await request.json()
        return HttpResponse.json({ id: 77, nome: 'Paciente Fictício do Balcão' }, { status: 201 })
      }),
    )
    renderizarFila([entradaFicticia()], [...TUDO, 'pacientes.criar'])

    // ACT — abre o card ACIMA do formulário e preenche só o essencial
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: /Novo paciente/ }))
    const card = within(dialog).getByRole('region', { name: /Novo paciente \(pré-cadastro\)/ })
    await usuario.type(within(card).getByLabelText(/Nome do paciente/), 'Paciente Fictício do Balcão')
    await usuario.selectOptions(within(card).getByLabelText(/Sexo/), 'nao_informado')
    await usuario.type(within(card).getByLabelText(/Telefone de contato/), '48988887777')
    await usuario.click(within(card).getByRole('button', { name: 'Criar e selecionar' }))

    // ASSERT — payload mínimo; card fecha; a busca já está com o criado
    await waitFor(() => {
      expect(criado).toMatchObject({
        nome: 'Paciente Fictício do Balcão',
        sexo: 'nao_informado',
        telefone: '48988887777',
      })
    })
    await waitFor(() => {
      expect(within(dialog).queryByRole('region', { name: /pré-cadastro/ })).not.toBeInTheDocument()
    })
    expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toHaveValue(
      'Paciente Fictício do Balcão',
    )
  })

  it('deve virar PERGUNTA quando o nome já existe, e criar ao confirmar', async () => {
    // ARRANGE — o servidor recusa nome idêntico com 409 (change faxina-de-gatilhos). A recusa não é
    // erro: é a pergunta "é outra criança?", porque irmãos homônimos existem.
    const usuario = userEvent.setup()
    const enviados: unknown[] = []
    servidor.use(
      msw.post('/api/pacientes/pre-cadastro', async ({ request }) => {
        const corpo = (await request.json()) as { confirmar_homonimo?: boolean }
        enviados.push(corpo)
        if (corpo.confirmar_homonimo !== true) {
          return HttpResponse.json({ message: 'Já existe...', homonimo: true }, { status: 409 })
        }
        return HttpResponse.json({ id: 78, nome: 'Paciente Fictício do Balcão' }, { status: 201 })
      }),
    )
    renderizarFila([entradaFicticia()], [...TUDO, 'pacientes.criar'])

    // ACT — primeira tentativa, sem confirmação
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: /Novo paciente/ }))
    const card = within(dialog).getByRole('region', { name: /pré-cadastro/ })
    await usuario.type(within(card).getByLabelText(/Nome do paciente/), 'Paciente Fictício do Balcão')
    await usuario.selectOptions(within(card).getByLabelText(/Sexo/), 'nao_informado')
    await usuario.type(within(card).getByLabelText(/Telefone de contato/), '48988887777')
    await usuario.click(within(card).getByRole('button', { name: 'Criar e selecionar' }))

    // ASSERT — a pergunta aparece nomeando o nome digitado, e NADA foi criado ainda
    const pergunta = await screen.findByText(/Já existe um paciente chamado Paciente Fictício do Balcão/)
    expect(pergunta).toBeInTheDocument()
    expect(enviados).toHaveLength(1)

    // ACT — confirmar que é outra criança
    await usuario.click(screen.getByRole('button', { name: 'Sim, é outra criança' }))

    // ASSERT — o reenvio leva a confirmação, e o fluxo termina como um pré-cadastro normal
    await waitFor(() => {
      expect(enviados).toHaveLength(2)
    })
    expect(enviados[1]).toMatchObject({ confirmar_homonimo: true })
    await waitFor(() => {
      expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toHaveValue(
        'Paciente Fictício do Balcão',
      )
    })
  })

  it('não deve perguntar nada quando o nome é novo', async () => {
    // ARRANGE — o caminho comum não ganhou fricção
    const usuario = userEvent.setup()
    servidor.use(
      msw.post('/api/pacientes/pre-cadastro', () =>
        HttpResponse.json({ id: 79, nome: 'Outra Criança Fictícia' }, { status: 201 }),
      ),
    )
    renderizarFila([entradaFicticia()], [...TUDO, 'pacientes.criar'])

    // ACT
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: /Novo paciente/ }))
    const card = within(dialog).getByRole('region', { name: /pré-cadastro/ })
    await usuario.type(within(card).getByLabelText(/Nome do paciente/), 'Outra Criança Fictícia')
    await usuario.selectOptions(within(card).getByLabelText(/Sexo/), 'nao_informado')
    await usuario.type(within(card).getByLabelText(/Telefone de contato/), '48988887777')
    await usuario.click(within(card).getByRole('button', { name: 'Criar e selecionar' }))

    // ASSERT
    await waitFor(() => {
      expect(within(dialog).getByRole('combobox', { name: /Paciente/ })).toHaveValue('Outra Criança Fictícia')
    })
    expect(screen.queryByText(/É outra criança\?/)).not.toBeInTheDocument()
  })

  it('deve cancelar o card sem criar nada', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let chamouApi = false
    servidor.use(
      msw.post('/api/pacientes/pre-cadastro', () => {
        chamouApi = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    renderizarFila([entradaFicticia()], [...TUDO, 'pacientes.criar'])

    // ACT
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: /Novo paciente/ }))
    const card = within(dialog).getByRole('region', { name: /pré-cadastro/ })
    await usuario.click(within(card).getByRole('button', { name: 'Cancelar' }))

    // ASSERT
    expect(within(dialog).queryByRole('region', { name: /pré-cadastro/ })).not.toBeInTheDocument()
    expect(chamouApi).toBe(false)
  })
})

describe('Fila — o vazio da busca de paciente explica o inativo', () => {
  it('deve dizer que existe cadastro inativo quando o servidor sinaliza', async () => {
    // ARRANGE — o sinal é do SERVIDOR (cabeçalho), e a fila usa a MESMA caixa da agenda: um
    // motivo explicado só na agenda deixaria a fila com o mesmo beco
    // (change paciente-inativo-com-saida)
    const usuario = userEvent.setup()
    renderizarFila([])
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
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Valmiro')

    // ASSERT — a explicação, sem nomear criança nenhuma
    expect(await within(dialog).findByText(/Existe cadastro/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Nenhum resultado para/)).not.toBeInTheDocument()
  })

  it('deve manter o vazio de sempre quando o servidor não sinaliza nada', async () => {
    // ARRANGE — sem o cabeçalho, nada muda: é o que mantém a resposta de quem não tem
    // `pacientes.ver` indistinguível da de quem procurou um nome que não existe
    const usuario = userEvent.setup()
    renderizarFila([])
    servidor.use(msw.get('/api/agenda/selecao/pacientes', () => HttpResponse.json([])))

    // ACT
    await usuario.click((await screen.findAllByRole('button', { name: 'Entrar na fila' }))[0])
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('combobox', { name: /Paciente/ }), 'Valmiro')

    // ASSERT
    expect(await within(dialog).findByText(/Nenhum resultado para/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Existe cadastro/)).not.toBeInTheDocument()
  })
})
