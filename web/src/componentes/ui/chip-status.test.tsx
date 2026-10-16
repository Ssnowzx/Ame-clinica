import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChipStatus } from '@/componentes/ui/chip-status'
import { derivarTonsStatus } from '@/lib/cor-status'
import { iconeSeguro } from '@/lib/icone-status'

describe('ChipStatus', () => {
  it('deve sempre exibir ícone e rótulo junto da cor (1.4.1)', () => {
    // ARRANGE + ACT
    render(<ChipStatus nome="Finalizado" cor="#10B981" tipo="check" />)

    // ASSERT: cor nunca é o único canal
    expect(screen.getByText('Finalizado')).toBeInTheDocument()
    expect(document.querySelector('svg')).not.toBeNull()
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('deve aplicar o trio suave derivado, nunca a cor crua do cadastro', () => {
    // ARRANGE: clínica cadastrou vermelho puro (pior caso do §2)
    render(<ChipStatus nome="Urgente" cor="#FF0000" />)
    const chip = screen.getByText('Urgente').parentElement as HTMLElement

    // ACT: trio esperado pela mesma derivação memoizada
    const tons = derivarTonsStatus('#FF0000')

    // ASSERT: estilo aplicado é o normalizado (fundo suave), não #FF0000
    expect(chip.style.backgroundColor).not.toBe('rgb(255, 0, 0)')
    expect(chip.style.color).toBe(hexParaRgbCss(tons.texto))
    expect(chip.style.backgroundColor).toBe(hexParaRgbCss(tons.fundo))
  })

  it('deve cair no tom neutro sem crash quando a cor do cadastro é maliciosa', () => {
    // ARRANGE: payload de injeção de estilo (T-ds-02)
    render(<ChipStatus nome="Em Aberto" cor="red;position:fixed" />)
    const chip = screen.getByText('Em Aberto').parentElement as HTMLElement

    // ASSERT: renderiza com o trio neutro derivado — nenhum estilo injetado
    const neutro = derivarTonsStatus('cor-invalida')
    expect(chip.style.backgroundColor).toBe(hexParaRgbCss(neutro.fundo))
    expect(chip.getAttribute('style')).not.toContain('position')
  })

  it('deve renderizar nome de status malicioso como texto literal', () => {
    // ARRANGE: nome é dado editável da clínica (T-ds-01)
    const payload = '<script>alert(1)</script>'

    // ACT
    render(<ChipStatus nome={payload} cor="#64748B" />)

    // ASSERT
    expect(screen.getByText(payload)).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })

  it('deve usar o ícone fallback quando o tipo é desconhecido', () => {
    // ARRANGE + ACT: tipo fora do mapa §2.3
    render(<ChipStatus nome="Novo Status" cor="#64748B" tipo="tipo-inexistente" />)

    // ASSERT: fallback circle-dot presente (ícone nunca some)
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('deve não seguir a cadeia de protótipos ao resolver o ícone', () => {
    // ARRANGE: `tipo` é DADO editável pela clínica (T-sag-04) — um lookup ingênuo
    // devolveria Object.prototype/constructor e derrubaria a grade inteira
    const neutro = iconeSeguro('desconhecido')

    // ACT + ASSERT: todo payload hostil cai no ícone neutro, e é componente
    for (const payload of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', null, 42]) {
      const resolvido = iconeSeguro(payload)
      expect(resolvido).toBe(neutro)
      expect(typeof resolvido).toBe('object')
    }
  })

  it('deve renderizar sem quebrar quando o cadastro traz tipo hostil', () => {
    // ARRANGE + ACT
    render(<ChipStatus nome="Em Aberto" cor="#64748B" tipo="__proto__" />)

    // ASSERT: chip íntegro, com ícone neutro
    expect(screen.getByText('Em Aberto')).toBeInTheDocument()
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('deve virar controle real quando recebe ação', async () => {
    // ARRANGE: é assim que o fluxo do dia troca o status pela grade
    const usuario = userEvent.setup()
    const aoAcionar = vi.fn()
    render(
      <ChipStatus
        nome="Em Aberto"
        cor="#64748B"
        tipo="circle-dashed"
        aoAcionar={aoAcionar}
        rotuloDaAcao="Mudar status de Paciente Fictício"
      />,
    )

    // ACT: teclado, sem mouse
    const chip = screen.getByRole('button', { name: 'Mudar status de Paciente Fictício' })
    chip.focus()
    await usuario.keyboard('{Enter}')

    // ASSERT: ícone e rótulo continuam lá (cor nunca é canal único)
    expect(aoAcionar).toHaveBeenCalledTimes(1)
    expect(chip).toHaveTextContent('Em Aberto')
    expect(chip.querySelector('svg')).not.toBeNull()
  })

  it('deve continuar sendo texto quando não recebe ação', () => {
    // ARRANGE + ACT: retrocompatível — na grade em leitura o chip não é botão
    render(<ChipStatus nome="Em Aberto" cor="#64748B" />)

    // ASSERT
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('deve expor o nome completo via title para truncamento na grade', () => {
    // ARRANGE + ACT
    render(<ChipStatus nome="Finalizado com Evolução" cor="#059669" />)

    // ASSERT
    expect(screen.getByTitle('Finalizado com Evolução')).toBeInTheDocument()
  })
})

// jsdom serializa cores de style como rgb(r, g, b)
function hexParaRgbCss(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${r}, ${g}, ${b})`
}
