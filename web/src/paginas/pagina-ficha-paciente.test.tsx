import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { PaginaFichaPaciente } from '@/paginas/pagina-ficha-paciente'
import { useAuthStore } from '@/stores/auth-store'
import { pacienteFicticio } from '@/test/dados-cadastros'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { AgendamentosDoPaciente, ResumoDoPaciente } from '@/tipos'

const RESUMO: ResumoDoPaciente = {
  profissional_atual: { id: 7, nome: 'Profissional Fictício' },
  contrato: { id: 9, status: 'andamento', sessoes_total: 10, sessoes_realizadas: 4, sessoes_saldo: 6, vencido: false },
  primeira_sessao: '2026-06-01 09:00',
  proxima_sessao: '2026-07-20 14:00',
  sessoes_realizadas: 4,
}

/**
 * A seção Agendamentos tem endpoint PRÓPRIO desde a change agendamentos-na-ficha — e fixture
 * PRÓPRIA: montar o contrato novo a partir do velho (apagando `data` com `undefined`) só
 * funcionava porque o `JSON.stringify` descarta a chave, e é assim que um campo removido do
 * servidor continua "passando" no teste.
 */
const AGENDAMENTOS_DA_FICHA: AgendamentosDoPaciente = {
  proximos: { janela: { de: '2026-06-01', ate: null }, total: 0, itens: [] },
  recentes: {
    janela: { de: '2026-03-03', ate: '2026-06-01' },
    total: 1,
    itens: [
      {
        id: 1,
        inicio: '2026-06-01 09:00',
        especialidade: { id: 2, nome: 'Fonoaudiologia', cor: '#448247' },
        profissional: { id: 7, nome: 'Profissional Fictício' },
        status: { id: 5, nome: 'Não Compareceu', cor: '#EF4444', cor_borda: null, tipo: 'user-x' },
      },
    ],
  },
}

function renderFicha(
  rota = '/pacientes/1',
  { permissoes = ['pacientes.ver', 'agenda.ver'] }: { permissoes?: string[] } = {},
) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[rota]}>
          <Routes>
            <Route path="/pacientes/:id" element={<PaginaFichaPaciente />} />
            <Route path="/pacientes/:id/:secao" element={<PaginaFichaPaciente />} />
            <Route path="/pacientes/:id/editar" element={<div>Formulário de edição</div>} />
            <Route path="/pacientes" element={<div>Lista de pacientes</div>} />
            <Route path="/agenda" element={<div>Agenda</div>} />
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  servidor.use(
    msw.get('/api/pacientes/:id/resumo', () => HttpResponse.json(RESUMO)),
    msw.get('/api/pacientes/:id/agendamentos', () => HttpResponse.json(AGENDAMENTOS_DA_FICHA)),
    msw.get('/api/pacientes/:id', () => HttpResponse.json(pacienteFicticio({ id: 1, nome: 'Paciente Fictício' }))),
  )
})

