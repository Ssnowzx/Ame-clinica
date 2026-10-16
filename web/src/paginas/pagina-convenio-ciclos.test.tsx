import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaConvenio } from '@/paginas/pagina-convenio'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type {
  Convenio,
  FechamentoDeCiclo,
  MotivoSemProximoCiclo,
  PeriodoDoCiclo,
  ProximoCiclo,
} from '@/tipos'

expect.extend(toHaveNoViolations)

/** Unimed fictícia: corte no dia 15 — o calendário real da clínica entra como DADO. */
const CONVENIO: Convenio = {
  id: 1,
  updated_at: '2026-07-15T10:00:00.000000Z',
  nome: 'Convênio Fictício',
  registro_ans: null,
  codigo_operadora: null,
  versao_tiss: null,
  guia_sequencial: false,
  alerta_agend_mesmo_dia: false,
  flags_tiss_json: null,
  particular: false,
  pedido_validade_meses: 6,
  ciclo_dia_corte: 15,
  ciclo_tipo_corte: 'dia_fixo',
  ativo: true,
}

const PROXIMO: PeriodoDoCiclo = { periodo_inicio: '2026-06-16', periodo_fim: '2026-07-15' }

/**
 * A resposta de `/ciclos/proximo` no contrato NOVO: `periodo` + `motivo`.
 *
 * O `null` sozinho respondia por DOIS estados opostos, e a tela lia os dois como
 * "configure o corte" — mandando a recepção arrumar, no dia seguinte ao 1º fechamento da
 * Unimed, um calendário que está certo (achado CR #2). O `satisfies` prende a fixture ao
 * contrato: fixture que mente sobre a forma do payload já custou um bloqueante aqui.
 */
function comPeriodo(periodo: PeriodoDoCiclo = PROXIMO): ProximoCiclo {
  return { periodo, motivo: null } satisfies ProximoCiclo
}

function semPeriodo(motivo: MotivoSemProximoCiclo): ProximoCiclo {
  return { periodo: null, motivo } satisfies ProximoCiclo
}

/**
 * Fechamento no shape EXATO do contrato — `aberto` vem do SERVIDOR (a tela nunca o
 * deriva de `reaberto_em`). Fixture que mente sobre a forma do payload já custou um
 * bloqueante nesta base; por isso o `satisfies`.
 */
function fechamento(sobrescritas: Partial<FechamentoDeCiclo> = {}): FechamentoDeCiclo {
  return {
    id: 1,
    periodo_inicio: '2026-05-16',
    periodo_fim: '2026-06-15',
    fechado_por: { id: 9, nome: 'Faturamento Fictício' },
    fechado_em: '2026-06-16 09:30',
    reaberto_por: null,
    reaberto_em: null,
    aberto: true,
    ...sobrescritas,
  } satisfies FechamentoDeCiclo
}

const SO_FECHAR = ['convenios.ver', 'ciclos.fechar']
const FECHAR_E_REABRIR = ['convenios.ver', 'ciclos.fechar', 'ciclos.reabrir']

function renderizar(permissoes: string[] = FECHAR_E_REABRIR) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/convenios/1']}>
          {/* O `main` do `AppShell`: sem ele a varredura axe acusa `region` na página
              inteira — ruído do harness, não da tela (a rota real vive dentro dele). */}
          <main>
            <Routes>
              <Route path="/convenios/:id" element={<PaginaConvenio />} />
            </Routes>
          </main>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
  servidor.use(
    msw.get('/api/convenios/:id', () => HttpResponse.json(CONVENIO)),
    msw.get('/api/convenios/:id/servicos', () => HttpResponse.json([])),
    msw.get('/api/convenios/:id/regras', () => HttpResponse.json([])),
    msw.get('/api/especialidades', () => HttpResponse.json([])),
    msw.get('/api/convenios/:id/ciclos/proximo', () => HttpResponse.json(comPeriodo())),
    msw.get('/api/convenios/:id/ciclos', () => HttpResponse.json([fechamento()])),
  )
})

