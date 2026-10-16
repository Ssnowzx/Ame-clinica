import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AppShell } from '@/componentes/app-shell'
import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { fingirTelaEstreita } from '@/test/setup'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Usuario } from '@/tipos'

expect.extend(toHaveNoViolations)

function renderizarShell(permissoes: string[] = ['agenda.ver']) {
  const usuario: Usuario = { ...usuarioFicticio, permissoes }
  useAuthStore.setState({ usuario, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      {/* o app real envolve o shell no ProvedorToast (app.tsx) — o sino usa usarToast */}
      <ProvedorToast>
        <MemoryRouter initialEntries={['/agenda']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/agenda" element={<p>Conteúdo da agenda</p>} />
              {/* destino real dos itens dos painéis — navegar precisa ter onde chegar */}
              <Route path="/pacientes/:id" element={<p>Ficha do paciente</p>} />
              {/* destino de um item do MENU: a gaveta precisa de para onde levar */}
              <Route path="/pacientes" element={<p>Lista de pacientes</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('AppShell — navegação por permissão', () => {
  it('deve exibir o item da agenda para quem tem agenda.ver', () => {
    // ARRANGE + ACT
    renderizarShell(['agenda.ver'])

    // ASSERT
    expect(screen.getByRole('link', { name: 'Agenda' })).toBeInTheDocument()
  })

  it('deve esconder o item de quem não tem a permissão', () => {
    // ARRANGE + ACT: guard de EXPERIÊNCIA — o servidor continua decidindo
    renderizarShell(['pacientes.ver'])

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Agenda' })).not.toBeInTheDocument()
  })

  it('deve marcar o item ativo com aria-current além do tratamento visual', () => {
    // ARRANGE + ACT
    renderizarShell()

    // ASSERT: cor nunca é o único canal (1.4.1)
    const item = screen.getByRole('link', { name: 'Agenda' })
    expect(item).toHaveAttribute('aria-current', 'page')
    expect(item).toHaveClass('font-semibold')
  })
})

describe('AppShell — contadores de notificação', () => {
  it('deve exibir o total dos blocos que a API devolve', async () => {
    // ARRANGE: a API amostra `itens`, mas o contador é o `total`
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          evolucoes_em_aberto: { total: 7, itens: [{ id: 1 }] },
          informativos: { total: 2, itens: [] },
        }),
      ),
    )

    // ACT
    renderizarShell()

    // ASSERT
    const notificacoes = await screen.findByRole('list', { name: 'Notificações' })
    expect(notificacoes).toHaveTextContent('7')
    expect(notificacoes).toHaveTextContent('2')
  })

  it('deve não renderizar como zero o bloco que a API omite', async () => {
    // ARRANGE: sem permissão do módulo, o bloco NÃO vem — ausência não é contagem
    servidor.use(
      msw.get('/api/notificacoes', () => HttpResponse.json({ informativos: { total: 3, itens: [] } })),
    )

    // ACT
    renderizarShell()

    // ASSERT
    const notificacoes = await screen.findByRole('list', { name: 'Notificações' })
    expect(notificacoes).toHaveTextContent('Informativos')
    expect(notificacoes).not.toHaveTextContent('Evoluções em aberto')
  })

  it('deve fazer do contador de evoluções uma PORTA para a fila', async () => {
    // ARRANGE: cada unidade deste número é uma sessão que aconteceu com uma criança e não
    // foi registrada. É o número que mais pede ação no produto — LINK direto para a fila,
    // sem painel no caminho (um clique a mais no caminho mais crítico). Os demais
    // contadores abrem PAINEL com os itens (testes próprios adiante) — não são links.
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          evolucoes_em_aberto: { total: 7, itens: [] },
          aniversariantes: { total: 2, itens: [] },
        }),
      ),
    )

    // ACT — o link CONSULTA a permissão do destino (não confia na API ter omitido o bloco)
    renderizarShell(['agenda.ver', 'evolucoes.ver'])

    // ASSERT
    const evolucoes = await screen.findByRole('link', { name: /Evoluções em aberto/ })
    expect(evolucoes).toHaveAttribute('href', '/evolucoes')
    // o de aniversariantes NÃO é link — é gatilho de painel
    expect(screen.queryByRole('link', { name: /Aniversariantes/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Aniversariantes/ })).toBeInTheDocument()
  })

  it('deve NÃO virar link sem `evolucoes.ver`, mesmo se a API mandar o bloco', async () => {
    // ARRANGE — gate SEC F-02. A API OMITE o bloco de quem não tem a permissão de origem, e
    // o link se apoiava só nisso. Uma regressão no `NotificacaoController` (ou um bloco novo
    // copiado do lado errado) devolveria o contador a quem não pode abrir a fila — e o link
    // levaria a "acesso negado". Defesa em profundidade que não se confere é defesa simples.
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({ evolucoes_em_aberto: { total: 7, itens: [] } }),
      ),
    )

    // ACT — o usuário NÃO tem `evolucoes.ver`
    renderizarShell(['agenda.ver'])

    // ASSERT — o número aparece (a API o mandou), mas não é PORTA
    const notificacoes = await screen.findByRole('list', { name: 'Notificações' })
    expect(notificacoes).toHaveTextContent('7')
    expect(screen.queryByRole('link', { name: /Evoluções em aberto/ })).not.toBeInTheDocument()
  })

  it('deve fazer do contador de pendências de retorno uma PORTA para a fila', async () => {
    // ARRANGE: como as evoluções, é lista para TRABALHAR (ligar para a família e marcar) —
    // link direto, não painel: o teto de 50 do centro não comporta a fila inteira.
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          pendencias_de_retorno: { total: 4, itens: [] },
          aniversariantes: { total: 2, itens: [] },
        }),
      ),
    )

    // ACT
    renderizarShell(['agenda.ver'])

    // ASSERT — o destino é a MESMA `agenda.ver` que trouxe o bloco
    const pendencias = await screen.findByRole('link', { name: /Pendências de retorno/ })
    expect(pendencias).toHaveAttribute('href', '/pendencias')
  })

  it('não deve virar link de pendências sem `agenda.ver`, mesmo se a API mandar o bloco', async () => {
    // ARRANGE — gate SEC F-02, o mesmo das evoluções: o link consulta a permissão do
    // destino em vez de confiar em a API ter omitido o bloco.
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({ pendencias_de_retorno: { total: 4, itens: [] } }),
      ),
    )

    // ACT — usuário sem `agenda.ver`
    renderizarShell(['pacientes.ver'])

    // ASSERT — o número aparece (a API o mandou), mas não é PORTA
    const notificacoes = await screen.findByRole('list', { name: 'Notificações' })
    expect(notificacoes).toHaveTextContent('4')
    expect(screen.queryByRole('link', { name: /Pendências de retorno/ })).not.toBeInTheDocument()
  })
})

