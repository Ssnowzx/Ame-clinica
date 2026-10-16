import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '@/componentes/app-shell'
import { ProvedorToast } from '@/componentes/ui/toast'
import { TIMEZONE_PADRAO, hojeNaClinica } from '@/lib/datas'
import { queryClient } from '@/lib/query-client'
import { PaginaFichaProfissional } from '@/paginas/pagina-ficha-profissional'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio } from '@/test/dados-agenda'
import { painelDoProfissionalFicticio, painelSo } from '@/test/dados-painel-do-profissional'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { PainelDoProfissional, Profissional } from '@/tipos'

expect.extend(toHaveNoViolations)

const HOJE = hojeNaClinica(TIMEZONE_PADRAO)
const MES = HOJE.slice(0, 7)

function profissionalFicticio(sobrescreve: Partial<Profissional> = {}): Profissional {
  return {
    id: 7,
    nome: 'Profissional Fictício da Ficha',
    foto_versao: null,
    conselho: 'CRFa',
    uf_conselho: 'SP',
    num_conselho: '12345',
    cbos_id: null,
    obs: 'Atende só pela manhã',
    ativo: true,
    // no formato da produção: a API sempre manda os dois
    atendimentos_simultaneos: 1,
    mensagens_automaticas: true,
    updated_at: '2026-07-15T10:00:00.000000Z',
    horarios: {
      '1': [{ inicio: '08:00', fim: '12:00' }],
      '3': [{ inicio: '08:00', fim: '12:00' }],
      '5': [{ inicio: '08:00', fim: '12:00' }],
    },
    especialidades: [{ id: 1, nome: 'Fonoaudiologia Fictícia' }],
    ...sobrescreve,
  }
}

const paginaVazia = { data: [], current_page: 1, last_page: 1, per_page: 50, total: 0 }

/** Um tratamento da lista, no formato da produção (o `realce` é o veredito do servidor). */
function tratamentoFicticio(
  id: number,
  nome: string,
  sessoes: { total: number; realizadas: number; realce?: 'nenhum' | 'acabando' | 'sem-saldo' },
) {
  return {
    id,
    realce: sessoes.realce ?? 'nenhum',
    paciente_id: id + 100,
    convenio_id: 1,
    especialidade_id: 1,
    profissional_id: 7,
    servico_id: null,
    sessoes_total: sessoes.total,
    sessoes_realizadas: sessoes.realizadas,
    sessoes_saldo: sessoes.total - sessoes.realizadas,
    vencido: false,
    data_inicio: '2026-06-01',
    validade_dias: null,
    pedido_vence_em: null,
    pedido_vencido: false,
    status: 'andamento',
    paciente: { id: id + 100, nome, nome_social: null },
    updated_at: '2026-07-15T10:00:00.000000Z',
  }
}

function tratamentosAtivos() {
  return {
    ...paginaVazia,
    total: 2,
    data: [
      tratamentoFicticio(31, 'Paciente Fictício Um', { total: 20, realizadas: 5 }),
      tratamentoFicticio(32, 'Paciente Fictício Dois', { total: 10, realizadas: 9, realce: 'acabando' }),
    ],
  }
}

/** O recorte "Acabando" do servidor: inclui o pacote de UMA sessão, que o veredito `realce` separa. */
function pacotesAcabando() {
  return {
    ...paginaVazia,
    per_page: 100,
    total: 3,
    data: [
      tratamentoFicticio(32, 'Paciente Fictício Dois', { total: 10, realizadas: 9, realce: 'acabando' }),
      tratamentoFicticio(33, 'Paciente Fictícia Avulsa', { total: 1, realizadas: 0, realce: 'nenhum' }),
      tratamentoFicticio(34, 'Paciente Fictício Sem Saldo', { total: 8, realizadas: 8, realce: 'sem-saldo' }),
    ],
  }
}

/** `/api/tratamentos` responde aos DOIS recortes da ficha: os ativos e os pacotes perto do fim. */
const handlerDeTratamentos = msw.get('/api/tratamentos', ({ request }) =>
  HttpResponse.json(new URL(request.url).searchParams.get('acabando') === '1' ? pacotesAcabando() : tratamentosAtivos()),
)

const handlerDeConfiguracao = msw.get('/api/agenda/configuracoes', () => HttpResponse.json({ configuracoes: [] }))

const handlerDaFicha = msw.get('/api/profissionais/7', () => HttpResponse.json(profissionalFicticio()))

/** O painel no formato do D7, ANOTANDO o `mes` de cada pedido — para provar o que foi buscado. */
function painelQueAnota(corpo: PainelDoProfissional | { status: number }) {
  const meses: string[] = []
  const handler = msw.get('/api/profissionais/7/painel', ({ request }) => {
    meses.push(new URL(request.url).searchParams.get('mes') ?? '')

    return 'status' in corpo ? HttpResponse.json({ message: 'sem acesso' }, { status: corpo.status }) : HttpResponse.json(corpo)
  })

  return { meses, handler }
}

/** Mostra a busca da URL — o seletor de mês mora nela. */
function OndeEstou() {
  return <p data-testid="onde-estou">{useLocation().search}</p>
}

