import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaConvenios } from '@/paginas/pagina-convenios'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Convenio } from '@/tipos'

const TUDO = ['convenios.ver', 'convenios.criar', 'convenios.editar', 'convenios.excluir']

/** O convênio PARTICULAR: é a flag que decide se o tratamento cai no caixa (§14). */
const PARTICULAR: Convenio = {
  id: 1,
  updated_at: '2026-07-15T10:00:00.000000Z',
  nome: 'Particular',
  registro_ans: null,
  codigo_operadora: null,
  versao_tiss: null,
  guia_sequencial: false,
  alerta_agend_mesmo_dia: false,
  flags_tiss_json: null,
  particular: true,
  pedido_validade_meses: null,
  // sem calendário de ciclo: o fail-safe do D1 — nada é congelado para este convênio
  ciclo_dia_corte: null,
  ciclo_tipo_corte: null,
  ativo: true,
}

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/convenios']}>
          <PaginaConvenios />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Convênios — a fronteira §14', () => {
  it('deve não oferecer nenhuma ação de guia, TISS, faturamento ou glosa', async () => {
    // ARRANGE: este sistema NÃO implementa a esteira de convênio — cruzar a
    // fronteira exige ADR. A tela guarda os dados; quem fatura é o sistema irmão.
    servidor.use(msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Cadastrar convênio/i }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT: nenhum comando de esteira em lugar nenhum da TELA — varrer só o
    // diálogo deixaria passar um botão "Gerar guia" na barra da lista
    for (const proibido of [/gerar guia/i, /enviar/i, /faturar/i, /glosa/i, /exportar/i, /TISS/i]) {
      expect(screen.queryByRole('button', { name: proibido })).not.toBeInTheDocument()
    }
    // e `guia_sequencial` é uma CARACTERÍSTICA do convênio (switch), não um contador
    expect(within(dialog).getByRole('checkbox', { name: /Guia numerada em sequência/i }))
      .toBeInTheDocument()
  })
})

