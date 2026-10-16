import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaStatusAgendamento } from '@/paginas/pagina-status-agendamento'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { StatusAgendamento } from '@/tipos'

const TUDO = [
  'status_agendamento.ver',
  'status_agendamento.criar',
  'status_agendamento.editar',
  'status_agendamento.excluir',
]

function status(sobrescritas: Partial<StatusAgendamento> = {}): StatusAgendamento {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    nome: 'Em Aberto',
    cor: '#64748B',
    cor_borda: null,
    tipo: 'circle-dashed',
    desconta_sessao: false,
    ocupa_horario: true,
    marca_falta: false,
    marca_reserva: false,
    em_aberto: false,
    aplicavel_em_lote: false,
    ordem: 1,
    ...sobrescritas,
  }
}

const LISTA = [
  status(),
  status({ id: 2, nome: 'Consulta', ordem: 9, tipo: 'stethoscope' }),
  status({ id: 3, nome: 'Finalizado', ordem: 3, desconta_sessao: true, tipo: 'check' }),
]

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/status-agendamento']}>
          <PaginaStatusAgendamento />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

/** Abre o formulário de edição de um status pelo nome da linha. */
async function editar(usuario: ReturnType<typeof userEvent.setup>, nome: string) {
  const linha = screen.getByRole('row', { name: new RegExp(nome) })
  await usuario.click(within(linha).getByRole('button', { name: 'Editar' }))
  return screen.findByRole('alertdialog')
}

beforeEach(() => {
  queryClient.clear()
})

