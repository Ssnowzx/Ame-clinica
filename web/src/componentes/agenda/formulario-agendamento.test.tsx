import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FormularioAgendamento, type FormularioAgendamentoProps } from '@/componentes/agenda/formulario-agendamento'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import {
  cardFicticio,
  detalheFicticio,
  DIA_FICTICIO,
  handlersDaAgenda,
  SELECAO_FICTICIA,
  TRATAMENTOS_DO_PACIENTE,
} from '@/test/dados-agenda'
import { entradaFicticia } from '@/test/dados-fila'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ProfissionalDaAgenda } from '@/tipos'

expect.extend(toHaveNoViolations)

/**
 * O formulário tem sua própria guarda de PRECEDÊNCIA entre as duas origens de paciente
 * (`encaixe` e `pacienteInicial`) — defesa em profundidade.
 *
 * A página já decide isso pela URL, então este caso não nasce da navegação: existe para que um
 * refatorador futuro não possa passar as duas props de uma vez.
 *
 * O dano, se a guarda cair, NÃO é o nome exibido (no encaixe ele vem direto da entrada da fila):
 * é o `form.paciente` ficar com a OUTRA criança e o formulário carregar os TRATAMENTOS dela —
 * um encaixe podendo sair vinculado ao pacote de outro paciente. É nisso que a asserção olha.
 */

/** Ids de paciente cujos tratamentos o formulário foi buscar. */
let tratamentosPedidosPara: string[] = []

beforeEach(() => {
  tratamentosPedidosPara = []
  queryClient.clear()
  servidor.use(
    msw.get('/api/agenda/selecao/tratamentos', ({ request }) => {
      tratamentosPedidosPara.push(new URL(request.url).searchParams.get('paciente_id') ?? '')
      return HttpResponse.json([])
    }),
    ...handlersDaAgenda([]),
  )
})

describe('FormularioAgendamento — precedência entre as origens de paciente', () => {
  it('deve ignorar o paciente do modo retorno quando o encaixe está presente', async () => {
    // ARRANGE — as duas origens, de propósito. A fila traz o paciente 10; o modo retorno, o 99.
    const outraCrianca = { id: 99, nome: 'Criança Fictícia do Retorno', nome_social: null }

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <FormularioAgendamento
              aberto
              aoFechar={() => {}}
              inicial={{ profissionalId: 1, inicio: `${DIA_FICTICIO} 08:00` }}
              encaixe={entradaFicticia()}
              pacienteInicial={outraCrianca}
            />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ASSERT — é o encaixe que manda: paciente da FILA, em campo de leitura...
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: 'Encaixar da lista de espera' })).toBeInTheDocument()
    expect(within(dialog).getByText('Paciente Fictício')).toBeInTheDocument()
    expect(within(dialog).queryByText('Criança Fictícia do Retorno')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: /Paciente/ })).not.toBeInTheDocument()

    // ...e os TRATAMENTOS oferecidos são os DELE, nunca os da criança do modo retorno
    await waitFor(() => {
      expect(tratamentosPedidosPara).toContain('10')
    })
    expect(tratamentosPedidosPara).not.toContain('99')
  })
})

describe('FormularioAgendamento — a criança já ocupada aponta o campo dela', () => {
  it('deve pousar a recusa no campo do paciente, e não no aviso geral', async () => {
    // ARRANGE — a recusa do eixo PACIENTE (conflito-do-paciente) chega em `paciente_id`.
    // Se ela caísse no aviso geral, a recepcionista leria "já tem outro atendimento" sem
    // saber QUAL campo corrigir — e o campo do paciente é o único que resolve.
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.put('/api/agendamentos/1', () =>
        HttpResponse.json(
          {
            codigo: 'invalido',
            mensagem: 'Revise os dados.',
            errors: { paciente_id: ['Este paciente já tem outro atendimento neste horário.'] },
          },
          { status: 422 },
        ),
      ),
    )

    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <FormularioAgendamento aberto aoFechar={() => {}} card={cardFicticio()} />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Salvar' }))

    // ASSERT — a mensagem descreve o CAMPO do paciente...
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Paciente/ })).toHaveAccessibleDescription(
        /já tem outro atendimento neste horário/,
      )
    })

    // ...e ela é o ÚNICO erro do formulário, pendurado no campo do paciente — não sobrou
    // cópia no aviso geral. (O toast de recusa continua existindo fora do formulário: SEC-A1,
    // nenhuma escrita falha em silêncio.)
    const formulario = document.querySelector('form')
    expect(formulario).not.toBeNull()
    const errosNoFormulario = within(formulario as HTMLElement).getAllByRole('alert')
    expect(errosNoFormulario).toHaveLength(1)
    expect(
      screen.getByRole('combobox', { name: /Paciente/ }).getAttribute('aria-describedby'),
    ).toContain(errosNoFormulario[0].id)
  })
})

