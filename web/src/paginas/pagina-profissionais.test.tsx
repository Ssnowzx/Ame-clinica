import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaProfissionais } from '@/paginas/pagina-profissionais'
import { useAuthStore } from '@/stores/auth-store'
import { handlersDeCadastros, profissionalFicticio } from '@/test/dados-cadastros'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

const TUDO = ['profissionais.ver', 'profissionais.criar', 'profissionais.editar', 'profissionais.excluir']

function renderizar(permissoes: string[] = TUDO, handlersExtras: Parameters<typeof servidor.use> = []) {
  servidor.use(...handlersExtras, ...handlersDeCadastros())
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/profissionais']}>
          <PaginaProfissionais />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Profissionais', () => {
  it('deve listar com especialidades e horários', async () => {
    // ARRANGE + ACT
    renderizar()
    await screen.findByRole('table')

    // ASSERT — é o que decide a coluna e o que a agenda aceita marcar
    const linha = screen.getAllByRole('row')[1]
    expect(within(linha).getByText('Fonoaudiologia')).toBeInTheDocument()
    expect(within(linha).getByText('Seg · 08:00–12:00')).toBeInTheDocument()
    expect(within(linha).getByText('CRP/SP 000000')).toBeInTheDocument()
  })

  it('deve cadastrar com especialidades e horários por dia', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const capturado: {
      payload?: {
        nome: string
        especialidades: number[]
        horarios: Record<string, Array<{ inicio: string; fim: string }>>
      }
    } = {}
    renderizar(TUDO, [
      msw.post('/api/profissionais', async ({ request }) => {
        capturado.payload = (await request.json()) as NonNullable<typeof capturado.payload>
        return HttpResponse.json(profissionalFicticio(), { status: 201 })
      }),
    ])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar profissional/ }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByLabelText(/^Nome/), 'Profissional Fictício Novo')
    await usuario.click(await within(dialog).findByLabelText('Psicologia'))
    // marca segunda-feira → o intervalo padrão 08:00–12:00 aparece
    await usuario.click(within(dialog).getByRole('checkbox', { name: 'Segunda' }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => {
      expect(capturado.payload?.nome).toBe('Profissional Fictício Novo')
    })
    expect(capturado.payload?.especialidades).toEqual([2])
    expect(capturado.payload?.horarios).toEqual({ '1': [{ inicio: '08:00', fim: '12:00' }] })
  })

  it('deve enviar horários vazios quando nenhum dia é marcado (= todos os dias)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const capturado: { payload?: { horarios: Record<string, unknown> } } = {}
    renderizar(TUDO, [
      msw.post('/api/profissionais', async ({ request }) => {
        capturado.payload = (await request.json()) as NonNullable<typeof capturado.payload>
        return HttpResponse.json(profissionalFicticio(), { status: 201 })
      }),
    ])

    // ACT — cadastra sem marcar nenhum dia
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar profissional/ }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByLabelText(/^Nome/), 'Sem Horário Definido')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => {
      expect(capturado.payload).toBeDefined()
    })
    expect(capturado.payload?.horarios).toEqual({})
  })

  it('deve bloquear no cliente um intervalo invertido, sem tocar a rede', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let postou = false
    renderizar(TUDO, [
      msw.post('/api/profissionais', () => {
        postou = true
        return HttpResponse.json(profissionalFicticio(), { status: 201 })
      }),
    ])

    // ACT — marca segunda (08:00–12:00) e inverte o fim para antes do início
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar profissional/ }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByLabelText(/^Nome/), 'Intervalo Invertido')
    await usuario.click(within(dialog).getByRole('checkbox', { name: 'Segunda' }))
    fireEvent.change(within(dialog).getByLabelText('Fim'), { target: { value: '07:00' } })
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — a recusa aparece no campo e a rede não é tocada
    expect(within(dialog).getByText('O fim deve ser depois do início.')).toBeInTheDocument()
    expect(postou).toBe(false)
  })

  it('deve levar a recusa do conselho duplicado ao campo do número', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar(TUDO, [
      msw.post('/api/profissionais', () =>
        HttpResponse.json(
          {
            message: 'Dados inválidos.',
            errors: { num_conselho: ['Já existe um profissional com este registro de conselho.'] },
          },
          { status: 422 },
        ),
      ),
    ])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar profissional/ }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByLabelText(/^Nome/), 'Profissional Fictício')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — no campo que a causou
    await waitFor(() => {
      expect(within(dialog).getByLabelText(/Número do conselho/)).toHaveAttribute('aria-invalid', 'true')
    })
  })

  it('deve manter o profissional na lista quando o servidor recusa a exclusão', async () => {
    // ARRANGE — exclusão protegida: referenciado → 422. A recusa precisa
    // APARECER; o dialog não pode fechar como se tivesse dado certo
    const usuario = userEvent.setup()
    renderizar(TUDO, [
      msw.delete('/api/profissionais/:id', () =>
        HttpResponse.json(
          {
            message: 'Este profissional está vinculado a outros registros e não pode ser excluído.',
            errors: {
              profissional: ['Este profissional está vinculado a outros registros e não pode ser excluído.'],
            },
          },
          { status: 422 },
        ),
      ),
    ])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Excluir' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: 'Excluir profissional' }))

    // ASSERT — o motivo aparece e o dialog CONTINUA aberto (não fecha como se
    // tivesse dado certo)
    expect(await screen.findByText(/vinculado a outros registros/)).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    // e o profissional continua na lista
    await usuario.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    const tabela = await screen.findByRole('table')
    expect(within(tabela).getByText('Profissional Fictício A')).toBeInTheDocument()
  })

  it('deve esconder as ações de quem só pode ver', async () => {
    // ARRANGE
    renderizar(['profissionais.ver'])

    // ACT
    await screen.findByRole('table')

    // ASSERT
    expect(screen.queryByRole('button', { name: /Cadastrar profissional/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('Profissionais — atendimento ao mesmo tempo', () => {
  it('deve oferecer o campo com o padrão de um por vez e a explicação', async () => {
    // ARRANGE — o rótulo sozinho se confunde com "quantos atende por dia"
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('table')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Cadastrar profissional/ }))

    // ASSERT
    const campo = await screen.findByLabelText(/Atendimentos ao mesmo tempo/)
    expect(campo).toHaveValue(1)
    expect(screen.getByText(/no mesmo horário/i)).toBeInTheDocument()
  })

  it('deve pousar a recusa do servidor no próprio campo', async () => {
    // ARRANGE — a faixa vive no BOUNDARY, e o `max` do input é só defesa em profundidade: a
    // recusa que importa chega de uma aba velha, de um cliente antigo ou de um curl com o
    // mesmo token. O valor aqui PASSA pelo input de propósito — é o servidor que recusa, e é
    // a mensagem DELE que tem de aparecer no campo, não uma verdade paralela da tela
    const usuario = userEvent.setup()
    let chamadas = 0
    renderizar(TUDO, [
      msw.post('/api/profissionais', () => {
        chamadas += 1
        return HttpResponse.json(
          {
            message: 'Os dados são inválidos.',
            errors: { atendimentos_simultaneos: ['O número de atendimentos ao mesmo tempo vai de 1 a 10.'] },
          },
          { status: 422 },
        )
      }),
    ])
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar profissional/ }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByLabelText(/^Nome/), 'Profissional Fictício Novo')
    const campo = within(dialog).getByLabelText(/Atendimentos ao mesmo tempo/)
    await usuario.clear(campo)
    await usuario.type(campo, '5')

    // ACT
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — a mensagem da API marca o PRÓPRIO campo (aria-invalid + describedby), e o
    // formulário continua aberto com o que foi digitado
    await waitFor(() => {
      expect(chamadas).toBe(1)
    })
    const campoComErro = await within(dialog).findByLabelText(/Atendimentos ao mesmo tempo/)
    await waitFor(() => {
      expect(campoComErro).toBeInvalid()
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/vai de 1 a 10/)
  })
})

describe('Profissionais — a regra de atendimento não muda sem confirmação', () => {
  /** Abre a edição do profissional fictício e troca o número de simultâneos. */
  async function editarSimultaneos(usuario: ReturnType<typeof userEvent.setup>, valor: string) {
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const campo = within(dialog).getByLabelText(/Atendimentos ao mesmo tempo/)
    await usuario.clear(campo)
    if (valor !== '') {
      await usuario.type(campo, valor)
    }
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))
  }

  it('deve confirmar a subida dizendo o número e que nada é desmarcado', async () => {
    // ARRANGE — subir afrouxa a guarda que impede marcar duas crianças por engano
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('table')

    // ACT
    await editarSimultaneos(usuario, '4')

    // ASSERT
    const confirmacao = await screen.findByRole('alertdialog', { name: /Mudar a regra/ })
    expect(within(confirmacao).getByText(/4 crianças no mesmo horário/)).toBeInTheDocument()
    expect(within(confirmacao).getByText(/já marcados não mudam/)).toBeInTheDocument()
  })

  it('deve avisar, ao descer, que o que já está marcado continua de pé', async () => {
    // ARRANGE — descer fecha horários que a recepção vinha usando, mas NÃO desmarca ninguém:
    // a confirmação não pode prometer o que o sistema não faz
    const usuario = userEvent.setup()
    renderizar(TUDO, [
      msw.get('/api/profissionais', () =>
        HttpResponse.json([profissionalFicticio({ atendimentos_simultaneos: 4 })]),
      ),
    ])
    await screen.findByRole('table')

    // ACT
    await editarSimultaneos(usuario, '1')

    // ASSERT
    const confirmacao = await screen.findByRole('alertdialog', { name: /Mudar a regra/ })
    expect(within(confirmacao).getByText(/continuam de pé/)).toBeInTheDocument()
  })

  it('não deve pedir confirmação quando o número não muda', async () => {
    // ARRANGE — confirmação para tudo é ruído, e ruído faz clicar sem ler
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('table')

    // ACT — mexe só no nome
    await usuario.click(await screen.findByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const nome = within(dialog).getByLabelText(/^Nome/)
    await usuario.clear(nome)
    await usuario.type(nome, 'Profissional Fictício Renomeado')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })
})

