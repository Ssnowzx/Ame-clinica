import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, delay, http as msw } from 'msw'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { PainelAgendamento } from '@/componentes/agenda/painel-agendamento'
import { ProvedorToast } from '@/componentes/ui/toast'
import type { StatusDaSelecao } from '@/hooks/usar-troca-de-status'
import { chaves } from '@/lib/chaves-query'
import { queryClient } from '@/lib/query-client'
import { buscarAgenda } from '@/servicos/agenda'
import { useAuthStore } from '@/stores/auth-store'
import { SELECAO_FICTICIA, detalheFicticio } from '@/test/dados-agenda'
import { pacienteFicticio } from '@/test/dados-cadastros'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { CardAgendamento } from '@/tipos'

expect.extend(toHaveNoViolations)

/** A forma que o serviço de atendimento lê (`GET /api/atendimentos`). */
function paginaAtendimentos(itens: unknown[]) {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

function comPermissoes(permissoes: string[]): void {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
}

// Dados FICTÍCIOS (LGPD — nunca paciente real).
const CARD: CardAgendamento = {
  id: 42,
  updated_at: '2026-07-15T10:00:00.000000Z',
  tipo: 'atendimento',
  profissional_id: 7,
  paciente_id: 3,
  tratamento_id: 9,
  status_id: 1,
  inicio: '2026-07-16 14:00',
  fim: '2026-07-16 14:40',
  duracao_minutos: 40,
  is_reposicao: false,
  paciente: { id: 3, nome: 'Paciente Fictício', nome_social: null },
  especialidade: { id: 2, nome: 'Fonoaudiologia', cor: '#448247' },
  status: { id: 1, nome: 'Em Aberto', cor: '#64748B', cor_borda: null, tipo: 'circle-dashed' },
  profissional: { id: 7, nome: 'Profissional Fictício' },
  sala: { id: 5, nome: 'Sala 3' },
  tratamento_saldo: 8,
  tratamento_total: 30,
  tratamento_realce: 'nenhum',
  convenio: { id: 1, nome: 'Convênio Fictício', particular: false },
}

function cardCom(sobrescreve: Partial<CardAgendamento>): CardAgendamento {
  return { ...CARD, ...sobrescreve }
}

// O painel busca o detalhe (obs) ao abrir — default sem obs; testes de obs sobrescrevem.
beforeEach(() => {
  servidor.use(msw.get('/api/agendamentos/:id', () => HttpResponse.json(detalheFicticio(CARD))))
  // as "Próximas sessões" (change horario-de-termino-no-card) nascem abertas e leem a agenda da
  // criança ao abrir o painel: o default é "nenhuma outra sessão", no FORMATO da API
  servidor.use(
    msw.get('/api/pacientes/:id/agendamentos', () =>
      HttpResponse.json({
        proximos: { janela: { de: '2026-07-15', ate: null }, total: 0, itens: [] },
        recentes: { janela: { de: '2026-04-16', ate: '2026-07-15' }, total: 0, itens: [] },
      }),
    ),
  )
})

function renderPainel(card: CardAgendamento, props: { aoEditar?: (card: CardAgendamento) => void } = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProvedorToast>
          <PainelAgendamento aberto card={card} aoFechar={() => {}} aoEditar={props.aoEditar ?? (() => {})} />
        </ProvedorToast>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PainelAgendamento — o horário completo e as próximas sessões (horario-de-termino-no-card)', () => {
  it('deve dizer início, término e duração em "Quando"', () => {
    // ARRANGE
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT
    expect(screen.getByRole('dialog')).toHaveTextContent('16/07/2026, das 14:00 às 14:40 · 40 min')
  })

  it('deve mostrar ao abrir as próximas sessões da criança, cada uma com o próprio horário', async () => {
    // ARRANGE — o pedido: o card diz só o horário do dia; o resto aparece ao abrir
    comPermissoes(['agenda.ver'])
    servidor.use(
      msw.get('/api/pacientes/:id/agendamentos', () =>
        HttpResponse.json({
          proximos: {
            janela: { de: '2026-07-15', ate: null },
            total: 2,
            itens: [
              { id: 42, inicio: '2026-07-16 14:00', fim: '2026-07-16 14:40', especialidade: null, profissional: null, status: null, tem_evolucao: null },
              { id: 43, inicio: '2026-07-21 09:20', fim: '2026-07-21 10:10', especialidade: null, profissional: null, status: null, tem_evolucao: null },
            ],
          },
          recentes: { janela: { de: '2026-04-16', ate: '2026-07-15' }, total: 0, itens: [] },
        }),
      ),
    )

    // ACT
    renderPainel(CARD)

    // ASSERT — a outra sessão, com o horário dela; a aberta não se repete
    expect(await screen.findByText('21/07/2026, das 09:20 às 10:10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximas sessões' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByText('16/07/2026, das 14:00 às 14:40')).not.toBeInTheDocument()
  })
})

describe('PainelAgendamento (painel de leitura)', () => {
  it('deve abrir um painel de LEITURA com identidade, contador de sessões e detalhes', () => {
    // ARRANGE — só ver (sem editar/atender: nenhuma query dispara)
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT: leitura, não formulário
    const painel = screen.getByRole('dialog')
    expect(painel).toHaveTextContent('Detalhes do agendamento')
    expect(painel).toHaveTextContent('Paciente Fictício')
    // contador em "sessões", nunca "Guia" (§14): realizadas = total − saldo = 30 − 8
    expect(painel).toHaveTextContent('22/30 sessões')
    expect(painel).not.toHaveTextContent('Guia')
    // detalhes
    expect(painel).toHaveTextContent('Profissional Fictício')
    expect(painel).toHaveTextContent('Fonoaudiologia')
    expect(painel).toHaveTextContent('Sala 3')
  })

  it('deve esconder a troca de status e explicar quando a produção está em período fechado (SEC-TS)', async () => {
    // ARRANGE — o `show` (detail-only, SEC-FC-09) diz `em_ciclo_fechado`: a afordância
    // some (o chip vira leitura) e a linha explica; editar os DEMAIS campos continua.
    comPermissoes(['agenda.ver', 'agenda.editar'])
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json({ ...CARD, em_ciclo_fechado: true }),
      ),
    )

    // ACT
    renderPainel(CARD)

    // ASSERT — a explicação chega com o detalhe, e o gatilho do menu não existe
    await screen.findByText(/produção deste período já foi fechada/i)
    expect(
      screen.queryByRole('button', { name: /mudar status de Paciente Fictício/i }),
    ).not.toBeInTheDocument()
    // o chip continua contando a leitura (status é informação, não gesto)
    expect(screen.getByRole('dialog')).toHaveTextContent('Em Aberto')
    // ...e as demais ações seguem vivas ("Mais ações" abriga o Editar): só o STATUS
    // congela (D2 do design)
    expect(screen.getByRole('button', { name: /Mais ações/i })).toBeInTheDocument()
  })

  it('deve manter a troca de status quando o detalhe não diz período fechado', async () => {
    // ARRANGE — contraste do anterior: mesmo ator, produção livre
    comPermissoes(['agenda.ver', 'agenda.editar'])

    // ACT
    renderPainel(CARD)

    // ASSERT — a afordância existe e nenhuma explicação de congelamento aparece
    expect(
      await screen.findByRole('button', { name: /mudar status de Paciente Fictício/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/produção deste período já foi fechada/i)).not.toBeInTheDocument()
  })

  it('deve levar o nome do paciente à ficha quando há pacientes.ver (link aceso — change ficha-do-paciente)', () => {
    // ARRANGE — a ficha existe: o nome vira LINK para /pacientes/:id
    comPermissoes(['agenda.ver', 'pacientes.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT — link para a ficha (CARD.paciente_id = 3), não texto morto
    const link = screen.getByRole('link', { name: 'Paciente Fictício' })
    expect(link).toHaveAttribute('href', '/pacientes/3')
  })

  it('deve manter o nome como TEXTO (sem link morto) para quem não tem pacientes.ver', () => {
    // ARRANGE — sem pacientes.ver, a ficha é inalcançável: nome é texto, nunca um link morto
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT
    expect(screen.getByText('Paciente Fictício')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Paciente Fictício/ })).not.toBeInTheDocument()
  })

  it('deve dizer "Particular" quando o convênio é particular, nunca o nome', () => {
    // ARRANGE
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(cardCom({ convenio: { id: 9, nome: 'Convênio Fictício', particular: true } }))

    // ASSERT
    const painel = screen.getByRole('dialog')
    expect(painel).toHaveTextContent('Particular')
    expect(painel).not.toHaveTextContent('Convênio Fictício')
  })

  it('deve alertar quando restam poucas sessões no tratamento', () => {
    // ARRANGE
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(cardCom({ tratamento_saldo: 2, tratamento_total: 30, tratamento_realce: 'acabando' }))

    // ASSERT — alerta estático das últimas sessões
    expect(screen.getByRole('status')).toHaveTextContent('Faltam 2 sessões no tratamento.')
  })

  it('deve esconder as ações quando o usuário não pode editar nem ver histórico', () => {
    // ARRANGE — só ver
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument()
  })

  it('deve abrir o Histórico de movimentação (sub-view do mesmo diálogo) e voltar à leitura', async () => {
    // ARRANGE — trilha vazia (a sub-view mostra o estado "sem beco")
    const usuario = userEvent.setup()
    servidor.use(msw.get('/api/auditoria', () => HttpResponse.json({ data: [] })))
    comPermissoes(['agenda.ver', 'auditoria.ver'])
    renderPainel(CARD)

    // ACT — "Mais ações" → Histórico de movimentação
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))
    await usuario.click(screen.getByRole('menuitem', { name: 'Histórico de movimentação' }))

    // ASSERT — mesmo diálogo, título troca; o estado vazio explica e oferece voltar
    const painel = screen.getByRole('dialog')
    expect(painel).toHaveTextContent('Histórico de movimentação')
    expect(await within(painel).findByText('Nenhuma movimentação')).toBeInTheDocument()

    // ACT — voltar retorna à leitura
    await usuario.click(within(painel).getByRole('button', { name: 'Voltar ao agendamento' }))

    // ASSERT
    expect(screen.getByRole('dialog')).toHaveTextContent('Detalhes do agendamento')
  })

  it('deve mover o foco para "Voltar ao agendamento" ao entrar no Histórico (transição declarada)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(msw.get('/api/auditoria', () => HttpResponse.json({ data: [] })))
    comPermissoes(['agenda.ver', 'auditoria.ver'])
    renderPainel(CARD)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))
    await usuario.click(screen.getByRole('menuitem', { name: 'Histórico de movimentação' }))

    // ASSERT — o foco entra na sub-view (2.4.3), não fica solto no diálogo
    const voltar = await screen.findByRole('button', { name: 'Voltar ao agendamento' })
    await waitFor(() => {
      expect(voltar).toHaveFocus()
    })
  })

  it('deve devolver o foco a "Mais ações" ao VOLTAR do Histórico (foco à origem, sem remontar)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(msw.get('/api/auditoria', () => HttpResponse.json({ data: [] })))
    comPermissoes(['agenda.ver', 'auditoria.ver'])
    renderPainel(CARD)

    // ACT — entra e volta
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Histórico de movimentação' }))
    await usuario.click(await screen.findByRole('button', { name: 'Voltar ao agendamento' }))

    // ASSERT — o foco volta à ação de origem (WCAG 2.4.3), não some no "X"
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mais ações' })).toHaveFocus()
    })
  })
})

