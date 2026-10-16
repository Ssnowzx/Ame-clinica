import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ABAS, permissoesDaAba } from '@/componentes/indicadores/abas-dos-indicadores'
import { BarraDeAbas } from '@/componentes/indicadores/barra-de-abas'
import { PERMISSOES_DE_INDICADORES } from '@/lib/catalogos'
import { useAuthStore } from '@/stores/auth-store'
import { usuarioFicticio } from '@/test/servidor-msw'

const TODAS = ['agenda.ver', 'fluxo_caixa.ver', 'atendimentos.ver']

function Endereco() {
  const { pathname, search } = useLocation()

  return <output data-testid="endereco">{pathname + search}</output>
}

function renderizar(caminho: string, permissoes: string[] = TODAS, mes = '2026-08') {
  useAuthStore.setState({ usuario: { ...usuarioFicticio, permissoes }, carregandoSessao: false })

  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <BarraDeAbas mes={mes} />
      <Routes>
        <Route path="*" element={<Endereco />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BarraDeAbas — navegação da área, com o período junto', () => {
  it('deve levar o mês corrente para a aba de destino', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    renderizar('/indicadores?mes=2026-08')

    // ACT
    await usuario.click(screen.getByRole('link', { name: 'Financeiro' }))

    // ASSERT — o período ATRAVESSA a troca de aba pelo endereço
    expect(screen.getByTestId('endereco')).toHaveTextContent('/indicadores/financeiro?mes=2026-08')
  })

  it('deve marcar aria-current só na aba corrente', () => {
    // ARRANGE + ACT
    renderizar('/indicadores/financeiro?mes=2026-08')

    // ASSERT
    const barra = screen.getByRole('navigation', { name: 'Seções dos indicadores' })
    expect(within(barra).getByRole('link', { name: 'Financeiro' })).toHaveAttribute('aria-current', 'page')
    const comCurrent = within(barra)
      .getAllByRole('link')
      .filter((link) => link.hasAttribute('aria-current'))
    expect(comCurrent).toHaveLength(1)
  })

  it('deve considerar o detalhe da produtividade como parte da aba Equipe', () => {
    // ARRANGE + ACT — `/indicadores/produtividade/:id` é porta da tabela da Equipe
    renderizar('/indicadores/produtividade/4?mes=2026-08')

    // ASSERT
    expect(screen.getByRole('link', { name: 'Equipe' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Visão geral' })).not.toHaveAttribute('aria-current')
  })

  it('deve esconder a aba sem permissão — e exigir TODAS quando há mais de uma', () => {
    // ARRANGE + ACT: sem fluxo_caixa.ver e sem atendimentos.ver
    renderizar('/indicadores?mes=2026-08', ['agenda.ver', 'pacientes.ver'])

    // ASSERT — a Equipe cruza agenda e clínica: só com as DUAS; o Financeiro, sem a sua, some
    const barra = screen.getByRole('navigation', { name: 'Seções dos indicadores' })
    expect(within(barra).getAllByRole('link').map((link) => link.textContent)).toEqual(['Visão geral', 'Agenda', 'Pacientes'])
  })

  it('deve abrir a Visão geral com QUALQUER módulo dono — e sumir com a barra quando só ela sobra', () => {
    // ARRANGE + ACT — só a permissão clínica: nenhuma aba de detalhe é dela sozinha
    renderizar('/indicadores?mes=2026-08', ['atendimentos.ver'])

    // ASSERT — uma aba só não é navegação: a barra nem aparece
    expect(screen.queryByRole('navigation', { name: 'Seções dos indicadores' })).not.toBeInTheDocument()
  })

  it('deve mostrar as cinco abas, na ordem, a quem tem as quatro frentes', () => {
    // ARRANGE + ACT
    renderizar('/indicadores?mes=2026-08', ['agenda.ver', 'atendimentos.ver', 'pacientes.ver', 'fluxo_caixa.ver'])

    // ASSERT
    const barra = screen.getByRole('navigation', { name: 'Seções dos indicadores' })
    expect(within(barra).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Visão geral',
      'Financeiro',
      'Agenda',
      'Pacientes',
      'Equipe',
    ])
  })

  it('deve não ser um tablist: é navegação por rota', () => {
    // ARRANGE + ACT
    renderizar('/indicadores?mes=2026-08')

    // ASSERT
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Seções dos indicadores' })).toBeInTheDocument()
  })
})

describe('BarraDeAbas — uma linha só, que rola (DQ-06)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deve manter as abas numa linha DENTRO de uma região que rola, nunca quebrando em duas', () => {
    // ARRANGE + ACT
    renderizar('/indicadores?mes=2026-08', ['agenda.ver', 'atendimentos.ver', 'pacientes.ver', 'fluxo_caixa.ver'])

    // ASSERT — quebrada, a quinta aba caía sozinha embaixo no celular
    const lista = within(screen.getByRole('navigation', { name: 'Seções dos indicadores' })).getByRole('list')
    expect(lista.className).not.toMatch(/flex-wrap/)
    expect(lista.parentElement?.className).toMatch(/overflow-x-auto/)
  })

  it('deve rolar a barra até a aba corrente quando ela nasce fora da vista', () => {
    // ARRANGE — o jsdom não mede layout: a barra tem 200px e a Equipe começa nos 300px
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80)
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('aria-current') === 'page' ? 300 : 0
    })

    // ACT
    renderizar('/indicadores/equipe?mes=2026-08', ['agenda.ver', 'atendimentos.ver', 'pacientes.ver', 'fluxo_caixa.ver'])

    // ASSERT — a região rolou até o fim da aba corrente, mais a largura do véu da borda (300 + 80 − 200 + 32)
    const lista = within(screen.getByRole('navigation', { name: 'Seções dos indicadores' })).getByRole('list')
    expect(lista.parentElement?.scrollLeft).toBe(212)
  })

  it('deve tirar de baixo do véu a aba que recebe o foco pelo teclado (A11Y-IND-11)', () => {
    // ARRANGE — a barra rolada até o fim: a primeira aba (0 a 80px) fica escondida à esquerda
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80)
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.textContent === 'Pacientes' ? 270 : 0
    })
    renderizar('/indicadores/financeiro?mes=2026-08', ['agenda.ver', 'atendimentos.ver', 'pacientes.ver', 'fluxo_caixa.ver'])
    const lista = within(screen.getByRole('navigation', { name: 'Seções dos indicadores' })).getByRole('list')
    const rolador = lista.parentElement
    if (rolador === null) {
      throw new Error('a lista de abas precisa estar dentro do rolador')
    }
    rolador.scrollLeft = 0

    // ACT — Tab até "Pacientes", que está sob o véu da direita (270 + 80 > 200 − 32)
    screen.getByRole('link', { name: 'Pacientes' }).focus()

    // ASSERT — a aba inteira na faixa livre entre os véus (270 + 80 − 200 + 32)
    expect(rolador.scrollLeft).toBe(182)
  })

  it('deve pôr o anel de foco das abas POR DENTRO, vencendo a regra global de deslocamento', () => {
    // ARRANGE + ACT
    renderizar('/indicadores?mes=2026-08')

    // ASSERT — sem o `!`, `:focus-visible { outline-offset: 2px }` (fora de camada) vencia, e o anel
    // saía para fora da aba e era cortado pela borda da região que rola
    expect(screen.getByRole('link', { name: 'Visão geral' }).className).toContain('focus-visible:-outline-offset-2!')
  })
})

