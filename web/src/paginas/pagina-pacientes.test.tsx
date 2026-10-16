import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { PaginaPaciente } from '@/paginas/pagina-paciente'
import { PaginaPacientes } from '@/paginas/pagina-pacientes'
import { useAuthStore } from '@/stores/auth-store'
import { handlersDeCadastros, pacienteDaListaFicticio, pacienteFicticio } from '@/test/dados-cadastros'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { PacienteDaLista } from '@/tipos'

/**
 * O campo "Nome" da identificação — há outros "Nome" na tela (social, responsável).
 *
 * ASSÍNCRONO desde a change `campos-do-cadastro-configuraveis`: o formulário só se desenha
 * depois que a RÉGUA da clínica chega (é ela que diz quais campos aparecem e quais levam
 * marca de obrigatório), então não há como consultá-lo no mesmo tique da renderização.
 */
async function campoNome(): Promise<HTMLElement> {
  const identificacao = await screen.findByRole('group', { name: 'Identificação' })
  return within(identificacao).getByLabelText(/^Nome \(obrigatório\)/)
}

const TUDO = ['pacientes.ver', 'pacientes.criar', 'pacientes.editar']

describe('PaginaPacientes — aviso de cadastro incompleto (pre-cadastro-de-paciente)', () => {
  it('deve sinalizar o pré-cadastro com o aviso e idade não informada', async () => {
    // ARRANGE — um completo e um pré-cadastrado (sem nascimento/necessidade)
    renderizar('/pacientes', {
      pacientes: [
        pacienteDaListaFicticio({ id: 1, nome: 'Paciente Fictício Completo' }),
        pacienteDaListaFicticio({
          id: 2,
          nome: 'Paciente Fictício do Balcão',
          nascimento: null,
          necessidade: null,
          cadastro_incompleto: true,
        }),
      ],
    })

    // ACT
    const linhaIncompleta = (await screen.findByText('Paciente Fictício do Balcão')).closest('tr') as HTMLElement
    const linhaCompleta = screen.getByText('Paciente Fictício Completo').closest('tr') as HTMLElement

    // ASSERT — aviso SÓ na linha incompleta; ausências viram "Não informado"
    expect(within(linhaIncompleta).getByText('Cadastro incompleto')).toBeInTheDocument()
    expect(within(linhaIncompleta).getAllByText('Não informado').length).toBeGreaterThanOrEqual(2)
    expect(within(linhaCompleta).queryByText('Cadastro incompleto')).not.toBeInTheDocument()
  })
})