describe('AppShell — aviso da trava de evolução', () => {
  it('deve avisar as vencidas e os dias até a trava quando o bloqueio é iminente', async () => {
    // ARRANGE: a API manda o aviso PRONTO (só para o escopado) — a tela não calcula
    // regra nenhuma. Canal não-só-cor (1.4.1): texto explícito + ícone, além do tom.
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          evolucoes_em_aberto: { total: 5, itens: [], vencidas: 2, bloqueio_em_dias: 2 },
        }),
      ),
    )

    // ACT
    renderizarShell(['agenda.ver', 'evolucoes.ver'])

    // ASSERT — texto legível no tom de ALERTA, com o ícone como canal extra
    const aviso = await screen.findByText('2 vencidas · trava em 2 dias')
    expect(aviso).toHaveClass('text-alerta-texto')
    expect(aviso).toHaveClass('bg-alerta-suave')
    expect(aviso.querySelector('svg')).not.toBeNull()
  })

  it('deve dizer que o finalizar está travado quando os dias chegam a zero', async () => {
    // ARRANGE: 0 = já travado — o tom sobe para PERIGO e o texto diz o estado
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          evolucoes_em_aberto: { total: 3, itens: [], vencidas: 1, bloqueio_em_dias: 0 },
        }),
      ),
    )

    // ACT
    renderizarShell(['agenda.ver', 'evolucoes.ver'])

    // ASSERT
    const aviso = await screen.findByText('1 vencida · finalizar travado')
    expect(aviso).toHaveClass('text-perigo-texto')
    expect(aviso).toHaveClass('bg-perigo-suave')
    expect(aviso.querySelector('svg')).not.toBeNull()
  })

  it('deve não alarmar sem vencidas — nem quando a API omite os campos', async () => {
    // ARRANGE: sem vencida a API manda null (escopado em dia); para o plano os campos
    // nem vêm — nos dois casos o contador aparece SEM aviso de trava
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          evolucoes_em_aberto: { total: 4, itens: [], vencidas: 0, bloqueio_em_dias: null },
        }),
      ),
    )

    // ACT
    renderizarShell(['agenda.ver', 'evolucoes.ver'])

    // ASSERT — o total segue visível; nada sugere bloqueio
    const notificacoes = await screen.findByRole('list', { name: 'Notificações' })
    expect(notificacoes).toHaveTextContent('4')
    expect(screen.queryByText(/trava|travado|vencida/)).not.toBeInTheDocument()
  })
})