describe('FormularioAgendamento — a repetição da série (repeticao-da-serie)', () => {
  /** Renderiza a CRIAÇÃO num horário livre, que é onde a repetição existe. */
  function renderizarCriacao() {
    return render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <FormularioAgendamento
              aberto
              aoFechar={() => {}}
              inicial={{ profissionalId: 1, inicio: `${DIA_FICTICIO} 08:00` }}
              // com criança escolhida: sem ela o formulário nem chega a mandar, e o que
              // este bloco prova é o PAYLOAD da série
              pacienteInicial={{ id: 10, nome: 'Paciente Fictício', nome_social: null }}
            />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
  }

  /** Completa os campos obrigatórios — o que este bloco prova é o payload da SÉRIE. */
  async function preencherObrigatorios(usuario: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    // os catálogos chegam por consulta: esperar a opção existir antes de escolher
    const primeiraReal = (campo: HTMLSelectElement): string =>
      [...campo.options].find((opcao) => opcao.value !== '')?.value ?? ''

    // o profissional PRIMEIRO: a lista de especialidades depende dele e só chega depois
    const profissional = within(dialog).getByLabelText(/^Profissional/) as HTMLSelectElement
    await waitFor(() => {
      expect(primeiraReal(profissional)).not.toBe('')
    })
    await usuario.selectOptions(profissional, primeiraReal(profissional))

    const especialidade = within(dialog).getByLabelText(/^Especialidade/) as HTMLSelectElement
    await waitFor(() => {
      expect(primeiraReal(especialidade)).not.toBe('')
    })
    await usuario.selectOptions(especialidade, primeiraReal(especialidade))
  }

  /** O corpo do POST que o formulário mandou. */
  function capturarPost(): { corpo: Record<string, unknown> | null } {
    const capturado: { corpo: Record<string, unknown> | null } = { corpo: null }
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/agendamentos', async ({ request }) => {
        capturado.corpo = (await request.json()) as Record<string, unknown>

        return HttpResponse.json({ criados: 1, agendamentos: [] }, { status: 201 })
      }),
    )

    return capturado
  }

  it('deve nascer sem repetição, e só mostrar o resto quando o intervalo é escolhido', async () => {
    // ARRANGE + ACT
    const usuario = userEvent.setup()
    renderizarCriacao()
    const dialog = screen.getByRole('alertdialog')

    // ASSERT — o padrão é não repetir; sem intervalo não há término a preencher
    expect(within(dialog).getByLabelText('Repetir')).toHaveValue('0')
    expect(within(dialog).queryByLabelText('Terminar')).not.toBeInTheDocument()

    // ACT — escolhe quinzenal
    await usuario.selectOptions(within(dialog).getByLabelText('Repetir'), '2')

    // ASSERT — o término aparece, e o padrão é por número de sessões
    expect(within(dialog).getByLabelText('Terminar')).toHaveValue('ocorrencias')
    expect(within(dialog).getByLabelText('Quantas sessões')).toBeInTheDocument()
  })

  it('deve mandar intervalo e ocorrências, e NUNCA os dois modos juntos', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const capturado = capturarPost()
    renderizarCriacao()
    const dialog = screen.getByRole('alertdialog')

    // ACT — quinzenal, 8 sessões
    await preencherObrigatorios(usuario, dialog)
    await usuario.selectOptions(within(dialog).getByLabelText('Repetir'), '2')
    await usuario.clear(within(dialog).getByLabelText('Quantas sessões'))
    await usuario.type(within(dialog).getByLabelText('Quantas sessões'), '8')
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT — o servidor recusa os dois juntos; a tela nem manda
    await waitFor(() => {
      expect(capturado.corpo).not.toBeNull()
    })
    expect(capturado.corpo?.recorrencia).toEqual({ intervalo_semanas: 2, ocorrencias: 8 })
  })

  it('deve mandar a cadência em MESES quando a escolha é mensal', async () => {
    // ARRANGE — quatro semanas não é um mês: o contrato precisa da unidade certa
    const usuario = userEvent.setup()
    const capturado = capturarPost()
    renderizarCriacao()
    const dialog = screen.getByRole('alertdialog')

    // ACT — todo mês, 6 sessões
    await preencherObrigatorios(usuario, dialog)
    await usuario.selectOptions(within(dialog).getByLabelText('Repetir'), 'm1')
    await usuario.clear(within(dialog).getByLabelText('Quantas sessões'))
    await usuario.type(within(dialog).getByLabelText('Quantas sessões'), '6')
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT — vai `intervalo_meses`, e NUNCA `intervalo_semanas` junto
    await waitFor(() => {
      expect(capturado.corpo).not.toBeNull()
    })
    expect(capturado.corpo?.recorrencia).toEqual({ intervalo_meses: 1, ocorrencias: 6 })
  })

  it('deve oferecer as cadências de mês ao lado das de semana', async () => {
    // ARRANGE
    renderizarCriacao()
    const dialog = screen.getByRole('alertdialog')

    // ASSERT — a recepção escolhe pela palavra, não pelo número de semanas
    const repetir = within(dialog).getByLabelText('Repetir')
    expect(within(repetir).getByRole('option', { name: 'Todo mês' })).toBeInTheDocument()
    expect(within(repetir).getByRole('option', { name: 'A cada dois meses' })).toBeInTheDocument()
    expect(within(repetir).getByRole('option', { name: 'A cada duas semanas (quinzenal)' })).toBeInTheDocument()
  })

  it('deve mandar a DATA quando o término é por data', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const capturado = capturarPost()
    renderizarCriacao()
    const dialog = screen.getByRole('alertdialog')

    // ACT — semanal, terminando numa data
    await preencherObrigatorios(usuario, dialog)
    await usuario.selectOptions(within(dialog).getByLabelText('Repetir'), '1')
    await usuario.selectOptions(within(dialog).getByLabelText('Terminar'), 'ate')
    await usuario.clear(within(dialog).getByLabelText('Repetir até a data'))
    await usuario.type(within(dialog).getByLabelText('Repetir até a data'), '30/12/2026')
    await usuario.click(within(dialog).getByRole('button', { name: 'Marcar' }))

    // ASSERT — a data vai em AAAA-MM-DD, e nenhuma contagem viaja junto
    await waitFor(() => {
      expect(capturado.corpo).not.toBeNull()
    })
    expect(capturado.corpo?.recorrencia).toEqual({ intervalo_semanas: 1, ate: '2026-12-30' })
  })

  it('deve usar o seletor da casa também na DATA do agendamento', async () => {
    // ARRANGE — a captura do manual flagrou "09/03/2026" para 3 de setembro: o campo nativo
    // desenha mm/dd/aaaa no navegador em inglês. A barra da agenda já tinha trocado por isso;
    // o formulário tinha ficado para trás, no campo mais importante dos dois.
    renderizarCriacao()
    const dialog = screen.getByRole('alertdialog')

    // ACT + ASSERT
    const campo = within(dialog).getByLabelText('Data do agendamento')
    expect(campo).toHaveAttribute('placeholder', 'dd/mm/aaaa')
    expect(campo).not.toHaveAttribute('type', 'date')
  })

  it('deve usar o seletor de data da casa, nunca o campo nativo em mm/dd/aaaa', async () => {
    // ARRANGE — data americana na agenda é o erro mais caro que existe aqui (08/28 × 28/08),
    // e o campo nativo `type="date"` desenha mm/dd/aaaa no navegador em inglês
    const usuario = userEvent.setup()
    renderizarCriacao()
    const dialog = screen.getByRole('alertdialog')

    // ACT
    await usuario.selectOptions(within(dialog).getByLabelText('Repetir'), '1')
    await usuario.selectOptions(within(dialog).getByLabelText('Terminar'), 'ate')

    // ASSERT
    const campo = within(dialog).getByLabelText('Repetir até a data')
    expect(campo).toHaveAttribute('placeholder', 'dd/mm/aaaa')
    expect(campo).not.toHaveAttribute('type', 'date')
  })
})

