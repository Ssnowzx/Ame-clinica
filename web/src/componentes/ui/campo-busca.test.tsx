import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { CampoBusca, type OpcaoDeBusca, type SecaoDeBusca } from '@/componentes/ui/campo-busca'

expect.extend(toHaveNoViolations)

const OPCOES: OpcaoDeBusca[] = [
  { valor: 1, rotulo: 'Paciente Fictício Ana' },
  { valor: 2, rotulo: 'Paciente Fictício Bruno' },
  { valor: 3, rotulo: 'Paciente Fictício Carla' },
]

/** Harness controlado — o consumidor é o dono do estado (como no formulário). */
function Harness({
  aoSelecionar = vi.fn(),
  opcoes = OPCOES,
  carregando = false,
  falhou = false,
  existeInativo = false,
  escolhaInicial = null,
}: {
  aoSelecionar?: (opcao: OpcaoDeBusca | null) => void
  opcoes?: OpcaoDeBusca[]
  carregando?: boolean
  falhou?: boolean
  existeInativo?: boolean
  /** Campo que ABRE com alguém escolhido — card em edição, ou o modo retorno da agenda */
  escolhaInicial?: OpcaoDeBusca | null
}) {
  const [selecionado, setSelecionado] = useState<OpcaoDeBusca | null>(escolhaInicial)
  const [termo, setTermo] = useState(escolhaInicial?.rotulo ?? '')

  return (
    <CampoBusca
      rotulo="Paciente"
      selecionado={selecionado}
      aoSelecionar={(opcao) => {
        setSelecionado(opcao)
        aoSelecionar(opcao)
      }}
      termo={termo}
      aoDigitar={setTermo}
      opcoes={opcoes}
      carregando={carregando}
      falhou={falhou}
      existeInativo={existeInativo}
    />
  )
}

const SECOES: SecaoDeBusca[] = [
  { nome: 'Recentes', opcoes: [{ valor: 9, rotulo: 'Paciente Fictício Zeca' }] },
  { nome: 'Todos', opcoes: OPCOES },
]

/** Harness com seções — o formato que a escolha de paciente usa ao abrir sem digitar. */
function HarnessComSecoes({
  secoes = SECOES,
  aoAproximarDoFim,
  carregandoMais = false,
  aoSelecionar = vi.fn(),
}: {
  secoes?: SecaoDeBusca[]
  aoAproximarDoFim?: () => void
  carregandoMais?: boolean
  aoSelecionar?: (opcao: OpcaoDeBusca | null) => void
}) {
  const [selecionado, setSelecionado] = useState<OpcaoDeBusca | null>(null)
  const [termo, setTermo] = useState('')

  return (
    <CampoBusca
      rotulo="Paciente"
      selecionado={selecionado}
      aoSelecionar={(opcao) => {
        setSelecionado(opcao)
        aoSelecionar(opcao)
      }}
      termo={termo}
      aoDigitar={setTermo}
      opcoes={secoes}
      aoAproximarDoFim={aoAproximarDoFim}
      carregandoMais={carregandoMais}
    />
  )
}

/** Rola a lista até a fração pedida — o jsdom não faz layout, então as medidas são injetadas. */
function rolarLista(fracao: number) {
  const lista = screen.getByRole('listbox')
  Object.defineProperty(lista, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(lista, 'clientHeight', { value: 200, configurable: true })
  Object.defineProperty(lista, 'scrollTop', { value: fracao * 1000 - 200, configurable: true })
  fireEvent.scroll(lista)
}

describe('CampoBusca — o que a caixa diz quando não há o que escolher', () => {
  it('deve dizer que a lista falhou, em vez de ficar muda', async () => {
    // ARRANGE: falha NÃO é ausência de dado. Sem esta linha, um 500 vira "não há criança
    // ativa no cadastro" — e a saída natural de quem lê isso é pré-cadastrar (achado CR-BPL-04)
    const usuario = userEvent.setup()
    render(<Harness opcoes={[]} falhou />)

    // ACT
    await usuario.click(screen.getByRole('combobox'))

    // ASSERT
    expect(screen.getByText('Não foi possível carregar a lista. Tente de novo.')).toBeInTheDocument()
  })

  it('deve avisar a falha mesmo com termo digitado', async () => {
    // ARRANGE: falha é falha em qualquer modo — não depende de quantas letras foram digitadas
    const usuario = userEvent.setup()
    render(<Harness opcoes={[]} falhou />)

    // ACT
    await usuario.type(screen.getByRole('combobox'), 'ana')

    // ASSERT
    expect(screen.getByText('Não foi possível carregar a lista. Tente de novo.')).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum resultado/)).not.toBeInTheDocument()
  })

  it('deve dizer que o catálogo está vazio quando não há nada a oferecer', async () => {
    // ARRANGE: campo vazio + catálogo vazio não é "nenhum resultado para ''" — é outra frase
    const usuario = userEvent.setup()
    render(<Harness opcoes={[]} />)

    // ACT
    await usuario.click(screen.getByRole('combobox'))

    // ASSERT
    expect(screen.getByText('Nada para escolher aqui ainda.')).toBeInTheDocument()
  })

  it('deve resetar o realce quando a lista em seções vira busca simples', async () => {
    // ARRANGE: trocar de MODO troca o conjunto inteiro — o realce não pode sobreviver
    // apontando para uma posição de outra lista (o `modo` na dep do reset; achado CR-BPL-05)
    const usuario = userEvent.setup()
    const { rerender } = render(<HarnessComSecoes />)
    await usuario.click(screen.getByRole('combobox'))
    await usuario.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant')

    // ACT: as mesmas opções, agora como lista SIMPLES (o que a busca devolve)
    rerender(<HarnessComSecoes secoes={[{ nome: '', opcoes: OPCOES }]} />)

    // ASSERT: ninguém realçado — o Enter volta a ser do formulário
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-activedescendant')
  })
})

