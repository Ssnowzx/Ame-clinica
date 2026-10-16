import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { SelecaoDaAgenda } from '@/tipos'

import { DesmarqueEmLote } from '@/componentes/agenda/desmarque-em-lote'
import { ProvedorToast } from '@/componentes/ui/toast'
import { chaves } from '@/lib/chaves-query'
import { queryClient, TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarSelecaoDaAgenda } from '@/servicos/agenda'
import { SELECAO_FICTICIA } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import { useAuthStore } from '@/stores/auth-store'

expect.extend(toHaveNoViolations)

const PREVIA_PADRAO = {
  contagens: { agendamentos: 8, bloqueios: 3, criancas: 5, avisos: 5, sessoes_estornadas: 2 },
  recusados: [{ id: 9, inicio: '2026-09-14 15:00', motivo: 'ciclo_fechado' }],
}

function renderizar(permissoes: string[] = ['agenda.editar', 'mensagens.responder']) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(arvore())
}

/** A árvore inteira — separada do `render` para o teste de re-render do pai poder repeti-la. */
function arvore() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
      <DesmarqueEmLote
        aberto
        aoFechar={vi.fn()}
        profissionalId={7}
        nomeDoProfissional="Ana Fictícia"
        dataDaAgenda="2026-09-14"
        aoEscolherHorarioEspecifico={vi.fn()}
      />
      </ProvedorToast>
    </QueryClientProvider>
  )
}