describe('Ficha do paciente — casca', () => {
  it('deve abrir em /pacientes/:id com identidade e a seção Painel (primeira permitida)', async () => {
    // ARRANGE + ACT
    renderFicha('/pacientes/1')

    // ASSERT — cabeçalho de identidade + Painel com o resumo do servidor
    expect(await screen.findByRole('heading', { level: 1, name: 'Paciente Fictício' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Painel' })).toBeInTheDocument()
    expect(await screen.findByText('20/07/2026 às 14:00')).toBeInTheDocument() // próxima sessão
    expect(screen.getByText('Em andamento · 4/10 sessões')).toBeInTheDocument()
  })

  it('deve focar a seção ativa ao abrir (foco declarado)', async () => {
    // ARRANGE + ACT
    renderFicha('/pacientes/1')

    // ASSERT — a região da seção (nomeada pelo h2 "Painel") recebe o foco
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Painel' })).toHaveFocus()
    })
  })

  it('não deve oferecer Agendamentos sem agenda.ver, nem por URL direta', async () => {
    // ARRANGE — usuário só com pacientes.ver; a seção Agendamentos exige agenda.ver
    // ACT — tenta abrir a seção direto pela URL
    renderFicha('/pacientes/1/agendamentos', { permissoes: ['pacientes.ver'] })

    // ASSERT — negada: cai na seção padrão (Painel), e a nav nem oferece Agendamentos
    expect(await screen.findByRole('heading', { level: 2, name: 'Painel' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Agendamentos' })).not.toBeInTheDocument()
  })

  it('deve navegar entre seções pela navegação lateral', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderFicha('/pacientes/1')
    await screen.findByRole('heading', { level: 1 })

    // ACT — abre Agendamentos
    await usuario.click(screen.getByRole('link', { name: 'Agendamentos' }))

    // ASSERT — o contador e a linha do tempo (do endpoint de 90 dias); o status
    // aparece na distribuição E na linha (por isso getAllByText)
    expect(await screen.findByText('1 atendimento')).toBeInTheDocument()
    expect(screen.getAllByText('Não Compareceu').length).toBeGreaterThan(0)
  })
})

describe('Ficha do paciente — seções', () => {
  // O mecanismo do slot reservado tem guarda própria em secao-reservada.test.tsx —
  // desde anexos-do-paciente nenhuma seção do REGISTRO está reservada para exercitar
  // o fluxo aqui (Crédito/Contrato/Diário virão como changes próprias).

  it('deve acender a seção Anexos com os documentos do paciente', async () => {
    // ARRANGE — fiação (registro + case + nav); regressão cairia no slot reservado
    servidor.use(
      msw.get('/api/pacientes/1/anexos', () =>
        HttpResponse.json([
          {
            id: 9,
            nome: 'encaminhamento-ficticio.pdf',
            mime: 'application/pdf',
            tamanho: 348160,
            criado_em: '2026-07-18 10:00',
            criado_por: { id: 1, nome: 'Operadora Fictícia' },
          },
        ]),
      ),
    )
    renderFicha('/pacientes/1/anexos', { permissoes: ['pacientes.ver', 'anexos.ver'] })

    // ASSERT — a lista renderizou; não é o slot reservado
    expect(await screen.findByText('encaminhamento-ficticio.pdf')).toBeInTheDocument()
    expect(screen.queryByText('Anexos — indisponível')).not.toBeInTheDocument()
  })

  it('deve acender a seção Financeiro com os lançamentos do paciente (filtro por interessado)', async () => {
    // ARRANGE — a seção reusa o painel de financeiro filtrado pelo interessado=paciente
    let paramsRecebidos: URLSearchParams | null = null
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json([])),
      msw.get('/api/lancamentos', ({ request }) => {
        paramsRecebidos = new URL(request.url).searchParams
        return HttpResponse.json({ data: [], current_page: 1, last_page: 1, per_page: 50, total: 0 })
      }),
    )
    renderFicha('/pacientes/1/financeiro', { permissoes: ['pacientes.ver', 'lancamentos.ver'] })

    // ASSERT — a listagem foi pedida com o interessado fixado no paciente da ficha
    await waitFor(() => {
      expect(paramsRecebidos).not.toBeNull()
    })
    expect((paramsRecebidos as URLSearchParams | null)?.get('interessado_tipo')).toBe('paciente')
    expect((paramsRecebidos as URLSearchParams | null)?.get('interessado_id')).toBe('1')
    // e não é o slot reservado
    expect(screen.queryByText('Financeiro — indisponível')).not.toBeInTheDocument()
  })

  it('deve acender a seção Prontuário com os atendimentos do paciente (filtro por paciente)', async () => {
    // ARRANGE — a fiação tem 3 pontos silenciosos (registro, case, nav); a regressão de
    // qualquer um cairia no slot reservado com a suíte verde. Espelho do teste do Financeiro.
    let paramsRecebidos: URLSearchParams | null = null
    servidor.use(
      msw.get('/api/atendimentos', ({ request }) => {
        paramsRecebidos = new URL(request.url).searchParams
        return HttpResponse.json({
          data: [
            {
              id: 30,
              agendamento_id: 40,
              iniciado_em: '2026-07-10 09:00',
              finalizado_em: '2026-07-10 09:40',
              evolucao_id: 7,
              updated_at: '2026-07-10 10:00:00',
            },
          ],
          current_page: 1,
          last_page: 1,
          per_page: 50,
          total: 1,
        })
      }),
    )
    renderFicha('/pacientes/1/prontuario', {
      permissoes: ['pacientes.ver', 'evolucoes.ver', 'atendimentos.ver'],
    })

    // ASSERT — a listagem foi pedida com o paciente da ficha; a linha renderizou; não é slot
    await waitFor(() => {
      expect(paramsRecebidos).not.toBeNull()
    })
    expect((paramsRecebidos as URLSearchParams | null)?.get('paciente_id')).toBe('1')
    expect(await screen.findByText('10/07/2026 às 09:40')).toBeInTheDocument()
    expect(screen.queryByText('Prontuário — indisponível')).not.toBeInTheDocument()
  })

  it('deve acender a seção Presença com a assiduidade do paciente', async () => {
    // ARRANGE — fiação (registro + case + nav); regressão cairia no slot reservado
    servidor.use(
      msw.get('/api/pacientes/1/presenca', () =>
        HttpResponse.json({
          janela: { de: '2025-07-18', ate: '2026-07-18' },
          totais: { compareceu: 5, faltas: 1, outros: 0, total: 6 },
          taxa_comparecimento: '83.3',
          faltas_consecutivas: { consecutivas: 1, limite: 3 },
          ultima_falta_em: '2026-07-10',
          faltas: [
            {
              id: 5,
              data: '2026-07-10',
              status: { id: 4, nome: 'Não Compareceu', cor: '#dd6666', cor_borda: null, tipo: null },
            },
          ],
          // forma do SERVIDOR: a quebra por profissional viaja sempre (fixture de contrato)
          sessoes_por_profissional: [
            {
              profissional: { id: 1, nome: 'Profissional Fictício da Ficha' },
              especialidade: { id: 1, nome: 'Fonoaudiologia Fictícia' },
              finalizadas: 5,
            },
          ],
        }),
      ),
    )
    renderFicha('/pacientes/1/presenca', { permissoes: ['pacientes.ver', 'agenda.ver'] })

    // ASSERT — o resumo renderizou; não é o slot reservado
    expect(await screen.findByText('Assiduidade — últimos 12 meses')).toBeInTheDocument()
    expect(screen.getByText('83,3%')).toBeInTheDocument()
    expect(screen.queryByText('Presença — indisponível')).not.toBeInTheDocument()
  })

  it('não deve oferecer Financeiro sem lancamentos.ver, nem por URL direta', async () => {
    // ARRANGE — sem a permissão da seção
    renderFicha('/pacientes/1/financeiro', { permissoes: ['pacientes.ver'] })

    // ASSERT — negada: cai na seção padrão (Painel), e a nav nem oferece Financeiro
    expect(await screen.findByRole('heading', { level: 2, name: 'Painel' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Financeiro' })).not.toBeInTheDocument()
  })

  it('deve mostrar o estado VAZIO em Agendamentos sem registros', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/:id/agendamentos', () =>
        HttpResponse.json({
          proximos: { janela: { de: '2026-06-01', ate: null }, total: 0, itens: [] },
          recentes: { janela: { de: '2026-03-03', ate: '2026-06-01' }, total: 0, itens: [] },
        }),
      ),
    )

    // ACT
    renderFicha('/pacientes/1/agendamentos')

    // ASSERT — cada bloco explica o SEU vazio, com a frase que orienta (não só o título)
    expect(await screen.findByText('Nenhuma sessão marcada')).toBeInTheDocument()
    expect(screen.getByText('Este paciente não tem sessão agendada daqui para a frente.')).toBeInTheDocument()
    expect(screen.getByText('Sem atendimentos nesta janela')).toBeInTheDocument()
    expect(
      screen.getByText('Este paciente não teve atendimentos nos últimos 90 dias.'),
    ).toBeInTheDocument()
  })

  it('deve mostrar erro numa seção sem quebrar o resto da ficha', async () => {
    // ARRANGE — o resumo falha (403 não re-tenta); a ficha (header + nav) segue de pé
    servidor.use(msw.get('/api/pacientes/:id/resumo', () => new HttpResponse(null, { status: 403 })))

    // ACT
    renderFicha('/pacientes/1/painel')

    // ASSERT — erro NA seção, com repetir; o resto utilizável
    const erro = await screen.findByRole('alert')
    expect(erro).toHaveTextContent('Não foi possível carregar o resumo')
    expect(within(erro).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Paciente Fictício' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cadastro' })).toBeInTheDocument()
  })

  it('deve ler o cadastro (DescriptionList) e levar ao formulário de edição', async () => {
    // ARRANGE — Cadastro em leitura + Editar (destino), sob pacientes.editar
    const usuario = userEvent.setup()
    renderFicha('/pacientes/1/cadastro', { permissoes: ['pacientes.ver', 'pacientes.editar'] })

    // ASSERT — leitura (o responsável do fixture só aparece na seção Cadastro)
    expect(await screen.findByText('Responsáveis')).toBeInTheDocument()
    expect(screen.getByText(/Responsável Fictícia/)).toBeInTheDocument()

    // ACT — Editar é DESTINO
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))

    // ASSERT
    expect(await screen.findByText('Formulário de edição')).toBeInTheDocument()
  })

  it('deve renderizar o Cadastro quando as colunas JSON vêm NULL (não [])', async () => {
    // ARRANGE — dado REAL do servidor: consentimentos/contatos/endereço vêm `null`,
    // não `[]` (a fixture mentia com `[]`; ao vivo o `null.length` derrubava a ficha)
    servidor.use(
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json(
          pacienteFicticio({
            id: 1,
            nome: 'Paciente Fictício',
            consentimentos_json: null,
            contatos_json: null,
            responsaveis_json: null,
            endereco_json: null,
          }),
        ),
      ),
    )

    // ACT
    renderFicha('/pacientes/1/cadastro')

    // ASSERT — a leitura aparece, sem estourar o error boundary
    expect(await screen.findByText('Necessidade')).toBeInTheDocument()
    expect(screen.queryByText(/Algo deu errado/)).not.toBeInTheDocument()
  })

  it('não deve oferecer Editar sem pacientes.editar', async () => {
    // ARRANGE
    renderFicha('/pacientes/1/cadastro', { permissoes: ['pacientes.ver'] })

    // ASSERT
    await screen.findByText('Responsáveis')
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
  })

  it('não deve guardar dado de paciente no armazenamento local (a seção vive na URL)', async () => {
    // ARRANGE + ACT — navega de seção; o auditor global do setup reprova PII no disco
    const usuario = userEvent.setup()
    renderFicha('/pacientes/1')
    await screen.findByRole('heading', { level: 1 })
    await usuario.click(screen.getByRole('link', { name: 'Cadastro' }))
    await screen.findByText('Responsáveis')

    // ASSERT — nada do paciente no localStorage
    expect(JSON.stringify(window.localStorage)).not.toContain('Paciente Fictício')
  })
})