describe('PainelAgendamento — ações derivadas do status/estado/permissão (3.2)', () => {
  it('deve oferecer Excluir com agenda.excluir e confirmar com o número da série do SERVIDOR (D9)', async () => {
    // ARRANGE — a série tem 4 seguintes; a tela NÃO conta irmãos, o servidor manda
    const usuario = userEvent.setup()
    let excluido = false
    servidor.use(
      msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)),
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 5, a_partir_deste: 5, futuros: 4 }),
      ),
      msw.delete('/api/agendamentos/:id', () => {
        excluido = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    comPermissoes(['agenda.ver', 'agenda.editar', 'agenda.excluir'])
    renderPainel(CARD)

    // ACT — Mais ações → Excluir
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Excluir' }))

    // ASSERT — a confirmação NOMEIA o alvo e traz o número do servidor
    const confirmacao = await screen.findByRole('alertdialog')
    expect(confirmacao).toHaveTextContent('Excluir o agendamento de Paciente Fictício?')
    expect(confirmacao).toHaveTextContent('os outros 4 da série permanecem')

    // ACT — confirmar exclui de fato
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Excluir agendamento' }))

    // ASSERT
    await waitFor(() => {
      expect(excluido).toBe(true)
    })
  })

  it('deve excluir a SÉRIE pelo próprio diálogo, sem passar por Editar', async () => {
    // ARRANGE — a recepção da clínica excluiu uma sexta achando que apagava as 50:
    // a escolha existia só dentro de "Editar", e o painel mandava editar para APAGAR
    const usuario = userEvent.setup()
    let enviado: string | null = null
    servidor.use(
      msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)),
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: true, total: 50, a_partir_deste: 50, futuros: 49 }),
      ),
      msw.delete('/api/agendamentos/:id', ({ request }) => {
        enviado = new URL(request.url).searchParams.get('aplicar_na_serie')
        return new HttpResponse(null, { status: 204 })
      }),
    )
    comPermissoes(['agenda.ver', 'agenda.editar', 'agenda.excluir'])
    renderPainel(CARD)

    // ACT — Mais ações → Excluir → marcar a série no PRÓPRIO diálogo
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Excluir' }))
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByLabelText('Excluir também os seguintes da série'))

    // ASSERT — a consequência passa a contar a série inteira, e nada manda usar Editar
    expect(confirmacao).toHaveTextContent('50 no total')
    expect(confirmacao).not.toHaveTextContent('use Editar')

    // ACT
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Excluir agendamento' }))

    // ASSERT — o escopo escolhido chega ao servidor
    await waitFor(() => {
      expect(enviado).toBe('1')
    })
  })

  it('deve mostrar a recusa do servidor DENTRO do diálogo ao excluir um agendamento protegido', async () => {
    // ARRANGE — o servidor é a autoridade: agendamento com atendimento é protegido
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/agendamentos/:id/serie', () =>
        HttpResponse.json({ em_serie: false, total: 1, a_partir_deste: 1, futuros: 0 }),
      ),
      msw.delete('/api/agendamentos/:id', () =>
        HttpResponse.json(
          { errors: { agendamento: ['Agendamento com atendimento registrado não pode ser excluído.'] } },
          { status: 422 },
        ),
      ),
    )
    comPermissoes(['agenda.ver', 'agenda.excluir'])
    renderPainel(CARD)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Excluir' }))
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Excluir agendamento' }))

    // ASSERT — a mensagem aparece onde a pessoa está olhando (não some num toast)
    expect(await within(confirmacao).findByText(/não pode ser excluído/)).toBeInTheDocument()
  })

  it('não deve oferecer o WhatsApp a quem não fala com as famílias, nem o financeiro a quem não fatura', async () => {
    // ARRANGE — os dois ganchos viraram ação sob a permissão de cada um (changes
    // faturar-pelo-painel-da-agenda e avisar-no-whatsapp-abre-a-conversa)
    const usuario = userEvent.setup()
    servidor.use(msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)))
    comPermissoes(['agenda.ver', 'agenda.editar'])
    renderPainel(CARD)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))

    // ASSERT — nem gatilho morto, nem item que a pessoa não pode usar
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Avisar no WhatsApp/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Lançar no financeiro/ })).not.toBeInTheDocument()
  })

  it('deve exibir "necessidade especial" como MARCADOR de leitura, nunca um checkbox de status', async () => {
    // ARRANGE — dado do PACIENTE (não status); vem do `show` (sob agenda.ver), MINIMIZADO a
    // um booleano — nunca do card da grade (art. 11). Slot só rende quando o sinal vem true.
    servidor.use(
      msw.get('/api/agendamentos/:id', () => HttpResponse.json(cardCom({ necessidade_especial: true }))),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT — marcador presente (após o show), e NENHUM checkbox (o erro do ClinicaÁgil)
    const painel = screen.getByRole('dialog')
    expect(await within(painel).findByText('Necessidades especiais')).toBeInTheDocument()
    expect(within(painel).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('deve OMITIR o marcador de necessidade quando o show não o traz (false/ausente)', () => {
    // ARRANGE + ACT — beforeEach default: show sem necessidade_especial
    comPermissoes(['agenda.ver'])
    renderPainel(CARD)

    // ASSERT — nunca uma pílula vazia
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Necessidades especiais')
  })

  it('deve derivar a primária do ESTADO: agendamento já atendido mostra "Ver evolução"', async () => {
    // ARRANGE — atendimento registrado, com evolução existente
    servidor.use(
      msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)),
      msw.get('/api/atendimentos', () =>
        HttpResponse.json(
          paginaAtendimentos([
            { id: 3, agendamento_id: 42, iniciado_em: null, finalizado_em: '2026-07-16 14:40', evolucao_id: 99 },
          ]),
        ),
      ),
    )
    comPermissoes(['agenda.ver', 'atendimentos.ver', 'evolucoes.ver'])
    renderPainel(CARD)

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Ver evolução' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar atendimento' })).not.toBeInTheDocument()
  })

  it('deve NÃO oferecer registrar atendimento quando o status marca falta (marca_falta)', async () => {
    // ARRANGE — status_id 5 = "Não Compareceu" (marca_falta true no SELECAO_FICTICIA)
    servidor.use(
      msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)),
      msw.get('/api/atendimentos', () => HttpResponse.json(paginaAtendimentos([]))),
    )
    comPermissoes(['agenda.ver', 'atendimentos.ver', 'atendimentos.criar'])
    renderPainel(
      cardCom({
        status_id: 5,
        status: { id: 5, nome: 'Não Compareceu', cor: '#EF4444', cor_borda: null, tipo: 'user-x' },
      }),
    )

    // ASSERT — a linha de leitura explica; o formulário de registrar NÃO aparece
    expect(await screen.findByText(/marca falta — não há atendimento a registrar/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Registrar atendimento' })).not.toBeInTheDocument()
  })

  it('deve mostrar só o Histórico (sem Editar/Excluir) para quem tem apenas agenda.ver + auditoria.ver', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    comPermissoes(['agenda.ver', 'auditoria.ver'])
    renderPainel(CARD)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))

    // ASSERT — cada ação por permissão
    expect(await screen.findByRole('menuitem', { name: 'Histórico de movimentação' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Excluir' })).not.toBeInTheDocument()
  })
})

describe('PainelAgendamento — observação de recepção (painel-enriquecido)', () => {
  it('deve mostrar a observação quando o detalhe a traz (o card da grade a omite)', async () => {
    // ARRANGE — o card da grade vem sem obs; o detalhe (show, sob agenda.ver) a traz
    servidor.use(
      msw.get('/api/agendamentos/:id', () => HttpResponse.json(cardCom({ obs: 'Trazer exames recentes' }))),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT
    expect(await screen.findByText('Trazer exames recentes')).toBeInTheDocument()
    expect(screen.getByText('Observação')).toBeInTheDocument()
  })

  it('deve OMITIR o bloco de observação quando não há obs (nunca um rótulo vazio)', () => {
    // ARRANGE — beforeEach default: detalhe sem obs
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT
    expect(screen.queryByText('Observação')).not.toBeInTheDocument()
  })
})

describe('PainelAgendamento — comparecimento recente (90 dias, painel-enriquecido)', () => {
  const ITEM_COMPARECIMENTO = {
    id: 1,
    data: '2026-06-01',
    especialidade: { id: 2, nome: 'Fonoaudiologia', cor: '#448247' },
    profissional: { id: 7, nome: 'Profissional Fictício' },
    status: { id: 5, nome: 'Não Compareceu', cor: '#EF4444', cor_borda: null, tipo: 'user-x' },
  }

  function nomeDoAcordeao() {
    return screen.getByRole('button', { name: /Atendimentos dos últimos 90 dias/ })
  }

  it('deve carregar SÓ ao expandir (sob demanda — §16) e listar o comparecimento', async () => {
    // ARRANGE — a chamada só pode acontecer depois do clique
    const usuario = userEvent.setup()
    let chamadas = 0
    servidor.use(
      msw.get('/api/pacientes/:id/comparecimento-recente', () => {
        chamadas += 1
        return HttpResponse.json({ itens: [ITEM_COMPARECIMENTO] })
      }),
    )
    comPermissoes(['agenda.ver'])
    renderPainel(CARD)

    // ASSERT — fechado, nada foi buscado
    expect(chamadas).toBe(0)

    // ACT — expandir dispara a busca
    await usuario.click(nomeDoAcordeao())

    // ASSERT — carregou e listou (data · serviço · profissional · status)
    expect(chamadas).toBe(1)
    expect(await screen.findByText('01/06/2026')).toBeInTheDocument()
    expect(screen.getByText('Fonoaudiologia · Profissional Fictício')).toBeInTheDocument()
    expect(screen.getByText('Não Compareceu')).toBeInTheDocument()
  })

  it('deve anunciar o estado de carregamento ao expandir (aria-busy)', async () => {
    // ARRANGE — resposta que não resolve: o estado é o de carregamento
    const usuario = userEvent.setup()
    servidor.use(msw.get('/api/pacientes/:id/comparecimento-recente', async () => await delay('infinite')))
    comPermissoes(['agenda.ver'])
    renderPainel(CARD)

    // ACT
    const botao = nomeDoAcordeao()
    await usuario.click(botao)

    // ASSERT — a região (aria-controls) anuncia carga; nem lista nem vazio ainda
    const regiao = document.getElementById(botao.getAttribute('aria-controls') ?? '')
    expect(regiao).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('Nenhum atendimento recente')).not.toBeInTheDocument()
  })

  it('deve mostrar o estado VAZIO quando não há comparecimento nos 90 dias', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    servidor.use(msw.get('/api/pacientes/:id/comparecimento-recente', () => HttpResponse.json({ itens: [] })))
    comPermissoes(['agenda.ver'])
    renderPainel(CARD)

    // ACT
    await usuario.click(nomeDoAcordeao())

    // ASSERT — estado vazio explicativo, nunca um beco
    expect(await screen.findByText('Nenhum atendimento recente')).toBeInTheDocument()
  })

  it('deve mostrar o estado de ERRO com opção de tentar novamente', async () => {
    // ARRANGE — a 1ª busca falha (400 não re-tenta); "Tentar novamente" recupera
    const usuario = userEvent.setup()
    let tentativas = 0
    servidor.use(
      msw.get('/api/pacientes/:id/comparecimento-recente', () => {
        tentativas += 1
        if (tentativas === 1) {
          return new HttpResponse(null, { status: 400 })
        }
        return HttpResponse.json({ itens: [ITEM_COMPARECIMENTO] })
      }),
    )
    comPermissoes(['agenda.ver'])
    renderPainel(CARD)

    // ACT — expandir cai em erro
    await usuario.click(nomeDoAcordeao())
    const erro = await screen.findByRole('alert')
    expect(erro).toHaveTextContent('Não foi possível carregar os atendimentos recentes')

    // ACT — tentar novamente recupera
    await usuario.click(within(erro).getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT
    expect(await screen.findByText('01/06/2026')).toBeInTheDocument()
  })

  it('deve OMITIR o acordeão em bloqueio (sem paciente)', () => {
    // ARRANGE — bloqueio não tem criança
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(cardCom({ tipo: 'bloqueio', paciente_id: null, paciente: null }))

    // ASSERT
    expect(screen.queryByRole('button', { name: /Atendimentos dos últimos 90 dias/ })).not.toBeInTheDocument()
  })
})

describe('PainelAgendamento — pedido médico e limite do convênio (limites-e-pedidos)', () => {
  it('deve destacar pedido VENCIDO em tom de perigo, com ícone e orientação de renovação', async () => {
    // ARRANGE — o SERVIDOR decidiu o vencimento (fuso da clínica); a tela só exibe.
    // Canal não-só-cor (1.4.1): ícone + texto explícito além do tom.
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json(cardCom({ alerta_pedido: { vencido: true, vence_em_dias: null } })),
      ),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT — destaque de perigo, e a linguagem é "pedido médico", nunca guia/TISS (§14)
    const destaque = await screen.findByText('Pedido médico vencido — solicite a renovação.')
    expect(destaque).toHaveClass('bg-perigo-suave')
    expect(destaque).toHaveClass('text-perigo-texto')
    expect(destaque.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/guia|TISS/i)
  })

  it('deve avisar pedido a vencer com os dias que o servidor contou (tom de alerta)', async () => {
    // ARRANGE — os dias chegam PRONTOS (antecedência §13 aplicada no servidor)
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json(cardCom({ alerta_pedido: { vencido: false, vence_em_dias: 30 } })),
      ),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT
    const destaque = await screen.findByText('Pedido médico vence em 30 dias.')
    expect(destaque).toHaveClass('bg-alerta-suave')
    expect(destaque).toHaveClass('text-alerta-texto')
    expect(destaque.querySelector('svg')).not.toBeNull()
  })

  it('deve concordar no singular quando falta 1 dia', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json(cardCom({ alerta_pedido: { vencido: false, vence_em_dias: 1 } })),
      ),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT
    expect(await screen.findByText('Pedido médico vence em 1 dia.')).toBeInTheDocument()
  })

  it('deve destacar o limite do convênio atingido com limite, período e convênio', async () => {
    // ARRANGE — regra `avisar` excedida (D3): o payload é MINIMIZADO (SEC-LP-01) —
    // limite + período + nome do convênio, nunca a contagem nem as outras sessões
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json(
          cardCom({ alerta_limite: { convenio: 'Convênio Fictício', periodo: 'mes', limite: 4 } }),
        ),
      ),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT — `mes` (chave da API) vira "mês" na tela; tom de alerta com ícone
    const destaque = await screen.findByText(
      'Limite do convênio atingido: 4 por mês — Convênio Fictício.',
    )
    expect(destaque).toHaveClass('bg-alerta-suave')
    expect(destaque.querySelector('svg')).not.toBeNull()
  })

  it('deve não ter violações axe com os dois alertas presentes', async () => {
    // ARRANGE — os destaques de pedido e de limite são o estado NOVO do painel: cor +
    // ícone + texto. É exatamente onde um destaque só-cor ou um ícone sem `aria-hidden`
    // passaria despercebido (A11Y-LP-02). O painel é Portal do Radix — varre-se o
    // `document.body`, não o container do render.
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json(
          cardCom({
            alerta_pedido: { vencido: true, vence_em_dias: null },
            alerta_limite: { convenio: 'Convênio Fictício', periodo: 'mes', limite: 4 },
          }),
        ),
      ),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)
    await screen.findByText('Pedido médico vencido — solicite a renovação.')
    await screen.findByText('Limite do convênio atingido: 4 por mês — Convênio Fictício.')
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)

  it('deve OMITIR os destaques quando o show não traz os alertas', () => {
    // ARRANGE — beforeEach default: show sem alerta_pedido/alerta_limite
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT — nada de pedido nem de limite (a tela nunca conta nem compara sozinha)
    expect(screen.queryByText(/Pedido médico/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Limite do convênio/)).not.toBeInTheDocument()
  })
})

