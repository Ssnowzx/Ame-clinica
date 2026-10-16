import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { RoladorHorizontal } from '@/componentes/ui/rolador-horizontal'

/**
 * O que estes testes cobrem e o que NÃO cobrem, dito na frente:
 *
 * **Cobrem** o contrato de ACESSIBILIDADE nas duas direções — a região é nomeada e
 * alcançável por teclado QUANDO há o que rolar, e **não existe** quando não há (senão
 * viram paradas de foco vazias, o achado IMP-13 do gate).
 *
 * jsdom não faz layout: `scrollWidth` e `clientWidth` valem 0 sempre, e por isso a regra
 * `scrollable-region-focusable` do axe **nunca** poderia pegar isto num teste — foi o
 * gate, em navegador real, que pegou. Aqui as duas medidas são SIMULADAS, e o teste
 * declara isso em vez de fingir que mediu layout.
 *
 * **NÃO cobrem** o véu de fade em si (pixels), que depende de layout de verdade.
 */

/** Finge as medidas de rolagem que o jsdom não calcula. */
function simularLayout({ conteudo, visivel }: { conteudo: number; visivel: number }) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, value: conteudo })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: visivel })
}

afterEach(() => {
  // devolve as propriedades ao que o jsdom tinha, para não vazar entre arquivos
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, value: 0 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 0 })
})

describe('RoladorHorizontal — a região só existe quando há o que rolar', () => {
  it('deve expor região nomeada e focável quando o conteúdo não cabe', async () => {
    // ARRANGE — conteúdo de 600px numa caixa de 300px
    simularLayout({ conteudo: 600, visivel: 300 })

    // ACT
    render(
      <RoladorHorizontal rotulo="Contas do ano — role para ver os doze meses">
        <div>conteúdo largo</div>
      </RoladorHorizontal>,
    )

    // ASSERT — nomeada, e o Tab pousa nela
    const regiao = screen.getByRole('region', { name: 'Contas do ano — role para ver os doze meses' })
    expect(regiao).toHaveAttribute('tabindex', '0')
    await userEvent.tab()
    expect(regiao).toHaveFocus()
  })

  it('NÃO deve criar parada de foco quando tudo cabe na tela', async () => {
    // ARRANGE — conteúdo menor que a caixa: nada a rolar. A versão anterior punha
    // `tabIndex={0}` incondicional e criava duas paradas de teclado vazias por página
    // em 1440px, justo a largura em que a clínica trabalha (achado IMP-13).
    simularLayout({ conteudo: 300, visivel: 300 })

    // ACT
    render(
      <RoladorHorizontal rotulo="Contas do ano">
        <button type="button">depois do rolador</button>
      </RoladorHorizontal>,
    )

    // ASSERT — sem região, sem tabindex; o Tab vai direto ao botão
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'depois do rolador' })).toHaveFocus()
  })
})

describe('RoladorHorizontal — remedir quando o CONTEÚDO muda de tamanho', () => {
  it('deve passar a se anunciar quando os filhos ficam largos demais', () => {
    // ARRANGE — começa cabendo: sem região, sem parada de foco
    simularLayout({ conteudo: 300, visivel: 300 })
    const { rerender } = render(
      <RoladorHorizontal rotulo="Série do ano">
        <div>um mês</div>
      </RoladorHorizontal>,
    )
    expect(screen.queryByRole('region')).not.toBeInTheDocument()

    // ACT — a mesma caixa, conteúdo novo e MAIS LARGO (trocar o mês na tela faz isso).
    // O `ResizeObserver` do ambiente de teste é um stub inerte e a caixa do scroller não
    // muda quando só o `scrollWidth` dos filhos muda — então `children` nas deps do
    // efeito é o ÚNICO caminho de remedição aqui, o que isola o conserto (achado do gate).
    simularLayout({ conteudo: 900, visivel: 300 })
    rerender(
      <RoladorHorizontal rotulo="Série do ano">
        <div>doze meses</div>
      </RoladorHorizontal>,
    )

    // ASSERT — a região apareceu sozinha, sem recarregar
    expect(screen.getByRole('region', { name: 'Série do ano' })).toHaveAttribute('tabindex', '0')
  })

  it('deve continuar focável (sem ser parada de Tab) quando deixa de rolar', () => {
    // ARRANGE — rola, então é parada de Tab
    simularLayout({ conteudo: 900, visivel: 300 })
    const { rerender } = render(
      <RoladorHorizontal rotulo="Série do ano">
        <div>doze meses</div>
      </RoladorHorizontal>,
    )
    const regiao = screen.getByRole('region', { name: 'Série do ano' })

    // ACT — a janela alarga e passa a caber
    simularLayout({ conteudo: 300, visivel: 900 })
    rerender(
      <RoladorHorizontal rotulo="Série do ano">
        <div>doze meses</div>
      </RoladorHorizontal>,
    )

    // ASSERT — `-1`, não atributo removido: sai da ordem de Tab e segue focável, para o
    // foco de quem estava dentro não cair no `body`
    expect(regiao).toHaveAttribute('tabindex', '-1')
  })
})
