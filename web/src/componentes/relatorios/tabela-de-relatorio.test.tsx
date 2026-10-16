import { render, screen, within } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { describe, expect, it } from 'vitest'

import { TabelaDeRelatorio } from '@/componentes/relatorios/tabela-de-relatorio'
import { envelopeFicticio } from '@/test/dados-relatorios'

expect.extend(toHaveNoViolations)

describe('TabelaDeRelatorio — as colunas que a API declarou, formatadas pelo tipo', () => {
  it('deve formatar cada célula pelo tipo e mostrar o marcador de ausência no vazio', async () => {
    // ARRANGE
    const envelope = envelopeFicticio()

    // ACT
    const { container } = render(
      <TabelaDeRelatorio colunas={envelope.colunas} linhas={envelope.linhas} totais={envelope.totais} legenda="Agendamentos: 3 linhas" />,
    )

    // ASSERT — dinheiro, data, hora, percentual e o vazio como "—"
    const tabela = screen.getByRole('table', { name: 'Agendamentos: 3 linhas' })
    expect(within(tabela).getByText('R$ 1.234,50')).toBeInTheDocument()
    expect(within(tabela).getByText('01/06/2026')).toBeInTheDocument()
    expect(within(tabela).getByText('08:00')).toBeInTheDocument()
    expect(within(tabela).getByText('75%')).toBeInTheDocument()
    expect(within(tabela).getAllByText('—').length).toBeGreaterThan(0)
    expect(container.textContent).not.toContain('null')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve trazer a linha de totais no rodapé, com o rótulo como cabeçalho de linha', () => {
    // ARRANGE
    const envelope = envelopeFicticio()

    // ACT
    render(<TabelaDeRelatorio colunas={envelope.colunas} linhas={envelope.linhas} totais={envelope.totais} legenda="Agendamentos: 3 linhas" />)

    // ASSERT — `<tfoot>` com `<th scope="row">Total</th>` e os totais formatados pelo tipo
    const rodape = document.querySelector('tfoot')
    expect(rodape).not.toBeNull()
    const total = within(rodape as HTMLElement).getByRole('rowheader', { name: 'Total' })
    expect(total).toHaveAttribute('scope', 'row')
    expect(within(rodape as HTMLElement).getByText('R$ 1.314,50')).toBeInTheDocument()
    expect(within(rodape as HTMLElement).getByText('3')).toBeInTheDocument()
  })

  it('deve declarar scope="col" em todo cabeçalho de coluna', () => {
    // ARRANGE
    const envelope = envelopeFicticio()

    // ACT
    render(<TabelaDeRelatorio colunas={envelope.colunas} linhas={envelope.linhas} legenda="Agendamentos: 3 linhas" />)

    // ASSERT
    const cabecalhos = screen.getAllByRole('columnheader')
    expect(cabecalhos).toHaveLength(envelope.colunas.length)
    for (const cabecalho of cabecalhos) expect(cabecalho).toHaveAttribute('scope', 'col')
    // sem totais, sem rodapé
    expect(document.querySelector('tfoot')).toBeNull()
  })
})

