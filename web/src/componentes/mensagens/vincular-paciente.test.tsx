import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { VincularPaciente } from '@/componentes/mensagens/vincular-paciente'
import { queryClient } from '@/lib/query-client'
import { servidor } from '@/test/servidor-msw'

function renderizar() {
  return render(
    <QueryClientProvider client={queryClient}>
      <VincularPaciente aberto aoFechar={vi.fn()} aoVincular={vi.fn()} vinculando={false} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('VincularPaciente', () => {
  it('deve dizer que a busca falhou, e não que a clínica não tem paciente', async () => {
    // ARRANGE: um 500 virando "nenhum paciente ativo para vincular" empurra quem está
    // vinculando a conversa para o pré-cadastro — duplicata de MENOR por causa de uma
    // requisição que caiu (achado CR-BPL-04)
    servidor.use(msw.get('/api/pacientes', () => new HttpResponse(null, { status: 500 })))

    // ACT
    renderizar()

    // ASSERT: o cliente REPETE erro de servidor uma vez antes de desistir (query-client.ts),
    // e o backoff dessa retentativa passa do timeout padrão de 1s do `findBy`
    expect(await screen.findByText('Não foi possível carregar a lista', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum paciente ativo para vincular/)).not.toBeInTheDocument()
  })

  it('deve dizer que não há paciente ativo quando a lista volta vazia de verdade', async () => {
    // ARRANGE: aqui o cadastro FOI consultado e respondeu — a afirmação é honesta
    servidor.use(
      msw.get('/api/pacientes', () =>
        HttpResponse.json({ data: [], current_page: 1, last_page: 1, per_page: 20, total: 0 }),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhum paciente ativo para vincular')).toBeInTheDocument()
  })

  it('deve abrir listando os ativos, sem exigir que alguém digite', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes', () =>
        HttpResponse.json({
          data: [{ id: 7, nome: 'Criança Fictícia da Conversa', nome_social: null, ativo: true }],
          current_page: 1,
          last_page: 1,
          per_page: 20,
          total: 1,
        }),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByRole('button', { name: 'Criança Fictícia da Conversa' })).toBeInTheDocument()
  })
})
