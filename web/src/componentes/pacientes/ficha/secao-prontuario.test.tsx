import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { SecaoProntuario } from '@/componentes/pacientes/ficha/secao-prontuario'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { Atendimento, Evolucao, PaginaDeApi } from '@/tipos'

const TUDO = ['evolucoes.ver', 'atendimentos.ver']

/** Atendimento da LISTA (metadados-só — sem `observacoes`, como a API manda). */
function atendimentoFicticio(sobrescreve: Partial<Atendimento> = {}): Atendimento {
  return {
    id: 30,
    agendamento_id: 40,
    iniciado_em: '2026-07-10 09:00',
    finalizado_em: '2026-07-10 09:40',
    evolucao_id: 7,
    updated_at: '2026-07-10 10:00:00',
    ...sobrescreve,
  }
}

function paginaDe(itens: Atendimento[]): PaginaDeApi<Atendimento> {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

function evolucaoFicticia(): Evolucao {
  return {
    id: 7,
    atendimento_id: 30,
    profissional_id: 1,
    responsavel_tecnico_id: null,
    conteudo: 'Evolução clínica fictícia da sessão.',
    preenchida_em: '2026-07-10 10:00',
    updated_at: '2026-07-10 10:00:00',
  }
}

function renderizar(permissoes: string[] = TUDO) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SecaoProntuario pacienteId={1} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Seção Prontuário — a linha do tempo é só metadados (art. 11)', () => {
  it('deve listar data e estado da evolução sem NUNCA exibir conteúdo clínico', async () => {
    // ARRANGE — o conteúdo existe no show; a lista não o traz e a linha não pode revelá-lo
    let leituras = 0
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(paginaDe([atendimentoFicticio()]))),
      msw.get('/api/evolucoes/:id', () => {
        leituras += 1
        return HttpResponse.json(evolucaoFicticia())
      }),
    )

    // ACT
    renderizar()

    // ASSERT — metadados presentes; conteúdo ausente; NENHUM show por render
    expect(await screen.findByText('10/07/2026 às 09:40')).toBeInTheDocument()
    expect(screen.getByText('Preenchida')).toBeInTheDocument()
    expect(screen.queryByText(/Evolução clínica fictícia/)).not.toBeInTheDocument()
    expect(leituras).toBe(0)
  })

  it('deve distinguir os TRÊS estados do evolucao_id (SEC-PF-05: undefined ≠ null)', async () => {
    // ARRANGE — gated (chave ausente) · em aberto (null) · preenchida (número)
    const gated = atendimentoFicticio({ id: 31, finalizado_em: '2026-07-08 09:40' })
    delete gated.evolucao_id
    servidor.use(
      msw.get('/api/atendimentos', () =>
        HttpResponse.json(
          paginaDe([
            atendimentoFicticio({ id: 30, evolucao_id: 7 }),
            atendimentoFicticio({ id: 32, evolucao_id: null, finalizado_em: '2026-07-09 09:40' }),
            gated,
          ]),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — o gated mostra traço (nunca "Em aberto" fabricado) e não ganha botão
    expect(await screen.findByText('Preenchida')).toBeInTheDocument()
    expect(screen.getByText('Em aberto')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    // só a linha com id numérico tem "Abrir"
    expect(screen.getAllByRole('button', { name: /Abrir evolução/ })).toHaveLength(1)
  })

  it('deve abrir a evolução por clique e RE-consultar ao reabrir (reabrir é re-auditar)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    let leituras = 0
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(paginaDe([atendimentoFicticio()]))),
      msw.get('/api/evolucoes/:id', () => {
        leituras += 1
        return HttpResponse.json(evolucaoFicticia())
      }),
    )
    renderizar()

    // ACT — abre, lê, fecha (Esc — dispensável), reabre
    await usuario.click(await screen.findByRole('button', { name: /Abrir evolução/ }))
    expect(await screen.findByText('Evolução clínica fictícia da sessão.')).toBeInTheDocument()
    expect(leituras).toBe(1)
    await usuario.keyboard('{Escape}')
    await usuario.click(await screen.findByRole('button', { name: /Abrir evolução/ }))

    // ASSERT — nova request: a trilha `consultou` reflete CADA leitura humana
    expect(await screen.findByText('Evolução clínica fictícia da sessão.')).toBeInTheDocument()
    expect(leituras).toBe(2)
  })

  it('deve mostrar acesso negado TERMINAL no 403, sem botão de retry (SEC-PF-08)', async () => {
    // ARRANGE — a evolução tem donos; martelo em porta alheia não ganha botão
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(paginaDe([atendimentoFicticio()]))),
      msw.get('/api/evolucoes/:id', () =>
        HttpResponse.json({ message: 'Sem acesso.' }, { status: 403 }),
      ),
    )
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Abrir evolução/ }))

    // ASSERT — alerta terminal; nenhum "Tentar novamente"; conteúdo jamais apareceu
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Você não tem acesso a esta evolução')
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Evolução clínica fictícia/)).not.toBeInTheDocument()
  })

  it('deve manter o retry manual no erro de REDE do leitor', async () => {
    // ARRANGE — 500 não é 403: re-ler por clique é re-auditar legítimo
    const usuario = userEvent.setup()
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json(paginaDe([atendimentoFicticio()]))),
      msw.get('/api/evolucoes/:id', () =>
        HttpResponse.json({ message: 'Erro.' }, { status: 500 }),
      ),
    )
    renderizar()

    // ACT
    await usuario.click(await screen.findByRole('button', { name: /Abrir evolução/ }))

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })

  it('deve declarar a permissão que falta sem `atendimentos.ver` (D4)', async () => {
    // ARRANGE — a seção veio por `evolucoes.ver`; a LISTA é do módulo de atendimentos
    let consultas = 0
    servidor.use(
      msw.get('/api/atendimentos', () => {
        consultas += 1
        return HttpResponse.json(paginaDe([]))
      }),
    )

    // ACT
    renderizar(['evolucoes.ver'])

    // ASSERT — aviso nomeado, e NENHUMA consulta que voltaria 403
    expect(
      await screen.findByText(/É preciso acesso aos atendimentos/),
    ).toBeInTheDocument()
    expect(consultas).toBe(0)
  })

  it('deve paginar a linha do tempo — toda sessão antiga é alcançável', async () => {
    // ARRANGE — 51+ sessões: o contador e a tabela não podem se contradizer
    const usuario = userEvent.setup()
    const pedidas: string[] = []
    servidor.use(
      msw.get('/api/atendimentos', ({ request }) => {
        const url = new URL(request.url)
        pedidas.push(url.searchParams.get('page') ?? '1')
        return HttpResponse.json({
          data: [atendimentoFicticio({ id: Number(url.searchParams.get('page')) })],
          current_page: Number(url.searchParams.get('page') ?? 1),
          last_page: 2,
          per_page: 50,
          total: 51,
        })
      }),
    )
    renderizar()
    await screen.findByText('51 atendimentos')

    // ACT — vai à página 2
    await usuario.click(screen.getByRole('button', { name: /página 2/i }))

    // ASSERT — a request da página 2 foi feita
    expect(pedidas).toContain('2')
  })

  it('deve mostrar o estado vazio nomeado', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/atendimentos', () => HttpResponse.json(paginaDe([]))))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhum atendimento registrado')).toBeInTheDocument()
  })

  it('deve mostrar erro da lista com retry', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/atendimentos', () => HttpResponse.json({ message: 'Erro.' }, { status: 500 })),
    )

    // ACT
    renderizar()

    // ASSERT — o 500 sofre 1 retry com backoff antes de assentar no erro
    expect(
      await screen.findByRole('button', { name: 'Tentar novamente' }, { timeout: 4000 }),
    ).toBeInTheDocument()
  })
})
