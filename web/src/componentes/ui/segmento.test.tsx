import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'

import { Etiqueta } from '@/componentes/ui/etiqueta'
import { Segmento } from '@/componentes/ui/segmento'

expect.extend(toHaveNoViolations)

const OPCOES = [
  { valor: 'dia', rotulo: 'Dia' },
  { valor: 'semana', rotulo: 'Semana' },
] as const

describe('Segmento — uma pele para todo controle segmentado', () => {
  it('deve anunciar a opção ativa por aria-pressed e pintá-la com o acento', () => {
    // ARRANGE + ACT
    render(<Segmento rotulo="Visão" opcoes={OPCOES} valor="semana" aoMudar={() => undefined} />)

    // ASSERT
    expect(screen.getByRole('group', { name: 'Visão' })).toBeInTheDocument()
    const ativa = screen.getByRole('button', { name: 'Semana', pressed: true })
    expect(ativa).toHaveClass('bg-segmento-ativo')
    expect(screen.getByRole('button', { name: 'Dia', pressed: false })).not.toHaveClass('bg-segmento-ativo')
  })

  it('deve contornar a opção escolhida e usar o raio próprio do trilho (change tema-da-clinica)', () => {
    // ARRANGE + ACT — no tema, a escolhida é clara sobre trilho claro: sem o contorno ela some
    // (1,16:1, gate r2); e o trilho com o raio do botão virava oval ao quebrar linha
    render(<Segmento rotulo="Visão" opcoes={OPCOES} valor="semana" aoMudar={() => undefined} />)

    // ASSERT
    expect(screen.getByRole('button', { name: 'Semana', pressed: true })).toHaveClass('ring-1', 'ring-segmento-ativo-borda')
    expect(screen.getByRole('group', { name: 'Visão' })).toHaveClass('rounded-trilho')
  })

  it('deve avisar o valor escolhido ao clicar', async () => {
    // ARRANGE
    const aoMudar = vi.fn()
    const usuario = userEvent.setup()
    render(<Segmento rotulo="Visão" opcoes={OPCOES} valor="dia" aoMudar={aoMudar} />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Semana' }))

    // ASSERT
    expect(aoMudar).toHaveBeenCalledWith('semana')
  })
})

describe('Etiqueta — estado fixo com palavra, nunca só cor', () => {
  it('deve pintar o tom pedido e manter o texto como sinal', async () => {
    // ARRANGE + ACT
    const { container } = render(
      <>
        <Etiqueta tom="sucesso">Ativo</Etiqueta>
        <Etiqueta tom="perigo">Urgente</Etiqueta>
      </>,
    )

    // ASSERT
    expect(screen.getByText('Ativo')).toHaveClass('bg-sucesso-suave', 'text-sucesso-texto')
    expect(screen.getByText('Urgente')).toHaveClass('bg-perigo-suave', 'text-perigo-texto')
    expect(await axe(container)).toHaveNoViolations()
  })
})