describe('PainelAgendamento — alerta de faltas consecutivas (painel-enriquecido)', () => {
  it('deve mostrar o banner quando o detalhe traz o alerta (o servidor decide o disparo)', async () => {
    // ARRANGE — o show traz o alerta (N da clínica já aplicado no servidor)
    servidor.use(
      msw.get('/api/agendamentos/:id', () =>
        HttpResponse.json(cardCom({ alerta_faltas: { consecutivas: 3, limite: 3 } })),
      ),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT — banner de faltas consecutivas
    expect(await screen.findByText(/3 faltas consecutivas/)).toBeInTheDocument()
  })

  it('deve OMITIR o banner quando não há alerta (a tela nunca conta a sequência)', () => {
    // ARRANGE — beforeEach default: show sem alerta_faltas
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT
    expect(screen.queryByText(/faltas consecutivas/)).not.toBeInTheDocument()
  })
})

/**
 * OS DOCUMENTOS DA CRIANÇA NO PAINEL (pedido do usuário, 2026-08-26).
 *
 * O ClinicaÁgil mostra CPF no detalhe do agendamento, e a recepção usa. Aqui eles entram
 * GATED por `pacientes.ver` — o painel abre sob `agenda.ver`, que deliberadamente não a
 * inclui, e CPF e carteirinha são documentos de um MENOR.
 */
describe('PainelAgendamento — CPF e carteirinha, para quem pode ver', () => {
  const CADASTRO = {
    ...pacienteFicticio({ id: 3, nome: 'Paciente Fictício' }),
    cpf: '11144477735',
    carteirinha: '99887766',
  }

  it('deve mostrar CPF e carteirinha a quem tem pacientes.ver', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/pacientes/:id', () => HttpResponse.json(CADASTRO)))
    comPermissoes(['agenda.ver', 'pacientes.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT — o CPF sai FORMATADO, como no cadastro
    expect(await screen.findByText('111.444.777-35')).toBeInTheDocument()
    expect(screen.getByText('99887766')).toBeInTheDocument()
  })

  it('NÃO deve mostrar documento nenhum a quem só tem agenda.ver', async () => {
    /*
     * ARRANGE — é a guarda que importa. O papel "Prof. e Agenda" da matriz AP-10 nasce SEM
     * `pacientes.ver`, por decisão do usuário: o profissional escopado vê a agenda e NÃO vê
     * os documentos da criança. Entregá-los a todo `agenda.ver` seria a exposição nova que o
     * gatilho ENUM existe para não deixar acumular em silêncio.
     */
    let cadastroPedido = false
    servidor.use(
      msw.get('/api/pacientes/:id', () => {
        cadastroPedido = true
        return HttpResponse.json(CADASTRO)
      }),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)
    await screen.findByText('Profissional Fictício')

    // ASSERT — nem na tela, nem PEDIDO ao servidor
    expect(screen.queryByText('111.444.777-35')).not.toBeInTheDocument()
    expect(screen.queryByText('99887766')).not.toBeInTheDocument()
    expect(cadastroPedido).toBe(false)
  })

  it('deve mostrar o telefone com o TIPO como rótulo', async () => {
    /*
     * ARRANGE — o tipo não é enfeite: um número rotulado "WhatsApp" e outro rotulado
     * "Telefone" mudam o que a recepção faz em seguida. Rotular tudo de "Telefone"
     * esconderia justamente a informação útil.
     */
    servidor.use(
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json({
          ...CADASTRO,
          contatos_json: [{ tipo: 'whatsapp', valor: '(48) 99999-0000', obs: null }],
        }),
      ),
    )
    comPermissoes(['agenda.ver', 'pacientes.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT
    expect(await screen.findByText('(48) 99999-0000')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
  })

  it('deve preferir o WhatsApp ao fixo quando a família tem os dois', async () => {
    /*
     * ARRANGE — a ordem é a da ação mais barata primeiro: a mensagem não interrompe ninguém, e
     * a clínica já tem canal. Sem a preferência, a recepção veria o fixo e ligaria.
     */
    servidor.use(
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json({
          ...CADASTRO,
          contatos_json: [
            { tipo: 'telefone', valor: '(48) 3333-0000', obs: null },
            { tipo: 'whatsapp', valor: '(48) 99999-0000', obs: null },
          ],
        }),
      ),
    )
    comPermissoes(['agenda.ver', 'pacientes.ver'])

    // ACT
    renderPainel(CARD)

    // ASSERT — um contato só, e é o de mensagem
    expect(await screen.findByText('(48) 99999-0000')).toBeInTheDocument()
    expect(screen.queryByText('(48) 3333-0000')).not.toBeInTheDocument()
  })

  it('NÃO deve mostrar telefone a quem só tem agenda.ver', async () => {
    // ARRANGE — mesmo portão dos documentos: é dado pessoal da família
    servidor.use(
      msw.get('/api/pacientes/:id', () =>
        HttpResponse.json({
          ...CADASTRO,
          contatos_json: [{ tipo: 'whatsapp', valor: '(48) 99999-0000', obs: null }],
        }),
      ),
    )
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(CARD)
    await screen.findByText('Profissional Fictício')

    // ASSERT
    expect(screen.queryByText('(48) 99999-0000')).not.toBeInTheDocument()
  })

  it('NÃO deve mostrar rótulo vazio quando a criança não tem os documentos', async () => {
    // ARRANGE — criança sem CPF e particular sem carteirinha é o caso comum
    servidor.use(
      msw.get('/api/pacientes/:id', () => HttpResponse.json(pacienteFicticio({ id: 3 }))),
    )
    comPermissoes(['agenda.ver', 'pacientes.ver'])

    // ACT
    renderPainel(CARD)
    await screen.findByText('Profissional Fictício')

    // ASSERT
    expect(screen.queryByText('CPF')).not.toBeInTheDocument()
    expect(screen.queryByText('Carteirinha')).not.toBeInTheDocument()
  })
})

/**
 * ALERTA DE FIM DE PACOTE (change alerta-de-fim-de-pacote, blocos 1 e 2).
 *
 * "A Camille esquece de cobrar os pacientes. Às vezes." O realce existia em âmbar e ignorava o
 * tamanho do pacote — um tratamento de UMA sessão alertava desde o primeiro dia.
 */
describe('PainelAgendamento — o fim de pacote avisa, e só quando há pacote', () => {
  it('deve avisar em ÂMBAR quando ainda há sessões — "ligue e ofereça o próximo"', async () => {
    // ARRANGE — pacote de 10 com 2 de saldo: dá para atender, e é hora de cobrar
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(cardCom({ tratamento_total: 10, tratamento_saldo: 2, tratamento_realce: 'acabando' }))

    // ASSERT — cor NÃO é canal único: texto E ícone carregam o mesmo aviso (1.4.1)
    const aviso = await screen.findByText(/Faltam 2 sessões no tratamento/)
    expect(aviso).toHaveClass('text-alerta-texto')
    expect(aviso).toHaveClass('bg-alerta-suave')
    expect(aviso.querySelector('svg')).not.toBeNull()
    // e NÃO usa o tom de quem bloqueia — é a distinção que o gate cobrou
    expect(aviso).not.toHaveClass('bg-perigo-suave')
  })

  it('deve avisar em VERMELHO quando o saldo acabou — "não pode atender"', async () => {
    /*
     * ARRANGE — saldo 0 é outro FATO: a criança não pode ser atendida até renovar. O painel
     * pintava os dois de vermelho, e a lista de tratamentos já os separava; uma tela ensinava
     * "vermelho = acabando" e a outra "vermelho = bloqueado".
     */
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(cardCom({ tratamento_total: 10, tratamento_saldo: 0, tratamento_realce: 'sem-saldo' }))

    // ASSERT
    const aviso = await screen.findByText(/Sem saldo de sessões no tratamento/)
    expect(aviso).toHaveClass('text-perigo-texto')
    expect(aviso).toHaveClass('bg-perigo-suave')
    expect(aviso.querySelector('svg')).not.toBeNull()
  })

  it('NÃO deve avisar em tratamento de UMA sessão', async () => {
    /*
     * ARRANGE — o RECORTE (sessão única, pacote parado, saldo acima do limiar da clínica) é
     * decidido no SERVIDOR e chega como `nenhum`. O painel não refaz a conta; o que ele não
     * pode é ignorar o veredito e avisar assim mesmo.
     */
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(cardCom({ tratamento_total: 1, tratamento_saldo: 1, tratamento_realce: 'nenhum' }))
    await screen.findByText('Profissional Fictício')

    // ASSERT
    expect(screen.queryByText(/sessões no tratamento/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Sem saldo de sessões/)).not.toBeInTheDocument()
  })

  it('NÃO deve pintar de vermelho os OUTROS avisos do painel', async () => {
    /*
     * ARRANGE — se tudo virasse vermelho, nada seria urgente. O que sobe de tom é o que custa
     * DINHEIRO à clínica quando passa batido; falta consecutiva é outra conversa.
     */
    comPermissoes(['agenda.ver'])

    // ACT — saldo 0, o ÚNICO caso que legitimamente usa o vermelho no painel
    renderPainel(cardCom({ tratamento_total: 10, tratamento_saldo: 0, tratamento_realce: 'sem-saldo' }))
    const aviso = await screen.findByText(/Sem saldo de sessões no tratamento/)

    // ASSERT — o de sessões é o único em perigo no painel
    const emPerigo = [...document.querySelectorAll('.bg-perigo-suave')]
    expect(emPerigo).toHaveLength(1)
    expect(emPerigo[0]).toBe(aviso)
  })
})

// ── "Lançar no financeiro" (change faturar-pelo-painel-da-agenda) ──────────────────────────
describe('Lançar no financeiro — o gancho virou ação', () => {
  const catalogos = () =>
    servidor.use(
      msw.get('/api/contas', () => HttpResponse.json([{ id: 3, nome: 'Caixa' }])),
      msw.get('/api/categorias', () =>
        HttpResponse.json([{ id: 1, nome: 'Atendimentos', tipo: 'receita', subcategorias: [] }]),
      ),
      msw.get('/api/tipos-pagamento', () => HttpResponse.json([{ id: 2, nome: 'Pix' }])),
    )

  it('deve oferecer "Lançar no financeiro" a quem tem lancamentos.criar, e só isso', async () => {
    // ARRANGE — a permissão do DINHEIRO basta para o menu existir (quem só fatura vê o menu)
    comPermissoes(['agenda.ver', 'lancamentos.criar'])
    const usuario = userEvent.setup()
    renderPainel(CARD)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))

    // ASSERT
    expect(await screen.findByRole('menuitem', { name: 'Lançar no financeiro' })).toBeInTheDocument()
    // sem as permissões da mensageria, o WhatsApp não aparece
    expect(screen.queryByRole('menuitem', { name: /Avisar no WhatsApp/ })).not.toBeInTheDocument()
  })

  it('deve abrir o diálogo "Faturar sessão" ao escolher a ação', async () => {
    // ARRANGE
    comPermissoes(['agenda.ver', 'lancamentos.criar'])
    catalogos()
    const usuario = userEvent.setup()
    renderPainel(CARD)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Lançar no financeiro' }))

    // ASSERT
    expect(await screen.findByRole('dialog', { name: 'Faturar sessão' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Valor/)).not.toBeInTheDocument()
  })

  it('não deve deixar faturar sem tratamento: a ação fica, indisponível, em vez de sumir', async () => {
    // ARRANGE — sem pacote não há serviço para precificar; até a change o-sistema-avisa-o-que-falta
    // (D5) o item SUMIA, e quem fatura não sabia por quê. O detalhe está no bloco próprio, abaixo.
    comPermissoes(['agenda.ver', 'agenda.editar', 'lancamentos.criar'])
    const usuario = userEvent.setup()
    renderPainel(cardCom({ tratamento_id: null, tratamento_saldo: null, tratamento_total: null }))

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))

    // ASSERT
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Lançar no financeiro' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('não deve oferecer faturamento em bloqueio de agenda', async () => {
    // ARRANGE — bloqueio não tem criança nem pacote: nada a faturar
    comPermissoes(['agenda.ver', 'agenda.editar', 'lancamentos.criar'])
    const usuario = userEvent.setup()
    renderPainel(
      cardCom({
        tipo: 'bloqueio',
        paciente_id: null,
        tratamento_id: null,
        paciente: null,
        tratamento_saldo: null,
        tratamento_total: null,
        obs: 'Supervisão',
      }),
    )

    // ACT — o menu existe (há `agenda.editar`); o que não pode existir é o item
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))

    // ASSERT
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Lançar no financeiro' })).not.toBeInTheDocument()
  })
})

