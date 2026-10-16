import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { describe, expect, it } from 'vitest'

import { DicaVisual } from '@/componentes/ui/dica-visual'

expect.extend(toHaveNoViolations)

function AlvoDeIcone() {
  return (
    <button type="button" className="relative">
      <span aria-hidden="true">◆</span>
      <span className="sr-only">Agenda</span>
      <DicaVisual>Agenda</DicaVisual>
    </button>
  )
}

/** A dica é `aria-hidden`: nenhuma query por papel a alcança — é assim que ela deve ser. */
function dica(): HTMLElement {
  const encontrada = document.querySelector('[data-visivel]')
  if (encontrada === null) throw new Error('dica não renderizada')
  return encontrada as HTMLElement
}

describe('DicaVisual', () => {
  it('deve ficar fora da árvore de acessibilidade — o rótulo já é o nome do alvo', () => {
    // ARRANGE / ACT
    render(<AlvoDeIcone />)

    // ASSERT: o leitor de tela ouve "Agenda" uma vez (do sr-only), não duas
    expect(screen.getByRole('button', { name: 'Agenda' })).toBeInTheDocument()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(dica()).toHaveAttribute('aria-hidden', 'true')
  })

  it('deve nascer escondida e aparecer quando o ponteiro entra no alvo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<AlvoDeIcone />)
    expect(dica()).toHaveAttribute('data-visivel', 'nao')

    // ACT
    await usuario.hover(screen.getByRole('button', { name: 'Agenda' }))

    // ASSERT
    expect(dica()).toHaveAttribute('data-visivel', 'sim')
  })

  it('deve aparecer também no foco — o teclado enxerga a dica', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<AlvoDeIcone />)

    // ACT
    await usuario.tab()

    // ASSERT
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveFocus()
    expect(dica()).toHaveAttribute('data-visivel', 'sim')
  })

  it('deve ser dispensada com Esc sem tirar o foco do alvo (WCAG 1.4.13)', async () => {
    // ARRANGE: dica que cobre a tela e não sai é armadilha para quem usa lupa
    const usuario = userEvent.setup()
    render(<AlvoDeIcone />)
    await usuario.tab()
    expect(dica()).toHaveAttribute('data-visivel', 'sim')

    // ACT
    await usuario.keyboard('{Escape}')

    // ASSERT
    expect(dica()).toHaveAttribute('data-visivel', 'nao')
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveFocus()
  })

  it('deve ser sobrevoável — sem vão entre o alvo e a dica (WCAG 1.4.13)', () => {
    // ARRANGE: o jsdom NÃO tem geometria — `userEvent.hover(dica)` teleporta o
    // ponteiro para dentro do elemento e passaria mesmo com um abismo no meio.
    // A prova possível aqui é ESTRUTURAL: a dica recebe ponteiro e o afastamento
    // de 8px é coberto por uma ponte, senão o mouseleave dispara no vão.
    render(<AlvoDeIcone />)

    // ACT
    const classes = dica().className

    // ASSERT
    expect(classes).not.toContain('pointer-events-none')
    expect(classes).toContain('ml-2')
    expect(classes).toContain('before:-left-2')
    expect(classes).toContain('before:w-2')
  })

  it('deve continuar aparecendo depois de um Esc dado em outro lugar', async () => {
    // ARRANGE: fechar um dialog com Esc é gesto rotineiro — e marcava a dica como
    // dispensada para sempre, deixando o trilho sem rótulo visual nenhum
    const usuario = userEvent.setup()
    render(<AlvoDeIcone />)
    await usuario.keyboard('{Escape}')

    // ACT
    await usuario.hover(screen.getByRole('button', { name: 'Agenda' }))

    // ASSERT
    expect(dica()).toHaveAttribute('data-visivel', 'sim')
  })

  it('deve não ter violação de acessibilidade', async () => {
    // ARRANGE
    const { container } = render(<AlvoDeIcone />)

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