describe('FormularioAgendamento — avisar a família da mudança de horário (avisos-do-agendamento)', () => {
  function renderizarEdicao(corpos: Record<string, unknown>[]) {
    servidor.use(
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.put('/api/agendamentos/1', async ({ request }) => {
        corpos.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(cardFicticio())
      }),
    )
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <FormularioAgendamento aberto aoFechar={() => {}} card={cardFicticio()} />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
  }

  it('deve não oferecer a caixa quando dia, hora e profissional não mudaram', async () => {
    // ARRANGE + ACT
    renderizarEdicao([])
    await screen.findByRole('button', { name: 'Salvar' })

    // ASSERT
    expect(screen.queryByRole('checkbox', { name: /Avisar a família pelo WhatsApp/ })).not.toBeInTheDocument()
  })

  it('deve oferecer a caixa desmarcada ao mudar a hora, e mandar o pedido só quando marcada', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const corpos: Record<string, unknown>[] = []
    renderizarEdicao(corpos)
    const hora = await screen.findByLabelText(/^Hora/)

    // ACT — a clínica mudou o horário: a recepção muda a hora e marca a caixa
    fireEvent.change(hora, { target: { value: '10:00' } })
    const caixa = await screen.findByRole('checkbox', { name: /Avisar a família pelo WhatsApp/ })
    expect(caixa).not.toBeChecked()
    await usuario.click(caixa)
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0].avisar_familia).toBe(true)
    expect(corpos[0].inicio).toBe(`${DIA_FICTICIO} 10:00`)
  })

  it('deve oferecer a caixa também quando só o profissional muda', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarEdicao([])
    const profissional = await screen.findByLabelText(/^Profissional/)
    // o catálogo chega depois da montagem: escolher antes dele é escolher numa lista vazia
    await within(profissional).findByRole('option', { name: /Profissional Fictício B/ })

    // ACT
    await usuario.selectOptions(profissional, '2')

    // ASSERT
    expect(await screen.findByRole('checkbox', { name: /Avisar a família pelo WhatsApp/ })).not.toBeChecked()
  })

  it('deve mudar a hora sem mandar o pedido quando a caixa fica desmarcada', async () => {
    // ARRANGE — a família pediu a troca: ninguém é avisado
    const usuario = userEvent.setup()
    const corpos: Record<string, unknown>[] = []
    renderizarEdicao(corpos)
    const hora = await screen.findByLabelText(/^Hora/)

    // ACT
    fireEvent.change(hora, { target: { value: '10:00' } })
    await screen.findByRole('checkbox', { name: /Avisar a família pelo WhatsApp/ })
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).not.toHaveProperty('avisar_familia')
  })
})

/**
 * evolucao-finaliza-a-sessao, gates CR-EVO-04 e CR-EVO-R3-02: a evolução escrita no "Editar" finaliza a
 * sessão e troca a versão do agendamento. O Salvar seguinte não pode acusar a própria pessoa (409) — mas
 * também não pode adotar a versão nova quando outra pessoa mudou o agendamento enquanto a evolução era
 * escrita: os campos da abertura desfariam a mudança dela sem 409.
 */
describe('FormularioAgendamento — editar depois de a evolução finalizar a sessão', () => {
  const ABERTURA = cardFicticio().updated_at
  const DEPOIS_DA_FINALIZACAO = '2026-07-15T11:00:01.000000Z'

  it.each([
    ['ninguém mexeu no agendamento: adota a versão nova', ABERTURA, DEPOIS_DA_FINALIZACAO],
    ['outra pessoa mexeu antes da finalização: fica a da abertura (o 409 diz a verdade)', '2026-07-15T10:30:00.000000Z', ABERTURA],
  ])('deve salvar com a versão certa — %s', async (_caso, versaoAntes, versaoEsperada) => {
    // ARRANGE
    let registrado = false
    let versaoEnviada: string | null = null
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: SELECAO_FICTICIA.status.map((item) => ({ ...item, em_aberto: item.id === 1, sessao_marcada: true })),
        }),
      ),
      msw.get('/api/atendimentos', () =>
        HttpResponse.json({
          data: registrado
            ? [{ id: 3, agendamento_id: 1, iniciado_em: null, finalizado_em: `${DIA_FICTICIO} 08:40`, evolucao_id: 9, updated_at: '2026-07-15T11:00:00.000000Z' }]
            : [],
          current_page: 1,
          last_page: 1,
          per_page: 50,
          total: registrado ? 1 : 0,
        }),
      ),
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({ configuracoes: [{ chave: 'evolucoes.status_ao_salvar', tipo: 'int', valor: 3 }] }),
      ),
      msw.get('/api/profissionais', () =>
        HttpResponse.json([{ id: 1, nome: 'Profissional Fictício', horarios: {}, obs: null, ativo: true, especialidades: [] }]),
      ),
      msw.post('/api/agendamentos/:id/evolucao', () => {
        registrado = true
        return HttpResponse.json(
          {
            id: 9,
            atendimento_id: 3,
            profissional_id: 1,
            responsavel_tecnico_id: null,
            conteudo: 'Evolução fictícia.',
            preenchida_em: `${DIA_FICTICIO} 09:00`,
            updated_at: '2026-07-15T11:00:00.000000Z',
            sessao: { finalizada: true, motivo: null, versao_antes: versaoAntes, versao_depois: DEPOIS_DA_FINALIZACAO },
          },
          { status: 201 },
        )
      }),
      msw.get('/api/agendamentos/:id', () => HttpResponse.json(detalheFicticio())),
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.put('/api/agendamentos/1', ({ request }) => {
        versaoEnviada = request.headers.get('If-Match')
        return HttpResponse.json(cardFicticio())
      }),
    )
    useAuthStore.setState({
      usuario: {
        ...usuarioFicticio,
        profissional_id: 1,
        permissoes: ['agenda.ver', 'agenda.editar', 'atendimentos.ver', 'atendimentos.criar', 'evolucoes.criar', 'evolucoes.ver'],
      },
      carregandoSessao: false,
    })
    const usuario = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <FormularioAgendamento aberto aoFechar={() => {}} card={cardFicticio()} />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await usuario.click(await screen.findByRole('button', { name: 'Escrever evolução' }))
    const dialogo = await screen.findByRole('alertdialog', { name: /Registrar evolução/ })
    await usuario.type(within(dialogo).getByRole('textbox', { name: /Evolução da sessão/ }), 'Evolução fictícia.')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar evolução' }))
    await screen.findByText('Evolução salva e sessão finalizada.')
    await screen.findByText(/Sessão registrada em/)

    // ACT
    fireEvent.change(screen.getByLabelText(/^Hora/), { target: { value: '10:00' } })
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(versaoEnviada).toBe(versaoEsperada)
    })
  })
})