/**
 * O pedido de desmarque da família pelo lembrete (change lembrete-com-botoes-de-resposta, 4.3).
 * Dados FICTÍCIOS: o status "Desmarcado pelo Paciente" é o do desmarque pela família da clínica.
 */
describe('PainelAgendamento — a família pediu para desmarcar', () => {
  const PEDIU_DESMARQUE = cardCom({
    confirmacao: { estado: 'pediu_desmarque', em: '2026-07-15T18:40:00-03:00' },
  })

  const STATUS_DA_FAMILIA: StatusDaSelecao = {
    id: 9,
    nome: 'Desmarcado pelo Paciente',
    cor: '#94A3B8',
    cor_borda: null,
    tipo: 'file-check',
    ordem: 9,
    desconta_sessao: false,
    marca_falta: false,
    aplicavel_em_lote: false,
    sessao_marcada: false,
    desmarque_da_familia: true,
  }

  /** A seleção da clínica, com ou sem o status do desmarque pela família configurado. */
  function comSelecao(comStatusDaFamilia: boolean, statusDaFamilia: StatusDaSelecao = STATUS_DA_FAMILIA): void {
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: comStatusDaFamilia ? [...SELECAO_FICTICIA.status, statusDaFamilia] : SELECAO_FICTICIA.status,
        }),
      ),
    )
  }

  /**
   * O que o `PUT /agendamentos/{id}` devolve DE VERDADE: só os escalares
   * (`SerializadorDeAgendamento::escalares`) — sem o objeto `status`, sem o paciente, sem a resposta
   * ao lembrete. O dublê devolvia um cartão completo, e foi isso que escondeu que o painel ficaria
   * sem status e sem criança ao trocar a foto pela resposta.
   */
  function respostaDaEscrita(statusId: number): Record<string, unknown> {
    return {
      id: CARD.id,
      tipo: 'atendimento',
      paciente_id: CARD.paciente_id,
      profissional_id: CARD.profissional_id,
      especialidade_id: 2,
      tratamento_id: CARD.tratamento_id,
      sala_id: 5,
      equipamento_id: null,
      medico_id: null,
      status_id: statusId,
      inicio: CARD.inicio,
      fim: CARD.fim,
      origem: 'agenda',
      is_reposicao: false,
      reposicao_de_id: null,
      recorrencia_grupo_id: null,
      obs: null,
      updated_at: '2026-07-15T18:45:00.000000Z',
      duracao_minutos: 40,
    }
  }

  /** Captura o corpo do PUT — a troca de status é a mesma escrita do chip. */
  function capturarEscrita(): { corpos: Array<Record<string, unknown>> } {
    const corpos: Array<Record<string, unknown>> = []
    servidor.use(
      msw.put('/api/agendamentos/:id', async ({ request }) => {
        const corpo = (await request.json()) as Record<string, unknown>
        corpos.push(corpo)
        return HttpResponse.json(respostaDaEscrita(Number(corpo.status_id)))
      }),
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    )
    return { corpos }
  }

  it('deve aplicar, em um clique, o status do desmarque pela família — sem avisar cancelamento', async () => {
    // ARRANGE — "Em Aberto" → "Desmarcado pelo Paciente": nenhum dos dois desconta, então sem diálogo
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(true)
    const { corpos } = capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    const botao = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })

    // ACT
    await usuario.click(botao)

    // ASSERT — a leitura FRESCA manda `inicio`/`profissional_id`; o status é o da clínica; e a família
    // que pediu o desmarque NÃO recebe "a clínica cancelou"
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).toEqual({ inicio: CARD.inicio, profissional_id: CARD.profissional_id, status_id: 9 })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    // o foco vai à linha que diz como o pedido foi resolvido (os botões saíram da tela), e o chip
    // passa a dizer o status que o servidor devolveu — o painel não fica mostrando a foto velha
    expect(await screen.findByText('Pedido da família resolvido: sessão desmarcada.')).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Desmarcar (a família pediu)' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Desmarcado pelo Paciente — mudar status de Paciente Fictício' }),
    ).toBeInTheDocument()
  })

  it('não deve perguntar pelo aviso de cancelamento quando o status da família é também o da clínica', async () => {
    // ARRANGE — a clínica apontou os DOIS ponteiros para o mesmo status: pelo chip, escolhê-lo
    // perguntaria "Avisar a família" já marcado; aqui foi a família que pediu, e o aviso seria falso
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(true, { ...STATUS_DA_FAMILIA, desmarque_da_clinica: true })
    const { corpos } = capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    const botao = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })

    // ACT
    await usuario.click(botao)

    // ASSERT — grava direto, sem a pergunta e sem `avisar_familia`
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    expect(corpos[0]).not.toHaveProperty('avisar_familia')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('deve levar o foco à linha de resolução também quando a troca passou pela confirmação do saldo', async () => {
    // ARRANGE — a sessão está "Finalizado" (desconta): sair dele devolve a sessão ao pacote, então
    // a troca pergunta antes; o diálogo fecha e o botão que o abriu já não existe
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(true)
    const { corpos } = capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(cardCom({ ...PEDIU_DESMARQUE, status_id: 3 }))
    const botao = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })

    // ACT
    await usuario.click(botao)
    const confirmacao = await screen.findByRole('alertdialog')
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Mudar status' }))

    // ASSERT — gravou, e o foco pousou na linha que diz o que aconteceu (nunca no `body`)
    await waitFor(() => {
      expect(corpos).toHaveLength(1)
    })
    const linha = await screen.findByText('Pedido da família resolvido: sessão desmarcada.')
    await waitFor(() => {
      expect(linha).toHaveFocus()
    })
  })

  it('deve abrir o menu de status quando a clínica não configurou o status do desmarque pela família', async () => {
    // ARRANGE — nenhum status da seleção vem com `desmarque_da_familia`
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(false)
    const { corpos } = capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    const botao = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })

    // ACT
    await usuario.click(botao)

    // ASSERT — a recepção escolhe na lista; nada foi gravado sozinho; e o botão avisava que abre menu
    expect(await screen.findByRole('menuitem', { name: /Falta Justificada/ })).toBeInTheDocument()
    expect(corpos).toHaveLength(0)
    expect(botao).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('deve devolver o foco ao "Desmarcar" quando o menu que ele abriu é fechado com Esc', async () => {
    // ARRANGE — sem status do desmarque pela família, o botão abre o menu do chip
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(false)
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    const botao = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })
    await usuario.click(botao)
    await screen.findByRole('menuitem', { name: /Falta Justificada/ })

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT — o foco volta a quem abriu o menu, não ao chip (que a pessoa nem tocou)
    await waitFor(() => {
      expect(botao).toHaveFocus()
    })
  })

  it('deve manter o pedido na tela quando o chip troca para outro status de sessão marcada', async () => {
    // ARRANGE — "Aguardando Atendimento" ainda é sessão marcada: o pedido da família continua valendo
    comPermissoes(['agenda.ver', 'agenda.editar'])
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: [
            { ...SELECAO_FICTICIA.status[0], sessao_marcada: true },
            {
              id: 2,
              nome: 'Aguardando Atendimento',
              cor: '#0EA5E9',
              cor_borda: null,
              tipo: 'clock',
              ordem: 2,
              desconta_sessao: false,
              marca_falta: false,
              aplicavel_em_lote: false,
              sessao_marcada: true,
            },
          ],
        }),
      ),
    )
    capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /mudar status de Paciente Fictício/ }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Aguardando Atendimento/ }))

    // ASSERT — o chip diz o status novo (vindo da seleção: a resposta não traz o objeto `status`), e
    // o pedido segue na tela com as duas saídas — a escrita devolve os escalares, nunca a resposta
    // ao lembrete, e apagá-la aqui esconderia um pedido que o servidor ainda tem
    expect(
      await screen.findByRole('button', { name: 'Aguardando Atendimento — mudar status de Paciente Fictício' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/A família pediu, pelo lembrete do WhatsApp/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manter a sessão (a família desistiu)' })).toBeInTheDocument()
  })

  it('deve levar o foco à linha de resolução quando o chip troca para um status que não é de sessão marcada', async () => {
    // ARRANGE — "Falta Justificada" libera o horário: o pedido deixa de existir, e o bloco com os
    // botões sai da tela
    comPermissoes(['agenda.ver', 'agenda.editar'])
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: SELECAO_FICTICIA.status.map((status) => ({ ...status, sessao_marcada: status.id === 1 })),
        }),
      ),
    )
    capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /mudar status de Paciente Fictício/ }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Falta Justificada/ }))

    // ASSERT — o foco não cai no contêiner do painel: vai à linha que diz o que aconteceu
    const linha = await screen.findByText('Pedido da família resolvido: sessão desmarcada.')
    await waitFor(() => {
      expect(linha).toHaveFocus()
    })
    expect(
      screen.getByRole('button', { name: 'Falta Justificada — mudar status de Paciente Fictício' }),
    ).toBeInTheDocument()
  })

  it('deve deixar "Manter a sessão" inerte sem tirar o foco dele, e devolver a recusa ao mesmo lugar', async () => {
    // ARRANGE — a gravação demora e o servidor recusa (o pedido já foi resolvido por outra pessoa)
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(true)
    servidor.use(
      msw.post('/api/agendamentos/:id/manter-sessao', async () => {
        await delay(80)
        return HttpResponse.json({ errors: { agendamento: ['Este pedido já foi resolvido.'] } }, { status: 422 })
      }),
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    )
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    const manter = await screen.findByRole('button', { name: 'Manter a sessão (a família desistiu)' })

    // ACT
    await usuario.click(manter)

    // ASSERT — durante o envio: inerte pelo ATRIBUTO, nunca `disabled` (o jsdom não tira o foco de
    // botão desabilitado, então só o atributo prova o que o navegador faria)
    await waitFor(() => {
      expect(manter).toHaveAttribute('aria-disabled', 'true')
    })
    expect(manter).toBeEnabled()
    // ...e na recusa, o motivo aparece e a pessoa continua no botão
    expect(await screen.findByText('Este pedido já foi resolvido.')).toBeInTheDocument()
    expect(manter).toHaveFocus()
    expect(manter).not.toHaveAttribute('aria-disabled')
  })

  it('deve deixar "Desmarcar" inerte sem tirar o foco dele, e devolver a recusa ao mesmo lugar', async () => {
    // ARRANGE — a troca de status demora e o servidor recusa
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(true)
    servidor.use(
      msw.put('/api/agendamentos/:id', async () => {
        await delay(80)
        return HttpResponse.json(
          { errors: { status_id: ['Este agendamento não pode mudar de status agora.'] } },
          { status: 422 },
        )
      }),
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    )
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    const desmarcar = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(desmarcar).toBeEnabled()
    })

    // ACT
    await usuario.click(desmarcar)

    // ASSERT
    await waitFor(() => {
      expect(desmarcar).toHaveAttribute('aria-disabled', 'true')
    })
    expect(desmarcar).toBeEnabled()
    expect(await screen.findByText('Este agendamento não pode mudar de status agora.')).toBeInTheDocument()
    expect(desmarcar).toHaveFocus()
  })

  it('deve devolver o foco ao chip quando a pessoa desiste, com Esc, da confirmação aberta pelo menu', async () => {
    // ARRANGE — "Finalizado" desconta: escolher pelo chip pergunta antes
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(true)
    const usuario = userEvent.setup()
    renderPainel(CARD)
    const chip = await screen.findByRole('button', { name: 'Em Aberto — mudar status de Paciente Fictício' })
    await usuario.click(chip)
    await usuario.click(await screen.findByRole('menuitem', { name: /Finalizado/ }))
    await screen.findByRole('alertdialog')

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT — o item do menu que abriu o diálogo já saiu do DOM: o foco vai ao chip, nunca ao `body`
    await waitFor(() => {
      expect(chip).toHaveFocus()
    })
  })

  it('deve devolver o foco ao "Desmarcar" quando a pessoa desiste da confirmação aberta pelo menu dele', async () => {
    // ARRANGE — sem status do desmarque pela família: o botão abre o menu, e "Finalizado" pergunta
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(false)
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    const desmarcar = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(desmarcar).toBeEnabled()
    })
    await usuario.click(desmarcar)
    await usuario.click(await screen.findByRole('menuitem', { name: /Finalizado/ }))
    await screen.findByRole('alertdialog')

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT — volta a quem começou o caminho
    await waitFor(() => {
      expect(desmarcar).toHaveFocus()
    })
  })

  /**
   * A seleção com a flag de sessão marcada: só "Em Aberto" é marcada. "Não Compareceu" DESCONTA
   * (a troca pergunta antes, no diálogo) e não é marcada (a troca resolve o pedido da família).
   */
  function comSelecaoQueResolve(comStatusDaFamilia: boolean): void {
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: [
            ...SELECAO_FICTICIA.status.map((status) => ({ ...status, sessao_marcada: status.id === 1 })),
            ...(comStatusDaFamilia ? [STATUS_DA_FAMILIA] : []),
          ],
        }),
      ),
    )
  }

  /**
   * O Radix devolve o foco do diálogo que fecha num `setTimeout(0)`, DEPOIS dos efeitos: afirmar o
   * foco no primeiro instante em que ele passa pela linha provaria só a passagem (A11Y-BT-19).
   */
  async function esperarOFocoAssentar(): Promise<void> {
    await act(async () => {
      await new Promise((resolver) => {
        setTimeout(resolver, 80)
      })
    })
  }

  it('deve TERMINAR o foco na linha de resolução quando o chip resolve o pedido pelo diálogo do saldo', async () => {
    // ARRANGE — chip "Em Aberto" → "Não Compareceu" (desconta: pergunta antes) → confirma
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecaoQueResolve(false)
    capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    await usuario.click(await screen.findByRole('button', { name: 'Em Aberto — mudar status de Paciente Fictício' }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Não Compareceu/ }))
    const confirmacao = await screen.findByRole('alertdialog')

    // ACT
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Mudar status' }))

    // ASSERT — a linha diz o que aconteceu e é ONDE O FOCO FICA, mesmo depois do fechamento do diálogo
    const linha = await screen.findByText('Pedido da família resolvido: sessão desmarcada.')
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await esperarOFocoAssentar()
    expect(linha).toHaveFocus()
  })

  it('deve TERMINAR o foco na linha de resolução pelo "Desmarcar" → menu → diálogo → confirmar', async () => {
    // ARRANGE — sem status do desmarque pela família: o botão abre o menu, e "Não Compareceu" pergunta
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecaoQueResolve(false)
    capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    const desmarcar = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(desmarcar).toBeEnabled()
    })
    await usuario.click(desmarcar)
    await usuario.click(await screen.findByRole('menuitem', { name: /Não Compareceu/ }))
    const confirmacao = await screen.findByRole('alertdialog')

    // ACT
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Mudar status' }))

    // ASSERT — o "Desmarcar" saiu da tela com o pedido; o foco não vai ao chip, fica na linha
    const linha = await screen.findByText('Pedido da família resolvido: sessão desmarcada.')
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await esperarOFocoAssentar()
    expect(linha).toHaveFocus()
  })

  it('deve devolver o foco ao chip quando o diálogo da troca é cancelado, mesmo com o pedido já resolvido antes', async () => {
    // ARRANGE — o pedido foi resolvido por um caminho SEM diálogo ("Falta Justificada" não desconta);
    // depois a recepção abre o chip, escolhe "Não Compareceu" e desiste
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecaoQueResolve(false)
    capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)
    await usuario.click(await screen.findByRole('button', { name: 'Em Aberto — mudar status de Paciente Fictício' }))
    await usuario.click(await screen.findByRole('menuitem', { name: /Falta Justificada/ }))
    await screen.findByText('Pedido da família resolvido: sessão desmarcada.')
    const chip = await screen.findByRole('button', { name: 'Falta Justificada — mudar status de Paciente Fictício' })
    await usuario.click(chip)
    await usuario.click(await screen.findByRole('menuitem', { name: /Não Compareceu/ }))
    await screen.findByRole('alertdialog')

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT — a prioridade da linha vale só para a troca QUE resolveu; o cancelamento volta ao chip
    await esperarOFocoAssentar()
    expect(chip).toHaveFocus()
  })

  it('não deve oferecer a ação a quem não pode mudar o status, mas deve dizer o pedido', async () => {
    // ARRANGE — só vê a agenda
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(PEDIU_DESMARQUE)

    // ASSERT — o pedido está em palavras; a ação que o resolve, não
    expect(await screen.findByText(/A família pediu, pelo lembrete do WhatsApp, para desmarcar/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desmarcar (a família pediu)' })).not.toBeInTheDocument()
  })

  it('não deve mostrar o pedido em cartão cuja família não pediu para desmarcar', () => {
    // ARRANGE — a família confirmou
    comPermissoes(['agenda.ver', 'agenda.editar'])

    // ACT
    renderPainel(cardCom({ confirmacao: { estado: 'confirmado', em: '2026-07-15T18:40:00-03:00' } }))

    // ASSERT
    expect(screen.queryByText(/pediu, pelo lembrete do WhatsApp/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desmarcar (a família pediu)' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manter a sessão (a família desistiu)' })).not.toBeInTheDocument()
  })

  it.each([
    ['aguardando', null, /^Lembrete enviado, sem resposta da família$/],
    ['confirmado', new Date(2026, 6, 15, 8, 12).toISOString(), /^Confirmado pela família às 08:12$/],
    ['nao_entregue', null, /^Lembrete não entregue — ligue para a família$/],
  ] as const)('deve dizer em palavras, no painel, o estado %s da resposta ao lembrete', (estado, em, frase) => {
    // ARRANGE — no cartão a frase só existe no `title` e no nome do ícone: teclado e toque não a veem
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(cardCom({ confirmacao: { estado, em } }))

    // ASSERT
    expect(within(screen.getByRole('dialog')).getByText(frase)).toBeVisible()
  })

  it('deve dizer no painel, como aviso para ligar, por que o lembrete não saiu', () => {
    // ARRANGE — change telefone-que-chega-no-whatsapp
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(cardCom({ confirmacao: { estado: 'nao_enviado', em: null, motivo: 'telefone inválido no cadastro' } }))

    // ASSERT — o mesmo bloco âmbar do não entregue
    const linha = within(screen.getByRole('dialog')).getByText('Lembrete não enviado: telefone inválido no cadastro')
    expect(linha).toBeVisible()
    expect(linha).toHaveClass('bg-alerta-suave')
  })

  it('deve manter a sessão quando a família desistiu, sem mudar o status', async () => {
    // ARRANGE — a família tocou errado e confirmou por telefone
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(true)
    const pedidos: Array<{ corpo: string; seVersao: string | null }> = []
    servidor.use(
      msw.post('/api/agendamentos/:id/manter-sessao', async ({ request }) => {
        pedidos.push({ corpo: await request.text(), seVersao: request.headers.get('If-Match') })
        return HttpResponse.json({ confirmacao: { estado: 'confirmado', em: '2026-07-15T19:02:00-03:00' } })
      }),
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    )
    const { corpos } = capturarEscrita()
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Manter a sessão (a família desistiu)' }))

    // ASSERT — uma chamada, sem corpo e sem versão; nenhuma troca de status; o foco vai à linha que
    // diz como foi resolvido, e o anúncio é educado (toast em segundo plano)
    expect(await screen.findByText('Pedido da família resolvido: a sessão continua marcada, como confirmada.')).toHaveFocus()
    expect(pedidos).toEqual([{ corpo: '', seVersao: null }])
    expect(corpos).toHaveLength(0)
    expect(await screen.findByText('Sessão mantida: a família desistiu de desmarcar.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desmarcar (a família pediu)' })).not.toBeInTheDocument()
  })

  it('deve dizer a recusa do servidor quando o pedido já não vale', async () => {
    // ARRANGE — outra pessoa resolveu antes (o servidor recusa com 422)
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comSelecao(true)
    servidor.use(
      msw.post('/api/agendamentos/:id/manter-sessao', () =>
        HttpResponse.json(
          { errors: { agendamento: ['Este pedido de desmarque já foi resolvido.'] } },
          { status: 422 },
        ),
      ),
      msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })),
    )
    const usuario = userEvent.setup()
    renderPainel(PEDIU_DESMARQUE)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Manter a sessão (a família desistiu)' }))

    // ASSERT — a frase do servidor aparece e o pedido continua na tela para a recepção decidir
    expect(await screen.findByText('Este pedido de desmarque já foi resolvido.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manter a sessão (a família desistiu)' })).toBeInTheDocument()
  })
})