describe('Profissionais — mensagens automáticas às famílias', () => {
  const ROTULO = 'Enviar mensagens automáticas às famílias'

  it('deve oferecer a caixa marcada no cadastro novo, dizendo o que continua saindo', async () => {
    // ARRANGE — sem a ajuda, quem desmarca acha que a família nunca mais recebe nada
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('table')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Cadastrar profissional/ }))

    // ASSERT
    const caixa = await screen.findByRole('checkbox', { name: ROTULO })
    expect(caixa).toBeChecked()
    expect(caixa).toHaveAccessibleDescription(/remarcação e de cancelamento continuam saindo/)
  })

  it('deve mostrar a caixa desmarcada para o profissional que já confirma por conta própria', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar(TUDO, [
      msw.get('/api/profissionais', () => HttpResponse.json([profissionalFicticio({ mensagens_automaticas: false })])),
    ])
    await screen.findByRole('table')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))

    // ASSERT
    expect(await screen.findByRole('checkbox', { name: ROTULO })).not.toBeChecked()
  })

  it('deve desligar só depois de confirmar o que muda para as famílias', async () => {
    // ARRANGE — um clique por engano deixaria as famílias sem lembrete, em silêncio
    const usuario = userEvent.setup()
    const capturado: { payload?: { mensagens_automaticas?: boolean } } = {}
    renderizar(TUDO, [
      msw.put('/api/profissionais/:id', async ({ request }) => {
        capturado.payload = (await request.json()) as NonNullable<typeof capturado.payload>
        return HttpResponse.json(profissionalFicticio({ mensagens_automaticas: false }))
      }),
    ])
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('checkbox', { name: ROTULO }))

    // ACT
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT — pergunta antes, diz que remarcação e cancelamento continuam, e só então grava
    const confirmacao = await screen.findByRole('alertdialog', { name: /Mudar as mensagens automáticas/ })
    expect(within(confirmacao).getByText(/deixam de receber pelo WhatsApp/)).toBeInTheDocument()
    expect(within(confirmacao).getByText(/remarcação e de cancelamento continuam/)).toBeInTheDocument()
    expect(capturado.payload).toBeUndefined()
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Mudar as mensagens' }))
    await waitFor(() => {
      expect(capturado.payload?.mensagens_automaticas).toBe(false)
    })
  })

  it('deve juntar as duas regras numa confirmação só quando ambas mudam', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const campo = within(dialog).getByLabelText(/Atendimentos ao mesmo tempo/)
    await usuario.clear(campo)
    await usuario.type(campo, '3')
    await usuario.click(within(dialog).getByRole('checkbox', { name: ROTULO }))

    // ACT
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    const confirmacao = await screen.findByRole('alertdialog', { name: /Mudar a regra/ })
    expect(within(confirmacao).getByText(/3 crianças no mesmo horário/)).toBeInTheDocument()
    expect(within(confirmacao).getByText(/deixam de receber pelo WhatsApp/)).toBeInTheDocument()
  })

  it('não deve ter violações de acessibilidade no formulário com a caixa nova', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    await within(dialog).findByRole('checkbox', { name: ROTULO })

    // ACT
    const resultado = await axe(dialog)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})

