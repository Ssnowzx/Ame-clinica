import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ColunasPareadas, Quebra } from '@/componentes/indicadores/graficos'
import {
  ColunasComDestaque,
  EquivalenteEmTabela,
  LegendaSemDados,
  type ColunaDoGrafico,
} from '@/componentes/indicadores/graficos-do-painel'
import { MapaDeOcupacao } from '@/componentes/indicadores/mapa-de-ocupacao'

const COLUNAS: readonly ColunaDoGrafico[] = [
  { chave: '2026-08', eixo: 'ago', proporcao: null, destaque: false },
  { chave: '2026-09', eixo: 'set', proporcao: 100, rotulo: '22,3 mil', destaque: false },
  { chave: '2026-10', eixo: 'out*', proporcao: 10, rotulo: '2,2 mil', destaque: true },
]

describe('ColunasComDestaque — o rótulo anda com a coluna, e a base é uma só (DQ-03)', () => {
  it('deve escrever o valor LOGO ACIMA da própria coluna, numa linha só', () => {
    // ARRANGE + ACT
    const { container } = render(<ColunasComDestaque colunas={COLUNAS} />)

    // ASSERT — o rótulo é filho da coluna (sobe e desce com ela), e não de uma faixa fixa no teto
    const outubro = container.querySelector('[data-coluna="2026-10"] [data-destaque="sim"]')
    expect(outubro).toHaveTextContent('2,2 mil')
    const rotulo = outubro?.querySelector('span')
    expect(rotulo).toHaveTextContent('2,2 mil')
    expect(rotulo?.className).toContain('bottom-full')
    expect(rotulo?.className).toContain('whitespace-nowrap')
  })

  it('deve nascer as colunas de UMA linha de base, de ponta a ponta', () => {
    // ARRANGE + ACT
    const { container } = render(<ColunasComDestaque colunas={COLUNAS} />)

    // ASSERT — uma base por coluna, com o vão entre elas, parecia uma régua quebrada
    const bases = container.querySelectorAll('.border-b')
    expect(bases).toHaveLength(1)
    expect(bases[0].querySelectorAll('[data-coluna]')).toHaveLength(3)
  })

  it('deve hachurar a coluna sem dados com o contorno que se vê, sem valor escrito', () => {
    // ARRANGE + ACT
    const { container } = render(<ColunasComDestaque colunas={COLUNAS} />)

    // ASSERT — A11Y-IND-05: o contorno tem token próprio, com ≥ 3:1 (as guardas de contraste conferem)
    const semDados = container.querySelector('[data-coluna="2026-08"] [data-sem-dados]')
    expect(semDados?.className).toContain('border-grafico-sem-dados-contorno')
    expect(semDados).toHaveTextContent('')
    // BAIXA, um terço da altura: na altura inteira roubava o olho do mês medido (DQ-20)
    expect(semDados?.className).toMatch(/(^|\s)h-1\/3(\s|$)/)
  })

  it('deve usar o token da ponta de dado, nunca um raio cru', () => {
    // ARRANGE + ACT
    const { container } = render(<ColunasComDestaque colunas={COLUNAS} />)

    // ASSERT — DQ-16
    for (const coluna of container.querySelectorAll('[data-destaque], [data-sem-dados]')) {
      expect(coluna.className).toContain('rounded-t-marca-de-dado')
    }
  })
})

describe('legendas e tabela equivalente', () => {
  it('deve desenhar a amostra do "sem dados" com o mesmo contorno da coluna', () => {
    // ARRANGE + ACT
    const { container } = render(<LegendaSemDados>mai–ago: antes dos indicadores, sem dados</LegendaSemDados>)

    // ASSERT
    expect(container.querySelector('[aria-hidden="true"]')?.className).toContain('border-grafico-sem-dados-contorno')
  })

  it('deve nomear a tabela no "Ver os números em tabela", para o leitor de tela', () => {
    // ARRANGE + ACT
    render(
      <EquivalenteEmTabela
        legenda="Recebido por mês, em regime de caixa"
        colunas={[{ rotulo: 'Mês' }, { rotulo: 'Recebido', numerica: true }]}
        linhas={[{ chave: '2026-10', celulas: ['outubro de 2026', 'R$ 10,00'] }]}
      />,
    )

    // ASSERT — A11Y-IND-06: quatro resumos iguais numa aba não diziam qual tabela abre
    const resumo = screen.getByText('Ver os números em tabela').closest('summary')
    expect(resumo).toHaveTextContent('Ver os números em tabela: Recebido por mês, em regime de caixa')
  })
})