/**
 * evolucao-finaliza-a-sessao, gate CR-EVO-03: a evolução finaliza a sessão atrás do diálogo, e o painel
 * mostrava a FOTO do cartão tirada ao abrir — chip "Em Aberto" e o saldo de antes, com o toast dizendo
 * "finalizada". O painel passa a mostrar o cartão relido.
 */
describe('PainelAgendamento — depois de a evolução finalizar a sessão', () => {
  /** A grade que fica ATIVA atrás do painel na tela real: é ela que a invalidação relê. */
  function GradeAtras() {
    useQuery({ queryKey: chaves.agenda({ de: '2026-07-16', ate: '2026-07-16' }), queryFn: () => buscarAgenda({ de: '2026-07-16', ate: '2026-07-16' }) })
    return null
  }

  it('deve mostrar o status e o saldo novos no próprio painel', async () => {
    // ARRANGE — o detalhe no formato da PRODUÇÃO (sem relações): tratá-lo como cartão derrubava a
    // tela (gate CR-EVO-R2-01). O cartão novo vem da grade, relida pela invalidação
    let registrado = false
    const finalizado = SELECAO_FICTICIA.status.find((item) => item.id === 3)
    const depois = cardCom({
      status_id: 3,
      status: { id: 3, nome: finalizado?.nome ?? 'Finalizado', cor: '#10B981', cor_borda: null, tipo: 'check' },
      tratamento_saldo: 7,
      updated_at: '2026-07-16T15:00:00.000000Z',
    })
    servidor.use(
      msw.get('/api/agendamentos/:id', () => HttpResponse.json(detalheFicticio(registrado ? depois : CARD))),
      msw.get('/api/agenda', () => HttpResponse.json([registrado ? depois : CARD])),
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: SELECAO_FICTICIA.status.map((item) => ({ ...item, em_aberto: item.id === 1, sessao_marcada: true })),
        }),
      ),
      msw.get('/api/atendimentos', () =>
        HttpResponse.json(
          paginaAtendimentos(
            registrado
              ? [{ id: 3, agendamento_id: 42, iniciado_em: null, finalizado_em: '2026-07-16 14:40', evolucao_id: 9, updated_at: '2026-07-16T15:00:00.000000Z' }]
              : [],
          ),
        ),
      ),
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({ configuracoes: [{ chave: 'evolucoes.status_ao_salvar', tipo: 'int', valor: 3 }] }),
      ),
      msw.get('/api/profissionais', () =>
        HttpResponse.json([{ id: 7, nome: 'Profissional Fictício', horarios: {}, obs: null, ativo: true, especialidades: [] }]),
      ),
      msw.post('/api/agendamentos/:id/evolucao', () => {
        registrado = true
        return HttpResponse.json(
          { id: 9, atendimento_id: 3, profissional_id: 7, responsavel_tecnico_id: null, conteudo: 'Evolução fictícia.', preenchida_em: '2026-07-16 15:00', updated_at: '2026-07-16T15:00:00.000000Z', sessao: { finalizada: true, motivo: null } },
          { status: 201 },
        )
      }),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, profissional_id: 7, permissoes: ['agenda.ver', 'atendimentos.ver', 'atendimentos.criar', 'evolucoes.criar', 'evolucoes.ver'] },
      carregandoSessao: false,
    })
    const usuario = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ProvedorToast>
            <GradeAtras />
            <PainelAgendamento aberto card={CARD} aoFechar={() => {}} aoEditar={() => {}} />
          </ProvedorToast>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await usuario.click(await screen.findByRole('button', { name: 'Escrever evolução' }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.type(within(dialogo).getByRole('textbox', { name: /Evolução da sessão/ }), 'Evolução fictícia.')

    // ACT
    await usuario.click(within(dialogo).getByRole('button', { name: 'Registrar evolução' }))

    // ASSERT — o saldo de 22/30 vira 23/30, e o chip deixa de dizer "Em Aberto"
    const painel = screen.getByRole('dialog')
    expect(await within(painel).findByText('23/30 sessões')).toBeInTheDocument()
    expect(within(painel).queryByText('Em Aberto')).not.toBeInTheDocument()
  })
})