/**
 * Gate A11Y-EVO-R2-02 (anterior à change, mas o Editar virou a segunda porta da evolução): o diálogo
 * abria com o foco no cartão da grade, atrás dele, numa árvore `aria-hidden`.
 */
describe('FormularioAgendamento — o foco ao abrir e ao fechar', () => {
  /** Um botão de verdade abre o Editar: é ele que tem o foco antes, como o cartão na grade. */
  function Abridor() {
    const [aberto, setAberto] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setAberto(true)}>
          Abrir o agendamento
        </button>
        <FormularioAgendamento aberto={aberto} aoFechar={() => setAberto(false)} card={cardFicticio()} />
      </>
    )
  }

  function renderizarComAbridor() {
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <Abridor />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
  }

  it('deve levar o foco para dentro do diálogo ao abrir o Editar', async () => {
    // ARRANGE + ACT
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <FormularioAgendamento aberto aoFechar={() => {}} card={cardFicticio()} />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ASSERT — dentro, num controle COM NOME e fora de árvore escondida: o espelho do checkbox do Radix
    // (`aria-hidden`, `tabindex=-1`) também está "dentro" (gate A11Y-EVO-R3-01)
    const dialogo = await screen.findByRole('alertdialog', { name: 'Editar agendamento' })
    await waitFor(() => {
      expect(dialogo.contains(document.activeElement)).toBe(true)
    })
    expect(document.activeElement).toHaveAccessibleName()
    expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('deve tirar o foco de quem abriu e levá-lo para dentro do diálogo', async () => {
    // ARRANGE — o caso medido no navegador: o foco FICAVA no disparador, atrás do diálogo
    const usuario = userEvent.setup()
    renderizarComAbridor()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Abrir o agendamento' }))

    // ASSERT — dentro, num controle COM NOME e fora de árvore escondida: o espelho do checkbox do Radix
    // (`aria-hidden`, `tabindex=-1`) também está "dentro" (gate A11Y-EVO-R3-01)
    const dialogo = await screen.findByRole('alertdialog', { name: 'Editar agendamento' })
    await waitFor(() => {
      expect(dialogo.contains(document.activeElement)).toBe(true)
    })
    expect(document.activeElement).toHaveAccessibleName()
    expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('deve levar o foco a um controle com nome ao abrir o Novo agendamento', async () => {
    // ARRANGE + ACT — o mesmo diálogo, sem cartão
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <FormularioAgendamento aberto aoFechar={() => {}} inicial={{ inicio: `${DIA_FICTICIO} 09:00`, profissionalId: 1 }} />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ASSERT
    const dialogo = await screen.findByRole('alertdialog', { name: 'Novo agendamento' })
    await waitFor(() => {
      expect(dialogo.contains(document.activeElement)).toBe(true)
    })
    expect(document.activeElement).toHaveAccessibleName()
    expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('deve devolver o foco a quem abriu, ao cancelar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarComAbridor()
    await usuario.click(screen.getByRole('button', { name: 'Abrir o agendamento' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Editar agendamento' })

    // ACT
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Abrir o agendamento' })).toHaveFocus()
    })
  })

  it('deve devolver o foco a quem abriu também quando a página DESMONTA o formulário ao fechar', async () => {
    // ARRANGE — a página da agenda faz `{formularioAberto ? <FormularioAgendamento … /> : null}`: nesse
    // caminho o `onCloseAutoFocus` do Radix não roda, e o foco caía no `body` (medido no navegador)
    function PaginaQueDesmonta() {
      const [aberto, setAberto] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setAberto(true)}>
            Abrir o agendamento
          </button>
          {aberto ? <FormularioAgendamento aberto aoFechar={() => setAberto(false)} card={cardFicticio()} /> : null}
        </>
      )
    }
    const usuario = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <PaginaQueDesmonta />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await usuario.click(screen.getByRole('button', { name: 'Abrir o agendamento' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Editar agendamento' })

    // ACT
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Abrir o agendamento' })).toHaveFocus()
    })
  })

  it('deve levar o foco ao cartão quando quem abriu sumiu e o foco estava no fundo da página', async () => {
    // ARRANGE — o caminho do painel: "Mais ações › Editar" fecha o painel e o menu, o foco cai no `body`,
    // e só então o Editar abre. Guardar o `body` como "quem abriu" devolvia o foco a ele (medido no navegador)
    function PainelQueSome() {
      const [editando, setEditando] = useState(false)
      return (
        <>
          <div data-card-id="1">
            <button type="button">Paciente Fictício</button>
          </div>
          {editando ? null : (
            <button type="button" onClick={() => setEditando(true)}>
              Editar pelo menu
            </button>
          )}
          {editando ? <FormularioAgendamento aberto aoFechar={() => setEditando(false)} card={cardFicticio()} /> : null}
        </>
      )
    }
    const usuario = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <PainelQueSome />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
    await usuario.click(screen.getByRole('button', { name: 'Editar pelo menu' }))
    const dialogo = await screen.findByRole('alertdialog', { name: 'Editar agendamento' })

    // ACT
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Paciente Fictício' })).toHaveFocus()
    })
  })
})

describe('FormularioAgendamento — o aviso do pacote sem saldo no Editar', () => {
  it('deve avisar, antes do clique, que o pacote sem saldo não deixa finalizar', async () => {
    // ARRANGE — gate CR-EVO-R3-06: a mesma ligação do painel, pela segunda porta da evolução
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: SELECAO_FICTICIA.status.map((item) => ({ ...item, em_aberto: item.id === 1, sessao_marcada: true })),
        }),
      ),
      msw.get('/api/atendimentos', () => HttpResponse.json({ data: [], current_page: 1, last_page: 1, per_page: 50, total: 0 })),
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({ configuracoes: [{ chave: 'evolucoes.status_ao_salvar', tipo: 'int', valor: 3 }] }),
      ),
    )
    useAuthStore.setState({
      usuario: {
        ...usuarioFicticio,
        profissional_id: 1,
        permissoes: ['agenda.ver', 'agenda.editar', 'atendimentos.ver', 'atendimentos.criar', 'evolucoes.criar', 'evolucoes.ver'],
      },
      carregandoSessao: false,
    })

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter>
            <FormularioAgendamento aberto aoFechar={() => {}} card={cardFicticio({ tratamento_saldo: 0 })} />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Escrever evolução' })).toHaveAccessibleDescription(/pacote está sem saldo/)
  })
})