describe('Convênios — a flag que decide o destino do dinheiro', () => {
  it('deve preservar "particular" ao editar qualquer outro campo', async () => {
    // ARRANGE: a tela mandava `particular: false` FIXO. Editar o nome de um convênio
    // particular o transformava em convênio de plano — e o faturamento dele passava a
    // ir para outro lugar. Silencioso, invisível, sem recuperação pela tela.
    let corpoEnviado: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])),
      msw.put('/api/convenios/:id', async ({ request }) => {
        corpoEnviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...PARTICULAR, nome: 'Particular (à vista)' })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT: a edição mais banal que existe — trocar o nome
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const nome = within(dialog).getByRole('textbox', { name: /Nome/i })
    await usuario.clear(nome)
    await usuario.type(nome, 'Particular (à vista)')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: o payload REAL leva a flag como ela é — não um `false` inventado
    await waitFor(() => {
      expect(corpoEnviado).not.toBeNull()
    })
    expect(corpoEnviado).toMatchObject({ nome: 'Particular (à vista)', particular: true })
  })

  it('deve confirmar antes de mudar "particular" — é o destino do dinheiro', async () => {
    // ARRANGE: o `FaturamentoService` relê essa flag a cada lançamento. Um checkbox
    // do mesmo peso visual que "alertar no mesmo dia" não é aviso suficiente.
    servidor.use(msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('checkbox', { name: /Atendimento particular/i }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: a confirmação diz o que a clínica vai VER acontecer
    expect(await screen.findByText(/deixam de ser lançados no caixa/)).toBeInTheDocument()
    expect(screen.getByText(/RECUSAR os próximos lançamentos/)).toBeInTheDocument()
  })

  it('deve NÃO confirmar quando só o nome muda', async () => {
    // ARRANGE: confirmação para tudo é ruído — e ruído faz clicar sem ler
    let salvou = false
    servidor.use(
      msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])),
      msw.put('/api/convenios/:id', () => {
        salvou = true
        return HttpResponse.json({ ...PARTICULAR, nome: 'Particular (à vista)' })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const nome = within(dialog).getByRole('textbox', { name: /Nome/i })
    await usuario.clear(nome)
    await usuario.type(nome, 'Particular (à vista)')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(salvou).toBe(true)
    })
    expect(screen.queryByText(/Mudar a regra de/)).not.toBeInTheDocument()
  })

  it('deve enviar a validade do pedido médico em meses no payload real', async () => {
    // ARRANGE — a validade é DADO por operadora (D4: Unimed 6 · SC Saúde 3); é dela
    // que o servidor deriva o vencimento de cada pedido — a tela nunca calcula
    let corpoEnviado: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])),
      msw.put('/api/convenios/:id', async ({ request }) => {
        corpoEnviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...PARTICULAR, pedido_validade_meses: 6 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(
      within(dialog).getByRole('spinbutton', { name: /Validade do pedido médico/i }),
      '6',
    )
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT — número no payload, nunca string
    await waitFor(() => {
      expect(corpoEnviado).not.toBeNull()
    })
    expect(corpoEnviado).toMatchObject({ pedido_validade_meses: 6 })
  })

  it('deve mandar null quando a validade do pedido fica vazia (sem alarme falso)', async () => {
    // ARRANGE — sem validade, o sistema NÃO deriva vencimento de pedido (delta spec)
    let corpoEnviado: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/convenios', () =>
        HttpResponse.json([{ ...PARTICULAR, pedido_validade_meses: 6 }]),
      ),
      msw.put('/api/convenios/:id', async ({ request }) => {
        corpoEnviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(PARTICULAR)
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT — limpa o campo (o valor 6 veio do registro, nunca inventado)
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const validade = within(dialog).getByRole('spinbutton', { name: /Validade do pedido médico/i })
    expect(validade).toHaveValue(6)
    await usuario.clear(validade)
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(corpoEnviado).not.toBeNull()
    })
    expect(corpoEnviado).toMatchObject({ pedido_validade_meses: null })
  })

  it('deve enviar o calendário do ciclo no payload real (Unimed: dia fixo 15)', async () => {
    // ARRANGE — o corte é DADO por operadora (D1): Unimed fecha no dia 15, e é dele que
    // o servidor deriva o período 16→15. A tela informa o corte; nunca calcula o período.
    let corpoEnviado: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])),
      msw.put('/api/convenios/:id', async ({ request }) => {
        corpoEnviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...PARTICULAR, ciclo_tipo_corte: 'dia_fixo', ciclo_dia_corte: 15 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.selectOptions(
      within(dialog).getByRole('combobox', { name: /Quando fecha/i }),
      'dia_fixo',
    )
    await usuario.type(within(dialog).getByRole('spinbutton', { name: /Dia do corte/i }), '15')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT — número no payload, nunca string
    await waitFor(() => {
      expect(corpoEnviado).not.toBeNull()
    })
    expect(corpoEnviado).toMatchObject({ ciclo_tipo_corte: 'dia_fixo', ciclo_dia_corte: 15 })
  })

  it('deve esconder o dia do corte e mandá-lo null quando o corte é o último dia do mês', async () => {
    // ARRANGE — SC Saúde fecha no último dia. Um "dia do corte" guardado ao lado disso
    // é um número que regra nenhuma lê — e a próxima pessoa acreditaria nele.
    let corpoEnviado: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])),
      msw.put('/api/convenios/:id', async ({ request }) => {
        corpoEnviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...PARTICULAR, ciclo_tipo_corte: 'ultimo_dia' })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT — passa por `dia_fixo` (digitando um dia) e volta para `ultimo_dia`
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const quandoFecha = within(dialog).getByRole('combobox', { name: /Quando fecha/i })
    await usuario.selectOptions(quandoFecha, 'dia_fixo')
    await usuario.type(within(dialog).getByRole('spinbutton', { name: /Dia do corte/i }), '20')
    await usuario.selectOptions(quandoFecha, 'ultimo_dia')

    // ASSERT — o campo some junto com o sentido dele
    expect(
      within(dialog).queryByRole('spinbutton', { name: /Dia do corte/i }),
    ).not.toBeInTheDocument()

    // ACT
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT — o 20 digitado NÃO viaja junto
    await waitFor(() => {
      expect(corpoEnviado).not.toBeNull()
    })
    expect(corpoEnviado).toMatchObject({ ciclo_tipo_corte: 'ultimo_dia', ciclo_dia_corte: null })
  })

  it('deve preservar o calendário do ciclo ao editar qualquer outro campo', async () => {
    // ARRANGE — a lição da `particular`, agora com um campo que CONGELA produção:
    // mandar vazio "porque o campo é novo" apagaria o calendário na edição mais banal
    // que existe — e apagar calendário é destravar produção já enviada (SEC-FC-18).
    let corpoEnviado: Record<string, unknown> | null = null
    const COM_CICLO: Convenio = { ...PARTICULAR, ciclo_tipo_corte: 'dia_fixo', ciclo_dia_corte: 15 }
    servidor.use(
      msw.get('/api/convenios', () => HttpResponse.json([COM_CICLO])),
      msw.put('/api/convenios/:id', async ({ request }) => {
        corpoEnviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(COM_CICLO)
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT — trocar o nome, e nada mais
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    // o formulário hidrata DO REGISTRO: o corte aparece como está gravado
    expect(within(dialog).getByRole('combobox', { name: /Quando fecha/i })).toHaveValue('dia_fixo')
    expect(within(dialog).getByRole('spinbutton', { name: /Dia do corte/i })).toHaveValue(15)
    const nome = within(dialog).getByRole('textbox', { name: /Nome/i })
    await usuario.clear(nome)
    await usuario.type(nome, 'Particular (à vista)')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    await waitFor(() => {
      expect(corpoEnviado).not.toBeNull()
    })
    expect(corpoEnviado).toMatchObject({ ciclo_tipo_corte: 'dia_fixo', ciclo_dia_corte: 15 })
  })

  it('deve fechar o domínio do corte em 1..28 e nas duas opções que o banco aceita', async () => {
    // ARRANGE — SEC-FC-21: com corte 29..31 o clamp de mês curto abriria BURACO no
    // calendário (31/03 não pertenceria a período algum, eternamente editável). O
    // domínio para em 28, e `ultimo_dia` cobre quem fecha no fim do mês.
    servidor.use(msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')
    const quandoFecha = within(dialog).getByRole('combobox', { name: /Quando fecha/i })

    // ASSERT — nada de "quinzena" nem de corte inventado
    expect(within(quandoFecha).getAllByRole('option').map((opcao) => opcao.textContent)).toEqual([
      'Não fecha (sem período)',
      'Dia fixo do mês',
      'Último dia do mês',
    ])

    // ACT
    await usuario.selectOptions(quandoFecha, 'dia_fixo')

    // ASSERT
    const dia = within(dialog).getByRole('spinbutton', { name: /Dia do corte/i })
    expect(dia).toHaveAttribute('min', '1')
    expect(dia).toHaveAttribute('max', '28')
  })

  it('deve explicar, em linguagem de balcão, o que o fechamento faz', async () => {
    // ARRANGE — quem preenche este campo é a secretária, não o desenvolvedor: o texto
    // diz o que ACONTECE (o que congela, o que continua liberado, quem destrava)
    servidor.use(msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('link', { name: 'Particular' })

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))
    const dialog = await screen.findByRole('alertdialog')

    // ASSERT
    expect(dialog).toHaveTextContent(/deixam de aceitar edição/i)
    expect(dialog).toHaveTextContent(/registrar sessão que aconteceu continua liberado/i)
    expect(dialog).toHaveTextContent(/só o administrador reabre/i)
    expect(dialog).toHaveTextContent(/Sem corte configurado, nada muda para este convênio/i)
  })

  it('deve mostrar na lista que o convênio é particular', async () => {
    // ARRANGE: a flag decide o destino do dinheiro — ela não pode ser invisível
    servidor.use(msw.get('/api/convenios', () => HttpResponse.json([PARTICULAR])))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Particular', { selector: 'td' })).toBeInTheDocument()
  })
})