describe('AppShell — painéis de notificação', () => {
  it('deve abrir o painel de aniversariantes com dia e nome levando à ficha', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          aniversariantes: { total: 1, itens: [{ id: 9, nome: 'Alice Teste', dia: 22 }] },
        }),
      ),
    )
    renderizarShell(['agenda.ver', 'pacientes.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Aniversariantes/ }))

    // ASSERT
    const painel = await screen.findByRole('dialog', { name: 'Aniversariantes' })
    expect(painel).toHaveTextContent('dia 22')
    const item = screen.getByRole('link', { name: /Alice Teste/ })
    expect(item).toHaveAttribute('href', '/pacientes/9')
  })

  it('deve fechar o painel ao navegar por um item', async () => {
    // ARRANGE: o Link não fecha o Popover sozinho no client-side routing
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          aniversariantes: { total: 1, itens: [{ id: 9, nome: 'Alice Teste', dia: 22 }] },
        }),
      ),
    )
    renderizarShell(['agenda.ver', 'pacientes.ver'])
    await usuario.click(await screen.findByRole('button', { name: /Aniversariantes/ }))

    // ACT
    await usuario.click(screen.getByRole('link', { name: /Alice Teste/ }))

    // ASSERT
    expect(screen.queryByRole('dialog', { name: 'Aniversariantes' })).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('Ficha do paciente')
  })

  it('deve NÃO linkar a ficha do aniversariante sem `pacientes.ver`', async () => {
    // ARRANGE — gate SEC F-02: a API omite o bloco de quem não tem a permissão, mas o
    // link não confia nisso; uma regressão no controller devolveria o bloco a quem não
    // pode abrir a ficha — e o link levaria a "acesso negado"
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          aniversariantes: { total: 1, itens: [{ id: 9, nome: 'Alice Teste', dia: 22 }] },
        }),
      ),
    )
    renderizarShell(['agenda.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Aniversariantes/ }))

    // ASSERT — o item aparece, mas informativo
    const painel = await screen.findByRole('dialog', { name: 'Aniversariantes' })
    expect(painel).toHaveTextContent('Alice Teste')
    expect(screen.queryByRole('link', { name: /Alice Teste/ })).not.toBeInTheDocument()
  })

  it('deve mostrar a especialidade no termo pendente e levar à ficha', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          termos_pendentes: {
            total: 2,
            itens: [
              { id: 4, nome: 'Bruno Teste', especialidade: { id: 2, nome: 'Fonoaudiologia' } },
              // a API manda null quando a especialidade do tratamento foi removida
              { id: 5, nome: 'Dora Teste', especialidade: null },
            ],
          },
        }),
      ),
    )
    renderizarShell(['agenda.ver', 'pacientes.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Termos pendentes/ }))

    // ASSERT
    const painel = await screen.findByRole('dialog', { name: 'Termos pendentes' })
    expect(painel).toHaveTextContent('Fonoaudiologia')
    expect(screen.getByRole('link', { name: /Bruno Teste/ })).toHaveAttribute('href', '/pacientes/4')
    // especialidade null: a linha renderiza SÓ o nome (match exato — sem sufixo)
    expect(screen.getByRole('link', { name: 'Dora Teste' })).toHaveAttribute('href', '/pacientes/5')
  })

  it('deve mostrar atrasados com valor formatado e UMA porta para o financeiro', async () => {
    // ARRANGE: não existe rota de detalhe de lançamento — o rodapé é a única navegação
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          lancamentos_em_atraso: {
            total: 2,
            itens: [
              {
                lancamento_id: 1,
                tipo: 'receita',
                vencimento: '2026-07-01',
                valor_liquido: '1234.50',
                interessado: { tipo: 'paciente', id: 9, nome: 'Alice Teste' },
              },
              {
                lancamento_id: 2,
                tipo: 'despesa',
                vencimento: '2026-07-02',
                valor_liquido: '10.00',
                interessado: null,
              },
            ],
          },
        }),
      ),
    )
    renderizarShell(['agenda.ver', 'lancamentos.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Lançamentos em atraso/ }))

    // ASSERT — decimal formatado (nunca float), vencimento legível, um único link
    const painel = await screen.findByRole('dialog', { name: 'Lançamentos em atraso' })
    expect(painel).toHaveTextContent('R$ 1.234,50')
    expect(painel).toHaveTextContent('01/07/2026')
    // interessado null: a linha exibe o tipo SEM o sufixo "· nome"
    expect(painel).toHaveTextContent('Despesa')
    expect(painel).not.toHaveTextContent(/Despesa\s*·/)
    const portas = screen.getAllByRole('link')
    expect(portas).toHaveLength(1)
    expect(portas[0]).toHaveAttribute('href', '/financeiro')
  })

  it('deve NÃO linkar a ficha nas faltas consecutivas sem `pacientes.ver`', async () => {
    // ARRANGE: o bloco vem com `agenda.ver` — permissão do DESTINO difere da do bloco
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          faltas_consecutivas: {
            total: 1,
            itens: [
              {
                paciente: { id: 7, nome: 'Caio Teste' },
                faltas_consecutivas: 3,
                ultima_falta_em: '2026-07-10',
              },
            ],
          },
        }),
      ),
    )
    renderizarShell(['agenda.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Faltas consecutivas/ }))

    // ASSERT — o dado aparece; a porta não é prometida
    const painel = await screen.findByRole('dialog', { name: 'Faltas consecutivas' })
    expect(painel).toHaveTextContent('Caio Teste')
    expect(painel).toHaveTextContent('3 faltas seguidas')
    expect(painel).toHaveTextContent('10/07/2026')
    expect(screen.queryByRole('link', { name: /Caio Teste/ })).not.toBeInTheDocument()
  })

  it('deve linkar a ficha nas faltas consecutivas com `pacientes.ver`', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          faltas_consecutivas: {
            total: 2,
            itens: [
              {
                paciente: { id: 7, nome: 'Caio Teste' },
                faltas_consecutivas: 3,
                ultima_falta_em: '2026-07-10',
              },
              // a API manda null quando não há data da última falta
              {
                paciente: { id: 8, nome: 'Duda Teste' },
                faltas_consecutivas: 4,
                ultima_falta_em: null,
              },
            ],
          },
        }),
      ),
    )
    renderizarShell(['agenda.ver', 'pacientes.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Faltas consecutivas/ }))

    // ASSERT
    const painel = await screen.findByRole('dialog', { name: 'Faltas consecutivas' })
    expect(screen.getByRole('link', { name: /Caio Teste/ })).toHaveAttribute('href', '/pacientes/7')
    // data null degrada para o traço do dataLegivel — nunca "undefined"
    expect(painel).toHaveTextContent('última em —')
  })

  it('deve ler o informativo no próprio painel', async () => {
    // ARRANGE: não existe tela de leitura de informativos — o painel É o destino
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          informativos: {
            total: 1,
            itens: [
              {
                id: 3,
                titulo: 'Recesso de julho',
                corpo: 'A clínica fecha na segunda quinzena.',
                publicado_em: '2026-07-15 09:00',
              },
            ],
          },
        }),
      ),
    )
    renderizarShell(['agenda.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Informativos/ }))

    // ASSERT
    const painel = await screen.findByRole('dialog', { name: 'Informativos' })
    expect(painel).toHaveTextContent('Recesso de julho')
    expect(painel).toHaveTextContent('A clínica fecha na segunda quinzena.')
    expect(painel).toHaveTextContent('15/07/2026 às 09:00')
  })

  it('deve declarar a amostra quando o total excede os itens enviados', async () => {
    // ARRANGE: a API amostra (teto de 50) — lista cortada que não se declara mente
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          aniversariantes: { total: 60, itens: [{ id: 9, nome: 'Alice Teste', dia: 22 }] },
        }),
      ),
    )
    renderizarShell(['agenda.ver', 'pacientes.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Aniversariantes/ }))

    // ASSERT
    const painel = await screen.findByRole('dialog', { name: 'Aniversariantes' })
    expect(painel).toHaveTextContent('Mostrando 1 de 60.')
  })

  it('deve guardar o bloco zerado sob "Em dia", nomeado, em vez de um contador a mais na tira', async () => {
    // ARRANGE: zero não é notícia — mas o bloco não pode sumir sem nome
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({ termos_pendentes: { total: 0, itens: [] } }),
      ),
    )
    renderizarShell(['agenda.ver', 'pacientes.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Em dia/ }))

    // ASSERT
    expect(screen.queryByRole('button', { name: /Termos pendentes/ })).not.toBeInTheDocument()
    const painel = await screen.findByRole('dialog', { name: 'Em dia' })
    expect(painel).toHaveTextContent('Termos pendentes')
  })

  it('deve fechar o painel com Esc devolvendo o foco ao contador', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          aniversariantes: { total: 1, itens: [{ id: 9, nome: 'Alice Teste', dia: 22 }] },
        }),
      ),
    )
    renderizarShell(['agenda.ver', 'pacientes.ver'])
    const gatilho = await screen.findByRole('button', { name: /Aniversariantes/ })
    await usuario.click(gatilho)
    await screen.findByRole('dialog', { name: 'Aniversariantes' })

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT
    expect(screen.queryByRole('dialog', { name: 'Aniversariantes' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(gatilho)
  })

  it('deve não ter violações axe com o painel aberto', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          aniversariantes: { total: 1, itens: [{ id: 9, nome: 'Alice Teste', dia: 22 }] },
        }),
      ),
    )
    const { container } = renderizarShell(['agenda.ver', 'pacientes.ver'])
    await usuario.click(await screen.findByRole('button', { name: /Aniversariantes/ }))
    await screen.findByRole('dialog', { name: 'Aniversariantes' })

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})

