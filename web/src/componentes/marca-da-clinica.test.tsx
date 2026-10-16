import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarcaDaClinica } from '@/componentes/marca-da-clinica'
import { useAuthStore } from '@/stores/auth-store'
import type { MarcaDaClinica as Marca } from '@/tipos'
import { usuarioFicticio } from '@/test/servidor-msw'

function comMarca(marca: Partial<Marca>): void {
  useAuthStore.setState({
    usuario: {
      ...usuarioFicticio,
      marca: { nome: '', identidade: 'nome', fonte: 'padrao', logo_versao: null, ...marca },
    },
    carregandoSessao: false,
  })
}

describe('MarcaDaClinica — a marca do cabeçalho (identidade-da-clinica)', () => {
  it('deve exibir o nome da clínica na fonte escolhida', () => {
    // ARRANGE
    comMarca({ nome: 'Clínica Feliz', identidade: 'nome', fonte: 'serifada' })

    // ACT
    render(<MarcaDaClinica />)

    // ASSERT
    const nome = screen.getByText('Clínica Feliz')
    expect(nome.style.fontFamily).toContain('serifada')
    // o monograma acompanha o nome e é decorativo (o nome já diz tudo)
    expect(screen.getByText('CF')).toHaveAttribute('aria-hidden', 'true')
  })

  it('deve exibir a logo com alt do nome quando identidade é logo com arquivo', () => {
    // ARRANGE
    comMarca({ nome: 'Clínica Feliz', identidade: 'logo', logo_versao: '20260722180000' })

    // ACT
    render(<MarcaDaClinica />)

    // ASSERT — cache-bust pela versão
    const logo = screen.getByRole('img', { name: 'Clínica Feliz' })
    expect(logo).toHaveAttribute('src', '/api/clinica/logo?v=20260722180000')
  })

  it('deve cair para o nome quando identidade é logo SEM arquivo', () => {
    // ARRANGE
    comMarca({ nome: 'Clínica Feliz', identidade: 'logo', logo_versao: null })

    // ACT
    render(<MarcaDaClinica />)

    // ASSERT
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Clínica Feliz')).toBeInTheDocument()
  })

  it('deve exibir o nome do produto sem nome e sem logo', () => {
    // ARRANGE
    comMarca({ nome: '', identidade: 'nome', logo_versao: null })

    // ACT
    render(<MarcaDaClinica />)

    // ASSERT — o nome e o símbolo do produto (change tema-xclinicas), sem o monograma
    expect(screen.getByText('Xclinicas')).toBeInTheDocument()
    expect(document.querySelector('img[src="/marca/simbolo.svg"]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText('X')).not.toBeInTheDocument()
  })
})
