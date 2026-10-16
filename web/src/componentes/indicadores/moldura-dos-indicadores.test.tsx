import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http as msw } from 'msw'
import { lazy, type ComponentType } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  CartaoPendente,
  GradeDeCartoes,
  LinhaDoPeriodoPendente,
  ParDeQuadros,
} from '@/componentes/indicadores/moldura-dos-indicadores'
import { ShellDeIndicadores } from '@/componentes/indicadores/shell-de-indicadores'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { servidor, usuarioFicticio } from '@/test/servidor-msw'

beforeEach(() => {
  queryClient.clear()
})

describe('GradeDeCartoes — nunca um cartão órfão numa linha (DQ-13)', () => {
  it.each([
    // [quantos cartões, colunas que TÊM de existir]
    [5, ['grid-cols-1', '@min-[26rem]:grid-cols-2', '@min-[36rem]:grid-cols-3', '@min-[64rem]:grid-cols-5']],
    [4, ['grid-cols-1', '@min-[26rem]:grid-cols-2', '@min-[60rem]:grid-cols-4']],
    [3, ['grid-cols-1', '@min-[26rem]:grid-cols-2', '@min-[36rem]:grid-cols-3']],
  ])('deve arrumar %s cartões em linhas cheias, sem o auto-fit que deixava um sozinho', (quantidade, tem) => {
    // ARRANGE + ACT
    const { container } = render(
      <GradeDeCartoes quantidade={quantidade}>
        <span>cartão</span>
      </GradeDeCartoes>,
    )

    // ASSERT
    const classes = (container.firstElementChild?.className ?? '').split(/\s+/)
    for (const classe of tem) {
      expect(classes).toContain(classe)
    }
    expect(classes.join(' ')).not.toMatch(/auto-fit|auto-fill/)
  })

  it.each([
    // com ÍMPAR de cartões, a manchete ocupa duas colunas onde a linha não comporta todos — e volta a
    // uma onde comporta: 5 = manchete + 2 + 2 no tablet, manchete + 1 e 3 de 36rem, 5 de 64rem
    [5, '@min-[26rem]:[&>:first-child]:col-span-2', '@min-[64rem]:[&>:first-child]:col-span-1'],
    [3, '@min-[26rem]:[&>:first-child]:col-span-2', '@min-[36rem]:[&>:first-child]:col-span-1'],
  ])('deve alargar a manchete com %s cartões para fechar as linhas', (quantidade, alarga, volta) => {
    // ARRANGE + ACT
    const { container } = render(
      <GradeDeCartoes quantidade={quantidade}>
        <span>cartão</span>
      </GradeDeCartoes>,
    )

    // ASSERT
    const classes = (container.firstElementChild?.className ?? '').split(/\s+/)
    expect(classes).toContain(alarga)
    expect(classes).toContain(volta)
  })

  it('não deve alargar ninguém com quatro cartões: 2 + 2 já fecha', () => {
    // ARRANGE + ACT
    const { container } = render(
      <GradeDeCartoes quantidade={4}>
        <span>cartão</span>
      </GradeDeCartoes>,
    )

    // ASSERT
    expect(container.firstElementChild?.className).not.toMatch(/col-span-2/)
  })
})

describe('ParDeQuadros — os dois quadros com a mesma altura (DQ-04)', () => {
  it('não deve alinhar pelo topo: a grade estica os dois até a altura do maior', () => {
    // ARRANGE + ACT
    const { container } = render(
      <ParDeQuadros>
        <span>um</span>
        <span>outro</span>
      </ParDeQuadros>,
    )

    // ASSERT — `items-start` deixava o quadro curto com um buraco embaixo
    expect(container.firstElementChild?.className).not.toMatch(/items-start/)
  })
})