/**
 * O CONVÊNIO NA FICHA (change convenio-no-cadastro-do-paciente, task 7.8).
 *
 * Esta é a tela que a recepção abre para atender. Sem estes campos aqui, o pedido
 * original — "não precisar abrir um pacote para saber de que plano a família é" — ficava
 * pela metade: ela deixaria de abrir um pacote para passar a clicar em "Editar". A
 * conferência ao vivo foi o que mostrou isso; o design tinha classificado como adiável.
 */
describe('Ficha do paciente — o convênio vigente', () => {
  it('deve mostrar convênio, plano e carteirinha na seção Cadastro', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json(
          pacienteFicticio({
            id: 1,
            convenio_id: 7,
            convenio: { id: 7, nome: 'Convênio Fictício A', particular: false },
            plano: 'Plano Fictício',
            carteirinha: '99887766',
            carteirinha_validade: '2027-12-31',
          }),
        ),
      ),
    )

    // ACT
    renderFicha('/pacientes/1/cadastro')

    // ASSERT — o NOME do convênio, não o id; e a carteirinha, que vive no detalhe
    expect(await screen.findByText('Convênio Fictício A')).toBeInTheDocument()
    expect(screen.getByText('Plano Fictício')).toBeInTheDocument()
    expect(screen.getByText('99887766')).toBeInTheDocument()
    expect(screen.getByText('31/12/2027')).toBeInTheDocument()
  })

  it('NÃO deve encher a ficha de travessões quando a criança é particular', async () => {
    /*
     * ARRANGE — sem convênio, os quatro rótulos não podem aparecer vazios: a ficha da
     * criança particular ganharia quatro linhas dizendo "—" sobre nada.
     */
    servidor.use(
      msw.get('/api/pacientes/:id', () => HttpResponse.json(pacienteFicticio({ id: 1 }))),
    )

    // ACT
    renderFicha('/pacientes/1/cadastro')

    // ASSERT
    /*
     * A âncora espera um VALOR do cadastro, não o cabeçalho da seção.
     *
     * A primeira versão esperava `heading 'Cadastro'` — que renderiza no ESQUELETO, antes
     * de o paciente chegar. A asserção de ausência rodava contra um DOM vazio e passava
     * fizesse o componente o que fizesse: a mutação que devolve os travessões sobrevivia.
     */
    await screen.findByText('Sem necessidade especial')
    expect(screen.queryByText('Convênio')).not.toBeInTheDocument()
    expect(screen.queryByText('Carteirinha')).not.toBeInTheDocument()
  })
})

