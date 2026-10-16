import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AvatarDoProfissional } from '@/componentes/agenda/avatar-do-profissional'

describe('AvatarDoProfissional — foto quando há, iniciais quando não', () => {
  it('deve mostrar as iniciais com o anel da especialidade sem foto', () => {
    // ARRANGE + ACT
    render(<AvatarDoProfissional nome="Ana Fictícia Souza" cor="#A85550" />)

    // ASSERT: decorativo, iniciais, anel na cor cadastrada
    const avatar = screen.getByText('AS')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar.getAttribute('style')).toContain('border-color')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('deve mostrar a foto do cadastro, versionada, quando há foto', () => {
    // ARRANGE + ACT
    const { container } = render(
      <AvatarDoProfissional id={7} nome="Ana Fictícia Souza" cor={null} fotoVersao="20260902110000" />,
    )

    // ASSERT: imagem decorativa (alt vazio) apontando para a foto do cadastro, com a versão
    const imagem = container.querySelector('img')
    expect(imagem).toHaveAttribute('src', '/api/profissionais/7/foto?v=20260902110000')
    expect(imagem).toHaveAttribute('alt', '')
    expect(screen.queryByText('AS')).not.toBeInTheDocument()
  })

  it('deve cair nas iniciais quando a imagem falha', () => {
    // ARRANGE
    const { container } = render(
      <AvatarDoProfissional id={7} nome="Ana Fictícia Souza" cor={null} fotoVersao="20260902110000" />,
    )
    const imagem = container.querySelector('img')
    expect(imagem).not.toBeNull()

    // ACT
    fireEvent.error(imagem as HTMLImageElement)

    // ASSERT
    expect(screen.getByText('AS')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })
})
