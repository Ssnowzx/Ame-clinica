import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Tabela } from '@/componentes/ui/tabela'

function TabelaExemplo({ densidade }: { densidade?: 'compacta' | 'confortavel' }) {
  return (
    <Tabela legenda="Pacientes — 2 de 2 registros" densidade={densidade}>
      <Tabela.Cabecalho>
        <Tabela.Linha>
          <Tabela.CelulaCabecalho>Nome</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho>Sessões</Tabela.CelulaCabecalho>
        </Tabela.Linha>
      </Tabela.Cabecalho>
      <Tabela.Corpo>
        <Tabela.Linha selecionada>
          <Tabela.Celula>Ana S.</Tabela.Celula>
          <Tabela.Celula numerica>3/12</Tabela.Celula>
        </Tabela.Linha>
        <Tabela.Linha>
          <Tabela.Celula>Bruno M.</Tabela.Celula>
          <Tabela.Celula numerica>7/12</Tabela.Celula>
        </Tabela.Linha>
      </Tabela.Corpo>
    </Tabela>
  )
}

describe('Tabela', () => {
  it('deve renderizar tabela semântica com legenda para AT', () => {
    // ARRANGE + ACT
    render(<TabelaExemplo />)

    // ASSERT: <caption> acessível dá nome à tabela
    expect(screen.getByRole('table', { name: 'Pacientes — 2 de 2 registros' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
  })

  it('deve marcar a linha selecionada com aria-selected e bg-selecao', () => {
    // ARRANGE + ACT
    render(<TabelaExemplo />)
    const linha = screen.getByText('Ana S.').closest('tr') as HTMLElement

    // ASSERT: cor + atributo, nunca só cor
    expect(linha).toHaveAttribute('aria-selected', 'true')
    expect(linha).toHaveClass('bg-selecao')
  })

  it('deve aplicar as alturas das duas densidades nomeadas', () => {
    // ARRANGE + ACT: compacta = 36px (grade), confortavel = 48px (§2.6)
    const { rerender } = render(<TabelaExemplo densidade="compacta" />)
    expect(screen.getByText('Ana S.').closest('tr')).toHaveClass('h-9')

    rerender(<TabelaExemplo densidade="confortavel" />)

    // ASSERT
    expect(screen.getByText('Ana S.').closest('tr')).toHaveClass('h-12')
  })

  it('deve alinhar células numéricas com tabular-nums à direita', () => {
    // ARRANGE + ACT
    render(<TabelaExemplo />)
    const celula = screen.getByText('3/12')

    // ASSERT: linguagem de dados (§1.4)
    expect(celula).toHaveClass('tabular-nums')
    expect(celula).toHaveClass('text-right')
  })

  it('deve vestir o cabeçalho de linha com a pele do corpo quando pedido', () => {
    // ARRANGE + ACT — `th scope="row"` que nomeia a linha e se desenha como as células dela
    render(
      <Tabela legenda="Escada fictícia">
        <Tabela.Corpo>
          <Tabela.Linha>
            <Tabela.CelulaCabecalho scope="row" pele="corpo">
              Receita líquida
            </Tabela.CelulaCabecalho>
            <Tabela.Celula numerica>R$ 10,00</Tabela.Celula>
          </Tabela.Linha>
        </Tabela.Corpo>
      </Tabela>,
    )

    // ASSERT — a semântica de cabeçalho, sem a pele do cabeçalho de coluna; o peso vem da linha
    // (sem `[font-weight:inherit]` o `<th>` nasce em negrito e TODA linha do DRE sairia assim)
    const cabecalho = screen.getByRole('rowheader', { name: 'Receita líquida' })
    expect(cabecalho).toHaveAttribute('scope', 'row')
    expect(cabecalho).toHaveClass('text-left', '[font-weight:inherit]', 'px-4', 'py-3')
    expect(cabecalho).not.toHaveClass('bg-fundo')
    expect(cabecalho).not.toHaveClass('text-rotulo')
    expect(cabecalho).not.toHaveClass('text-texto-suave')
    expect(cabecalho).not.toHaveClass('border-b')
  })

  it('deve renderizar conteúdo de célula malicioso como texto literal', () => {
    // ARRANGE: dado da clínica em texto livre (T-ds-01)
    const payload = '<img src=x onerror=alert(1)>'

    // ACT
    render(
      <Tabela legenda="Observações">
        <Tabela.Corpo>
          <Tabela.Linha>
            <Tabela.Celula>{payload}</Tabela.Celula>
          </Tabela.Linha>
        </Tabela.Corpo>
      </Tabela>,
    )

    // ASSERT
    expect(screen.getByText(payload)).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
})
