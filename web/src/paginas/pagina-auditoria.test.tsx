import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it } from 'vitest'

import { ExigePermissao } from '@/componentes/acesso-negado'
import { queryClient } from '@/lib/query-client'
import { PaginaAuditoria } from '@/paginas/pagina-auditoria'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { LinhaAuditoria } from '@/tipos'

expect.extend(toHaveNoViolations)

function linha(sobrescritas: Partial<LinhaAuditoria> & Pick<LinhaAuditoria, 'id'>): LinhaAuditoria {
  return {
    entidade: 'pacientes',
    entidade_id: 7,
    acao: 'atualizou',
    autor: 'Admin Fictícia',
    autor_tipo: 'usuario',
    criado_em: '2026-07-27 14:00:00',
    alteracoes: [{ campo: 'Telefone', de: '1111', para: '2222' }],
    ...sobrescritas,
  }
}

/** Página do Laravel com defaults de 1 página. */
function pagina(data: LinhaAuditoria[], extras: Record<string, number> = {}) {
  return { data, current_page: 1, last_page: 1, per_page: 50, total: data.length, ...extras }
}

/** Prepara a trilha e CAPTURA os params de cada consulta (a tela filtra pela API). */
function prepararTrilha(resposta: (params: URLSearchParams) => Record<string, unknown>) {
  const consultas: URLSearchParams[] = []
  servidor.use(
    msw.get('/api/auditoria', ({ request }) => {
      const params = new URL(request.url).searchParams
      consultas.push(params)
      return HttpResponse.json(resposta(params))
    }),
    msw.get('/api/usuarios', () => HttpResponse.json([{ id: 5, nome: 'Recepção Fictícia' }])),
  )
  return consultas
}

function renderizar(permissoes: string[] = ['auditoria.ver'], rota = '/auditoria') {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[rota]}>
        <ExigePermissao permissao="auditoria.ver">
          <PaginaAuditoria />
        </ExigePermissao>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

it('deve negar a tela a quem não tem auditoria.ver', () => {
  // ARRANGE + ACT
  prepararTrilha(() => pagina([]))
  renderizar([])

  // ASSERT — acesso negado padrão; a trilha nem é montada
  expect(screen.getByText('Você não tem acesso a esta tela')).toBeInTheDocument()
  expect(screen.queryByText('Auditoria')).not.toBeInTheDocument()
})

it('deve listar a trilha com quando, ação, entidade e autor', async () => {
  // ARRANGE
  prepararTrilha(() => pagina([linha({ id: 1 }), linha({ id: 2, acao: 'excluiu', autor: 'Sistema' })]))

  // ACT
  renderizar()

  // ASSERT — linha legível: data na parede, rótulos humanos, autor pelo nome.
  // A âncora de espera é a DATA (só existe na tabela) — "Atualizou"/"Excluiu"
  // também são options do filtro e casariam antes de os dados chegarem.
  expect(await screen.findAllByText('27/07/2026 às 14:00')).toHaveLength(2)
  expect(screen.getByText('Admin Fictícia')).toBeInTheDocument()
  expect(screen.getByText('Sistema')).toBeInTheDocument()
  // ação nas CÉLULAS além das options do filtro
  expect(screen.getAllByText('Atualizou').length).toBeGreaterThan(1)
  expect(screen.getAllByText('Excluiu').length).toBeGreaterThan(1)
  expect(screen.getAllByText(/Pacientes/)).not.toHaveLength(0)
})

it('deve dizer em palavras a purga do anexo do lançamento, e oferecê-la no filtro', async () => {
  // ARRANGE — a trilha registra `purgou` quando o anexo excluído sai de vez com o lançamento
  const consultas = prepararTrilha(() =>
    pagina([linha({ id: 1, entidade: 'lancamento_anexos', entidade_id: 9, acao: 'purgou', alteracoes: [] })]),
  )
  renderizar()
  await screen.findByText('27/07/2026 às 14:00')

  // ACT
  await userEvent.selectOptions(screen.getByLabelText('Ação'), 'purgou')

  // ASSERT — nunca a palavra crua na coluna; o filtro alcança a ação
  expect(screen.getAllByText('Purgou (apagou o arquivo de vez)').length).toBeGreaterThan(1)
  expect(screen.queryByText('purgou')).not.toBeInTheDocument()
  await waitFor(() => {
    expect(consultas.at(-1)?.get('acao')).toBe('purgou')
  })
})

