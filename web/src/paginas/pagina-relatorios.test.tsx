import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { queryClient } from '@/lib/query-client'
import { PaginaRelatorios } from '@/paginas/pagina-relatorios'
import { useAuthStore } from '@/stores/auth-store'
import { usuarioFicticio } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

function renderizar(permissoes: string[]) {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/relatorios']}>
        <PaginaRelatorios />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Catálogo de relatórios — cartões por categoria, busca e permissão', () => {
  it('deve agrupar os cartões pelas categorias, na ordem, com o nome antigo em cada um', async () => {
    // ARRANGE — permissões de TODOS os relatórios
    const { container } = renderizar([
      'agenda.ver', 'atendimentos.ver', 'evolucoes.ver', 'auditoria.ver', 'pacientes.ver', 'tratamentos.ver', 'lancamentos.ver',
    ])

    // ASSERT — as cinco categorias, nesta ordem
    const titulos = screen.getAllByRole('heading', { level: 2 }).map((titulo) => titulo.textContent)
    expect(titulos).toEqual(['Agenda', 'Atendimentos', 'Tratamentos', 'Pacientes', 'Financeiro'])
    const agenda = screen.getByRole('region', { name: 'Agenda' })
    const cartao = within(agenda).getByRole('link', { name: /Agendamentos/ })
    expect(cartao).toHaveAttribute('href', '/relatorios/agendamentos')
    expect(cartao).toHaveTextContent('No ClinicaÁgil: Agenda por Status · Agendamentos por Período')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve achar o cartão pelo nome antigo do ClinicaÁgil', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    renderizar(['agenda.ver', 'auditoria.ver', 'pacientes.ver'])

    // ACT — a recepção procura pelo nome que decorou
    await usuaria.type(screen.getByLabelText('Buscar relatório'), 'agenda por status')

    // ASSERT — só o cartão "Agendamentos" sobra; as categorias sem cartão somem
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Agendamentos/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Pacientes' })).not.toBeInTheDocument()
  })

  it('deve esconder o cartão de quem não tem TODAS as permissões do relatório', () => {
    // ARRANGE — sem `auditoria.ver`: a Movimentação some; com `evolucoes.ver` mas sem
    // `atendimentos.ver`, as Evoluções também (todas, não qualquer uma)
    renderizar(['agenda.ver', 'evolucoes.ver'])

    // ASSERT
    expect(screen.getByRole('link', { name: /Agendamentos/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Movimentação da agenda/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Evoluções/ })).not.toBeInTheDocument()
  })

  it('deve explicar o vazio da busca e oferecer limpar', async () => {
    // ARRANGE
    const usuaria = userEvent.setup()
    renderizar(['agenda.ver'])

    // ACT
    await usuaria.type(screen.getByLabelText('Buscar relatório'), 'comissão')

    // ASSERT
    expect(screen.getByRole('heading', { level: 2, name: 'Nenhum relatório com esse nome.' })).toBeInTheDocument()
    await usuaria.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(screen.getByRole('link', { name: /Agendamentos/ })).toBeInTheDocument()
  })

  it('deve dizer quando o nível não alcança relatório nenhum', () => {
    // ARRANGE — `evolucoes.ver` sozinha abre a rota (está na união) mas não completa relatório algum
    renderizar(['evolucoes.ver'])

    // ASSERT — sem busca e com a explicação
    expect(screen.getByText('Nenhum relatório disponível para o seu nível de acesso.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buscar relatório')).not.toBeInTheDocument()
  })
})
