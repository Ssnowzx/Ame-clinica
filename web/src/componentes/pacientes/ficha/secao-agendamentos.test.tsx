import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { SecaoAgendamentos } from '@/componentes/pacientes/ficha/secao-agendamentos'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { AgendamentosDoPaciente, ItemAgendamentoDaFicha } from '@/tipos'

/**
 * Seção Agendamentos da ficha (change agendamentos-na-ficha): dois blocos, cada um com o
 * seu vazio. O caso que abriu a change — sessão de HOJE já finalizada, antes do horário —
 * tem teste próprio: se ele passar por acidente, a seção voltou a esconder o dia corrente.
 */

const EM_ABERTO = { id: 1, nome: 'Em Aberto', cor: '#8899aa', cor_borda: null, tipo: null }
const FINALIZADO = { id: 2, nome: 'Finalizado', cor: '#448247', cor_borda: null, tipo: 'check' }

function item(sobrescreve: Partial<ItemAgendamentoDaFicha> = {}): ItemAgendamentoDaFicha {
  return {
    id: 1,
    inicio: '2026-09-08 16:00',
    especialidade: { id: 2, nome: 'Fonoaudiologia Fictícia', cor: '#448247' },
    profissional: { id: 7, nome: 'Profissional Fictício' },
    status: EM_ABERTO,
    ...sobrescreve,
  }
}

function payload(sobrescreve: Partial<AgendamentosDoPaciente> = {}): AgendamentosDoPaciente {
  return {
    proximos: { janela: { de: '2026-09-08', ate: null }, total: 0, itens: [] },
    recentes: { janela: { de: '2026-06-10', ate: '2026-09-08' }, total: 0, itens: [] },
    ...sobrescreve,
  }
}