describe('Status de agendamento — a ordem é REGRA', () => {
  it('deve avisar que o status de menor ordem é aquele com que o agendamento nasce', async () => {
    // ARRANGE: a `ordem` parece decoração. Quem chega aqui precisa saber ANTES de
    // arrastar números — não pela recusa do servidor.
    servidor.use(msw.get('/api/status-agendamento', () => HttpResponse.json(LISTA)))

    // ACT
    renderizar()
    // "Em Aberto" aparece no aviso E na tabela — a espera é pela LINHA
    const linhaInicial = await screen.findByRole('row', { name: /Em Aberto/ })

    // ASSERT
    expect(screen.getByText(/menor ordem/)).toBeInTheDocument()
    // o selo marca QUEM é o inicial hoje — o de menor ordem
    expect(within(linhaInicial).getByText('inicial')).toBeInTheDocument()
  })

  it('deve mostrar a recusa do servidor no formulário e manter a lista íntegra', async () => {
    // ARRANGE: a guarda do servidor recusa promover um status descontante a inicial.
    // A recepção precisa LER isso onde está olhando — e o status não pode mudar.
    servidor.use(
      msw.get('/api/status-agendamento', () => HttpResponse.json(LISTA)),
      msw.put('/api/status-agendamento/:id', () =>
        HttpResponse.json(
          {
            message: 'Recusado.',
            errors: {
              status_agendamento: [
                'O status "Finalizado" ficaria em primeiro lugar na ordem. Deixe um status sem desconto de sessão na primeira posição.',
              ],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Finalizado')

    // ACT: o ataque — reordenar o descontante para o topo
    const dialog = await editar(usuario, 'Finalizado')
    const ordem = within(dialog).getByRole('spinbutton', { name: /Ordem/i })
    await usuario.clear(ordem)
    await usuario.type(ordem, '0')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: a mensagem aparece NO formulário, e "Em Aberto" continua sendo o inicial
    expect(
      await within(dialog).findByText(/Deixe um status sem desconto de sessão na primeira posição/),
    ).toBeInTheDocument()
    expect(screen.getByText('inicial')).toBeInTheDocument()
  })
})

describe('Status de agendamento — mudar regra pede confirmação que diz a consequência', () => {
  it('deve confirmar ao desligar "ocupa horário", dizendo que o slot aceita outro agendamento', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/status-agendamento', () => HttpResponse.json(LISTA)))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Consulta')

    // ACT
    const dialog = await editar(usuario, 'Consulta')
    await usuario.click(within(dialog).getByRole('checkbox', { name: /Ocupa o horário/i }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: a confirmação fala do que a clínica vai VER acontecer
    const confirmacao = await screen.findByText(/deixam de bloquear o horário/)
    expect(confirmacao).toBeInTheDocument()
    expect(screen.getByText(/marcado de novo, para outro paciente/)).toBeInTheDocument()
  })

  it('deve NÃO pedir confirmação quando só a cor muda', async () => {
    // ARRANGE: confirmação para tudo é ruído — e ruído faz clicar sem ler
    let salvou = false
    servidor.use(
      msw.get('/api/status-agendamento', () => HttpResponse.json(LISTA)),
      msw.put('/api/status-agendamento/:id', () => {
        salvou = true
        return HttpResponse.json(status({ id: 2, nome: 'Consulta', cor: '#A31621' }))
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Consulta')

    // ACT
    const dialog = await editar(usuario, 'Consulta')
    const hex = within(dialog).getByRole('textbox', { name: /código hexadecimal/i })
    await usuario.clear(hex)
    await usuario.type(hex, '#A31621')
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT: salva direto, sem diálogo de regra
    await waitFor(() => {
      expect(salvou).toBe(true)
    })
    expect(screen.queryByText(/Mudar a regra de/)).not.toBeInTheDocument()
  })
})

describe('Status de agendamento — as regras do lote (baixa-em-lote-por-status)', () => {
  it('deve oferecer "Em aberto", "Pode ser aplicado em lote" e "Marca reserva" com a consequência em prosa', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/status-agendamento', () => HttpResponse.json(LISTA)))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Consulta')

    // ACT
    const dialog = await editar(usuario, 'Consulta')

    // ASSERT — os três toggles, com o que a clínica vai VER acontecer
    expect(within(dialog).getByRole('checkbox', { name: 'Em aberto' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Pode ser aplicado em lote' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: 'Marca reserva' })).not.toBeChecked()
    expect(
      within(dialog).getByText('Agendamentos neste status ainda não têm desfecho: são os que entram na baixa em lote da agenda.'),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Aparece como opção no botão Dar baixa da agenda, para toda a agenda em aberto de um profissional de uma vez.',
      ),
    ).toBeInTheDocument()
  })

  it('deve pedir confirmação ao ligar "Em aberto", dizendo que o status entra na baixa em lote', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/status-agendamento', () => HttpResponse.json(LISTA)))
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Consulta')
    const dialog = await editar(usuario, 'Consulta')

    // ACT
    await usuario.click(within(dialog).getByRole('checkbox', { name: 'Em aberto' }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    // ASSERT
    const confirmacao = await screen.findByRole('alertdialog', { name: /Mudar a regra de Consulta/ })
    expect(confirmacao).toHaveTextContent(/entram na baixa em lote da agenda, pelo botão Dar baixa/)
  })

  it('deve mostrar o conflito de flags junto da flag, e manter o status íntegro na lista', async () => {
    // ARRANGE — o servidor recusa `em_aberto` num status que desconta sessão (invariante)
    const MENSAGEM =
      'Um status em aberto não pode descontar sessão, marcar falta, marcar reserva nem liberar o horário — em aberto é o que ainda não teve desfecho.'
    servidor.use(
      msw.get('/api/status-agendamento', () => HttpResponse.json(LISTA)),
      msw.put('/api/status-agendamento/:id', () =>
        HttpResponse.json({ message: 'Recusado.', errors: { em_aberto: [MENSAGEM] } }, { status: 422 }),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Finalizado')
    const dialog = await editar(usuario, 'Finalizado')

    // ACT — liga "Em aberto" no descontante e confirma a regra
    await usuario.click(within(dialog).getByRole('checkbox', { name: 'Em aberto' }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await usuario.click(await screen.findByRole('button', { name: 'Mudar a regra' }))

    // ASSERT — a recusa aparece onde a recepção está olhando (a confirmação, que fica aberta)...
    const confirmacao = await screen.findByRole('alertdialog', { name: /Mudar a regra de Finalizado/ })
    expect(await within(confirmacao).findByText(MENSAGEM)).toBeInTheDocument()
    // ...e, fechada a confirmação, JUNTO da flag em conflito (aria-invalid + mensagem)
    await usuario.click(within(confirmacao).getByRole('button', { name: 'Cancelar' }))
    const caixa = await within(dialog).findByRole('checkbox', { name: 'Em aberto' })
    expect(caixa).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByText(MENSAGEM)).toBeInTheDocument()
    // e "Finalizado" segue como estava na lista (o formulário aberto esconde a tabela do papel
    // de `row`; o texto das regras continua no DOM, sem "em aberto")
    expect(screen.getByText('consome sessão · ocupa horário')).toBeInTheDocument()
    expect(screen.queryByText(/ocupa horário · em aberto/)).not.toBeInTheDocument()
  })

  it('deve enviar as três flags no payload', async () => {
    // ARRANGE
    let corpo: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/status-agendamento', () => HttpResponse.json(LISTA)),
      msw.put('/api/status-agendamento/:id', async ({ request }) => {
        corpo = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...LISTA[1], aplicavel_em_lote: true })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Consulta')
    const dialog = await editar(usuario, 'Consulta')

    // ACT
    await usuario.click(within(dialog).getByRole('checkbox', { name: 'Pode ser aplicado em lote' }))
    await usuario.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await usuario.click(await screen.findByRole('button', { name: 'Mudar a regra' }))

    // ASSERT
    await waitFor(() => {
      expect(corpo).not.toBeNull()
    })
    expect(corpo).toMatchObject({ em_aberto: false, aplicavel_em_lote: true, marca_reserva: false })
  })
})