describe('AppShell — bloco de pedidos médicos (limites-e-pedidos)', () => {
  /** Itens no shape EXATO do contrato (whitelist SEC-LP-02) — dados 100% fictícios. */
  const PEDIDOS = {
    total: 2,
    itens: [
      {
        tratamento_id: 31,
        paciente: { id: 7, nome: 'Caio Teste', nome_social: null },
        convenio: { id: 2, nome: 'Convênio Fictício' },
        especialidade: { id: 1, nome: 'Fonoaudiologia' },
        vencido: true,
        vence_em: '2026-07-10',
        vence_em_dias: null,
      },
      {
        tratamento_id: 32,
        // nome social existe → é ele que aparece (como nos análogos da ficha)
        paciente: { id: 8, nome: 'Eduarda Teste', nome_social: 'Duda Teste' },
        convenio: { id: 3, nome: 'Plano Fictício' },
        especialidade: null,
        vencido: false,
        vence_em: '2026-08-18',
        vence_em_dias: 30,
      },
    ],
  }

  it('deve listar vencido e a vencer, com o estado em PALAVRAS e a ficha como destino', async () => {
    // ARRANGE — o servidor decide vencido/dias (fuso da clínica); a tela só exibe
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () => HttpResponse.json({ pedidos_medicos: PEDIDOS })),
    )
    renderizarShell(['agenda.ver', 'pacientes.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Pedidos médicos/ }))

    // ASSERT — estado em palavras (canal não-só-cor), convênio nomeado, porta para a ficha
    const painel = await screen.findByRole('dialog', { name: 'Pedidos médicos' })
    expect(painel).toHaveTextContent('Vencido em 10/07/2026')
    expect(painel).toHaveTextContent('Vence em 30 dias')
    expect(painel).toHaveTextContent('Convênio Fictício · Fonoaudiologia')
    expect(screen.getByRole('link', { name: /Caio Teste/ })).toHaveAttribute('href', '/pacientes/7')
    expect(screen.getByRole('link', { name: /Duda Teste/ })).toHaveAttribute('href', '/pacientes/8')
    // §14/SEC-LP-13: a linguagem é "pedido médico"/"sessões" — nunca guia/TISS
    expect(painel).not.toHaveTextContent(/guia|TISS/i)
  })

  it('deve não renderizar o bloco quando a API o omite (sem tratamentos.ver)', async () => {
    // ARRANGE — a API omite `pedidos_medicos` de quem não tem a permissão do módulo
    // dono (SEC-LP-02): ausência não é contagem, nada renderiza (nem "0")
    servidor.use(
      msw.get('/api/notificacoes', () => HttpResponse.json({ informativos: { total: 1, itens: [] } })),
    )

    // ACT
    renderizarShell(['agenda.ver'])

    // ASSERT
    const notificacoes = await screen.findByRole('list', { name: 'Notificações' })
    expect(notificacoes).toHaveTextContent('Informativos')
    expect(notificacoes).not.toHaveTextContent('Pedidos médicos')
  })

  it('deve manter a linha informativa (sem link) para quem não tem pacientes.ver', async () => {
    // ARRANGE — gate F-02: a permissão do bloco (tratamentos.ver, na API) difere da do
    // destino; link que promete o que o servidor nega é promessa vazia
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () => HttpResponse.json({ pedidos_medicos: PEDIDOS })),
    )
    renderizarShell(['agenda.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Pedidos médicos/ }))

    // ASSERT — o dado aparece; a porta não é prometida
    const painel = await screen.findByRole('dialog', { name: 'Pedidos médicos' })
    expect(painel).toHaveTextContent('Caio Teste')
    expect(screen.queryByRole('link', { name: /Caio Teste/ })).not.toBeInTheDocument()
  })

  it('deve dizer o estado em palavras quando o servidor não manda a data-limite', async () => {
    // ARRANGE — `vence_em` é `?string` no servidor (achado I6): o tipo prometia `string`,
    // e a tela concatenaria `undefined` numa frase. Sem data-limite, resta a PALAVRA —
    // o item veio, então há um pedido a renovar.
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/notificacoes', () =>
        HttpResponse.json({
          pedidos_medicos: {
            total: 1,
            itens: [
              {
                tratamento_id: 33,
                paciente: { id: 9, nome: 'Alice Teste', nome_social: null },
                convenio: { id: 4, nome: 'Convênio Fictício' },
                especialidade: null,
                vencido: true,
                vence_em: null,
                vence_em_dias: null,
              },
            ],
          },
        }),
      ),
    )
    renderizarShell(['agenda.ver', 'pacientes.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Pedidos médicos/ }))

    // ASSERT — frase inteira, sem "undefined" e sem "Vencido em —"
    const painel = await screen.findByRole('dialog', { name: 'Pedidos médicos' })
    expect(painel).toHaveTextContent('Pedido vencido')
    expect(painel).not.toHaveTextContent(/undefined|Vencido em —/)
  })
})

describe('AppShell — acessibilidade e sessão', () => {
  it('deve ter o pular-para-o-conteúdo como primeiro alvo tabulável', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarShell()

    // ACT
    await usuario.tab()

    // ASSERT (2.4.1)
    expect(document.activeElement).toHaveTextContent('Pular para o conteúdo')
  })

  it('deve pôr o pular-para-o-conteúdo focado ACIMA da barra lateral', async () => {
    // ARRANGE — no mesmo z, a barra (sticky, depois no DOM) cobria o link focado (A11Y-IND-03)
    const usuario = userEvent.setup()
    renderizarShell()
    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8')
    const valorDoZ = (classe: string, prefixo: string): number => {
      const token = new RegExp(`${prefixo}z-\\(--(z-[\\w-]+)\\)`).exec(classe)?.[1] ?? ''
      return Number(new RegExp(`--${token}:\\s*(\\d+)`).exec(css)?.[1] ?? Number.NaN)
    }

    // ACT
    await usuario.tab()

    // ASSERT
    const pular = document.activeElement?.className ?? ''
    const barra = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(valorDoZ(pular, 'focus:')).toBeGreaterThan(valorDoZ(barra.className, '(?:^|\\s)'))
  })

  it('deve expor os landmarks de navegação e conteúdo', () => {
    // ARRANGE + ACT
    renderizarShell()

    // ASSERT
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveTextContent('Conteúdo da agenda')
  })

  it('deve encerrar a sessão ao sair', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarShell()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Sair' }))

    // ASSERT
    await waitFor(() => {
      expect(useAuthStore.getState().usuario).toBeNull()
    })
  })

  it('deve não ter violações axe', async () => {
    // ARRANGE
    const { container } = renderizarShell()

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})

