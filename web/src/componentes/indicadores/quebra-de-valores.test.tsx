import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QuebraDeValores } from '@/componentes/indicadores/graficos'

/**
 * `QuebraDeValores` é a irmã de `Quebra` para DINHEIRO (string decimal, `formatarBRL`).
 *
 * Este arquivo existe porque a tarefa que o dizia coberto estava marcada sem lastro: a
 * cauda "Outras (+N)" e a soma decimal dela não tinham teste nenhum, e apagar o bloco
 * inteiro da cauda não derrubava um único dos 1571 testes da casa (achado CR-GF-04).
 */

/** N linhas de valor, para estourar o teto de 8 do componente. */
function linhas(valores: readonly string[]) {
  return valores.map((valor, indice) => ({
    chave: `c-${indice}`,
    rotulo: `Categoria Fictícia ${indice + 1}`,
    valor,
  }))
}

describe('QuebraDeValores — dinheiro em barra, com cauda somada em decimal', () => {
  it('deve exibir o valor em BRL a partir da string decimal', () => {
    // ARRANGE
    const duas = linhas(['1200.50', '300.00'])

    // ACT
    render(<QuebraDeValores titulo="Categorias de receita" linhas={duas} />)

    // ASSERT — o texto carrega o dado; nada de "1200.5" cru na tela
    expect(screen.getByText('R$ 1.200,50')).toBeInTheDocument()
    expect(screen.getByText('R$ 300,00')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Categorias de receita' })).toBeInTheDocument()
  })

  it('deve mostrar as 8 maiores e agregar o resto em "Outras (+N)"', () => {
    // ARRANGE — 10 linhas: 8 aparecem, 2 viram cauda
    // valores da cauda escolhidos para que a SOMA (R$ 27,50) não coincida com
    // nenhuma linha visível — senão a asserção casaria com o elemento errado
    const dez = linhas(['100.00', '90.00', '80.00', '70.00', '60.00', '50.00', '40.00', '30.00', '15.00', '12.50'])

    // ACT
    render(<QuebraDeValores titulo="Categorias de receita" linhas={dez} />)

    // ASSERT — a 9ª e a 10ª somem como linha própria e reaparecem somadas
    expect(screen.getByText('Categoria Fictícia 8')).toBeInTheDocument()
    expect(screen.queryByText('Categoria Fictícia 9')).not.toBeInTheDocument()
    expect(screen.getByText('Outras (+2)')).toBeInTheDocument()
    expect(screen.getByText('R$ 27,50')).toBeInTheDocument() // 15,00 + 12,50
  })

  it('deve totalizar a cauda de centavos corretamente', () => {
    // ARRANGE — 3 valores de 0,10, soma exata 0,30.
    //
    // **Condição medida, para não prometer demais:** trocar `somarDecimais` por
    // `reduce(Number).toFixed(2)` NÃO derruba este teste — o `toFixed` arredonda por
    // cima do erro binário (0.30000000000000004 → "0.30"). Este teste guarda que a
    // cauda TOTALIZA certo, não a escolha de BigInt. Quem isola os dois pontos em que
    // as implementações divergem de verdade (3ª casa decimal e acima de 2^53 centavos)
    // são os testes de `somarDecimais` em `lib/dinheiro.test.ts`.
    const onze = linhas([
      '100.00', '90.00', '80.00', '70.00', '60.00', '50.00', '40.00', '30.00',
      '0.10', '0.10', '0.10',
    ])

    // ACT
    render(<QuebraDeValores titulo="Categorias de receita" linhas={onze} />)

    // ASSERT
    expect(screen.getByText('Outras (+3)')).toBeInTheDocument()
    expect(screen.getByText('R$ 0,30')).toBeInTheDocument()
  })

  it('deve dispensar a cauda quando cabe tudo', () => {
    // ARRANGE — exatamente o teto
    const oito = linhas(['80.00', '70.00', '60.00', '50.00', '40.00', '30.00', '20.00', '10.00'])

    // ACT
    render(<QuebraDeValores titulo="Categorias de despesa" linhas={oito} />)

    // ASSERT
    expect(screen.getByText('Categoria Fictícia 8')).toBeInTheDocument()
    expect(screen.queryByText(/^Outras/)).not.toBeInTheDocument()
  })
})
