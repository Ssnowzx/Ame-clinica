import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CampoSelect } from '@/componentes/ui/campo-select'

const OPCOES = [
  { valor: 'fono', rotulo: 'Fonoaudiologia' },
  { valor: 'psico', rotulo: 'Psicologia' },
] as const

describe('CampoSelect', () => {
  it('deve renderizar select nativo com as opções e o rótulo ligado', () => {
    // ARRANGE + ACT
    render(<CampoSelect rotulo="Especialidade" opcoes={OPCOES} />)

    // ASSERT: <select> nativo (teclado/AT do browser de graça)
    const select = screen.getByLabelText('Especialidade')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getByRole('option', { name: 'Fonoaudiologia' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Psicologia' })).toBeInTheDocument()
  })

  it('deve completar o nome acessível só para o leitor de tela, começando pelo rótulo visível', () => {
    // ARRANGE + ACT — o rótulo visível é um NOME; o campo diz o que é só a quem não vê
    render(<CampoSelect rotulo="Aluguel" complementoDoRotulo=": linha do DRE" opcoes={OPCOES} />)

    // ASSERT
    const select = screen.getByRole('combobox', { name: 'Aluguel: linha do DRE' })
    expect(select.tagName).toBe('SELECT')
    expect(screen.getByText(': linha do DRE')).toHaveClass('sr-only')
    expect(select).not.toHaveAttribute('complementoDoRotulo')
  })

  it('deve renderizar o placeholder como opção desabilitada', () => {
    // ARRANGE + ACT
    render(<CampoSelect rotulo="Especialidade" opcoes={OPCOES} placeholder="Selecione…" defaultValue="" />)

    // ASSERT
    const placeholder = screen.getByRole('option', { name: 'Selecione…' })
    expect(placeholder).toBeDisabled()
    expect(placeholder).toHaveValue('')
  })

  it('deve disparar onChange ao escolher opção', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoMudar = vi.fn()
    render(<CampoSelect rotulo="Especialidade" opcoes={OPCOES} onChange={aoMudar} />)

    // ACT
    await usuario.selectOptions(screen.getByLabelText('Especialidade'), 'psico')

    // ASSERT
    expect(aoMudar).toHaveBeenCalledTimes(1)
  })

  it('deve expor erro com role alert e aria-invalid', () => {
    // ARRANGE + ACT
    render(<CampoSelect rotulo="Especialidade" opcoes={OPCOES} erro="Escolha uma especialidade" />)

    // ASSERT: borda nunca é o único sinal (1.4.1)
    expect(screen.getByLabelText('Especialidade')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha uma especialidade')
  })

  it('deve renderizar rótulo de opção malicioso como texto literal', () => {
    // ARRANGE: nome de cadastro vindo de dado (T-ds-01)
    const payload = '<img src=x onerror=alert(1)>'

    // ACT
    render(<CampoSelect rotulo="Especialidade" opcoes={[{ valor: 'x', rotulo: payload }]} />)

    // ASSERT
    expect(screen.getByRole('option', { name: payload })).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
})