describe('Ciclos de faturamento — a seção não é oráculo de calendário (SEC-FC-09)', () => {
  it('deve não existir para quem não tem ciclos.fechar', async () => {
    // ARRANGE — quem administra o cadastro do convênio não fecha faturamento. Sem a
    // permissão a seção não pode existir: quem recebe um 422 de ciclo fechado em outra
    // tela não pode aprender AQUI quando cada operadora fecha nem quem fechou o quê.
    renderizar(['convenios.ver', 'convenios.editar'])

    // ACT — espera a página montar de verdade (o `h1` é o nome do convênio)
    await screen.findByRole('heading', { level: 1, name: 'Convênio Fictício' })

    // ASSERT
    expect(
      screen.queryByRole('heading', { name: 'Ciclos de faturamento' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Fechar período/i })).not.toBeInTheDocument()
  })

  it('deve não CONSULTAR os ciclos sem a permissão', async () => {
    // ARRANGE — esconder a seção e mesmo assim pedir a lista deixaria o dado atravessar
    // a rede (e o 403 no console é, ele próprio, sinal de que o convênio tem calendário)
    let consultou = false
    servidor.use(
      msw.get('/api/convenios/:id/ciclos', () => {
        consultou = true
        return HttpResponse.json([])
      }),
      msw.get('/api/convenios/:id/ciclos/proximo', () => {
        consultou = true
        return HttpResponse.json(semPeriodo('sem_calendario'))
      }),
    )

    // ACT
    renderizar(['convenios.ver'])
    await screen.findByRole('heading', { level: 1, name: 'Convênio Fictício' })

    // ASSERT
    expect(consultou).toBe(false)
  })
})

