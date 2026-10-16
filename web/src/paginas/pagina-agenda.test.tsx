import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { fingirTelaEstreita } from '@/test/setup'
import { PaginaAgenda } from '@/paginas/pagina-agenda'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { cardFicticio, CONFIGURACAO_FICTICIA, DIA_FICTICIO, handlersDaAgenda, SELECAO_FICTICIA } from '@/test/dados-agenda'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import { hojeNaClinica, periodoEmPalavras, TIMEZONE_PADRAO } from '@/lib/datas'
import type { CardAgendamento } from '@/tipos'

expect.extend(toHaveNoViolations)

/** A agenda vive dentro do shell: sessão ativa e provedor de toast. */
function renderizarAgenda(
  cards: CardAgendamento[] = [cardFicticio()],
  busca = `?data=${DIA_FICTICIO}`,
  permissoes: string[] = ['agenda.ver'],
  profissionalDoUsuario: number | null = null,
) {
  servidor.use(...handlersDaAgenda(cards))
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes, profissional_id: profissionalDoUsuario },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[`/agenda${busca}`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

describe('Agenda — card do agendamento (§6)', () => {
  it('deve exibir horário, paciente, status, especialidade e convênio', async () => {
    // ARRANGE + ACT
    renderizarAgenda()
    await screen.findByText('Paciente Fictício')

    // ASSERT: dentro do CARD (o horário também é cabeçalho de linha da grade)
    const card = screen.getByRole('article')
    expect(within(card).getByText('08:00')).toBeInTheDocument()
    expect(within(card).getByText('Em Aberto')).toBeInTheDocument()
    expect(within(card).getByText(/Fonoaudiologia/)).toBeInTheDocument()
    expect(within(card).getByText(/Convênio Fictício/)).toBeInTheDocument()
  })

  it('deve exibir o contador de sessões realizadas sobre o total', async () => {
    // ARRANGE + ACT: 12 total, saldo 9 → 3 realizadas
    renderizarAgenda()

    // ASSERT
    expect(await screen.findByText('3/12 sessões')).toBeInTheDocument()
  })

  it('deve não exibir contador nem convênio sem tratamento', async () => {
    // ARRANGE + ACT
    renderizarAgenda([
      cardFicticio({ tratamento_id: null, tratamento_saldo: null, tratamento_total: null, convenio: null }),
    ])

    // ASSERT
    expect(await screen.findByText('Paciente Fictício')).toBeInTheDocument()
    expect(screen.queryByText(/sessões/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Convênio/)).not.toBeInTheDocument()
  })

  it('deve identificar o particular pela flag do cadastro, não pelo nome', async () => {
    // ARRANGE + ACT: o cadastro chama "Plano Interno", mas a flag manda (§14/§13)
    renderizarAgenda([
      cardFicticio({ convenio: { id: 2, nome: 'Plano Interno Fictício', particular: true } }),
    ])

    // ASSERT
    expect(await screen.findByText(/Particular/)).toBeInTheDocument()
    expect(screen.queryByText(/Plano Interno/)).not.toBeInTheDocument()
  })

  it('deve realçar as duas últimas sessões com ícone e texto, sem piscar', async () => {
    // ARRANGE + ACT: o veredito vem do servidor; a tela só o veste
    renderizarAgenda([cardFicticio({ tratamento_saldo: 1, tratamento_realce: 'acabando' })])

    // ASSERT: realce ESTÁTICO (o piscar da referência é anti-padrão §2)
    const aviso = await screen.findByText('Última sessão do tratamento')
    expect(aviso).toBeInTheDocument()
    expect(aviso.className).not.toContain('animate')
  })

  it('deve renderizar nome de paciente malicioso como texto literal', async () => {
    // ARRANGE: dado da clínica em texto livre (T-ds-01)
    const payload = '<img src=x onerror=alert(1)>'

    // ACT
    renderizarAgenda([
      cardFicticio({ paciente: { id: 10, nome: payload, nome_social: null } }),
    ])

    // ASSERT
    expect(await screen.findByText(payload)).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('deve cair no tom neutro quando a cor do status vem malformada', async () => {
    // ARRANGE + ACT: injeção de estilo pelo cadastro (T-ds-02)
    renderizarAgenda([
      cardFicticio({
        status: { id: 1, nome: 'Em Aberto', cor: 'red;position:fixed', cor_borda: null, tipo: '__proto__' },
      }),
    ])

    // ASSERT: chip íntegro (ícone neutro, cor sanitizada), grade de pé
    const chip = await screen.findByText('Em Aberto')
    expect(chip.parentElement?.getAttribute('style')).not.toContain('position')
  })
})

describe('Agenda — grade e visões', () => {
  it('deve renderizar a grade como tabela semântica com o eixo de horários', async () => {
    // ARRANGE + ACT
    renderizarAgenda()

    // ASSERT: leitor de tela navega por linha/coluna
    const tabela = await screen.findByRole('table')
    expect(within(tabela).getByRole('columnheader', { name: 'Horário' })).toBeInTheDocument()
    expect(within(tabela).getByRole('rowheader', { name: '08:00' })).toBeInTheDocument()
  })

  it('deve mostrar uma coluna por profissional na visão geral', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Visão geral' }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício B/ })).toBeInTheDocument()
  })

  it('deve marcar como indisponível o horário fora da janela do profissional', async () => {
    // ARRANGE + ACT: A atende até 12:00; B até 18:00
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')
    await usuario.click(screen.getByRole('button', { name: 'Visão geral' }))

    // ASSERT: a célula das 13:00 na coluna de A é anunciada como fora do horário
    await waitFor(() => {
      expect(screen.getAllByText('Fora do horário de atendimento').length).toBeGreaterThan(0)
    })
  })

  it('deve trocar de período pelos controles de data', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarAgenda()
    await screen.findByRole('table')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Próximo período' }))

    // ASSERT: a data avança um dia (estado na URL)
    await waitFor(() => {
      expect(screen.getByLabelText('Data da agenda')).toHaveValue('14/07/2026')
    })
  })
})

describe('Agenda — entradas não confiáveis (SEC-R1/R2)', () => {
  it('deve cair no dia de hoje quando a data da URL é lixo', async () => {
    // ARRANGE + ACT: sem validação, `data=banana` derrubava o render inteiro
    // (RangeError na aritmética de datas — e o balcão via tela branca)
    renderizarAgenda([], '?visao=semana&data=banana')

    // ASSERT: a grade renderiza (em vez de tela branca), com data válida
    expect(await screen.findByRole('table')).toBeInTheDocument()
    const campo = screen.getByLabelText('Data da agenda') as HTMLInputElement
    expect(campo.value).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('deve renderizar a agenda mesmo com fuso inválido na configuração', async () => {
    // ARRANGE: configuração editável entrega fuso quebrado ao Intl, que LANÇA
    servidor.use(...handlersDaAgenda([]))
    servidor.use(
      msw.get('/api/agenda/configuracoes', () =>
        HttpResponse.json({
          configuracoes: [{ chave: 'clinica.timezone', tipo: 'string', valor: 'America/Sao Paulo' }],
        }),
      ),
    )

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/agenda']}>
          <PaginaAgenda />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // ASSERT: fallback para o fuso padrão em vez de tela branca na clínica inteira
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})

describe('Agenda — os quatro estados', () => {
  it('deve mostrar o esqueleto enquanto carrega', () => {
    // ARRANGE + ACT
    const { container } = renderizarAgenda()

    // ASSERT
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('deve manter o eixo de horários quando o período não tem agendamentos', async () => {
    // ARRANGE + ACT
    renderizarAgenda([])

    // ASSERT: vazio NÃO some com a grade (findByText porque a página também
    // mantém a região viva PERMANENTE do modo teclado com role="status")
    const vazio = await screen.findByRole('heading', { name: 'Nenhum agendamento neste período' })
    expect(vazio.tagName).toBe('H2')
    expect(screen.getByRole('table')).toBeInTheDocument()
    // e quem não vê o desenho OUVE o resultado da troca de período (a11y-auditor SLH-01)
    expect(screen.getByRole('status')).toHaveTextContent(/^Nenhum agendamento em .+\.$/)
  })

  it('deve recuperar a tela quando quem falhou foi um CATÁLOGO (I-02)', async () => {
    // ARRANGE: falha o endpoint de configuração — refazer só a agenda não
    // repararia nada (catalogosProntos ficaria false para sempre)
    const usuario = userEvent.setup()
    let falhar = true
    servidor.use(...handlersDaAgenda([cardFicticio()]))
    servidor.use(
      msw.get('/api/agenda/configuracoes', () => {
        if (falhar) {
          return new HttpResponse(null, { status: 500 })
        }
        return HttpResponse.json(CONFIGURACAO_FICTICIA)
      }),
    )

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByRole('alert', {}, { timeout: 5000 })

    // ACT: o servidor volta e o usuário tenta de novo
    falhar = false
    await usuario.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT: a tela se recupera de verdade
    expect(await screen.findByRole('table', {}, { timeout: 5000 })).toBeInTheDocument()
  }, 20000)

  it('deve renderizar a grade mesmo com o catálogo acessório fora do ar (R-01)', async () => {
    // ARRANGE: só as especialidades falham — elas apenas colorem o marcador da
    // sidebar. Derrubar a agenda com os cards em mãos seria perder a tela núcleo
    // por um catálogo acessório.
    servidor.use(...handlersDaAgenda([cardFicticio()]))
    servidor.use(msw.get('/api/especialidades', () => new HttpResponse(null, { status: 500 })))

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // ASSERT: a grade e o card estão lá
    expect(await screen.findByRole('table', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Paciente Fictício')).toBeInTheDocument()
  }, 15000)

  it('deve oferecer nova tentativa quando a consulta falha', async () => {
    // ARRANGE
    servidor.use(...handlersDaAgenda())
    servidor.use(msw.get('/api/agenda', () => new HttpResponse(null, { status: 500 })))

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}`]}>
          <PaginaAgenda />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // ASSERT: mensagem humana + retry (nunca o dump do servidor)
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'Não foi possível carregar a agenda.',
    )
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  }, 15000)
})

describe('Agenda — a11y', () => {
  it('deve não ter violações axe na grade carregada', async () => {
    // ARRANGE
    const { container } = renderizarAgenda()
    await screen.findByRole('table')

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})

describe('Agenda — "Todos os profissionais" mostra TODOS', () => {
  it('deve levar para a visão que mostra todos, em vez de cair num só', async () => {
    // ARRANGE — O BOTÃO MENTIA.
    //
    // A visão Dia é a de UM profissional (§6). Limpar o filtro nela caía EM SILÊNCIO no
    // primeiro ativo: a grade continuava mostrando uma pessoa só, com "Todos os
    // profissionais" aparentemente escolhido. Para a recepção, o clique não fazia nada — e
    // ela só via a clínica inteira se descobrisse sozinha a aba "Visão geral".
    //
    // Botão que não faz o que promete é o mesmo defeito do botão que promete o que o
    // servidor nega. Aqui quem negava era a própria visão.
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=dia&profissional=1`)
    await screen.findByRole('table')

    // ASSERT 1 — na visão Dia, só o profissional escolhido tem coluna
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Profissional Fictício B/ })).not.toBeInTheDocument()

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Todos os profissionais' }))

    // ASSERT 2 — os DOIS aparecem: o clique levou à visão que de fato mostra todos
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /Profissional Fictício B/ })).toBeInTheDocument()
    })
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Visão geral' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('deve continuar levando ao DIA do profissional escolhido a partir da visão geral', async () => {
    // ARRANGE: a metade simétrica, que já existia — escolher alguém na visão geral abre o
    // dia dele. As duas direções agora fecham.
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByRole('table')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Profissional Fictício B/ }))

    // ASSERT
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dia' })).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.queryByRole('columnheader', { name: /Profissional Fictício A/ })).not.toBeInTheDocument()
  })
})