describe('CampoBusca — lista sem digitar, em seções (busca-de-paciente-com-lista)', () => {
  it('deve abrir com as opções sem que nada seja digitado', async () => {
    // ARRANGE: reconhecer é mais barato que lembrar — a caixa não pode abrir vazia
    const usuario = userEvent.setup()
    render(<HarnessComSecoes />)

    // ACT
    await usuario.click(screen.getByRole('combobox'))

    // ASSERT
    expect(screen.getAllByRole('option')).toHaveLength(4)
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  it('deve nomear cada seção para quem usa leitor de tela', async () => {
    // ARRANGE: o cabeçalho visual é decorativo; o nome vem do grupo, uma vez só
    const usuario = userEvent.setup()
    render(<HarnessComSecoes />)

    // ACT — a lista (e os grupos) só existem com a caixa aberta: um `listbox` sem `option`
    // dentro é ARIA inválido, então ele nem é renderizado fechado (A11Y-PIS-01)
    await usuario.click(screen.getByRole('combobox'))

    // ASSERT
    expect(screen.getByRole('group', { name: 'Recentes' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Todos' })).toBeInTheDocument()
  })

  it('deve atravessar a fronteira das seções com as setas', async () => {
    // ARRANGE: a seção é organização visual — para o teclado, a lista é uma só
    const usuario = userEvent.setup()
    render(<HarnessComSecoes />)
    await usuario.click(screen.getByRole('combobox'))

    // ACT: 1ª seta entra na única opção de "Recentes"; a 2ª atravessa para "Todos"
    await usuario.keyboard('{ArrowDown}{ArrowDown}')

    // ASSERT: o id conferido contra o `option` REAL — `stringContaining('-opcao-1')` casaria
    // também com `-opcao-10` numa lista paginada (achado CR-BPL-12)
    const primeiraDeTodos = within(screen.getByRole('group', { name: 'Todos' })).getAllByRole('option')[0]
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', primeiraDeTodos?.id)
    await usuario.keyboard('{Enter}')
    expect(screen.getByRole('combobox')).toHaveValue('Paciente Fictício Ana')
  })

  it('deve pedir a próxima página ao rolar para perto do fim', () => {
    // ARRANGE
    const aoAproximarDoFim = vi.fn()
    render(<HarnessComSecoes aoAproximarDoFim={aoAproximarDoFim} />)
    fireEvent.focus(screen.getByRole('combobox'))

    // ACT
    rolarLista(0.5)
    expect(aoAproximarDoFim).not.toHaveBeenCalled()
    rolarLista(0.9)

    // ASSERT
    expect(aoAproximarDoFim).toHaveBeenCalledTimes(1)
  })

  it('deve não pedir outra página enquanto a anterior não chegou', () => {
    // ARRANGE: sem trava, uma rolagem contínua dispara uma consulta por evento de scroll
    const aoAproximarDoFim = vi.fn()
    render(<HarnessComSecoes aoAproximarDoFim={aoAproximarDoFim} carregandoMais />)
    fireEvent.focus(screen.getByRole('combobox'))

    // ACT
    rolarLista(0.95)

    // ASSERT
    expect(aoAproximarDoFim).not.toHaveBeenCalled()
    expect(screen.getByText('Carregando mais…')).toBeInTheDocument()
  })

  it('deve manter o realce quando uma página nova chega pela rolagem', async () => {
    // ARRANGE: acrescentar ao fim NÃO é trocar de conjunto — o realce não pode voltar
    // para a 1ª opção (é assim que o Enter marca no paciente errado entre homônimos)
    const usuario = userEvent.setup()
    const { rerender } = render(<HarnessComSecoes />)
    await usuario.click(screen.getByRole('combobox'))
    await usuario.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    const realcado = screen.getByRole('combobox').getAttribute('aria-activedescendant')
    expect(screen.getByText('Paciente Fictício Bruno').id).toBe(realcado)

    // ACT: a página seguinte chega no fim da seção "Todos"
    rerender(
      <HarnessComSecoes
        secoes={[
          SECOES[0]!,
          { nome: 'Todos', opcoes: [...OPCOES, { valor: 4, rotulo: 'Paciente Fictício Davi' }] },
        ]}
      />,
    )

    // ASSERT: o realce continua na MESMA criança, não no mesmo índice
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe(realcado)
    expect(screen.getByText('Paciente Fictício Bruno').id).toBe(realcado)
  })

  it('deve não selecionar ninguém ao abrir, rolar e sair sem confirmar (T-aes-09)', async () => {
    // ARRANGE: a lista aumentou a superfície de gestos — nenhum deles pode marcar
    const usuario = userEvent.setup()
    const aoSelecionar = vi.fn()
    render(
      <>
        <HarnessComSecoes aoSelecionar={aoSelecionar} />
        <button type="button">Fora</button>
      </>,
    )
    await usuario.click(screen.getByRole('combobox'))

    // ACT
    await usuario.keyboard('{ArrowDown}{ArrowDown}')
    rolarLista(0.9)
    await usuario.click(screen.getByRole('button', { name: 'Fora' }))

    // ASSERT: o campo vazio não bastava — quem prova que ninguém foi marcado é o espião
    expect(aoSelecionar).not.toHaveBeenCalledWith(expect.objectContaining({ valor: expect.any(Number) }))
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  it('deve não ter violações axe com as seções abertas', async () => {
    // ARRANGE
    const { container } = render(<HarnessComSecoes />)
    fireEvent.focus(screen.getByRole('combobox'))

    // ACT
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})

describe('CampoBusca — o id só muda por seleção explícita (T-aes-09)', () => {
  it('deve não escolher ninguém quando o usuário só digita o nome completo', async () => {
    // ARRANGE: digitar o nome inteiro NÃO pode virar id — marcar no menor errado
    // é incidente de LGPD, não deslize de usabilidade
    const usuario = userEvent.setup()
    const aoSelecionar = vi.fn()
    render(<Harness aoSelecionar={aoSelecionar} />)

    // ACT
    await usuario.type(screen.getByRole('combobox'), 'Paciente Fictício Ana')

    // ASSERT
    expect(aoSelecionar).not.toHaveBeenCalledWith(expect.objectContaining({ valor: 1 }))
  })

  it('deve escolher ao clicar na opção', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoSelecionar = vi.fn()
    render(<Harness aoSelecionar={aoSelecionar} />)

    // ACT
    await usuario.click(screen.getByRole('combobox'))
    await usuario.click(screen.getByRole('option', { name: 'Paciente Fictício Bruno' }))

    // ASSERT
    expect(aoSelecionar).toHaveBeenCalledWith({ valor: 2, rotulo: 'Paciente Fictício Bruno' })
    expect(screen.getByRole('combobox')).toHaveValue('Paciente Fictício Bruno')
  })

  it('deve desfazer a escolha quando o usuário edita o texto depois de escolher', async () => {
    // ARRANGE: o rótulo exibido e o id enviado NUNCA podem divergir
    const usuario = userEvent.setup()
    const aoSelecionar = vi.fn()
    render(<Harness aoSelecionar={aoSelecionar} />)
    await usuario.click(screen.getByRole('combobox'))
    await usuario.click(screen.getByRole('option', { name: 'Paciente Fictício Ana' }))

    // ACT: continua digitando
    await usuario.type(screen.getByRole('combobox'), 'zzz')

    // ASSERT: a escolha caiu
    expect(aoSelecionar).toHaveBeenLastCalledWith(null)
  })

  it('deve restaurar o rótulo do escolhido ao sair sem escolher', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness />)
    await usuario.click(screen.getByRole('combobox'))
    await usuario.click(screen.getByRole('option', { name: 'Paciente Fictício Ana' }))

    // ACT: mexe no texto e desiste com Escape
    await usuario.type(screen.getByRole('combobox'), '{Backspace}{Backspace}')
    await usuario.keyboard('{Escape}')

    // ASSERT: o campo volta a mostrar quem está selecionado
    expect(screen.getByRole('combobox')).toHaveValue('Paciente Fictício Ana')
  })
})

describe('CampoBusca — teclado', () => {
  it('deve escolher sem tocar no mouse', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoSelecionar = vi.fn()
    render(<Harness aoSelecionar={aoSelecionar} />)

    // ACT: tab (foco abre a lista, sem NADA realçado) → a 1ª seta entra na 1ª opção → enter
    await usuario.tab()
    await usuario.keyboard('{ArrowDown}{Enter}')

    // ASSERT: a PRIMEIRA opção — a seta inicial não pula mais ninguém (WAI-ARIA APG)
    expect(aoSelecionar).toHaveBeenCalledWith({ valor: 1, rotulo: 'Paciente Fictício Ana' })
  })

  it('deve não escolher ninguém quando o Enter chega sem nenhuma seta', async () => {
    // ARRANGE: com a lista abrindo POPULADA, focar o campo e apertar Enter para submeter o
    // formulário marcava a 1ª criança da lista — ninguém apontou para ela (achado CR-BPL-01).
    // O Enter sem realce é do FORMULÁRIO, não da caixa.
    const usuario = userEvent.setup()
    const aoSelecionar = vi.fn()
    render(<Harness aoSelecionar={aoSelecionar} />)

    // ACT
    await usuario.tab()
    await usuario.keyboard('{Enter}')

    // ASSERT
    expect(aoSelecionar).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox')).toHaveValue('')
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-activedescendant')
  })

  it('deve não escolher ninguém ao abrir a lista em seções e apertar Enter', async () => {
    // ARRANGE: o mesmo, no formato que a escolha de paciente usa de verdade
    const usuario = userEvent.setup()
    render(<HarnessComSecoes />)

    // ACT
    await usuario.click(screen.getByRole('combobox'))
    await usuario.keyboard('{Enter}')

    // ASSERT
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  it('deve circular na lista com as setas', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const aoSelecionar = vi.fn()
    render(<Harness aoSelecionar={aoSelecionar} />)

    // ACT: abre e sobe (circula para o fim da lista)
    await usuario.click(screen.getByRole('combobox'))
    await usuario.keyboard('{ArrowUp}{Enter}')

    // ASSERT
    expect(aoSelecionar).toHaveBeenCalledWith({ valor: 3, rotulo: 'Paciente Fictício Carla' })
  })
})

describe('CampoBusca — estados', () => {
  it('deve informar quando a busca não encontra nada', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    render(<Harness opcoes={[]} />)

    // ACT
    await usuario.type(screen.getByRole('combobox'), 'zzz')

    // ASSERT: não pode parecer quebrado
    expect(screen.getByText(/Nenhum resultado/)).toBeInTheDocument()
  })

  it('deve explicar o vazio quando o que casa com o termo está INATIVO', async () => {
    // ARRANGE — sumiço sem motivo ensina a recepção a concluir que o cadastro se perdeu, e a
    // cadastrar a mesma criança de novo (change paciente-inativo-com-saida)
    const usuario = userEvent.setup()
    render(<Harness opcoes={[]} existeInativo />)

    // ACT
    await usuario.type(screen.getByRole('combobox'), 'valmiro')

    // ASSERT — a explicação SUBSTITUI o "nenhum resultado", e não nomeia criança nenhuma
    expect(screen.getByText(/Existe cadastro/)).toBeInTheDocument()
    expect(screen.getByText(/reative na ficha dele/)).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum resultado para/)).not.toBeInTheDocument()
  })

  it('NÃO deve insinuar cadastro escondido sem o sinal do servidor', async () => {
    // ARRANGE — a tela não infere existência por conta própria: sem o sinal, o vazio é o de
    // sempre (inferir seria decidir autorização no cliente)
    const usuario = userEvent.setup()
    render(<Harness opcoes={[]} />)

    // ACT
    await usuario.type(screen.getByRole('combobox'), 'valmiro')

    // ASSERT
    expect(screen.getByText(/Nenhum resultado para/)).toBeInTheDocument()
    expect(screen.queryByText(/Existe cadastro/)).not.toBeInTheDocument()
  })

  it('NÃO deve deixar um listbox sem opções na árvore quando só há mensagem', async () => {
    // ARRANGE — `role="listbox"` sem nenhuma `option` dentro é ARIA inválido (1.3.1,
    // `aria-required-children`): o axe marca como CRITICAL e o leitor de tela anuncia uma lista
    // que não existe. Valia para os três vazios antigos e ganharia um quarto com o do inativo
    // (achado A11Y-PIS-01 do gate).
    const usuario = userEvent.setup()
    const { container } = render(<Harness opcoes={[]} existeInativo />)

    // ACT
    await usuario.type(screen.getByRole('combobox'), 'valmiro')

    // ASSERT — a mensagem vive numa região viva, fora de qualquer lista
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Existe cadastro/)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve manter o listbox válido quando HÁ opções para escolher', async () => {
    // ARRANGE — o outro lado da mesma regra: com opções, a lista existe e é uma lista de verdade
    const usuario = userEvent.setup()
    const { container } = render(<Harness />)

    // ACT
    await usuario.click(screen.getByRole('combobox'))

    // ASSERT
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(OPCOES.length)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('deve preferir o aviso de FALHA ao do inativo — consulta que caiu não é busca vazia', async () => {
    // ARRANGE — os quatro vazios são mutuamente exclusivos; dizer "não foi possível carregar" e
    // "existe cadastro inativo" ao mesmo tempo é afirmar sobre um cadastro que ninguém consultou
    const usuario = userEvent.setup()
    render(<Harness opcoes={[]} falhou existeInativo />)

    // ACT
    await usuario.type(screen.getByRole('combobox'), 'valmiro')

    // ASSERT
    expect(screen.getByText(/Não foi possível carregar a lista/)).toBeInTheDocument()
    expect(screen.queryByText(/Existe cadastro/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Nenhum resultado para/)).not.toBeInTheDocument()
  })

  it('não deve dizer "nenhum resultado" para quem ESTÁ escolhido', async () => {
    // ARRANGE — o campo abre exibindo a escolha (card em edição, modo retorno). Nesse estado o
    // consumidor não busca (o texto não é procura, é a escolha em exibição), então as opções
    // chegam vazias: anunciar "nenhum resultado" mentiria sobre alguém que está selecionado.
    const usuario = userEvent.setup()
    const escolhido = OPCOES[0]
    render(<Harness opcoes={[]} escolhaInicial={escolhido} />)

    // ACT — focar é o gesto que abre a lista
    await usuario.click(screen.getByRole('combobox'))

    // ASSERT — nem a mentira, nem a moldura vazia da lista. O listbox nem existe: sem `option`
    // dentro, `role="listbox"` é ARIA inválido — e esconder por classe não tira o papel da
    // árvore que o leitor de tela percorre (A11Y-PIS-01)
    expect(screen.queryByText(/Nenhum resultado/)).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('deve esconder a lista quando não há opção nem mensagem para mostrar', async () => {
    // ARRANGE — 1 letra: o servidor exige 2, então a busca nem roda e "nenhum resultado" seria
    // mentira. Sem opção E sem mensagem, a lista não tem conteúdo — desenhar a moldura é ruído.
    const usuario = userEvent.setup()
    render(<Harness opcoes={[]} />)

    // ACT
    await usuario.type(screen.getByRole('combobox'), 'a')

    // ASSERT — sem opção e sem mensagem não há lista nenhuma no DOM
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveClass('hidden')
  })

  it('deve manter o campo utilizável enquanto busca', async () => {
    // ARRANGE + ACT
    render(<Harness carregando opcoes={[]} />)

    // ASSERT
    expect(screen.getByRole('combobox')).toBeEnabled()
  })

  it('deve renderizar nome malicioso como texto literal', async () => {
    // ARRANGE: o rótulo é dado do cadastro (T-ds-01)
    const usuario = userEvent.setup()
    const payload = '<img src=x onerror=alert(1)>'
    render(<Harness opcoes={[{ valor: 9, rotulo: payload }]} />)

    // ACT
    await usuario.click(screen.getByRole('combobox'))

    // ASSERT
    expect(screen.getByRole('option', { name: payload })).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('deve não ter violações axe com a lista aberta', async () => {
    // ARRANGE
    const usuario = userEvent.setup()
    const { container } = render(<Harness />)

    // ACT
    await usuario.click(screen.getByRole('combobox'))
    const resultado = await axe(container)

    // ASSERT
    expect(resultado).toHaveNoViolations()
  }, 30000)
})
