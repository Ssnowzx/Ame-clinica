import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { queryClient } from '@/lib/query-client'
import { PaginaLogin } from '@/paginas/pagina-login'

/**
 * A tela de login — a única do produto em que a marca é a do PRODUTO, não a da clínica.
 *
 * Aqui ainda não há sessão, e a identidade da clínica (`VisualDaMarca`) só chega depois, alimentada
 * pelo `/me`. Por isso o que aparece nesta tela é a Xclinicas — nas cores e nas fontes da marca do
 * produto (change tema-xclinicas), qualquer que seja o tema das clínicas.
 */
function renderizar() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PaginaLogin />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Login — a marca do produto', () => {
  it('deve mostrar a marca Xclinicas', () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT
    expect(screen.getByRole('heading', { level: 1, name: 'Xclinicas' })).toBeInTheDocument()
  })

  it('deve vestir só a PRÓPRIA tela com a marca do produto, sem tocar o tema do <html>', () => {
    // ARRANGE — o `<html>` é do shell, que aplica o tema da CLÍNICA; o login não disputa o atributo
    renderizar()

    // ACT
    const principal = screen.getByRole('main')

    // ASSERT
    expect(principal).toHaveAttribute('data-tema', 'xclinicas')
    expect(document.documentElement).not.toHaveAttribute('data-tema')
  })

  it('NÃO deve anunciar o símbolo — ele repetiria o título em voz alta', () => {
    // ARRANGE — o símbolo é decoração ao lado de um título que já diz o nome. Anunciá-lo faria
    // quem usa leitor de tela ouvir "Xclinicas" duas vezes seguidas
    renderizar()

    // ACT + ASSERT — nenhuma imagem na árvore de acessibilidade, e o símbolo está lá no DOM
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('img[src="/marca/simbolo.svg"]')).toBeInTheDocument()
  })

  it('deve pedir e-mail e senha, com o botão de entrar', () => {
    // ARRANGE — o par de controle: uma tela que só tivesse a marca passaria nos dois testes acima
    renderizar()

    // ACT + ASSERT
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })
})