describe('Ciclos de faturamento — fechar o período', () => {
  it('deve listar os fechamentos com período, quem fechou, quando e a situação', async () => {
    // ARRANGE — a tabela é append-only: um período reaberto CONTINUA na lista, e a
    // reabertura precisa ter dono visível
    servidor.use(
      msw.get('/api/convenios/:id/ciclos', () =>
        HttpResponse.json([
          fechamento(),
          fechamento({
            id: 2,
            periodo_inicio: '2026-04-16',
            periodo_fim: '2026-05-15',
            reaberto_por: { id: 3, nome: 'Administradora Fictícia' },
            reaberto_em: '2026-05-20 14:05',
            aberto: false,
          }),
        ]),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — legível para o balcão
    const tabela = await screen.findByRole('table', { name: /Períodos fechados/i })
    expect(tabela).toHaveTextContent('16/05/2026 a 15/06/2026')
    expect(tabela).toHaveTextContent('Faturamento Fictício')
    expect(tabela).toHaveTextContent('16/06/2026 às 09:30')
    expect(tabela).toHaveTextContent('Fechado')
    expect(tabela).toHaveTextContent('Reaberto por Administradora Fictícia em 20/05/2026 às 14:05')
  })

  it('deve mostrar o próximo período e fechá-lo com confirmação que o NOMEIA', async () => {
    // ARRANGE — quem deriva o período é o servidor; a tela exibe e envia de volta
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.post('/api/convenios/:id/ciclos', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(fechamento({ id: 3, ...PROXIMO }), { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Fechar período/i }))
    const dialogo = await screen.findByRole('alertdialog')

    // ASSERT — o alvo pelo nome e pelo período (§2), e a consequência REAL
    expect(dialogo).toHaveTextContent(
      'Fechar a produção de Convênio Fictício de 16/06/2026 a 15/07/2026?',
    )
    expect(dialogo).toHaveTextContent('deixam de aceitar edição')
    expect(dialogo).toHaveTextContent('Só o administrador reabre')

    // ACT — confirmar manda o período INTEIRO, no shape do contrato
    await usuario.click(within(dialogo).getByRole('button', { name: 'Fechar período' }))

    // ASSERT
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toEqual({ periodo_inicio: '2026-06-16', periodo_fim: '2026-07-15' })
  })

  it('deve explicar que falta configurar o corte quando o convênio não tem calendário', async () => {
    // ARRANGE — `sem_calendario`: não há corte, logo não há período a derivar (fail-safe
    // do D1). O estado vazio tem que dizer o PRÓXIMO PASSO, não só "nada aqui".
    servidor.use(
      msw.get('/api/convenios/:id/ciclos/proximo', () =>
        HttpResponse.json(semPeriodo('sem_calendario')),
      ),
      msw.get('/api/convenios/:id/ciclos', () => HttpResponse.json([])),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText(/ainda não tem fechamento configurado/i)).toBeInTheDocument()
    // o caminho INTEIRO, porque não há deep-link para a linha do convênio (I4)
    expect(screen.getByText(/Fechamento do faturamento/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir o cadastro dos convênios/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Fechar período/i })).not.toBeInTheDocument()
  })

  it('deve dizer que o último período JÁ foi fechado — não que falta configurar o corte', async () => {
    // ARRANGE — o dia seguinte ao 1º fechamento da Unimed: o calendário ESTÁ configurado
    // e o último período já foi fechado. Antes do contrato novo os dois estados chegavam
    // como o mesmo `null`, e a tela mandava a recepção configurar o que já estava certo —
    // com a tabela de fechados logo abaixo desmentindo a própria tela (achado CR #2).
    servidor.use(
      msw.get('/api/convenios/:id/ciclos/proximo', () =>
        HttpResponse.json(semPeriodo('ja_fechado')),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — o estado vazio CERTO, e nenhum traço do outro
    expect(await screen.findByText('O último período já foi fechado')).toBeInTheDocument()
    expect(screen.queryByText(/ainda não tem fechamento configurado/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Abrir o cadastro dos convênios/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Fechar período/i })).not.toBeInTheDocument()
    // a história continua visível — é ela que prova que o corte existe
    expect(screen.getByRole('table', { name: /Períodos fechados/i })).toHaveTextContent(
      '16/05/2026 a 15/06/2026',
    )
  })

  it('deve mostrar UM estado vazio só quando o convênio não tem corte nem fechamentos', async () => {
    // ARRANGE — o estado padrão de TODO convênio novo. Dois `EstadoVazio` iguais em forma
    // empilhados ("não tem fechamento configurado" + "nenhum período fechado ainda") faziam
    // a segunda caixa roubar a ação da primeira (achado R2).
    servidor.use(
      msw.get('/api/convenios/:id/ciclos/proximo', () =>
        HttpResponse.json(semPeriodo('sem_calendario')),
      ),
      msw.get('/api/convenios/:id/ciclos', () => HttpResponse.json([])),
    )

    // ACT
    renderizar()

    // ASSERT — o vazio do histórico não renderiza quando não há período a fechar
    await screen.findByText(/ainda não tem fechamento configurado/i)
    expect(screen.queryByText(/Nenhum período fechado ainda/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /Períodos fechados/i })).not.toBeInTheDocument()
  })

  it('deve manter o vazio do histórico quando HÁ período a fechar e nada fechado ainda', async () => {
    // ARRANGE — o contrapositivo do R2: aqui as duas caixas dizem coisas diferentes (uma
    // oferece a ação, a outra explica a tabela que virá), e as duas devem existir.
    servidor.use(msw.get('/api/convenios/:id/ciclos', () => HttpResponse.json([])))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByRole('button', { name: /Fechar período/i })).toBeInTheDocument()
    expect(screen.getByText('Nenhum período fechado ainda')).toBeInTheDocument()
  })

  it('deve mostrar a recusa do servidor DENTRO do diálogo de fechamento', async () => {
    // ARRANGE — a sobreposição de períodos é recusada com 422 (delta spec). Sem a
    // mensagem no diálogo, para quem clicou "não aconteceu nada" (CR-CA-05).
    servidor.use(
      msw.post('/api/convenios/:id/ciclos', () =>
        HttpResponse.json(
          {
            message: 'Este período se sobrepõe a outro já fechado.',
            errors: { periodo_inicio: ['Este período se sobrepõe a outro já fechado.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Fechar período/i }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Fechar período' }))

    // ASSERT — o diálogo continua aberto, com a recusa dentro dele
    await waitFor(() => {
      expect(dialogo).toHaveTextContent('Este período se sobrepõe a outro já fechado.')
    })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('deve mostrar UM estado de erro com UM retry quando as duas consultas caem juntas', async () => {
    // ARRANGE — falha de rede NUNCA pode virar "nenhum período fechado": ler "nada
    // fechado" numa lista que não carregou faria o faturamento fechar duas vezes.
    // As duas consultas da seção saem juntas e caem juntas — dois blocos de erro com dois
    // "Tentar novamente" fazem a pessoa escolher entre botões idênticos (achado R2).
    servidor.use(
      msw.get('/api/convenios/:id/ciclos', () => new HttpResponse(null, { status: 500 })),
      msw.get('/api/convenios/:id/ciclos/proximo', () => new HttpResponse(null, { status: 500 })),
    )

    // ACT
    renderizar()

    // ASSERT — 5xx é falha transitória e o cliente REPETE uma vez (com backoff): o
    // prazo aqui acompanha a política do `query-client`, não o default do findBy
    expect(
      await screen.findByText(
        'Não foi possível carregar os ciclos de faturamento deste convênio.',
        undefined,
        { timeout: 5000 },
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Tentar novamente' })).toHaveLength(1)
    expect(screen.queryByText(/Nenhum período fechado ainda/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ainda não tem fechamento configurado/i)).not.toBeInTheDocument()
  })

  it('deve mostrar UM estado de erro quando só a lista cai — sem vazio ao lado', async () => {
    // ARRANGE — a queda parcial: `proximo` responde, a lista não. Sem o bloco único, a
    // seção mostrava o card do próximo período E um erro embaixo, em registros diferentes.
    servidor.use(
      msw.get('/api/convenios/:id/ciclos', () => new HttpResponse(null, { status: 500 })),
    )

    // ACT
    renderizar()

    // ASSERT
    await screen.findByText(
      'Não foi possível carregar os ciclos de faturamento deste convênio.',
      undefined,
      { timeout: 5000 },
    )
    expect(screen.getAllByRole('button', { name: 'Tentar novamente' })).toHaveLength(1)
    // enquanto a seção não sabe o que já foi fechado, ela não oferece fechar de novo
    expect(screen.queryByRole('button', { name: /Fechar período/i })).not.toBeInTheDocument()
  })
})

describe('Ciclos de faturamento — reabrir é a exceção do administrador (D6)', () => {
  it('deve esconder a afordância de reabrir de quem não tem ciclos.reabrir', async () => {
    // ARRANGE + ACT — o precedente da casa: a ação some, e o servidor decide de todo
    // jeito (403). Quem fecha não reabre.
    renderizar(SO_FECHAR)
    await screen.findByRole('table', { name: /Períodos fechados/i })

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument()
    // a leitura permanece — quem fecha precisa ver o que já está fechado
    expect(screen.getByRole('table', { name: /Períodos fechados/i })).toHaveTextContent(
      '16/05/2026 a 15/06/2026',
    )
  })

  it('deve não oferecer reabrir num fechamento que já foi reaberto', async () => {
    // ARRANGE — a linha reaberta é HISTÓRIA (tabela append-only). Oferecer o botão nela
    // seria prometer uma ação que o servidor recusa com 422 "já reaberto".
    servidor.use(
      msw.get('/api/convenios/:id/ciclos', () =>
        HttpResponse.json([
          fechamento({
            reaberto_por: { id: 3, nome: 'Administradora Fictícia' },
            reaberto_em: '2026-06-20 11:00',
            aberto: false,
          }),
        ]),
      ),
    )

    // ACT
    renderizar()
    await screen.findByRole('table', { name: /Períodos fechados/i })

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument()
  })

  it('deve exigir a palavra REABRIR E o motivo antes de liberar a confirmação', async () => {
    // ARRANGE — a palavra prova INTENÇÃO; ela não prova que o motivo foi escrito. Sem a
    // trava do motivo, "REABRIR" em branco chegaria ao servidor só para voltar 422 — e
    // a exigência estaria escrita na tela sem ser exigida.
    const usuario = userEvent.setup()
    renderizar()
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const dialogo = await screen.findByRole('alertdialog')
    const confirmar = within(dialogo).getByRole('button', { name: 'Reabrir período' })

    // ASSERT — nasce travado, e DIZ as duas travas que faltam (`aria-disabled`, não
    // `disabled`: a ação primária continua na sequência de Tab para poder se explicar)
    expect(confirmar).toHaveAttribute('aria-disabled', 'true')
    expect(confirmar).toHaveAccessibleDescription(/Escreva o motivo da reabertura/)
    expect(confirmar).toHaveAccessibleDescription(/Digite REABRIR no campo acima/)

    // ACT — só o motivo não basta
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Motivo da reabertura/i }),
      'Sessao do dia 12 ficou fora da producao enviada',
    )

    // ASSERT — e agora sobra UMA trava, que é a que o texto tem de nomear
    expect(confirmar).toHaveAttribute('aria-disabled', 'true')
    expect(confirmar).toHaveAccessibleDescription(/Digite REABRIR no campo acima/)
    expect(confirmar).not.toHaveAccessibleDescription(/Escreva o motivo/)

    // ACT — só a palavra também não basta: limpa o motivo e digita a palavra
    await usuario.clear(within(dialogo).getByRole('textbox', { name: /Motivo da reabertura/i }))
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Digite REABRIR para confirmar/i }),
      'REABRIR',
    )

    // ASSERT
    expect(confirmar).toHaveAttribute('aria-disabled', 'true')
    expect(confirmar).toHaveAccessibleDescription(/Escreva o motivo da reabertura/)

    // ACT — os dois juntos
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Motivo da reabertura/i }),
      'Sessao do dia 12 ficou fora da producao enviada',
    )

    // ASSERT
    expect(confirmar).not.toHaveAttribute('aria-disabled')
    expect(confirmar).toBeEnabled()
  })

  it('deve manter o confirmar TRAVADO na sequência de Tab do diálogo (IMP-4)', async () => {
    // ARRANGE — com `disabled`, a ordem de Tab da reabertura era [motivo, palavra,
    // Cancelar]: a ação primária ficava FORA da sequência, e as duas travas independentes
    // não tinham como se anunciar a quem navega por teclado.
    const usuario = userEvent.setup()
    renderizar()
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const dialogo = await screen.findByRole('alertdialog')

    // ACT — a partir do Cancelar (foco inicial), Tab percorre o diálogo
    const alcancados: string[] = []
    for (let passo = 0; passo < 5; passo += 1) {
      await usuario.tab()
      const foco = document.activeElement
      alcancados.push(foco instanceof HTMLElement ? (foco.textContent ?? '') : '')
    }

    // ASSERT — o confirmar bloqueado é alcançável
    expect(alcancados.some((rotulo) => rotulo.includes('Reabrir período'))).toBe(true)
    expect(within(dialogo).getByRole('button', { name: 'Reabrir período' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('deve NÃO reabrir com o confirmar bloqueado, mesmo clicado', async () => {
    // ARRANGE — `aria-disabled` mantém o botão clicável: a inércia tem de vir da guarda
    // do componente, senão a acessibilidade teria comprado um bug de escrita.
    let chamou = false
    servidor.use(
      msw.post('/api/convenios/:id/ciclos/:cicloId/reabertura', () => {
        chamou = true
        return HttpResponse.json(fechamento({ aberto: false }))
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT — a palavra sem o motivo
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Digite REABRIR para confirmar/i }),
      'REABRIR',
    )
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir período' }))

    // ASSERT — nada foi enviado, e o diálogo continua de pé
    expect(chamou).toBe(false)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('deve reabrir enviando o motivo, e NOMEAR o período no diálogo', async () => {
    // ARRANGE
    let corpo: Record<string, unknown> | null = null
    let rota = ''
    servidor.use(
      msw.post('/api/convenios/:id/ciclos/:cicloId/reabertura', async ({ request, params }) => {
        corpo = (await request.json()) as Record<string, unknown>
        rota = String(params.cicloId)
        return HttpResponse.json(fechamento({ aberto: false }))
      }),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const dialogo = await screen.findByRole('alertdialog')

    // ASSERT — o alvo pelo período e pelo convênio, e a consequência REAL
    expect(dialogo).toHaveTextContent(
      'Reabrir o período de 16/05/2026 a 15/06/2026 de Convênio Fictício?',
    )
    expect(dialogo).toHaveTextContent('fica registrada na trilha')

    // ACT
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Motivo da reabertura/i }),
      'Producao enviada sem a sessao do dia 12',
    )
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Digite REABRIR para confirmar/i }),
      'REABRIR',
    )
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir período' }))

    // ASSERT — o motivo vai INTEIRO e sozinho, no ciclo certo
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toEqual({ motivo: 'Producao enviada sem a sessao do dia 12' })
    expect(rota).toBe('1')
  })

  it('deve pedir, no próprio campo, que ninguém escreva o nome da criança (SEC-FC-06)', async () => {
    // ARRANGE — o motivo vai para uma trilha append-only, lida por quem administra: não
    // é campo de prontuário. A instrução vem ANTES do erro, porque depois de escrito o
    // nome de um menor já foi gravado — e o limite do servidor é declarado, não descoberto.
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const dialogo = await screen.findByRole('alertdialog')

    // ASSERT
    expect(dialogo).toHaveTextContent(/Não escreva o nome da criança/i)
    expect(dialogo).toHaveTextContent(/trilha de auditoria/i)
    expect(within(dialogo).getByRole('textbox', { name: /Motivo da reabertura/i })).toHaveAttribute(
      'maxlength',
      '500',
    )
    // o contador diz quanto ainda cabe — truncar em silêncio é perder o motivo
    expect(dialogo).toHaveTextContent('500 caracteres restantes')
  })

  it('deve pousar a recusa do MOTIVO no próprio campo', async () => {
    // ARRANGE — o servidor recusa o motivo por chave (`motivo`); a mensagem tem que
    // pousar NO CAMPO, não num aviso genérico que não diz o que corrigir
    servidor.use(
      msw.post('/api/convenios/:id/ciclos/:cicloId/reabertura', () =>
        HttpResponse.json(
          {
            message: 'Dados inválidos.',
            errors: { motivo: ['Descreva o motivo com pelo menos 10 caracteres.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const dialogo = await screen.findByRole('alertdialog')
    const motivo = within(dialogo).getByRole('textbox', { name: /Motivo da reabertura/i })
    await usuario.type(motivo, 'Curto')
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Digite REABRIR para confirmar/i }),
      'REABRIR',
    )
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir período' }))

    // ASSERT — no campo, e marcado para quem usa leitor de tela
    await waitFor(() => {
      expect(dialogo).toHaveTextContent('Descreva o motivo com pelo menos 10 caracteres.')
    })
    expect(motivo).toHaveAttribute('aria-invalid', 'true')
  })

  it('deve mostrar a recusa do servidor DENTRO do diálogo de reabertura', async () => {
    // ARRANGE — a corrida real: outra pessoa reabriu o mesmo ciclo primeiro (422). A
    // recusa chega por uma chave que a tela não conhece e vai para o aviso do diálogo.
    // O texto exibido é o do NOSSO dicionário — mensagem crua do servidor nunca chega à
    // tela (T-ds-05) —, mas ela precisa aparecer onde a pessoa está olhando (CR-CA-05).
    servidor.use(
      msw.post('/api/convenios/:id/ciclos/:cicloId/reabertura', () =>
        HttpResponse.json(
          {
            message: 'Este ciclo já foi reaberto.',
            errors: { ciclo: ['Este ciclo já foi reaberto.'] },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Motivo da reabertura/i }),
      'Conferencia do faturamento',
    )
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Digite REABRIR para confirmar/i }),
      'REABRIR',
    )
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir período' }))

    // ASSERT — o diálogo continua aberto, com a recusa dentro dele
    await waitFor(() => {
      expect(dialogo).toHaveTextContent('Este ciclo já foi reaberto.')
    })
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('deve esquecer o motivo digitado ao fechar o diálogo', async () => {
    // ARRANGE — reabrir NUNCA nasce pré-preenchido: um motivo herdado da tentativa
    // anterior seria justificativa de OUTRA reabertura entrando na trilha desta
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Motivo da reabertura/i }),
      'Motivo abandonado',
    )
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))

    // ASSERT
    const reaberto = await screen.findByRole('alertdialog')
    expect(within(reaberto).getByRole('textbox', { name: /Motivo da reabertura/i })).toHaveValue('')
  })
})

