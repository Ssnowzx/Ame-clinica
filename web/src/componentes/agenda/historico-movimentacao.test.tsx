import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { delay, HttpResponse, http as msw } from 'msw'
import { describe, expect, it } from 'vitest'

import { HistoricoDeMovimentacao } from '@/componentes/agenda/historico-movimentacao'
import { queryClient } from '@/lib/query-client'
import { servidor } from '@/test/servidor-msw'

function renderHistorico() {
  return render(
    <QueryClientProvider client={queryClient}>
      <HistoricoDeMovimentacao agendamentoId={42} aoVoltar={() => {}} />
    </QueryClientProvider>,
  )
}

describe('HistoricoDeMovimentacao', () => {
  it('deve listar a trilha com autor, "Sistema" e as alterações rotuladas (mascaradas pelo servidor)', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/auditoria', () =>
        HttpResponse.json({
          data: [
            {
              id: 2,
              entidade: 'agendamentos',
              entidade_id: 42,
              acao: 'atualizou',
              autor: 'Recepção Fictícia',
              criado_em: '2026-07-15 10:00:00',
              alteracoes: [{ campo: 'Status', de: 'Em Aberto', para: 'Finalizado' }],
            },
            {
              id: 1,
              entidade: 'agendamentos',
              entidade_id: 42,
              acao: 'criou',
              autor: 'Sistema',
              criado_em: '2026-07-14 08:00:00',
              alteracoes: [],
            },
          ],
        }),
      ),
    )

    // ACT
    renderHistorico()

    // ASSERT
    const alterado = (await screen.findByText('Alterado')).closest('li')
    expect(alterado).toHaveTextContent('Recepção Fictícia')
    // a HORA precisa sobreviver ao render: o backend emite "Y-m-d H:i:s" (parede da
    // clínica), e o guard antigo (que não assertava a hora) escondia a perda dela
    expect(alterado).toHaveTextContent('às 10:00')
    expect(alterado).toHaveTextContent('Status')
    expect(alterado).toHaveTextContent('Em Aberto')
    expect(alterado).toHaveTextContent('Finalizado')

    expect(screen.getByText('Criado').closest('li')).toHaveTextContent('Sistema')
  })

  it('deve compactar o evento "Criado" numa linha — sem despejar os campos', async () => {
    // ARRANGE — o backend manda alterações no "criou", mas a tela não as despeja (é ruído:
    // criar é, por definição, tudo indo de nada a algo). O valor está nas MUDANÇAS.
    servidor.use(
      msw.get('/api/auditoria', () =>
        HttpResponse.json({
          data: [
            {
              id: 1,
              entidade: 'agendamentos',
              entidade_id: 42,
              acao: 'criou',
              autor: 'Sistema',
              criado_em: '2026-07-14 08:00:00',
              alteracoes: [
                { campo: 'Status', de: null, para: 'Em Aberto' },
                { campo: 'Horário', de: null, para: '15/07/2026 às 08:00' },
              ],
            },
          ],
        }),
      ),
    )

    // ACT
    renderHistorico()

    // ASSERT — a linha "Criado" existe, mas o dump de campos NÃO é renderizado
    const criado = (await screen.findByText('Criado')).closest('li')
    expect(criado).not.toHaveTextContent('Status')
    expect(criado).not.toHaveTextContent('Em Aberto')
    expect(criado).not.toHaveTextContent('Horário')
  })

  it('deve mostrar o esqueleto enquanto carrega, com a SAÍDA já persistente (nunca um beco)', () => {
    // ARRANGE — resposta que não resolve durante o teste: prende o estado carregando
    servidor.use(
      msw.get('/api/auditoria', async () => {
        await delay(10_000)
        return HttpResponse.json({ data: [] })
      }),
    )

    // ACT
    const { container } = renderHistorico()

    // ASSERT — o esqueleto está na tela, e "Voltar ao agendamento" já existe (2.4.3:
    // a saída persiste em TODOS os quatro estados, inclusive carregando)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Voltar ao agendamento' })).toBeInTheDocument()
    // ...e nenhum dos estados finais ainda apareceu
    expect(screen.queryByText('Nenhuma movimentação')).not.toBeInTheDocument()
  })

  it('deve oferecer nova tentativa quando a trilha falha', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/auditoria', () => new HttpResponse(null, { status: 500 })))

    // ACT
    renderHistorico()

    // ASSERT — 5xx tem 1 retry (~1s de backoff): dar tempo ao estado de erro
    expect(await screen.findByRole('button', { name: /Tentar novamente/i }, { timeout: 3000 })).toBeInTheDocument()
  })
  it('deve nomear a sessão mantida quando a família desistiu de desmarcar', async () => {
    // ARRANGE — a recepção resolveu o pedido da família mantendo a sessão
    servidor.use(
      msw.get('/api/auditoria', () =>
        HttpResponse.json({
          data: [
            {
              id: 3,
              entidade: 'agendamentos',
              entidade_id: 42,
              acao: 'manteve_sessao',
              autor: 'Recepção Fictícia',
              criado_em: '2026-07-15 19:02:00',
              alteracoes: [],
            },
          ],
        }),
      ),
    )

    // ACT
    renderHistorico()

    // ASSERT — em palavras, nunca a chave crua da ação
    expect(await screen.findByText('Sessão mantida (a família desistiu)')).toBeInTheDocument()
    expect(screen.queryByText('manteve_sessao')).not.toBeInTheDocument()
  })

  it('deve nomear a sessão confirmada pela clínica quando a família confirmou por outro canal', async () => {
    // ARRANGE — a família confirmou por telefone, e a recepção registrou (confirmacao-pela-clinica)
    servidor.use(
      msw.get('/api/auditoria', () =>
        HttpResponse.json({
          data: [
            {
              id: 4,
              entidade: 'agendamentos',
              entidade_id: 42,
              acao: 'confirmou_pela_clinica',
              autor: 'Recepção Fictícia',
              criado_em: '2026-07-15 14:32:00',
              alteracoes: [],
            },
          ],
        }),
      ),
    )

    // ACT
    renderHistorico()

    // ASSERT — em palavras, nunca a chave crua da ação
    expect(await screen.findByText('Confirmada pela clínica (a família confirmou por outro canal)')).toBeInTheDocument()
    expect(screen.queryByText('confirmou_pela_clinica')).not.toBeInTheDocument()
  })
})