function renderizar(caminho: string, permissoes: string[], profissionalDoUsuario: number | null = null) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes, profissional_id: profissionalDoUsuario },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route
            path="/profissionais/:id"
            element={
              <>
                <PaginaFichaProfissional />
                <OndeEstou />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const DO_ADMIN = [
  'profissionais.ver',
  'profissionais.editar',
  'agenda.ver',
  'agenda.ver_todos',
  'atendimentos.ver',
  'evolucoes.ver',
  'pacientes.ver',
  'tratamentos.ver',
  'repasse.ver',
  'lancamentos.ver',
]

beforeEach(() => {
  queryClient.clear()
})

// relógio falso que vaza fixa o "hoje" dos testes seguintes
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Ficha do profissional — composição por permissão', () => {
  it('deve montar o painel inteiro para o admin — números escopados do dia viram porta', async () => {
    // ARRANGE — todas as permissões, SEM vínculo (é ficha de terceiro): agenda e evoluções
    // não são buscadas (nenhum handler delas — fetch derrubaria o teste)
    const painel = painelQueAnota(painelDoProfissionalFicticio())
    servidor.use(handlerDeConfiguracao, handlerDaFicha, painel.handler, handlerDeTratamentos)

    // ACT
    renderizar('/profissionais/7', DO_ADMIN)

    // ASSERT — identificação
    expect(await screen.findByRole('heading', { level: 1, name: 'Profissional Fictício da Ficha' })).toBeInTheDocument()
    expect(screen.getByText('CRFa/SP 12345')).toBeInTheDocument()
    expect(screen.getByText('Seg, Qua, Sex · 08:00–12:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Editar cadastro/ })).toBeInTheDocument()

    // o mês em números, do PAINEL (D7), no mês da URL — o esqueleto tem cartões com os mesmos nomes,
    // então primeiro o bloco de verdade
    await screen.findByRole('heading', { level: 2, name: 'O mês em números' })
    const realizados = screen.getByRole('region', { name: 'Atendimentos realizados' })
    // o cartão é h3 dentro do bloco "O mês em números" (h2) — nunca dois h2 aninhados
    expect(within(realizados).getByRole('heading', { level: 3, name: 'Atendimentos realizados' })).toBeInTheDocument()
    // o número do cartão (o mesmo 24 aparece também em negrito na frase "24 de 30 sessões…")
    expect(within(realizados).getByText('24', { selector: 'p' })).toBeInTheDocument()
    expect(within(realizados).getByText('4 a mais')).toBeInTheDocument()
    expect(painel.meses).toEqual([MES])

    // os blocos na ordem da pergunta do profissional (D5)
    const blocos = ['O mês em números', 'Seis meses', 'A semana', 'Onde a agenda não rendeu', 'Pacientes', 'Financeiro']
    const posicoes = blocos.map((nome) => screen.getByRole('heading', { level: 2, name: nome }))
    for (const [indice, titulo] of posicoes.slice(1).entries()) {
      expect(posicoes[indice].compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }

    // tratamentos ativos listados (quem opera a agenda de toda a clínica alcança este profissional)
    const tratamentos = screen.getByRole('table', { name: 'Tratamentos ativos do profissional' })
    expect(within(tratamentos).getByText('Paciente Fictício Um')).toBeInTheDocument()
    expect(within(tratamentos).getByText('5/20')).toBeInTheDocument()

    // seções escopadas de TERCEIRO: porta sem número
    expect(screen.getByText('O dia deste profissional se vê na agenda, com o recorte do seu papel.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir na agenda/ })).toHaveAttribute('href', '/agenda?profissional=7&visao=dia')
    expect(screen.getByRole('link', { name: /Produção completa/ })).toHaveAttribute(
      'href',
      `/indicadores/profissionais/7?mes=${MES}&de=ficha`,
    )
    // as outras portas carregam o profissional — o destino ganha volta e recorte
    expect(screen.getByRole('link', { name: /Fila de evoluções/ })).toHaveAttribute('href', '/evolucoes?profissional_id=7')
    expect(screen.getByRole('link', { name: /Todos em Tratamentos/ })).toHaveAttribute('href', '/tratamentos?profissional_id=7')
  })

  /*
   * Orçamento explícito, e NÃO um timeout aumentado no chute (o precedente é o axe da aba Clínica das
   * Configurações). O `axe` caminha a ficha INTEIRA: seis blocos, doze quadros de gráfico e cada tabela
   * equivalente duas vezes (a do `details` e a cópia do papel). Sozinho leva ~2 s; com a suíte inteira
   * disputando a máquina passou dos 5 s padrão. O custo é do DOM real do painel, não sinal de defeito.
   */
  it('deve passar no axe com o painel inteiro montado', async () => {
    // ARRANGE
    servidor.use(handlerDeConfiguracao, handlerDaFicha, painelQueAnota(painelDoProfissionalFicticio()).handler, handlerDeTratamentos)
    const { container } = renderizar('/profissionais/7', DO_ADMIN)
    await screen.findByRole('heading', { level: 2, name: 'Financeiro' })
    await screen.findByRole('table', { name: 'Pacotes perto do fim, do menor saldo para o maior' })

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 15_000)

  it('deve abrir a PRÓPRIA ficha sem profissionais.ver, com o dia, o próximo atendimento e as pendências', async () => {
    // ARRANGE — papel do profissional: agenda.ver + evolucoes.ver, vínculo com o 7.
    // Meio-dia na clínica (15:00Z = 12:00 em São Paulo), para o dia ter passado e futuro
    vi.setSystemTime(new Date(`${HOJE}T15:00:00Z`))
    const painel = painelQueAnota(painelSo(['agenda']))
    servidor.use(
      handlerDeConfiguracao,
      handlerDaFicha,
      painel.handler,
      msw.get('/api/agenda', () =>
        HttpResponse.json([
          // o resumo filtra `hora > agora`, e por isso o relógio está PARADO ao meio-dia
          // logo acima: sem isso o teste cai no último minuto do dia — 23:59 deixa de
          // ser futuro às 23:59, e foi assim que ele quebrou uma vez
          cardFicticio({ id: 1, profissional_id: 7, inicio: `${HOJE} 00:00` }),
          cardFicticio({ id: 2, profissional_id: 7, inicio: `${HOJE} 23:59` }),
        ]),
      ),
      msw.get('/api/evolucoes/em-aberto', () => HttpResponse.json({ ...paginaVazia, total: 3 })),
    )

    // ACT
    renderizar('/profissionais/7', ['agenda.ver', 'evolucoes.ver'], 7)

    // ASSERT — own-show abre a identificação; o DIA tem números; evoluções contam
    expect(await screen.findByRole('heading', { level: 1, name: 'Profissional Fictício da Ficha' })).toBeInTheDocument()
    expect(screen.getByText(/a sua ficha/)).toBeInTheDocument()
    expect(await screen.findByText('atendimentos hoje')).toBeInTheDocument()
    // o PRÓXIMO atendimento em destaque (CR-FPR-03): com o relógio parado ao meio-dia, o 23:59 é o
    // único dos dois que ainda está por vir — com a criança dele
    const proximo = screen.getByText('Próximo às').closest('p') as HTMLElement
    expect(within(proximo).getByText('23:59')).toBeInTheDocument()
    expect(within(proximo).getByText('Paciente Fictício')).toBeInTheDocument()
    const evolucoes = screen.getByRole('region', { name: 'Evoluções em aberto' })
    expect(await within(evolucoes).findByText('3')).toBeInTheDocument()
    expect(within(evolucoes).getByText(/sessões sem registro clínico/)).toBeInTheDocument()

    // o painel fala com o profissional ("seus atendimentos")
    expect(await screen.findByText(/Os seus atendimentos no período/)).toBeInTheDocument()

    // sem atendimentos.ver/tratamentos.ver: sem a porta da produção, sem tratamentos; sem
    // profissionais.ver, a volta para a LISTA não é prometida
    expect(screen.queryByRole('link', { name: /Produção completa/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tratamentos ativos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Profissionais' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar cadastro/ })).not.toBeInTheDocument()
  })

  it('deve negar a ficha sem permissão e sem vínculo — sem chamar a API', async () => {
    // ARRANGE + ACT — nenhum handler: qualquer fetch derrubaria o teste
    renderizar('/profissionais/7', ['agenda.ver'], null)

    // ASSERT
    expect(await screen.findByText('Você não tem acesso a esta ficha')).toBeInTheDocument()
  })

  it('deve não afirmar números escopados na ficha de um COLEGA — o painel 403 vira porta', async () => {
    // ARRANGE — vinculado ao 99 abrindo a ficha do 7: o servidor recusa o painel (D3); agenda,
    // evoluções e tratamentos NÃO são buscados (sem handler = prova de zero fetch)
    const painel = painelQueAnota({ status: 403 })
    servidor.use(handlerDeConfiguracao, handlerDaFicha, painel.handler)

    // ACT
    renderizar('/profissionais/7', ['profissionais.ver', 'agenda.ver', 'evolucoes.ver', 'tratamentos.ver'], 99)

    // ASSERT — o painel diz que os números não estão no acesso; as seções escopadas viram porta
    expect(await screen.findByText('Os números do mês deste profissional não estão no seu acesso')).toBeInTheDocument()
    expect(screen.getByText('O dia deste profissional se vê na agenda, com o recorte do seu papel.')).toBeInTheDocument()
    expect(screen.getByText('As pendências deste profissional se veem na fila, com o recorte do seu papel.')).toBeInTheDocument()
    expect(screen.getByText('Os tratamentos deste profissional se veem em Tratamentos, com o recorte do seu papel.')).toBeInTheDocument()
    expect(screen.queryByText(/atendimentos hoje/)).not.toBeInTheDocument()
    expect(screen.queryByText(/sem registro clínico/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'O mês em números' })).not.toBeInTheDocument()
    expect(screen.queryByText('Nenhum tratamento ativo com este profissional.')).not.toBeInTheDocument()
  })

  it('deve mostrar os números do mês SÓ quando o bloco vem — nunca zeros inventados', async () => {
    // ARRANGE — sem `agenda.ver`: o painel só traz os pacotes no fim (`pacientes.ver` + `tratamentos.ver`)
    servidor.use(handlerDaFicha, msw.get('/api/profissionais/7/painel', () => HttpResponse.json(painelSo(['pacientes']))))

    // ACT
    renderizar('/profissionais/7', ['profissionais.ver', 'pacientes.ver', 'tratamentos.ver'])
    const pacientes = await screen.findByRole('region', { name: 'Pacientes' })

    // ASSERT — nenhum bloco do mês sem a chave dele, e nada no lugar; os pacotes, com o número do painel
    for (const nome of ['O mês em números', 'Seis meses', 'A semana', 'Onde a agenda não rendeu', 'Financeiro']) {
      expect(screen.queryByRole('heading', { name: nome })).not.toBeInTheDocument()
    }
    expect(within(within(pacientes).getByRole('region', { name: 'Pacotes perto do fim' })).getByText('2')).toBeInTheDocument()
  })

  it('deve deixar fora o cartão dos pacotes quando a chave não vem — ausente não é zero', async () => {
    // ARRANGE — sem `tratamentos.ver`, o servidor nem manda a chave `pacientes` (contrato, gate r1)
    servidor.use(
      handlerDeConfiguracao,
      handlerDaFicha,
      msw.get('/api/profissionais/7/painel', () => HttpResponse.json(painelSo(['agenda']))),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )

    // ACT
    renderizar('/profissionais/7?mes=2026-10', ['agenda.ver', 'pacientes.ver'], 7)
    const pacientes = await screen.findByRole('region', { name: 'Pacientes' })

    // ASSERT — o bloco segue com as sessões por convênio, e nenhum "0 pacotes" no lugar do que não veio
    expect(within(pacientes).getByRole('heading', { name: 'Convênio Fictício Alfa concentra a maior parte das sessões' })).toBeInTheDocument()
    expect(within(pacientes).queryByRole('region', { name: 'Pacotes perto do fim' })).not.toBeInTheDocument()
  })

  it('deve mostrar SÓ o "não encontramos" para um id que não existe — sem o erro do painel embaixo', async () => {
    // ARRANGE — o cadastro e o painel do mesmo id respondem 404
    servidor.use(
      handlerDeConfiguracao,
      msw.get('/api/profissionais/7', () => HttpResponse.json({ message: 'não encontrado' }, { status: 404 })),
      msw.get('/api/profissionais/7/painel', () => HttpResponse.json({ message: 'não encontrado' }, { status: 404 })),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )

    // ACT
    renderizar('/profissionais/7', ['profissionais.ver', 'agenda.ver'])
    const aviso = await screen.findByRole('alert')

    // ASSERT — um "Tentar novamente" só repetiria o mesmo 404 (gate r1, N2)
    expect(aviso).toHaveTextContent('Não encontramos este profissional.')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'O mês do profissional' })).not.toBeInTheDocument())
    expect(screen.queryByText('Não foi possível carregar o painel do mês.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tentar novamente/ })).not.toBeInTheDocument()
  })

  it('não deve dizer "não encontramos" quando o CADASTRO bate no limite (429), só quando é 404', async () => {
    // ARRANGE — `invalido` junta 404, 422, 428 e 429: o 429 escondia a ficha atrás de "não
    // encontramos" (code-reviewer r2)
    servidor.use(
      handlerDeConfiguracao,
      msw.get('/api/profissionais/7', () => HttpResponse.json({ message: 'muitas' }, { status: 429 })),
      msw.get('/api/profissionais/7/painel', () => HttpResponse.json(painelSo(['agenda']))),
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )

    // ACT — espera o ERRO do cadastro chegar (o painel pode aparecer antes dele, e conferir ali não
    // provaria nada)
    renderizar('/profissionais/7', ['profissionais.ver', 'agenda.ver'])
    await screen.findByText('Não foi possível carregar a ficha do profissional.')

    // ASSERT — o erro com "Tentar novamente" (o 429 passa), e nada de "não encontramos"
    expect(screen.queryByText('Não encontramos este profissional.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tentar novamente/ })).toBeInTheDocument()
  })

  it('não deve pedir o painel a quem tem só pacientes.ver — sem tratamentos.ver ele é 403 garantido', async () => {
    // ARRANGE — o bloco dos pacientes exige as duas no servidor (code-reviewer r2)
    let pedidosDoPainel = 0
    servidor.use(
      handlerDaFicha,
      msw.get('/api/profissionais/7/painel', () => {
        pedidosDoPainel += 1
        return HttpResponse.json({ message: 'proibido' }, { status: 403 })
      }),
    )

    // ACT
    renderizar('/profissionais/7', ['profissionais.ver', 'pacientes.ver'])
    await screen.findByRole('heading', { level: 1 })

    // ASSERT
    expect(pedidosDoPainel).toBe(0)
  })

  it('deve dizer o limite de consultas no 429, com o "Tentar novamente" da casa', async () => {
    // ARRANGE — a rota tem limite próprio: o primeiro pedido bate nele, o segundo passa
    let pedidos = 0
    servidor.use(
      handlerDeConfiguracao,
      handlerDaFicha,
      msw.get('/api/agenda', () => HttpResponse.json([])),
      msw.get('/api/profissionais/7/painel', () => {
        pedidos += 1

        return pedidos === 1
          ? HttpResponse.json({ message: 'Too Many Attempts.' }, { status: 429 })
          : HttpResponse.json(painelSo(['agenda']))
      }),
    )
    const usuario = userEvent.setup()
    renderizar('/profissionais/7?mes=2026-10', ['agenda.ver'], 7)

    // ACT
    expect(await screen.findByText('Muitas consultas seguidas; tente de novo em um minuto.')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: /Tentar novamente/ }))

    // ASSERT — sem novo pedido sozinho (4xx não se repete), e o painel chega no "Tentar novamente"
    expect(await screen.findByRole('heading', { level: 2, name: 'O mês em números' })).toBeInTheDocument()
    expect(pedidos).toBe(2)
  })

  it('deve mostrar não-encontrado amigável para profissional inexistente', async () => {
    // ARRANGE — o own-show/escopo devolve 404 (CR-FPR-05)
    servidor.use(
      msw.get('/api/profissionais/7', () => HttpResponse.json({ message: 'não encontrado' }, { status: 404 })),
    )

    // ACT
    renderizar('/profissionais/7', ['profissionais.ver'])

    // ASSERT
    const aviso = await screen.findByRole('alert')
    expect(aviso).toHaveTextContent('Não encontramos este profissional.')
  })

  it('deve mostrar erro amigável para id inválido — sem chamar a API', async () => {
    // ARRANGE + ACT
    renderizar('/profissionais/abc', ['profissionais.ver'])

    // ASSERT
    expect(await screen.findByRole('alert')).toHaveTextContent('Este endereço de profissional não é válido.')
  })
})

/** O painel só com a agenda, na própria ficha — o caso de "bloco ausente não deixa buraco". */
async function fichaPropriaCom(corpo: PainelDoProfissional, permissoes: string[] = ['agenda.ver']) {
  servidor.use(
    handlerDeConfiguracao,
    handlerDaFicha,
    msw.get('/api/profissionais/7/painel', () => HttpResponse.json(corpo)),
    msw.get('/api/agenda', () => HttpResponse.json([])),
    handlerDeTratamentos,
  )
  renderizar(`/profissionais/7?mes=2026-10`, permissoes, 7)
  await screen.findByRole('heading', { level: 2, name: 'O mês em números' })
}

describe('Ficha do profissional — o painel do mês (painel-do-profissional, 3.2)', () => {
  it('deve hachurar os meses sem dados e rotular o mês parcial "até hoje"', async () => {
    // ARRANGE + ACT — a série de outubro: maio a agosto antes do início dos indicadores
    await fichaPropriaCom(painelDoProfissionalFicticio(), ['agenda.ver', 'atendimentos.ver'])
    const grafico = screen.getByRole('region', { name: 'Os atendimentos de outubro estão acima do ritmo de setembro' })

    // ASSERT — quatro colunas hachuradas, nunca zero; outubro com o asterisco e a legenda do parcial
    expect(grafico.querySelectorAll('[data-sem-dados]')).toHaveLength(4)
    expect(within(grafico).getByText('mai–ago: antes dos indicadores, sem dados')).toBeInTheDocument()
    expect(within(grafico).getByText('out*')).toBeInTheDocument()
    expect(within(grafico).getByText('out*: só até hoje, dia 5 — o mês ainda está em curso')).toBeInTheDocument()
  })

  it('deve trazer a tabela equivalente com os mesmos valores da série, mês a mês', async () => {
    // ARRANGE + ACT
    await fichaPropriaCom(painelDoProfissionalFicticio(), ['agenda.ver', 'atendimentos.ver'])
    const grafico = screen.getByRole('region', { name: 'Os atendimentos de outubro estão acima do ritmo de setembro' })

    // ASSERT — quem usa leitor de tela encontra a tabela com os mesmos números
    const tabela = within(grafico).getByRole('table', { name: 'Realizados mês a mês, nos últimos seis meses' })
    expect(within(tabela).getAllByText('sem dados')).toHaveLength(4)
    expect(within(tabela).getByRole('row', { name: /setembro de 2026/ })).toHaveTextContent('61')
    expect(within(tabela).getByRole('row', { name: /outubro de 2026 \(até hoje\)/ })).toHaveTextContent('24')
  })

  it('deve deixar fora, sem buraco, todo bloco cuja chave não veio', async () => {
    // ARRANGE + ACT — só o bloco da agenda (sem produtividade, sem série, sem equipe)
    await fichaPropriaCom(painelSo(['agenda']))

    // ASSERT — sem a série, não há Seis meses; a semana e a perda só com o quadro da agenda
    expect(screen.queryByRole('heading', { name: 'Seis meses' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Evoluções em dia' })).not.toBeInTheDocument()
    // e os títulos na ORDEM: o bloco é h2, o quadro dentro dele é h3 (gate r1, N4)
    const semana = screen.getByRole('region', { name: 'A semana' })
    expect(within(semana).getAllByRole('heading', { level: 2 }).map((titulo) => titulo.textContent)).toEqual(['A semana'])
    expect(within(semana).getAllByRole('heading', { level: 3 }).map((titulo) => titulo.textContent)).toEqual([
      'A sexta à tarde é o horário mais vazio',
    ])
    const perda = screen.getByRole('region', { name: 'Onde a agenda não rendeu' })
    expect(within(perda).queryByRole('heading', { name: /maior perda do mês/ })).not.toBeInTheDocument()
    expect(within(perda).getByRole('heading', { name: 'As faltas se concentram na segunda-feira' })).toBeInTheDocument()
  })

  it('deve mostrar onde a agenda não rendeu pela régua da produtividade, com as horas ociosas', async () => {
    // ARRANGE + ACT
    await fichaPropriaCom(painelDoProfissionalFicticio(), ['agenda.ver', 'atendimentos.ver'])
    const perda = screen.getByRole('region', { name: 'As faltas foram a maior perda do mês' })

    // ASSERT — as três perdas contadas e as horas da grade sem marcação (1600 min = 26h40)
    const tabela = within(perda).getByRole('table', { name: 'Onde a agenda não rendeu no mês' })
    expect(within(tabela).getByRole('row', { name: /Faltas/ })).toHaveTextContent('9')
    expect(within(tabela).getByRole('row', { name: /Horários liberados/ })).toHaveTextContent('5')
    expect(within(perda).getByText('Além delas, 26h40 da grade ficaram sem marcação.')).toBeInTheDocument()
  })
})

describe('Ficha do profissional — pacientes e financeiro (painel-do-profissional, 3.3)', () => {
  it('deve listar os pacotes perto do fim pelo veredito do servidor, do menor saldo para o maior', async () => {
    // ARRANGE + ACT — a própria ficha, com tratamentos: o recorte "Acabando" traz um pacote de UMA
    // sessão que o aviso "Pacotes acabando" não conta
    await fichaPropriaCom(painelDoProfissionalFicticio(), ['agenda.ver', 'pacientes.ver', 'tratamentos.ver'])
    const pacientes = screen.getByRole('region', { name: 'Pacientes' })

    // ASSERT — o número do painel (o mesmo do sino) e a lista nominal com o saldo
    expect(within(within(pacientes).getByRole('region', { name: 'Pacotes perto do fim' })).getByText('2')).toBeInTheDocument()
    const tabela = await within(pacientes).findByRole('table', { name: 'Pacotes perto do fim, do menor saldo para o maior' })
    const linhas = within(tabela).getAllByRole('row').slice(1)
    expect(linhas.map((linha) => linha.textContent)).toEqual(['Paciente Fictício Sem Saldo8/80', 'Paciente Fictício Dois9/101'])
    expect(within(tabela).queryByText('Paciente Fictícia Avulsa')).not.toBeInTheDocument()
    // em atendimento: o total da MESMA consulta da tabela dos ativos
    expect(await within(within(pacientes).getByRole('region', { name: 'Em atendimento' })).findByText('2')).toBeInTheDocument()
  })

  it('deve mostrar o financeiro próprio com a base escrita e nenhuma ação de escrita', async () => {
    // ARRANGE + ACT — a profissional com a permissão própria (repasse.ver_proprio), na própria ficha
    await fichaPropriaCom(painelDoProfissionalFicticio(), ['agenda.ver', 'repasse.ver_proprio'])
    const financeiro = screen.getByRole('region', { name: 'Financeiro' })

    // ASSERT — a base, o recebido com a comparação e as sessões sem pagamento (só leitura)
    expect(
      within(financeiro).getByText(
        'Pagamentos recebidos no caixa da clínica pelos seus atendimentos; convênio de plano não passa por aqui.',
      ),
    ).toBeInTheDocument()
    const recebido = within(financeiro).getByRole('region', { name: 'Recebido' })
    expect(within(recebido).getByText('R$ 1.840,50')).toBeInTheDocument()
    expect(within(recebido).getByText('23% a mais')).toBeInTheDocument()
    const semPagamento = within(financeiro).getByRole('table', { name: 'Sessões realizadas no mês ainda sem pagamento' })
    expect(within(semPagamento).getByText('Paciente Fictício Sem Pagamento')).toBeInTheDocument()
    expect(within(semPagamento).getByText('sem valor na tabela')).toBeInTheDocument()
    // nenhum botão de lançar, cobrar ou dar baixa: só os "i" das definições
    const botoes = within(financeiro).queryAllByRole('button').map((botao) => botao.getAttribute('aria-label') ?? botao.textContent)
    expect(botoes.every((nome) => nome?.startsWith('Como se calcula') === true)).toBe(true)
    expect(screen.queryByRole('button', { name: /lançar|cobrar|pagar|baixa/i })).not.toBeInTheDocument()
  })

  it('deve mostrar à faturista só o recebido — sem "Seis meses" de contagens que ela não recebe', async () => {
    // ARRANGE — a régua do relatório + quem opera a agenda de todos, SEM `agenda.ver`: no FORMATO do
    // servidor, a série vem só com o `recebido` (as contagens são da produtividade) e o "sem pagamento"
    // só com a quantidade (a lista é de quem vê a agenda) — gate r1, B1 e contrato (b)
    const FATURISTA = ['profissionais.ver', 'repasse.ver', 'lancamentos.ver', 'tratamentos.ver', 'agenda.ver_todos']
    servidor.use(
      handlerDaFicha,
      msw.get('/api/profissionais/7/painel', () => HttpResponse.json(painelSo(['financeiro'], { veAgenda: false }))),
      handlerDeTratamentos,
    )

    // ACT
    renderizar('/profissionais/7?mes=2026-10', FATURISTA)
    const financeiro = await screen.findByRole('region', { name: 'Financeiro' })

    // ASSERT — nenhum mês de "0 atendimentos": o bloco das contagens nem monta
    expect(screen.queryByRole('heading', { name: 'Seis meses' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Realizados mês a mês, nos últimos seis meses' })).not.toBeInTheDocument()
    // o recebido segue com a série dele
    const serie = within(financeiro).getByRole('region', { name: 'O recebido de outubro está acima do ritmo de setembro' })
    expect(within(serie).getByRole('row', { name: /setembro de 2026/ })).toHaveTextContent('R$ 4.200,00')
    // o "sem pagamento" diz a quantidade e por que a lista não está ali — sem lista vazia
    expect(within(within(financeiro).getByRole('region', { name: 'Sessões sem pagamento' })).getByText('2')).toBeInTheDocument()
    expect(within(financeiro).getByText('A lista, com a data e a criança de cada sessão, aparece para quem vê a agenda.')).toBeInTheDocument()
    expect(within(financeiro).queryByRole('table', { name: 'Sessões realizadas no mês ainda sem pagamento' })).not.toBeInTheDocument()
  })

  it('deve falar com o gestor SOBRE o profissional na ficha de outro', async () => {
    // ARRANGE — a régua do relatório (repasse.ver + lancamentos.ver + tratamentos.ver), sem vínculo
    servidor.use(handlerDeConfiguracao, handlerDaFicha, painelQueAnota(painelDoProfissionalFicticio()).handler, handlerDeTratamentos)

    // ACT
    renderizar('/profissionais/7?mes=2026-10', DO_ADMIN)

    // ASSERT
    expect(
      await screen.findByText(
        'Pagamentos recebidos no caixa da clínica pelos atendimentos de Profissional Fictício da Ficha; convênio de plano não passa por aqui.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Os atendimentos de Profissional Fictício da Ficha no período/)).toBeInTheDocument()
  })

  it('deve sumir com o Financeiro, sem espaço vazio, quando a chave não vem', async () => {
    // ARRANGE + ACT — sem a permissão própria nem a do relatório: a chave nem vem (D4)
    await fichaPropriaCom(painelSo(['agenda']))

    // ASSERT
    expect(screen.queryByRole('heading', { name: 'Financeiro' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recebido' })).not.toBeInTheDocument()
  })
})

describe('Ficha do profissional — o mês na URL e o papel (painel-do-profissional, 3.4)', () => {
  it('deve trocar o mês pela URL e buscar o painel do mês escolhido', async () => {
    // ARRANGE
    const painel = painelQueAnota(painelSo(['agenda']))
    servidor.use(handlerDeConfiguracao, handlerDaFicha, painel.handler, msw.get('/api/agenda', () => HttpResponse.json([])))
    const usuario = userEvent.setup()
    renderizar('/profissionais/7?mes=2026-10', ['agenda.ver'], 7)
    await screen.findByRole('heading', { level: 2, name: 'O mês em números' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mês anterior' }))

    // ASSERT — o mês mora na URL, e o painel é pedido de novo para ele
    await waitFor(() => expect(painel.meses).toEqual(['2026-10', '2026-09']))
    expect(screen.getByTestId('onde-estou')).toHaveTextContent('?mes=2026-09')
    expect(within(screen.getByRole('group', { name: 'Mês do painel' })).getByText('setembro de 2026')).toBeInTheDocument()
  })

  it('deve trocar um mês futuro da URL pelo corrente — o servidor o recusaria', async () => {
    // ARRANGE
    const painel = painelQueAnota(painelSo(['agenda']))
    servidor.use(handlerDeConfiguracao, handlerDaFicha, painel.handler, msw.get('/api/agenda', () => HttpResponse.json([])))

    // ACT
    renderizar('/profissionais/7?mes=2999-01', ['agenda.ver'], 7)

    // ASSERT — nunca um 422: o pedido sai com o mês corrente, e a URL se corrige
    await waitFor(() => expect(painel.meses).toEqual([MES]))
    await waitFor(() => expect(screen.getByTestId('onde-estou')).toHaveTextContent(`?mes=${MES}`))
  })

  it('deve imprimir pelo botão e deixar os controles fora do papel', async () => {
    // ARRANGE
    servidor.use(
      handlerDeConfiguracao,
      handlerDaFicha,
      painelQueAnota(painelSo(['agenda'])).handler,
      msw.get('/api/agenda', () => HttpResponse.json([])),
    )
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const usuario = userEvent.setup()
    renderizar('/profissionais/7?mes=2026-10', ['agenda.ver', 'profissionais.editar'], 7)
    await screen.findByRole('heading', { level: 2, name: 'O mês em números' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Imprimir o painel' }))

    // ASSERT — a folha tem o título do documento; o seletor, Imprimir e Editar não vão ao papel
    expect(imprimir).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Painel do profissional — Profissional Fictício da Ficha — outubro de 2026')).toBeInTheDocument()
    for (const controle of [
      screen.getByRole('group', { name: 'Mês do painel' }),
      screen.getByRole('button', { name: 'Imprimir o painel' }),
      screen.getByRole('button', { name: /Editar cadastro/ }),
    ]) {
      expect(controle.closest('[data-nao-imprimir]')).not.toBeNull()
    }
  })
})

describe('Portas de chegada à ficha', () => {
  function renderizarShell(profissionalDoUsuario: number | null) {
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'], profissional_id: profissionalDoUsuario },
      carregandoSessao: false,
    })

    return render(
      <QueryClientProvider client={queryClient}>
        {/* o app real envolve o shell no ProvedorToast (app.tsx) — o sino usa usarToast */}
        <ProvedorToast>
          <MemoryRouter initialEntries={['/agenda']}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/agenda" element={<p>Conteúdo da agenda</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
  }

  it('deve mostrar "Minha ficha" no cabeçalho para quem tem vínculo', () => {
    // ARRANGE + ACT
    renderizarShell(7)

    // ASSERT — a porta do profissional SEM profissionais.ver
    expect(screen.getByRole('link', { name: 'Minha ficha' })).toHaveAttribute('href', '/profissionais/7')
  })

  it('deve esconder "Minha ficha" de quem não tem vínculo', () => {
    // ARRANGE + ACT
    renderizarShell(null)

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Minha ficha' })).not.toBeInTheDocument()
  })
})

describe('Ficha do profissional — a foto do cadastro (foto-do-profissional)', () => {
  it('deve enviar a foto pela ficha e passar a mostrá-la, versionada', async () => {
    // ARRANGE: a ficha nasce sem foto; o servidor aceita o envio e a releitura traz a versão
    let versao: string | null = null
    servidor.use(
      handlerDeConfiguracao,
      msw.get('/api/profissionais/7', () => HttpResponse.json(profissionalFicticio({ foto_versao: versao }))),
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
      msw.post('/api/profissionais/7/foto', () => {
        versao = '20260902120000'

        return HttpResponse.json({ foto_versao: versao }, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar('/profissionais/7', ['profissionais.ver', 'profissionais.editar'])
    await screen.findByRole('button', { name: 'Enviar foto' })

    // ACT: um PNG fictício pelo seletor de arquivo (rótulo acessível)
    await usuario.upload(
      screen.getByLabelText('Arquivo da foto'),
      new File(['png-ficticio'], 'foto.png', { type: 'image/png' }),
    )

    // ASSERT: o avatar aponta para a foto versionada e o botão muda de verbo
    await screen.findByRole('button', { name: 'Trocar foto' })
    expect(document.querySelector('img[src="/api/profissionais/7/foto?v=20260902120000"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Remover foto' })).toBeInTheDocument()
  })

  it('deve mostrar só o avatar, sem controles, para quem não edita o cadastro', async () => {
    // ARRANGE
    servidor.use(handlerDeConfiguracao, handlerDaFicha)

    // ACT
    renderizar('/profissionais/7', ['profissionais.ver'])
    await screen.findByRole('heading', { level: 1, name: 'Profissional Fictício da Ficha' })

    // ASSERT
    expect(screen.queryByRole('button', { name: /foto/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Arquivo da foto')).not.toBeInTheDocument()
  })
})

describe('Ficha do profissional — mensagens automáticas às famílias', () => {
  it('deve dizer na identificação que as mensagens automáticas estão desligadas', async () => {
    // ARRANGE — explica por que as famílias deste profissional não recebem lembrete
    servidor.use(
      handlerDeConfiguracao,
      msw.get('/api/profissionais/7', () => HttpResponse.json(profissionalFicticio({ mensagens_automaticas: false }))),
    )

    // ACT
    renderizar('/profissionais/7', ['profissionais.ver'])

    // ASSERT
    expect(await screen.findByText('Mensagens automáticas às famílias')).toBeInTheDocument()
    expect(screen.getByText('Desligadas: o lembrete da véspera e a confirmação não saem')).toBeInTheDocument()
  })

  it('não deve falar das mensagens automáticas quando estão ligadas, que é o padrão', async () => {
    // ARRANGE
    servidor.use(handlerDeConfiguracao, handlerDaFicha)

    // ACT
    renderizar('/profissionais/7', ['profissionais.ver'])

    // ASSERT
    expect(await screen.findByText('Especialidades')).toBeInTheDocument()
    expect(screen.queryByText('Mensagens automáticas às famílias')).not.toBeInTheDocument()
  })
})
