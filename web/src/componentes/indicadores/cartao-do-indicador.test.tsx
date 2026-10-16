import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { CartaoDoIndicador, type CartaoDoIndicadorProps } from '@/componentes/indicadores/cartao-do-indicador'
import { compararContagem, compararTaxa } from '@/lib/indicadores/frases'
import { periodoFicticio } from '@/test/dados-paineis'

expect.extend(toHaveNoViolations)

const PERIODO = periodoFicticio()
const DEFINICAO = ['Sessões marcadas no período ÷ horários disponíveis na grade dos profissionais.', 'A grade já desconta feriados.']

function renderizar(sobrescritas: Partial<CartaoDoIndicadorProps> = {}) {
  return render(
    <MemoryRouter>
      <CartaoDoIndicador
        rotulo="Ocupação"
        valor="87%"
        comparacao={compararTaxa(0.87, 0.91, PERIODO, 'subir-e-bom')}
        frase={[{ texto: 'Calculada sobre ' }, { texto: '9 de 12 profissionais', destaque: true }, { texto: '.' }]}
        definicao={DEFINICAO}
        {...sobrescritas}
      />
    </MemoryRouter>,
  )
}

describe('CartaoDoIndicador — número, comparação, frase e definição', () => {
  it('deve mostrar o rótulo, o número e a frase com o destaque em negrito', () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT
    const cartao = screen.getByRole('region', { name: 'Ocupação' })
    expect(within(cartao).getByText('87%')).toBeInTheDocument()
    expect(within(cartao).getByText('9 de 12 profissionais').tagName).toBe('STRONG')
  })

  it('deve escrever a comparação com SETA e TEXTO, nunca só a cor', () => {
    // ARRANGE + ACT
    const { container } = renderizar()

    // ASSERT — a direção está no texto ("a menos") e na seta; a cor é só reforço
    const variacao = container.querySelector('[data-comparacao="queda"]')
    expect(variacao).not.toBeNull()
    expect(variacao).toHaveTextContent('4 p.p. a menos')
    expect(variacao?.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(variacao?.className).toContain('text-perigo-texto')
    expect(screen.getByText('que em 1º a 5 de setembro')).toBeInTheDocument()
  })

  it('deve dizer em TEXTO, para o leitor de tela, se a variação é melhora ou piora', () => {
    // ARRANGE + ACT — a cor diz "piorou"; quem não vê a cor ouve a mesma coisa (A11Y-IND-04)
    const { container, unmount } = renderizar({ comparacao: compararTaxa(0.0602, 0.0455, PERIODO, 'subir-e-ruim') })

    // ASSERT
    expect(container.querySelector('[data-comparacao="alta"]')).toHaveTextContent('1,5 p.p. a mais (piora)')
    unmount()
    const melhora = renderizar({ comparacao: compararTaxa(0.91, 0.87, PERIODO, 'subir-e-bom') })
    expect(melhora.container.querySelector('[data-comparacao="alta"]')).toHaveTextContent('4 p.p. a mais (melhora)')
  })

  it('não deve dar juízo à variação neutra', () => {
    // ARRANGE + ACT — pacientes ativos: subir não é bom nem ruim
    const { container } = renderizar({ comparacao: compararContagem({ atual: 30, anterior: 20 }, PERIODO, 'neutra') })

    // ASSERT
    expect(container.querySelector('[data-comparacao="alta"]')).not.toHaveTextContent(/melhora|piora/)
  })

  it('deve escrever a linha neutra no lugar da comparação, sem seta e sem cor', () => {
    // ARRANGE + ACT — DQ-05: a grandeza que é foto do momento ganha a linha, e a anatomia fica igual
    const { container } = renderizar({ comparacao: undefined, contexto: 'situação de hoje' })

    // ASSERT
    const linha = container.querySelector('[data-contexto]')
    expect(linha).toHaveTextContent('situação de hoje')
    expect(linha?.querySelector('svg')).toBeNull()
    expect(container.querySelector('[data-comparacao]')).toBeNull()
  })

  it('deve escrever "antes era zero" — e não repetir o número — quando o anterior era zero', () => {
    // ARRANGE + ACT — DQ-09: "5 a mais que em …" com 5 agora repetia o valor
    renderizar({ valor: '5', comparacao: compararContagem({ atual: 5, anterior: 0 }, PERIODO, 'subir-e-bom') })

    // ASSERT
    expect(screen.getByRole('region', { name: 'Ocupação' })).toHaveTextContent('antes era zero (melhora)em 1º a 5 de setembro')
  })

  it('deve pintar de vermelho a ALTA de uma grandeza em que subir é ruim', () => {
    // ARRANGE + ACT — faltas subindo
    const { container } = renderizar({ comparacao: compararTaxa(0.0602, 0.0455, PERIODO, 'subir-e-ruim') })

    // ASSERT
    const variacao = container.querySelector('[data-comparacao="alta"]')
    expect(variacao).toHaveTextContent('1,5 p.p. a mais')
    expect(variacao?.className).toContain('text-perigo-texto')
  })

  it('deve dizer "sem comparação" em texto e SEM seta quando não há período comparado', () => {
    // ARRANGE + ACT — o primeiro mês do sistema
    const { container } = renderizar({ comparacao: compararContagem({ atual: 24, anterior: null }, PERIODO, 'subir-e-bom') })

    // ASSERT
    const semComparacao = container.querySelector('[data-comparacao="sem"]')
    expect(semComparacao).toHaveTextContent('sem comparação')
    expect(semComparacao?.querySelector('svg')).toBeNull()
    expect(container.querySelector('[data-comparacao="alta"], [data-comparacao="queda"], [data-comparacao="igual"]')).toBeNull()
  })

  it('não deve dizer "sem comparação" numa grandeza que não se compara por natureza', () => {
    // ARRANGE + ACT — os pacientes ativos são uma foto do momento
    renderizar({ rotulo: 'Ativos', valor: '432', legenda: 'em atendimento hoje', comparacao: undefined })

    // ASSERT
    expect(screen.getByText('em atendimento hoje')).toBeInTheDocument()
    expect(screen.queryByText('sem comparação')).not.toBeInTheDocument()
  })

  it('deve abrir a definição pelo TECLADO, anunciá-la e devolver o foco ao "i" ao fechar', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    const gatilho = screen.getByRole('button', { name: 'Como se calcula: Ocupação' })

    // ACT — Tab até o "i" e Enter, sem mouse
    await usuario.tab()
    expect(gatilho).toHaveFocus()
    await usuario.keyboard('{Enter}')

    // ASSERT — o painel tem nome e a definição é a DESCRIÇÃO dele (o leitor de tela a anuncia)
    const painel = await screen.findByRole('dialog', { name: 'Como se calcula: Ocupação' })
    expect(painel).toHaveAccessibleDescription(DEFINICAO.join(' '))
    expect(gatilho).toHaveAttribute('aria-expanded', 'true')

    // ACT — Esc fecha
    await usuario.keyboard('{Escape}')

    // ASSERT — e o foco volta a quem abriu
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(gatilho).toHaveFocus()
  })

  it('deve oferecer a porta como link real só quando ela é passada', () => {
    // ARRANGE + ACT
    renderizar({ porta: { para: '/indicadores/agenda?mes=2026-10', rotulo: 'Ver a agenda do mês' } })

    // ASSERT
    expect(screen.getByRole('link', { name: 'Ver a agenda do mês' })).toHaveAttribute('href', '/indicadores/agenda?mes=2026-10')
  })

  it('não deve ter violações de acessibilidade, fechado e com a definição aberta', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { container } = renderizar({ porta: { para: '/indicadores/agenda', rotulo: 'Ver a agenda do mês' } })

    // ACT + ASSERT — fechado
    expect(await axe(container)).toHaveNoViolations()

    // ACT + ASSERT — aberto (o painel mora num portal: mede o documento)
    await usuario.click(screen.getByRole('button', { name: 'Como se calcula: Ocupação' }))
    await screen.findByRole('dialog')
    expect(await axe(document.body)).toHaveNoViolations()
  })
})