describe('Profissionais — o vermelho sólido só confirma (§5.2, change tema-da-clinica)', () => {
  it('deve desenhar o Excluir da linha com moldura de perigo, sem o bloco vermelho', async () => {
    // ARRANGE + ACT — o botão da linha só ABRE a confirmação; sólido, ele pesava mais que o primário
    renderizar()
    const excluir = await screen.findByRole('button', { name: 'Excluir' })

    // ASSERT
    expect(excluir).toHaveClass('border-perigo')
    expect(excluir).not.toHaveClass('bg-perigo')
  })
})

describe('Profissionais — o foco do cadastro (gate A11Y-AVI-02)', () => {
  it('deve levar o foco para DENTRO do cadastro ao abrir, e devolvê-lo a quem abriu ao cancelar', async () => {
    // ARRANGE — sem `AlertDialog.Cancel`, o foco ficava no botão atrás do véu
    const usuario = userEvent.setup()
    renderizar()
    const abrir = await screen.findByRole('button', { name: /Cadastrar profissional/ })

    // ACT
    await usuario.click(abrir)
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })
    await usuario.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => {
      expect(abrir).toHaveFocus()
    })
  })
})

/**
 * Change `o-sistema-avisa-o-que-falta`: o catálogo de especialidades vazio é a CAUSA de a agenda não
 * ter o que marcar com o profissional. O cadastro diz isso, com o caminho conforme a permissão, e sem
 * requisição nova. Dados FICTÍCIOS.
 */
