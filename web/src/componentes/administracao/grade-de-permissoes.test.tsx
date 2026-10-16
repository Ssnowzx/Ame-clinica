import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { describe, expect, it, vi } from 'vitest'

import { GradeDePermissoes } from '@/componentes/administracao/grade-de-permissoes'
import { rotuloDaAcao, rotuloDoModulo } from '@/lib/permissoes-rotulos'

expect.extend(toHaveNoViolations)

/**
 * Encontra a linha do MÓDULO pela sua célula de cabeçalho. Desde o agrupamento por área, a
 * linha de grupo também é `rowheader` (`scope="rowgroup"`) e há nome que serve aos dois —
 * "Agenda" é área E módulo. O `colSpan` é o que os separa: o grupo atravessa a tabela.
 */
function linhaDoModulo(rotulo: string): HTMLElement {
  const celula = screen
    .getAllByRole('rowheader', { name: rotulo })
    .find((elemento) => !elemento.hasAttribute('colspan'))
  return celula?.closest('tr') as HTMLElement
}

/** Os cabeçalhos de ÁREA, na ordem em que a grade os desenha. */
function gruposRenderizados(): (string | null)[] {
  return screen
    .getAllByRole('rowheader')
    .filter((elemento) => elemento.hasAttribute('colspan'))
    .map((elemento) => elemento.textContent)
}