describe('AppShell — rodapé de sistema', () => {
  it('deve ancorar Configurações no rodapé, fora da lista de operação', () => {
    // ARRANGE + ACT: quem parametriza a clínica não disputa a fila com quem atende
    renderizarShell(['agenda.ver', 'configuracoes.ver'])

    // ASSERT: duas listas na barra — a operação em cima, o sistema ancorado embaixo
    const barra = screen.getByRole('navigation', { name: 'Navegação principal' })
    const sistema = within(barra).getByRole('list', { name: 'Sistema' })
    // a operação vem em GRUPOS nomeados (Atendimento, Gestão, Administração) — cada um é uma
    // lista própria; nenhum deles carrega Configurações
    const operacao = within(barra).getAllByRole('list').filter((lista) => lista !== sistema)
    expect(operacao.length).toBeGreaterThan(0)
    expect(within(within(barra).getByRole('list', { name: 'Atendimento' })).getByRole('link', { name: 'Agenda' })).toBeInTheDocument()
    for (const lista of operacao) {
      expect(within(lista).queryByRole('link', { name: 'Configurações' })).not.toBeInTheDocument()
    }
    expect(within(sistema).getByRole('link', { name: 'Configurações' })).toBeInTheDocument()
  })

  it('deve tirar Configurações do rodapé de quem não pode vê-la', () => {
    // ARRANGE + ACT: a permissão sai, o destino sai — mas o rodapé continua, porque o Manual
    // não exige permissão nenhuma (change manual-do-operador)
    renderizarShell(['agenda.ver'])

    // ASSERT
    const barra = screen.getByRole('navigation', { name: 'Navegação principal' })
    const sistema = within(barra).getByRole('list', { name: 'Sistema' })
    expect(within(sistema).queryByRole('link', { name: 'Configurações' })).not.toBeInTheDocument()
    expect(within(sistema).getByRole('link', { name: 'Manual' })).toBeInTheDocument()
  })

  it('deve manter Configurações alcançável com a barra recolhida', async () => {
    // ARRANGE: recolher economiza largura — o rodapé também não perde destino
    const usuario = userEvent.setup()
    renderizarShell(['agenda.ver', 'configuracoes.ver'])

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Recolher a navegação' }))

    // ASSERT: o nome acessível é o mesmo dos dois estados
    expect(screen.getByRole('link', { name: 'Configurações' })).toBeInTheDocument()
  })
})

describe('AppShell — rodapé de sistema (borda)', () => {
  it('deve não deixar lista vazia nem filete solto para quem só tem sistema', () => {
    // ARRANGE + ACT: nenhuma permissão de operação — o filete não teria o que separar
    renderizarShell(['configuracoes.ver'])

    // ASSERT: uma lista só (o rodapé), sem a ul de operação de espaçador invisível
    const barra = screen.getByRole('navigation', { name: 'Navegação principal' })
    const listas = within(barra).getAllByRole('list')
    expect(listas).toHaveLength(1)
    const [sistema] = listas
    expect(within(sistema).getByRole('link', { name: 'Configurações' })).toBeInTheDocument()
    expect(sistema.className).not.toContain('border-t')
  })

  it('deve ordenar o rodapé com o Manual acima de Configurações', () => {
    // ARRANGE + ACT: o manual vem antes do que ele explica
    renderizarShell(['agenda.ver', 'configuracoes.ver'])

    // ASSERT
    const sistema = screen.getByRole('list', { name: 'Sistema' })
    expect(within(sistema).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Manual',
      'Configurações',
    ])
  })

  it('deve mostrar o Manual a quem não tem permissão nenhuma', () => {
    // ARRANGE + ACT: quem não sabe operar não tem como pedir permissão para aprender —
    // e a tela do manual não lê nada da clínica
    renderizarShell([])

    // ASSERT: o manual está lá, e nenhum destino de operação vazou junto
    const barra = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(barra).getByRole('link', { name: 'Manual' })).toBeInTheDocument()
    expect(within(barra).getAllByRole('link')).toHaveLength(1)
  })

  it('deve manter o Manual alcançável com a barra recolhida', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarShell(['agenda.ver'])

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Recolher a navegação' }))

    // ASSERT: o nome acessível é o mesmo nos dois estados
    expect(screen.getByRole('link', { name: 'Manual' })).toBeInTheDocument()
  })

  it('deve nomear o agrupamento de sistema para leitor de tela', () => {
    // ARRANGE + ACT: o filete comunica aos olhos; o aria-label, a quem ouve
    renderizarShell(['agenda.ver', 'configuracoes.ver'])

    // ASSERT
    expect(screen.getByRole('list', { name: 'Sistema' })).toBeInTheDocument()
  })
})

