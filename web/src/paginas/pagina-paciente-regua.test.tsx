import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaPaciente } from '@/paginas/pagina-paciente'
import { useAuthStore } from '@/stores/auth-store'
import { handlersDeCadastros, pacienteFicticio, reguaFicticia } from '@/test/dados-cadastros'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

/**
 * O FORMULÁRIO DE PACIENTE LÊ A RÉGUA (change campos-do-cadastro-configuraveis, grupo 5).
 *
 * O que estes testes protegem: a tela não mantém a própria lista de campos obrigatórios.
 * Se ela voltar a manter, dois defeitos nascem juntos — a marca de obrigatório para de
 * corresponder ao que o servidor exige (asterisco que não recusa, recusa sem asterisco), e
 * o campo escondido volta a viajar no payload, onde o servidor o recusa com um 422 que a
 * tela não tem onde mostrar.
 *
 * Dados 100% FICTÍCIOS (LGPD).
 */

expect.extend(toHaveNoViolations)

function renderizar(regua = reguaFicticia()) {
  servidor.use(
    msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(regua)),
    ...handlersDeCadastros(),
  )
  useAuthStore.setState({
    usuario: {
      ...usuarioFicticio,
      permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'],
    },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/pacientes/novo']}>
          <Routes>
            <Route path="/pacientes/novo" element={<PaginaPaciente />} />
            <Route path="/pacientes/:id" element={<div>Ficha do paciente</div>} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** O mesmo shell, mas com a RÉGUA em erro — o handler que falha entra por último. */
function renderizarComReguaEmErro() {
  // o handler que falha vem PRIMEIRO: dentro de um `use()` vence o primeiro que casa
  servidor.use(
    msw.get('/api/campos-cadastro/:formulario', () => new HttpResponse(null, { status: 500 })),
    ...handlersDeCadastros(),
  )
  useAuthStore.setState({
    usuario: {
      ...usuarioFicticio,
      permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'],
    },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/pacientes/novo']}>
          <Routes>
            <Route path="/pacientes/novo" element={<PaginaPaciente />} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** O mesmo shell, mas na rota de EDIÇÃO — o cadastro já existe e vem do servidor. */
function renderizarEdicao() {
  useAuthStore.setState({
    usuario: {
      ...usuarioFicticio,
      permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'],
    },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/pacientes/7/editar']}>
          <Routes>
            <Route path="/pacientes/:id/editar" element={<PaginaPaciente />} />
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

describe('Formulário de paciente — a régua da clínica manda', () => {
  it('deve tirar do DOM o campo que a clínica escondeu', async () => {
    // ARRANGE + ACT
    renderizar(reguaFicticia({ estado_civil: { desabilitado: true } }))

    // ASSERT — o vizinho de seção continua lá; só o escondido some
    const outros = await screen.findByRole('group', { name: 'Outros' })
    expect(within(outros).queryByLabelText(/Estado civil/)).not.toBeInTheDocument()
    expect(within(outros).getByLabelText(/Profissão/)).toBeInTheDocument()
  })

  it('deve marcar como obrigatório o que a clínica exige, e só isso', async () => {
    // ARRANGE — é assim que a clínica de referência opera: sexo opcional, cidade exigida
    renderizar(
      reguaFicticia({
        sexo: { obrigatorio: false },
        endereco_cidade: { obrigatorio: true },
      }),
    )

    // ACT
    const identificacao = await screen.findByRole('group', {
      name: 'Identificação',
    })
    const endereco = screen.getByRole('group', { name: 'Endereço' })

    // ASSERT
    expect(within(identificacao).getByLabelText(/^Sexo$/)).toBeInTheDocument()
    expect(within(identificacao).queryByLabelText(/^Sexo \(obrigatório\)/)).not.toBeInTheDocument()
    expect(within(endereco).getByLabelText(/^Cidade \(obrigatório\)/)).toBeInTheDocument()
  })

  it('NÃO deve renderizar a seção que ficou sem nenhum campo visível', async () => {
    // ARRANGE — cabeçalho sozinho é ruído: a clínica que escondeu tudo não quer a seção
    renderizar(
      reguaFicticia({
        estado_civil: { desabilitado: true },
        profissao: { desabilitado: true },
        obs: { desabilitado: true },
      }),
    )

    // ACT / ASSERT
    await screen.findByRole('group', { name: 'Identificação' })
    expect(screen.queryByRole('group', { name: 'Outros' })).not.toBeInTheDocument()
  })

  it('deve OMITIR do payload a chave do campo escondido — nunca mandá-la nula', async () => {
    // ARRANGE — o servidor usa `missing`, que recusa a PRESENÇA da chave com qualquer
    // valor. Mandar `null` seria 422 num campo que a tela nem mostra.
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null

    renderizar(
      reguaFicticia({
        estado_civil: { desabilitado: true },
        endereco_complemento: { desabilitado: true },
      }),
    )
    servidor.use(
      msw.post('/api/pacientes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(pacienteFicticio(), { status: 201 })
      }),
    )

    // ACT
    const identificacao = await screen.findByRole('group', {
      name: 'Identificação',
    })
    await usuario.type(
      within(identificacao).getByLabelText(/^Nome \(obrigatório\)/),
      'Paciente Fictício Adulto',
    )
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')
    await usuario.type(screen.getByLabelText(/^Bairro/), 'Centro')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    const payload = enviado as unknown as Record<string, unknown>
    expect(Object.keys(payload)).not.toContain('estado_civil')
    expect(Object.keys(payload)).toContain('profissao')
    // e o escondido de DENTRO do endereço também não viaja
    expect(Object.keys(payload.endereco_json as Record<string, unknown>)).not.toContain('complemento')
    expect(Object.keys(payload.endereco_json as Record<string, unknown>)).toContain('bairro')
  })

  it('deve tirar do formulário as SEÇÕES DE LISTA que a clínica escondeu', async () => {
    // ARRANGE — enquanto elas ficaram de fora da régua, a seção continuava na tela, a
    // recepção digitava o telefone e o payload descartava a chave em silêncio, com o toast
    // dizendo "salvo". Três frentes do gate acharam isto pelo mesmo caminho.
    renderizar(reguaFicticia({ contatos_json: { desabilitado: true } }))

    // ACT / ASSERT
    await screen.findByRole('group', { name: 'Identificação' })
    expect(screen.queryByRole('group', { name: 'Contatos' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Responsáveis' })).toBeInTheDocument()
  })

  it('deve dizer que a clínica exige a lista, antes de o servidor recusar', async () => {
    // ARRANGE — a marca de obrigatório também vem do servidor nas listas
    renderizar(reguaFicticia({ responsaveis_json: { obrigatorio: true } }))

    // ACT
    const responsaveis = await screen.findByRole('group', { name: 'Responsáveis' })

    // ASSERT
    expect(responsaveis).toHaveTextContent(/exige pelo menos um responsável/i)
  })

  it('deve PRESERVAR o subcampo de endereço escondido ao editar uma ficha que o tinha', async () => {
    // ARRANGE — o caso em que a guarda de omissão é load-bearing de verdade: na CRIAÇÃO o
    // campo vazio já sairia pelo filtro `valor !== ''`; é na EDIÇÃO, com o valor vindo do
    // servidor, que só o `!oculto(...)` impede a chave de viajar (achado CR-I8)
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null

    servidor.use(
      msw.get('/api/campos-cadastro/:formulario', () =>
        HttpResponse.json(reguaFicticia({ endereco_complemento: { desabilitado: true } })),
      ),
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json(
          pacienteFicticio({
            id: 7,
            endereco_json: { cidade: 'Lages', complemento: 'Apto 12', bairro: 'Centro' },
          }),
        ),
      ),
      msw.put('/api/pacientes/:id', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(pacienteFicticio({ id: 7 }))
      }),
      ...handlersDeCadastros(),
    )
    renderizarEdicao()

    // ACT
    await screen.findByRole('group', { name: 'Identificação' })
    await usuario.click(screen.getByRole('button', { name: 'Salvar' }))

    // ASSERT — o complemento estava no cadastro e NÃO viaja; o resto do endereço, sim
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    const endereco = (enviado as unknown as { endereco_json: Record<string, unknown> }).endereco_json
    expect(Object.keys(endereco)).not.toContain('complemento')
    expect(Object.keys(endereco)).toContain('cidade')
  })

  it('NÃO deve mostrar identificador de máquina quando a clínica esconde um campo', async () => {
    // ARRANGE — o slug do catálogo (`endereco_complemento`) nunca chega à tela; a régua
    // traz o rótulo em português, e é ele que aparece
    renderizar(reguaFicticia({ endereco_complemento: { desabilitado: true } }))

    // ACT
    const endereco = await screen.findByRole('group', { name: 'Endereço' })

    // ASSERT
    expect(endereco.textContent ?? '').not.toContain('endereco_')
    expect(endereco.textContent ?? '').not.toContain('_json')
    expect(within(endereco).getByLabelText(/^Bairro/)).toBeInTheDocument()
  })
  it('NÃO deve tirar o botão de enviar do foco enquanto a gravação está em voo', async () => {
    /*
     * ARRANGE — achado N2 do passe de navegador de 25/08. O botão usava a prop
     * `carregando` do `Botao`, que liga o `disabled` NATIVO; o navegador então tira o
     * botão da ordem de tabulação e o foco cai em `<body>`. Medido ao vivo: depois de uma
     * recusa 422, um Tab caía no TOAST, e o operador recomeçava de um formulário com ~25
     * paradas. A régua do cadastro já usa `aria-disabled` pelo mesmo motivo.
     */
    const usuario = userEvent.setup()
    let liberar = (): void => {}
    const emVoo = new Promise<void>((resolve) => {
      liberar = resolve
    })

    renderizar()
    servidor.use(
      msw.post('/api/pacientes', async () => {
        await emVoo
        return HttpResponse.json(pacienteFicticio(), { status: 201 })
      }),
    )

    // ACT
    const identificacao = await screen.findByRole('group', { name: 'Identificação' })
    await usuario.type(
      within(identificacao).getByLabelText(/^Nome \(obrigatório\)/),
      'Paciente Fictício Adulto',
    )
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')

    const enviar = screen.getByRole('button', { name: 'Cadastrar' })
    await usuario.click(enviar)

    // ASSERT — em voo: inerte pelo ARIA, mas AINDA focável e AINDA focado
    await waitFor(() => {
      expect(enviar).toHaveAttribute('aria-busy', 'true')
    })
    expect(enviar).not.toBeDisabled()
    expect(enviar).toHaveAttribute('aria-disabled', 'true')
    expect(document.activeElement).toBe(enviar)

    liberar()
  })

  it('NÃO deve gravar duas vezes quando o botão é acionado durante o voo', async () => {
    // ARRANGE — `aria-disabled` não impede submit; quem recusa o segundo envio é a guarda
    const usuario = userEvent.setup()
    let chamadas = 0
    let liberar = (): void => {}
    const emVoo = new Promise<void>((resolve) => {
      liberar = resolve
    })

    renderizar()
    servidor.use(
      msw.post('/api/pacientes', async () => {
        chamadas += 1
        await emVoo
        return HttpResponse.json(pacienteFicticio(), { status: 201 })
      }),
    )

    // ACT
    const identificacao = await screen.findByRole('group', { name: 'Identificação' })
    await usuario.type(
      within(identificacao).getByLabelText(/^Nome \(obrigatório\)/),
      'Paciente Fictício Adulto',
    )
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')

    const enviar = screen.getByRole('button', { name: 'Cadastrar' })
    await usuario.click(enviar)
    await waitFor(() => {
      expect(enviar).toHaveAttribute('aria-busy', 'true')
    })
    await usuario.click(enviar)

    // ASSERT
    expect(chamadas).toBe(1)

    liberar()
  })
})

/**
 * O GATE AUTOMATIZADO do formulário (condição C1 do parecer de a11y da rodada 3).
 *
 * A régua apertada é o estado que esta change inventou: uma seção inteira desmontada e
 * outra exigida. É onde um `aria-describedby` órfão ou um `<fieldset>` sem `<legend>`
 * nasceria — e é o estado que o passe manual só consegue olhar uma vez.
 */
describe('Formulário de paciente — gate automatizado de acessibilidade', () => {
  it('deve passar no axe com a régua APERTADA', async () => {
    // ARRANGE / ACT — Contatos escondido, Responsáveis exigido
    const { container } = renderizar(
      reguaFicticia({
        contatos_json: { desabilitado: true },
        responsaveis_json: { obrigatorio: true },
      }),
    )
    await screen.findByRole('group', { name: 'Identificação' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe no estado de ERRO da régua', async () => {
    // ARRANGE / ACT — sem a régua a tela não pode desenhar o formulário
    const { container } = renderizarComReguaEmErro()
    await screen.findByRole('button', { name: /Tentar novamente/i }, { timeout: 5000 })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Formulário de paciente — a régua em ERRO bloqueia a tela', () => {
  it('NÃO deve abrir o formulário quando a régua não carrega', async () => {
    /*
     * ARRANGE — achado N4 do passe de navegador de 25/08. `carregando` é `isPending`, que
     * vira `false` no erro; o mapa fica vazio, `visivel()` devolve `true` para tudo e
     * `obrigatorio()` devolve `false` para tudo. Medido antes do fix: as 6 seções na tela,
     * os 7 campos de Identificação, e ZERO marcas de "(obrigatório)" — nem no `nome`, que o
     * catálogo trava como obrigatório e o servidor sempre recusa vazio.
     */

    // ACT
    renderizarComReguaEmErro()
    await screen.findByRole('button', { name: /Tentar novamente/i }, { timeout: 5000 })

    // ASSERT — a tela para, em vez de pedir a coisa errada
    expect(screen.queryByRole('group', { name: 'Identificação' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Nome/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cadastrar' })).not.toBeInTheDocument()
  })
})

/**
 * A SEÇÃO DE CONVÊNIO (change convenio-no-cadastro-do-paciente).
 *
 * O convênio já existia — no tratamento —, e a recepção precisava abrir um pacote para
 * descobrir de que plano a família é. Aqui está o valor de HOJE.
 */
describe('PaginaPaciente — a seção de convênio', () => {
  it('deve escolher o convênio entre os ATIVOS da clínica, sem oferecer criar um novo', async () => {
    // ARRANGE — criar convênio é cadastro de apoio e tem tela própria
    renderizar()

    // ACT
    const escolha = await screen.findByLabelText('Convênio')

    // ASSERT — o desativado não entra, e não há atalho de criação
    const rotulos = [...escolha.querySelectorAll('option')].map((o) => o.textContent)
    expect(rotulos).toEqual(['Sem convênio', 'Convênio Fictício A', 'Particular Fictício'])
    expect(screen.queryByRole('button', { name: /novo convênio/i })).not.toBeInTheDocument()
  })

  it('NÃO deve virar cabeçalho vazio na clínica que só atende particular', async () => {
    /*
     * ARRANGE — os quatro campos escondidos pela régua. Sem a guarda de seção, sobra a
     * legenda "Convênio" pairando sobre nada, no cadastro de TODA criança.
     */
    renderizar(
      reguaFicticia({
        convenio_id: { desabilitado: true },
        plano: { desabilitado: true },
        carteirinha: { desabilitado: true },
        carteirinha_validade: { desabilitado: true },
      }),
    )

    // ACT
    await screen.findByLabelText('CPF')

    // ASSERT
    expect(screen.queryByText('Convênio')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Carteirinha')).not.toBeInTheDocument()
  })

  it('deve OMITIR do payload TODOS os campos de convênio escondidos', async () => {
    /*
     * ARRANGE — sem a entrada no mapa payload → campo do catálogo, as duas metades
     * discordam: a régua tira o campo da TELA e a chave continua viajando. O servidor usa
     * `missing`, que recusa a PRESENÇA da chave com qualquer valor — 422 num campo que a
     * recepção nem vê.
     *
     * Os QUATRO escondidos de uma vez, de propósito. A primeira versão desta célula
     * escondia só a carteirinha, e a mutação que apagava `convenio_id` do mapa SOBREVIVIA:
     * campo visível viaja de qualquer jeito, então esconder um só prova um só. Cada campo
     * configurável precisa da sua entrada, e é o cenário "tudo escondido" que cobra as
     * quatro.
     */
    const usuario = userEvent.setup()
    let enviado: Record<string, unknown> | null = null

    renderizar(
      reguaFicticia({
        convenio_id: { desabilitado: true },
        plano: { desabilitado: true },
        carteirinha: { desabilitado: true },
        carteirinha_validade: { desabilitado: true },
      }),
    )
    servidor.use(
      msw.post('/api/pacientes', async ({ request }) => {
        enviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(pacienteFicticio(), { status: 201 })
      }),
    )

    // ACT
    const identificacao = await screen.findByRole('group', { name: 'Identificação' })
    await usuario.type(
      within(identificacao).getByLabelText(/^Nome \(obrigatório\)/),
      'Paciente Fictício Adulto',
    )
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — nenhuma das quatro chaves viaja; o que está visível continua indo
    await waitFor(() => {
      expect(enviado).not.toBeNull()
    })
    const chaves = Object.keys(enviado as unknown as Record<string, unknown>)
    expect(chaves).not.toContain('convenio_id')
    expect(chaves).not.toContain('plano')
    expect(chaves).not.toContain('carteirinha')
    expect(chaves).not.toContain('carteirinha_validade')
    expect(chaves).toContain('indicacao')
  })

  it('deve deixar claro que o convênio do cadastro é o ATUAL, não o do pacote', async () => {
    /*
     * ARRANGE — os dois convênios convivem na mesma criança e podem divergir sem que
     * nenhum esteja errado. Rotulados igual, a recepção lê a divergência como defeito e
     * vai "consertar" o histórico — que é justamente o que não pode acontecer (design D2).
     */
    renderizar()

    // ACT
    await screen.findByLabelText('Convênio')

    // ASSERT — a seção diz o que é, e diz que trocar aqui não mexe nos pacotes
    expect(screen.getByText(/trocar aqui não altera os pacotes já abertos/i)).toBeInTheDocument()
  })

  it('deve levar a recusa do convênio AO CAMPO, não a um aviso solto', async () => {
    /*
     * ARRANGE — 422 sem lugar para pousar é a classe de defeito que esta cadeia de changes
     * vem fechando: a recepção lê "erro ao salvar" e não sabe o que corrigir. O servidor
     * recusa convênio inexistente com 422 no campo `convenio_id` (D6).
     */
    const usuario = userEvent.setup()
    renderizar()
    servidor.use(
      msw.post('/api/pacientes', () =>
        HttpResponse.json(
          { message: 'Dados inválidos.', errors: { convenio_id: ['O convênio selecionado é inválido.'] } },
          { status: 422 },
        ),
      ),
    )

    // ACT
    const identificacao = await screen.findByRole('group', { name: 'Identificação' })
    await usuario.type(
      within(identificacao).getByLabelText(/^Nome \(obrigatório\)/),
      'Paciente Fictício Adulto',
    )
    await usuario.type(screen.getByLabelText(/Nascimento/), '1990-01-01')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — a mensagem aparece dentro da SEÇÃO de convênio, junto do campo
    const convenio = await screen.findByRole('group', { name: 'Convênio' })
    await waitFor(() => {
      expect(within(convenio).getByText('O convênio selecionado é inválido.')).toBeInTheDocument()
    })
  })

  it('deve passar no axe com a seção de convênio VISÍVEL e ESCONDIDA', async () => {
    // ARRANGE / ACT — visível
    const comSecao = renderizar()
    await screen.findByLabelText('Convênio')

    // ASSERT
    expect(await axe(comSecao.container)).toHaveNoViolations()
    comSecao.unmount()

    // ARRANGE / ACT — escondida: a árvore de cabeçalhos muda, e é onde cabeçalho órfão nasce
    const semSecao = renderizar(
      reguaFicticia({
        convenio_id: { desabilitado: true },
        plano: { desabilitado: true },
        carteirinha: { desabilitado: true },
        carteirinha_validade: { desabilitado: true },
      }),
    )
    await screen.findByLabelText('CPF')

    // ASSERT
    expect(await axe(semSecao.container)).toHaveNoViolations()
  })
})

/**
 * O RASCUNHO DA FILA DE CONFERÊNCIA (change `cadastro-online-do-paciente`).
 *
 * Aceitar um cadastro recebido consome o envio no servidor e navega para cá com o preenchimento
 * no `state`. Se esta tela não o ler, o aceite abre um formulário EM BRANCO com a fila já
 * esvaziada: a família preencheu, a recepção clicou, e o dado sumiu da tela.
 */
function renderizarComRascunho(preenchido: Record<string, unknown>) {
  servidor.use(
    msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(reguaFicticia())),
    ...handlersDeCadastros(),
  )
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'] },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[{ pathname: '/pacientes/novo', state: { preenchido, envio: 7 } }]}>
          <Routes>
            <Route path="/pacientes/novo" element={<PaginaPaciente />} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('Formulário de paciente — o rascunho do cadastro recebido', () => {
  it('deve ABRIR PREENCHIDO com o que a família enviou', async () => {
    // ARRANGE — o payload chega com os nomes de campo do catálogo, incluindo as listas
    renderizarComRascunho({
      nome: 'Criança Fictícia Recebida',
      nascimento: '2018-03-15',
      sexo: 'feminino',
      cpf: '39053344705',
      responsaveis_json: [{ nome: 'Adulto Fictício', parentesco: 'Mãe', telefone: '48999997777' }],
      contatos_json: [{ tipo: 'celular', valor: '48999998888' }],
    })

    // ACT + ASSERT — o texto, a data, a enumeração e os itens das duas listas
    expect(await screen.findByDisplayValue('Criança Fictícia Recebida')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2018-03-15')).toBeInTheDocument()
    expect(screen.getByDisplayValue('390.533.447-05')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Adulto Fictício')).toBeInTheDocument()
    expect(screen.getByDisplayValue('48999998888')).toBeInTheDocument()
  })

  it('NÃO deve copiar do rascunho uma enumeração que a tela não conhece', async () => {
    // ARRANGE — o `select` ficaria sem opção correspondente, e o campo apareceria vazio
    // sem que ninguém tivesse escolhido nada
    renderizarComRascunho({ nome: 'Criança Fictícia Recebida', sexo: 'inventado', necessidade: 'inventada' })

    // ACT + ASSERT — cai no padrão do formulário novo
    await screen.findByDisplayValue('Criança Fictícia Recebida')
    expect(screen.getByRole('combobox', { name: /Sexo/ })).toHaveValue('nao_informado')
  })

  it('deve APAGAR o rascunho do histórico do navegador', async () => {
    // ARRANGE — o `state` do React Router vive em `window.history.state.usr`: ele sobrevive ao
    // F5, ao Voltar e ao logout (que limpa cache e store, não o histórico). O balcão é máquina
    // compartilhada e o dado é o cadastro de uma criança.
    //
    // `BrowserRouter`, e não `MemoryRouter`: o histórico de mentira não guarda nada, então o
    // teste passaria com o conserto removido — foi o que aconteceu na primeira versão dele
    servidor.use(
      msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(reguaFicticia())),
      ...handlersDeCadastros(),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'] },
      carregandoSessao: false,
    })
    window.history.pushState({ usr: { preenchido: { nome: 'Criança Fictícia Recebida', cpf: '39053344705' } } }, '', '/pacientes/novo')
    expect((window.history.state as { usr?: unknown }).usr).toBeDefined()

    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <BrowserRouter>
            <Routes>
              <Route path="/pacientes/novo" element={<PaginaPaciente />} />
            </Routes>
          </BrowserRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ACT — o formulário absorve o rascunho
    expect(await screen.findByDisplayValue('Criança Fictícia Recebida')).toBeInTheDocument()

    // ASSERT — e o histórico não guarda mais nada dele
    await waitFor(() => {
      expect((window.history.state as { usr?: unknown } | null)?.usr ?? null).toBeNull()
    })
  })

  it('deve SOBREVIVER a um F5 depois de aceitar', async () => {
    // ARRANGE — aceitar CONSOME o envio: ele sai da fila e não há como relê-lo. Tirar o rascunho
    // do histórico (que era o conserto do dado de criança na máquina compartilhada) fez um F5
    // destruir o preenchimento da família para sempre (CR2-06). O guardado da aba resolve os dois
    servidor.use(
      msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(reguaFicticia())),
      ...handlersDeCadastros(),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'] },
      carregandoSessao: false,
    })
    // o SERVIDOR é quem guarda o rascunho — o navegador do balcão não guarda nada
    servidor.use(
      msw.get('/api/cadastro-online/fila/7/rascunho', () =>
        HttpResponse.json({ id: 7, dados: { nome: 'Criança Fictícia Recarregada' } }),
      ),
    )

    // ACT — a página abrindo DO ZERO, só com o id do envio no endereço: é o F5
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={['/pacientes/novo?envio=7']}>
            <Routes>
              <Route path="/pacientes/novo" element={<PaginaPaciente />} />
            </Routes>
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ASSERT
    expect(await screen.findByDisplayValue('Criança Fictícia Recarregada')).toBeInTheDocument()
  })

  it('NÃO deve buscar o rascunho quando o preenchimento JÁ veio da fila', async () => {
    // ARRANGE — no caminho do aceite o formulário já nasce preenchido. A consulta disparava
    // mesmo assim, porque a condição olhava o `state` — que é APAGADO de propósito logo em
    // seguida — e a resposta trocava o formulário inteiro pelo payload cru da família (CR3-01)
    const chamadas: string[] = []
    // `once`-like: o ouvinte é removido no fim do teste — sem isso ele sobrevive e se acumula
    const ouvir = ({ request }: { request: Request }) => { chamadas.push(new URL(request.url).pathname) }
    servidor.events.on('request:start', ouvir)

    // ACT
    renderizarComRascunho({ nome: 'Criança Fictícia Recebida' })
    await screen.findByDisplayValue('Criança Fictícia Recebida')

    // ASSERT
    await waitFor(() => {
      expect(chamadas.some((c) => c.includes('rascunho'))).toBe(false)
    })
    servidor.events.removeListener('request:start', ouvir)
  })

  it('NÃO deve abrir o formulário editável enquanto a releitura está em voo', async () => {
    // ARRANGE — é a conferência que a fila existe para provocar: a recepção corrige o que a
    // família digitou errado. Uma hidratação tardia devolvia o valor da família por cima.
    //
    // A primeira versão deste teste digitava e esperava com `waitFor` — que roda a checagem na
    // primeira vez, ANTES de a resposta chegar, e uma asserção já verdadeira resolve na hora. Ele
    // passava com o defeito de pé (rodada 4). Agora a prova é a AUSÊNCIA do campo durante o voo
    let liberar = () => {}
    const emVoo = new Promise<void>((resolve) => { liberar = resolve })
    let reguaChegou = false
    servidor.use(
      msw.get('/api/campos-cadastro/:formulario', () => {
        reguaChegou = true
        return HttpResponse.json(reguaFicticia())
      }),
      ...handlersDeCadastros(),
      msw.get('/api/cadastro-online/fila/7/rascunho', async () => {
        await emVoo
        return HttpResponse.json({ id: 7, dados: { nome: 'Nome Que A Família Digitou' } })
      }),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'] },
      carregandoSessao: false,
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={['/pacientes/novo?envio=7']}>
            <Routes>
              <Route path="/pacientes/novo" element={<PaginaPaciente />} />
            </Routes>
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    /*
      ACT — espera pelo SINAL, não pelo relógio.

      A ausência do campo só prova o portão do rascunho se a régua JÁ tiver chegado; enquanto ela
      carrega, o campo está ausente por outra causa. A primeira versão esperava 150 ms — e num
      computador mais lento, ou com a régua demorando, ela passava com o portão REMOVIDO. Oráculo
      por tempo é prova na condição errada (rodada 5).
    */
    await waitFor(() => { expect(reguaChegou).toBe(true) })

    // o formulário NÃO pode estar editável enquanto a releitura está em voo: era por essa janela
    // que a resposta apagava a digitação
    expect(screen.queryByLabelText(/^Nome \(obrigatório\)/)).not.toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    liberar()

    // ASSERT — o campo só aparece DEPOIS, já com o que a família mandou, e aí a recepção corrige
    // sem risco de ser sobrescrita
    const nome = await screen.findByLabelText(/^Nome \(obrigatório\)/)
    expect(nome).toHaveValue('Nome Que A Família Digitou')

    await userEvent.clear(nome)
    await userEvent.type(nome, 'Nome Corrigido No Balcão')

    expect(screen.getByLabelText(/^Nome \(obrigatório\)/)).toHaveValue('Nome Corrigido No Balcão')
  })

  it('deve AVISAR quando o rascunho não volta, em vez de abrir em branco calado', async () => {
    // ARRANGE — sem aviso, a recepção conclui que o cadastro veio vazio e digita tudo de novo,
    // sem saber que o que a família mandou continua no servidor
    servidor.use(
      msw.get('/api/campos-cadastro/:formulario', () => HttpResponse.json(reguaFicticia())),
      ...handlersDeCadastros(),
      msw.get('/api/cadastro-online/fila/7/rascunho', () => new HttpResponse(null, { status: 404 })),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['pacientes.ver', 'pacientes.criar', 'pacientes.editar'] },
      carregandoSessao: false,
    })

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={['/pacientes/novo?envio=7']}>
            <Routes>
              <Route path="/pacientes/novo" element={<PaginaPaciente />} />
            </Routes>
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )

    // ASSERT — o aviso aparece E o formulário continua na tela: cadastrar do zero é uma saída
    // legítima, e substituir a página deixava a recepção com um botão só, que refaz a mesma falha
    // por PAPEL, não por texto: a asserção tinha sido rebaixada para `findByText` no mesmo diff
    // que calou a mensagem, e a regressão passou pelo teste que a guardava
    expect(await screen.findByRole('status', { name: 'Atenção' })).toHaveTextContent(/não foi possível recuperar/i)
    expect(screen.getByLabelText(/^Nome \(obrigatório\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeInTheDocument()
  })

  it('NÃO deve buscar rascunho nenhum quando o endereço não traz envio', async () => {
    // ARRANGE — o par de controle: o cadastro de balcão não pode consultar a fila
    const chamadas: string[] = []
    // `once`-like: o ouvinte é removido no fim do teste — sem isso ele sobrevive e se acumula
    const ouvir = ({ request }: { request: Request }) => { chamadas.push(new URL(request.url).pathname) }
    servidor.events.on('request:start', ouvir)

    // ACT
    renderizar()
    await screen.findByLabelText(/^Nome \(obrigatório\)/)

    // ASSERT
    expect(chamadas.some((c) => c.includes('rascunho'))).toBe(false)
    servidor.events.removeListener('request:start', ouvir)
  })

  it('deve MANDAR o vínculo com o envio ao salvar a ficha', async () => {
    // ARRANGE — é a única costura entre a tela e as duas colunas de origem, e ela não tinha
    // teste nenhum: apagar a linha deixava a suíte web inteira verde (CR2-04/SEC-CO-47). O
    // caminho de exclusão da LGPD para toda criança vinda do link depende dela
    const corpos: unknown[] = []
    renderizarComRascunho({ nome: 'Criança Fictícia Recebida', nascimento: '1980-03-15' })
    await screen.findByDisplayValue('Criança Fictícia Recebida')
    // DEPOIS do render: o `use` do MSW empilha por cima, e o helper registra os dele ao montar
    servidor.use(
      msw.post('/api/pacientes', async ({ request }) => {
        corpos.push(await request.json())
        return HttpResponse.json({ id: 42 }, { status: 201 })
      }),
    )

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => { expect(corpos).toHaveLength(1) })
    expect((corpos[0] as { envio_de_cadastro_id?: number }).envio_de_cadastro_id).toBe(7)
  })

  it('NÃO deve mandar vínculo nenhum no cadastro de balcão', async () => {
    // ARRANGE — o par de controle: carimbar origem numa ficha digitada no balcão seria mentira
    // na trilha, e faria o expurgo poupar o conteúdo de um envio que não existe
    const corpos: unknown[] = []
    renderizar()
    await userEvent.type(await screen.findByLabelText(/^Nome \(obrigatório\)/), 'Adulto Fictício')
    await userEvent.type(screen.getByLabelText(/Nascimento/), '1980-03-15')
    servidor.use(
      msw.post('/api/pacientes', async ({ request }) => {
        corpos.push(await request.json())
        return HttpResponse.json({ id: 43 }, { status: 201 })
      }),
    )

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => { expect(corpos).toHaveLength(1) })
    expect(corpos[0]).not.toHaveProperty('envio_de_cadastro_id')
  })

  it('deve abrir VAZIO quando não veio rascunho nenhum', async () => {
    // ARRANGE — o caminho normal de "novo paciente" não pode herdar nada
    renderizar()

    // ACT + ASSERT
    expect(await screen.findByLabelText(/^Nome \(obrigatório\)/)).toHaveValue('')
  })
})
