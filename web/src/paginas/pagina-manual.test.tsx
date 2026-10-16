import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { SECOES_DO_MANUAL } from '@/lib/manual/conteudo'
import { PaginaManual } from '@/paginas/pagina-manual'
import { fingirTelaEmpilhada } from '@/test/setup'
import { servidor } from '@/test/servidor-msw'

expect.extend(toHaveNoViolations)

/** Os links de PRIMEIRO nível do índice — o sub-índice tem os seus, e não se contam junto. */
function linksDeSecao(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-nivel="secao"]')]
}

function renderizar(endereco = '/manual') {
  return render(
    <MemoryRouter initialEntries={[endereco]}>
      <PaginaManual />
    </MemoryRouter>,
  )
}

describe('PaginaManual — índice e conteúdo', () => {
  it('deve ter no índice uma entrada por seção, na mesma ordem', () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT: índice e corpo saem da MESMA lista — se algum dia se separarem, isto cai
    const links = linksDeSecao()
    expect(links.map((link) => link.textContent)).toEqual(
      SECOES_DO_MANUAL.map((secao, posicao) => `${String(posicao + 1)}${secao.titulo}`),
    )
  })

  it('deve listar no índice as partes endereçáveis de uma seção', () => {
    // ARRANGE: seção longa que se consulta por parte (as abas de Configurações) ganha sub-item
    renderizar()

    // ACT
    const subitens = [...document.querySelectorAll('[data-nivel="subsecao"]')]

    // ASSERT: cada sub-item aponta para um subtítulo que existe no corpo
    expect(subitens.length).toBeGreaterThan(0)
    for (const subitem of subitens) {
      const alvo = subitem.getAttribute('href')?.replace('#', '') ?? ''
      expect(document.getElementById(alvo)).not.toBeNull()
    }
  })

  it('deve manter a SEÇÃO marcada ao escolher uma parte dela', async () => {
    // ARRANGE: o sub-item marca a seção-mãe, não o subtítulo — passar o id do subtítulo grava um
    // valor que nenhuma seção tem, e a marcação do índice inteiro se apaga (achado do gate;
    // sobrevivia a todos os testes até este)
    const usuario = userEvent.setup()
    renderizar()
    const indice = screen.getByRole('navigation', { name: 'Índice do manual' })

    // ACT
    await usuario.click(
      screen.getByRole('link', { name: 'Aba Financeiro — o que entra no caixa' }),
    )

    // ASSERT
    expect(within(indice).getByRole('link', { current: true })).toHaveTextContent('Configurações')
  })

  it('deve levar o foco para a parte escolhida no sub-índice', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()

    // ACT
    await usuario.click(
      screen.getByRole('link', { name: 'Aba Segurança — travas nas mudanças de acesso' }),
    )

    // ASSERT: subtítulo endereçável é âncora de verdade, com foco — como a seção
    expect(
      screen.getByRole('heading', { level: 3, name: 'Aba Segurança — travas nas mudanças de acesso' }),
    ).toHaveFocus()
  })

  it('deve apontar cada link do índice para um título que existe no corpo', () => {
    // ARRANGE
    renderizar()
    const indice = screen.getByRole('navigation', { name: 'Índice do manual' })

    // ACT
    const alvos = within(indice)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href')?.replace('#', '') ?? '')

    // ASSERT: link para âncora inexistente é o defeito clássico de índice escrito à mão
    for (const alvo of alvos) {
      expect(document.getElementById(alvo)).not.toBeNull()
    }
  })

  it('deve escrever cada seção como um título de segundo nível', () => {
    // ARRANGE + ACT: um h1 (a página) e um h2 por seção — a hierarquia é o mapa de quem ouve
    renderizar()

    // ASSERT
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(SECOES_DO_MANUAL.length)
  })

  it('deve descrever toda imagem exibida', () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT: `alt` vazio esconderia a figura de quem ouve; aqui ela sempre carrega instrução
    for (const figura of screen.getAllByRole('img')) {
      expect(figura).toHaveAccessibleName()
      expect(figura.getAttribute('alt')?.length ?? 0).toBeGreaterThan(20)
    }
  })
})

describe('PaginaManual — sem dado da clínica', () => {
  it('deve não consultar o servidor ao abrir', async () => {
    // ARRANGE: a tela dispensa permissão PORQUE não lê nada da clínica — se um dia passar a ler,
    // esta guarda cai antes de a rota aberta virar um vazamento
    const requisicoes: string[] = []
    const anotar = ({ request }: { request: Request }) => requisicoes.push(request.url)
    servidor.events.on('request:start', anotar)

    // ACT
    renderizar()
    await screen.findByRole('heading', { level: 1, name: 'Manual do sistema' })

    // ASSERT
    servidor.events.removeListener('request:start', anotar)
    expect(requisicoes).toEqual([])
  })
})