describe('AppShell — navegação recolhível', () => {
  it('deve nascer expandida para quem nunca escolheu', () => {
    // ARRANGE + ACT: o trilho não pode ser descoberto por acidente
    renderizarShell()

    // ASSERT
    expect(screen.getByRole('button', { name: 'Recolher a navegação' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('deve recolher a navegação e devolver a largura ao conteúdo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarShell()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Recolher a navegação' }))

    // ASSERT
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toHaveClass('w-16')
  })

  it('deve manter todos os destinos acionáveis no trilho', async () => {
    // ARRANGE: recolher economiza largura — NÃO esconde para onde se pode ir
    const usuario = userEvent.setup()
    renderizarShell()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Recolher a navegação' }))

    // ASSERT: o nome acessível é o mesmo dos dois estados
    const item = screen.getByRole('link', { name: 'Agenda' })
    expect(item).toBeInTheDocument()
    expect(item).toHaveAttribute('aria-current', 'page')
  })

  it('deve anunciar o estado no botão que governa a navegação', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarShell()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Recolher a navegação' }))

    // ASSERT
    const botao = screen.getByRole('button', { name: 'Expandir a navegação' })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    expect(botao).toHaveAttribute('aria-controls', 'navegacao-principal')
  })

  it('deve não perder o foco ao recolher pelo teclado', async () => {
    // ARRANGE: quem recolheu de teclado precisa poder expandir de volta
    const usuario = userEvent.setup()
    renderizarShell()
    screen.getByRole('button', { name: 'Recolher a navegação' }).focus()

    // ACT
    await usuario.keyboard('{Enter}')

    // ASSERT
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expandir a navegação' }))
  })

  it('deve continuar sendo a primeira parada de Tab dentro da barra', async () => {
    // ARRANGE: o controle mora na borda, fora do fluxo — o que o mantém antes dos
    // treze destinos é a POSIÇÃO NO DOM, e é isso que este teste prende
    const usuario = userEvent.setup()
    renderizarShell(['agenda.ver', 'configuracoes.ver'])

    // ACT: 1º Tab = "Pular para o conteúdo"; o 2º já é a barra
    await usuario.tab()
    await usuario.tab()

    // ASSERT
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Recolher a navegação' }))
  })

  it('deve manter o alvo de clique maior que o desenho e acima dos itens', () => {
    // O jsdom não faz layout: quem provou o defeito foi o NAVEGADOR — clicar na metade
    // do controle que cruza a linha de um item de menu navegava para o item (os itens
    // são `relative` e vêm depois no DOM), e três pixels fora do círculo de 28px não
    // acertavam nada. O que este teste prende é o CONTRATO que consertou os dois.
    // ARRANGE + ACT
    renderizarShell(['agenda.ver', 'configuracoes.ver'])

    // ASSERT
    const controle = screen.getByRole('button', { name: 'Recolher a navegação' })
    expect(controle.className).toContain('z-(--z-fixo-canto)')
    // o ::after só gera caixa com os TRÊS juntos — sem qualquer um, o alvo volta a 32px
    expect(controle.className).toContain('after:absolute')
    expect(controle.className).toContain("after:content-['']")
    // enviesado para FORA: folga em cima/embaixo/fora, nenhuma para dentro — o lado
    // de dentro é território dos itens e da scrollbar da lista (achado do parecer)
    expect(controle.className).toContain('after:-inset-y-2')
    expect(controle.className).toContain('after:-right-2')
    expect(controle.className).toContain('after:left-0')
    // centrado por top-calc, NUNCA por -translate-y: o active:translate-y-px da base
    // do Botao escreve a mesma var e derrubava o controle ~17px no clique
    expect(controle.className).not.toContain('-translate-y-1/2')
  })

  it('deve não ter violações axe com a navegação recolhida', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { container } = renderizarShell()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Recolher a navegação' }))
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})

/**
 * DIMENSIONAMENTO da barra de utilitários.
 *
 * O jsdom não faz layout: não há como medir aqui que o nome quebrou em duas linhas — foi por
 * MEDIÇÃO NO NAVEGADOR que o defeito apareceu (barra 1066px, contadores 849px, sessão 179px, o
 * flex esmagando a sessão). O que estes testes prendem é o CONTRATO que produz o comportamento
 * certo, para que ele não seja desfeito sem que alguém veja: quem cede é o lado dos contadores,
 * a sessão não encolhe, o nome trunca, e o rótulo do contador responde à barra (`@container`),
 * não à janela. A prova visual continua sendo a verificação ao vivo nas quatro larguras.
 */
describe('AppShell — a barra não esmaga a sessão', () => {
  it('deve declarar o contêiner de consulta na própria barra', () => {
    // ARRANGE + ACT
    renderizarShell()

    // ASSERT — sem `@container` no header, o `@6xl:` do rótulo nunca casa e os rótulos somem para
    // sempre; com um limiar de JANELA no lugar dele, voltam a aparecer onde não cabem
    const barra = document.querySelector('header')
    expect(barra).toHaveClass('@container')
  })

  it('deve fazer os contadores cederem espaço, nunca a sessão', async () => {
    // ARRANGE — com um bloco presente os contadores existem de verdade na barra
    servidor.use(
      msw.get('/api/notificacoes', () => HttpResponse.json({ informativos: { total: 3, itens: [] } })),
    )

    // ACT
    renderizarShell()

    // ASSERT — o grupo dos contadores encolhe (`min-w-0`); o da sessão não (`shrink-0`)
    const contadores = await screen.findByRole('list', { name: 'Notificações' })
    expect(contadores.parentElement).toHaveClass('min-w-0')
    // ...e o conteúdo dos contadores fica CONTIDO na própria caixa. Sem isto, a caixa encolhe mas o
    // conteúdo derrama: em janela muito estreita o nome do usuário era desenhado POR CIMA dos
    // contadores (achado da verificação ao vivo, pior que a quebra de linha original)
    expect(contadores.parentElement).toHaveClass('overflow-x-auto')

    const sair = screen.getByRole('button', { name: 'Sair' })
    expect(sair.parentElement).toHaveClass('shrink-0')
  })

  it('deve manter o nome do usuário em uma linha, com TETO para as reticências', () => {
    // ARRANGE + ACT
    renderizarShell()

    // ASSERT — `truncate` sozinho só garante o `nowrap`: sem um teto de largura, a caixa é do
    // tamanho do texto e o `ellipsis` NUNCA age — um nome longo empurrava o Sair para fora da
    // barra (medido: 502px de nome ⇒ transbordo + scroll horizontal no documento). O teto é o que
    // torna verdadeira a promessa da spec (achado CR-FX-02 do gate).
    // Desde a change barra-do-topo-no-celular a regra vale a partir de 30rem de BARRA (container
    // query); abaixo disso o nome é só para leitor de tela — jsdom não aplica container query,
    // então aqui a guarda é a presença das classes nos dois lados do limiar.
    const nome = screen.getByText(usuarioFicticio.nome)
    expect(nome).toHaveClass('@min-[30rem]:truncate')
    expect(nome.className).toMatch(/@min-\[30rem\]:max-w-/)
    expect(nome).toHaveClass('sr-only')
    expect(nome).toHaveClass('@min-[30rem]:not-sr-only')
    // e o nome inteiro continua alcançável para quem passa o mouse
    expect(nome).toHaveAttribute('title', usuarioFicticio.nome)
  })

  it('deve decidir o rótulo do contador pela largura da BARRA, não da janela', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/notificacoes', () => HttpResponse.json({ informativos: { total: 3, itens: [] } })),
    )

    // ACT
    renderizarShell()

    // ASSERT — o rótulo curto usa variante de CONTÊINER (`@`); um limiar de viewport erra nos
    // dois sentidos, porque recolher a navegação muda a largura da barra sem mudar a janela.
    // O NÚMERO do limiar é recalibrado a cada bloco novo (eram 8, hoje são 11) e não é o que
    // esta guarda protege — ela protege o EIXO da medida.
    // O utilitário que MOSTRA o rótulo passou de `inline` a `not-sr-only` (achado A11Y-BT-01: abaixo
    // do limiar ele sai da vista mas fica no nome acessível). O eixo protegido é o mesmo.
    const contadores = await screen.findByRole('list', { name: 'Notificações' })
    const classes = [...contadores.querySelectorAll('span')].map((no) => no.className)
    expect(classes.some((classe) => /(^|\s)@[\w[\]-]+:(inline|not-sr-only)/.test(classe))).toBe(true)
    // `(^|\s)xl:…` não casa `@6xl:…` (o caractere anterior é `6`): a asserção reprova o limiar de
    // VIEWPORT voltando, sem reprovar o de contêiner
    expect(classes.some((classe) => /(^|\s)xl:(inline|not-sr-only)/.test(classe))).toBe(false)
  })
})