describe('PainelAgendamento — o aviso do pacote sem saldo', () => {
  it.each([0, -1])('deve avisar, antes do clique, que o pacote sem saldo não deixa finalizar (saldo %i)', async (saldo) => {
    // ARRANGE — gates CR-EVO-R3-06/R4: a ligação do saldo do cartão (`<= 0`, a régua do servidor) à seção
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: SELECAO_FICTICIA.status.map((item) => ({ ...item, em_aberto: item.id === 1, sessao_marcada: true })),
        }),
      ),
      msw.get('/api/atendimentos', () => HttpResponse.json(paginaAtendimentos([]))),
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({ configuracoes: [{ chave: 'evolucoes.status_ao_salvar', tipo: 'int', valor: 3 }] }),
      ),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, profissional_id: 7, permissoes: ['agenda.ver', 'atendimentos.ver', 'atendimentos.criar', 'evolucoes.criar', 'evolucoes.ver'] },
      carregandoSessao: false,
    })

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ProvedorToast>
            <PainelAgendamento aberto card={cardCom({ tratamento_saldo: saldo })} aoFechar={() => {}} aoEditar={() => {}} />
          </ProvedorToast>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Escrever evolução' })).toHaveAccessibleDescription(/pacote está sem saldo/)
  })
})

// ── O sistema avisa o que falta (change o-sistema-avisa-o-que-falta, D4/D5/D6) ──────────────────────
/** As requisições do render até o painel assentar — a prova de "nenhuma requisição nova" (D6). */
async function requisicoesAteAssentar(renderizar: () => { unmount: () => void }, depois?: () => Promise<void>): Promise<string[]> {
  queryClient.clear()
  const pedidas: string[] = []
  const anotar = ({ request }: { request: Request }): void => {
    pedidas.push(`${request.method} ${new URL(request.url).pathname}`)
  }
  servidor.events.on('request:start', anotar)
  const { unmount } = renderizar()
  await depois?.()
  await waitFor(() => {
    expect(queryClient.isFetching()).toBe(0)
  })
  servidor.events.removeListener('request:start', anotar)
  unmount()

  return pedidas.sort()
}

function renderPainelComFechar(card: CardAgendamento, aoFechar: () => void) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProvedorToast>
          <PainelAgendamento aberto card={card} aoFechar={aoFechar} aoEditar={() => {}} />
        </ProvedorToast>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Lançar no financeiro sem pacote — a ação fica e diz o que falta (D5)', () => {
  const SEM_PACOTE = cardCom({ tratamento_id: null, tratamento_saldo: null, tratamento_total: null })

  beforeEach(() => {
    servidor.use(msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)))
  })

  it('deve manter a ação visível e indisponível, com o motivo e o caminho ligados a ela', async () => {
    // ARRANGE — quem fatura E agenda: o caminho é o Editar, no campo Tratamento
    comPermissoes(['agenda.ver', 'agenda.editar', 'lancamentos.criar'])
    const usuario = userEvent.setup()
    renderPainel(SEM_PACOTE)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))

    // ASSERT — o nome é só o rótulo; o motivo é a descrição (aria-describedby)
    const item = await screen.findByRole('menuitem', { name: 'Lançar no financeiro' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAccessibleDescription(
      'Sem pacote vinculado: o valor do lançamento vem do serviço do pacote. Vincule o pacote em Editar, no campo Tratamento.',
    )
  })

  it('deve dizer a quem pedir quando quem fatura não pode editar a agenda', async () => {
    // ARRANGE — mandar a um "Editar" que a pessoa não tem não é caminho
    comPermissoes(['agenda.ver', 'lancamentos.criar'])
    const usuario = userEvent.setup()
    renderPainel(SEM_PACOTE)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))

    // ASSERT
    const item = await screen.findByRole('menuitem', { name: 'Lançar no financeiro' })
    expect(item).toHaveAccessibleDescription(/Peça a quem cuida da agenda para vincular o pacote\.$/)
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).not.toBeInTheDocument()
  })

  it('deve alcançar a ação indisponível pelo teclado — é o foco que leva ao motivo', async () => {
    // ARRANGE — `disabled` tiraria o item das setas, e o motivo junto
    comPermissoes(['agenda.ver', 'lancamentos.criar'])
    const usuario = userEvent.setup()
    renderPainel(SEM_PACOTE)
    screen.getByRole('button', { name: 'Mais ações' }).focus()

    // ACT
    await usuario.keyboard('{Enter}')

    // ASSERT
    const item = await screen.findByRole('menuitem', { name: 'Lançar no financeiro' })
    await waitFor(() => {
      expect(item).toHaveFocus()
    })
  })

  it('não deve abrir o faturamento ao escolher a ação indisponível', async () => {
    // ARRANGE
    comPermissoes(['agenda.ver', 'lancamentos.criar'])
    const usuario = userEvent.setup()
    renderPainel(SEM_PACOTE)
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))
    const item = await screen.findByRole('menuitem', { name: 'Lançar no financeiro' })

    // ACT
    await usuario.click(item)

    // ASSERT — nada abre, e o menu continua ali com o motivo à vista
    expect(screen.queryByRole('dialog', { name: 'Faturar sessão' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Lançar no financeiro' })).toBeInTheDocument()
  })

  it('deve manter a ação disponível e sem motivo quando há pacote (nada muda)', async () => {
    // ARRANGE
    comPermissoes(['agenda.ver', 'agenda.editar', 'lancamentos.criar'])
    const usuario = userEvent.setup()
    renderPainel(CARD)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))

    // ASSERT
    const item = await screen.findByRole('menuitem', { name: 'Lançar no financeiro' })
    expect(item).not.toHaveAttribute('aria-disabled')
    expect(item).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText(/Sem pacote vinculado/)).not.toBeInTheDocument()
  })

  it('não deve mostrar a ação sem pacote a quem não tem a permissão de faturar', async () => {
    // ARRANGE — a permissão continua mandando: sem `lancamentos.criar`, o item não existe
    comPermissoes(['agenda.ver', 'agenda.editar'])
    const usuario = userEvent.setup()
    renderPainel(SEM_PACOTE)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))

    // ASSERT
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Lançar no financeiro' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Sem pacote vinculado/)).not.toBeInTheDocument()
  })

  it('deve oferecer o menu só pela ação indisponível, quando é a única que a pessoa tem', async () => {
    // ARRANGE — quem só fatura: antes, sem pacote, nem o "Mais ações" existia
    comPermissoes(['agenda.ver', 'lancamentos.criar'])

    // ACT
    renderPainel(SEM_PACOTE)

    // ASSERT
    expect(screen.getByRole('button', { name: 'Mais ações' })).toBeInTheDocument()
  })

  it('deve abrir o painel e o menu com as mesmas requisições, com e sem pacote (nenhuma requisição nova)', async () => {
    // ARRANGE
    comPermissoes(['agenda.ver', 'agenda.editar', 'lancamentos.criar'])
    const abrirMenu = async (): Promise<void> => {
      await userEvent.click(screen.getByRole('button', { name: 'Mais ações' }))
      await screen.findByRole('menuitem', { name: 'Lançar no financeiro' })
    }

    // ACT
    const semPacote = await requisicoesAteAssentar(() => renderPainel(SEM_PACOTE), abrirMenu)
    const comPacote = await requisicoesAteAssentar(() => renderPainel(CARD), abrirMenu)

    // ASSERT
    expect(semPacote).toEqual(comPacote)
  })

  it('deve passar no axe com a ação indisponível no menu aberto', async () => {
    // ARRANGE
    comPermissoes(['agenda.ver', 'agenda.editar', 'lancamentos.criar'])
    const usuario = userEvent.setup()
    renderPainel(SEM_PACOTE)
    await usuario.click(screen.getByRole('button', { name: 'Mais ações' }))
    await screen.findByRole('menuitem', { name: 'Lançar no financeiro' })

    // ACT — `region` desligada SÓ aqui: o menu do Radix vai num portal no `body`, fora de qualquer
    // marco, em todo menu do sistema; é regra de boa prática do axe, não critério WCAG, e não é o
    // que este teste mede (nome, estado e descrição do item indisponível)
    const resultado = await axe(document.body, { rules: { region: { enabled: false } } })

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})

describe('"Desmarcar (a família pediu)" sem o status configurado — diz por que abre o menu (D4)', () => {
  const PEDIU_DESMARQUE = cardCom({ confirmacao: { estado: 'pediu_desmarque', em: '2026-07-15T18:40:00-03:00' } })
  const QUEM_RESOLVE = ['agenda.ver', 'agenda.editar']
  const QUEM_CONFIGURA = [...QUEM_RESOLVE, 'configuracoes.ver', 'configuracoes.editar']

  /** A seleção com a flag que o servidor manda em TODO status; `comODaFamilia` acrescenta o configurado. */
  function comSelecao(comODaFamilia: boolean): void {
    const status: StatusDaSelecao[] = SELECAO_FICTICIA.status.map((item) => ({ ...item, desmarque_da_familia: false }))
    const daFamilia: StatusDaSelecao = {
      id: 9,
      nome: 'Desmarcado pelo Paciente',
      cor: '#94A3B8',
      cor_borda: null,
      tipo: 'file-check',
      ordem: 9,
      desconta_sessao: false,
      marca_falta: false,
      aplicavel_em_lote: false,
      sessao_marcada: false,
      desmarque_da_familia: true,
    }
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({ ...SELECAO_FICTICIA, status: comODaFamilia ? [...status, daFamilia] : status }),
      ),
    )
  }

  it('deve dizer por que o botão abre a lista de status, com o caminho para as Configurações', async () => {
    // ARRANGE
    comPermissoes(QUEM_CONFIGURA)
    comSelecao(false)

    // ACT
    renderPainel(PEDIU_DESMARQUE)

    // ASSERT — o motivo é a descrição do botão, e o link leva à aba onde se configura
    const botao = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(botao).toHaveAccessibleDescription(/Falta configurar: um status válido para o desmarque pela família\. Por isso “Desmarcar” abre a lista de status/)
    })
    expect(botao).toHaveAccessibleDescription(/Configurações › Comunicação, em “Status aplicado quando a família desmarca”/)
    expect(screen.getByRole('link', { name: 'Abrir Configurações' })).toHaveAttribute('href', '/configuracoes')
  })

  it('deve dizer a quem pedir, sem link, a quem não pode mexer nas configurações', async () => {
    // ARRANGE
    comPermissoes(QUEM_RESOLVE)
    comSelecao(false)

    // ACT
    renderPainel(PEDIU_DESMARQUE)

    // ASSERT
    const botao = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    await waitFor(() => {
      expect(botao).toHaveAccessibleDescription(/Peça a quem administra o sistema para configurar\.$/)
    })
    expect(screen.queryByRole('link', { name: 'Abrir Configurações' })).not.toBeInTheDocument()
  })

  it('não deve explicar nada quando o status do desmarque pela família está configurado (nada muda)', async () => {
    // ARRANGE
    comPermissoes(QUEM_CONFIGURA)
    comSelecao(true)
    renderPainel(PEDIU_DESMARQUE)
    const botao = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })

    // ACT
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })

    // ASSERT
    expect(botao).not.toHaveAttribute('aria-describedby')
    expect(botao).not.toHaveAttribute('aria-haspopup')
    expect(screen.queryByText(/abre a lista de status/)).not.toBeInTheDocument()
  })

  it('não deve afirmar que falta o status quando a seleção não traz a flag', async () => {
    // ARRANGE — payload sem `desmarque_da_familia` não promete nada (o botão segue abrindo o menu)
    comPermissoes(QUEM_CONFIGURA)
    servidor.use(msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)))
    renderPainel(PEDIU_DESMARQUE)
    const botao = await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })

    // ACT
    await waitFor(() => {
      expect(botao).toBeEnabled()
    })

    // ASSERT
    expect(screen.queryByText(/abre a lista de status/)).not.toBeInTheDocument()
  })

  it('deve fechar o painel, sem buscar nada, ao seguir o caminho', async () => {
    // ARRANGE — a seleção é invalidada por quem SALVA a configuração (CR-AVI-02), não por quem segue o link
    comPermissoes(QUEM_CONFIGURA)
    comSelecao(false)
    let fechou = 0
    renderPainelComFechar(PEDIU_DESMARQUE, () => {
      fechou += 1
    })
    const link = await screen.findByRole('link', { name: 'Abrir Configurações' })
    await waitFor(() => {
      expect(queryClient.isFetching()).toBe(0)
    })
    const pedidas: string[] = []
    const anotar = ({ request }: { request: Request }): void => {
      pedidas.push(new URL(request.url).pathname)
    }
    servidor.events.on('request:start', anotar)

    // ACT
    await userEvent.click(link)

    // ASSERT
    expect(fechou).toBe(1)
    expect(queryClient.isFetching()).toBe(0)
    servidor.events.removeListener('request:start', anotar)
    expect(pedidas).toEqual([])
  })

  it('deve abrir o painel com as mesmas requisições, com e sem o motivo (nenhuma requisição nova)', async () => {
    // ARRANGE
    comPermissoes(QUEM_CONFIGURA)
    const assentar = async (): Promise<void> => {
      await screen.findByRole('button', { name: 'Desmarcar (a família pediu)' })
    }

    // ACT
    comSelecao(false)
    const comMotivo = await requisicoesAteAssentar(() => renderPainel(PEDIU_DESMARQUE), assentar)
    comSelecao(true)
    const semMotivo = await requisicoesAteAssentar(() => renderPainel(PEDIU_DESMARQUE), assentar)

    // ASSERT
    expect(comMotivo).toEqual(semMotivo)
  })

  it('deve passar no axe com o motivo, com e sem a permissão de configurar', async () => {
    for (const permissoes of [QUEM_CONFIGURA, QUEM_RESOLVE]) {
      // ARRANGE
      queryClient.clear()
      comPermissoes(permissoes)
      comSelecao(false)
      const { unmount } = renderPainel(PEDIU_DESMARQUE)

      // ACT
      await screen.findByText(/abre a lista de status/)
      const resultado = await axe(document.body)

      // ASSERT
      expect(resultado).toHaveNoViolations()
      unmount()
    }
  })
})