function renderizar(
  rota = '/pacientes',
  {
    permissoes = TUDO,
    pacientes,
    handlersExtras = [],
  }: { permissoes?: string[]; pacientes?: PacienteDaLista[]; handlersExtras?: Parameters<typeof servidor.use> } = {},
) {
  servidor.use(...handlersExtras, ...handlersDeCadastros(pacientes))
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[rota]}>
          <Routes>
            <Route path="/pacientes" element={<PaginaPacientes />} />
            <Route path="/pacientes/novo" element={<PaginaPaciente />} />
            {/* o formulário é edit-only (a leitura é a ficha, change ficha-do-paciente) */}
            <Route path="/pacientes/:id/editar" element={<PaginaPaciente />} />
            {/* destino do "salvar" da edição — placeholder aqui (a ficha tem suíte própria) */}
            <Route path="/pacientes/:id" element={<div>Ficha do paciente</div>} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Pacientes — lista', () => {
  it('deve buscar no servidor sem pôr o nome do paciente na URL', async () => {
    // ARRANGE — o termo é o nome de uma CRIANÇA: a URL vai para o histórico do
    // navegador, para o Referer e para o log de acesso (design D2)
    const usuario = userEvent.setup()
    let buscaRecebida: string | null = null
    renderizar('/pacientes', {
      pacientes: [
        pacienteDaListaFicticio({ id: 1, nome: 'Paciente Fictício Andréa' }),
        pacienteDaListaFicticio({ id: 2, nome: 'Paciente Fictício Bruno' }),
      ],
    })
    servidor.use(
      msw.get('/api/pacientes', ({ request }) => {
        buscaRecebida = new URL(request.url).searchParams.get('busca')
        return HttpResponse.json({
          data: [pacienteDaListaFicticio({ id: 2, nome: 'Paciente Fictício Bruno' })],
          current_page: 1,
          last_page: 1,
          per_page: 50,
          total: 1,
        })
      }),
    )

    // ACT
    await usuario.type(screen.getByLabelText('Buscar paciente pelo nome'), 'Bruno')

    // ASSERT — o servidor recebe o termo; a URL da tela, não
    await waitFor(() => {
      expect(buscaRecebida).toBe('Bruno')
    })
    expect(window.location.search).not.toContain('Bruno')
    expect(await screen.findByText('Paciente Fictício Bruno')).toBeInTheDocument()
  })

  it('não deve mostrar CPF nem responsáveis na lista', async () => {
    // ARRANGE — a lista é MINIMIZADA pelo servidor; a tela não pede o cadastro
    renderizar()

    // ACT
    await screen.findByRole('table')

    // ASSERT
    const tabela = screen.getByRole('table')
    expect(within(tabela).queryByText(/CPF/i)).not.toBeInTheDocument()
    expect(within(tabela).queryByText(/Responsáve/i)).not.toBeInTheDocument()
  })

  it('deve esconder o cadastrar de quem só pode ver', async () => {
    // ARRANGE
    renderizar('/pacientes', { permissoes: ['pacientes.ver'] })

    // ACT
    await screen.findByRole('table')

    // ASSERT
    expect(screen.queryByRole('button', { name: /Cadastrar paciente/ })).not.toBeInTheDocument()
  })

  it('deve mostrar erro em vez de "nenhum paciente" quando a consulta falha', async () => {
    // ARRANGE — falha de rede virando lista vazia mente sobre o cadastro
    renderizar('/pacientes', {
      handlersExtras: [msw.get('/api/pacientes', () => HttpResponse.json({ message: 'Sem acesso.' }, { status: 403 }))],
    })

    // ACT + ASSERT
    expect(await screen.findByText(/Não foi possível carregar/)).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum paciente cadastrado/)).not.toBeInTheDocument()
  })
})