it('deve filtrar pela API e voltar à página 1 quando um filtro muda', async () => {
  // ARRANGE
  const consultas = prepararTrilha(() => pagina([linha({ id: 1 })]))
  renderizar(['auditoria.ver'], '/auditoria?pagina=3')
  await screen.findByText('27/07/2026 às 14:00')

  // ACT — filtra por ação
  await userEvent.selectOptions(screen.getByLabelText('Ação'), 'excluiu')

  // ASSERT — a consulta seguinte leva acao=excluiu e NÃO leva a página velha
  await waitFor(() => {
    const ultima = consultas[consultas.length - 1]
    expect(ultima.get('acao')).toBe('excluiu')
    expect(ultima.get('page')).toBe('1')
  })
})

it('deve desabilitar o id do registro enquanto não há entidade', async () => {
  // ARRANGE
  prepararTrilha(() => pagina([linha({ id: 1 })]))
  renderizar()
  await screen.findByText('27/07/2026 às 14:00')

  // ASSERT — a API exige o par entidade+id; a tela explica em vez de deixar errar
  const campoId = screen.getByLabelText('Id do registro')
  expect(campoId).toBeDisabled()
  expect(screen.getByText('Escolha a entidade primeiro.')).toBeInTheDocument()

  // ACT — escolhida a entidade, o campo abre
  await userEvent.selectOptions(screen.getByLabelText('Entidade'), 'pacientes')
  await waitFor(() => {
    expect(screen.getByLabelText('Id do registro')).toBeEnabled()
  })
})

it('deve expandir o diff e manter o mascarado como protegido', async () => {
  // ARRANGE — alteração com campo sensível mascarado pela API
  prepararTrilha(() =>
    pagina([
      linha({
        id: 1,
        alteracoes: [
          { campo: 'Telefone', de: '1111', para: '2222' },
          { campo: 'CPF', de: '***', para: '***' },
        ],
      }),
    ]),
  )
  renderizar()

  // ACT — expande pelo disclosure
  const alternar = await screen.findByRole('button', { name: '2 campos' })
  expect(alternar).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(alternar)

  // ASSERT — diff campo a campo; o mascarado NUNCA vira valor
  expect(alternar).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('Telefone:')).toBeInTheDocument()
  expect(screen.getByText('1111')).toBeInTheDocument()
  expect(screen.getByText('2222')).toBeInTheDocument()
  expect(screen.getAllByText('protegido')).toHaveLength(2)
})

it('deve não oferecer expansão para o evento de criação (compacto por spec)', async () => {
  // ARRANGE — criação chega com o payload completo, mas a tela a exibe compacta
  prepararTrilha(() =>
    pagina([linha({ id: 1, acao: 'criou', alteracoes: [{ campo: 'Nome', de: null, para: 'X' }] })]),
  )

  // ACT
  renderizar()

  // ASSERT — espera a linha chegar; a criação não oferece expansão
  await screen.findByText('27/07/2026 às 14:00')
  expect(screen.getAllByText('Criou').length).toBeGreaterThan(1)
  expect(screen.queryByRole('button', { name: /campo/ })).not.toBeInTheDocument()
})

it('deve distinguir o vazio DE FILTRO do vazio absoluto, com limpar', async () => {
  // ARRANGE — recorte vazio com filtro ativo na URL
  const consultas = prepararTrilha(() => pagina([]))
  renderizar(['auditoria.ver'], '/auditoria?acao=consultou')

  // ASSERT — o vazio explica o recorte e oferece limpar
  expect(await screen.findByText('Nada casa com estes filtros.')).toBeInTheDocument()

  // ACT — limpar volta à trilha completa
  await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
  await waitFor(() => {
    const ultima = consultas[consultas.length - 1]
    expect(ultima.get('acao')).toBeNull()
  })
  expect(await screen.findByText('Nenhuma movimentação registrada ainda.')).toBeInTheDocument()
})