describe('PaginaManual — âncoras', () => {
  it('deve abrir com o foco na seção pedida pelo endereço', async () => {
    // ARRANGE + ACT: `/manual#agenda` é endereço que alguém copiou e mandou para um colega
    renderizar('/manual#agenda')

    // ASSERT
    const titulo = await screen.findByRole('heading', { level: 2, name: 'A agenda do dia' })
    expect(titulo).toHaveFocus()
  })

  it('deve levar o foco para a seção ao escolher no índice', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar()
    const indice = screen.getByRole('navigation', { name: 'Índice do manual' })

    // ACT
    await usuario.click(within(indice).getByRole('link', { name: 'Auditoria' }))

    // ASSERT: sem isto, a próxima tabulação volta para o índice e o leitor o percorre de novo
    expect(screen.getByRole('heading', { level: 2, name: 'Auditoria' })).toHaveFocus()
  })

  it('deve marcar no índice a seção escolhida, sem esperar a rolagem', async () => {
    // ARRANGE: quem observa a rolagem só responde no próximo quadro desenhado — e o leitor que
    // acabou de escolher um destino não pode ver o índice apontando o anterior
    const usuario = userEvent.setup()
    renderizar()
    const indice = screen.getByRole('navigation', { name: 'Índice do manual' })

    // ACT
    await usuario.click(within(indice).getByRole('link', { name: 'Indicadores' }))

    // ASSERT
    const marcado = within(indice).getByRole('link', { current: true })
    expect(marcado).toHaveTextContent('Indicadores')
  })

  it('deve ignorar endereço que aponta para seção inexistente', async () => {
    // ARRANGE + ACT: link antigo, seção renomeada — a página abre normal, sem quebrar
    renderizar('/manual#secao-que-nao-existe')

    // ASSERT
    expect(await screen.findByRole('heading', { level: 1, name: 'Manual do sistema' })).toBeVisible()
  })
})

describe('PaginaManual — os dois arranjos', () => {
  it('deve manter o índice ao lado do texto em tela larga', () => {
    // ARRANGE + ACT
    renderizar()

    // ASSERT: uma navegação só, e sem o bloco recolhível
    expect(screen.getAllByRole('navigation', { name: 'Índice do manual' })).toHaveLength(1)
    expect(screen.queryByText('Índice do manual', { selector: 'summary' })).not.toBeInTheDocument()
  })

  it('deve recolher o índice em tela empilhada', () => {
    // ARRANGE
    fingirTelaEmpilhada(true)

    // ACT
    renderizar()

    // ASSERT: um índice de vinte itens aberto empurraria o começo do manual para fora da tela
    const resumo = screen.getByText('Índice do manual', { selector: 'summary' })
    expect(resumo.closest('details')).not.toHaveAttribute('open')
    expect(screen.getAllByRole('navigation', { name: 'Índice do manual' })).toHaveLength(1)
  })

  it('deve fechar o índice recolhido ao escolher um destino', async () => {
    // ARRANGE
    fingirTelaEmpilhada(true)
    const usuario = userEvent.setup()
    renderizar()
    const detalhes = screen.getByText('Índice do manual', { selector: 'summary' }).closest('details')

    // ACT
    await usuario.click(screen.getByText('Índice do manual', { selector: 'summary' }))
    await usuario.click(screen.getByRole('link', { name: 'Financeiro' }))

    // ASSERT: índice aberto por cima do texto é a gaveta que não fecha ao navegar
    expect(detalhes).not.toHaveAttribute('open')
  })

  it('deve continuar navegável onde o navegador não acompanha a rolagem', () => {
    // ARRANGE + ACT: o jsdom não tem IntersectionObserver — é o caminho degradado do design D6
    expect(globalThis.IntersectionObserver).toBeUndefined()
    renderizar()

    // ASSERT: sem marcação de seção corrente, e com o índice inteiro de pé
    const indice = screen.getByRole('navigation', { name: 'Índice do manual' })
    expect(within(indice).queryByRole('link', { current: true })).not.toBeInTheDocument()
    expect(linksDeSecao()).toHaveLength(SECOES_DO_MANUAL.length)
  })
})

describe('PaginaManual — acessibilidade', () => {
  it('deve não ter violação de acessibilidade', async () => {
    // ARRANGE
    const { container } = renderizar()

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)

  it('deve não ter violação no arranjo empilhado, com o índice aberto', async () => {
    // ARRANGE: o `<details>` do índice é o widget EXCLUSIVO da tela estreita — e o gate rodava
    // só no arranjo largo, provando na condição em que o defeito não pode existir (achado
    // design-qa M15 / a11y).
    fingirTelaEmpilhada(true)
    const usuario = userEvent.setup()
    const { container } = renderizar()
    await usuario.click(screen.getByText('Índice do manual', { selector: 'summary' }))

    // ASSERT do ARRANJO, antes do `axe`: no jsdom não há folha de estilo do agente fechando o
    // `<details>`, então o `axe` enxerga a lista aberta ou fechada — sem esta linha o nome do
    // teste promete um estado que ele não verifica (achado da rodada 2 do gate, provado por
    // mutação: apagar o clique deixava os 17 testes verdes).
    expect(screen.getByText('Índice do manual', { selector: 'summary' }).closest('details')).toHaveAttribute(
      'open',
    )

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})