describe('Agenda — as portas que a permissão precisa ter', () => {
  it('deve abrir a grade inteira só com `agenda.ver`', async () => {
    // ARRANGE — o NÍVEL MÍNIMO, que é o teste que o admin nunca faz. A grade buscava
    // `/profissionais`, `/especialidades` e `/feriados` — cada um atrás da permissão do SEU
    // módulo — e este usuário levava três 403 e via "Não foi possível carregar a agenda".
    // Os handlers dos três endpoints NÃO existem aqui: se a grade voltar a chamá-los, o msw
    // devolve erro e este teste fica vermelho. É a guarda contra a volta do defeito.
    servidor.use(
      msw.get('/api/profissionais', () => new HttpResponse(null, { status: 403 })),
      msw.get('/api/especialidades', () => new HttpResponse(null, { status: 403 })),
      msw.get('/api/feriados', () => new HttpResponse(null, { status: 403 })),
    )

    // ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}`, ['agenda.ver'])

    // ASSERT — a grade desenha: coluna do profissional (nome + janela) e o card
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    expect(screen.getByText('Paciente Fictício')).toBeInTheDocument()
  })

  it('deve PINTAR o feriado que a seleção entregou', async () => {
    // ARRANGE — o teste que faltava, e que teria pegado o bloqueante do gate: a suíte provava que
    // o feriado vinha no JSON, nunca que a GRADE o pintava. Quando a fonte mudou (a seleção não
    // manda `ativo`), o filtro `if (!feriado.ativo)` do cliente passou a receber `undefined`,
    // `!undefined` é `true`, e a grade descartou TODOS os feriados — quebrando exatamente o que
    // esta change veio consertar, com 427 testes verdes.
    //
    // A visão SEMANA é a que tem coluna por DIA (e é onde o feriado aparece no cabeçalho).
    // ACT — o `servidor.use` vem DEPOIS do render: o `renderizarAgenda` registra os handlers
    // padrão, e no msw o último registrado vence
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=dia`, ['agenda.ver'])
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          feriados: [{ id: 9, nome: 'Feriado Fictício da Clínica', data: DIA_FICTICIO, recorrente: false }],
        }),
      ),
    )

    // ASSERT — na visão DIA (a PADRÃO da clínica, onde as colunas são profissionais e o feriado
    // não tem coluna onde morar) a grade AVISA. Sem isto, o feriado só aparecia na Semana — e a
    // recepção seguia marcando sessão no Natal (re-review r10).
    expect(await screen.findByText(/Feriado: Feriado Fictício da Clínica/)).toBeInTheDocument()
  })

  it('deve abrir o PAINEL DE LEITURA ao clicar no cartão, sem oferecer edição a quem não pode editar', async () => {
    // ARRANGE — o clique abre LEITURA (não o formulário); ler o prontuário tem porta, mas
    // sem `agenda.editar` não há ação de edição no painel.
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}`, ['agenda.ver', 'atendimentos.ver'])
    await screen.findByRole('table')

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Paciente Fictício/ }))

    // ASSERT — o PAINEL (dialog dispensável), não o formulário (alertdialog)
    const painel = await screen.findByRole('dialog')
    expect(within(painel).getByText('Detalhes do agendamento')).toBeInTheDocument()
    // sem `agenda.editar`: nenhuma ação de edição
    expect(within(painel).queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument()
    expect(within(painel).queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument()

    // ...e a SAÍDA FUNCIONA (ler é dispensável)
    const fechar = within(painel).getByRole('button', { name: 'Fechar' })
    expect(fechar).toBeEnabled()
    await usuario.click(fechar)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('deve abrir o card de leitura do bloqueio pela faixa ACESSÍVEL (não um div inerte)', async () => {
    // ARRANGE — a faixa de bloqueio é um botão nomeado pelo rótulo
    const usuario = userEvent.setup()
    renderizarAgenda(
      [
        cardFicticio({
          tipo: 'bloqueio',
          obs: 'Reunião de equipe',
          paciente: null,
          especialidade: null,
          status: null,
          tratamento_id: null,
          tratamento_saldo: null,
          tratamento_total: null,
          convenio: null,
        }),
      ],
      `?data=${DIA_FICTICIO}`,
      ['agenda.ver'],
    )
    await screen.findByRole('table')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Bloqueio: Reunião de equipe' }))

    // ASSERT — o card enxuto do bloqueio, não o formulário
    const painel = await screen.findByRole('dialog')
    expect(within(painel).getByText('Detalhes do bloqueio')).toBeInTheDocument()
    expect(within(painel).getByText('Reunião de equipe')).toBeInTheDocument()
  })

  it('deve abrir o card de bloqueio pelo TECLADO (a faixa é operável por Enter)', async () => {
    // ARRANGE — botão nativo: quem navega por teclado alcança e aciona a faixa
    const usuario = userEvent.setup()
    renderizarAgenda(
      [
        cardFicticio({
          tipo: 'bloqueio',
          obs: 'Reunião de equipe',
          paciente: null,
          especialidade: null,
          status: null,
          tratamento_id: null,
          tratamento_saldo: null,
          tratamento_total: null,
          convenio: null,
        }),
      ],
      `?data=${DIA_FICTICIO}`,
      ['agenda.ver'],
    )
    await screen.findByRole('table')

    // ACT — foco na faixa e Enter (sem mouse)
    const faixa = screen.getByRole('button', { name: 'Bloqueio: Reunião de equipe' })
    faixa.focus()
    expect(faixa).toHaveFocus()
    await usuario.keyboard('{Enter}')

    // ASSERT — o card de leitura abre igual ao clique
    const painel = await screen.findByRole('dialog')
    expect(within(painel).getByText('Detalhes do bloqueio')).toBeInTheDocument()
  })

  it('deve, pelo painel, levar à EDIÇÃO quem pode editar (a edição é destino)', async () => {
    // ARRANGE — a leitura é a porta; editar é destino, alcançado por "Mais ações → Editar"
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}`, ['agenda.ver', 'agenda.editar'])
    await screen.findByRole('table')

    // ACT — clique abre a leitura...
    await usuario.click(screen.getByRole('button', { name: 'Paciente Fictício' }))
    const painel = await screen.findByRole('dialog')
    // ...e "Mais ações → Editar" abre o formulário
    await usuario.click(within(painel).getByRole('button', { name: 'Mais ações' }))
    await usuario.click(await screen.findByRole('menuitem', { name: 'Editar' }))

    // ASSERT — o formulário (alertdialog) de edição
    const formulario = await screen.findByRole('alertdialog')
    expect(within(formulario).getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
    expect(within(formulario).getByRole('textbox', { name: /Observação/i })).toBeEnabled()
  })
})

describe('Agenda — Visão Geral em escala (§16)', () => {
  /**
   * O bug de 2026-07-18: com 8+ profissionais a página inteira ganhava scroll
   * horizontal fantasma, o trilho da fila flutuava no meio da tela e as colunas
   * apareciam cortadas. O jsdom não mede layout — o que se prova aqui é o
   * CONTRATO de contenção (posicionado + rolagem própria + largura mínima);
   * a medida ao vivo (20 profissionais, página em 1440px sem scroll) fica com o
   * passe Playwright registrado na change.
   */
  function renderizarEmEscala(quantos = 20) {
    const profissionais = Array.from({ length: quantos }, (_, indice) => ({
      id: indice + 1,
      nome: `Profissional Fictício ${String(indice + 1).padStart(2, '0')}`,
      horarios: {},
      obs: null,
      especialidades: [{ id: 1, nome: 'Fonoaudiologia' }],
    }))
    servidor.use(
      // o override vem ANTES dos handlers da lista: no MSW, ganha o primeiro que casar
      msw.get('/api/agenda/selecao', () => HttpResponse.json({ ...SELECAO_FICTICIA, profissionais })),
      ...handlersDaAgenda([cardFicticio()]),
    )
    useAuthStore.setState({
      usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'] },
      carregandoSessao: false,
    })

    return render(
      <QueryClientProvider client={queryClient}>
        <ProvedorToast>
          <MemoryRouter initialEntries={[`/agenda?data=${DIA_FICTICIO}&visao=geral`]}>
            <PaginaAgenda />
          </MemoryRouter>
        </ProvedorToast>
      </QueryClientProvider>,
    )
  }

  it('deve conter a rolagem do excedente DENTRO da grade (contêiner posicionado)', async () => {
    // ARRANGE + ACT: 20 profissionais — o piso do §16
    renderizarEmEscala()
    const tabela = await screen.findByRole('table')

    // ASSERT: o contêiner imediato da tabela rola por dentro e é posicionado —
    // sem o `relative`, o Chromium empurrava o excedente para o scroll da PÁGINA
    const wrapper = tabela.parentElement as HTMLElement
    expect(wrapper.className).toContain('overflow-auto')
    expect(wrapper.className).toContain('relative')
  })

  it('deve dar largura mínima e title a cada cabeçalho de profissional', async () => {
    // ARRANGE + ACT
    renderizarEmEscala()
    await screen.findByRole('table')
    const cabecalhos = screen
      .getAllByRole('columnheader')
      .filter((cabecalho) => cabecalho.textContent !== 'Horário')

    // ASSERT: 20 colunas, nenhuma sem piso de largura; nome truncado ganha title
    expect(cabecalhos).toHaveLength(20)
    for (const cabecalho of cabecalhos) {
      expect(cabecalho.className).toContain('min-w-48')
      const rotulo = cabecalho.querySelector('span[title]')
      expect(rotulo).not.toBeNull()
      expect(rotulo?.getAttribute('title')).toBe(rotulo?.textContent)
    }
  })

  it('deve manter o canto "Horário" um degrau acima dos cabeçalhos que o cruzam', async () => {
    // ARRANGE + ACT
    renderizarEmEscala()
    await screen.findByRole('table')

    // ASSERT: mesmo z, quem vem depois no DOM cobriria o canto ao rolar a grade
    const canto = screen.getByRole('columnheader', { name: 'Horário' })
    expect(canto.className).toContain('z-(--z-fixo-canto)')
  })

  it('deve não ter violações axe na visão geral em escala', async () => {
    // ARRANGE + ACT
    const { container } = renderizarEmEscala()
    await screen.findByRole('table')

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  }, 30000)
})

/**
 * A PÁGINA EMPILHA EM TELA ESTREITA (change agenda-no-celular, task 1.7).
 *
 * Achado da conferência ao vivo: consertar o shell devolveu a largura à página e revelou que
 * a página tinha o MESMO defeito um nível abaixo — lista de profissionais, grade e painel da
 * fila num `flex` sem quebra, cada um com largura fixa. Os textos se sobrepunham e sobrava
 * conteúdo fora da tela.
 */
describe('PaginaAgenda — em tela estreita as colunas empilham', () => {
  it('deve pôr a GRADE antes do filtro de profissionais', async () => {
    /*
     * ARRANGE — a lista de profissionais é FILTRO. Empilhada na ordem do DOM, ela obrigaria a
     * recepcionista a rolar vinte nomes para ver o primeiro agendamento do dia.
     */
    fingirTelaEstreita(true)

    // ACT
    const { container } = renderizarAgenda()
    await screen.findByRole('navigation', { name: 'Profissionais' })

    // ASSERT — a grade tem `order-first`; sem isso o filtro vem primeiro aos olhos
    const grade = container.querySelector('.order-first')
    expect(grade).not.toBeNull()
    expect(grade).toContainElement(screen.getByRole('navigation', { name: 'Profissionais' }).parentElement!.querySelector('.min-w-0'))
  })

  it('NÃO deve deixar a lista de profissionais insistir na largura de coluna', async () => {
    /*
     * ARRANGE — empilhar sozinho não resolve: `w-60 shrink-0` estoura a viewport de 390px
     * mesmo empilhado. É por isso que a medição é da LARGURA, e não só da direção do flex.
     */
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda()
    const lista = await screen.findByRole('navigation', { name: 'Profissionais' })

    // ASSERT — largura total em tela estreita, coluna fixa só a partir do breakpoint.
    // O breakpoint da COLUNA subiu de `md` para `xl` (change agenda-no-mouse, achado do gate):
    // a linha de três colunas custa 576px irredutíveis e só cabe a partir de ~892px, então
    // entre 768 e 1280 os painéis também empilham. O que esta célula guarda continua o mesmo —
    // largura fixa nunca em tela estreita —, só o número mudou.
    expect(lista).toHaveClass('w-full')
    expect(lista).toHaveClass('xl:w-60')
  })

  it('deve manter as colunas lado a lado em tela larga', async () => {
    // ARRANGE — o requisito é que ACIMA do breakpoint nada mude
    fingirTelaEstreita(false)

    // ACT
    const { container } = renderizarAgenda()
    await screen.findByRole('navigation', { name: 'Profissionais' })

    // ASSERT — a direção da linha volta pelo breakpoint, não por JS.
    // `xl` e não `md`: ver a célula acima. Em tela larga de verdade (>=1280) as três colunas
    // ficam lado a lado; entre 768 e 1280 elas empilham porque não cabem.
    const linha = container.querySelector('.xl\\:flex-row')
    expect(linha).not.toBeNull()
  })
})

/**
 * A SEMANA DEGRADA EM TELA ESTREITA (change agenda-no-celular, bloco 2).
 *
 * São sete colunas de dias, e nenhuma cabe num telefone. Virar a semana em lista seria pior:
 * centenas de itens numa rolagem única.
 */
describe('PaginaAgenda — a Semana degrada para o Dia em tela estreita', () => {
  it('deve mostrar o DIA e avisar que a visão mudou', async () => {
    // ARRANGE
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=semana`)

    // ASSERT — o aviso está na TELA (não é toast: quem chega por link precisa vê-lo)
    expect(await screen.findByText(/A semana não cabe nesta tela/)).toBeInTheDocument()
  })

  it('deve montar a grade de UM DIA, e não as sete colunas da semana', async () => {
    /*
     * ARRANGE — sem esta célula a degradação podia ser só COSMÉTICA: o aviso na tela e sete
     * colunas de dias atrás dele. A mutação que devolvia `visao` (em vez da efetiva) ao
     * `montarGrade` sobrevivia a todo o resto do bloco.
     */
    fingirTelaEstreita(true)

    // ACT
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=semana`)
    await screen.findByText(/A semana não cabe nesta tela/)

    // ASSERT — a primeira coluna é "Horário"; as demais são as da visão
    await waitFor(() => {
      expect(container.querySelector('table')).not.toBeNull()
    })
    const colunas = [...container.querySelectorAll('thead th')].map((c) => c.textContent?.trim())
    expect(colunas.length).toBeLessThanOrEqual(2)
    expect(colunas.join(' ')).not.toMatch(/seg|ter|qua|qui|sex/i)
  })

  it('NÃO deve buscar SETE DIAS para desenhar um', async () => {
    /*
     * ARRANGE — o período da consulta acompanha a visão EFETIVA, não a escolhida. Sem isso a
     * degradação seria só de desenho: o servidor devolveria a semana inteira para a tela
     * mostrar um dia. Num telefone isso é dado móvel gasto à toa, e a mutação que devolvia
     * `visao` ao cálculo do período sobrevivia a todo o resto do bloco.
     */
    fingirTelaEstreita(true)
    let intervalo: { de: string | null; ate: string | null } | null = null

    // ACT — o espião entra DEPOIS do `renderizarAgenda`, que registra os handlers dele: no
    // msw o último registrado vence, e registrar antes deixaria o espião mudo
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=semana`)
    servidor.use(
      msw.get('/api/agenda', ({ request }) => {
        const url = new URL(request.url)
        intervalo = { de: url.searchParams.get('de'), ate: url.searchParams.get('ate') }
        return HttpResponse.json([])
      }),
    )
    await screen.findByText(/A semana não cabe nesta tela/)

    // ASSERT — um dia só, e é o da tela
    await waitFor(() => {
      expect(intervalo).not.toBeNull()
    })
    expect(intervalo).toEqual({ de: DIA_FICTICIO, ate: DIA_FICTICIO })
  })

  it('NÃO deve apagar a escolha do usuário: a aba Semana continua marcada', async () => {
    /*
     * ARRANGE — a degradação é de RENDERIZAÇÃO, não de estado. Trocar a URL faria a escolha
     * evaporar ao girar o aparelho, e quem chegou por link perderia o que o link dizia. E a
     * aba pulando para "Dia" faria parecer que o clique não funcionou.
     */
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=semana`)

    // ASSERT
    const semana = await screen.findByRole('button', { name: 'Semana' })
    expect(semana).toHaveAttribute('aria-pressed', 'true')
  })

  it('NÃO deve avisar nada quando a tela é larga', async () => {
    // ARRANGE — acima do breakpoint a semana cabe, e o aviso seria ruído
    fingirTelaEstreita(false)

    // ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=semana`)

    // ASSERT
    await screen.findByRole('button', { name: 'Semana' })
    expect(screen.queryByText(/A semana não cabe nesta tela/)).not.toBeInTheDocument()
  })

  it('deve manter a visão DIA em grade, sem aviso, em tela estreita', async () => {
    /*
     * ARRANGE — Dia é UM profissional, uma coluna: cabe depois que o shell devolveu a largura.
     * Esta célula é a guarda contra alguém "consertar" o que já funciona.
     */
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=dia`)

    // ASSERT
    await screen.findByRole('button', { name: 'Dia' })
    expect(screen.queryByText(/A semana não cabe nesta tela/)).not.toBeInTheDocument()
  })
})

/**
 * A VISÃO GERAL VIRA LISTA EM TELA ESTREITA (change agenda-no-celular, bloco 3).
 *
 * É a visão que a recepcionista abre no celular — todos os profissionais, o dia de hoje — e a
 * única impossível em colunas: 192px por profissional, quase 4000px com vinte.
 */
describe('PaginaAgenda — a Visão Geral vira lista em tela estreita', () => {
  it('NÃO deve renderizar tabela na Visão Geral', async () => {
    // ARRANGE
    fingirTelaEstreita(true)

    // ACT
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')

    // ASSERT — tabela é o que rola de lado; a lista existe para não rolar
    expect(container.querySelector('table')).toBeNull()
  })

  it('deve identificar o PROFISSIONAL dentro do item', async () => {
    /*
     * ARRANGE — na grade o profissional é o cabeçalho da COLUNA. Na lista não há coluna, e sem
     * ele dois agendamentos no mesmo horário ficariam indistinguíveis.
     */
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')

    /*
     * ASSERT — escopado À LISTA, e não à tela.
     *
     * O nome do profissional também aparece no FILTRO lateral, então `screen.getByText` acha
     * dois e a asserção não distingue "está no item" de "está na tela". Uma célula que
     * passasse assim provaria a existência do filtro, não a da etiqueta.
     */
    const lista = screen.getByRole('region', { name: /^Agenda —/ })
    expect(within(lista).getByText(/Profissional Fictício A/)).toBeInTheDocument()
  })

  it('deve ancorar os agendamentos pelo HORÁRIO', async () => {
    // ARRANGE — o horário é cabeçalho: quem navega por H salta de horário em horário
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)

    // ASSERT
    expect(await screen.findByRole('heading', { name: '08:00' })).toBeInTheDocument()
  })

  it('NÃO deve oferecer arrastar para remarcar em tela estreita', async () => {
    /*
     * ARRANGE — não-objetivo declarado: arrastar é gesto de mouse, e a versão por toque tem
     * risco próprio — arrastar sem querer remarca a criança errada.
     */
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`, [
      'agenda.ver',
      'agenda.editar',
    ])
    await screen.findByText('Paciente Fictício')

    // ASSERT
    expect(screen.queryByRole('button', { name: /Remarcar .* para outro horário/ })).not.toBeInTheDocument()
  })

  it('deve dizer o que fazer quando o dia está VAZIO', async () => {
    /*
     * ARRANGE — é o estado que a recepcionista mais vê ao abrir um dia sem agendamento, e o
     * que a lista NÃO pode fazer é sumir: sem cards ela não renderiza nada, e a tela ficaria
     * em branco sem dizer se está vazia ou quebrada.
     */
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda([], `?data=${DIA_FICTICIO}&visao=geral`)

    // ASSERT
    expect(await screen.findByText(/Nenhum agendamento neste período/)).toBeInTheDocument()
  })

  /*
   * As duas árvores do axe em células SEPARADAS, e não uma com `unmount` no meio.
   *
   * A primeira versão renderizava as duas na mesma célula, e a segunda vinha com o card da
   * primeira: o `queryClient` é singleton e só o `beforeEach` o limpa. O teste falhava
   * procurando o estado vazio numa tela que tinha um agendamento — falha pelo motivo errado.
   */
  it('deve dar ao alvo de toque o piso de 24px (2.5.8)', async () => {
    /*
     * ARRANGE — num telefone o ponteiro é o DEDO, e 2.5.8 pede 24×24. O card da grade se dá
     * ao luxo de um alvo menor porque lá o ponteiro é o mouse.
     *
     * A asserção é da CLASSE, não do tamanho medido: o jsdom não calcula layout, então nem o
     * `axe` nem `getBoundingClientRect` sabem quanto o botão mede aqui — a mutação que apaga
     * `min-h-6` sobrevivia a tudo. A medição de verdade é o passe ao vivo (task 5.3); esta
     * célula garante que a classe não some numa refatoração.
     */
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    // a lista só existe depois que os catálogos e a agenda chegam — sem o await, a região
    // ainda não está montada e a célula falha pelo motivo errado
    await screen.findByText('Paciente Fictício')
    const lista = screen.getByRole('region', { name: /^Agenda —/ })

    // ASSERT
    expect(within(lista).getByRole('button', { name: 'Paciente Fictício' })).toHaveClass('min-h-6')
  })

  /**
   * OS CONTROLES DE COLUNA (change agenda-no-mouse, D2).
   *
   * O jsdom não calcula layout: `clientWidth`/`scrollWidth` são sempre 0, e por isso a grade
   * "nunca transborda" aqui. Para exercitar o comportamento de verdade, o teste FINGE a
   * medida no nó — é o mesmo que a base já faz com `matchMedia` em `fingirTelaEstreita`.
   */
  function fingirTransbordo(no: HTMLElement, { visivel = 800, total = 6000, coluna = 192 } = {}) {
    Object.defineProperty(no, 'clientWidth', { value: visivel, configurable: true })
    Object.defineProperty(no, 'scrollWidth', { value: total, configurable: true })
    // a largura da COLUNA é o que define o passo; o jsdom devolve 0 em qualquer medida
    for (const cabecalho of no.querySelectorAll('thead th')) {
      cabecalho.getBoundingClientRect = () => ({ width: coluna }) as DOMRect
    }
    no.dispatchEvent(new Event('scroll'))
  }

  it('NÃO deve oferecer controles de coluna quando tudo cabe na tela', async () => {
    // ARRANGE / ACT — sem transbordo, não há o que rolar: botão que não leva a lugar nenhum
    fingirTelaEstreita(false)
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Próximas colunas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Colunas anteriores' })).not.toBeInTheDocument()
  })

  it('deve andar DUAS COLUNAS por acionamento, sem gesto nenhum', async () => {
    /*
     * ARRANGE — o alcance às colunas fora da vista não pode depender de gesto horizontal
     * (trackpad) nem de atalho não descoberto (Shift+roda): a recepção usa Windows com mouse.
     *
     * O passo é de DUAS COLUNAS, medido do cabeçalho no DOM. Começou como uma TELA inteira
     * (~4 colunas) e o usuário reviu depois de usar: o salto grande tira tudo da vista de uma
     * vez e achar de novo onde se estava custa mais do que o clique economiza.
     */
    fingirTelaEstreita(false)
    const usuario = userEvent.setup()
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')
    const grade = container.querySelector('[data-grade-agenda]') as HTMLElement
    const rolagens: Array<{ left?: number }> = []
    grade.scrollBy = (opcoes) => {
      rolagens.push(opcoes as { left?: number })
    }
    fingirTransbordo(grade)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: 'Próximas colunas' }))

    // ASSERT — 2 × a largura da COLUNA lida do DOM, não uma constante copiada do Tailwind
    expect(rolagens).toEqual([{ left: 384, behavior: 'auto' }])
  })

  it('deve deixar o controle INERTE no extremo em que não há mais colunas', async () => {
    // ARRANGE — no começo não há nada à esquerda; o botão fica focável, mas sem ação
    fingirTelaEstreita(false)
    const usuario = userEvent.setup()
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')
    const grade = container.querySelector('[data-grade-agenda]') as HTMLElement
    const rolagens: unknown[] = []
    grade.scrollBy = (opcoes) => {
      rolagens.push(opcoes)
    }
    fingirTransbordo(grade)

    // ACT
    const anterior = await screen.findByRole('button', { name: 'Colunas anteriores' })
    await usuario.click(anterior)

    // ASSERT — anunciado inerte E inerte de fato: `aria-disabled` sozinho não impede o clique
    expect(anterior).toHaveAttribute('aria-disabled', 'true')
    expect(rolagens).toEqual([])
  })

  it('deve tornar a grade uma região FOCÁVEL pelo teclado', async () => {
    /*
     * ARRANGE — padrão APG para região rolável (WCAG 2.1.1). Sem `tabIndex`, alcançar a coluna
     * 24 pelo teclado exigia tabular por todos os cards do caminho; com o foco na região, as
     * setas rolam nativamente nos dois eixos.
     */
    fingirTelaEstreita(false)
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')

    // ASSERT
    const grade = container.querySelector('[data-grade-agenda]') as HTMLElement
    expect(grade.tabIndex).toBe(0)
    expect(grade).toHaveAttribute('role', 'region')
    expect(grade).toHaveAccessibleName(/^Agenda —/)
  })

  it('NÃO deve centrar os controles de coluna por translate — o active engole o clique', async () => {
    /*
     * ARRANGE — lição que esta casa já tinha pago no controle de recolher do shell, e que eu
     * repeti: `active:translate-y-px` da base do `Botao` escreve a MESMA variável de translate
     * que `-translate-y-1/2` e VENCE no clique (especificidade 0,2,0 contra 0,1,0).
     *
     * Medido no navegador com o defeito presente: o botão descia **17px** no `mousedown` —
     * mais da metade dos seus 32px de altura. O `mouseup` caía fora e o clique era engolido:
     * o controle só respondia se o usuário mirasse a borda de cima. Foi assim que o usuário
     * o descreveu: "só funciona clicando em um lugar específico".
     *
     * A centralização correta é por `top`, que o `active` não toca.
     */
    fingirTelaEstreita(false)
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')
    fingirTransbordo(container.querySelector('[data-grade-agenda]') as HTMLElement)

    // ACT
    const controles = [
      await screen.findByRole('button', { name: 'Próximas colunas' }),
      await screen.findByRole('button', { name: 'Colunas anteriores' }),
    ]

    // ASSERT
    for (const controle of controles) {
      expect(controle.className).not.toMatch(/(^|\s)-?translate-y-/)
      expect(controle.className).toContain('top-[calc(50%-1rem)]')
      /*
       * E NENHUM alvo ampliado por `after`. A 1ª entrega tinha `after:-inset-2` (48×48
       * invisível) e o gate mostrou o preço: no Windows cobria 48px do trilho da barra de
       * rolagem VERTICAL — a barra que esta change existe para tornar alcançável — e engolia
       * o clique dos cards vizinhos, fazendo a grade pular colunas quando a recepção queria
       * abrir um agendamento.
       *
       * O precedente da casa cresce só para o VAZIO (`after:left-0 after:-right-2`); aqui não
       * há vazio de lado nenhum. 32×32 já passa o piso de 24×24 de 2.5.8.
       */
      expect(controle.className).not.toMatch(/after:-?inset/)
    }
  })

  it('deve dar à grade um TETO de altura própria, para a roda não morrer quando a página rola', async () => {
    /*
     * ARRANGE — abaixo do `xl` os painéis empilham e a PÁGINA volta a rolar; é a única forma de
     * a linha caber (ela custa 576px irredutíveis contra 452 disponíveis em 768). Mas isso
     * recria a combinação que causa a zona morta: contêiner rolando em X dentro de página
     * rolando em Y. O que impede é a grade ter teto próprio, e portanto folga em Y.
     *
     * A guarda é de CLASSE porque o jsdom não calcula layout — limite declarado, como na guarda
     * da cadeia. O que ela protege é a decisão, que é onde o defeito nasce.
     */
    fingirTelaEstreita(false)
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')

    // ACT
    const grade = container.querySelector('[data-grade-agenda]') as HTMLElement

    // ASSERT — teto abaixo do xl, e a partir dele quem manda é a cadeia de flex
    expect(grade.className).toContain('max-h-[calc(100dvh-var(--moldura-do-shell))]')
    expect(grade.className).toContain('xl:max-h-none')
    expect(grade.className).toContain('xl:flex-1')
  })

  it('deve manter as TRÊS colunas com rolagem própria — a cauda era da lista de espera', async () => {
    /*
     * ARRANGE — a guarda da cadeia acima protege a GRADE. Mas a cauda de 8290px que a D4
     * existe para matar era da LISTA DE ESPERA: 60 entradas esticando o documento enquanto as
     * outras duas colunas terminavam cedo. Apagar o `md:overflow-y-auto` de lá trazia a cauda
     * de volta com a suíte inteira verde — achado do gate.
     *
     * O que se assere aqui é a REPARTIÇÃO: cada coluna limita a própria altura, e quem rola é
     * o corpo — não a raiz, senão o cabeçalho (com o contador e o botão de recolher) sai da
     * vista junto.
     */
    fingirTelaEstreita(false)
    // `lista_espera.ver` é obrigatório: sem ele não há painel, nem trilho, nem cauda
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`, [
      'agenda.ver',
      'lista_espera.ver',
    ])
    await screen.findByText('Paciente Fictício')

    // ACT
    const listaDeProfissionais = container.querySelector('nav[aria-label="Profissionais"]')
    const rolaNaLista = listaDeProfissionais?.querySelector('ul')
    const fila = container.querySelector('#corpo-lista-espera')

    // ASSERT — as três limitam altura; as laterais rolam no CORPO, não na raiz
    expect(listaDeProfissionais?.className).toContain('xl:min-h-0')
    expect(listaDeProfissionais?.className).not.toContain('xl:overflow-y-auto')
    expect(rolaNaLista?.className).toContain('xl:overflow-y-auto')
    expect(fila?.className).toContain('xl:overflow-y-auto')
    // e a fila é focável, porque seus itens são texto puro (2.1.1)
    expect(fila?.getAttribute('tabindex')).toBe('0')
  })

  it('deve passar no axe com os CONTROLES DE COLUNA visíveis', async () => {
    /*
     * ARRANGE — a célula de `axe` da grade exercita o estado SEM transbordo, onde os botões
     * nem existem. Este é o estado novo: região focável + dois controles, um deles inerte.
     *
     * LIMITE, com as causas SEPARADAS (o gate corrigiu minha atribuição preguiçosa):
     * - `color-contrast` não roda porque o `jest-axe` desliga `cat.color` por padrão E o
     *   `vite.config.ts` tem `css: false` — sem CSS não há cor computada. Só navegador fecha.
     * - `target-size` **não roda nem em navegador**: é `enabled: false` na própria definição
     *   da regra no axe-core (opt-in). Dizer "só o passe em navegador fecha" era falso e
     *   induziria alguém a acreditar que uma rodada de axe no Chrome cobre 2.5.8.
     *   Aqui 2.5.8 está cumprido **por construção**: os controles são `h-8 w-8` = 32×32 ≥ 24×24.
     * - `scrollable-region-focusable` — a regra que mapeia o 2.1.1 que o requisito ADDED cita —
     *   fica INAPLICÁVEL: o jsdom devolve `clientHeight`/`scrollHeight` = 0 e o axe não vê
     *   região rolável nenhuma. **Esta célula compra zero de 2.1.1.**
     *
     * Ou seja: ela compra semântica e ARIA do estado novo, e compra de verdade — a mutação que
     * remove o `aria-label` do botão ícone-somente a derruba, e as células vizinhas não veem.
     */
    fingirTelaEstreita(false)
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')
    const grade = container.querySelector('[data-grade-agenda]') as HTMLElement
    fingirTransbordo(grade)
    await screen.findByRole('button', { name: 'Próximas colunas' })

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve manter a CADEIA de altura contida da grade até a raiz da página', async () => {
    /*
     * ARRANGE — a grade só rola por dentro de si se TODOS os elos entre ela e a raiz da página
     * carregarem `min-h-0`. Basta um esquecido: aquele item flex volta a `min-height: auto`,
     * cresce com o conteúdo, e a página volta a ser o scroller — com a roda morrendo sobre a
     * grade, a barra horizontal 950px abaixo da dobra e os cabeçalhos sem grudar.
     *
     * A falha é SILENCIOSA: a tela parece certa até alguém girar a roda.
     *
     * LIMITE DECLARADO: o jsdom não calcula layout, então `scrollHeight`/`clientHeight` são
     * sempre 0 aqui e a guarda de COMPORTAMENTO (a que o design pediria) é impossível em
     * unitário. Esta protege a CADEIA, que é onde o defeito nasce. A prova de que a cadeia
     * produz o efeito é medição em navegador, registrada na tarefa 2.3.
     */
    fingirTelaEstreita(false)
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')

    // ACT — subir da grade até a raiz, juntando os elos que precisam encolher
    const grade = container.querySelector('[data-grade-agenda]')
    expect(grade).not.toBeNull()
    const elos: string[] = []
    for (let no = grade as HTMLElement | null; no !== null && no !== container; no = no.parentElement) {
      elos.push(no.className)
    }

    // ASSERT — a raiz fixa a altura, e todo elo entre ela e a grade pode encolher
    expect(elos.some((classe) => classe.includes('xl:h-[calc(100dvh-var(--moldura-do-shell))]'))).toBe(true)
    expect(elos.filter((classe) => !classe.includes('xl:min-h-0'))).toEqual([])
  })

  it('deve mostrar o horário do AGENDAMENTO, não o do slot', async () => {
    /*
     * ARRANGE — a granularidade da fixture é 60 min, e `grade-agenda` põe o card no slot que o
     * CONTÉM: um encaixe às 08:30 mora no slot das 08:00. Na grade o card imprime a hora real;
     * na lista o único horário era o `h3` do grupo, então 08:30 não aparecia em lugar nenhum e
     * a recepcionista lia "08:00" ao dizer a hora para a família, de pé no balcão.
     *
     * A API não valida a janela na escrita: encaixe fora do passo é criável hoje pela recepção.
     */
    fingirTelaEstreita(true)
    renderizarAgenda(
      [cardFicticio({ inicio: `${DIA_FICTICIO} 08:30`, fim: `${DIA_FICTICIO} 09:10` })],
      `?data=${DIA_FICTICIO}&visao=geral`,
    )
    await screen.findByText('Paciente Fictício')
    const lista = screen.getByRole('region', { name: /^Agenda —/ })

    // ASSERT — o grupo continua ancorado no slot; o ITEM diz a hora de verdade
    expect(within(lista).getByRole('heading', { level: 3, name: '08:00' })).toBeInTheDocument()
    expect(within(lista).getByText('08:30')).toBeInTheDocument()
  })

  it('deve passar no axe com a lista CHEIA', async () => {
    // ARRANGE / ACT
    fingirTelaEstreita(true)
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve passar no axe com o dia VAZIO', async () => {
    // ARRANGE / ACT — outra árvore, e é onde nasce cabeçalho órfão
    fingirTelaEstreita(true)
    const { container } = renderizarAgenda([], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText(/Nenhum agendamento neste período/)

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve MANTER a tabela na Visão Geral em tela larga', async () => {
    // ARRANGE — acima do breakpoint nada muda; é a guarda do requisito 4.1
    fingirTelaEstreita(false)

    // ACT
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findByText('Paciente Fictício')

    // ASSERT
    expect(container.querySelector('table')).not.toBeNull()
  })

  it('deve MANTER a tabela na visão DIA, mesmo em tela estreita', async () => {
    // ARRANGE — um profissional cabe numa coluna; construir lista aí seria trabalho sem defeito
    fingirTelaEstreita(true)

    // ACT
    const { container } = renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=dia`)
    await screen.findByText('Paciente Fictício')

    // ASSERT
    expect(container.querySelector('table')).not.toBeNull()
  })
})

