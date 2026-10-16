import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaEvolucoes } from '@/paginas/pagina-evolucoes'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { EvolucaoEmAberto } from '@/tipos'

expect.extend(toHaveNoViolations)

function emAberto(sobrescritas: Partial<EvolucaoEmAberto> = {}): EvolucaoEmAberto {
  return {
    atendimento_id: 3,
    agendamento_id: 7,
    finalizado_em: '2026-07-01 09:40',
    paciente: { id: 10, nome: 'Ana Fictícia' },
    profissional: { id: 1, nome: 'Profissional Fictício' },
    prazo_ate: '2026-10-09',
    vencida: false,
    ...sobrescritas,
  }
}

function pagina(itens: EvolucaoEmAberto[]) {
  return { data: itens, current_page: 1, last_page: 1, per_page: 50, total: itens.length }
}

function renderizar(caminho = '/evolucoes') {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes: ['evolucoes.ver'] },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={[caminho]}>
          <PaginaEvolucoes />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Fila de evoluções em aberto', () => {
  it('deve dizer quem deve evolução e destacar o VENCIDO sem depender só de cor', async () => {
    // ARRANGE: cada linha é uma sessão que ACONTECEU com uma criança e cujo registro
    // clínico não foi escrito. O vencido não pode se anunciar só por cor (WCAG 1.4.1).
    servidor.use(
      msw.get('/api/evolucoes/em-aberto', () =>
        HttpResponse.json(
          pagina([
            emAberto({ atendimento_id: 3, vencida: false, prazo_ate: '2026-10-09' }),
            emAberto({ atendimento_id: 4, vencida: true, prazo_ate: '2026-07-05' }),
          ]),
        ),
      ),
    )
    renderizar()

    // ASSERT
    expect(await screen.findAllByText('Ana Fictícia')).toHaveLength(2)
    // a palavra carrega o significado sozinha — não é a cor que informa
    expect(screen.getByText(/Venceu em 05\/07\/2026/)).toBeInTheDocument()
    expect(screen.getByText(/Até 09\/10\/2026/)).toBeInTheDocument()
  })

  it('deve exibir o prazo do SERVIDOR, sem recalcular no navegador', async () => {
    // ARRANGE: `vencida` e `prazo_ate` são calculados no fuso da CLÍNICA. Se a tela
    // refizesse a conta, usaria o fuso do CLIENTE — e diria "vencida" um dia antes (ou
    // depois) do que a clínica considera. O servidor manda; a tela obedece.
    servidor.use(
      msw.get('/api/evolucoes/em-aberto', () =>
        // prazo NO FUTURO e mesmo assim `vencida: true` — só o servidor decide isso
        HttpResponse.json(pagina([emAberto({ vencida: true, prazo_ate: '2099-01-01' })])),
      ),
    )
    renderizar()

    // ASSERT: a tela acompanha o servidor, mesmo contra a "lógica" do calendário local
    expect(await screen.findByText(/Venceu em 01\/01\/2099/)).toBeInTheDocument()
  })

  it('deve dizer que não há nada em aberto — sem inventar tabela vazia', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/evolucoes/em-aberto', () => HttpResponse.json(pagina([]))))
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhuma evolução em aberto.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('deve NUNCA trazer conteúdo clínico — a fila é a dos que ainda não têm evolução', async () => {
    // ARRANGE: a fila lista METADADOS. Conteúdo aqui não existe por definição — e nenhuma
    // linha pode virar uma porta lateral para o prontuário de um menor.
    servidor.use(msw.get('/api/evolucoes/em-aberto', () => HttpResponse.json(pagina([emAberto()]))))
    const { container } = renderizar()
    await screen.findByText('Ana Fictícia')

    // ASSERT — nenhuma superfície da fila carrega texto clínico
    expect(container.textContent).not.toMatch(/conteudo|conteúdo da evolução/i)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve recortar a fila por profissional e dar a volta à ficha quando chega por ela', async () => {
    // ARRANGE — porta da ficha: `?profissional_id=` (o plano filtra; o escopado já é
    // forçado ao próprio no servidor)
    const filtrosPedidos: Array<string | null> = []
    servidor.use(
      msw.get('/api/evolucoes/em-aberto', ({ request }) => {
        filtrosPedidos.push(new URL(request.url).searchParams.get('profissional_id'))
        return HttpResponse.json(pagina([emAberto()]))
      }),
    )

    // ACT
    renderizar('/evolucoes?profissional_id=7')

    // ASSERT
    expect(await screen.findByRole('link', { name: /Ficha do profissional/ })).toHaveAttribute(
      'href',
      '/profissionais/7',
    )
    expect(filtrosPedidos).toContain('7')
  })
})