/**
 * Change `o-sistema-avisa-o-que-falta`: quando falta um pré-requisito para marcar, a tela diz o que
 * falta, por quê, e o caminho — o link para quem pode resolver, a quem pedir para quem não pode. E o
 * aviso sai só do que o formulário já carrega: nenhuma requisição nova. Dados FICTÍCIOS.
 */

/** Um profissional ativo sem nenhuma especialidade na ficha: a agenda não tem o que marcar com ele. */
const PROFISSIONAL_SEM_ESPECIALIDADE: ProfissionalDaAgenda = {
  id: 3,
  nome: 'Profissional Fictício Sem Especialidade',
  foto_versao: null,
  horarios: {},
  obs: null,
  especialidades: [],
}

const PACIENTE_DO_RETORNO = { id: 10, nome: 'Paciente Fictício', nome_social: null }

const QUEM_AGENDA = ['agenda.ver', 'agenda.criar', 'agenda.editar']
/**
 * Completar a ficha: ela ABRE com `profissionais.ver`, e escolher as especialidades que ele atende pede
 * `profissionais.editar`. Com uma só, o link levaria a uma ficha que não se abre ou não se salva.
 */
const QUEM_COMPLETA_A_FICHA = [...QUEM_AGENDA, 'profissionais.ver', 'profissionais.editar', 'especialidades.ver']
/**
 * O pacote mora no cadastro da criança: ler o paciente, editá-lo, ver o bloco dos pacotes e cadastrar
 * o pacote — as QUATRO permissões.
 */
const QUEM_CADASTRA_PACOTE = [
  ...QUEM_AGENDA,
  'pacientes.ver',
  'pacientes.editar',
  'tratamentos.ver',
  'tratamentos.criar',
  // o Novo tratamento lê os três catálogos (gate CR-AVI-R2-02)
  'convenios.ver',
  'especialidades.ver',
  'profissionais.ver',
]

function comPermissoes(permissoes: string[]): void {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
}

function comProfissionalSemEspecialidade(): void {
  servidor.use(
    msw.get('/api/agenda/selecao', () =>
      HttpResponse.json({
        ...SELECAO_FICTICIA,
        profissionais: [...SELECAO_FICTICIA.profissionais, PROFISSIONAL_SEM_ESPECIALIDADE],
      }),
    ),
  )
}