describe('DesmarqueEmLote — a proteção é toda antes do clique', () => {
  it('não deve oferecer a execução antes de a prévia ser carregada', async () => {
    // ARRANGE / ACT
    renderizar()

    // ASSERT — só o botão da prévia; ninguém desmarca sem ver o número
    expect(screen.getByRole('button', { name: 'Ver o que será desmarcado' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Desmarcar/ })).not.toBeInTheDocument()
  })

  it('deve mostrar agendamentos, CRIANÇAS e mensagens depois da prévia', async () => {
    // ARRANGE — "8 agendamentos" esconde que são 5 famílias
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
    )
    renderizar()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ASSERT
    expect(await screen.findByText(/8 agendamento\(s\) · 5 criança\(s\) · 5 mensagem\(ns\)/)).toBeInTheDocument()
    expect(screen.getByText(/2 sessão\(ões\) volta\(m\)/)).toBeInTheDocument()
  })

  it('deve avisar que as mensagens não podem ser canceladas depois', async () => {
    // ARRANGE — mensagem enviada não volta, e quem confirma precisa saber disso ANTES
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
    )
    renderizar()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ASSERT
    expect(
      await screen.findByText('As mensagens não podem ser canceladas depois de enviadas.'),
    ).toBeInTheDocument()
  })

  it('deve INVALIDAR a prévia quando o alcance muda', async () => {
    // ARRANGE — número velho é pior que número nenhum: entre ver e confirmar, o mundo muda
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
    )
    renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))
    expect(await screen.findByRole('button', { name: /^Desmarcar/ })).toBeInTheDocument()

    // ACT — troca o período
    await userEvent.click(screen.getByRole('button', { name: 'Manhã' }))

    // ASSERT
    expect(screen.queryByRole('button', { name: /^Desmarcar/ })).not.toBeInTheDocument()
  })

  it('deve listar o que NÃO será tocado, com o motivo em português', async () => {
    // ARRANGE
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
    )
    renderizar()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ASSERT — a chave de máquina não chega à tela de quem opera
    expect(await screen.findByText(/faturamento do convênio já fechado/)).toBeInTheDocument()
    expect(screen.queryByText(/ciclo_fechado/)).not.toBeInTheDocument()
  })

  it('deve nascer com bloquear e avisar MARCADOS', async () => {
    // ARRANGE / ACT — decisão da clínica: o profissional não está, e a família é avisada
    renderizar()

    // ASSERT
    expect(screen.getByRole('checkbox', { name: /Bloquear o período/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Avisar as famílias/ })).toBeChecked()
  })

  it('não deve oferecer a caixa de aviso sem a permissão de mensagens', async () => {
    // ARRANGE / ACT
    renderizar(['agenda.editar'])

    // ASSERT — some a caixa, aparece o caminho de avisar à mão
    expect(screen.queryByRole('checkbox', { name: /Avisar as famílias/ })).not.toBeInTheDocument()
    expect(screen.getByText(/avisar à mão/)).toBeInTheDocument()
  })

  it('deve mostrar o resultado separando desmarcados, recusados e não-avisados', async () => {
    // ARRANGE
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
      msw.post('/api/agendamentos/desmarque-em-lote', () =>
        HttpResponse.json({
          desmarcados: 7,
          recusados: [{ id: 9, inicio: '2026-09-14 15:00', motivo: 'atendimento_registrado' }],
          avisados: 4,
          nao_avisados: [{ paciente_id: 3, motivo: 'sem telefone cadastrado' }],
        }),
      ),
    )
    renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ACT
    await userEvent.click(await screen.findByRole('button', { name: /^Desmarcar/ }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByText(/7 agendamento\(s\) desmarcado\(s\) · 4 família\(s\) avisada\(s\)/)).toBeInTheDocument()
    })
    expect(screen.getByText(/atendimento já registrado/)).toBeInTheDocument()
    expect(screen.getByText('1 — sem telefone cadastrado')).toBeInTheDocument()
  })

  it('deve traduzir a recusa por teto em orientação, não em texto cru', async () => {
    // ARRANGE — o servidor recusa com a contagem e o teto
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () =>
        HttpResponse.json(
          { message: 'erro', errors: { ate: ['O alcance tem 80 agendamentos e o máximo por operação é 60. Estreite o intervalo de datas ou o período.'] } },
          { status: 422 },
        ),
      ),
    )
    renderizar()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ASSERT — a orientação chega, e a execução continua indisponível.
    // `findAllByText` porque ela aparece em DOIS lugares: no campo "Até" e no aviso de erro
    // do topo. Redundante, não errado — quem opera com o telefone tocando lê o que estiver
    // mais perto do olho.
    expect(await screen.findAllByText(/Estreite o intervalo/)).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^Desmarcar/ })).not.toBeInTheDocument()
  })

  it('não deve oferecer "Desmarcar 0" quando o alcance está vazio', async () => {
    // ARRANGE — achado ao vivo: a prévia com alcance vazio oferecia o botão de perigo mesmo
    // sem nada para desmarcar
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () =>
        HttpResponse.json({
          contagens: { agendamentos: 0, bloqueios: 0, criancas: 0, avisos: 0, sessoes_estornadas: 0 },
          recusados: [],
        }),
      ),
    )
    renderizar()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ASSERT — diz que não há nada, e não oferece o gesto
    // duas vezes: no painel visível e na região viva (`sr-only`), que é o que o leitor de
    // tela ouve — as duas são intencionais
    expect(await screen.findAllByText(/Nada a desmarcar nesse período/)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Desmarcar \d/ })).not.toBeInTheDocument()
  })

  it('deve MOSTRAR a recusa por status não configurado, em vez de engolir', async () => {
    // ARRANGE — achado ao vivo: a mensagem vinha em `status_id`, campo que não existe nesta
    // tela, e desaparecia. Quem clicava não recebia nada — nem erro, nem desmarque.
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
      msw.post('/api/agendamentos/desmarque-em-lote', () =>
        HttpResponse.json(
          {
            message: 'erro',
            errors: {
              status_id: [
                'Configure o status do desmarque em Configurações › Agenda antes de desmarcar em lote.',
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )
    renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ACT
    await userEvent.click(await screen.findByRole('button', { name: /^Desmarcar \d/ }))

    // ASSERT — o caminho da correção chega a quem opera (aviso do topo + toast: duas vezes,
    // que é o comportamento do hook de erros da casa)
    expect(await screen.findAllByText(/Configure o status do desmarque/)).not.toHaveLength(0)
  })

  it('deve AGRUPAR as famílias não-avisadas por motivo, com a contagem', async () => {
    // ARRANGE — ao vivo a lista trouxe "canal do WhatsApp não conectado" três vezes seguidas,
    // sem dizer quem: três linhas iguais não dão o que fazer
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
      msw.post('/api/agendamentos/desmarque-em-lote', () =>
        HttpResponse.json({
          desmarcados: 7,
          recusados: [],
          avisados: 0,
          nao_avisados: [
            { paciente_id: 1, motivo: 'canal do WhatsApp não conectado' },
            { paciente_id: 2, motivo: 'canal do WhatsApp não conectado' },
            { paciente_id: 3, motivo: 'canal do WhatsApp não conectado' },
          ],
        }),
      ),
    )
    renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ACT
    await userEvent.click(await screen.findByRole('button', { name: /^Desmarcar \d/ }))

    // ASSERT — uma linha com a contagem, não três iguais
    expect(await screen.findByText('3 — canal do WhatsApp não conectado')).toBeInTheDocument()
    expect(screen.getByText(/3 família\(s\) que você precisa avisar/)).toBeInTheDocument()
  })

  it('deve mostrar quantos BLOQUEIOS a operação grava, não só os agendamentos', async () => {
    // ARRANGE — o gate mediu a prévia dizendo "1 agendamento · 1 criança" enquanto o servidor
    // escrevia 1206 linhas: o número que a pessoa confirma tem de ser o MAIOR que a operação
    // grava, não o menor
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
    )
    renderizar()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ASSERT
    expect(await screen.findByText(/3 bloqueio\(s\) de agenda serão criados/)).toBeInTheDocument()
  })

  it('deve manter as ações no RODAPÉ FIXO, fora do corpo rolável', async () => {
    // ARRANGE — o gate mediu o botão que executa a ação irreversível nascendo FORA da vista:
    // 132px abaixo em 390px e 20px em 1366×768. A spec manda a tela dizer o número antes do
    // clique; número renderizado fora do viewport não diz.
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
    )
    renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ACT
    const executar = await screen.findByRole('button', { name: /^Desmarcar \d/ })

    // ASSERT — o rodapé do Dialog é <footer>; o corpo rolável é o irmão acima
    expect(executar.closest('footer')).not.toBeNull()
  })

  it('deve anunciar a prévia como região viva', async () => {
    // ARRANGE — a prévia nasce depois de uma ação e é a proteção inteira da feature
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
    )
    renderizar()

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ASSERT
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/8 agendamento\(s\)/)
  })

  it('deve trocar o cabeçalho na tela de resultado — a moldura não pode contradizer o corpo', async () => {
    // ARRANGE — o título continuava "Nada é desmarcado antes de você ver os números" DEPOIS
    // de os agendamentos terem sido desmarcados (achado do gate)
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
      msw.post('/api/agendamentos/desmarque-em-lote', () =>
        HttpResponse.json({ desmarcados: 7, recusados: [], avisados: 0, nao_avisados: [] }),
      ),
    )
    renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ACT
    await userEvent.click(await screen.findByRole('button', { name: /^Desmarcar \d/ }))

    // ASSERT
    expect(await screen.findByText(/desmarcada$/)).toBeInTheDocument()
    expect(screen.queryByText(/Nada é desmarcado antes/)).not.toBeInTheDocument()
  })

  it('deve ANUNCIAR a prévia por uma região viva que já existe antes da mensagem', async () => {
    // ARRANGE — criar a região junto com o conteúdo é o anti-padrão que falha em parte dos
    // leitores de tela. Foi o que eu tinha feito na primeira tentativa (achado do gate).
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
    )
    renderizar()
    // a região existe ANTES de qualquer ação, vazia
    expect(screen.getByRole('status')).toHaveTextContent('')

    // ACT
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ASSERT — e o anúncio traz o número de CRIANÇAS e a irreversibilidade
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/8 agendamento\(s\), 5 criança\(s\)/)
    })
    expect(screen.getByRole('status')).toHaveTextContent(/não podem ser canceladas/)
  })

  it('deve levar o FOCO ao resultado — ninguém é conduzido às listas sem isso', async () => {
    // ARRANGE
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
      msw.post('/api/agendamentos/desmarque-em-lote', () =>
        HttpResponse.json({
          desmarcados: 7,
          recusados: [],
          avisados: 0,
          nao_avisados: [{ paciente_id: 3, motivo: 'sem telefone cadastrado' }],
        }),
      ),
    )
    renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))

    // ACT
    await userEvent.click(await screen.findByRole('button', { name: /^Desmarcar \d/ }))

    // ASSERT
    const titulo = await screen.findByRole('heading', { level: 3 })
    await waitFor(() => {
      expect(titulo).toHaveFocus()
    })
  })

  it('não deve puxar o foco de volta ao título quando o pai re-renderiza sem gesto (2.4.3)', async () => {
    // ARRANGE — resultado pousado, foco levado pela pessoa até o "Fechar" do cabeçalho
    servidor.use(
      msw.post('/api/agendamentos/desmarque-em-lote/previa', () => HttpResponse.json(PREVIA_PADRAO)),
      msw.post('/api/agendamentos/desmarque-em-lote', () =>
        HttpResponse.json({ desmarcados: 7, recusados: [], avisados: 0, nao_avisados: [] }),
      ),
    )
    const { rerender } = renderizar()
    await userEvent.click(screen.getByRole('button', { name: 'Ver o que será desmarcado' }))
    await userEvent.click(await screen.findByRole('button', { name: /^Desmarcar \d/ }))
    const titulo = await screen.findByRole('heading', { level: 3 })
    await waitFor(() => {
      expect(titulo).toHaveFocus()
    })
    const fechar = screen.getAllByRole('button', { name: 'Fechar' })[0]
    fechar?.focus()
    expect(fechar).toHaveFocus()

    // ACT — o relógio da agenda (1×/min) re-renderiza o pai sem nenhuma ação
    rerender(arvore())
    rerender(arvore())

    // ASSERT
    expect(fechar).toHaveFocus()
    expect(titulo).not.toHaveFocus()
  })
})

