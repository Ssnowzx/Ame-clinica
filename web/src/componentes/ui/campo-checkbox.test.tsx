import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'

describe('CampoCheckbox', () => {
  it('deve refletir o estado marcado e disparar aoMudar no clique', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoMudar = vi.fn()
    render(<CampoCheckbox rotulo="Desconta sessão" marcado={false} aoMudar={aoMudar} />)

    // ACT
    await usuario.click(screen.getByRole('checkbox', { name: 'Desconta sessão' }))

    // ASSERT
    expect(aoMudar).toHaveBeenCalledWith(true)
  })

  it('deve alternar pelo teclado com Espaço', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoMudar = vi.fn()
    render(<CampoCheckbox rotulo="Ativo" marcado={false} aoMudar={aoMudar} />)

    // ACT: foco + espaço (piso de teclado §4)
    screen.getByRole('checkbox').focus()
    await usuario.keyboard(' ')

    // ASSERT
    expect(aoMudar).toHaveBeenCalledWith(true)
  })

  it('deve estender a área clicável ao rótulo', async () => {
    // ARRANGE: alvo ≥ 24 via rótulo clicável (contrato §5.3)
    const usuario = userEvent.setup()
    const aoMudar = vi.fn()
    render(<CampoCheckbox rotulo="Ativo" marcado={false} aoMudar={aoMudar} />)

    // ACT: clique no texto do rótulo
    await usuario.click(screen.getByText('Ativo'))

    // ASSERT
    expect(aoMudar).toHaveBeenCalledWith(true)
  })

  it('deve não disparar quando desabilitado', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoMudar = vi.fn()
    render(<CampoCheckbox rotulo="Ativo" marcado={false} aoMudar={aoMudar} desabilitado />)

    // ACT
    await usuario.click(screen.getByText('Ativo'))

    // ASSERT
    expect(aoMudar).not.toHaveBeenCalled()
  })

  it('deve expor erro com role alert', () => {
    // ARRANGE + ACT
    render(<CampoCheckbox rotulo="Aceite" marcado={false} aoMudar={() => undefined} erro="Confirmação necessária" />)

    // ASSERT
    expect(screen.getByRole('alert')).toHaveTextContent('Confirmação necessária')
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('CampoCheckbox — "sem ajuda" tem mais de um idioma', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['false', false],
    ['string vazia', ''],
  ])('deve não renderizar parágrafo de ajuda quando ajuda é %s', (_nome, ajuda) => {
    // ARRANGE + ACT — desde que `ajuda` virou ReactNode, `null` e `false` são os idiomas
    // naturais de um ternário em JSX; o render próprio deste componente só conhecia
    // `undefined` e deixava um <p> VAZIO com o id da ajuda (achado I4 do gate)
    const { container } = render(
      <CampoCheckbox rotulo="Ativa" marcado aoMudar={() => undefined} ajuda={ajuda} />,
    )

    // ASSERT
    expect(container.querySelector('p[id$="-ajuda"]')).toBeNull()
    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-describedby')
  })

  it('deve renderizar e associar a ajuda quando ela existe', () => {
    // ARRANGE + ACT
    render(
      <CampoCheckbox rotulo="Ativa" marcado aoMudar={() => undefined} ajuda="Conta inativa fica no histórico." />,
    )

    // ASSERT
    const caixa = screen.getByRole('checkbox')
    const primeiroId = (caixa.getAttribute('aria-describedby') ?? '').split(' ')[0] ?? ''
    expect(primeiroId).not.toBe('')
    expect(document.getElementById(primeiroId)?.textContent).toBe(
      'Conta inativa fica no histórico.',
    )
  })
})
