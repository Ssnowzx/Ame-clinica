import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AvisoErro } from '@/componentes/ui/aviso-erro'

describe('AvisoErro', () => {
  it('deve anunciar o erro geral sem substituir o formulário', () => {
    // ARRANGE + ACT
    render(
      <form>
        <AvisoErro mensagens={['Conflito de horário nas datas: 2026-07-18, 2026-07-25.']} />
        <input aria-label="Observação" />
      </form>,
    )

    // ASSERT: anunciado (role=alert) e o formulário continua editável
    expect(screen.getByRole('alert')).toHaveTextContent('Conflito de horário nas datas')
    expect(screen.getByLabelText('Observação')).toBeEnabled()
  })

  it('deve exibir várias mensagens de uma vez', () => {
    // ARRANGE + ACT
    render(<AvisoErro mensagens={['Primeira recusa.', 'Segunda recusa.']} />)

    // ASSERT
    expect(screen.getByText('Primeira recusa.')).toBeInTheDocument()
    expect(screen.getByText('Segunda recusa.')).toBeInTheDocument()
  })

  it('deve sumir quando não há mensagem', () => {
    // ARRANGE + ACT
    const { container } = render(<AvisoErro mensagens={[]} />)

    // ASSERT
    expect(container).toBeEmptyDOMElement()
  })

  it('deve renderizar mensagem maliciosa como texto literal', () => {
    // ARRANGE: a mensagem vem do servidor e pode carregar dado (T-aes-12)
    const payload = '<img src=x onerror=alert(1)>'

    // ACT
    render(<AvisoErro mensagens={[payload]} />)

    // ASSERT
    expect(screen.getByRole('alert')).toHaveTextContent(payload)
    expect(document.querySelector('img')).toBeNull()
  })
})