describe('MapaDeOcupacao — a sequência do quase branco ao verde médio (DQ-02)', () => {
  const celula = (taxa: number | null, periodo: 'manha' | 'tarde' | 'noite' = 'manha', dia = 1) => ({
    dia,
    periodo,
    marcadas: 10,
    capacidade: taxa === null ? 0 : 20,
    taxa,
  })

  it('deve pôr o 0% no degrau mais claro, sem pintar, e o cheio no degrau escuro com tinta clara', () => {
    // ARRANGE + ACT
    const { container } = render(
      <MemoryRouter>
        <MapaDeOcupacao celulas={[celula(0), celula(0.95, 'tarde'), celula(0.7, 'noite')]} />
      </MemoryRouter>,
    )

    // ASSERT — o degrau 1 encosta na superfície; só o 5 troca a tinta do rótulo
    const vazia = container.querySelector('[data-faixa="0–19%"]')
    expect(vazia?.className).toContain('bg-grafico-mapa-1')
    expect(vazia?.className).toContain('text-texto')
    const cheia = container.querySelector('[data-faixa="80–100%"]')
    expect(cheia?.className).toContain('bg-grafico-mapa-5')
    expect(cheia?.className).toContain('text-sobre-acento')
    expect(container.querySelector('[data-faixa="60–79%"]')?.className).toContain('text-texto')
  })

  it('deve marcar só o DESENHO para a impressão e as cores forçadas, nunca a tabela', () => {
    // ARRANGE + ACT
    const { container } = render(
      <MemoryRouter>
        <MapaDeOcupacao celulas={[celula(0.5), celula(null, 'tarde')]} />
      </MemoryRouter>,
    )

    // ASSERT — a tabela segue o tema do sistema (A11Y-IND-08); o desenho guarda as cores dele
    for (const desenho of container.querySelectorAll('[data-grafico]')) {
      expect(desenho.querySelector('table, summary')).toBeNull()
    }
    expect(container.querySelectorAll('[data-grafico]').length).toBeGreaterThan(0)
  })
})

describe('ColunasPareadas — a série do ano também nasce de uma base só (DQ-03)', () => {
  it('deve desenhar uma linha de base para os doze meses, e não uma por mês', () => {
    // ARRANGE
    const par = (proporcao: number) => ({ proporcao, titulo: 'valor' })

    // ACT
    const { container } = render(
      <ColunasPareadas
        legendas={['Recebidas', 'Pagas']}
        itens={[
          { mes: '2026-08', primeira: par(0), segunda: par(0), semDados: true },
          { mes: '2026-09', primeira: par(100), segunda: par(40) },
          { mes: '2026-10', primeira: par(10), segunda: par(5) },
        ]}
      />,
    )

    // ASSERT
    const bases = container.querySelectorAll('.border-b')
    expect(bases).toHaveLength(1)
    expect(bases[0].querySelectorAll('[title], [data-sem-dados]').length).toBeGreaterThanOrEqual(5)
    // o mês sem dados também fica baixo na série do ano (DQ-20)
    expect(container.querySelector('[data-sem-dados]')?.className).toMatch(/(^|\s)h-1\/3(\s|$)/)
  })
})

describe('Quebra — a barra sai no papel (DQ-08)', () => {
  it('deve marcar a trilha da barra como gráfico, para a impressão pintar o fundo', () => {
    // ARRANGE + ACT
    const { container } = render(
      <Quebra
        titulo="Por sexo"
        destacarMaior
        linhas={[
          { chave: 'f', rotulo: 'Feminino', total: 8 },
          { chave: 'm', rotulo: 'Masculino', total: 4 },
        ]}
      />,
    )

    // ASSERT — sem a marca, o papel não imprime o fundo e sobra um vão entre o nome e o número
    const trilhas = container.querySelectorAll('[data-grafico]')
    expect(trilhas).toHaveLength(2)
    expect(trilhas[0].querySelector('[data-tom="destaque"]')).not.toBeNull()
  })
})

describe('o CSS dos gráficos', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('deve manter o desenho dos gráficos com as cores dele nas cores forçadas', () => {
    // ARRANGE + ACT — no alto contraste do Windows, gráfico feito de fundo de cor sumia (A11Y-IND-08)
    const bloco = /@media\s*\(forced-colors:\s*active\)\s*\{([\s\S]*?\}\s*)\}/.exec(css)?.[1] ?? ''

    // ASSERT
    expect(bloco).toMatch(/\[data-grafico\]\s*\{[^}]*forced-color-adjust:\s*none/)
  })

  it('deve ter o raio da ponta de dado como token', () => {
    // ARRANGE + ACT + ASSERT — DQ-16: 4px na régua da skill de gráficos, consumido como utilitário
    expect(css).toMatch(/--raio-marca-de-dado:\s*4px;/)
    expect(css).toMatch(/--radius-marca-de-dado:\s*var\(--raio-marca-de-dado\);/)
  })
})