/**
 * O CUSTO DA LISTA no piso da §3 (change agenda-no-celular, task 4.2).
 *
 * O design supôs que a lista teria MENOS nós que a grade — ela não tem célula vazia. Supor
 * não basta: o piso do produto é grade fluida com 20 profissionais × dia inteiro, e a lista
 * é a forma que roda no aparelho mais fraco.
 */
describe('PaginaAgenda — o custo da lista contra o da grade', () => {
  it('NÃO deve custar mais nós de DOM que a grade, com o dia cheio', async () => {
    // ARRANGE — 20 agendamentos, um por profissional fictício, no mesmo dia
    const muitos = Array.from({ length: 20 }, (_, i) =>
      cardFicticio({
        id: i + 1,
        profissional_id: 1,
        inicio: `${DIA_FICTICIO} 08:00`,
        fim: `${DIA_FICTICIO} 08:40`,
      }),
    )

    // ACT — a MESMA carga nas duas formas
    fingirTelaEstreita(false)
    const comGrade = renderizarAgenda(muitos, `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findAllByText('Paciente Fictício')
    const nosDaGrade = comGrade.container.querySelectorAll('*').length
    comGrade.unmount()

    fingirTelaEstreita(true)
    const comLista = renderizarAgenda(muitos, `?data=${DIA_FICTICIO}&visao=geral`)
    await screen.findAllByText('Paciente Fictício')
    const nosDaLista = comLista.container.querySelectorAll('*').length

    // ASSERT — a expectativa do design, agora medida
    expect(nosDaLista).toBeLessThanOrEqual(nosDaGrade)
  })
})

/**
 * O REALCE DE FIM DE PACOTE NO CARD (change alerta-de-fim-de-pacote, blocos 1 e 2).
 */
describe('Agenda — o card realça o fim do pacote, e a COR diz qual dos dois fatos é', () => {
  it('deve pintar de ÂMBAR quando ainda há sessões — "cobre a família"', async () => {
    /*
     * ARRANGE — saldo 2 de 10: dá para atender, e é hora de oferecer o próximo pacote.
     * O card pintava isto de VERMELHO, o mesmo tom de "não pode atender", enquanto a lista de
     * tratamentos já separava os dois. Uma tela ensinava o contrário da outra.
     */
    renderizarAgenda([cardFicticio({ tratamento_total: 10, tratamento_saldo: 2, tratamento_realce: 'acabando' })])
    await screen.findByText('Paciente Fictício')

    // ASSERT — card INTEIRO em âmbar (não o fio de 1px que o usuário recusou), e o texto
    // acompanha: cor nunca é canal único (1.4.1)
    const card = screen.getByText('Paciente Fictício').closest('article')
    expect(card).toHaveClass('bg-alerta-suave')
    expect(card).toHaveClass('border-alerta-texto')
    expect(card).not.toHaveClass('bg-perigo-suave')
    const aviso = screen.getByText(/Faltam 2 sessões no tratamento/)
    // o texto acompanha a cor do CARD — se ficasse fixo em vermelho, o card âmbar teria
    // dentro de si o tom do outro fato (mutação que sobreviveu à primeira rodada)
    expect(aviso).toHaveClass('text-alerta-texto')
    expect(aviso).not.toHaveClass('text-perigo-texto')
    // o ÍCONE é o terceiro canal, e a spec o exige — sem esta linha, apagar o
    // `TriangleAlert` num aperto de layout passaria com a suíte verde
    expect(aviso.querySelector('svg')).not.toBeNull()
  })

  it('deve pintar de VERMELHO quando o saldo acabou — "não pode atender"', async () => {
    // ARRANGE / ACT — saldo 0: outro fato, outra cor
    renderizarAgenda([cardFicticio({ tratamento_total: 10, tratamento_saldo: 0, tratamento_realce: 'sem-saldo' })])
    await screen.findByText('Paciente Fictício')

    // ASSERT
    const card = screen.getByText('Paciente Fictício').closest('article')
    expect(card).toHaveClass('bg-perigo-suave')
    expect(card).toHaveClass('border-perigo-texto')
    expect(card).not.toHaveClass('bg-alerta-suave')
    const aviso = screen.getByText(/Tratamento sem saldo de sessões/)
    expect(aviso).toHaveClass('text-perigo-texto')
    expect(aviso.querySelector('svg')).not.toBeNull()
  })

  it('NÃO deve usar o vermelho SÓLIDO, que tornaria o conteúdo ilegível', async () => {
    /*
     * ARRANGE — `bg-perigo` é o bloco sólido que o DS reserva ao botão destrutivo. Sobre ele o
     * nome do paciente dá 2,74:1, os metadados 1,14:1 e o aviso 1,38:1 — todos abaixo do piso
     * 4,5 de 1.4.3. Só branco passaria, e virar tudo branco incluiria o CHIP DE STATUS, cuja
     * cor vem do banco da clínica.
     */
    renderizarAgenda([cardFicticio({ tratamento_total: 10, tratamento_saldo: 0, tratamento_realce: 'sem-saldo' })])
    await screen.findByText('Paciente Fictício')

    // ASSERT — `toHaveClass` compara TOKEN de classe, não substring: `bg-perigo-suave` não é
    // `bg-perigo`. (Um `/\bbg-perigo\b/` casaria com o suave — `-` é fronteira de palavra.)
    const card = screen.getByText('Paciente Fictício').closest('article')
    expect(card).not.toHaveClass('bg-perigo')
    expect(card).not.toHaveClass('bg-perigo-intenso')
  })

  it('NÃO deve realçar quando o servidor disse que não há realce', async () => {
    /*
     * ARRANGE — o RECORTE (sessão única, pacote parado, saldo acima do limiar da clínica) é
     * decidido no servidor e chega como `nenhum`. A tela não refaz a conta; o que ela não pode
     * é ignorar o veredito e realçar assim mesmo.
     */
    renderizarAgenda([cardFicticio({ tratamento_total: 1, tratamento_saldo: 1, tratamento_realce: 'nenhum' })])
    await screen.findByText('Paciente Fictício')

    // ASSERT — nem âmbar, nem vermelho
    const card = screen.getByText('Paciente Fictício').closest('article')
    expect(card).not.toHaveClass('bg-alerta-suave')
    expect(card).not.toHaveClass('bg-perigo-suave')
    expect(card?.className).toContain('bg-superficie')
    expect(screen.queryByText(/sessão do tratamento/)).not.toBeInTheDocument()
  })

  it('deve realçar TAMBÉM no celular, com a MESMA escada', async () => {
    /*
     * ARRANGE — a lista de tela estreita mostrava só a linha de aviso, e o item ficava com a
     * mesma cara dos demais. Alerta que existe no desktop e não no telefone é alerta que ela
     * não vê — e o telefone é onde a recepção confere o dia, de pé.
     */
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda(
      [cardFicticio({ tratamento_total: 10, tratamento_saldo: 2, tratamento_realce: 'acabando' })],
      `?data=${DIA_FICTICIO}&visao=geral`,
    )
    await screen.findByText('Paciente Fictício')

    // ASSERT — âmbar aqui também: card e lista não podem contar histórias diferentes
    const item = screen.getByText('Paciente Fictício').closest('li')
    expect(item).toHaveClass('bg-alerta-suave')
    expect(item).toHaveClass('border-alerta-texto')
  })

  it('NÃO deve realçar no celular quando não há pacote no fim', async () => {
    // ARRANGE — o par do cenário acima: sem ele, "realça sempre" também passaria
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda(
      [cardFicticio({ tratamento_total: 10, tratamento_saldo: 7, tratamento_realce: 'nenhum' })],
      `?data=${DIA_FICTICIO}&visao=geral`,
    )
    await screen.findByText('Paciente Fictício')

    // ASSERT
    const item = screen.getByText('Paciente Fictício').closest('li')
    expect(item).not.toHaveClass('bg-alerta-suave')
    expect(item?.className).toContain('bg-superficie')
  })

  it('NÃO deve tingir BLOQUEIO na lista, que não tem ícone nem texto para explicar', async () => {
    /*
     * ARRANGE — o item da lista era pintado ANTES de saber se era bloqueio, mas o aviso em
     * texto só renderiza para agendamento: um bloqueio tingido ficaria colorido SEM ícone e
     * SEM texto, que é cor como canal único (1.4.1). Na grade é impossível — o bloqueio sai
     * antes. Aqui não era, e foi o `a11y-auditor` quem pegou.
     *
     * O `Request` barra `tratamento_id` em bloqueio, mas a importação da virada escreve fora
     * dele — não é cenário impossível, é cenário sem porteiro.
     */
    fingirTelaEstreita(true)

    // ACT
    renderizarAgenda(
      [
        cardFicticio({
          tipo: 'bloqueio',
          obs: 'Reunião fictícia',
          tratamento_total: 10,
          tratamento_saldo: 1,
          tratamento_realce: 'acabando',
        }),
      ],
      `?data=${DIA_FICTICIO}&visao=geral`,
    )
    await screen.findByText('Reunião fictícia')

    // ASSERT
    const item = screen.getByText('Reunião fictícia').closest('li')
    expect(item).not.toHaveClass('bg-alerta-suave')
    expect(item).not.toHaveClass('bg-perigo-suave')
    expect(item?.className).toContain('bg-superficie')
  })
})

describe('Agenda — a barra de comando tem hierarquia visível (agenda-com-presenca)', () => {
  it('deve dar moldura a "Hoje" e a cor de perigo a "Desmarcar agenda", sem mudar os nomes', async () => {
    // ARRANGE + ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&profissional=1`, ['agenda.ver', 'agenda.editar'])
    await screen.findByText('Paciente Fictício')

    // ASSERT: os nomes acessíveis são os do manual; a pele é de botão, não de rótulo
    const hoje = screen.getByRole('button', { name: 'Hoje' })
    expect(hoje).toHaveClass('border')
    const desmarcar = screen.getByRole('button', { name: 'Desmarcar agenda' })
    expect(desmarcar).toHaveClass('text-perigo-texto')
    expect(desmarcar).not.toHaveClass('bg-perigo')
    // a célula com "Desmarcar agenda" nunca entrava no axe da suíte (a11y-auditor ACP-06)
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('deve pintar só a visão ativa com o acento, e anunciá-la por aria-pressed', async () => {
    // ARRANGE + ACT
    renderizarAgenda([], `?data=${DIA_FICTICIO}&visao=semana`)
    await screen.findByRole('group', { name: 'Visão da agenda' })

    // ASSERT
    const semana = screen.getByRole('button', { name: 'Semana', pressed: true })
    expect(semana).toHaveClass('bg-segmento-ativo')
    expect(screen.getByRole('button', { name: 'Dia', pressed: false })).not.toHaveClass('bg-segmento-ativo')
  })

  it('deve escrever o dia em palavras sob o título', async () => {
    // ARRANGE + ACT
    renderizarAgenda([], `?data=${DIA_FICTICIO}`)
    await screen.findByRole('group', { name: 'Visão da agenda' })

    // ASSERT: o mesmo texto que a função canônica produz — com o dia da semana
    expect(screen.getByText(periodoEmPalavras(DIA_FICTICIO) as string)).toBeInTheDocument()
    expect(periodoEmPalavras(DIA_FICTICIO)).toMatch(/-feira, |^sábado, |^domingo, /)
  })

  it('deve escrever a semana como intervalo sob o título', async () => {
    // ARRANGE + ACT
    renderizarAgenda([], `?data=${DIA_FICTICIO}&visao=semana`)
    await screen.findByRole('group', { name: 'Visão da agenda' })

    // ASSERT: intervalo (com ou sem o mês na primeira ponta), nunca um dia só
    await waitFor(() => {
      expect(screen.getByText(/^\d+ (de [a-zç]+ )?a \d+ de [a-zç]+ de \d{4}$/)).toBeInTheDocument()
    })
  })

  it('deve recuar para hoje também no período em palavras quando a data da URL é lixo', async () => {
    // ARRANGE + ACT
    renderizarAgenda([], '?data=banana')
    await screen.findByRole('group', { name: 'Visão da agenda' })

    // ASSERT
    const hoje = hojeNaClinica(TIMEZONE_PADRAO)
    expect(screen.getByText(periodoEmPalavras(hoje) as string)).toBeInTheDocument()
    expect(screen.queryByText(/banana/)).not.toBeInTheDocument()
  })
})

describe('Agenda — o gesto "Dar baixa" na barra (baixa-em-lote-por-status)', () => {
  it('deve mostrar "Dar baixa" com moldura, sem a cor de perigo, entre "Hoje" e "Desmarcar agenda"', async () => {
    // ARRANGE + ACT — um profissional na tela, com agenda.editar
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&profissional=1`, ['agenda.ver', 'agenda.editar'])
    await screen.findByText('Paciente Fictício')

    // ASSERT — o nome acessível congelado CONTÉM o texto visível (2.5.3); variante secundária
    const darBaixa = screen.getByRole('button', { name: 'Dar baixa na agenda' })
    expect(darBaixa).toHaveTextContent('Dar baixa')
    expect(darBaixa).toHaveClass('border')
    expect(darBaixa).not.toHaveClass('text-perigo-texto')
    expect(darBaixa).not.toHaveClass('bg-botao-primario')
    const botoes = screen.getAllByRole('button').map((botao) => botao.getAttribute('aria-label') ?? botao.textContent)
    const posicao = (nome: string) => botoes.findIndex((texto) => texto?.includes(nome))
    expect(posicao('Hoje')).toBeLessThan(posicao('Dar baixa na agenda'))
    expect(posicao('Dar baixa na agenda')).toBeLessThan(posicao('Desmarcar agenda'))
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('não deve mostrar "Dar baixa" na visão geral nem sem agenda.editar', async () => {
    // ARRANGE + ACT — visão geral: não há "a agenda dele"
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`, ['agenda.ver', 'agenda.editar'])
    await screen.findByText('Paciente Fictício')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Dar baixa na agenda' })).not.toBeInTheDocument()
  })

  it('não deve mostrar "Dar baixa" para quem só vê a agenda', async () => {
    // ARRANGE + ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&profissional=1`, ['agenda.ver'])
    await screen.findByText('Paciente Fictício')

    // ASSERT
    expect(screen.queryByRole('button', { name: 'Dar baixa na agenda' })).not.toBeInTheDocument()
  })

  it('deve manter o botão sem status aplicável e abrir o diálogo no estado vazio', async () => {
    // ARRANGE — nenhum status marcado como aplicável em lote: o botão NÃO some, o diálogo diz o caminho
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&profissional=1`, ['agenda.ver', 'agenda.editar'])
    servidor.use(
      msw.get('/api/agenda/selecao', () =>
        HttpResponse.json({
          ...SELECAO_FICTICIA,
          status: SELECAO_FICTICIA.status.map((item) => ({ ...item, aplicavel_em_lote: false })),
        }),
      ),
    )
    await screen.findByText('Paciente Fictício')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Dar baixa na agenda' }))

    // ASSERT
    expect(await screen.findByRole('dialog', { name: 'Dar baixa na agenda de Profissional Fictício A' })).toBeInTheDocument()
    expect(screen.getByText(/Nenhum status está marcado como aplicável em lote/)).toBeInTheDocument()
  })

  it('deve abrir o diálogo montado só ao clicar, com a prévia do dia à vista, e fechar de volta ao botão', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let corpoDaPrevia: Record<string, unknown> | null = null
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&profissional=1`, ['agenda.ver', 'agenda.editar'])
    servidor.use(
      msw.post('/api/agendamentos/baixa-em-lote/previa', async ({ request }) => {
        corpoDaPrevia = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          status: { id: 3, nome: 'Finalizado', desconta_sessao: true, marca_falta: false },
          contagens: { agendamentos: 1, criancas: 1, sessoes_a_descontar: 1, sem_pacote: 0, ja_consumidas: 0, com_atendimento_registrado: 0 },
          recusados: [],
          avisos: { evolucoes_vencidas: 0 },
          assinatura: 'a'.repeat(64),
          referencia: `${DIA_FICTICIO} 18:59`,
        })
      }),
    )
    await screen.findByText('Paciente Fictício')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // ACT
    const gatilho = screen.getByRole('button', { name: 'Dar baixa na agenda' })
    await usuario.click(gatilho)
    expect(await screen.findByRole('button', { name: 'Aplicar “Finalizado” em 1' })).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))

    // ASSERT — a prévia foi do profissional da grade, no dia à vista; o foco voltou ao botão
    expect(corpoDaPrevia).toEqual({ profissional_id: 1, status_id: 3, de: DIA_FICTICIO, ate: DIA_FICTICIO })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(gatilho).toHaveFocus()
    })
  })

  it('deve levar o foco ao gatilho do card ao acionar "Ver na agenda" num recusado do MESMO dia', async () => {
    // ARRANGE — o recusado é o card à vista; o Radix devolve o foco num setTimeout(0) no desmonte,
    // e o destino explícito do diálogo é o que vence essa corrida (achado da conferência ao vivo)
    const usuario = userEvent.setup()
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&profissional=1`, ['agenda.ver', 'agenda.editar'])
    servidor.use(
      msw.post('/api/agendamentos/baixa-em-lote/previa', () =>
        HttpResponse.json({
          status: { id: 3, nome: 'Finalizado', desconta_sessao: true, marca_falta: false },
          contagens: { agendamentos: 0, criancas: 0, sessoes_a_descontar: 0, sem_pacote: 0, ja_consumidas: 0, com_atendimento_registrado: 0 },
          recusados: [{ id: 1, inicio: `${DIA_FICTICIO} 08:00`, motivo: 'sem_saldo' }],
          avisos: { evolucoes_vencidas: 0 },
          assinatura: 'a'.repeat(64),
          referencia: `${DIA_FICTICIO} 18:59`,
        }),
      ),
    )
    await screen.findByText('Paciente Fictício')
    const botaoDaBarra = screen.getByRole('button', { name: 'Dar baixa na agenda' })
    await usuario.click(botaoDaBarra)

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /^Ver o agendamento de .* na agenda$/ }))

    // ASSERT — o diálogo fechou e o foco pousou no gatilho do card, não no botão da barra
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(document.querySelector('[data-card-id="1"]')).toContainElement(document.activeElement as HTMLElement)
    })
    expect(botaoDaBarra).not.toHaveFocus()
  })

  it('deve navegar de data e levar o foco ao card ao acionar "Ver na agenda" num recusado de outro dia', async () => {
    // ARRANGE — o recusado é do dia anterior; o card dele existe naquele dia
    const usuario = userEvent.setup()
    const ontem = `${DIA_FICTICIO.slice(0, 8)}${String(Number(DIA_FICTICIO.slice(8)) - 1).padStart(2, '0')}`
    const cardDeOntem = cardFicticio({ id: 77, inicio: `${ontem} 09:00`, fim: `${ontem} 09:40` })
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&profissional=1`, ['agenda.ver', 'agenda.editar'])
    servidor.use(
      msw.get('/api/agenda', ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get('de') === ontem ? [cardDeOntem] : [cardFicticio()]),
      ),
      msw.post('/api/agendamentos/baixa-em-lote/previa', () =>
        HttpResponse.json({
          status: { id: 3, nome: 'Finalizado', desconta_sessao: true, marca_falta: false },
          contagens: { agendamentos: 1, criancas: 1, sessoes_a_descontar: 1, sem_pacote: 0, ja_consumidas: 0, com_atendimento_registrado: 0 },
          recusados: [{ id: 77, inicio: `${ontem} 09:00`, motivo: 'sem_saldo' }],
          avisos: { evolucoes_vencidas: 0 },
          assinatura: 'a'.repeat(64),
          referencia: `${DIA_FICTICIO} 18:59`,
        }),
      ),
    )
    await screen.findByText('Paciente Fictício')
    await usuario.click(screen.getByRole('button', { name: 'Dar baixa na agenda' }))

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /^Ver o agendamento de .* na agenda$/ }))

    // ASSERT — o diálogo fechou, a agenda foi para ontem e o foco pousou no card
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(await screen.findByText(periodoEmPalavras(ontem) as string)).toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelector('[data-card-id="77"]')).toHaveFocus()
    })
  })
})

