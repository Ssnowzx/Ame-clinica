import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PainelBloqueio } from '@/componentes/agenda/painel-bloqueio'
import { useAuthStore } from '@/stores/auth-store'
import { usuarioFicticio } from '@/test/servidor-msw'
import type { CardAgendamento } from '@/tipos'

function comPermissoes(permissoes: string[]): void {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })
}

const BLOQUEIO: CardAgendamento = {
  id: 90,
  updated_at: '2026-07-15T10:00:00.000000Z',
  tipo: 'bloqueio',
  profissional_id: 7,
  paciente_id: null,
  tratamento_id: null,
  status_id: 0,
  inicio: '2026-07-16 12:00',
  fim: '2026-07-16 13:00',
  duracao_minutos: 60,
  is_reposicao: false,
  obs: 'Reunião de equipe',
  paciente: null,
  especialidade: null,
  status: null,
  profissional: { id: 7, nome: 'Profissional Fictício' },
  sala: { id: 5, nome: 'Sala 3' },
  tratamento_saldo: null,
  tratamento_total: null,
  tratamento_realce: 'nenhum',
  convenio: null,
}

describe('PainelBloqueio (card de leitura do bloqueio)', () => {
  it('deve mostrar um card enxuto: rótulo, quando, profissional e sala — sem paciente nem status', () => {
    // ARRANGE + ACT
    comPermissoes(['agenda.ver'])
    render(<PainelBloqueio aberto card={BLOQUEIO} aoFechar={() => {}} aoEditar={() => {}} />)

    // ASSERT
    const painel = screen.getByRole('dialog')
    expect(painel).toHaveTextContent('Detalhes do bloqueio')
    expect(painel).toHaveTextContent('Reunião de equipe')
    expect(painel).toHaveTextContent('Profissional Fictício')
    expect(painel).toHaveTextContent('Sala 3')
    // enxuto: sem editar não há ação
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
  })

  it('deve oferecer Editar (a primária do bloqueio) com agenda.editar e chamar o callback', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoEditar = vi.fn()
    comPermissoes(['agenda.ver', 'agenda.editar'])
    render(<PainelBloqueio aberto card={BLOQUEIO} aoFechar={() => {}} aoEditar={aoEditar} />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Editar' }))

    // ASSERT
    expect(aoEditar).toHaveBeenCalledWith(BLOQUEIO)
  })
})
