import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { describe, expect, it } from 'vitest'

import { ProvedorToast } from '@/componentes/ui/toast'
import { MostruarioDoDesignSystem } from '@/test/mostruario-do-design-system'

expect.extend(toHaveNoViolations)

/**
 * O mostruário deixou de ser rota do produto (a clínica não tem o que fazer com ele),
 * mas continua sendo o único lugar que renderiza o núcleo do design system INTEIRO de
 * uma vez — é aqui que o axe pega a violação que nasce da combinação, não do componente
 * isolado. Sem rota e sem menu: a galeria só existe para este teste.
 */
function renderizarMostruario() {
  return render(
    <ProvedorToast>
      <MostruarioDoDesignSystem />
    </ProvedorToast>,
  )
}

describe('Mostruário do design system — cobertura do núcleo', () => {
  it('deve exibir todos os componentes do núcleo em seus estados', () => {
    // ARRANGE + ACT
    renderizarMostruario()

    // ASSERT: uma seção por componente/fundação (cenário da spec)
    for (const secao of [
      'Tokens — cor',
      'Tokens — tipografia',
      'Tokens — raio e sombra',
      'Botao',
      'Campos',
      'CampoBusca',
      'AvisoErro',
      'ChipStatus',
      'MarcadorEspecialidade',
      'DialogConfirmacao',
      'Tabela',
      'Toast',
      'Estados async',
      'Paginacao',
    ]) {
      expect(screen.getByRole('heading', { name: secao })).toBeInTheDocument()
    }

    // estados-chave presentes
    expect(screen.getByRole('button', { name: 'Salvando…' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Cor inválida no cadastro')).toBeInTheDocument()
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1)
  })
})

describe('Mostruário do design system — a11y (4.2)', () => {
  it('deve não ter violações axe no estado base', async () => {
    // ARRANGE
    const { container } = renderizarMostruario()

    // ACT
    const resultado = await axe(container)

    // ASSERT: zero violações (piso §16 / WCAG 2.2 AA)
    expect(resultado).toHaveNoViolations()
  }, 30000)

  it('deve não ter violações axe com o DialogConfirmacao aberto', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarMostruario()

    // ACT: abre o dialog de perigo (renderiza em portal no body)
    await usuario.click(screen.getByRole('button', { name: 'Abrir confirmação de exclusão' }))
    const resultado = await axe(document.body)

    // ASSERT
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(resultado).toHaveNoViolations()
  }, 30000)

  it('deve percorrer os interativos por teclado a partir do topo', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizarMostruario()

    // ACT: primeiro Tab a partir do body
    await usuario.tab()

    // ASSERT: foco entra nos interativos (nenhuma armadilha)
    const primeiro = document.activeElement as HTMLElement
    expect(primeiro).not.toBe(document.body)
    expect(primeiro.tagName).toMatch(/^(BUTTON|INPUT|SELECT|A)$/)

    // ACT: navega mais alguns passos sem perder o foco da página
    for (let passo = 0; passo < 8; passo++) {
      await usuario.tab()
      expect(document.activeElement).not.toBe(document.body)
    }
  })
})
