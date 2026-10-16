import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ListaDescricao } from '@/componentes/ui/lista-descricao'

describe('ListaDescricao (DescriptionList)', () => {
  it('deve apresentar pares rótulo/valor com semântica de descrição (dt/dd), não campos', () => {
    // ARRANGE + ACT
    render(
      <ListaDescricao
        itens={[
          { rotulo: 'Profissional', valor: 'Mariana dos Santos' },
          { rotulo: 'Convênio', valor: 'Particular' },
        ]}
      />,
    )

    // ASSERT: <dt>/<dd> reais — nunca inputs desabilitados
    const rotulo = screen.getByText('Profissional')
    const valor = screen.getByText('Mariana dos Santos')
    expect(rotulo.tagName).toBe('DT')
    expect(valor.tagName).toBe('DD')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('NÃO deve jogar o valor LONGO para a direita em tela estreita', () => {
    /*
     * ARRANGE — em tela estreita rótulo e valor ficam na MESMA linha, valor alinhado à
     * direita: cinco fatos empilhados viravam uma coluna alta e solta. Mas o item de largura
     * total é o endereço e a observação, e um texto de três linhas espremido contra a direita
     * é pior que o vão que a mudança veio corrigir.
     *
     * A densidade em si é escolha VISUAL e quem a verifica é o passe de design; o que se
     * guarda aqui é o comportamento com dano nomeado — texto longo continua empilhado.
     */
    render(
      <ListaDescricao
        itens={[
          { rotulo: 'Convênio', valor: 'Unimed' },
          { rotulo: 'Observação', valor: 'Chega 10 min antes', larguraTotal: true },
        ]}
      />,
    )

    // ASSERT
    const curto = screen.getByText('Unimed')
    const longo = screen.getByText('Chega 10 min antes')
    expect(curto.className).toContain('text-right')
    expect(longo.className).not.toContain('text-right')
  })

  it('deve marcar o item de largura total para ocupar as duas colunas', () => {
    // ARRANGE + ACT
    render(<ListaDescricao itens={[{ rotulo: 'Observação', valor: 'Chega 10 min antes', larguraTotal: true }]} />)

    // ASSERT: o par de largura total gera o span das duas colunas em 768+
    const par = screen.getByText('Observação').closest('div')
    expect(par?.className).toContain('md:col-span-2')
  })
})
