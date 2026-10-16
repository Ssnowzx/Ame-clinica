import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Paginacao } from '@/componentes/ui/paginacao'

describe('Paginacao', () => {
  it('deve renderizar como navegação nomeada com a página atual marcada', () => {
    // ARRANGE + ACT
    render(<Paginacao pagina={2} totalPaginas={3} aoMudar={vi.fn()} />)

    // ASSERT: aria-current + cor + peso (nunca só cor)
    expect(screen.getByRole('navigation', { name: 'Paginação' })).toBeInTheDocument()
    const atual = screen.getByRole('button', { name: 'Página 2' })
    expect(atual).toHaveAttribute('aria-current', 'page')
    expect(atual).toHaveClass('font-semibold', 'text-acento')
  })

  it('deve desabilitar de verdade os extremos', () => {
    // ARRANGE + ACT: primeira página
    render(<Paginacao pagina={1} totalPaginas={3} aoMudar={vi.fn()} />)

    // ASSERT: disabled real, não visual
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeEnabled()
  })

  it('deve disparar aoMudar com o número da página escolhida', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoMudar = vi.fn()
    render(<Paginacao pagina={1} totalPaginas={5} aoMudar={aoMudar} />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Próxima página' }))
    await usuario.click(screen.getByRole('button', { name: 'Página 5' }))

    // ASSERT
    expect(aoMudar).toHaveBeenNthCalledWith(1, 2)
    expect(aoMudar).toHaveBeenNthCalledWith(2, 5)
  })

  it('deve mostrar o número quando o buraco é de uma página só', () => {
    // ARRANGE + ACT: janela {1,3,4,5,8} — a página 2 é o único buraco à esquerda
    render(<Paginacao pagina={4} totalPaginas={8} aoMudar={vi.fn()} />)

    // ASSERT: reticências que escondem um só número custam mais do que economizam
    expect(screen.getByRole('button', { name: 'Página 2' })).toBeInTheDocument()
    expect(screen.getAllByText('…')).toHaveLength(1)
  })

  it('deve condensar janelas longas com reticências decorativas', () => {
    // ARRANGE + ACT: página no meio de muitas
    render(<Paginacao pagina={10} totalPaginas={20} aoMudar={vi.fn()} />)

    // ASSERT: primeira, vizinhas e última visíveis; buracos viram "…"
    expect(screen.getByRole('button', { name: 'Página 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página 9' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página 11' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Página 20' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Página 5' })).not.toBeInTheDocument()
    expect(screen.getAllByText('…')).toHaveLength(2)
  })

  it('deve anunciar o total de itens em role status', () => {
    // ARRANGE + ACT
    render(<Paginacao pagina={1} totalPaginas={3} aoMudar={vi.fn()} totalItens={128} />)

    // ASSERT
    expect(screen.getByRole('status')).toHaveTextContent('128 registros')
  })
})