/**
 * A NAVEGAÇÃO EM TELA ESTREITA (change agenda-no-celular, bloco 1).
 *
 * A recepcionista consulta a agenda pelo celular e o sistema não deixava: a barra tinha
 * largura fixa e nenhum breakpoint, então a 390px sobravam ~134px para o conteúdo. Isso
 * reprovava WCAG 1.4.10 em TODA tela do produto, não só na agenda.
 */
describe('AppShell — em tela estreita a navegação vira gaveta', () => {
  it('NÃO deve ocupar coluna ao lado do conteúdo', async () => {
    // ARRANGE — viewport abaixo do breakpoint de refluxo
    fingirTelaEstreita(true)

    // ACT
    renderizarShell(['agenda.ver', 'pacientes.ver'])

    // ASSERT — a navegação não está no DOM enquanto a gaveta está fechada; o que existe é o
    // gatilho dela. Coluna escondida por CSS deixaria os destinos no DOM, e o leitor de tela
    // leria a navegação inteira antes do conteúdo.
    expect(await screen.findByRole('button', { name: 'Abrir a navegação' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).not.toBeInTheDocument()
  })

  it('deve FECHAR a gaveta ao navegar por um destino', async () => {
    /*
     * ARRANGE — o `NavLink` não fecha o Dialog sozinho no client-side routing. Sem isto a
     * rota troca por baixo, a gaveta fica por cima e o resto da aplicação continua
     * `aria-hidden`: a recepcionista clica, a página muda sem ela ver, e o único jeito de
     * descobrir é tocar fora ou apertar Esc.
     *
     * Esta casa já pagou por este defeito no popover dos contadores — a célula "deve fechar
     * o painel ao navegar por um item" existe por isso. A gaveta repetiu o erro sem a guarda.
     */
    fingirTelaEstreita(true)
    const usuario = userEvent.setup()
    renderizarShell(['agenda.ver', 'pacientes.ver'])
    await usuario.click(await screen.findByRole('button', { name: 'Abrir a navegação' }))
    const gaveta = await screen.findByRole('dialog', { name: 'Navegação principal' })

    // ACT
    await usuario.click(within(gaveta).getByRole('link', { name: /Pacientes/ }))

    /*
     * ASSERT — a gaveta sai do caminho E o destino aparece. As duas importam: só a primeira
     * passaria com a navegação quebrada, só a segunda com a gaveta encobrindo tudo.
     *
     * A consulta é REFEITA (`queryByRole`), nunca sobre o nó guardado na variável: o clique
     * re-renderiza e o Radix troca o nó do `Dialog.Content`, então `expect(gaveta).not
     * .toBeInTheDocument()` fica verde com a gaveta ABERTA — o nó antigo se desprendeu e um
     * novo tomou o lugar. Foi o que aconteceu na primeira versão desta célula.
     */
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Navegação principal' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('main')).toHaveTextContent('Lista de pacientes')
  })

  it('deve abrir a gaveta e fechá-la com Esc, devolvendo o foco ao gatilho', async () => {
    // ARRANGE
    fingirTelaEstreita(true)
    const usuario = userEvent.setup()
    renderizarShell(['agenda.ver'])

    // ACT
    const gatilho = await screen.findByRole('button', { name: 'Abrir a navegação' })
    await usuario.click(gatilho)
    const gaveta = await screen.findByRole('dialog', { name: 'Navegação principal' })
    await usuario.keyboard('{Escape}')

    // ASSERT — fecha E devolve o foco: sem isso, quem navega por teclado volta ao topo da
    // página e refaz o caminho inteiro
    await waitFor(() => {
      expect(gaveta).not.toBeInTheDocument()
    })
    expect(gatilho).toHaveFocus()
  })

  it('NÃO deve perder destino nenhum na gaveta', async () => {
    /*
     * ARRANGE — o requisito é explícito: nenhum destino pode existir num arranjo e faltar no
     * outro. Duplicar a lista criaria exatamente esse defeito, e ele só apareceria no dia em
     * que alguém abrisse o celular. As DUAS listas entram — operação e sistema.
     */
    const permissoes = ['agenda.ver', 'pacientes.ver', 'configuracoes.ver']
    fingirTelaEstreita(false)
    const largo = renderizarShell(permissoes)
    const naColuna = within(screen.getByRole('navigation', { name: 'Navegação principal' }))
      .getAllByRole('link')
      .map((item) => item.getAttribute('href'))
    largo.unmount()

    // ACT — a mesma sessão, em tela estreita
    fingirTelaEstreita(true)
    const usuario = userEvent.setup()
    renderizarShell(permissoes)
    await usuario.click(await screen.findByRole('button', { name: 'Abrir a navegação' }))

    // ASSERT — os mesmos destinos, na mesma ordem
    const gaveta = await screen.findByRole('dialog', { name: 'Navegação principal' })
    const naGaveta = within(gaveta)
      .getAllByRole('link')
      .map((item) => item.getAttribute('href'))
    expect(naGaveta).toEqual(naColuna)
  })

  it('NÃO deve deixar a preferência de recolher mandar em tela estreita', async () => {
    /*
     * ARRANGE — com a preferência RECOLHIDA, e não no padrão.
     *
     * A primeira versão desta célula rodava no padrão (expandido), onde `emTrilho` é falso de
     * qualquer jeito: a mutação que apaga `&& !telaEstreita` SOBREVIVIA. O cenário do design
     * D3 é justamente o oposto — quem recolheu em tela larga não pode receber um trilho de
     * ícones no celular, onde a gaveta já tem a largura toda.
     */
    fingirTelaEstreita(true)
    window.localStorage.setItem(`xiax:layout:${usuarioFicticio.id}`, JSON.stringify({ menu: true }))
    const usuario = userEvent.setup()
    renderizarShell(['agenda.ver', 'configuracoes.ver'])

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Abrir a navegação' }))

    /*
     * ASSERT — o rótulo aparece AOS OLHOS, não só ao leitor de tela.
     *
     * `textContent` não serve de oráculo aqui: no trilho o rótulo continua no DOM sob
     * `sr-only` (é assim que o nome acessível se mantém igual nos dois estados). A primeira
     * versão desta asserção usava `textContent` e não podia falhar — a mutação que devolve o
     * trilho à gaveta sobrevivia. O que distingue trilho de barra cheia é o `sr-only`.
     */
    const gaveta = await screen.findByRole('dialog', { name: 'Navegação principal' })
    const agenda = within(gaveta).getByRole('link', { name: 'Agenda' })
    const rotulo = within(agenda).getByText('Agenda')
    expect(rotulo).not.toHaveClass('sr-only')
    // e o controle de recolher, que é da coluna, não vem junto
    expect(within(gaveta).queryByRole('button', { name: /Recolher a navegação/ })).not.toBeInTheDocument()
  })

  it('deve RECORTAR os rótulos invisíveis dos contadores, que são absolutos', async () => {
    /*
     * ARRANGE — `sr-only` é `position: absolute` no Tailwind, e filho absoluto só é recortado
     * pelo `overflow` de um ancestral POSICIONADO. Num contêiner `static` ele ESCAPA e estica
     * o documento: medido ao vivo numa janela de 500px, `documentElement.scrollWidth` era 549
     * porque o rótulo invisível "Informativos" pousava em `left: 549`. A página inteira rolava
     * de lado por causa de um texto que ninguém vê.
     *
     * A asserção é da CLASSE, e não da medida: o jsdom não calcula layout, então nem o `axe`
     * nem `getBoundingClientRect` sabem disso aqui. A medição de verdade é o passe ao vivo;
     * esta célula existe para o `relative` não sumir numa refatoração.
     */
    fingirTelaEstreita(true)

    // ACT
    const { container } = renderizarShell(['agenda.ver'])
    await screen.findByRole('button', { name: 'Abrir a navegação' })

    // ASSERT — a caixa rolável dos contadores tem de ser o bloco que CONTÉM os absolutos
    const caixa = container.querySelector('header .overflow-x-auto')
    expect(caixa).not.toBeNull()
    expect(caixa).toHaveClass('relative')
  })

  it('deve passar no axe com a gaveta FECHADA e ABERTA', async () => {
    // ARRANGE — são duas árvores diferentes, e a de gaveta aberta é onde nasce foco solto
    fingirTelaEstreita(true)
    const usuario = userEvent.setup()
    const { container } = renderizarShell(['agenda.ver', 'configuracoes.ver'])

    // ACT / ASSERT — fechada
    await screen.findByRole('button', { name: 'Abrir a navegação' })
    expect(await axe(container)).toHaveNoViolations()

    // ACT / ASSERT — aberta (o conteúdo vai para um portal: o axe roda no body)
    await usuario.click(screen.getByRole('button', { name: 'Abrir a navegação' }))
    await screen.findByRole('dialog', { name: 'Navegação principal' })
    expect(await axe(document.body)).toHaveNoViolations()
  })
})

describe('AppShell — o controle de recolher devolve o nome aos olhos (botoes-com-nome-na-agenda)', () => {
  it('deve mostrar a dica "Recolher a navegação" ao passar o mouse, decorativa', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarShell(['agenda.ver'])
    const controle = screen.getByRole('button', { name: 'Recolher a navegação' })

    // ACT
    await usuario.hover(controle)

    // ASSERT: a dica é aria-hidden (o leitor de tela já ouve o nome) e visível
    const dica = within(controle).getByText('Recolher a navegação', { selector: '[aria-hidden="true"]' })
    expect(dica).toHaveAttribute('data-visivel', 'sim')
    // o nome acessível continua o mesmo — não depende da dica
    expect(controle).toHaveAccessibleName('Recolher a navegação')
  })

  it('deve trocar o texto da dica junto com o estado', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarShell(['agenda.ver'])

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Recolher a navegação' }))
    const controle = screen.getByRole('button', { name: 'Expandir a navegação' })

    // ASSERT
    expect(within(controle).getByText('Expandir a navegação', { selector: '[aria-hidden="true"]' })).toBeInTheDocument()
  })
})