describe('a moldura do cartão — as seis faixas seguem as da linha (DQ-05)', () => {
  it('deve ser subgrid das linhas da grade, e sem contenção de layout, que desliga o subgrid', () => {
    // ARRANGE + ACT
    render(<CartaoPendente rotulo="Agenda" />)

    // ASSERT — a comparação que quebra num cartão empurra a frase de todos os vizinhos junto; um
    // `@container` no cartão liga `contain: layout`, e elemento contido não pode ser subgrid
    const cartao = screen.getByRole('region', { name: 'Agenda' })
    expect(cartao.className).toMatch(/(^|\s)grid-rows-subgrid(\s|$)/)
    expect(cartao.className).toMatch(/(^|\s)row-span-6(\s|$)/)
    expect(cartao.className).not.toMatch(/@container/)
    expect(cartao.children).toHaveLength(6)
  })
})

describe('os esqueletos — a anatomia e a tipografia do conteúdo (DQ-15, PERF-01)', () => {
  it('deve reservar no cartão pendente as linhas da frase que ele vai ter', () => {
    // ARRANGE + ACT
    render(<CartaoPendente rotulo="Agenda" linhasDaFrase={4} comPorta />)

    // ASSERT — ocupado, com a moldura no lugar e uma linha por linha da frase
    const cartao = screen.getByRole('region', { name: 'Agenda' })
    expect(cartao).toHaveAttribute('aria-busy', 'true')
    expect(cartao.querySelectorAll('.border-t p.text-corpo')).toHaveLength(4)
    // o número pendente tem a tipografia do número de verdade: a altura é a da linha
    expect(cartao.querySelector('p.text-display')).not.toBeNull()
  })

  it('deve reservar a linha do período pendente em uma linha, e em duas abaixo de 36rem', () => {
    // ARRANGE + ACT
    const { container } = render(<LinhaDoPeriodoPendente />)

    // ASSERT — a altura da linha que vai chegar (CLS 0): a segunda some a partir de 36rem de área
    const linhas = [...container.querySelectorAll('p.text-meta')]
    expect(linhas).toHaveLength(2)
    expect(linhas[1].className).toContain('@min-[36rem]:hidden')
  })

  it('deve reservar na frase pendente as linhas de cada largura do cartão', () => {
    // ARRANGE + ACT — a frase da Agenda: 8 linhas no cartão estreito, 6 no médio, 4 no largo
    render(<CartaoPendente rotulo="Agenda" linhasDaFrase={[8, 6, 4]} />)

    // ASSERT
    const linhas = [...screen.getByRole('region', { name: 'Agenda' }).querySelectorAll('.border-t p.text-corpo')]
    expect(linhas).toHaveLength(8)
    expect(linhas.filter((linha) => linha.className.includes('@min-[12rem]:hidden'))).toHaveLength(2)
    expect(linhas.filter((linha) => linha.className.includes('@min-[18rem]:hidden'))).toHaveLength(4)
    expect(linhas[0].closest('.border-t')?.className).toMatch(/@container/)
  })
})

describe('ShellDeIndicadores — a aba sob demanda (PERF-08)', () => {
  it('deve segurar a caixa com o esqueleto da área enquanto o código da aba chega', async () => {
    // ARRANGE — uma aba que só "chega" quando o teste deixa
    let entregar: ((modulo: { default: ComponentType }) => void) | undefined
    const AbaPreguicosa = lazy(
      () =>
        new Promise<{ default: ComponentType }>((resolve) => {
          entregar = resolve
        }),
    )
    servidor.use(msw.get('/api/agenda/configuracoes', () => HttpResponse.json({ configuracoes: [] })))
    useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes: ['agenda.ver'] }, carregandoSessao: false })

    // ACT
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/indicadores/agenda?mes=2026-10']}>
          <Routes>
            <Route element={<ShellDeIndicadores />}>
              <Route path="/indicadores/agenda" element={<AbaPreguicosa />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // ASSERT — o cabeçalho da área já está no lugar, e a caixa do conteúdo, ocupada
    expect(screen.getByRole('heading', { name: 'Indicadores', level: 1 })).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Carregando a aba' })).toHaveAttribute('aria-busy', 'true')

    // ACT — o código chega
    entregar?.({ default: () => <p>Aba carregada</p> })

    // ASSERT
    expect(await screen.findByText('Aba carregada')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Carregando a aba' })).not.toBeInTheDocument())
  })
})