function renderizarFormulario(props: Partial<FormularioAgendamentoProps> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter>
          <FormularioAgendamento aberto aoFechar={() => {}} {...props} />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** O horário livre clicado na coluna do profissional. */
function noHorarioDe(profissionalId: number): FormularioAgendamentoProps['inicial'] {
  return { profissionalId, inicio: `${DIA_FICTICIO} 08:00` }
}

/** Requisições feitas do render até a tela assentar — método e caminho, em ordem estável. */
async function requisicoesAte(montar: () => Promise<void>): Promise<string[]> {
  const pedidas: string[] = []
  const anotar = ({ request }: { request: Request }): void => {
    pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
  }
  servidor.events.on('request:start', anotar)
  await montar()
  await waitFor(() => {
    expect(queryClient.isFetching()).toBe(0)
  })
  servidor.events.removeListener('request:start', anotar)

  return pedidas.sort()
}

describe('FormularioAgendamento — profissional sem especialidade (o-sistema-avisa-o-que-falta)', () => {
  it('deve dizer no campo Especialidade que o profissional não tem especialidade e levar à ficha dele', async () => {
    // ARRANGE
    comPermissoes(QUEM_COMPLETA_A_FICHA)
    comProfissionalSemEspecialidade()
    const usuario = userEvent.setup()
    renderizarFormulario({ inicial: noHorarioDe(1) })
    const dialogo = screen.getByRole('alertdialog')
    const profissional = within(dialogo).getByLabelText(/^Profissional/)
    await within(profissional).findByRole('option', { name: PROFISSIONAL_SEM_ESPECIALIDADE.nome })

    // ACT — a recepção escolhe o profissional sem especialidade
    await usuario.selectOptions(profissional, '3')

    // ASSERT — o seletor não fica mudo: diz o que falta, e o caminho é a ficha DELE
    const especialidade = within(dialogo).getByLabelText(/^Especialidade/)
    expect(especialidade).toHaveAccessibleDescription(
      /^Profissional Fictício Sem Especialidade não tem especialidade cadastrada, e a sessão precisa de uma\.\s+Abrir a ficha do profissional$/,
    )
    expect(within(dialogo).getByRole('link', { name: 'Abrir a ficha do profissional' })).toHaveAttribute(
      'href',
      '/profissionais/3',
    )
    // curto: "Sem especialidade cadastrada" cortava no seletor a 768 e a 1440 (gate DQA-AVI-01)
    expect(within(especialidade).getByRole('option', { name: 'Sem especialidade' })).toBeInTheDocument()
  })

  it('deve escrever por que não dá para marcar, e não iniciar nenhuma escrita', async () => {
    // ARRANGE
    comPermissoes(QUEM_COMPLETA_A_FICHA)
    comProfissionalSemEspecialidade()
    renderizarFormulario({ inicial: noHorarioDe(3), pacienteInicial: PACIENTE_DO_RETORNO })
    const dialogo = screen.getByRole('alertdialog')
    const marcar = within(dialogo).getByRole('button', { name: 'Marcar' })
    await waitFor(() => {
      expect(marcar).toHaveAttribute('aria-disabled', 'true')
    })

    // ACT — o submit direto (o Enter num campo), por cima da validação nativa do navegador: quem
    // trava é o formulário, não o `required` do seletor
    fireEvent.submit(marcar.closest('form') as HTMLFormElement)

    // ASSERT — o motivo está escrito e ligado ao botão, que continua focável para dizê-lo; a frase se
    // sustenta sozinha, sem mandar ler outro campo (gate DQA-AVI-06)
    expect(marcar).toHaveAccessibleDescription(
      'Não dá para marcar: Profissional Fictício Sem Especialidade não tem especialidade cadastrada.',
    )
    expect(marcar).not.toBeDisabled()
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('deve anunciar o motivo ao trocar para o profissional sem especialidade', async () => {
    // ARRANGE — só a região viva que JÁ existia é anunciada: ela está montada, vazia, antes do motivo
    comPermissoes(QUEM_COMPLETA_A_FICHA)
    comProfissionalSemEspecialidade()
    const usuario = userEvent.setup()
    renderizarFormulario({ inicial: noHorarioDe(1), pacienteInicial: PACIENTE_DO_RETORNO })
    const dialogo = screen.getByRole('alertdialog')
    const profissional = within(dialogo).getByLabelText(/^Profissional/)
    await within(profissional).findByRole('option', { name: PROFISSIONAL_SEM_ESPECIALIDADE.nome })
    const regioes = dialogo.querySelectorAll('[aria-live="polite"]')
    const regiaoDoMotivo = Array.from(regioes).find((regiao) => regiao.textContent === '')

    // ACT — a troca de profissional, longe dos botões
    await usuario.selectOptions(profissional, '3')

    // ASSERT
    expect(regiaoDoMotivo).toBeDefined()
    expect(regiaoDoMotivo).toHaveTextContent(
      'Não dá para marcar: Profissional Fictício Sem Especialidade não tem especialidade cadastrada.',
    )
  })

  it('deve dizer a quem pedir, sem link, a quem não pode completar a ficha do profissional', async () => {
    // ARRANGE — mandar a uma tela que responde 403 é pior que não mandar
    comPermissoes(QUEM_AGENDA)
    comProfissionalSemEspecialidade()

    // ACT
    renderizarFormulario({ inicial: noHorarioDe(3) })

    // ASSERT
    const dialogo = screen.getByRole('alertdialog')
    const especialidade = within(dialogo).getByLabelText(/^Especialidade/)
    await waitFor(() => {
      expect(especialidade).toHaveAccessibleDescription(
        /não tem especialidade cadastrada.*Peça a quem administra o sistema para completar a ficha do profissional\.$/,
      )
    })
    expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve fechar o formulário ao seguir o caminho para a ficha', async () => {
    // ARRANGE
    comPermissoes(QUEM_COMPLETA_A_FICHA)
    comProfissionalSemEspecialidade()
    const aoFechar = vi.fn()
    const usuario = userEvent.setup()
    renderizarFormulario({ inicial: noHorarioDe(3), aoFechar })
    const dialogo = screen.getByRole('alertdialog')

    // ACT
    await usuario.click(await within(dialogo).findByRole('link', { name: 'Abrir a ficha do profissional' }))

    // ASSERT
    expect(aoFechar).toHaveBeenCalledTimes(1)
  })

  it('deve manter o campo e o Marcar como sempre quando o profissional atende alguma especialidade', async () => {
    // ARRANGE + ACT — o caso comum: nada muda
    comPermissoes(QUEM_COMPLETA_A_FICHA)
    comProfissionalSemEspecialidade()
    renderizarFormulario({ inicial: noHorarioDe(1) })
    const dialogo = screen.getByRole('alertdialog')
    const especialidade = within(dialogo).getByLabelText(/^Especialidade/)
    await within(especialidade).findByRole('option', { name: 'Fonoaudiologia' })

    // ASSERT
    expect(especialidade).toHaveAccessibleDescription('Só as que o profissional atende.')
    expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
    const marcar = within(dialogo).getByRole('button', { name: 'Marcar' })
    expect(marcar).not.toHaveAttribute('aria-disabled')
    expect(marcar).toHaveAccessibleDescription('')
  })

  it('deve passar no axe com o aviso do campo e o motivo do botão, com e sem a permissão', async () => {
    for (const permissoes of [QUEM_COMPLETA_A_FICHA, QUEM_AGENDA]) {
      // ARRANGE
      queryClient.clear()
      comPermissoes(permissoes)
      comProfissionalSemEspecialidade()
      const { unmount } = renderizarFormulario({ inicial: noHorarioDe(3), pacienteInicial: PACIENTE_DO_RETORNO })
      const dialogo = screen.getByRole('alertdialog')

      // ACT
      await within(dialogo).findByText(/^Não dá para marcar:/)

      // ASSERT
      expect(await axe(dialogo)).toHaveNoViolations()
      unmount()
    }
  })

  it('deve abrir com as mesmas requisições, com e sem o aviso (nenhuma requisição nova)', async () => {
    // ARRANGE — o aviso sai do catálogo que o formulário já carrega (D6)
    async function aoAbrirCom(profissionalId: number): Promise<string[]> {
      queryClient.clear()
      comPermissoes(QUEM_COMPLETA_A_FICHA)
      comProfissionalSemEspecialidade()
      let desmontar = (): void => {}
      const pedidas = await requisicoesAte(async () => {
        desmontar = renderizarFormulario({ inicial: noHorarioDe(profissionalId), pacienteInicial: PACIENTE_DO_RETORNO }).unmount
        await screen.findByRole('option', { name: PROFISSIONAL_SEM_ESPECIALIDADE.nome })
      })
      desmontar()
      return pedidas
    }

    // ACT
    const comAviso = await aoAbrirCom(3)
    const semAviso = await aoAbrirCom(1)

    // ASSERT
    expect(comAviso.length).toBeGreaterThan(0)
    expect(comAviso).toEqual(semAviso)
  })
})

describe('FormularioAgendamento — o Encaixar diz por que está indisponível (o-sistema-avisa-o-que-falta)', () => {
  it('deve escrever o motivo quando o profissional do horário não tem especialidade', async () => {
    // ARRANGE — o horário que abriu é de um profissional sem especialidade
    comPermissoes(QUEM_COMPLETA_A_FICHA)
    comProfissionalSemEspecialidade()
    renderizarFormulario({ inicial: noHorarioDe(3), encaixe: entradaFicticia() })
    const dialogo = screen.getByRole('alertdialog')
    const encaixar = within(dialogo).getByRole('button', { name: 'Encaixar' })
    await waitFor(() => {
      expect(encaixar).toHaveAccessibleDescription(
        'Não dá para encaixar: Profissional Fictício Sem Especialidade não tem especialidade cadastrada.',
      )
    })

    // ACT — o submit direto, por cima da validação nativa
    fireEvent.submit(encaixar.closest('form') as HTMLFormElement)

    // ASSERT — inerte mas focável (antes: `disabled`, fora do Tab e sem motivo), e o campo diz o caminho
    expect(encaixar).toHaveAttribute('aria-disabled', 'true')
    expect(encaixar).not.toBeDisabled()
    expect(within(dialogo).getByLabelText(/^Especialidade/)).toHaveAccessibleDescription(
      /não tem especialidade cadastrada.*Abrir a ficha do profissional$/,
    )
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('deve não escrever nada ao submeter o encaixe sem especialidade', async () => {
    // ARRANGE — entrada da fila "qualquer especialidade": sem a trava, o payload sairia com
    // `especialidade_id: 0` e o servidor diria "inválido" em vez de "obrigatório" (gate CR-AVI-10)
    comPermissoes(QUEM_AGENDA)
    renderizarFormulario({
      inicial: noHorarioDe(1),
      encaixe: entradaFicticia({ especialidade_id: null, especialidade: null }),
    })
    const dialogo = screen.getByRole('alertdialog')
    const especialidade = within(dialogo).getByLabelText(/^Especialidade/)
    await within(especialidade).findByRole('option', { name: 'Fonoaudiologia' })
    const encaixar = within(dialogo).getByRole('button', { name: 'Encaixar' })

    // ACT — o submit direto (o Enter num campo), por cima da validação nativa do navegador
    fireEvent.submit(encaixar.closest('form') as HTMLFormElement)

    // ASSERT
    expect(encaixar).toHaveAccessibleDescription('Escolha a especialidade para encaixar.')
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })

  it('deve pedir a especialidade quando a fila não a trouxe, e liberar ao escolher', async () => {
    // ARRANGE — entrada da fila "qualquer especialidade": o Encaixar ficava desabilitado e mudo
    comPermissoes(QUEM_AGENDA)
    const usuario = userEvent.setup()
    renderizarFormulario({
      inicial: noHorarioDe(1),
      encaixe: entradaFicticia({ especialidade_id: null, especialidade: null }),
    })
    const dialogo = screen.getByRole('alertdialog')
    const encaixar = within(dialogo).getByRole('button', { name: 'Encaixar' })
    expect(encaixar).toHaveAccessibleDescription('Escolha a especialidade para encaixar.')
    const especialidade = within(dialogo).getByLabelText(/^Especialidade/)
    await within(especialidade).findByRole('option', { name: 'Fonoaudiologia' })

    // ACT
    await usuario.selectOptions(especialidade, '1')

    // ASSERT
    expect(encaixar).not.toHaveAttribute('aria-disabled')
    expect(encaixar).toHaveAccessibleDescription('')
    expect(within(dialogo).queryByText('Escolha a especialidade para encaixar.')).not.toBeInTheDocument()
  })
})

describe('FormularioAgendamento — o campo Tratamento leva ao cadastro do pacote (o-sistema-avisa-o-que-falta)', () => {
  /** A especialidade escolhida: só então o campo Tratamento diz algo sobre os pacotes da criança. */
  async function escolherFonoaudiologia(usuario: ReturnType<typeof userEvent.setup>, dialogo: HTMLElement) {
    const especialidade = within(dialogo).getByLabelText(/^Especialidade/)
    await within(especialidade).findByRole('option', { name: 'Fonoaudiologia' })
    await usuario.selectOptions(especialidade, '1')
  }

  function comPacotes(pacotes: typeof TRATAMENTOS_DO_PACIENTE): void {
    servidor.use(msw.get('/api/agenda/selecao/tratamentos', () => HttpResponse.json(pacotes)))
  }

  it('deve levar ao cadastro do pacote quando a criança não tem pacote', async () => {
    // ARRANGE — o `beforeEach` responde a lista de pacotes VAZIA
    comPermissoes(QUEM_CADASTRA_PACOTE)
    const usuario = userEvent.setup()
    renderizarFormulario({ inicial: noHorarioDe(1), pacienteInicial: PACIENTE_DO_RETORNO })
    const dialogo = screen.getByRole('alertdialog')

    // ACT
    await escolherFonoaudiologia(usuario, dialogo)

    // ASSERT — a frase que já existia, agora com o caminho
    const tratamento = within(dialogo).getByLabelText(/^Tratamento/)
    await waitFor(() => {
      expect(tratamento).toHaveAccessibleDescription(
        /^Este paciente não tem pacote cadastrado\.\s+Cadastrar o pacote no cadastro da criança$/,
      )
    })
    expect(within(dialogo).getByRole('link', { name: 'Cadastrar o pacote no cadastro da criança' })).toHaveAttribute(
      'href',
      '/pacientes/10/editar',
    )
  })

  it('deve levar ao cadastro do pacote também quando os pacotes da especialidade estão fechados', async () => {
    // ARRANGE — cada guia nova do convênio é um pacote novo: o caminho é cadastrar o próximo
    comPermissoes(QUEM_CADASTRA_PACOTE)
    comPacotes([{ id: 5, especialidade_id: 1, status: 'finalizado', sessoes_total: 10, sessoes_saldo: 0, vencido: false }])
    const usuario = userEvent.setup()
    renderizarFormulario({ inicial: noHorarioDe(1), pacienteInicial: PACIENTE_DO_RETORNO })
    const dialogo = screen.getByRole('alertdialog')

    // ACT
    await escolherFonoaudiologia(usuario, dialogo)

    // ASSERT
    await waitFor(() => {
      expect(within(dialogo).getByLabelText(/^Tratamento/)).toHaveAccessibleDescription(
        /^Os pacotes desta especialidade estão fechados, vencidos ou sem saldo\.\s+Cadastrar o pacote no cadastro da criança$/,
      )
    })
  })

  it('deve dizer a quem pedir, sem link, a quem não tem as duas permissões do cadastro do pacote', async () => {
    // ARRANGE — editar o paciente sem criar tratamento: a tela do pacote responderia 403
    comPermissoes([...QUEM_AGENDA, 'pacientes.editar'])
    const usuario = userEvent.setup()
    renderizarFormulario({ inicial: noHorarioDe(1), pacienteInicial: PACIENTE_DO_RETORNO })
    const dialogo = screen.getByRole('alertdialog')

    // ACT
    await escolherFonoaudiologia(usuario, dialogo)

    // ASSERT
    await waitFor(() => {
      expect(within(dialogo).getByLabelText(/^Tratamento/)).toHaveAccessibleDescription(
        /^Este paciente não tem pacote cadastrado\.\s+Peça a quem administra o sistema para cadastrar o pacote\.$/,
      )
    })
    expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve manter a ajuda de sempre, sem caminho, quando a criança tem pacote utilizável', async () => {
    // ARRANGE — o caso comum: nada muda
    comPermissoes(QUEM_CADASTRA_PACOTE)
    comPacotes(TRATAMENTOS_DO_PACIENTE)
    const usuario = userEvent.setup()
    renderizarFormulario({ inicial: noHorarioDe(1), pacienteInicial: PACIENTE_DO_RETORNO })
    const dialogo = screen.getByRole('alertdialog')

    // ACT
    await escolherFonoaudiologia(usuario, dialogo)

    // ASSERT
    const tratamento = within(dialogo).getByLabelText(/^Tratamento/)
    await within(tratamento).findByRole('option', { name: /Fonoaudiologia/ })
    expect(tratamento).toHaveAccessibleDescription('Só os pacotes da especialidade escolhida.')
    expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve dizer que não carregou, sem afirmar que falta pacote, quando a lista de pacotes falha', async () => {
    // ARRANGE — a lista não chegou: "não tem pacote" seria uma frase falsa sobre a criança
    comPermissoes(QUEM_CADASTRA_PACOTE)
    servidor.use(
      msw.get('/api/agenda/selecao/tratamentos', () =>
        HttpResponse.json({ message: 'Sem permissão.' }, { status: 403 }),
      ),
    )
    const usuario = userEvent.setup()
    renderizarFormulario({ inicial: noHorarioDe(1), pacienteInicial: PACIENTE_DO_RETORNO })
    const dialogo = screen.getByRole('alertdialog')

    // ACT
    await escolherFonoaudiologia(usuario, dialogo)

    // ASSERT
    await waitFor(() => {
      expect(within(dialogo).getByLabelText(/^Tratamento/)).toHaveAccessibleDescription(
        'Não foi possível carregar os pacotes deste paciente.',
      )
    })
    expect(within(dialogo).queryByRole('link')).not.toBeInTheDocument()
  })

  it('deve passar no axe com o caminho do pacote, com e sem as permissões', async () => {
    for (const permissoes of [QUEM_CADASTRA_PACOTE, QUEM_AGENDA]) {
      // ARRANGE
      queryClient.clear()
      comPermissoes(permissoes)
      const usuario = userEvent.setup()
      const { unmount } = renderizarFormulario({ inicial: noHorarioDe(1), pacienteInicial: PACIENTE_DO_RETORNO })
      const dialogo = screen.getByRole('alertdialog')
      await escolherFonoaudiologia(usuario, dialogo)

      // ACT
      await within(dialogo).findByText(/^Este paciente não tem pacote cadastrado\./)

      // ASSERT
      expect(await axe(dialogo)).toHaveNoViolations()
      unmount()
    }
  })

  it('deve fazer as mesmas requisições, com e sem pacote utilizável (nenhuma requisição nova)', async () => {
    // ARRANGE — o aviso sai da lista de pacotes que o campo já consulta (D6)
    async function ateOAviso(pacotes: typeof TRATAMENTOS_DO_PACIENTE): Promise<string[]> {
      queryClient.clear()
      comPermissoes(QUEM_CADASTRA_PACOTE)
      comPacotes(pacotes)
      const usuario = userEvent.setup()
      let desmontar = (): void => {}
      const pedidas = await requisicoesAte(async () => {
        desmontar = renderizarFormulario({ inicial: noHorarioDe(1), pacienteInicial: PACIENTE_DO_RETORNO }).unmount
        await escolherFonoaudiologia(usuario, screen.getByRole('alertdialog'))
      })
      desmontar()
      return pedidas
    }

    // ACT
    const comAviso = await ateOAviso([])
    const semAviso = await ateOAviso(TRATAMENTOS_DO_PACIENTE)

    // ASSERT
    expect(comAviso).toContain('GET /api/agenda/selecao/tratamentos')
    expect(comAviso).toEqual(semAviso)
  })
})