function renderizar(permissoes: string[] = ['agenda.ver']) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SecaoAgendamentos pacienteId={1} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Seção Agendamentos — próximos e recentes', () => {
  it('deve mostrar a sessão de hoje que ainda não chegou ao horário', async () => {
    // ARRANGE — o caso da clínica: presença lançada de manhã para a sessão da tarde
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            proximos: {
              janela: { de: '2026-09-08', ate: null },
              total: 1,
              itens: [item({ inicio: '2026-09-08 16:00', status: FINALIZADO })],
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — aparece nos próximos, com a hora e o status; nada de "não há agendamentos"
    expect(await screen.findByText('08/09/2026 às 16:00')).toBeInTheDocument()
    expect(screen.getByText('Finalizado')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma sessão marcada')).not.toBeInTheDocument()
  })

  it('deve manter o outro bloco de pé quando um está vazio', async () => {
    // ARRANGE — paciente novo: tem futuro, não tem histórico
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            proximos: {
              janela: { de: '2026-09-08', ate: null },
              total: 1,
              itens: [item({ id: 3, inicio: '2026-09-15 09:00' })],
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — o vazio dos recentes NÃO apaga a lista dos próximos
    expect(await screen.findByText('15/09/2026 às 09:00')).toBeInTheDocument()
    expect(screen.getByText('Sem atendimentos nesta janela')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Próximas sessões' })).toBeInTheDocument()
    // as duas listas são REGIÕES nomeadas (a irmã Presença já é assim)
    expect(screen.getByRole('region', { name: 'Próximas sessões' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Últimos 90 dias' })).toBeInTheDocument()
  })

  it('deve mostrar os dois estados vazios quando não há nada nas duas janelas', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/pacientes/1/agendamentos', () => HttpResponse.json(payload())))

    // ACT
    renderizar()

    // ASSERT — a seção não some; cada bloco explica o seu vazio
    expect(await screen.findByText('Nenhuma sessão marcada')).toBeInTheDocument()
    expect(screen.getByText('Sem atendimentos nesta janela')).toBeInTheDocument()
  })

  it('deve dizer o início e o término de cada sessão quando a API os traz', async () => {
    // ARRANGE — change horario-de-termino-no-card: 50 minutos, para o término não ser "início + 40"
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            recentes: {
              janela: { de: '2026-06-10', ate: '2026-09-08' },
              total: 1,
              itens: [item({ id: 1, inicio: '2026-09-05 08:40', fim: '2026-09-05 09:30' })],
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('05/09/2026, das 08:40 às 09:30')).toBeInTheDocument()
  })

  it('deve distinguir duas sessões do MESMO dia pela hora', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            recentes: {
              janela: { de: '2026-06-10', ate: '2026-09-08' },
              total: 2,
              itens: [
                item({ id: 1, inicio: '2026-09-05 09:00' }),
                item({ id: 2, inicio: '2026-09-05 14:30' }),
              ],
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByText('05/09/2026 às 09:00')).toBeInTheDocument()
    expect(screen.getByText('05/09/2026 às 14:30')).toBeInTheDocument()
  })

  it('deve trazer o contador e a distribuição por status no histórico', async () => {
    // ARRANGE — dois atendimentos, um em cada status
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            recentes: {
              janela: { de: '2026-06-10', ate: '2026-09-08' },
              total: 2,
              itens: [
                item({ id: 1, inicio: '2026-09-05 09:00', status: FINALIZADO }),
                item({ id: 2, inicio: '2026-09-01 09:00', status: EM_ABERTO }),
              ],
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — o número em texto (nunca só cor), e cada status com a sua contagem
    expect(await screen.findByText('2 atendimentos')).toBeInTheDocument()
    expect(screen.getAllByText('Finalizado').length).toBeGreaterThan(0)
    expect(screen.getAllByText('×1').length).toBe(2)
  })

  it('deve declarar a amostra pelo total REAL quando a lista vem cortada', async () => {
    // ARRANGE — o servidor cortou em 50 e declarou o total verdadeiro (60)
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            proximos: {
              janela: { de: '2026-09-08', ate: null },
              total: 60,
              itens: Array.from({ length: 50 }, (_, indice) =>
                item({ id: indice + 1, inicio: `2026-09-${String((indice % 28) + 1).padStart(2, '0')} 09:00` }),
              ),
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — "N de M", com o M que só o servidor sabe
    expect(await screen.findByText(/Mostrando 50 de 60/)).toBeInTheDocument()
  })

  it('NÃO deve declarar amostra quando a lista veio inteira', async () => {
    // ARRANGE — exatamente 50 itens e total 50: nada foi cortado (o falso positivo do
    // espelho de teto, achado no gate: a tela mandava "abrir a agenda" sem restante nenhum)
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            proximos: {
              janela: { de: '2026-09-08', ate: null },
              total: 50,
              itens: Array.from({ length: 50 }, (_, indice) =>
                item({ id: indice + 1, inicio: `2026-09-${String((indice % 28) + 1).padStart(2, '0')} 09:00` }),
              ),
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findAllByText(/às 09:00/)).not.toHaveLength(0)
    expect(screen.queryByText(/Mostrando/)).not.toBeInTheDocument()
  })

  it('deve contar pelo total do servidor e declarar a amostra da distribuição', async () => {
    // ARRANGE — 210 atendimentos na janela, 2 devolvidos
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            recentes: {
              janela: { de: '2026-06-10', ate: '2026-09-08' },
              total: 210,
              itens: [
                item({ id: 1, inicio: '2026-09-05 09:00', status: FINALIZADO }),
                item({ id: 2, inicio: '2026-09-01 09:00', status: EM_ABERTO }),
              ],
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — o contador é o REAL; os chips são amostra, e a tela diz isso
    expect(await screen.findByText('210 atendimentos')).toBeInTheDocument()
    expect(screen.getByText(/Mostrando 2 de 210/)).toBeInTheDocument()
  })

  it('deve oferecer a agenda no vazio dos próximos para quem pode marcar', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/pacientes/1/agendamentos', () => HttpResponse.json(payload())))

    // ACT
    renderizar(['agenda.ver', 'agenda.criar'])

    // ASSERT — vazio com explicação E próximo passo (§5.9 do design system)
    expect(await screen.findByText('Este paciente não tem sessão agendada daqui para a frente.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Marcar uma sessão/ })).toBeInTheDocument()
  })

  it('NÃO deve oferecer a agenda a quem não pode marcar', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/pacientes/1/agendamentos', () => HttpResponse.json(payload())))

    // ACT — só leitura da agenda
    renderizar(['agenda.ver'])

    // ASSERT — a explicação fica; o botão, não
    expect(await screen.findByText('Este paciente não tem sessão agendada daqui para a frente.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar uma sessão/ })).not.toBeInTheDocument()
  })

  it('deve mostrar erro com repetir quando a leitura falha', async () => {
    // ARRANGE — 403 porque o React Query não re-tenta nele (padrão da casa nos testes de erro)
    servidor.use(msw.get('/api/pacientes/1/agendamentos', () => new HttpResponse(null, { status: 403 })))

    // ACT
    renderizar()

    // ASSERT
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os agendamentos')
  })
})

describe('Seção Agendamentos — selo de evolução', () => {
  it('deve mostrar o selo só na linha que TEM evolução', async () => {
    // ARRANGE — uma sessão com evolução, outra sem
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            recentes: {
              janela: { de: '2026-06-10', ate: '2026-09-08' },
              total: 2,
              itens: [
                item({ id: 1, inicio: '2026-09-05 09:00', tem_evolucao: true }),
                item({ id: 2, inicio: '2026-09-01 09:00', tem_evolucao: false }),
              ],
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — um selo só, lido como TEXTO (não apenas ícone)
    expect(await screen.findAllByText('Evolução registrada')).toHaveLength(1)
  })

  it('NÃO deve mostrar selo quando o servidor cala (null)', async () => {
    // ARRANGE — sem `evolucoes.ver`, ou linha fora do escopo clínico
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            recentes: {
              janela: { de: '2026-06-10', ate: '2026-09-08' },
              total: 1,
              itens: [item({ id: 1, inicio: '2026-09-05 09:00', tem_evolucao: null })],
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — a ausência do selo não afirma nada
    expect(await screen.findByText('05/09/2026 às 09:00')).toBeInTheDocument()
    expect(screen.queryByText('Evolução registrada')).not.toBeInTheDocument()
  })

  it('deve aguentar o payload ANTERIOR, sem o campo (deploy fora de ordem)', async () => {
    // ARRANGE — item sem `tem_evolucao`
    servidor.use(
      msw.get('/api/pacientes/1/agendamentos', () =>
        HttpResponse.json(
          payload({
            recentes: {
              janela: { de: '2026-06-10', ate: '2026-09-08' },
              total: 1,
              itens: [item({ id: 1, inicio: '2026-09-05 09:00' })],
            },
          }),
        ),
      ),
    )

    // ACT
    renderizar()

    // ASSERT — a linha desenha, o selo não
    expect(await screen.findByText('05/09/2026 às 09:00')).toBeInTheDocument()
    expect(screen.queryByText('Evolução registrada')).not.toBeInTheDocument()
  })
})
