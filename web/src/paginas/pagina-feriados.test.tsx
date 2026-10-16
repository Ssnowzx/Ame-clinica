import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaFeriados } from '@/paginas/pagina-feriados'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Feriado } from '@/tipos'

const TUDO = ['feriados.ver', 'feriados.criar', 'feriados.editar', 'feriados.excluir']

const NATAL: Feriado = { id: 1, nome: 'Natal', data: '2026-12-25', recorrente: true, ativo: true, updated_at: '2026-07-15T10:00:00.000000Z' }

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/feriados']}>
          <PaginaFeriados />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Feriados', () => {
  it('deve enviar a data no formato EXATO que o servidor exige (Y-m-d)', async () => {
    // ARRANGE: o `date_format:Y-m-d` do Laravel exige round-trip exato. Foi por
    // `toISOString()` (que acrescenta hora e "Z") que TODO cadastro com consentimento
    // levou 422 na change passada — com a suíte verde. A prova é o payload, não o mock.
    let corpoEnviado: Record<string, unknown> | null = null
    servidor.use(
      msw.get('/api/feriados', () => HttpResponse.json([])),
      msw.post('/api/feriados', async ({ request }) => {
        corpoEnviado = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(NATAL, { status: 201 })
      }),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByRole('button', { name: /Cadastrar feriado/i })

    // ACT
    await usuario.click(screen.getByRole('button', { name: /Cadastrar feriado/i }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.type(within(dialog).getByRole('textbox', { name: /Nome/i }), 'Natal')
    // o <input type="date"> devolve exatamente `Y-m-d` — e é isso que tem que viajar
    const data = within(dialog).getByLabelText(/Data/i)
    await usuario.type(data, '2026-12-25')
    await usuario.click(within(dialog).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT
    await waitFor(() => {
      expect(corpoEnviado).not.toBeNull()
    })
    expect(corpoEnviado).toMatchObject({ nome: 'Natal', data: '2026-12-25' })
    expect(String((corpoEnviado as unknown as Feriado).data)).not.toContain('T')
    expect(String((corpoEnviado as unknown as Feriado).data)).not.toContain('Z')
  })

  it('deve exibir a data em pt-BR sem inventar fuso', async () => {
    // ARRANGE: converter `Y-m-d` para Date e formatar traria o fuso junto — 25/12
    // vira 24/12 à noite em UTC-3
    servidor.use(msw.get('/api/feriados', () => HttpResponse.json([NATAL])))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('25/12/2026')).toBeInTheDocument()
  })
})

describe('Feriados — exclusão', () => {
  it('deve mostrar a recusa do servidor DENTRO do diálogo e manter o registro na lista', async () => {
    // ARRANGE: 422 do servidor. Um toast que passa não basta: quem clicou está
    // olhando para o diálogo, e "cliquei e não aconteceu nada" é o que ele leria.
    servidor.use(
      msw.get('/api/feriados', () => HttpResponse.json([NATAL])),
      msw.delete('/api/feriados/:id', () =>
        HttpResponse.json(
          { message: 'Recusado.', errors: { feriado: ['Este feriado está em uso e não pode ser excluído.'] } },
          { status: 422 },
        ),
      ),
    )
    const usuario = userEvent.setup()
    renderizar()
    await screen.findByText('Natal')

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Excluir' }))
    const dialog = await screen.findByRole('alertdialog')
    await usuario.click(within(dialog).getByRole('button', { name: /Excluir feriado/i }))

    // ASSERT: a mensagem aparece no diálogo, ele continua aberto, e o feriado continua lá
    expect(
      await within(dialog).findByText('Este feriado está em uso e não pode ser excluído.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Natal')).toBeInTheDocument()
  })
})

describe('Feriados — a agenda repinta quando a clínica fecha um dia', () => {
  it('deve invalidar a SELEÇÃO da agenda ao cadastrar um feriado', async () => {
    // ARRANGE — a grade lê os feriados da SELEÇÃO da agenda (change `portas-da-agenda`, para que
    // `agenda.ver` baste). Se o cadastro invalidar só `['feriados']`, a grade continua pintando o
    // dia como ÚTIL até o cache expirar (5 min) — e a recepção marca sessão num dia em que a
    // clínica não abre. É exatamente o dano que a mudança da FONTE quase causou: mudou de onde a
    // grade lê e esqueceu de mudar quem a invalida.
    //
    // O sinal é o ESTADO DO CACHE, não um refetch: com a agenda desmontada, a query não tem
    // observador e `invalidateQueries` só a marca. É essa marca que faz a grade buscar de novo
    // quando ela montar.
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/feriados', () => HttpResponse.json([])),
      msw.post('/api/feriados', () => HttpResponse.json(NATAL, { status: 201 })),
    )
    // a seleção já está no cache, fresca (é o que a agenda teria deixado ao ser visitada)
    queryClient.setQueryData(['agenda-selecao'], { profissionais: [], especialidades: [], feriados: [] })
    expect(queryClient.getQueryState(['agenda-selecao'])?.isInvalidated).toBe(false)
    renderizar()

    // ACT — a clínica fecha um dia
    await usuario.click(await screen.findByRole('button', { name: /Cadastrar feriado/i }))
    const dialogo = await screen.findByRole('alertdialog')
    await usuario.type(within(dialogo).getByRole('textbox', { name: /Nome/i }), 'Natal')
    await usuario.type(within(dialogo).getByLabelText(/Data/i), '2026-12-25')
    await usuario.click(within(dialogo).getByRole('button', { name: 'Cadastrar' }))

    // ASSERT — a seleção da agenda está marcada: a grade vai repintar ao abrir
    await waitFor(() => {
      expect(queryClient.getQueryState(['agenda-selecao'])?.isInvalidated).toBe(true)
    })
  })
})