describe('TabelaDeRelatorio — recuo e subtotal do DRE (nivel e destaque)', () => {
  const COLUNAS = [
    { chave: 'linha', rotulo: 'DRE', tipo: 'texto' as const },
    { chave: 'total', rotulo: 'Total', tipo: 'dinheiro' as const },
  ]

  function linhaDaTabela(texto: string): HTMLElement {
    return screen.getByText(texto).closest('tr') as HTMLElement
  }

  it('deve recuar a linha da escada e mais ainda a categoria, pela primeira célula', async () => {
    // ARRANGE
    const linhas = [
      { linha: 'Receita bruta', total: '100.00', nivel: 0, destaque: false },
      { linha: 'Prestação de serviços', total: '100.00', nivel: 1, destaque: false },
      { linha: 'Sessões Fictícias', total: '100.00', nivel: 2, destaque: false },
    ]

    // ACT
    const { container } = render(<TabelaDeRelatorio colunas={COLUNAS} linhas={linhas} legenda="DRE gerencial: 3 linhas" />)

    // ASSERT — o recuo é da célula do rótulo; o valor continua alinhado à direita
    expect(screen.getByText('Prestação de serviços').closest('th')).toHaveClass('pl-7')
    expect(screen.getByText('Sessões Fictícias').closest('th')).toHaveClass('pl-12')
    expect(screen.getByText('Receita bruta').closest('th')).not.toHaveClass('pl-7')
    expect(linhaDaTabela('Receita bruta')).toHaveClass('font-semibold')
    expect(linhaDaTabela('Sessões Fictícias')).toHaveClass('text-texto-suave')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve realçar o subtotal, na tela e no papel, sem imprimir as marcas como coluna', () => {
    // ARRANGE
    const linhas = [{ linha: 'Receita líquida', total: '28000.00', nivel: 0, destaque: true }]

    // ACT
    const { container } = render(<TabelaDeRelatorio colunas={COLUNAS} linhas={linhas} legenda="DRE gerencial: 1 linha" />)

    // ASSERT — o realce é de classe (vale também no `@media print`); `true` e `0` nunca viram texto
    expect(linhaDaTabela('Receita líquida')).toHaveClass('bg-fundo', 'font-semibold', 'border-t-2')
    expect(container.textContent).not.toContain('true')
    expect(within(linhaDaTabela('Receita líquida')).getAllByRole('cell')).toHaveLength(1)
    expect(within(linhaDaTabela('Receita líquida')).getAllByRole('rowheader')).toHaveLength(1)
  })

  it('deve deixar exatamente como antes as linhas que não trazem marca', () => {
    // ARRANGE — os outros relatórios não mandam `nivel` nem `destaque`
    const envelope = envelopeFicticio()

    // ACT
    render(<TabelaDeRelatorio colunas={envelope.colunas} linhas={envelope.linhas} legenda="Agendamentos: 3 linhas" />)

    // ASSERT
    const linha = screen.getByText('Paciente Fictício Um').closest('tr') as HTMLElement
    expect(linha).not.toHaveClass('font-semibold')
    expect(linha).not.toHaveClass('bg-fundo')
    expect(within(linha).getAllByRole('cell')[0]).not.toHaveClass('pl-7')
  })
})