describe('Ciclos de faturamento — o foco e o anúncio depois da mutação (2.4.3 · 4.1.3)', () => {
  /** Reabre de verdade: o servidor devolve a linha JÁ reaberta e a lista repinta sem o botão. */
  function servidorQueReabre(): void {
    let reaberto = false
    servidor.use(
      msw.post('/api/convenios/:id/ciclos/:cicloId/reabertura', () => {
        reaberto = true
        return HttpResponse.json(
          fechamento({
            aberto: false,
            reaberto_por: { id: 3, nome: 'Administradora Fictícia' },
            reaberto_em: '2026-06-20 11:00',
          }),
        )
      }),
      msw.get('/api/convenios/:id/ciclos', () =>
        HttpResponse.json([
          reaberto
            ? fechamento({
                aberto: false,
                reaberto_por: { id: 3, nome: 'Administradora Fictícia' },
                reaberto_em: '2026-06-20 11:00',
              })
            : fechamento(),
        ]),
      ),
    )
  }

  async function reabrirComSucesso(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Motivo da reabertura/i }),
      'Producao enviada sem a sessao do dia 12',
    )
    await usuario.type(
      within(dialogo).getByRole('textbox', { name: /Digite REABRIR para confirmar/i }),
      'REABRIR',
    )
    await usuario.click(within(dialogo).getByRole('button', { name: 'Reabrir período' }))
  }

  it('deve levar o foco para o título da seção quando a reabertura DÁ CERTO', async () => {
    // ARRANGE — o gatilho "Reabrir" só existe sob `ciclo.aberto`: a reabertura inverte a
    // flag, a lista repinta e o botão SAI DO DOM antes de receber o foco de volta. O
    // resultado medido era `activeElement = BODY` — quem navega por teclado é devolvido à
    // raiz do documento e recomeça a página inteira.
    servidorQueReabre()
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await reabrirComSucesso(usuario)

    // ASSERT — o `h2` da seção é a âncora que sobrevive a qualquer repintura
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'Ciclos de faturamento' }),
      )
    })
    expect(document.activeElement).not.toBe(document.body)
  })

  it('deve ANUNCIAR a reabertura — sucesso mudo é "não aconteceu nada"', async () => {
    // ARRANGE — sem live region, o efeito de uma mutação de impacto é silêncio: o botão
    // some, a linha muda, e nada é dito.
    servidorQueReabre()
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await reabrirComSucesso(usuario)

    // ASSERT — o toast da casa (`role="status"`, aria-live polite) nomeia o período
    expect(await screen.findByText('Período de 16/05/2026 a 15/06/2026 reaberto.')).toBeInTheDocument()
  })

  it('deve anunciar o fechamento e ancorar o foco também no caminho de fechar', async () => {
    // ARRANGE — o irmão: fechar também apaga o próprio gatilho (fechado o período, o
    // servidor passa a responder `ja_fechado` e o botão sai do DOM).
    let fechou = false
    servidor.use(
      msw.post('/api/convenios/:id/ciclos', () => {
        fechou = true
        return HttpResponse.json(fechamento({ id: 3, ...PROXIMO }), { status: 201 })
      }),
      msw.get('/api/convenios/:id/ciclos/proximo', () =>
        HttpResponse.json(fechou ? semPeriodo('ja_fechado') : comPeriodo()),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Fechar período/i }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Fechar período' }))

    // ASSERT
    expect(
      await screen.findByText('Produção de 16/06/2026 a 15/07/2026 fechada.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 2, name: 'Ciclos de faturamento' }),
      )
    })
  })

  it('deve devolver o foco ao GATILHO quando a pessoa apenas cancela', async () => {
    // ARRANGE — o contrapositivo: cancelar não apaga o gatilho, e reancorar no título
    // seria roubar o foco de quem só desistiu.
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    const gatilho = await screen.findByRole('button', { name: 'Reabrir' })
    await usuario.click(gatilho)
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))

    // ASSERT
    await waitFor(() => {
      expect(document.activeElement).toBe(gatilho)
    })
  })
})