describe('PainelAgendamento — a clínica confirma pela família (confirmacao-pela-clinica)', () => {
  /** 14:32 no relógio de QUEM RODA o teste — o mesmo relógio que a frase usa. */
  const QUATORZE_E_TRINTA_E_DOIS = new Date(2026, 6, 15, 14, 32).toISOString()
  const SEM_RESPOSTA = cardCom({ confirmacao: { estado: 'aguardando', em: null, confirmavel: true } })
  const CONFIRMADA_PELA_CLINICA = { estado: 'confirmado', em: QUATORZE_E_TRINTA_E_DOIS, por: 'clinica' } as const

  function comCsrf(): void {
    servidor.use(msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })))
  }

  it.each([
    ['sem resposta', { estado: 'aguardando', em: null, confirmavel: true }],
    ['não entregue', { estado: 'nao_entregue', em: null, confirmavel: true }],
    ['sem lembrete por telefone inválido', { estado: 'nao_enviado', em: null, motivo: 'telefone inválido no cadastro', confirmavel: true }],
  ] as const)('deve oferecer "Marcar como confirmada" quando o lembrete está %s', async (_rotulo, confirmacao) => {
    // ARRANGE
    comPermissoes(['agenda.ver', 'agenda.editar'])

    // ACT
    renderPainel(cardCom({ confirmacao }))

    // ASSERT — a ação diz para quando ela é
    const botao = await screen.findByRole('button', { name: 'Marcar como confirmada' })
    expect(botao).toHaveAccessibleDescription('Use quando a família confirmar por telefone ou mensagem.')
  })

  it.each([
    ['já confirmada pela família', cardCom({ confirmacao: { estado: 'confirmado', em: null, por: 'familia' } })],
    ['com pedido de desmarque', cardCom({ confirmacao: { estado: 'pediu_desmarque', em: null } })],
    ['sem lembrete nenhum', cardCom({ confirmacao: null })],
    // o servidor diz que a sessão já começou (gate r1, CR-CC-04): ele recusaria
    ['que já começou', cardCom({ confirmacao: { estado: 'aguardando', em: null, confirmavel: false } })],
  ])('não deve oferecer "Marcar como confirmada" na sessão %s', async (_rotulo, card) => {
    // ARRANGE
    comPermissoes(['agenda.ver', 'agenda.editar'])

    // ACT
    renderPainel(card)

    // ASSERT
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Marcar como confirmada' })).not.toBeInTheDocument()
  })

  it('deve mostrar o estado sem a ação a quem não pode mudar o status', async () => {
    // ARRANGE
    comPermissoes(['agenda.ver'])

    // ACT
    renderPainel(SEM_RESPOSTA)

    // ASSERT
    expect(await screen.findByText('Lembrete enviado, sem resposta da família')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar como confirmada' })).not.toBeInTheDocument()
  })

  it('deve marcar como confirmada pela clínica e levar o foco à frase nova', async () => {
    // ARRANGE — o POST devolve só a confirmação, como a produção
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    let idConfirmado: string | undefined
    servidor.use(
      msw.post('/api/agendamentos/:id/confirmar', ({ params }) => {
        idConfirmado = String(params.id)
        return HttpResponse.json({ confirmacao: CONFIRMADA_PELA_CLINICA })
      }),
    )
    const usuario = userEvent.setup()
    renderPainel(SEM_RESPOSTA)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Marcar como confirmada' }))

    // ASSERT
    const frase = await screen.findByText('Confirmado pela clínica às 14:32')
    await waitFor(() => {
      expect(frase).toHaveFocus()
    })
    expect(idConfirmado).toBe('42')
    expect(screen.queryByRole('button', { name: 'Marcar como confirmada' })).not.toBeInTheDocument()
    expect(await screen.findByText('Sessão marcada como confirmada.')).toBeInTheDocument()
  })

  it('deve deixar "Marcar como confirmada" inerte sem tirar o foco dele, e devolver a recusa ao mesmo lugar', async () => {
    // ARRANGE — a gravação demora e o servidor recusa; a grade relida ainda diz que a ação vale
    queryClient.clear()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    servidor.use(
      msw.get('/api/agenda', () => HttpResponse.json([SEM_RESPOSTA])),
      msw.post('/api/agendamentos/:id/confirmar', async () => {
        await delay(80)
        return HttpResponse.json({ errors: { confirmacao: ['A sessão já começou.'] } }, { status: 422 })
      }),
    )
    const usuario = userEvent.setup()
    renderComGrade(SEM_RESPOSTA)
    const botao = await screen.findByRole('button', { name: 'Marcar como confirmada' })

    // ACT
    await usuario.click(botao)

    // ASSERT — inerte pelo ATRIBUTO, nunca `disabled`; na recusa, o motivo aparece e a pessoa continua no botão
    await waitFor(() => {
      expect(botao).toHaveAttribute('aria-disabled', 'true')
    })
    expect(botao).toBeEnabled()
    expect(await screen.findByText('A sessão já começou.')).toBeInTheDocument()
    await waitFor(() => {
      expect(botao).not.toHaveAttribute('aria-disabled')
    })
    expect(botao).toHaveFocus()
  })

  it('deve passar no axe com a ação no aviso de lembrete não enviado', async () => {
    // ARRANGE — o caso de mais peças juntas: o aviso âmbar, o botão e a ajuda
    comPermissoes(['agenda.ver', 'agenda.editar'])
    renderPainel(cardCom({ confirmacao: { estado: 'nao_enviado', em: null, motivo: 'telefone inválido no cadastro', confirmavel: true } }))
    await screen.findByRole('button', { name: 'Marcar como confirmada' })

    // ACT
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })

  /** A grade que fica ATIVA atrás do painel na tela real: é ela que a invalidação relê. */
  function GradeAtrasDaConfirmacao() {
    useQuery({ queryKey: chaves.agenda({ de: '2026-07-16', ate: '2026-07-16' }), queryFn: () => buscarAgenda({ de: '2026-07-16', ate: '2026-07-16' }) })
    return null
  }

  function renderComGrade(card: CardAgendamento) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ProvedorToast>
            <GradeAtrasDaConfirmacao />
            <PainelAgendamento aberto card={card} aoFechar={() => {}} aoEditar={() => {}} />
          </ProvedorToast>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('deve reler a grade depois de confirmar, para o cartão e a faixa contarem a sessão como confirmada', async () => {
    // ARRANGE — gate r1, CR-CC-06: a grade ativa atrás do painel é a que a invalidação relê
    queryClient.clear()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    let confirmou = false
    let leiturasDaGrade = 0
    servidor.use(
      msw.get('/api/agenda', () => {
        leiturasDaGrade += 1
        return HttpResponse.json([confirmou ? cardCom({ confirmacao: CONFIRMADA_PELA_CLINICA }) : SEM_RESPOSTA])
      }),
      msw.post('/api/agendamentos/:id/confirmar', () => {
        confirmou = true
        return HttpResponse.json({ confirmacao: CONFIRMADA_PELA_CLINICA })
      }),
    )
    const usuario = userEvent.setup()
    renderComGrade(SEM_RESPOSTA)
    await waitFor(() => {
      expect(leiturasDaGrade).toBe(1)
    })

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Marcar como confirmada' }))

    // ASSERT
    await screen.findByText('Confirmado pela clínica às 14:32')
    await waitFor(() => {
      expect(leiturasDaGrade).toBe(2)
    })
  })

  it('deve mostrar no painel o estado relido quando a recusa diz que outra pessoa já confirmou', async () => {
    // ARRANGE — gate r1, A11Y-CC-01: o toast some em segundos; o painel não pode continuar dizendo
    // "sem resposta" nem oferecer o botão de novo
    queryClient.clear()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    let recusou = false
    servidor.use(
      msw.get('/api/agenda', () =>
        HttpResponse.json([recusou ? cardCom({ confirmacao: CONFIRMADA_PELA_CLINICA }) : SEM_RESPOSTA]),
      ),
      msw.post('/api/agendamentos/:id/confirmar', () => {
        recusou = true
        return HttpResponse.json({ errors: { confirmacao: ['A sessão já está confirmada.'] } }, { status: 422 })
      }),
    )
    const usuario = userEvent.setup()
    renderComGrade(SEM_RESPOSTA)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Marcar como confirmada' }))

    // ASSERT — o motivo no toast, o estado de agora no painel, e o foco na frase (o botão saiu)
    expect(await screen.findByText('A sessão já está confirmada.')).toBeInTheDocument()
    const frase = await screen.findByText('Confirmado pela clínica às 14:32')
    await waitFor(() => {
      expect(frase).toHaveFocus()
    })
    expect(screen.queryByRole('button', { name: 'Marcar como confirmada' })).not.toBeInTheDocument()
  })


  it('deve levar o foco à linha do motivo quando a recusa mostra que a família pediu para desmarcar', async () => {
    // ARRANGE — gate r2, CR-CC-11/A11Y-CC-04: o bloco troca pelo do pedido, e o botão com o foco sai da
    // tela; o foco não pode cair no contêiner do painel
    queryClient.clear()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    let recusou = false
    servidor.use(
      msw.get('/api/agenda', () =>
        HttpResponse.json([recusou ? cardCom({ confirmacao: { estado: 'pediu_desmarque', em: QUATORZE_E_TRINTA_E_DOIS } }) : SEM_RESPOSTA]),
      ),
      // o bloco do pedido busca os status para "Desmarcar (a família pediu)"
      msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)),
      msw.post('/api/agendamentos/:id/confirmar', () => {
        recusou = true
        return HttpResponse.json(
          { errors: { confirmacao: ['A família pediu para desmarcar. Use "Manter a sessão" se ela desistiu.'] } },
          { status: 422 },
        )
      }),
    )
    const usuario = userEvent.setup()
    renderComGrade(SEM_RESPOSTA)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Marcar como confirmada' }))

    // ASSERT — o motivo numa linha que fica, com o foco, e as saídas do pedido logo abaixo
    const linha = await screen.findByText(
      'Não foi possível marcar como confirmada: A família pediu para desmarcar. Use "Manter a sessão" se ela desistiu.',
    )
    await waitFor(() => {
      expect(linha).toHaveFocus()
    })
    expect(await screen.findByRole('button', { name: 'Manter a sessão (a família desistiu)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar como confirmada' })).not.toBeInTheDocument()
  })

  it('deve levar o foco à linha do motivo quando a recusa mostra que a sessão já não tem lembrete', async () => {
    // ARRANGE — gate r2, CR-CC-14/A11Y-CC-05: outra pessoa remarcou; o painel não pode continuar dizendo
    // "sem resposta" nem oferecer a ação de novo
    queryClient.clear()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    let recusou = false
    servidor.use(
      msw.get('/api/agenda', () => HttpResponse.json([recusou ? cardCom({ confirmacao: null }) : SEM_RESPOSTA])),
      msw.post('/api/agendamentos/:id/confirmar', () => {
        recusou = true
        return HttpResponse.json(
          { errors: { confirmacao: ['Esta sessão não tem lembrete esperando confirmação.'] } },
          { status: 422 },
        )
      }),
    )
    const usuario = userEvent.setup()
    renderComGrade(SEM_RESPOSTA)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Marcar como confirmada' }))

    // ASSERT
    const linha = await screen.findByText(
      'Não foi possível marcar como confirmada: Esta sessão não tem lembrete esperando confirmação.',
    )
    await waitFor(() => {
      expect(linha).toHaveFocus()
    })
    expect(screen.queryByText('Lembrete enviado, sem resposta da família')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar como confirmada' })).not.toBeInTheDocument()
  })

  it('deve manter o foco no botão quando a recusa não muda o que a grade diz', async () => {
    // ARRANGE — gate r2, CR-CC-12: a grade relida ainda diz que a ação vale; nada sai da tela
    queryClient.clear()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    servidor.use(
      msw.get('/api/agenda', () => HttpResponse.json([SEM_RESPOSTA])),
      msw.post('/api/agendamentos/:id/confirmar', () =>
        HttpResponse.json({ errors: { confirmacao: ['A sessão já começou.'] } }, { status: 422 }),
      ),
    )
    const usuario = userEvent.setup()
    renderComGrade(SEM_RESPOSTA)
    const botao = await screen.findByRole('button', { name: 'Marcar como confirmada' })

    // ACT
    await usuario.click(botao)

    // ASSERT
    expect(await screen.findByText('A sessão já começou.')).toBeInTheDocument()
    await waitFor(() => {
      expect(botao).not.toHaveAttribute('aria-busy')
    })
    expect(botao).toBeInTheDocument()
    expect(botao).toHaveFocus()
    expect(screen.queryByText(/Não foi possível marcar como confirmada:/)).not.toBeInTheDocument()
  })

  it('deve deixar tudo como está, com o foco no botão, quando a falha é do servidor e não uma recusa', async () => {
    // ARRANGE — só a recusa diz que a sessão mudou; com o servidor fora, a pessoa tenta de novo
    queryClient.clear()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    let leiturasDaGrade = 0
    servidor.use(
      msw.get('/api/agenda', () => {
        leiturasDaGrade += 1
        return HttpResponse.json([cardCom({ confirmacao: null })])
      }),
      msw.post('/api/agendamentos/:id/confirmar', () => new HttpResponse(null, { status: 500 })),
    )
    const usuario = userEvent.setup()
    renderComGrade(SEM_RESPOSTA)
    const botao = await screen.findByRole('button', { name: 'Marcar como confirmada' })
    await waitFor(() => {
      expect(leiturasDaGrade).toBe(1)
    })

    // ACT
    await usuario.click(botao)

    // ASSERT
    await waitFor(() => {
      expect(botao).not.toHaveAttribute('aria-busy')
    })
    expect(botao).toHaveFocus()
    expect(leiturasDaGrade).toBe(1)
  })


  it('deve tirar a linha da recusa quando o painel passa a mostrar outra sessão', async () => {
    // ARRANGE — gate r3, CR-CC-15: o painel continua montado ao trocar de cartão; a recusa da sessão A
    // não pode esconder a ação da sessão B
    queryClient.clear()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    let recusou = false
    servidor.use(
      msw.get('/api/agenda', () => HttpResponse.json([recusou ? cardCom({ confirmacao: null }) : SEM_RESPOSTA])),
      msw.post('/api/agendamentos/:id/confirmar', () => {
        recusou = true
        return HttpResponse.json(
          { errors: { confirmacao: ['Esta sessão não tem lembrete esperando confirmação.'] } },
          { status: 422 },
        )
      }),
    )
    const usuario = userEvent.setup()
    const { rerender } = renderComGrade(SEM_RESPOSTA)
    await usuario.click(await screen.findByRole('button', { name: 'Marcar como confirmada' }))
    await screen.findByText(/Não foi possível marcar como confirmada:/)
    const outraSessao = cardCom({ id: 43, confirmacao: { estado: 'aguardando', em: null, confirmavel: true } })

    // ACT
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ProvedorToast>
            <GradeAtrasDaConfirmacao />
            <PainelAgendamento aberto card={outraSessao} aoFechar={() => {}} aoEditar={() => {}} />
          </ProvedorToast>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Marcar como confirmada' })).toBeInTheDocument()
    expect(screen.queryByText(/Não foi possível marcar como confirmada:/)).not.toBeInTheDocument()
  })

  it('deve mostrar só a linha da resolução quando a recepção resolve o pedido que causou a recusa', async () => {
    // ARRANGE — gate r3, CR-CC-16: a recusa veio do pedido de desmarque, e a recepção escolhe "Manter"
    queryClient.clear()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    comCsrf()
    let recusou = false
    servidor.use(
      msw.get('/api/agenda', () =>
        HttpResponse.json([recusou ? cardCom({ confirmacao: { estado: 'pediu_desmarque', em: QUATORZE_E_TRINTA_E_DOIS } }) : SEM_RESPOSTA]),
      ),
      msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)),
      msw.post('/api/agendamentos/:id/confirmar', () => {
        recusou = true
        return HttpResponse.json(
          { errors: { confirmacao: ['A família pediu para desmarcar. Use "Manter a sessão" se ela desistiu.'] } },
          { status: 422 },
        )
      }),
      msw.post('/api/agendamentos/:id/manter-sessao', () => HttpResponse.json({ confirmacao: CONFIRMADA_PELA_CLINICA })),
    )
    const usuario = userEvent.setup()
    renderComGrade(SEM_RESPOSTA)
    await usuario.click(await screen.findByRole('button', { name: 'Marcar como confirmada' }))
    const manter = await screen.findByRole('button', { name: 'Manter a sessão (a família desistiu)' })

    // ACT
    await usuario.click(manter)

    // ASSERT
    const resolucao = await screen.findByText('Pedido da família resolvido: a sessão continua marcada, como confirmada.')
    await waitFor(() => {
      expect(resolucao).toHaveFocus()
    })
    expect(screen.queryByText(/Não foi possível marcar como confirmada:/)).not.toBeInTheDocument()
  })
})