describe('AppShell — as cores da clínica (change tema-da-clinica)', () => {
  it('deve pintar a tela no tema da sessão e devolver o Padrão ao sair do shell', () => {
    // ARRANGE — o login vive fora do shell: sair dele é o que impede o login de herdar a cor
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'], marca: { ...usuarioFicticio.marca, tema: 'menta' } },
      carregandoSessao: false,
    })
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
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
    expect(document.documentElement.dataset.tema).toBe('menta')

    // ACT
    unmount()

    // ASSERT
    expect(document.documentElement.dataset.tema).toBeUndefined()
  })

  it('deve marcar o item ativo do menu com o papel de destaque, e o texto com o acento', () => {
    // ARRANGE + ACT
    renderizarShell(['agenda.ver'])

    // ASSERT — o traço é marcador (rosa no tema); o texto continua no acento, legível
    const ativo = screen.getByRole('link', { name: 'Agenda', current: 'page' })
    expect(ativo.className).toContain('before:bg-destaque')
    expect(ativo.className).toContain('text-acento')
    // o fio recuado no tema (encostava na curva da pílula) e o foco por dentro (o contêiner corta)
    expect(ativo.className).toContain('before:left-recuo-fio')
    expect(ativo.className).toContain('focus-visible:-outline-offset-2')
  })
})