describe('Agenda — abre no profissional de quem está logado (agenda-abre-no-profissional-logado)', () => {
  // A lista fictícia é A (id 1) e B (id 2), nessa ordem. O usuário vinculado ao B é o caso do
  // pedido: a agenda caía no primeiro da ordem alfabética, e não no profissional de quem entrou.
  const TODAS = ['agenda.ver']

  /**
   * Captura os pedidos da GRADE (`GET /api/agenda`). O handler padrão ignora o filtro, então só
   * olhar a tela não prova para quem a grade buscou (achado do code review: a Visão Geral podia
   * passar a buscar só o vinculado e as colunas continuariam lá, vazias).
   */
  function capturarPedidosDaGrade(): URL[] {
    const pedidos: URL[] = []
    servidor.use(
      msw.get('/api/agenda', ({ request }) => {
        pedidos.push(new URL(request.url))
        return HttpResponse.json([cardFicticio()])
      }),
    )
    return pedidos
  }

  it('deve abrir o Dia no profissional vinculado ao usuário, e não no primeiro da lista', async () => {
    // ARRANGE + ACT: sem ?profissional na URL
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=dia`, TODAS, 2)
    const pedidos = capturarPedidosDaGrade()
    await screen.findByRole('table')

    // ASSERT: a grade é a do B — no pedido ao servidor e na tela —, e a lista o mostra escolhido
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(0))
    expect(pedidos.every((url) => url.searchParams.get('profissional_id') === '2')).toBe(true)
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício B/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Profissional Fictício A/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Profissional Fictício B/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('deve abrir a Semana no profissional vinculado ao usuário', async () => {
    // ARRANGE + ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=semana`, TODAS, 2)
    const pedidos = capturarPedidosDaGrade()
    await screen.findByRole('table')

    // ASSERT: na Semana as colunas são dias; quem diz de quem é a semana é o pedido e a lista
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(0))
    expect(pedidos.every((url) => url.searchParams.get('profissional_id') === '2')).toBe(true)
    expect(screen.getByRole('button', { name: /Profissional Fictício B/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Profissional Fictício A/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('deve deixar a escolha da URL vencer o profissional do usuário', async () => {
    // ARRANGE + ACT: vinculado ao B, mas o link pede o A
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=dia&profissional=1`, TODAS, 2)
    await screen.findByRole('table')

    // ASSERT
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Profissional Fictício B/ })).not.toBeInTheDocument()
  })

  it('deve abrir no primeiro profissional quando o usuário não tem vínculo', async () => {
    // ARRANGE + ACT: a recepção — sem profissional vinculado, nada muda
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=dia`, TODAS, null)
    await screen.findByRole('table')

    // ASSERT
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Profissional Fictício B/ })).not.toBeInTheDocument()
  })

  it('deve cair no primeiro profissional quando o vinculado não está na lista', async () => {
    // ARRANGE + ACT: vinculado a um profissional inativo ou fora do escopo (fora da lista)
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=dia`, TODAS, 99)
    await screen.findByRole('table')

    // ASSERT: nada de grade vazia nem erro — abre no primeiro, como antes
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Profissional Fictício A/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('deve manter a Visão Geral com todos os profissionais mesmo com vínculo', async () => {
    // ARRANGE + ACT
    renderizarAgenda([cardFicticio()], `?data=${DIA_FICTICIO}&visao=geral`, TODAS, 2)
    const pedidos = capturarPedidosDaGrade()
    await screen.findByRole('table')

    // ASSERT: a grade busca a clínica inteira (sem filtro), e não só o vinculado
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(0))
    expect(pedidos.some((url) => url.searchParams.has('profissional_id'))).toBe(false)
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício A/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Profissional Fictício B/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todos os profissionais' })).toHaveAttribute('aria-pressed', 'true')
  })
})
