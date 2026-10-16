import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { expect, it } from 'vitest'

import App from './app'
import { PERMISSOES_DO_VINCULO_EM_LOTE } from './lib/catalogos'
import { queryClient } from './lib/query-client'
import { handlersDaAgenda } from './test/dados-agenda'
import { painelDaEquipeFicticio, paineisQueAnotam, periodoFicticio } from './test/dados-paineis'
import { servidor, usuarioFicticio } from './test/servidor-msw'

function renderizarEm(rota: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[rota]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Sessão ativa com as permissões pedidas + catálogos da agenda no ar. */
function comSessao(permissoes: string[] = ['agenda.ver']) {
  const usuario = { ...usuarioFicticio, permissoes }
  servidor.use(
    msw.get('/api/me', () => HttpResponse.json(usuario)),
    msw.post('/api/login', () => HttpResponse.json(usuario)),
    ...handlersDaAgenda(),
  )
}

it('deve redirecionar para o login quando não autenticado', async () => {
  // ARRANGE + ACT — /api/me responde 401 (default do servidor MSW)
  renderizarEm('/')

  // ASSERT
  expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument()
})

it('deve completar o fluxo de login e abrir a agenda', async () => {
  // ARRANGE
  const usuaria = userEvent.setup()
  comSessao()
  renderizarEm('/login')

  // ACT
  await usuaria.type(await screen.findByLabelText('E-mail'), usuarioFicticio.email)
  await usuaria.type(screen.getByLabelText('Senha'), 'senha-de-teste-123')
  await usuaria.click(screen.getByRole('button', { name: 'Entrar' }))

  // ASSERT — a raiz leva à agenda, dentro do shell
  expect(await screen.findByRole('heading', { name: 'Agenda' })).toBeInTheDocument()
  expect(screen.getByText(usuarioFicticio.nome)).toBeInTheDocument()
})

it('deve mostrar erro genérico com credenciais inválidas', async () => {
  // ARRANGE
  const usuaria = userEvent.setup()
  renderizarEm('/login')

  // ACT
  await usuaria.type(await screen.findByLabelText('E-mail'), usuarioFicticio.email)
  await usuaria.type(screen.getByLabelText('Senha'), 'senha-errada')
  await usuaria.click(screen.getByRole('button', { name: 'Entrar' }))

  // ASSERT
  expect(await screen.findByRole('alert')).toHaveTextContent('Credenciais inválidas.')
})

it('deve abrir a agenda na raiz para quem tem a permissão', async () => {
  // ARRANGE
  comSessao(['agenda.ver'])

  // ACT
  renderizarEm('/')

  // ASSERT
  expect(await screen.findByRole('heading', { name: 'Agenda' })).toBeInTheDocument()
})

it('deve mostrar acesso negado a quem entra em /termos sem a permissão', async () => {
  // ARRANGE — o termo é o CONTRATO da clínica: quem não administra o módulo não abre a
  // tela pela URL, ainda que a afordância já esteja escondida no hub de cadastros
  comSessao(['pacientes.ver'])

  // ACT
  renderizarEm('/termos')

  // ASSERT
  expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('deve mostrar acesso negado a quem entra em /funcionarios sem funcionarios.ver', async () => {
  // ARRANGE — pode ver fornecedores, não funcionários: o cartão some E a URL digitada não abre
  comSessao(['fornecedores.ver'])

  // ACT
  renderizarEm('/funcionarios')

  // ASSERT
  expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Funcionários' })).not.toBeInTheDocument()
})

it('deve mostrar acesso negado a quem entra em /fornecedores sem fornecedores.ver', async () => {
  // ARRANGE — o espelho do caso acima (CR-CDD-05): pode ver funcionários, não fornecedores. Sem
  // este teste, a rota exigindo `funcionarios.ver` no lugar de `fornecedores.ver` passava verde
  comSessao(['funcionarios.ver'])

  // ACT
  renderizarEm('/fornecedores')

  // ASSERT
  expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Fornecedores' })).not.toBeInTheDocument()
})

it('deve mostrar acesso negado a quem entra na agenda sem a permissão', async () => {
  // ARRANGE — sessão ativa SEM agenda.ver (a URL digitada à mão não vira acesso)
  comSessao(['pacientes.ver'])

  // ACT
  renderizarEm('/agenda')

  // ASSERT — a tela nega e nenhuma consulta do módulo é exibida
  expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

/**
 * A ROTA PÚBLICA NÃO CUMPRIMENTA O SERVIDOR AUTENTICADO (change `cadastro-online-do-paciente`).
 *
 * `GET /api/me` está no grupo `api`, que é stateful: cada família que abrisse o link no celular
 * ganharia um cookie de sessão do sistema clínico e uma linha na tabela `sessions` — num endereço
 * que a clínica divulga por WhatsApp. A separação que o `routes/publico.php` faz no servidor era
 * desfeita por um `useEffect` no `App`.
 *
 * O teste monta o `App` DE VERDADE. Montar só a página provaria a página, não a rota — foi essa a
 * prova na condição errada que deixou o defeito passar (parecer PÓS-código, SEC-CO-31).
 */
function gravarChamadas(): string[] {
  const chamadas: string[] = []

  servidor.events.on('request:start', ({ request }) => {
    chamadas.push(new URL(request.url).pathname)
  })

  return chamadas
}

it('NÃO deve chamar /api/me na rota do cadastro público', async () => {
  // ARRANGE
  const chamadas = gravarChamadas()
  servidor.use(
    msw.get('/api/publico/cadastro/:slug', () =>
      HttpResponse.json({
        clinica: { nome: 'Centro Fictício Exemplo', identidade: 'nome', fonte_do_nome: 'padrao' },
        secoes: [{ secao: 'identificacao', rotulo: 'Identificação' }],
        campos: [{ campo: 'nome', rotulo: 'Nome', secao: 'identificacao', lista: false, obrigatorio: true, tamanho: 255, tamanhos_dos_itens: {} }],
      }),
    ),
  )

  // ACT
  renderizarEm('/cadastro/abc123xyz9876543')

  // ASSERT — o formulário abre, e a única chamada é a pública
  expect(await screen.findByRole('textbox', { name: /Nome/ })).toBeInTheDocument()
  expect(chamadas).toContain('/api/publico/cadastro/abc123xyz9876543')
  expect(chamadas).not.toContain('/api/me')
})

it('deve continuar carregando a sessão nas rotas que TÊM conta', async () => {
  // ARRANGE — o par de controle: sem ele, "não chama /api/me" seria satisfeito por nunca chamar
  const chamadas = gravarChamadas()
  comSessao()

  // ACT
  renderizarEm('/agenda')

  // ASSERT
  await screen.findByRole('button', { name: /Hoje/ })
  expect(chamadas).toContain('/api/me')
})

it('deve mostrar acesso negado a quem entra nos gráficos financeiros sem a permissão', async () => {
  // ARRANGE — a rota nova fica sob `fluxo_caixa.ver` (o agregado da clínica). Sem este
  // caso, remover o `ExigePermissao` da rota não derrubava teste algum: o teste da
  // página renderiza o componente por fora do guarda (achado CR-GF-06).
  comSessao(['lancamentos.ver'])

  // ACT
  renderizarEm('/indicadores/financeiro')

  // ASSERT
  expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('deve levar o link antigo da produtividade à aba Equipe do MESMO mês, DENTRO da área', async () => {
  // ARRANGE — a guarda de contrato por TEXTO (`barra-de-abas.test.tsx`) prova que a aba tem rota
  // registrada e protegida; ela NÃO prova que a rota está dentro do shell, nem que o link antigo
  // (`/indicadores/produtividade?mes=`, copiado em mensagem antes da change indicadores-profissionais)
  // chega à Equipe do mesmo mês. Este teste monta o `App` de verdade e cobra as duas coisas.
  comSessao(['agenda.ver', 'atendimentos.ver'])
  const mesesDoPainel: Array<string | null> = []
  servidor.use(
    ...paineisQueAnotam().handlers.filter((handler) => !String(handler.info.path).endsWith('/equipe')),
    msw.get('/api/indicadores/painel/equipe', ({ request }) => {
      mesesDoPainel.push(new URL(request.url).searchParams.get('mes'))

      return HttpResponse.json(painelDaEquipeFicticio({ periodo: periodoFicticio('2026-08'), inicio_historico: '2026-08', inicio_historico_dia: '2026-08-01' }))
    }),
    msw.get('/api/indicadores/atendimentos', () =>
      HttpResponse.json({ mes: '2026-08', total: 0, por_especialidade: [], por_convenio: [] }),
    ),
    msw.get('/api/relatorios/producao-por-profissional', () => HttpResponse.json({ de: '', ate: '', linhas: [] })),
  )

  // ACT
  renderizarEm('/indicadores/produtividade?mes=2026-08')

  // ASSERT — a moldura da ÁREA (título, abas com a corrente marcada, período e Imprimir) e o mês
  expect(await screen.findByRole('heading', { name: 'Indicadores' })).toBeInTheDocument()
  const abas = await screen.findByRole('navigation', { name: 'Seções dos indicadores' })
  expect(within(abas).getByRole('link', { name: 'Equipe' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByText('agosto de 2026', { selector: '[aria-live]' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Imprimir esta seção' })).toBeInTheDocument()
  expect(await screen.findByRole('region', { name: 'Equipe no mês' })).toBeInTheDocument()
  expect(mesesDoPainel).toContain('2026-08')
})

it('deve mostrar acesso negado a quem entra na produtividade com uma só das duas permissões', async () => {
  // ARRANGE — a aba cruza os dois eixos: `agenda.ver` (capacidade e marcações) E
  // `atendimentos.ver` (realizados). Só uma delas não abre a porta.
  comSessao(['agenda.ver'])

  // ACT
  renderizarEm('/indicadores/produtividade')

  // ASSERT
  expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it('deve mostrar acesso negado na aba Equipe sem a permissão clínica — e não buscar a produção', async () => {
  // ARRANGE — a Equipe cruza os dois eixos; sem `atendimentos.ver` nem o bloco de produção monta
  comSessao(['agenda.ver'])
  const consultas: string[] = []
  servidor.use(
    msw.get('/api/relatorios/producao-por-profissional', ({ request }) => {
      consultas.push(request.url)

      return HttpResponse.json({ de: '', ate: '', linhas: [] })
    }),
  )

  // ACT
  renderizarEm('/indicadores/equipe?mes=2026-08')

  // ASSERT
  expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  expect(consultas).toEqual([])
})

it.each([
  ['/indicadores/agenda', ['pacientes.ver']],
  ['/indicadores/pacientes', ['agenda.ver']],
])('deve mostrar acesso negado em %s sem a permissão do painel dela', async (rota, permissoes) => {
  // ARRANGE + ACT
  comSessao(permissoes)
  renderizarEm(rota)

  // ASSERT
  expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
})

it('deve mostrar acesso negado no detalhe da produtividade sem a permissão clínica', async () => {
  // ARRANGE
  comSessao(['agenda.ver', 'fluxo_caixa.ver'])

  // ACT
  renderizarEm('/indicadores/produtividade/4')

  // ASSERT
  expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
})

/** As TRÊS do lote de vínculos — a rota as encadeia por extenso; aqui elas vêm da lista única. */
const QUEM_VINCULA_EM_LOTE = ['lancamentos.ver', ...PERMISSOES_DO_VINCULO_EM_LOTE]

it.each(PERMISSOES_DO_VINCULO_EM_LOTE)(
  'deve mostrar acesso negado no lote de vínculos a quem não tem %s',
  async (faltando) => {
    // ARRANGE — a listagem do servidor exige as três em E; sem QUALQUER uma a porta não abre.
    // Tirar uma de cada vez DA LISTA prova que a rota encadeia exatamente as da lista
    const consultas: string[] = []
    comSessao(QUEM_VINCULA_EM_LOTE.filter((permissao) => permissao !== faltando))
    servidor.use(
      msw.get('/api/lancamentos/sem-tratamento', ({ request }) => {
        consultas.push(request.url)
        return HttpResponse.json({ data: [], contagem: 0, truncado: false })
      }),
    )

    // ACT
    renderizarEm('/financeiro/vincular?mes=2026-09')

    // ASSERT — e a lista nem foi pedida
    expect(await screen.findByText('Você não tem acesso a esta tela')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Vincular pagamentos ao tratamento' })).not.toBeInTheDocument()
    expect(consultas).toEqual([])
  },
)

it('deve abrir o lote de vínculos, dentro do shell, para quem tem as três permissões', async () => {
  // ARRANGE
  comSessao(QUEM_VINCULA_EM_LOTE)
  servidor.use(
    msw.get('/api/lancamentos/sem-tratamento', () => HttpResponse.json({ data: [], contagem: 0, truncado: false })),
  )

  // ACT
  renderizarEm('/financeiro/vincular?mes=2026-09')

  // ASSERT
  expect(await screen.findByRole('heading', { name: 'Vincular pagamentos ao tratamento' })).toBeInTheDocument()
  expect(await screen.findByText('Nenhum pagamento sem tratamento em setembro de 2026.')).toBeInTheDocument()
})