/**
 * O CONVÊNIO NO PAINEL (pedido do usuário, 2026-08-26).
 *
 * O Painel é o que abre quando se entra no paciente, e o convênio é o que a recepção precisa
 * saber ANTES de qualquer coisa quando a família liga ou chega no balcão.
 */
describe('Ficha do paciente — o convênio no Painel', () => {
  it('deve abrir o painel com convênio e carteirinha', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json(
          pacienteFicticio({
            id: 1,
            convenio_id: 7,
            convenio: { id: 7, nome: 'Unimed', particular: false },
            carteirinha: '99887766',
          }),
        ),
      ),
    )

    // ACT
    renderFicha('/pacientes/1')

    // ASSERT
    expect(await screen.findByText('Unimed')).toBeInTheDocument()
    expect(screen.getByText('99887766')).toBeInTheDocument()
  })

  it('NÃO deve pedir a carteirinha ao endpoint de RESUMO', async () => {
    /*
     * ARRANGE — o `/resumo` é agregado e omite identificadores de propósito (SEC-FP-02). A
     * carteirinha é da classe do CPF; lê-se do CADASTRO, que é a fonte única da identidade e
     * já está carregado para o cabeçalho.
     *
     * Sem esta célula, alguém "simplificaria" acrescentando o campo ao resumo — e reabriria
     * exatamente o que aquela decisão fechou.
     */
    let resumoPedido = false
    servidor.use(
      msw.get('/api/pacientes/:id/resumo', () => {
        resumoPedido = true
        return HttpResponse.json(RESUMO)
      }),
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json(
          pacienteFicticio({
            id: 1,
            convenio: { id: 7, nome: 'Unimed', particular: false },
            carteirinha: '99887766',
          }),
        ),
      ),
    )

    // ACT
    renderFicha('/pacientes/1')
    await screen.findByText('99887766')

    // ASSERT — o resumo continua sendo consultado (ele traz as sessões), e a carteirinha NÃO
    // veio dele: a resposta dele é a fixture, que não a tem
    expect(resumoPedido).toBe(true)
    expect(Object.keys(RESUMO)).not.toContain('carteirinha')
  })

  it('NÃO deve encher o painel de travessões quando a criança é particular', async () => {
    // ARRANGE — sem convênio, as duas linhas não podem aparecer vazias
    servidor.use(msw.get('/api/pacientes/:id', () => HttpResponse.json(pacienteFicticio({ id: 1 }))))

    // ACT
    renderFicha('/pacientes/1')

    // ASSERT — o painel carregou (a sessão é da fixture do resumo) e não há rótulo de convênio
    await screen.findByText('Sessões realizadas')
    expect(screen.queryByText('Convênio')).not.toBeInTheDocument()
    expect(screen.queryByText('Carteirinha')).not.toBeInTheDocument()
  })
})