it('deve preservar os filtros ao mudar de página', async () => {
  // ARRANGE — duas páginas com ação filtrada
  const consultas = prepararTrilha((params) =>
    pagina([linha({ id: Number(params.get('page') ?? 1) })], {
      current_page: Number(params.get('page') ?? 1),
      last_page: 2,
      total: 51,
    }),
  )
  renderizar(['auditoria.ver'], '/auditoria?acao=atualizou')
  await screen.findByText('27/07/2026 às 14:00')

  // ACT
  await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }))

  // ASSERT — page=2 COM o filtro vivo
  await waitFor(() => {
    const ultima = consultas[consultas.length - 1]
    expect(ultima.get('page')).toBe('2')
    expect(ultima.get('acao')).toBe('atualizou')
  })
})

it('deve passar no axe sem violações', async () => {
  // ARRANGE
  prepararTrilha(() => pagina([linha({ id: 1 })]))
  const { container } = renderizar()
  await screen.findByText('27/07/2026 às 14:00')

  // ACT + ASSERT
  expect(await axe(container)).toHaveNoViolations()
})

it('deve degradar o filtro de usuário para campo numérico quando a leitura de gestão nega', async () => {
  // ARRANGE — D3: sem usuarios.ver o select não existe; o campo numérico assume
  const consultas = prepararTrilha(() => pagina([linha({ id: 1 })]))
  servidor.use(msw.get('/api/usuarios', () => new HttpResponse(null, { status: 403 })))
  renderizar()
  await screen.findByText('27/07/2026 às 14:00')

  // ACT — digita o id no fallback
  const campo = await screen.findByLabelText('Usuário (id)')
  await userEvent.type(campo, '5')

  // ASSERT — o filtro chega à API (com o silêncio do debounce)
  await waitFor(() => {
    const ultima = consultas[consultas.length - 1]
    expect(ultima.get('usuario_id')).toBe('5')
  })
})

it('deve mostrar os valores anteriores ao expandir uma exclusão', async () => {
  // ARRANGE — exclusão carrega o que existia (de preenchido, para vazio)
  prepararTrilha(() =>
    pagina([
      linha({
        id: 1,
        acao: 'excluiu',
        alteracoes: [{ campo: 'Título', de: 'Aviso fictício apagado', para: null }],
      }),
    ]),
  )
  renderizar()

  // ACT
  await userEvent.click(await screen.findByRole('button', { name: '1 campo' }))

  // ASSERT — o valor anterior aparece; o "depois" é o traço de vazio
  expect(screen.getByText('Aviso fictício apagado')).toBeInTheDocument()
  expect(screen.getByText('—')).toBeInTheDocument()
})

it('deve render valor estruturado como JSON legível, nunca object Object', async () => {
  // ARRANGE — diff com array (ex.: campos_json de um modelo de anamnese)
  prepararTrilha(() =>
    pagina([
      linha({
        id: 1,
        entidade: 'anamnese_modelos',
        alteracoes: [{ campo: 'Campos', de: [{ id: 'a' }], para: [{ id: 'a' }, { id: 'b' }] }],
      }),
    ]),
  )
  renderizar()

  // ACT
  await userEvent.click(await screen.findByRole('button', { name: '1 campo' }))

  // ASSERT — JSON legível (I1); jamais a stringificação quebrada
  expect(screen.getByText('[{"id":"a"}]')).toBeInTheDocument()
  expect(screen.getByText('[{"id":"a"},{"id":"b"}]')).toBeInTheDocument()
  expect(screen.queryByText(/object Object/)).not.toBeInTheDocument()
})

