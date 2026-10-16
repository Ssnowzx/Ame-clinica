import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarcadorEspecialidade } from '@/componentes/ui/marcador-especialidade'

describe('MarcadorEspecialidade', () => {
  it('deve ser decorativo (aria-hidden) — o nome vem em texto no consumidor', () => {
    // ARRANGE + ACT
    const { container } = render(<MarcadorEspecialidade cor="#A85550" />)

    // ASSERT: cor nunca é o único canal (1.4.1)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('deve renderizar como fio fino, nunca preenchimento', () => {
    // ARRANGE + ACT
    const { container } = render(<MarcadorEspecialidade cor="#A85550" />)

    // ASSERT: a assinatura de 3px (única exceção de valor arbitrário, §5.5)
    expect(container.firstElementChild).toHaveClass('w-[3px]')
  })

  it('deve cair no neutro sem crash quando a cor do cadastro é maliciosa', () => {
    // ARRANGE + ACT: payload de injeção de estilo (T-ds-02)
    const { container } = render(<MarcadorEspecialidade cor="url(javascript:alert(1))" />)
    const marcador = container.firstElementChild as HTMLElement

    // ASSERT: fallback neutro-450, nenhum estilo injetado
    expect(marcador.style.backgroundColor).toBe('rgb(143, 138, 128)')
    expect(marcador.getAttribute('style')).not.toContain('url')
  })
})