describe('GradeDePermissoes — derivada do catálogo (SEC-ADM-08)', () => {
  it('deve desenhar célula só para a permissão que existe no catálogo', () => {
    // ARRANGE — pacientes tem ver/criar/editar, SEM excluir
    const catalogo = ['pacientes.ver', 'pacientes.criar', 'pacientes.editar', 'agenda.ver', 'agenda.excluir']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — a linha de pacientes tem checkbox de Ver, mas nenhum de Excluir
    const pacientes = linhaDoModulo('Pacientes')
    expect(within(pacientes).getByRole('checkbox', { name: 'Pacientes: Ver' })).toBeInTheDocument()
    expect(within(pacientes).queryByRole('checkbox', { name: 'Pacientes: Excluir' })).not.toBeInTheDocument()
  })

  it('deve renderizar módulo desconhecido com o nome cru, nunca omitir', () => {
    // ARRANGE — um módulo que a tela não conhece. A ação também precisa ser inventada: o
    // exemplo anterior usava `aprovar`, que GANHOU rótulo quando o dicionário foi completado
    // (validação em produção, 2026-08-21) — e um teste de "desconhecido" que usa um nome
    // conhecido deixa de testar o que promete
    const catalogo = ['modulo_novo.ver', 'modulo_novo.acao_que_ninguem_traduziu']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — aparece com o nome cru e as ações (inclusive a desconhecida)
    const linha = linhaDoModulo('modulo_novo')
    expect(within(linha).getByRole('checkbox', { name: 'modulo_novo: Ver' })).toBeInTheDocument()
    expect(
      within(linha).getByRole('checkbox', { name: 'modulo_novo: acao_que_ninguem_traduziu' }),
    ).toBeInTheDocument()
  })

  it('deve avisar que niveis_permissao.editar equivale a administração total (SEC-ADM-02)', () => {
    // ARRANGE
    const catalogo = ['niveis_permissao.ver', 'niveis_permissao.editar']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — o aviso chega a quem NÃO vê o triângulo: ele descreve a própria caixa.
    // A versão anterior aceitava o `aria-label` do ícone, que o teclado nunca alcança.
    const caixa = screen.getByRole('checkbox', { name: 'Níveis de permissão: Editar' })
    expect(caixa).toHaveAccessibleDescription(
      'Equivale a administração total da clínica: quem tiver este nível pode conceder qualquer permissão a qualquer usuário.',
    )
    // e a caixa vizinha, que não é administração total, não herda a descrição
    expect(screen.getByRole('checkbox', { name: 'Níveis de permissão: Ver' })).not.toHaveAccessibleDescription()
  })

  it('não deve incluir as flags de escopo na grade (elas vão à seção de escopo)', () => {
    // ARRANGE
    const catalogo = ['agenda.ver', 'agenda.ver_todos', 'clinico.ver_todos']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — nenhuma coluna/célula das flags de escopo.
    // As asserções procuram pelo que a tela RENDERIZA, e o texto é DERIVADO do dicionário,
    // nunca copiado: a versão original procurava as chaves cruas /ver_todos/ e /clinico/, que
    // o DOM nunca teve, e não podia falhar. Copiar os rótulos à mão só alonga esse pavio —
    // asserção NEGATIVA com literal passa a valer trivialmente no dia em que o rótulo muda, e
    // morre em silêncio de novo. Derivada, ela sobrevive inclusive à REMOÇÃO da entrada do
    // dicionário: aí a função devolve a chave crua e a tela renderiza a chave crua.
    // Provado por mutação (2026-08-27): tirando o `.filter` das flags, as duas asserções caem.
    expect(
      screen.queryByRole('checkbox', { name: new RegExp(rotuloDaAcao('ver_todos')) }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('rowheader', { name: rotuloDoModulo('clinico') }),
    ).not.toBeInTheDocument()
  })
})


/**
 * Provado por mutação (2026-08-26): com `LIMIAR_DE_COLUNA` sabotado para 1 — toda ação vira
 * coluna, que é o estado anterior à change — três destes testes caem. A guarda cobre o ramo
 * que ela guarda.
 */
describe('GradeDePermissoes — coluna só para ação compartilhada (D1)', () => {
  it('deve dar coluna à ação que dois ou mais módulos têm', () => {
    // ARRANGE — `ver` em dois módulos, `reabrir` em um só
    const catalogo = ['agenda.ver', 'ciclos.ver', 'ciclos.reabrir']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — Ver é coluna, com célula nos dois módulos; Reabrir não é coluna
    expect(screen.getByRole('columnheader', { name: 'Ver' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Reabrir' })).not.toBeInTheDocument()
    expect(within(linhaDoModulo('Agenda')).getByRole('checkbox', { name: 'Agenda: Ver' })).toBeInTheDocument()
    expect(
      within(linhaDoModulo('Ciclos de faturamento')).getByRole('checkbox', { name: 'Ciclos de faturamento: Ver' }),
    ).toBeInTheDocument()
  })

  it('deve oferecer a ação de módulo único como caixa rotulada na própria linha', () => {
    // ARRANGE — `reabrir` só existe em ciclos
    const catalogo = ['agenda.ver', 'ciclos.ver', 'ciclos.reabrir']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — a caixa vive na linha de ciclos, com o rótulo VISÍVEL (fora das colunas, a
    // ação precisa se dizer) e o mesmo nome acessível de sempre
    const ciclos = linhaDoModulo('Ciclos de faturamento')
    expect(within(ciclos).getByRole('checkbox', { name: 'Ciclos de faturamento: Reabrir' })).toBeInTheDocument()
    expect(within(ciclos).getByText('Reabrir')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Outras ações' })).toBeInTheDocument()
  })

  it('deve alternar a permissão de módulo único pelo clique na caixa', async () => {
    // ARRANGE
    const catalogo = ['agenda.ver', 'ciclos.ver', 'ciclos.reabrir']
    const aoAlternar = vi.fn()
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={aoAlternar} />)

    // ACT
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ciclos de faturamento: Reabrir' }))

    // ASSERT
    expect(aoAlternar).toHaveBeenCalledWith('ciclos.reabrir', true)
  })

  it('deve mostrar ação desconhecida de módulo único com o nome cru, nunca omitir (SEC-ADM-08)', () => {
    // ARRANGE — módulo E ação que a tela não conhece, ambos de ocorrência única
    const catalogo = ['agenda.ver', 'pacientes.ver', 'modulo_novo.acao_que_ninguem_traduziu']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — fora das colunas, mas presente e marcável, com o nome cru à vista
    const linha = linhaDoModulo('modulo_novo')
    expect(
      within(linha).getByRole('checkbox', { name: 'modulo_novo: acao_que_ninguem_traduziu' }),
    ).toBeInTheDocument()
    expect(within(linha).getByText('acao_que_ninguem_traduziu')).toBeInTheDocument()
  })

  it('não deve desenhar a coluna de outras ações quando toda ação é compartilhada', () => {
    // ARRANGE — ver e editar em dois módulos cada: nada sobra
    const catalogo = ['agenda.ver', 'agenda.editar', 'pacientes.ver', 'pacientes.editar']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT
    expect(screen.queryByRole('columnheader', { name: 'Outras ações' })).not.toBeInTheDocument()
  })
})

describe('GradeDePermissoes — módulos agrupados por área (D2)', () => {
  it('deve agrupar os módulos na ordem de leitura da clínica', () => {
    // ARRANGE — um módulo de cada área, em ordem trocada
    const catalogo = ['lancamentos.ver', 'lancamentos.editar', 'agenda.ver', 'agenda.editar', 'usuarios.ver', 'usuarios.editar']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — Administração antes de Agenda, Agenda antes de Financeiro
    expect(gruposRenderizados()).toEqual(['Administração', 'Agenda', 'Financeiro'])
  })

  it('deve pôr módulo de área desconhecida no grupo "Outros", marcável', () => {
    // ARRANGE
    const catalogo = ['agenda.ver', 'agenda.editar', 'modulo_novo.ver', 'modulo_novo.editar']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — o grupo existe, e a permissão do módulo continua marcável
    expect(screen.getByRole('rowheader', { name: 'Outros' })).toBeInTheDocument()
    expect(
      within(linhaDoModulo('modulo_novo')).getByRole('checkbox', { name: 'modulo_novo: Ver' }),
    ).toBeInTheDocument()
  })

  it('deve ordenar os módulos por RÓTULO, não pela chave, dentro do grupo', () => {
    // ARRANGE — par do grupo `cadastros` em que chave e rótulo DISCORDAM: por chave,
    // `anamnese_modelos` vem antes de `medicos`; por rótulo, "Médicos solicitantes" vem
    // antes de "Modelos de anamnese". A fixture anterior (salas/convenios/equipamentos)
    // dava a mesma ordem nos dois critérios e sobrevivia à mutação que promete guardar.
    const catalogo = ['medicos.ver', 'medicos.editar', 'anamnese_modelos.ver', 'anamnese_modelos.editar']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — a linha do grupo também é rowheader, então filtra pelos módulos
    const modulos = screen
      .getAllByRole('rowheader')
      .filter((elemento) => !elemento.hasAttribute('colspan'))
      .map((elemento) => elemento.textContent)
    expect(modulos).toEqual(['Médicos solicitantes', 'Modelos de anamnese'])
  })
})

describe('GradeDePermissoes — legibilidade (D3, D4)', () => {
  it('deve dar à caixa um alvo de clique de 24px, com a caixa 20x20 do design system dentro', () => {
    // ARRANGE
    const catalogo = ['agenda.ver', 'pacientes.ver']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — o alvo (o próprio checkbox) mede 24; a caixa desenhada dentro dele, 20
    const alvo = screen.getByRole('checkbox', { name: 'Agenda: Ver' })
    expect(alvo.className).toContain('size-6')
    expect((alvo.firstElementChild as HTMLElement).className).toContain('size-5')
  })

  it('deve manter o cabeçalho das colunas fixo durante a rolagem', () => {
    // ARRANGE
    const catalogo = ['agenda.ver', 'pacientes.ver']

    // ACT
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set()} aoAlternar={vi.fn()} />)

    // ASSERT — sticky no cabeçalho e rolagem própria no contêiner que o ancora
    const cabecalho = screen.getByRole('columnheader', { name: 'Módulo' })
    expect(cabecalho.className).toContain('sticky')
    const rolagem = cabecalho.closest('table')?.parentElement as HTMLElement
    expect(rolagem.className).toContain('overflow-auto')
    expect(rolagem.className).toContain('max-h-96')
  })
})

describe('GradeDePermissoes — gate de acessibilidade', () => {
  it('não deve ter violação de axe no cenário COM grupo e COM ação rotulada', async () => {
    // ARRANGE — o cenário precisa exercitar as duas construções que a change introduziu:
    // o cabeçalho de grupo (`scope="rowgroup"` num `<tbody>` por área) e a caixa rotulada de
    // "Outras ações". Axe no cenário vizinho não prova guarda nenhuma — foi assim que uma
    // guarda passou verde sobre o ramo errado antes (2026-08-25).
    const catalogo = [
      'usuarios.ver',
      'usuarios.editar',
      'agenda.ver',
      'agenda.editar',
      'ciclos.reabrir',
      'ciclos.ver',
      'ciclos.editar',
      // a construção mais nova também precisa passar pelo axe: aviso de administração
      // total como `aria-describedby` + `sr-only`, com o ícone decorativo
      'niveis_permissao.ver',
      'niveis_permissao.editar',
    ]
    render(<GradeDePermissoes catalogo={catalogo} selecionadas={new Set(['agenda.ver'])} aoAlternar={vi.fn()} />)
    // o cenário está montado como prometido
    expect(screen.getByRole('rowheader', { name: 'Administração' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Ciclos de faturamento: Reabrir' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Níveis de permissão: Editar' })).toHaveAccessibleDescription()

    // ACT
    const resultado = await axe(document.body)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})