it('deve rotular a linha-mãe do lote na coluna e no filtro, nunca a ação crua', async () => {
  // ARRANGE — a trilha filtrada por ?acao=baixa_em_lote, como o manual manda chegar
  prepararTrilha(() =>
    pagina([
      linha({ id: 1, entidade: 'profissionais', entidade_id: 1, acao: 'baixa_em_lote' }),
      linha({ id: 2, entidade: 'profissionais', entidade_id: 1, acao: 'desmarque_em_lote' }),
    ]),
  )

  // ACT
  renderizar(['auditoria.ver'], '/auditoria?acao=baixa_em_lote')

  // ASSERT — a coluna traduz; o select mostra a ação filtrada (antes caía em "Criou")
  expect(await screen.findByText('Deu baixa em lote')).toBeInTheDocument()
  expect(screen.getByText('Desmarcou em lote')).toBeInTheDocument()
  expect(screen.queryByText(/baixa_em_lote|desmarque_em_lote/)).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Ação' })).toHaveValue('baixa_em_lote')
  expect(screen.getByRole('combobox', { name: 'Ação' })).toHaveDisplayValue('Deu baixa em lote')
})

it('deve listar os recusados do lote com o motivo traduzido, não como JSON', async () => {
  // ARRANGE — `recusados` da linha-mãe: `{agendamento_id, motivo}` por linha, como a API grava
  prepararTrilha(() =>
    pagina([
      linha({
        id: 1,
        entidade: 'profissionais',
        acao: 'baixa_em_lote',
        alteracoes: [
          {
            campo: 'Recusados',
            de: null,
            para: [
              { agendamento_id: 234, motivo: 'sem_saldo' },
              { agendamento_id: 238, motivo: 'ainda_nao_comecou' },
              { agendamento_id: 240, motivo: 'Frase crua do domínio.' },
            ],
          },
        ],
      }),
    ]),
  )
  renderizar()

  // ACT
  await userEvent.click(await screen.findByRole('button', { name: '1 campo' }))

  // ASSERT — uma linha por recusado, chave de máquina traduzida, frase do domínio como está
  expect(screen.getByText('agendamento #234 — Sem saldo no pacote')).toBeInTheDocument()
  expect(screen.getByText('agendamento #238 — Ainda não começou')).toBeInTheDocument()
  expect(screen.getByText('agendamento #240 — Frase crua do domínio.')).toBeInTheDocument()
  expect(screen.queryByText(/"motivo"|sem_saldo/)).not.toBeInTheDocument()
})

it('deve traduzir o motivo do recusado pelo dicionário da AÇÃO da linha-mãe', async () => {
  // ARRANGE — a baixa e o desmarque recusam por chaves próprias, e a mesma chave
  // (`atendimento_registrado`) tem frase diferente em cada um: "não pode virar falta" é razão
  // da baixa, nunca do desmarque
  prepararTrilha(() =>
    pagina([
      linha({
        id: 1,
        entidade: 'profissionais',
        acao: 'desmarque_em_lote',
        alteracoes: [
          {
            campo: 'Recusados',
            de: null,
            para: [
              { agendamento_id: 301, motivo: 'atendimento_registrado' },
              { agendamento_id: 302, motivo: 'ciclo_fechado' },
            ],
          },
        ],
      }),
      linha({
        id: 2,
        entidade: 'profissionais',
        acao: 'baixa_em_lote',
        alteracoes: [
          { campo: 'Aplicados', de: null, para: 12 },
          { campo: 'Recusados', de: null, para: [{ agendamento_id: 234, motivo: 'sem_saldo' }] },
        ],
      }),
    ]),
  )
  renderizar()

  // ACT — expande a linha do desmarque (só uma linha fica aberta por vez)
  await userEvent.click(await screen.findByRole('button', { name: '1 campo' }))

  // ASSERT — a língua do desmarque, nunca a da baixa
  expect(screen.getByText('agendamento #301 — atendimento já registrado')).toBeInTheDocument()
  expect(screen.getByText('agendamento #302 — faturamento do convênio já fechado')).toBeInTheDocument()
  expect(screen.queryByText(/não pode virar falta|Produção do período/)).not.toBeInTheDocument()

  // ACT — expande a linha da baixa
  await userEvent.click(screen.getByRole('button', { name: '2 campos' }))

  // ASSERT — a língua da baixa
  expect(screen.getByText('agendamento #234 — Sem saldo no pacote')).toBeInTheDocument()
  expect(screen.queryByText(/atendimento_registrado|ciclo_fechado|sem_saldo/)).not.toBeInTheDocument()
})