describe('PainelAgendamento — Avisar no WhatsApp abre a conversa (avisar-no-whatsapp-abre-a-conversa)', () => {
  const QUEM_FALA_COM_AS_FAMILIAS = ['agenda.ver', 'mensagens.ver', 'mensagens.responder']

  /** Onde a tela foi parar — a rota de Mensagens mostra o endereço com a conversa. */
  function TelaDeMensagens() {
    const local = useLocation()
    return <p>{`Mensagens ${local.search}`}</p>
  }

  function renderComRotas(card: CardAgendamento) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agenda']}>
          <ProvedorToast>
            <Routes>
              <Route path="/agenda" element={<PainelAgendamento aberto card={card} aoFechar={() => {}} aoEditar={() => {}} />} />
              <Route path="/mensagens" element={<TelaDeMensagens />} />
            </Routes>
          </ProvedorToast>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  function comCsrf(): void {
    servidor.use(msw.get('/sanctum/csrf-cookie', () => new HttpResponse(null, { status: 204 })))
  }

  it('deve abrir a tela Mensagens já na conversa da família', async () => {
    // ARRANGE — o POST devolve só o identificador, como a produção
    comPermissoes(QUEM_FALA_COM_AS_FAMILIAS)
    comCsrf()
    let pedidoDe: string | undefined
    servidor.use(
      msw.post('/api/agendamentos/:id/conversa', ({ params }) => {
        pedidoDe = String(params.id)
        return HttpResponse.json({ conversa_id: 77 })
      }),
    )
    const usuario = userEvent.setup()
    renderComRotas(CARD)
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))

    // ACT
    await usuario.click(await screen.findByRole('menuitem', { name: 'Avisar no WhatsApp' }))

    // ASSERT
    expect(await screen.findByText('Mensagens ?conversa=77')).toBeInTheDocument()
    expect(pedidoDe).toBe('42')
  })

  it('deve dizer o motivo e continuar no painel quando a criança não tem celular válido', async () => {
    // ARRANGE
    comPermissoes(QUEM_FALA_COM_AS_FAMILIAS)
    comCsrf()
    servidor.use(
      msw.post('/api/agendamentos/:id/conversa', () =>
        HttpResponse.json({ errors: { conversa: ['O telefone do cadastro não é válido para WhatsApp.'] } }, { status: 422 }),
      ),
    )
    const usuario = userEvent.setup()
    renderComRotas(CARD)
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))

    // ACT
    await usuario.click(await screen.findByRole('menuitem', { name: 'Avisar no WhatsApp' }))

    // ASSERT
    expect(await screen.findByText('O telefone do cadastro não é válido para WhatsApp.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText(/^Mensagens/)).not.toBeInTheDocument()
  })

  it('não deve oferecer o WhatsApp num horário sem criança', async () => {
    // ARRANGE — só quem fala com as famílias, e o horário não tem criança
    comPermissoes([...QUEM_FALA_COM_AS_FAMILIAS, 'agenda.editar'])
    servidor.use(msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)))
    const usuario = userEvent.setup()
    renderComRotas(cardCom({ paciente_id: null, paciente: null }))

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))

    // ASSERT
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Avisar no WhatsApp/ })).not.toBeInTheDocument()
  })

  it('deve passar no axe com o menu aberto e o WhatsApp oferecido', async () => {
    // ARRANGE
    comPermissoes(QUEM_FALA_COM_AS_FAMILIAS)
    const usuario = userEvent.setup()
    renderComRotas(CARD)
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))
    await screen.findByRole('menuitem', { name: 'Avisar no WhatsApp' })

    // ACT — o menu flutuante (portal do Radix), como os outros testes da agenda medem o próprio elemento
    const resultado = await axe(screen.getByRole('menu'))

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })


  it('deve mostrar só o WhatsApp, sem a linha de separação, a quem só fala com as famílias', async () => {
    // ARRANGE — gate r1, CR-WA-07: sem Editar, Histórico e Excluir, a linha separaria nada de nada
    comPermissoes(QUEM_FALA_COM_AS_FAMILIAS)
    const usuario = userEvent.setup()
    renderComRotas(CARD)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))

    // ASSERT
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Avisar no WhatsApp'])
    expect(within(menu).queryByRole('separator')).not.toBeInTheDocument()
  })

  it('deve separar os grupos quando há ações dos dois lados', async () => {
    // ARRANGE — gate r1, CR-WA-07
    comPermissoes([...QUEM_FALA_COM_AS_FAMILIAS, 'agenda.editar'])
    servidor.use(msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)))
    const usuario = userEvent.setup()
    renderComRotas(CARD)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))

    // ASSERT
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('separator')).toBeInTheDocument()
  })

  it('não deve oferecer o WhatsApp a quem responde mas não pode ver as conversas', async () => {
    // ARRANGE — gate r1, CR-WA-07: a tela Mensagens não abriria
    comPermissoes(['agenda.ver', 'agenda.editar', 'mensagens.responder'])
    servidor.use(msw.get('/api/agenda/selecao', () => HttpResponse.json(SELECAO_FICTICIA)))
    const usuario = userEvent.setup()
    renderComRotas(CARD)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))

    // ASSERT
    expect(await screen.findByRole('menuitem', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Avisar no WhatsApp/ })).not.toBeInTheDocument()
  })

  it('não deve levar a Mensagens quem fechou o painel antes da resposta', async () => {
    // ARRANGE — gate r1, CR-WA-08: a resposta demora, e a recepção fecha o painel nesse meio-tempo
    comPermissoes(QUEM_FALA_COM_AS_FAMILIAS)
    comCsrf()
    let responder: (() => void) | undefined
    servidor.use(
      msw.post('/api/agendamentos/:id/conversa', async () => {
        await new Promise<void>((resolve) => {
          responder = resolve
        })
        return HttpResponse.json({ conversa_id: 77 })
      }),
    )
    const usuario = userEvent.setup()
    function PainelQueFecha() {
      const [aberto, setAberto] = useState(true)
      return aberto ? (
        <>
          <button type="button" onClick={() => setAberto(false)}>
            Fechar por fora
          </button>
          <PainelAgendamento aberto card={CARD} aoFechar={() => setAberto(false)} aoEditar={() => {}} />
        </>
      ) : (
        <p>Painel fechado</p>
      )
    }
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agenda']}>
          <ProvedorToast>
            <Routes>
              <Route path="/agenda" element={<PainelQueFecha />} />
              <Route path="/mensagens" element={<TelaDeMensagens />} />
            </Routes>
          </ProvedorToast>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await usuario.click(await screen.findByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Avisar no WhatsApp' }))
    await waitFor(() => {
      expect(responder).toBeDefined()
    })

    // ACT — o painel fecha, e só depois a resposta chega
    await usuario.keyboard('{Escape}')
    await screen.findByText('Painel fechado')
    await act(async () => {
      responder?.()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    // ASSERT
    expect(screen.getByText('Painel fechado')).toBeInTheDocument()
    expect(screen.queryByText(/^Mensagens/)).not.toBeInTheDocument()
  })
})