describe('Pacientes — cadastro', () => {
  it('deve abrir o cadastro novo com os campos de responsável e contato já visíveis', async () => {
    // ARRANGE + ACT — seções abertas de fábrica (pre-cadastro-de-paciente): quem
    // preenche não precisa descobrir que existe um botão a apertar
    renderizar('/pacientes/novo')

    // ASSERT — um item de cada, com o botão de adicionar mais ainda presente. O `find` (e
    // não `get`) porque o formulário só se desenha depois que a RÉGUA da clínica chega.
    const responsaveis = await screen.findByRole('group', { name: 'Responsáveis' })
    expect(within(responsaveis).getByLabelText(/Parentesco/)).toBeInTheDocument()
    expect(within(responsaveis).getByRole('button', { name: /Adicionar responsável/ })).toBeInTheDocument()
    const contatos = screen.getByRole('group', { name: 'Contatos' })
    expect(within(contatos).getByLabelText(/Valor/)).toBeInTheDocument()
    expect(within(contatos).getByRole('button', { name: /Adicionar contato/ })).toBeInTheDocument()
  })

  it('deve salvar adulto sem enviar os itens pré-abertos deixados em branco', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null
    renderizar('/pacientes/novo')
    servidor.use(
      msw.post('/api/pacientes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(pacienteFicticio({ id: 9 }), { status: 201 })
      }),
    )

    // ACT — só a identificação; responsável e contato ficam intocados
    await usuario.type((await campoNome()), 'Paciente Fictício Adulto')
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — item em branco não vira lixo no servidor
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    expect(enviado).toMatchObject({ responsaveis_json: [], contatos_json: [] })
  })

  it('deve levar a recusa do menor sem responsável à seção de responsáveis', async () => {
    // ARRANGE — a regra é do SERVIDOR; a tela a explica e mostra a recusa onde
    // ela pode ser resolvida
    const usuario = userEvent.setup()
    renderizar('/pacientes/novo')
    servidor.use(
      msw.post('/api/pacientes', () =>
        HttpResponse.json(
          {
            message: 'Dados inválidos.',
            errors: { responsaveis_json: ['Paciente menor de idade exige pelo menos um responsável.'] },
          },
          { status: 422 },
        ),
      ),
    )

    // ACT
    await usuario.type((await campoNome()), 'Paciente Fictício Novo')
    await usuario.type(screen.getByLabelText(/Nascimento/), '2019-05-04')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    // a recusa do SERVIDOR (alerta), não o texto de ajuda que já explicava a regra
    const responsaveis = screen.getByRole('group', { name: 'Responsáveis' })
    expect(await within(responsaveis).findByRole('alert')).toHaveTextContent(
      'Paciente menor de idade exige pelo menos um responsável.',
    )
  })

  it('deve avisar que o menor exige responsável antes de salvar', async () => {
    // ARRANGE — explicar não é re-implementar: o botão continua habilitado, e
    // quem decide é o servidor
    const usuario = userEvent.setup()
    renderizar('/pacientes/novo')

    // ACT — espera a régua desenhar o formulário antes de digitar
    await usuario.type(await screen.findByLabelText(/Nascimento/), '2019-05-04')

    // ASSERT
    expect(screen.getByText(/menor de idade: o cadastro exige pelo menos um responsável/i)).toBeInTheDocument()
  })

  it('deve levar a recusa do CPF ao campo do CPF', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar('/pacientes/novo')
    servidor.use(
      msw.post('/api/pacientes', () =>
        HttpResponse.json(
          { message: 'Dados inválidos.', errors: { cpf: ['Já existe um paciente com este CPF.'] } },
          { status: 422 },
        ),
      ),
    )

    // ACT
    await usuario.type((await campoNome()), 'Paciente Fictício')
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — no campo, não num aviso solto
    await waitFor(() => {
      expect(screen.getByLabelText(/CPF/)).toHaveAttribute('aria-invalid', 'true')
    })
    expect(screen.getAllByText('Já existe um paciente com este CPF.').length).toBeGreaterThan(0)
  })

  it('deve levar a recusa de um contato ao ITEM certo da lista', async () => {
    // ARRANGE — o servidor recusa por índice; erro do 1º contato não pode
    // aparecer como aviso genérico
    const usuario = userEvent.setup()
    renderizar('/pacientes/1/editar')
    servidor.use(
      msw.put('/api/pacientes/:id', () =>
        HttpResponse.json(
          {
            message: 'Dados inválidos.',
            errors: { 'contatos_json.0.valor': ['O valor do contato é obrigatório.'] },
          },
          { status: 422 },
        ),
      ),
    )

    // ACT
    await screen.findByDisplayValue('Paciente Fictício Andréa')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — a mensagem pousa no campo do contato
    await waitFor(() => {
      expect(screen.getByLabelText(/^Valor/)).toHaveAttribute('aria-invalid', 'true')
    })
  })

  it('deve enviar só os NOVOS consentimentos, sem datar o aceite', async () => {
    // ARRANGE — o aceite é PROVA LEGAL e quem o data é o SERVIDOR (SEC-01): o
    // relógio do balcão não carimba o consentimento de um menor. E o registrado
    // não volta no payload — reenviá-lo seria tentar regravar prova (a API recusa).
    const usuario = userEvent.setup()
    const capturado: { payload?: { consentimentos_json: Array<Record<string, unknown>> } } = {}
    renderizar('/pacientes/1/editar', {
      handlersExtras: [
        msw.get('/api/pacientes/:id', () =>
          HttpResponse.json(
            pacienteFicticio({
              consentimentos_json: [
                {
                  termo: 'Termo fictício de imagem',
                  responsavel: 'Responsável Fictícia',
                  aceito_em: '2026-01-10T12:00:00+00:00',
                },
              ],
            }),
          ),
        ),
        msw.put('/api/pacientes/:id', async ({ request }) => {
          capturado.payload = (await request.json()) as NonNullable<typeof capturado.payload>
          return HttpResponse.json(pacienteFicticio())
        }),
      ],
    })

    // ACT
    await screen.findByText('Termo fictício de imagem')

    // ASSERT — o registrado é só registro: não se edita nem se remove
    const consentimentos = screen.getByRole('group', { name: 'Consentimentos' })
    expect(
      within(consentimentos).queryByRole('button', { name: /Remover consentimento de Responsável Fictícia/ }),
    ).not.toBeInTheDocument()

    // ACT — registra um novo: a tela NÃO tem campo de termo (a régua é do servidor)
    expect(within(consentimentos).queryByLabelText('Termo')).not.toBeInTheDocument()
    await usuario.type(within(consentimentos).getByLabelText(/Responsável que aceitou/), 'Responsável Fictícia')
    await usuario.click(within(consentimentos).getByRole('button', { name: /Registrar aceite/ }))
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — vai SÓ o novo, e SÓ com o responsável: termo, versão, forma, autor e
    // instante são do servidor (mandá-los é 422)
    await waitFor(() => {
      expect(capturado.payload?.consentimentos_json).toHaveLength(1)
    })
    const novo = capturado.payload?.consentimentos_json[0]
    expect(novo).toEqual({ responsavel: 'Responsável Fictícia' })
  })

  it('não deve oferecer o registro do aceite quando nenhum termo está em vigor', async () => {
    // ARRANGE — sem régua publicada, o servidor recusaria (422): a tela diz o próximo
    // passo em vez de montar um formulário que não pode dar certo
    renderizar('/pacientes/novo', {
      handlersExtras: [msw.get('/api/termos-consentimento/vigente', () => HttpResponse.json({ termo: null }))],
    })

    // ACT
    const consentimentos = await screen.findByRole('group', { name: 'Consentimentos' })

    // ASSERT
    await waitFor(() => {
      expect(within(consentimentos).getByText(/Nenhum termo publicado/)).toBeInTheDocument()
    })
    expect(within(consentimentos).queryByRole('button', { name: /Registrar aceite/ })).not.toBeInTheDocument()
    expect(within(consentimentos).queryByLabelText(/Responsável que aceitou/)).not.toBeInTheDocument()
  })

  it('não deve dizer que falta termo quando a leitura do termo em vigor responde com erro', async () => {
    // ARRANGE — 403 (ou a rede) não prova "nenhum termo publicado": a frase seria falsa (gate CR-AVI-08)
    renderizar('/pacientes/novo', {
      handlersExtras: [
        msw.get('/api/termos-consentimento/vigente', () =>
          HttpResponse.json({ message: 'Sem acesso.' }, { status: 403 }),
        ),
      ],
    })

    // ACT
    const consentimentos = await screen.findByRole('group', { name: 'Consentimentos' })
    await waitFor(() => {
      expect(queryClient.getQueryState(chaves.termoVigente())?.status).toBe('error')
    })

    // ASSERT — nem a falta, nem o registro que o servidor recusaria
    expect(within(consentimentos).queryByText(/Nenhum termo publicado/)).not.toBeInTheDocument()
    expect(within(consentimentos).queryByRole('button', { name: /Registrar aceite/ })).not.toBeInTheDocument()
  })

  it('não deve tratar como novo o consentimento que acabou de ser gravado', async () => {
    // ARRANGE — /pacientes/novo e /pacientes/:id são o MESMO componente: a rota
    // muda e ele não remonta. Sem limpar os novos, o aceite já GRAVADO reapareceria
    // como "a salvar", com botão de remover — o oposto do append-only (parecer §3)
    const usuario = userEvent.setup()
    renderizar('/pacientes/novo', {
      handlersExtras: [
        msw.post('/api/pacientes', () =>
          HttpResponse.json(
            pacienteFicticio({
              consentimentos_json: [
                {
                  termo: 'Termo fictício de imagem',
                  responsavel: 'Responsável Fictícia',
                  aceito_em: '2026-07-11T12:00:00+00:00',
                },
              ],
            }),
            { status: 201 },
          ),
        ),
        msw.get('/api/pacientes/:id', () =>
          HttpResponse.json(
            pacienteFicticio({
              consentimentos_json: [
                {
                  termo: 'Termo fictício de imagem',
                  responsavel: 'Responsável Fictícia',
                  aceito_em: '2026-07-11T12:00:00+00:00',
                },
              ],
            }),
          ),
        ),
      ],
    })

    // ACT
    await usuario.type((await campoNome()), 'Paciente Fictício Novo')
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')
    const consentimentos = screen.getByRole('group', { name: 'Consentimentos' })
    await usuario.type(within(consentimentos).getByLabelText(/Responsável que aceitou/), 'Responsável Fictícia')
    await usuario.click(within(consentimentos).getByRole('button', { name: /Registrar aceite/ }))
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — depois de salvo, ele é REGISTRO: sem "a salvar", sem remover
    await waitFor(() => {
      expect(screen.queryByText(/a salvar/)).not.toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: /Remover consentimento de Responsável Fictícia/ }),
    ).not.toBeInTheDocument()
  })

  it('deve reenviar o cadastro inteiro no PUT', async () => {
    // ARRANGE — o `PUT` do paciente é o cadastro completo (a API exige
    // `responsaveis_json` present): perder uma lista no payload apagaria o
    // responsável de um menor
    const usuario = userEvent.setup()
    const capturado: { payload?: Record<string, unknown> } = {}
    renderizar('/pacientes/1/editar', {
      handlersExtras: [
        msw.put('/api/pacientes/:id', async ({ request }) => {
          capturado.payload = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(pacienteFicticio())
        }),
      ],
    })

    // ACT
    await screen.findByDisplayValue('Paciente Fictício Andréa')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(capturado.payload).toBeDefined()
    })
    expect(capturado.payload).toMatchObject({
      nome: 'Paciente Fictício Andréa',
      nascimento: '2018-03-12',
      sexo: 'feminino',
      necessidade: 'sem',
    })
    expect(capturado.payload?.responsaveis_json).toHaveLength(1)
    expect(capturado.payload?.contatos_json).toHaveLength(1)
  })

  it('não deve oferecer exclusão de paciente', async () => {
    // ARRANGE — a API não tem DELETE; desativar preserva a trilha (design D3)
    renderizar('/pacientes/1/editar')

    // ACT
    await screen.findByDisplayValue('Paciente Fictício Andréa')

    // ASSERT
    expect(screen.queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desativar' })).toBeInTheDocument()
  })

  it('deve desativar com confirmação que nomeia o paciente, mandando a versão que HIDRATOU a tela', async () => {
    // ARRANGE — a situação vai pelo endpoint PRÓPRIO (`PATCH .../situacao`), não pelo PUT-inteiro
    // (change faxina-de-gatilhos): trocar uma flag não pode exigir o cadastro completo, senão um
    // PRÉ-CADASTRADO é indesativável.
    //
    // O `If-Match` é a versão que a TELA carregou, não uma relida no instante do clique. Enquanto
    // o serviço relia o cadastro só para montar o token, a concorrência otimista era teatro: a
    // versão validada era sempre a de meio segundo atrás e o 409 não disparava nunca (parecer
    // SEC-PIS-05). Por isso o servidor aqui MUDA de versão depois que a tela hidratou — quem
    // reler manda a nova, e o teste cai.
    const usuario = userEvent.setup()
    const capturado: { payload?: { ativo: boolean }; versao?: string | null; verbo?: string } = {}
    let leiturasDoCadastro = 0
    renderizar('/pacientes/1/editar', {
      handlersExtras: [
        msw.get('/api/pacientes/:id', () => {
          leiturasDoCadastro += 1
          return HttpResponse.json(
            pacienteFicticio(
              leiturasDoCadastro === 1 ? {} : { updated_at: '2026-09-14T08:00:00.000000Z' },
            ),
          )
        }),
        msw.patch('/api/pacientes/:id/situacao', async ({ request }) => {
          capturado.payload = (await request.json()) as NonNullable<typeof capturado.payload>
          capturado.versao = request.headers.get('If-Match')
          capturado.verbo = request.method
          return HttpResponse.json(pacienteFicticio({ ativo: false }))
        }),
        // o PUT-inteiro NÃO pode ser usado para isto: se for chamado, o teste enxerga
        msw.put('/api/pacientes/:id', () => HttpResponse.json({ message: 'não devia' }, { status: 500 })),
      ],
    })

    // ACT
    await screen.findByDisplayValue('Paciente Fictício Andréa')
    await usuario.click(screen.getByRole('button', { name: 'Desativar' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT — nomeia o alvo e diz a consequência real
    expect(within(dialog).getByRole('heading', { name: /Desativar Paciente Fictício Andréa\?/ })).toBeInTheDocument()
    expect(within(dialog).getByText(/histórico permanecem/)).toBeInTheDocument()

    await usuario.click(within(dialog).getByRole('button', { name: 'Desativar' }))
    await waitFor(() => {
      expect(capturado.payload?.ativo).toBe(false)
    })
    // payload de UMA chave: o endpoint de situação não é um PUT paralelo
    expect(Object.keys(capturado.payload ?? {})).toEqual(['ativo'])
    expect(capturado.verbo).toBe('PATCH')
    // e a versão que viajou é a da PRIMEIRA leitura — a que a tela mostrou
    expect(capturado.versao).toBe(pacienteFicticio().updated_at)
  })

  it('deve desativar um PRÉ-CADASTRADO sem pedir nascimento nem necessidade', async () => {
    // ARRANGE — o caso que o endpoint existe para resolver: pelo PUT-inteiro, a recepção teria de
    // INVENTAR data de nascimento e uma necessidade (dado de saúde de um MENOR) para desfazer um
    // erro de digitação. Aqui o cadastro chega vazio nesses campos, como o balcão o cria.
    const usuario = userEvent.setup()
    const preCadastrado = pacienteFicticio({ nascimento: null, necessidade: null })
    const capturado: { payload?: Record<string, unknown> } = {}
    renderizar('/pacientes/1/editar', {
      handlersExtras: [
        msw.get('/api/pacientes/:id', () => HttpResponse.json(preCadastrado)),
        msw.patch('/api/pacientes/:id/situacao', async ({ request }) => {
          capturado.payload = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({ ...preCadastrado, ativo: false })
        }),
      ],
    })

    // ACT
    await screen.findByDisplayValue('Paciente Fictício Andréa')
    await usuario.click(screen.getByRole('button', { name: 'Desativar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: 'Desativar' }))

    // ASSERT — foi só a situação; nada de nascimento/necessidade inventados no caminho
    await waitFor(() => {
      expect(capturado.payload).toEqual({ ativo: false })
    })
  })

  // "só leitura para quem não pode editar" SAIU: o formulário é edit-only (rota
  // /pacientes/:id/editar, sob pacientes.editar). A LEITURA agora é a ficha
  // (/pacientes/:id), coberta por pagina-ficha-paciente.test.tsx.
})

describe('Edição do paciente — a versão do If-Match é a que está na tela', () => {
  it('deve salvar normalmente DEPOIS de desativar dentro da própria tela de edição', async () => {
    // ARRANGE — o caminho FELIZ, que é o que a recepção faz todo dia: desativar (ou reativar) e
    // salvar em seguida. A troca de situação grava pelo model, então o `updated_at` avança e a
    // tela se re-hidrata com o cadastro novo. Se a versão não acompanhar a re-hidratação, o
    // "Salvar" seguinte leva 409 dizendo "outra pessoa alterou" — mentira, foi a própria
    // recepcionista — e o retry repete o token velho para sempre (rodada 2 do gate, CR3-BLOQ-01).
    const usuario = userEvent.setup()
    const VERSAO_APOS_DESATIVAR = '2026-09-14T09:00:00.000000Z'
    const enviado: { versao?: string | null } = {}
    let desativou = false
    renderizar('/pacientes/1/editar', {
      handlersExtras: [
        msw.get('/api/pacientes/:id', () =>
          HttpResponse.json(
            desativou
              ? pacienteFicticio({ ativo: false, updated_at: VERSAO_APOS_DESATIVAR })
              : pacienteFicticio(),
          ),
        ),
        msw.patch('/api/pacientes/:id/situacao', () => {
          desativou = true
          return HttpResponse.json({ id: 1, ativo: false, updated_at: VERSAO_APOS_DESATIVAR })
        }),
        msw.put('/api/pacientes/:id', ({ request }) => {
          enviado.versao = request.headers.get('If-Match')
          return HttpResponse.json(pacienteFicticio({ ativo: false }))
        }),
      ],
    })

    // ACT
    await screen.findByDisplayValue('Paciente Fictício Andréa')
    await usuario.click(screen.getByRole('button', { name: 'Desativar' }))
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Desativar' }))
    await screen.findByRole('button', { name: 'Reativar' }) // a tela já reflete a troca
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o token é o que a troca de situação devolveu, não o da abertura da tela
    await waitFor(() => {
      expect(enviado.versao).toBe(VERSAO_APOS_DESATIVAR)
    })
  })

  it('NÃO deve salvar com token novo sobre conteúdo velho depois de um 409 na troca de situação', async () => {
    // ARRANGE — o defeito que a rodada dirigida do gate pegou (CR2-BLOQ-01): o 409 da troca de
    // situação invalida o cadastro, a reconsulta avança o `updated_at` do cache, e o formulário
    // NÃO re-hidrata (a trava `iniciado` impede, e deve impedir mesmo). Enquanto o `If-Match` do
    // PUT saía do cache vivo, ele ia com a versão NOVA e o corpo VELHO — o servidor aceitava, e o
    // que a outra recepcionista tinha acabado de mudar era sobrescrito em silêncio.
    const usuario = userEvent.setup()
    let leituras = 0
    const enviado: { versao?: string | null; nome?: string } = {}
    renderizar('/pacientes/1/editar', {
      handlersExtras: [
        msw.get('/api/pacientes/:id', () => {
          leituras += 1
          return HttpResponse.json(
            pacienteFicticio(leituras === 1 ? {} : { updated_at: '2026-09-14T08:00:00.000000Z' }),
          )
        }),
        msw.patch('/api/pacientes/:id/situacao', () =>
          HttpResponse.json({ message: 'conflito' }, { status: 409 }),
        ),
        msw.put('/api/pacientes/:id', async ({ request }) => {
          enviado.versao = request.headers.get('If-Match')
          enviado.nome = ((await request.json()) as { nome: string }).nome
          return HttpResponse.json(pacienteFicticio())
        }),
      ],
    })

    // ACT — leva um 409 ao desativar, desiste, edita o nome e salva
    const campoNome = await screen.findByDisplayValue('Paciente Fictício Andréa')
    await usuario.click(screen.getByRole('button', { name: 'Desativar' }))
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Desativar' }))
    await waitFor(() => {
      expect(leituras).toBeGreaterThanOrEqual(2) // a invalidação do conflito reconsultou
    })
    await usuario.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }))
    await usuario.clear(campoNome)
    await usuario.type(campoNome, 'Paciente Fictício Editado')
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o token é o da versão que a tela mostrou, e ele viaja junto do corpo que a tela tem
    await waitFor(() => {
      expect(enviado.nome).toBe('Paciente Fictício Editado')
    })
    expect(enviado.versao).toBe(pacienteFicticio().updated_at)
  })
})