describe('TabelaDeRelatorio — a escada para quem não a vê (A11Y-FIN-01)', () => {
  const COLUNAS = [
    { chave: 'linha', rotulo: 'DRE', tipo: 'texto' as const },
    { chave: 'm_2026_09', rotulo: 'set/2026', tipo: 'dinheiro' as const },
    { chave: 'total', rotulo: 'Total', tipo: 'dinheiro' as const },
  ]

  const ESCADA = [
    { linha: 'Receita bruta', m_2026_09: '30000.00', total: '30000.00', nivel: 0, destaque: false },
    { linha: 'Prestação de serviços', m_2026_09: '30000.00', total: '30000.00', nivel: 1, destaque: false },
    { linha: 'Sessões Fictícias', m_2026_09: '30000.00', total: '30000.00', nivel: 2, destaque: false },
    { linha: '(−) Deduções', m_2026_09: '-2000.00', total: '-2000.00', nivel: 0, destaque: false },
    { linha: 'Impostos Fictícios', m_2026_09: '-2000.00', total: '-2000.00', nivel: 2, destaque: false },
    { linha: 'Receita líquida', m_2026_09: '28000.00', total: '28000.00', nivel: 0, destaque: true },
  ]

  function renderizarEscada() {
    return render(<TabelaDeRelatorio colunas={COLUNAS} linhas={ESCADA} legenda="DRE gerencial: 6 linhas" />)
  }

  it('deve anunciar o subtotal como cabeçalho da linha, com o nome "Subtotal: …"', () => {
    // ARRANGE + ACT
    renderizarEscada()

    // ASSERT — a 1ª célula nomeia a linha; o valor é dela
    const subtotal = screen.getByRole('rowheader', { name: 'Subtotal: Receita líquida' })
    expect(subtotal).toHaveAttribute('scope', 'row')
    const linha = subtotal.closest('tr') as HTMLElement
    expect(within(linha).getAllByRole('cell', { name: 'R$ 28.000,00' })).toHaveLength(2)
    // a linha que não é subtotal não ganha o prefixo
    expect(screen.getByRole('rowheader', { name: 'Receita bruta' })).toBeInTheDocument()
  })

  it('deve anunciar a categoria dentro da linha da escada que ela compõe', () => {
    // ARRANGE + ACT
    renderizarEscada()

    // ASSERT
    expect(
      screen.getByRole('rowheader', { name: 'Sessões Fictícias, dentro de Prestação de serviços' }),
    ).toBeInTheDocument()
  })

  it('deve anunciar a linha da escada dentro do grupo que ela compõe (A11Y-FIN-R2-02)', () => {
    // ARRANGE + ACT
    renderizarEscada()

    // ASSERT — o nível 1 também diz onde mora; o grupo (nível 0) não ganha complemento
    expect(screen.getByRole('rowheader', { name: 'Prestação de serviços, dentro de Receita bruta' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Receita bruta' })).toBeInTheDocument()
  })

  it('deve esquecer o grupo no subtotal — a linha que viesse depois dele não mora no grupo de antes', () => {
    // ARRANGE — forma que o servidor não manda hoje: uma linha de nível 1 logo depois do subtotal
    const linhas = [
      { linha: 'Receita bruta', m_2026_09: '10.00', total: '10.00', nivel: 0, destaque: false },
      { linha: 'Receita líquida', m_2026_09: '10.00', total: '10.00', nivel: 0, destaque: true },
      { linha: 'Linha Solta Fictícia', m_2026_09: '10.00', total: '10.00', nivel: 1, destaque: false },
    ]

    // ACT
    render(<TabelaDeRelatorio colunas={COLUNAS} linhas={linhas} legenda="DRE gerencial: 3 linhas" />)

    // ASSERT — nunca "dentro de Receita bruta", nem "dentro de Receita líquida"
    expect(screen.getByRole('rowheader', { name: 'Linha Solta Fictícia' })).toBeInTheDocument()
  })

  it('deve esquecer a linha-mãe quando começa outro grupo', () => {
    // ARRANGE + ACT — "Impostos Fictícios" vem depois de "(−) Deduções" sem linha de nível 1
    renderizarEscada()

    // ASSERT — nunca "dentro de Prestação de serviços", que é de outro grupo
    expect(screen.getByRole('rowheader', { name: 'Impostos Fictícios' })).toBeInTheDocument()
  })

  it('deve dizer o subtotal e a linha-mãe só ao leitor de tela, fora do papel', () => {
    // ARRANGE + ACT
    renderizarEscada()

    // ASSERT — o texto visível do rótulo não muda, e o Ctrl+C da tabela não leva o complemento
    const subtotal = screen.getByRole('rowheader', { name: 'Subtotal: Receita líquida' })
    const prefixo = within(subtotal).getByText('Subtotal:', { exact: false })
    expect(prefixo).toHaveClass('sr-only', 'select-none', 'print:hidden')
    const categoria = screen.getByRole('rowheader', { name: /^Sessões Fictícias/ })
    expect(within(categoria).getByText(/dentro de/)).toHaveClass('sr-only', 'select-none', 'print:hidden')
  })

  it('deve fixar a 1ª coluna e o canto "DRE" só a partir de `sm`, com o fundo da linha', () => {
    // ARRANGE + ACT
    const { container } = render(
      <TabelaDeRelatorio colunas={COLUNAS} linhas={ESCADA} totais={{ total: '28000.00' }} legenda="DRE gerencial: 6 linhas" />,
    )

    // ASSERT — a 320 CSS px a coluna (~290 px) cobriria o rolador (~272 px) inteiro: abaixo de
    // `sm` ela rola junto (A11Y-FIN-R2-01); nenhuma classe de fixação vale sem o prefixo
    const canto = screen.getByRole('columnheader', { name: 'DRE' })
    expect(canto).toHaveClass('sm:sticky', 'sm:left-0', 'sm:z-(--z-fixo-canto)')
    expect(screen.getByRole('columnheader', { name: 'Total' })).not.toHaveClass('sm:sticky')
    const subtotal = screen.getByRole('rowheader', { name: 'Subtotal: Receita líquida' })
    expect(subtotal).toHaveClass('sm:sticky', 'sm:left-0', 'sm:z-(--z-fixo)', 'sm:bg-fundo')
    const bruta = screen.getByRole('rowheader', { name: 'Receita bruta' })
    expect(bruta).toHaveClass('sm:sticky', 'sm:left-0', 'sm:z-(--z-fixo)', 'sm:bg-superficie', 'sm:group-hover/linha:bg-hover-de-linha')
    expect(bruta.closest('tr')).toHaveClass('group/linha')
    const rodape = within(container.querySelector('tfoot') as HTMLElement).getByRole('rowheader', { name: 'Total' })
    expect(rodape).toHaveClass('sm:sticky', 'sm:left-0', 'sm:z-(--z-fixo)')
    // a fixação, e no corpo também o fundo dela (o canto e o rodapé têm o da pele de cabeçalho)
    for (const celula of [canto, subtotal, bruta, rodape]) {
      expect([...celula.classList].filter((classe) => /^(sticky|left-0|z-)/.test(classe))).toEqual([])
    }
    for (const celula of [subtotal, bruta]) {
      expect([...celula.classList].filter((classe) => /^(bg-|group-hover)/.test(classe))).toEqual([])
    }
  })

  it('deve dar ao cabeçalho da linha a pele do corpo, não a do cabeçalho de coluna', () => {
    // ARRANGE + ACT
    renderizarEscada()

    // ASSERT — o peso vem da linha (o `th` nasceria em negrito); nada do rótulo de coluna
    const categoria = screen.getByRole('rowheader', { name: /^Sessões Fictícias/ })
    expect(categoria).toHaveClass('text-left')
    expect(categoria).not.toHaveClass('text-rotulo')
    expect(categoria).not.toHaveClass('text-texto-suave')
    expect(categoria).not.toHaveClass('border-b')
  })

  it('deve manter a 1ª coluna como célula comum no relatório sem `nivel`', () => {
    // ARRANGE — os outros relatórios não mandam `nivel`: nem cabeçalho de linha, nem coluna fixa
    const envelope = envelopeFicticio()

    // ACT
    render(<TabelaDeRelatorio colunas={envelope.colunas} linhas={envelope.linhas} legenda="Agendamentos: 3 linhas" />)

    // ASSERT
    const corpo = document.querySelector('tbody') as HTMLElement
    expect(within(corpo).queryAllByRole('rowheader')).toHaveLength(0)
    const linha = screen.getByText('Paciente Fictício Um').closest('tr') as HTMLElement
    const primeira = within(linha).getAllByRole('cell')[0]
    expect(primeira).toHaveTextContent('01/06/2026')
    expect(primeira).not.toHaveClass('sticky')
    expect(primeira).not.toHaveClass('sm:sticky')
    expect(screen.getByRole('columnheader', { name: 'Data' })).not.toHaveClass('sm:sticky')
    expect(linha).not.toHaveClass('group/linha')
  })

  it('deve não ter violações axe na escada com subtotal e categoria', async () => {
    // ARRANGE + ACT
    const { container } = renderizarEscada()

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})
