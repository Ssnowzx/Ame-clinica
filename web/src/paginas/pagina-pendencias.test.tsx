import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { HttpResponse, http as msw } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { queryClient } from '@/lib/query-client'
import { PaginaPendencias } from '@/paginas/pagina-pendencias'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'
import type { ItemPendenciaDeRetorno } from '@/tipos'

expect.extend(toHaveNoViolations)

function pendente(sobrescritas: Partial<ItemPendenciaDeRetorno> = {}): ItemPendenciaDeRetorno {
  return {
    paciente: { id: 10, nome: 'Ana Fictícia', nome_social: null },
    dias_sem_agendamento: 45,
    ultima_ocorrencia_em: '2026-06-09',
    inicio_tratamento_em: '2026-01-05',
    especialidades: [{ id: 1, nome: 'Fonoaudiologia' }],
    ...sobrescritas,
  }
}

function pagina(itens: ItemPendenciaDeRetorno[], janelaDias = 30) {
  return {
    data: itens,
    current_page: 1,
    last_page: 1,
    per_page: 50,
    total: itens.length,
    janela_dias: janelaDias,
  }
}

function renderizar(permissoes: string[] = ['agenda.ver', 'pacientes.ver', 'agenda.criar']) {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, permissoes },
    carregandoSessao: false,
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProvedorToast>
        <MemoryRouter initialEntries={['/pendencias']}>
          <PaginaPendencias />
        </MemoryRouter>
      </ProvedorToast>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  queryClient.clear()
})

describe('Fila de pendências de retorno', () => {
  it('deve dizer há quanto tempo a criança está sem agendamento e desde quando', async () => {
    // ARRANGE: cada linha é uma criança em tratamento sem próxima sessão marcada.
    servidor.use(
      msw.get('/api/pendencias-de-retorno', () => HttpResponse.json(pagina([pendente()]))),
    )
    renderizar()

    // ASSERT
    expect(await screen.findByText('Ana Fictícia')).toBeInTheDocument()
    expect(screen.getByText('45 dias')).toBeInTheDocument()
    expect(screen.getByText(/Última sessão em 09\/06\/2026/)).toBeInTheDocument()
    expect(screen.getByText('Fonoaudiologia')).toBeInTheDocument()
  })

  it('deve anunciar a janela vigente que o SERVIDOR mandou, sem recalcular nada', async () => {
    // ARRANGE: a janela é DADO da clínica (§13); a tela exibe o que veio, nunca um 30 fixo
    servidor.use(
      msw.get('/api/pendencias-de-retorno', () => HttpResponse.json(pagina([pendente()], 15))),
    )
    renderizar()

    // ASSERT
    expect(await screen.findByText(/sem próxima sessão marcada há mais de 15 dias/)).toBeInTheDocument()
  })

  it('deve distinguir o pacote NUNCA agendado de quem sumiu depois de vir', async () => {
    // ARRANGE: sem sessão nenhuma, a âncora é o início do tratamento. Confundir os dois
    // faria a recepção procurar uma sessão que nunca existiu.
    servidor.use(
      msw.get('/api/pendencias-de-retorno', () =>
        HttpResponse.json(
          pagina([pendente({ ultima_ocorrencia_em: null, inicio_tratamento_em: '2026-05-20', dias_sem_agendamento: 65 })]),
        ),
      ),
    )
    renderizar()

    // ASSERT
    expect(await screen.findByText(/Nunca agendado · tratamento de 20\/05\/2026/)).toBeInTheDocument()
  })

  it('deve dizer que ninguém ficou para trás — sem inventar tabela vazia', async () => {
    // ARRANGE
    servidor.use(msw.get('/api/pendencias-de-retorno', () => HttpResponse.json(pagina([]))))
    renderizar()

    // ASSERT
    expect(await screen.findByText('Nenhuma pendência de retorno.')).toBeInTheDocument()
    expect(
      screen.getByText('Todos os pacientes em tratamento têm próxima sessão marcada.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('não deve prometer navegação que o servidor nega', async () => {
    // ARRANGE: a fila chega com `agenda.ver`; a ficha exige `pacientes.ver` e o
    // agendamento exige `agenda.criar`. Sem elas o dado aparece, o LINK não (gate F-02).
    servidor.use(
      msw.get('/api/pendencias-de-retorno', () => HttpResponse.json(pagina([pendente()]))),
    )
    renderizar(['agenda.ver'])

    // ASSERT: o nome está lá, como texto — nenhum link na linha
    expect(await screen.findByText('Ana Fictícia')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ana Fictícia' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Agendar retorno/ })).not.toBeInTheDocument()
  })

  it('deve levar ao paciente e ao agendamento quando as permissões existem', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pendencias-de-retorno', () => HttpResponse.json(pagina([pendente()]))),
    )
    renderizar()

    // ASSERT — o NOME é a porta para a ficha
    expect(await screen.findByRole('link', { name: 'Ana Fictícia' })).toHaveAttribute(
      'href',
      '/pacientes/10',
    )
    // "Agendar retorno" leva a criança JUNTO: a agenda entra em modo retorno pelo id
    // (change `agendar-retorno-com-paciente`, que fechou PEND-AGENDAR-SEM-CONTEXTO).
    expect(screen.getByRole('link', { name: /Agendar retorno/ })).toHaveAttribute(
      'href',
      '/agenda?paciente=10',
    )
  })

  it('não deve levar o NOME da criança no endereço do agendamento', async () => {
    // ARRANGE — a guarda do gatilho LOG: id é referência pseudônima e pode viajar; o nome de um
    // MENOR não, porque o access log do proxy o gravaria em disco com retenção indefinida
    servidor.use(
      msw.get('/api/pendencias-de-retorno', () =>
        HttpResponse.json(pagina([pendente({ paciente: { id: 10, nome: 'Ana Fictícia', nome_social: 'Aninha Fictícia' } })])),
      ),
    )
    renderizar()

    // ACT
    const destino = (await screen.findByRole('link', { name: /Agendar retorno/ })).getAttribute('href') ?? ''

    // ASSERT — nem o nome, nem o nome social, nem pedaço deles
    expect(destino).toBe('/agenda?paciente=10')
    expect(destino).not.toContain('Ana')
    expect(destino).not.toContain('Aninha')
    expect(destino).not.toContain('Fict')
  })

  it('não deve ter violações de acessibilidade', async () => {
    // ARRANGE
    servidor.use(
      msw.get('/api/pendencias-de-retorno', () => HttpResponse.json(pagina([pendente()]))),
    )
    const { container } = renderizar()
    await screen.findByText('Ana Fictícia')

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})