/**
 * O status do desmarque é DADO da clínica (`agenda.status_desmarque_id`), e sem ele o servidor recusa a
 * execução. A tela já tem a seleção da agenda em mãos — a página a carrega para desenhar a grade —, e
 * é dela que o aviso sai (change `o-sistema-avisa-o-que-falta`, D4). Dados FICTÍCIOS.
 */
describe('DesmarqueEmLote — falta o status do desmarque (o-sistema-avisa-o-que-falta)', () => {
  const QUEM_DESMARCA = ['agenda.editar', 'mensagens.responder']
  const QUEM_CONFIGURA = [...QUEM_DESMARCA, 'configuracoes.ver', 'configuracoes.editar']

  /** Os status da clínica com a flag que o servidor manda; `comODoDesmarque` marca um deles. */
  function statusDaClinica(comODoDesmarque: boolean): SelecaoDaAgenda['status'] {
    return SELECAO_FICTICIA.status.map((status) => ({
      ...status,
      desmarque_da_clinica: comODoDesmarque && status.nome === 'Falta Justificada',
    }))
  }

  /** O que a página da agenda já deixou no cache ao desenhar a grade. */
  function comSelecaoNoCache(status: SelecaoDaAgenda['status']): void {
    queryClient.setQueryData(chaves.selecaoDaAgenda(), { ...SELECAO_FICTICIA, status })
  }

  /** A página da agenda: a consulta ATIVA da seleção, que um `invalidate` comum refaria na hora. */
  function ConsultaDaPagina() {
    useQuery({ queryKey: chaves.selecaoDaAgenda(), queryFn: buscarSelecaoDaAgenda, staleTime: TEMPO_CATALOGO_MS })

    return null
  }

  function renderizarComRota(permissoes: string[], aoFechar: () => void = vi.fn(), comAPagina = false) {
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ProvedorToast>
            {comAPagina ? <ConsultaDaPagina /> : null}
            <DesmarqueEmLote
              aberto
              aoFechar={aoFechar}
              profissionalId={7}
              nomeDoProfissional="Ana Fictícia"
              dataDaAgenda="2026-09-14"
              aoEscolherHorarioEspecifico={vi.fn()}
              status={queryClient.getQueryData<SelecaoDaAgenda>(chaves.selecaoDaAgenda())?.status}
            />
          </ProvedorToast>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  /** As requisições feitas do render até a tela assentar — a prova de "nenhuma requisição nova" (D6). */
  async function requisicoesAoAbrir(status: SelecaoDaAgenda['status']): Promise<string[]> {
    queryClient.clear()
    comSelecaoNoCache(status)
    const pedidas: string[] = []
    const anotar = ({ request }: { request: Request }): void => {
      pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
    }
    servidor.events.on('request:start', anotar)
    const { unmount } = renderizarComRota(QUEM_CONFIGURA)
    await screen.findByRole('button', { name: 'Ver o que será desmarcado' })
    await waitFor(() => {
      expect(queryClient.isFetching()).toBe(0)
    })
    servidor.events.removeListener('request:start', anotar)
    unmount()

    return pedidas.sort()
  }

  it('deve avisar ANTES da prévia que falta o status do desmarque, com o caminho para as Configurações', () => {
    // ARRANGE — nenhum status da seleção é o do desmarque
    comSelecaoNoCache(statusDaClinica(false))

    // ACT
    renderizarComRota(QUEM_CONFIGURA)

    // ASSERT — o aviso diz o que falta, por quê e onde, e vem antes do alcance e de qualquer número
    const aviso = screen.getByText(/o status que os agendamentos recebem quando a agenda é desmarcada/)
    expect(aviso).toHaveTextContent('Falta configurar:')
    expect(aviso).toHaveTextContent('Sem ele, o desmarque é recusado.')
    expect(aviso).toHaveTextContent('Configurações › Agenda, em “Status aplicado ao desmarcar a agenda do profissional”')
    expect(screen.getByRole('link', { name: 'Abrir Configurações' })).toHaveAttribute('href', '/configuracoes')
    const alcance = screen.getByText('O que desmarcar')
    expect(aviso.compareDocumentPosition(alcance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Desmarcar \d/ })).not.toBeInTheDocument()
  })

  it('deve deixar o primário para o caminho de configurar, e a prévia como secundária', () => {
    // ARRANGE — um primário por região (design-system §5.2): sem o status, o caminho adiante é configurar
    comSelecaoNoCache(statusDaClinica(false))

    // ACT
    renderizarComRota(QUEM_CONFIGURA)

    // ASSERT
    expect(screen.getByRole('link', { name: 'Abrir Configurações' })).toHaveClass('bg-botao-primario')
    expect(screen.getByRole('button', { name: 'Ver o que será desmarcado' })).not.toHaveClass('bg-botao-primario')
  })

  it('deve dizer a quem pedir, sem link, a quem não pode mexer nas configurações', () => {
    // ARRANGE — mandar a uma tela que responde 403 é pior que não mandar
    comSelecaoNoCache(statusDaClinica(false))

    // ACT
    renderizarComRota(QUEM_DESMARCA)

    // ASSERT
    expect(screen.getByText(/o status que os agendamentos recebem/)).toHaveTextContent(
      'Peça a quem administra o sistema para configurar.',
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('não deve avisar nada quando o status do desmarque está configurado', () => {
    // ARRANGE — "Falta Justificada" é o do desmarque desta clínica fictícia
    comSelecaoNoCache(statusDaClinica(true))

    // ACT
    renderizarComRota(QUEM_CONFIGURA)

    // ASSERT — o diálogo é o de sempre, com a prévia como o caminho primário
    expect(screen.getByRole('button', { name: 'Ver o que será desmarcado' })).toHaveClass('bg-botao-primario')
    expect(screen.queryByText(/Falta configurar/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Abrir Configurações' })).not.toBeInTheDocument()
  })

  it('não deve afirmar que falta o status quando a seleção não está em mãos', () => {
    // ARRANGE — cache vazio (a seleção da página falhou ou ainda não chegou): o servidor decide
    queryClient.clear()

    // ACT
    renderizarComRota(QUEM_CONFIGURA)

    // ASSERT
    expect(screen.getByRole('button', { name: 'Ver o que será desmarcado' })).toBeInTheDocument()
    expect(screen.queryByText(/Falta configurar/)).not.toBeInTheDocument()
  })

  it('não deve afirmar que falta o status quando a seleção não traz a flag', () => {
    // ARRANGE — payload sem `desmarque_da_clinica` não promete nada
    comSelecaoNoCache(SELECAO_FICTICIA.status)

    // ACT
    renderizarComRota(QUEM_CONFIGURA)

    // ASSERT
    expect(screen.queryByText(/Falta configurar/)).not.toBeInTheDocument()
  })

  it('deve fechar o diálogo, sem buscar nada, ao seguir o caminho', async () => {
    // ARRANGE — a seleção é invalidada por quem SALVA a configuração (CR-AVI-02), não por quem segue o link
    servidor.use(msw.get('/api/agenda/selecao', () => HttpResponse.json({ ...SELECAO_FICTICIA, status: statusDaClinica(false) })))
    comSelecaoNoCache(statusDaClinica(false))
    const aoFechar = vi.fn()
    const pedidas: string[] = []
    const anotar = ({ request }: { request: Request }): void => {
      pedidas.push(new URL(request.url).pathname)
    }
    renderizarComRota(QUEM_CONFIGURA, aoFechar, true)
    servidor.events.on('request:start', anotar)

    // ACT
    await userEvent.click(screen.getByRole('link', { name: 'Abrir Configurações' }))

    // ASSERT
    expect(aoFechar).toHaveBeenCalledTimes(1)
    expect(queryClient.isFetching()).toBe(0)
    servidor.events.removeListener('request:start', anotar)
    expect(pedidas).toEqual([])
  })

  it('deve abrir o diálogo sem nenhuma requisição, com e sem o aviso (nenhuma requisição nova)', async () => {
    // ARRANGE / ACT — o aviso sai da seleção que a página já carregou (D6)
    const comAviso = await requisicoesAoAbrir(statusDaClinica(false))
    const semAviso = await requisicoesAoAbrir(statusDaClinica(true))

    // ASSERT — abrir o diálogo não pede nada ao servidor; a prévia só sai no clique
    expect(comAviso).toEqual(semAviso)
    expect(comAviso).toEqual([])
  })

  it('deve passar no axe com o aviso, com e sem a permissão de configurar', async () => {
    for (const permissoes of [QUEM_CONFIGURA, QUEM_DESMARCA]) {
      // ARRANGE
      queryClient.clear()
      comSelecaoNoCache(statusDaClinica(false))

      // ACT
      const { unmount } = renderizarComRota(permissoes)
      const dialogo = screen.getByRole('dialog')

      // ASSERT
      expect(screen.getByText(/o status que os agendamentos recebem/)).toBeInTheDocument()
      expect(await axe(dialogo)).toHaveNoViolations()
      unmount()
    }
  })
})
