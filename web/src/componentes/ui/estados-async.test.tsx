import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'

describe('EstadoVazio', () => {
  it('deve exibir título, descrição e a ação como próximo passo', () => {
    // ARRANGE + ACT
    render(
      <EstadoVazio
        titulo="Nenhum paciente na lista de espera"
        descricao="Quando houver espera por horário, ela aparece aqui."
        acao={<Botao>Adicionar à espera</Botao>}
      />,
    )

    // ASSERT
    expect(screen.getByRole('heading', { name: 'Nenhum paciente na lista de espera' })).toBeInTheDocument()
    expect(screen.getByText('Quando houver espera por horário, ela aparece aqui.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adicionar à espera' })).toBeInTheDocument()
  })
})

describe('EstadoErro', () => {
  it('deve anunciar como alert e oferecer retry obrigatório', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoTentarNovamente = vi.fn()
    render(<EstadoErro mensagem="Não foi possível carregar a agenda." aoTentarNovamente={aoTentarNovamente} />)

    // ASSERT: role alert com mensagem humana
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a agenda.')

    // ACT: retry
    await usuario.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    // ASSERT
    expect(aoTentarNovamente).toHaveBeenCalledTimes(1)
  })

  it('deve renderizar mensagem maliciosa como texto literal', () => {
    // ARRANGE: contrato de string plana (T-ds-01)
    const payload = '<img src=x onerror=alert(1)>'

    // ACT
    render(<EstadoErro mensagem={payload} aoTentarNovamente={vi.fn()} />)

    // ASSERT
    expect(screen.getByRole('alert')).toHaveTextContent(payload)
    expect(document.querySelector('img')).toBeNull()
  })
})

describe('Skeleton', () => {
  it('deve ser decorativo e dimensionável pela caixa do conteúdo final', () => {
    // ARRANGE + ACT: CLS 0 — o consumidor passa a caixa exata
    const { container } = render(<Skeleton className="h-9 w-full" />)
    const skeleton = container.firstElementChild as HTMLElement

    // ASSERT
    expect(skeleton).toHaveAttribute('aria-hidden', 'true')
    expect(skeleton).toHaveClass('h-9', 'w-full', 'animate-pulse', 'bg-neutro-200')
  })
})
