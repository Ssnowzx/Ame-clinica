import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { CampoTextoLongo } from '@/componentes/ui/campo-texto-longo'

expect.extend(toHaveNoViolations)

/** Controlado, como o formulário o usa. */
function CampoControlado({ limite }: { limite?: number }) {
  const [valor, setValor] = useState('')

  return (
    <CampoTextoLongo
      rotulo="Observação"
      value={valor}
      limite={limite}
      onChange={(evento) => {
        setValor(evento.target.value)
      }}
    />
  )
}

describe('CampoTextoLongo', () => {
  it('deve ligar o rótulo ao controle', () => {
    // ARRANGE + ACT
    render(<CampoTextoLongo rotulo="Observação" value="" onChange={() => {}} />)

    // ASSERT
    expect(screen.getByLabelText('Observação')).toBeInTheDocument()
  })

  it('deve dizer quantos caracteres ainda cabem', async () => {
    // ARRANGE — o limite é do servidor; truncar em silêncio é pior que avisar
    const usuario = userEvent.setup()
    render(<CampoControlado limite={10} />)

    // ACT
    await usuario.type(screen.getByLabelText('Observação'), 'abc')

    // ASSERT
    expect(screen.getByText('7 caracteres restantes')).toBeInTheDocument()
  })

  it('deve concordar o contador no singular', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<CampoControlado limite={3} />)

    // ACT
    await usuario.type(screen.getByLabelText('Observação'), 'ab')

    // ASSERT
    expect(screen.getByText('1 caractere restante')).toBeInTheDocument()
  })

  it('deve anexar ajuda e erro e marcar aria-invalid', () => {
    // ARRANGE + ACT
    render(
      <CampoTextoLongo
        rotulo="Observação"
        value=""
        onChange={() => {}}
        ajuda="Contexto operacional"
        erro="Máximo de 2000 caracteres."
      />,
    )
    const campo = screen.getByLabelText('Observação')

    // ASSERT
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Máximo de 2000 caracteres.')
    expect(screen.getByText('Contexto operacional')).toBeInTheDocument()
  })

  it('deve renderizar conteúdo malicioso como texto literal', () => {
    // ARRANGE — o valor vem de dado (T-ds-01)
    const payload = '<script>alert(1)</script>'

    // ACT
    render(<CampoTextoLongo rotulo="Observação" value={payload} onChange={() => {}} />)

    // ASSERT
    expect(screen.getByLabelText('Observação')).toHaveValue(payload)
    expect(document.querySelector('script')).toBeNull()
  })

  it('não deve ter violações de acessibilidade', async () => {
    // ARRANGE + ACT
    const { container } = render(
      <CampoTextoLongo rotulo="Observação" value="texto" limite={100} onChange={() => {}} erro="Erro fictício" />,
    )

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})