/**
 * A ficha do paciente INATIVO (change paciente-inativo-com-saida).
 *
 * O caso que a clínica trouxe em 14/09/2026: a recepção queria voltar a atender uma criança
 * antiga, chegava aqui pela lista de inativos e não achava caminho nenhum — a etiqueta dizia
 * "Inativo" e mais nada, enquanto o paciente sumia da agenda sem explicação.
 */
describe('Ficha do paciente — cadastro inativo', () => {
  const INATIVO = pacienteFicticio({ id: 1, nome: 'Paciente Fictício', ativo: false })

  it('deve dizer o que estar inativo causa e oferecer Reativar a quem pode editar', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/pacientes/:id', () => HttpResponse.json(INATIVO)))

    // ACT
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver', 'pacientes.editar'] })
    await screen.findByRole('heading', { level: 1, name: 'Paciente Fictício' })

    // ASSERT — a consequência escrita, não só a etiqueta; e a saída ao lado
    expect(screen.getByText('Cadastro inativo:')).toBeInTheDocument()
    expect(screen.getByText(/não aparece na agenda, na fila nem nas buscas de paciente/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reativar' })).toBeInTheDocument()
  })

  it('deve manter o aviso e esconder a ação de quem não pode editar o cadastro', async () => {
    // ARRANGE — o que falta a essa pessoa é a INFORMAÇÃO, não o botão
    servidor.use(msw.get('/api/pacientes/:id', () => HttpResponse.json(INATIVO)))

    // ACT
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver'] })
    await screen.findByRole('heading', { level: 1, name: 'Paciente Fictício' })

    // ASSERT
    expect(screen.getByText('Cadastro inativo:')).toBeInTheDocument()
    expect(screen.getByText(/Reativar depende de quem pode editar o cadastro/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reativar' })).not.toBeInTheDocument()
  })

  it('NÃO deve mostrar o aviso quando o cadastro está ativo', async () => {
    // ARRANGE + ACT
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver', 'pacientes.editar'] })
    await screen.findByRole('heading', { level: 1, name: 'Paciente Fictício' })

    // ASSERT
    expect(screen.queryByText('Cadastro inativo:')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reativar' })).not.toBeInTheDocument()
  })

  it('deve reativar pela própria ficha, sem formulário e sem exigir campo do cadastro', async () => {
    // ARRANGE — pré-cadastrado: sem nascimento e sem necessidade, como o balcão o cria. Pelo
    // PUT-inteiro seria preciso INVENTAR data de nascimento e dado de saúde de um MENOR.
    const usuario = userEvent.setup()
    const preCadastrado = pacienteFicticio({ id: 1, nome: 'Paciente Fictício', ativo: false, nascimento: null, necessidade: null })
    const capturado: { payload?: Record<string, unknown>; versao?: string | null } = {}
    let ativo = false
    servidor.use(
      msw.get('/api/pacientes/:id', () => HttpResponse.json({ ...preCadastrado, ativo })),
      msw.patch('/api/pacientes/:id/situacao', async ({ request }) => {
        capturado.payload = (await request.json()) as Record<string, unknown>
        capturado.versao = request.headers.get('If-Match')
        ativo = true
        return HttpResponse.json({ id: 1, ativo: true, updated_at: preCadastrado.updated_at })
      }),
      // o PUT-inteiro NÃO pode ser usado para isto: se for chamado, o teste enxerga
      msw.put('/api/pacientes/:id', () => HttpResponse.json({ message: 'não devia' }, { status: 500 })),
    )

    // ACT
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver', 'pacientes.editar'] })
    await usuario.click(await screen.findByRole('button', { name: 'Reativar' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: /Reativar Paciente Fictício\?/ })).toBeInTheDocument()
    await usuario.click(within(dialog).getByRole('button', { name: 'Reativar' }))

    // ASSERT — uma chave só, com a versão no header, e a faixa some sem recarregar a página
    await waitFor(() => {
      expect(capturado.payload).toEqual({ ativo: true })
    })
    expect(capturado.versao).toBe(preCadastrado.updated_at)
    await waitFor(() => {
      expect(screen.queryByText('Cadastro inativo:')).not.toBeInTheDocument()
    })
  })

  it('deve devolver o foco à seção depois de reativar', async () => {
    // ARRANGE — a faixa some junto com o botão que tinha o foco (WCAG 2.4.3)
    const usuario = userEvent.setup()
    let ativo = false
    servidor.use(
      msw.get('/api/pacientes/:id', () => HttpResponse.json({ ...INATIVO, ativo })),
      msw.patch('/api/pacientes/:id/situacao', () => {
        ativo = true
        return HttpResponse.json({ id: 1, ativo: true, updated_at: INATIVO.updated_at })
      }),
    )

    // ACT
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver', 'pacientes.editar'] })
    await usuario.click(await screen.findByRole('button', { name: 'Reativar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: 'Reativar' }))

    // ASSERT — o foco não caiu no body
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Painel' })).toHaveFocus()
    })
  })

  it('deve dizer a recusa do servidor e continuar mostrando o cadastro como inativo', async () => {
    // ARRANGE — o servidor é quem decide; a tela não pode fingir que reativou
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/pacientes/:id', () => HttpResponse.json(INATIVO)),
      msw.patch('/api/pacientes/:id/situacao', () =>
        HttpResponse.json({ message: 'Você não tem permissão para esta ação.' }, { status: 403 }),
      ),
    )

    // ACT
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver', 'pacientes.editar'] })
    await usuario.click(await screen.findByRole('button', { name: 'Reativar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: 'Reativar' }))

    // ASSERT — a recusa é dita, e o aviso continua de pé
    expect(await screen.findByText('Você não tem acesso a este recurso.')).toBeInTheDocument()
    expect(screen.getByText('Cadastro inativo:')).toBeInTheDocument()
  })
})

/**
 * Os dois achados do parecer de segurança pré-código (SEC-PIS-05 e SEC-PIS-06) que a ficha
 * amplifica: ela é página de LEITURA, fica aberta, e por isso a janela entre o que a tela
 * mostra e o que o servidor tem é grande.
 */
describe('Ficha do paciente — reativar não pode mentir', () => {
  it('deve mandar no If-Match a versão que HIDRATOU a tela, não uma relida na hora', async () => {
    // ARRANGE — enquanto o serviço relia o cadastro só para montar o `If-Match`, a versão
    // validada era sempre a de meio segundo atrás: o 409 não disparava NUNCA, e a
    // concorrência otimista deste caminho era teatro (SEC-PIS-05). Aqui o servidor muda de
    // versão depois que a tela hidratou — quem reler vai mandar a NOVA e o teste cai.
    const usuario = userEvent.setup()
    const inativo = pacienteFicticio({ id: 1, nome: 'Paciente Fictício', ativo: false })
    let leituras = 0
    const capturado: { versao?: string | null } = {}
    servidor.use(
      msw.get('/api/pacientes/:id', () => {
        leituras += 1
        return HttpResponse.json({
          ...inativo,
          // a primeira leitura é a que a tela mostra; da segunda em diante, outra versão
          updated_at: leituras === 1 ? '2026-07-15T10:00:00.000000Z' : '2026-09-14T08:00:00.000000Z',
        })
      }),
      msw.patch('/api/pacientes/:id/situacao', ({ request }) => {
        capturado.versao = request.headers.get('If-Match')
        return HttpResponse.json({ id: 1, ativo: true, updated_at: '2026-09-14T09:00:00.000000Z' })
      }),
    )

    // ACT
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver', 'pacientes.editar'] })
    await usuario.click(await screen.findByRole('button', { name: 'Reativar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: 'Reativar' }))

    // ASSERT
    await waitFor(() => {
      expect(capturado.versao).toBe('2026-07-15T10:00:00.000000Z')
    })
  })

  it('deve invalidar também a seleção da AGENDA ao reativar', async () => {
    // ARRANGE — a caixa de paciente da agenda vive noutra raiz de cache; sem esta invalidação
    // ela seguia dizendo "existe cadastro inativo com esse nome" depois da reativação, servida
    // pelo cache (SEC-PIS-06)
    const usuario = userEvent.setup()
    let ativo = false
    servidor.use(
      msw.get('/api/pacientes/:id', () => HttpResponse.json({ ...pacienteFicticio({ id: 1 }), ativo })),
      msw.patch('/api/pacientes/:id/situacao', () => {
        ativo = true
        return HttpResponse.json({ id: 1, ativo: true, updated_at: '2026-09-14T09:00:00.000000Z' })
      }),
    )
    queryClient.setQueryData(chaves.pacientesDaBusca('paciente'), { pacientes: [], existeInativo: true })

    // ACT
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver', 'pacientes.editar'] })
    await usuario.click(await screen.findByRole('button', { name: 'Reativar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: 'Reativar' }))

    // ASSERT — a busca da agenda foi marcada como suja
    await waitFor(() => {
      expect(queryClient.getQueryState(chaves.pacientesDaBusca('paciente'))?.isInvalidated).toBe(true)
    })
  })
})

describe('Ficha do paciente — o conflito de versão tem saída', () => {
  it('deve reconsultar o cadastro no 409, para a tentativa seguinte sair com a versão fresca', async () => {
    // ARRANGE — o `If-Match` passou a ser a versão que hidratou a tela, e com isso o 409 começou a
    // disparar de verdade. A mensagem manda "recarregue", mas a ficha é LEITURA: não tem botão de
    // recarregar e não recarrega sozinha. Sem invalidar aqui, o segundo clique reenviava a MESMA
    // versão velha e o laço só saía com F5 (parecer SEC-PIS-11).
    const usuario = userEvent.setup()
    const versoes: (string | null)[] = []
    let leituras = 0
    servidor.use(
      msw.get('/api/pacientes/:id', () => {
        leituras += 1
        return HttpResponse.json({
          ...pacienteFicticio({ id: 1, nome: 'Paciente Fictício', ativo: false }),
          updated_at: leituras === 1 ? '2026-07-15T10:00:00.000000Z' : '2026-09-14T08:00:00.000000Z',
        })
      }),
      msw.patch('/api/pacientes/:id/situacao', ({ request }) => {
        versoes.push(request.headers.get('If-Match'))
        return HttpResponse.json({ message: 'conflito' }, { status: 409 })
      }),
    )

    // ACT — duas tentativas seguidas, sem sair da página
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver', 'pacientes.editar'] })
    await usuario.click(await screen.findByRole('button', { name: 'Reativar' }))
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reativar' }))
    await waitFor(() => {
      expect(versoes).toHaveLength(1)
    })
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Reativar' }))

    // ASSERT — a segunda tentativa não repete a versão velha
    await waitFor(() => {
      expect(versoes).toHaveLength(2)
    })
    expect(versoes[1]).not.toBe(versoes[0])
  })
})

describe('Ficha do paciente — cancelar devolve o foco ao próprio botão', () => {
  it('deve manter a faixa e devolver o foco ao gatilho quando a pessoa desiste', async () => {
    // ARRANGE — o destino explícito de foco só vale quando a troca ACONTECE e o gatilho some.
    // Sem esta guarda, mexer no `focoAoFechar` podia mandar o cancelamento para o `body` com a
    // suíte verde (lacuna apontada pelo a11y-auditor no gate).
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json(pacienteFicticio({ id: 1, nome: 'Paciente Fictício', ativo: false })),
      ),
    )

    // ACT
    renderFicha('/pacientes/1', { permissoes: ['pacientes.ver', 'pacientes.editar'] })
    const reativar = await screen.findByRole('button', { name: 'Reativar' })
    await usuario.click(reativar)
    await usuario.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }))

    // ASSERT — nada mudou, e o foco não se perdeu
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Cadastro inativo:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reativar' })).toHaveFocus()
  })
})
