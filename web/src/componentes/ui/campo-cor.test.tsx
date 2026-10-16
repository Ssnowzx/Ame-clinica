import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CampoCor } from '@/componentes/ui/campo-cor'

expect.extend(toHaveNoViolations)

function CampoControlado({ inicial = '#16695F' }: { inicial?: string }) {
  const [cor, setCor] = useState(inicial)
  return <CampoCor rotulo="Cor da especialidade" valor={cor} aoMudar={setCor} />
}

/** O seletor nativo não expõe `role`; o campo de texto é quem tem nome acessível. */
function seletorNativo(): HTMLInputElement {
  const seletor = document.querySelector('input[type="color"]')
  if (seletor === null) throw new Error('seletor de cor não renderizado')
  return seletor as HTMLInputElement
}

describe('CampoCor', () => {
  it('deve deixar colar o hexadecimal que veio do manual de marca', async () => {
    // ARRANGE: o seletor nativo do SO não aceita colar — e é assim que a clínica
    // recebe a cor da identidade dela
    const usuario = userEvent.setup()
    render(<CampoControlado inicial="" />)
    const texto = screen.getByRole('textbox', { name: /código hexadecimal/i })

    // ACT
    await usuario.type(texto, '#A31621')

    // ASSERT
    expect(texto).toHaveValue('#A31621')
    expect(seletorNativo().value).toBe('#a31621')
  })

  it('deve devolver a cor em maiúsculas — o mesmo formato que a API exige', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoMudar = vi.fn()
    render(<CampoCor rotulo="Cor" valor="" aoMudar={aoMudar} />)

    // ACT
    await usuario.type(screen.getByRole('textbox', { name: /código hexadecimal/i }), 'a')

    // ASSERT
    expect(aoMudar).toHaveBeenCalledWith('A')
  })

  it('deve segurar o seletor numa cor válida enquanto o texto está pela metade', () => {
    // ARRANGE: `<input type="color">` com valor inválido cai em PRETO sem avisar —
    // a pessoa digitando "#A31" veria a cor saltar para preto sem entender
    render(<CampoCor rotulo="Cor" valor="#A31" aoMudar={() => {}} />)

    // ACT
    const seletor = seletorNativo()

    // ASSERT
    expect(seletor.value).not.toBe('#000000')
    expect(screen.getByRole('textbox', { name: /código hexadecimal/i })).toHaveValue('#A31')
  })

  it('deve marcar o erro do servidor nos dois controles', () => {
    // ARRANGE + ACT
    render(<CampoCor rotulo="Cor" valor="#ZZZ" aoMudar={() => {}} erro="Cor inválida — use #RRGGBB." />)

    // ASSERT: borda nunca é o único sinal — a mensagem tem ícone e texto
    expect(screen.getByRole('alert')).toHaveTextContent('Cor inválida — use #RRGGBB.')
    expect(seletorNativo()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: /código hexadecimal/i })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('deve ter nome acessível que não depende do seletor do sistema', () => {
    // ARRANGE + ACT: "cor" é o TIPO do controle, não o papel dele na tela
    render(<CampoControlado />)

    // ASSERT
    expect(screen.getByRole('textbox', { name: 'Cor da especialidade — código hexadecimal' }))
      .toBeInTheDocument()
    expect(screen.getByText('Cor da especialidade')).toBeInTheDocument()
  })

  it('deve não ter violações axe', async () => {
    // ARRANGE
    const { container } = render(<CampoControlado />)

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  })
})