describe('ABAS — guarda de contrato: toda aba aponta para rota registrada e protegida', () => {
  const app = // `app.tsx` em minúsculas: é o nome que o git conhece — em Linux `App.tsx` não existe
  readFileSync(resolve(process.cwd(), 'src/app.tsx'), 'utf8')

  it.each(ABAS.map((aba) => [aba.rotulo, aba.rota] as const))(
    'deve ter a rota da aba "%s" (%s) registrada no App',
    (_rotulo, rota) => {
      // ASSERT — aba que leva a tela inexistente é promessa quebrada (D3 da change)
      expect(app).toContain(`path="${rota}"`)
    },
  )

  it.each(ABAS.map((aba) => [aba.rotulo, aba] as const))(
    'deve proteger a rota da aba "%s" com as permissões que a aba declara',
    (_rotulo, aba) => {
      // a proteção mora na rota FILHA, não só no shell: o trecho do App entre o `path` da aba
      // e o fim do `<Route` precisa declarar cada permissão da aba
      const inicio = app.indexOf(`path="${aba.rota}"`)
      const trecho = app.slice(inicio, app.indexOf('/>', inicio))
      for (const permissao of permissoesDaAba(aba)) {
        // a raiz da área usa o guarda-chuva por NOME (qualquer módulo dono abre o painel);
        // vale como declaração quando a permissão da aba está nele
        const pelaConstante =
          PERMISSOES_DE_INDICADORES.includes(permissao) && trecho.includes('PERMISSOES_DE_INDICADORES')
        expect(trecho.includes(permissao) || pelaConstante).toBe(true)
      }
    },
  )
})