describe('Profissionais — catálogo de especialidades vazio (o-sistema-avisa-o-que-falta)', () => {
  const SEM_ESPECIALIDADE = msw.get('/api/especialidades', () => HttpResponse.json([]))
  const AVISO = /^Nenhuma especialidade cadastrada ainda — e a agenda só marca sessão com o profissional que atende alguma\./

  async function abrirCadastro(usuario: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar profissional/ }))
    return screen.findByRole('alertdialog')
  }

  it('deve dizer que não há especialidade e onde cadastrar, em texto, a quem pode cadastrar', async () => {
    // ARRANGE — o aviso fica depois de nome, conselho e horários: um link fecharia o diálogo e
    // apagaria o que foi digitado (design D7, gate CR-AVI-03). O caminho vai escrito.
    const usuario = userEvent.setup()
    renderizar([...TUDO, 'especialidades.ver', 'especialidades.criar'], [SEM_ESPECIALIDADE])

    // ACT
    const dialog = await abrirCadastro(usuario)

    // ASSERT — o aviso DESCREVE o grupo, diz onde cadastrar e não tira a pessoa do formulário
    const grupo = within(dialog).getByRole('group', { name: 'Especialidades que atende' })
    await waitFor(() => {
      expect(grupo).toHaveAccessibleDescription(
        new RegExp(`${AVISO.source}\\s+Cadastre em Cadastros › Especialidades\\.$`),
      )
    })
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve dizer a quem pedir, sem link, a quem não pode cadastrar especialidade', async () => {
    // ARRANGE — "criar" sem "ver" não basta: a tela de especialidades responderia 403
    const usuario = userEvent.setup()
    renderizar([...TUDO, 'especialidades.criar'], [SEM_ESPECIALIDADE])

    // ACT
    const dialog = await abrirCadastro(usuario)

    // ASSERT
    const grupo = within(dialog).getByRole('group', { name: 'Especialidades que atende' })
    await waitFor(() => {
      expect(grupo).toHaveAccessibleDescription(
        new RegExp(`${AVISO.source}\\s+Peça a quem administra o sistema para cadastrar\\.$`),
      )
    })
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve oferecer as especialidades sem aviso quando o catálogo tem alguma', async () => {
    // ARRANGE + ACT — o caso comum: nada muda
    const usuario = userEvent.setup()
    renderizar([...TUDO, 'especialidades.ver', 'especialidades.criar'])
    const dialog = await abrirCadastro(usuario)

    // ASSERT
    await within(dialog).findByRole('checkbox', { name: 'Fonoaudiologia' })
    expect(within(dialog).getByRole('group', { name: 'Especialidades que atende' })).toHaveAccessibleDescription('')
    expect(within(dialog).queryByText(AVISO)).not.toBeInTheDocument()
  })

  it('deve abrir o cadastro com as mesmas requisições, com e sem o aviso (nenhuma requisição nova)', async () => {
    // ARRANGE — o aviso sai da consulta de especialidades que o cadastro já faz (D6)
    async function aoAbrir(extras: Parameters<typeof servidor.use>): Promise<string[]> {
      queryClient.clear()
      const usuario = userEvent.setup()
      const { unmount } = renderizar([...TUDO, 'especialidades.ver', 'especialidades.criar'], extras)
      await screen.findByRole('table')
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      const pedidas: string[] = []
      const anotar = ({ request }: { request: Request }): void => {
        pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
      }
      servidor.events.on('request:start', anotar)
      const dialog = await abrirCadastro(usuario)
      await within(dialog).findByRole('button', { name: 'Cadastrar' })
      await waitFor(() => {
        expect(queryClient.isFetching()).toBe(0)
      })
      servidor.events.removeListener('request:start', anotar)
      unmount()
      return pedidas.sort()
    }

    // ACT
    const comAviso = await aoAbrir([SEM_ESPECIALIDADE])
    const semAviso = await aoAbrir([])

    // ASSERT
    expect(comAviso).toContain('GET /api/especialidades')
    expect(comAviso).toEqual(semAviso)
  })

  it('deve passar no axe com o aviso, com e sem a permissão de cadastrar', async () => {
    for (const permissoes of [[...TUDO, 'especialidades.ver', 'especialidades.criar'], TUDO]) {
      // ARRANGE
      queryClient.clear()
      const usuario = userEvent.setup()
      const { unmount } = renderizar(permissoes, [SEM_ESPECIALIDADE])

      // ACT
      const dialog = await abrirCadastro(usuario)
      await within(dialog).findByText(AVISO)

      // ASSERT
      expect(await axe(dialog)).toHaveNoViolations()
      unmount()
    }
  })
})
