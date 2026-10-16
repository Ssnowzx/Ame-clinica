import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AvatarDoUsuario } from '@/componentes/avatar-do-usuario'
import { ErroDeApi } from '@/lib/http'
import { enviarAvatar, removerAvatar } from '@/servicos/avatar'
import { useAuthStore } from '@/stores/auth-store'
import { usuarioFicticio } from '@/test/servidor-msw'

vi.mock('@/servicos/avatar', () => ({
  enviarAvatar: vi.fn(),
  removerAvatar: vi.fn(),
}))

expect.extend(toHaveNoViolations)

const enviarAvatarMock = vi.mocked(enviarAvatar)
const removerAvatarMock = vi.mocked(removerAvatar)

/** Loga um usuário com (ou sem) foto. */
function entrar(avatarVersao: string | null): void {
  useAuthStore.setState({
    usuario: { ...usuarioFicticio, avatar_versao: avatarVersao },
    carregandoSessao: false,
  })
}

afterEach(() => {
  useAuthStore.setState({ usuario: null, carregandoSessao: false })
  vi.clearAllMocks()
})

describe('AvatarDoUsuario — foto de perfil na barra de conta', () => {
  it('deve exibir a imagem quando há avatar_versao', () => {
    // ARRANGE
    entrar('20260101000000')

    // ACT
    const { container } = render(<AvatarDoUsuario />)

    // ASSERT — <img> com o cache-bust da versão
    const imagem = container.querySelector('img')
    expect(imagem).not.toBeNull()
    expect(imagem).toHaveAttribute('src', '/api/me/avatar?v=20260101000000')
  })

  it('deve cair para o ícone quando não há foto', () => {
    // ARRANGE
    entrar(null)

    // ACT
    const { container } = render(<AvatarDoUsuario />)

    // ASSERT — sem imagem; o ícone (svg) no lugar
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('deve cair para o ícone quando a imagem falha ao carregar (onError)', () => {
    // ARRANGE — há versão, então a imagem tenta carregar
    entrar('20260101000000')
    const { container } = render(<AvatarDoUsuario />)
    const imagem = container.querySelector('img')
    expect(imagem).not.toBeNull()

    // ACT — a imagem falha (drift: versão presente mas GET 404)
    fireEvent.error(imagem as HTMLImageElement)

    // ASSERT — nunca o ícone quebrado do navegador; cai para o svg
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('deve enviar a foto pelo menu e refletir na barra (store atualizado)', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    enviarAvatarMock.mockResolvedValue({ avatar_versao: '20260202000000' })
    entrar(null)
    const { container } = render(<AvatarDoUsuario />)

    // ACT — abre o menu e escolhe um arquivo
    await usuario.click(screen.getByRole('button', { name: 'Foto de perfil' }))
    const arquivo = new File(['imagem'], 'foto.png', { type: 'image/png' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [arquivo] } })

    // ASSERT — serviço chamado, versão da sessão atualizada, imagem na barra
    await waitFor(() => expect(enviarAvatarMock).toHaveBeenCalledWith(arquivo))
    await waitFor(() => {
      expect(useAuthStore.getState().usuario?.avatar_versao).toBe('20260202000000')
    })
    await waitFor(() => {
      const imagem = container.querySelector('img')
      expect(imagem).toHaveAttribute('src', '/api/me/avatar?v=20260202000000')
    })
  })

  it('deve mostrar mensagem legível quando o servidor recusa o arquivo (422)', async () => {
    // ARRANGE — a recusa do servidor vem no campo `arquivo`
    const usuario = userEvent.setup()
    enviarAvatarMock.mockRejectedValue(
      new ErroDeApi('invalido', 'Dados inválidos.', {
        arquivo: ['Formato não aceito. Envie PNG, JPG ou WebP.'],
      }),
    )
    entrar(null)
    const { container } = render(<AvatarDoUsuario />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Foto de perfil' }))
    const arquivo = new File(['x'], 'foto.svg', { type: 'image/svg+xml' })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [arquivo] } })

    // ASSERT — a mensagem do servidor aparece; nada quebra
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Formato não aceito. Envie PNG, JPG ou WebP.',
    )
    expect(useAuthStore.getState().usuario?.avatar_versao).toBeNull()
  })

  it('deve esconder "Remover foto" sem foto e voltar ao ícone ao remover', async () => {
    // ARRANGE — sem foto, o menu não oferece remover
    const usuario = userEvent.setup()
    entrar(null)
    const { rerender } = render(<AvatarDoUsuario />)
    await usuario.click(screen.getByRole('button', { name: 'Foto de perfil' }))
    expect(screen.queryByRole('button', { name: 'Remover foto' })).not.toBeInTheDocument()
    await usuario.keyboard('{Escape}')

    // ACT — agora COM foto: remover volta ao ícone
    removerAvatarMock.mockResolvedValue(undefined)
    entrar('20260101000000')
    rerender(<AvatarDoUsuario />)
    await usuario.click(screen.getByRole('button', { name: 'Foto de perfil' }))
    await usuario.click(screen.getByRole('button', { name: 'Remover foto' }))

    // ASSERT
    await waitFor(() => expect(removerAvatarMock).toHaveBeenCalledTimes(1))
    await waitFor(() => {
      expect(useAuthStore.getState().usuario?.avatar_versao).toBeNull()
    })
  })

  it('deve não ter violações axe com o menu aberto', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    entrar('20260101000000')
    const { container } = render(<AvatarDoUsuario />)

    // ACT
    await usuario.click(screen.getByRole('button', { name: 'Foto de perfil' }))
    await screen.findByRole('button', { name: 'Enviar foto' })
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})