describe('Ciclos de faturamento — hierarquia e acessibilidade', () => {
  it('deve entrar como TERCEIRA seção h2, sob o h1 do convênio', async () => {
    // ARRANGE + ACT — a rota tem UM `h1` (o convênio); a seção nova é irmã das outras
    // duas, no mesmo nível (A11Y-LP-01)
    renderizar()
    await screen.findByRole('table', { name: /Períodos fechados/i })

    // ASSERT
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((titulo) => titulo.textContent),
    ).toEqual(['Tabela de serviços', 'Regras de limite', 'Ciclos de faturamento'])
  })

  it('deve não ter violações axe no estado DEFAULT da seção', async () => {
    // ARRANGE — o run com o AlertDialog aberto é parcialmente artefato: o Radix põe
    // `aria-hidden` no resto da página, e o que o axe varre então é quase só o diálogo.
    // Este é o estado em que a seção passa 99% do tempo — card do próximo período,
    // tabela de fechados e o botão de reabrir (achado IMP-5).
    renderizar()
    await screen.findByRole('table', { name: /Períodos fechados/i })
    await screen.findByRole('button', { name: /Fechar período/i })

    // ACT
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe nos DOIS estados vazios da seção', async () => {
    // ARRANGE — os estados vazios são os que mais mudam de forma nesta change (um deles
    // nasceu agora), e nenhum tinha varredura.
    servidor.use(
      msw.get('/api/convenios/:id/ciclos/proximo', () =>
        HttpResponse.json(semPeriodo('sem_calendario')),
      ),
      msw.get('/api/convenios/:id/ciclos', () => HttpResponse.json([])),
    )
    const semCalendario = renderizar()
    await screen.findByText(/ainda não tem fechamento configurado/i)

    // ACT + ASSERT 1
    expect(await axe(document.body)).toHaveNoViolations()
    semCalendario.unmount()

    // ARRANGE 2 — o outro vazio, com a tabela ao lado
    queryClient.clear()
    servidor.use(
      msw.get('/api/convenios/:id/ciclos/proximo', () =>
        HttpResponse.json(semPeriodo('ja_fechado')),
      ),
      msw.get('/api/convenios/:id/ciclos', () => HttpResponse.json([fechamento()])),
    )
    renderizar()
    await screen.findByText('O último período já foi fechado')

    // ACT + ASSERT 2
    expect(await axe(document.body)).toHaveNoViolations()
  }, 45000)

  it('deve não ter violações axe com o diálogo de reabertura ABERTO', async () => {
    // ARRANGE — é o estado NOVO desta change, e é onde o motivo e a palavra digitada
    // vivem. A varredura é no `document.body` porque o AlertDialog do Radix vai para um
    // Portal: passar só o `container` auditaria a página SEM o diálogo.
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Reabrir' }))
    await screen.findByRole('alertdialog')
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})
