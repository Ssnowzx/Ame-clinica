import { fireEvent, render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThreadDaConversa } from '@/componentes/mensagens/thread-da-conversa'
import type { Mensagem } from '@/tipos'

expect.extend(toHaveNoViolations)

/** Dados 100% FICTÍCIOS (LGPD — menores). */
function mensagem(sobrescritas: Partial<Mensagem> = {}): Mensagem {
  return {
    id: 1,
    direcao: 'recebida',
    tipo: 'texto',
    corpo: 'Bom dia',
    template_nome: null,
    status: 'recebida',
    erro_motivo: null,
    automatica: false,
    enviada_por: null,
    expurgada: false,
    midia: null,
    mapa_url: null,
    tipo_original: null,
    em: '2026-09-29T12:00:00.000Z',
    ...sobrescritas,
  }
}

/**
 * O que chega pela rede, e não o que o TypeScript promete: um servidor mais novo que a tela pode
 * mandar um `tipo` que ela ainda não conhece — é exatamente o caso que a thread precisa aguentar.
 */
function vindaDoServidor(json: string): Mensagem {
  return JSON.parse(json)
}

function renderizar(mensagens: Mensagem[]) {
  return render(<ThreadDaConversa conversaId={1} mensagens={mensagens} podeReenviar onReenviar={vi.fn()} />)
}

describe('ThreadDaConversa — cada tipo em palavras (conversa-legivel)', () => {
  it('deve dizer "Reagiu com" e o emoji na reação', () => {
    // ARRANGE — a família reagiu com 👍 a uma mensagem da clínica
    renderizar([mensagem({ tipo: 'reacao', corpo: '👍' })])

    // ASSERT
    expect(screen.getByText('Reagiu com 👍')).toBeInTheDocument()
  })

  it('deve dizer "Tirou a reação" quando a reação chega sem emoji', () => {
    // ARRANGE — a Meta avisa a retirada com o emoji vazio
    renderizar([mensagem({ tipo: 'reacao', corpo: null })])

    // ASSERT
    expect(screen.getByText('Tirou a reação')).toBeInTheDocument()
  })

  it('deve dizer "Enviou uma figurinha" com o link para abrir a figurinha', () => {
    // ARRANGE — a figurinha chega como uma foto, em `midia`
    renderizar([
      mensagem({
        tipo: 'figurinha',
        corpo: null,
        midia: { id: 50, mime: 'image/webp', tamanho: 2048, disponivel: true },
      }),
    ])

    // ASSERT
    expect(screen.getByText('Enviou uma figurinha')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir figurinha' })).toHaveAttribute('target', '_blank')
  })

  it('deve dizer "Enviou uma localização" com o endereço e o link do mapa', () => {
    // ARRANGE — o link é o que o SERVIDOR montou, com coordenadas validadas
    renderizar([
      mensagem({
        tipo: 'localizacao',
        corpo: 'Praça Fictícia\nRua Fictícia, 100',
        mapa_url: 'https://www.google.com/maps/search/?api=1&query=-23.5,-46.6',
      }),
    ])

    // ACT
    const link = screen.getByRole('link', { name: 'Abrir no mapa' })

    // ASSERT — em outra aba, e sem levar o endereço da thread junto
    expect(screen.getByText('Enviou uma localização')).toBeInTheDocument()
    expect(screen.getByText(/Praça Fictícia/)).toHaveTextContent('Praça Fictícia Rua Fictícia, 100')
    expect(link).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=-23.5,-46.6')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('NÃO deve oferecer "Abrir no mapa" na localização sem link', () => {
    // ARRANGE — coordenada inválida ou ausente: o servidor manda `mapa_url` nulo
    renderizar([mensagem({ tipo: 'localizacao', corpo: 'Praça Fictícia', mapa_url: null })])

    // ASSERT — o texto fica, o link não
    expect(screen.getByText('Enviou uma localização')).toBeInTheDocument()
    expect(screen.getByText('Praça Fictícia')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Abrir no mapa' })).not.toBeInTheDocument()
  })

  it('NÃO deve transformar em link um endereço de mapa que não seja https', () => {
    // ARRANGE — defesa a mais: o link só nasce no servidor, mas a tela não confia cegamente
    renderizar([mensagem({ tipo: 'localizacao', corpo: null, mapa_url: 'javascript:alert(1)' })])

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Abrir no mapa' })).not.toBeInTheDocument()
  })

  it('NÃO deve transformar em link um endereço https de outro site', () => {
    // ARRANGE — o link só nasce para o endereço que o servidor MONTA, o do Google Maps (SEC-CL-03).
    // Prova por mutação: voltar a aceitar qualquer `https://` derruba este teste
    renderizar([mensagem({ tipo: 'localizacao', corpo: null, mapa_url: 'https://mapas-ficticios.example/maps/1,1' })])

    // ASSERT
    expect(screen.queryByRole('link', { name: 'Abrir no mapa' })).not.toBeInTheDocument()
  })

  it('deve descrever o link do mapa e o da figurinha pelo rótulo da bolha', () => {
    // ARRANGE — na lista de links do leitor de tela, fora da bolha, "Abrir no mapa" não diz de
    // quê (A11Y-CL-10). Prova por mutação: sem o `aria-describedby`, cai
    renderizar([
      mensagem({ id: 1, tipo: 'localizacao', corpo: null, mapa_url: 'https://www.google.com/maps/search/?api=1&query=1,1' }),
      mensagem({ id: 2, tipo: 'figurinha', corpo: null, midia: { id: 5, mime: 'image/webp', tamanho: 1, disponivel: true } }),
    ])

    // ASSERT
    expect(screen.getByRole('link', { name: 'Abrir no mapa' })).toHaveAccessibleDescription('Enviou uma localização')
    expect(screen.getByRole('link', { name: 'Abrir figurinha' })).toHaveAccessibleDescription('Enviou uma figurinha')
  })

  it('deve dizer no nome do link o que o anexo é', () => {
    // ARRANGE — foto, áudio e documento seguidos eram três "Abrir anexo" iguais (A11Y-CL-10).
    // Prova por mutação: sem a natureza no nome, os dois `getByRole` abaixo não acham nada
    renderizar([
      mensagem({ id: 1, tipo: 'imagem', corpo: null, midia: { id: 5, mime: 'image/jpeg', tamanho: 1, disponivel: true } }),
      mensagem({ id: 2, tipo: 'audio', corpo: null, midia: { id: 6, mime: 'audio/ogg', tamanho: 1, disponivel: true } }),
    ])

    // ASSERT — o nome COMEÇA pelo texto visível (2.5.3), sem espaço sobrando (A11Y-CL2-05)
    expect(screen.getByRole('link', { name: 'Abrir anexo (foto)' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir anexo (áudio)' })).toBeInTheDocument()
  })

  it('deve dar anel de foco claro, e que vença a regra global, ao link da bolha enviada', () => {
    // ARRANGE — o anel padrão (`--foco`) é o mesmo tom do fundo da bolha enviada: 1,00:1. A regra
    // global `:focus-visible` mora fora de camada e vencia o utilitário sem `!` (A11Y-CL-02). O
    // jsdom não resolve cascata: a medida do anel foi feita no navegador; aqui fica a classe
    renderizar([
      mensagem({
        direcao: 'enviada',
        tipo: 'documento',
        corpo: null,
        status: 'entregue',
        midia: { id: 5, mime: 'application/pdf', tamanho: 1, disponivel: true },
      }),
    ])

    // ASSERT — prova por mutação: sem o `!`, cai
    expect(screen.getByRole('link', { name: /Abrir anexo/ })).toHaveClass('focus-visible:outline-sobre-acento!')
  })

  it('deve manter o anel de foco da thread para dentro da caixa, vencendo a regra global', () => {
    // ARRANGE — para fora, o `overflow-hidden` do painel cortava o anel (A11Y-CL-07)
    renderizar([mensagem()])

    // ASSERT — prova por mutação: sem o `!`, cai
    expect(screen.getByRole('log')).toHaveClass('focus-visible:-outline-offset-2!')
  })

  it('deve dizer que a família mandou um arquivo recusado, com o motivo e a legenda', () => {
    // ARRANGE — a recusa é do SISTEMA (tipo de arquivo fora da lista), não do WhatsApp (CRL-01)
    renderizar([
      mensagem({
        tipo: 'nao_suportado',
        corpo: 'Legenda fictícia',
        erro_motivo: 'Mídia recusada: tipo de arquivo não aceito.',
      }),
    ])

    // ASSERT — nada de "enquete": prova por mutação, sem o ramo do `erro_motivo` cai no genérico
    expect(screen.getByText('A família mandou um arquivo que o sistema não aceita.')).toBeInTheDocument()
    expect(screen.getByText('Mídia recusada: tipo de arquivo não aceito.')).toBeInTheDocument()
    expect(screen.getByText('Legenda fictícia')).toBeInTheDocument()
    expect(screen.queryByText(/enquete/)).not.toBeInTheDocument()
  })

  it('deve dizer que a família editou uma mensagem quando o WhatsApp não entrega a edição', () => {
    // ARRANGE — a Meta avisa a edição como `unsupported` com o subtipo `edit` (CRL-02)
    renderizar([mensagem({ tipo: 'nao_suportado', corpo: null, tipo_original: 'unsupported:edit' })])

    // ASSERT — prova por mutação: sem a tabela de subtipos, cai no texto genérico
    expect(screen.getByText('A família editou uma mensagem.')).toBeInTheDocument()
    expect(screen.getByText(/a versão anterior continua acima/)).toBeInTheDocument()
  })

  it('deve dizer que a família enviou uma enquete', () => {
    // ARRANGE
    renderizar([mensagem({ tipo: 'nao_suportado', corpo: null, tipo_original: 'unsupported:poll_creation' })])

    // ASSERT
    expect(screen.getByText('A família enviou uma enquete.')).toBeInTheDocument()
  })

  it('deve dizer que a família trocou de número, e o que conferir', () => {
    // ARRANGE — o aviso de sistema da Meta. O corpo não é gravado: traz os dois números (CRL2-06)
    renderizar([mensagem({ tipo: 'nao_suportado', corpo: null, tipo_original: 'system:user_changed_number' })])

    // ASSERT — prova por mutação: sem a entrada na tabela, cai no texto genérico
    expect(screen.getByText('A família trocou de número no WhatsApp.')).toBeInTheDocument()
    expect(
      screen.getByText('Confira o telefone no cadastro: os lembretes continuam indo para o número antigo.'),
    ).toBeInTheDocument()
  })

  it('deve usar o texto genérico para outro aviso de sistema', () => {
    // ARRANGE
    renderizar([mensagem({ tipo: 'nao_suportado', corpo: null, tipo_original: 'system:aviso_ficticio' })])

    // ASSERT
    expect(screen.getByText('O WhatsApp não mostra esta mensagem ao sistema.')).toBeInTheDocument()
  })

  // nomes que um objeto literal HERDA do `Object.prototype` (SEC-CL2-02)
  const HERDADOS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']

  it.each(HERDADOS)('deve cair no texto genérico, sem derrubar a thread, com o subtipo "%s"', (nome) => {
    // ARRANGE — com objeto literal, `tabela["constructor"]` achava uma FUNÇÃO no lugar do rótulo,
    // e a thread inteira caía. Prova por mutação: voltar a tabela a objeto literal derruba
    renderizar([mensagem({ tipo: 'nao_suportado', corpo: null, tipo_original: nome })])

    // ASSERT
    expect(screen.getByText('O WhatsApp não mostra esta mensagem ao sistema.')).toBeInTheDocument()
  })

  it.each(HERDADOS)('NÃO deve escrever lixo com tipo e status "%s"', (nome) => {
    // ARRANGE — o status e o tipo também indexam tabelas desta tela
    const estranha = vindaDoServidor(
      JSON.stringify({
        ...mensagem({ direcao: 'enviada', corpo: null, midia: { id: 5, mime: 'image/png', tamanho: 1, disponivel: true } }),
        tipo: nome,
        status: nome,
      }),
    )

    // ACT
    renderizar([estranha])

    // ASSERT — o link sai sem natureza, e nenhum pedaço de função vira texto
    expect(screen.getByRole('link', { name: 'Abrir anexo' })).toBeInTheDocument()
    expect(screen.getByRole('log')).not.toHaveTextContent(/function|native code|undefined|object/i)
  })

  it('deve usar o texto genérico para um subtipo que a tela não conhece', () => {
    // ARRANGE — foto de visualização única, mensagem temporária, ou o que vier
    renderizar([mensagem({ tipo: 'nao_suportado', corpo: null, tipo_original: 'unsupported:subtipo_ficticio' })])

    // ASSERT
    expect(screen.getByText('O WhatsApp não mostra esta mensagem ao sistema.')).toBeInTheDocument()
  })

  it('deve dizer "Enviou um contato" com o nome e o telefone', () => {
    // ARRANGE
    renderizar([mensagem({ tipo: 'contato', corpo: 'Responsável Fictício — +55 11 90000-0000' })])

    // ASSERT
    expect(screen.getByText('Enviou um contato')).toBeInTheDocument()
    expect(screen.getByText('Responsável Fictício — +55 11 90000-0000')).toBeInTheDocument()
  })

  it('deve explicar o não suportado e sugerir pedir texto, foto ou áudio', () => {
    // ARRANGE — enquete, visualização única: a Meta não entrega o conteúdo
    renderizar([mensagem({ tipo: 'nao_suportado', corpo: null })])

    // ASSERT — diz o que houve E o que fazer
    expect(screen.getByText('O WhatsApp não mostra esta mensagem ao sistema.')).toBeInTheDocument()
    expect(screen.getByText(/peça à família para mandar em texto, foto ou áudio/)).toBeInTheDocument()
    expect(screen.queryByText('Mensagem de tipo não suportado.')).not.toBeInTheDocument()
  })

  it('deve tratar um tipo que a tela não conhece como não suportado, nunca como bolha vazia', () => {
    // ARRANGE — servidor mais novo que a tela
    const desconhecida = vindaDoServidor(
      JSON.stringify({ ...mensagem({ corpo: null }), tipo: 'tipo_do_futuro' }),
    )

    // ACT
    renderizar([desconhecida])

    // ASSERT
    expect(screen.getByText('O WhatsApp não mostra esta mensagem ao sistema.')).toBeInTheDocument()
  })

  it('deve mostrar o texto de um tipo desconhecido que chegou com texto', () => {
    // ARRANGE — o que veio legível é mostrado como veio
    const desconhecida = vindaDoServidor(
      JSON.stringify({ ...mensagem({ corpo: 'Texto fictício' }), tipo: 'tipo_do_futuro' }),
    )

    // ACT
    renderizar([desconhecida])

    // ASSERT
    expect(screen.getByText('Texto fictício')).toBeInTheDocument()
    expect(screen.queryByText('O WhatsApp não mostra esta mensagem ao sistema.')).not.toBeInTheDocument()
  })

  it('deve dizer ao leitor de tela que a família mandou a reação', () => {
    // ARRANGE — quem não vê o alinhamento precisa ouvir quem falou
    renderizar([mensagem({ tipo: 'reacao', corpo: '👍' })])

    // ASSERT
    expect(screen.getByRole('log')).toHaveTextContent('Recebida da família:Reagiu com 👍')
  })

  it('deve conter os rótulos só-para-leitor-de-tela dentro da própria rolagem', () => {
    // ARRANGE — os `sr-only` são absolutos: sem um ancestral posicionado eles escapavam da
    // rolagem da thread e esticavam o DOCUMENTO (1.072 px de página numa tela de 658, medido
    // no navegador). O jsdom não calcula layout; o que ele guarda é a classe que conserta.
    renderizar([mensagem()])

    // ASSERT
    expect(screen.getByRole('log')).toHaveClass('relative')
  })

  it('deve passar na auditoria de acessibilidade com todos os tipos novos', async () => {
    // ARRANGE
    const { container } = renderizar([
      mensagem({ id: 1, tipo: 'reacao', corpo: '👍' }),
      mensagem({ id: 2, tipo: 'figurinha', corpo: null, midia: { id: 5, mime: 'image/webp', tamanho: 1, disponivel: true } }),
      mensagem({ id: 3, tipo: 'localizacao', corpo: 'Praça Fictícia', mapa_url: 'https://www.google.com/maps/search/?api=1&query=1,1' }),
      mensagem({ id: 4, tipo: 'contato', corpo: 'Pessoa Fictícia — +55 11 90000-0000' }),
      mensagem({ id: 5, tipo: 'nao_suportado', corpo: null }),
    ])

    // ASSERT
    expect(await axe(container)).toHaveNoViolations()
  })
})

/*
 * O jsdom não calcula layout: `scrollHeight`, `clientHeight` e `offsetTop` são sempre 0, e o
 * `scrollTop` aceita qualquer número. Aqui a caixa da thread tem 300 px à vista e 16 px de
 * respiro, cada bolha tem 100 px, e o `scrollTop` para no fim como no navegador.
 */
const ALTURA_DA_CAIXA = 300
const ALTURA_DA_BOLHA = 100
const RESPIRO = 16
/** Quanto a caixa encolheu depois de montada (o cabeçalho do shell cresceu, o teclado abriu). */
let encolhimento = 0

const PROPRIEDADES_DE_LAYOUT = [
  [Element.prototype, 'scrollHeight'],
  [Element.prototype, 'clientHeight'],
  [Element.prototype, 'scrollTop'],
  [HTMLElement.prototype, 'offsetTop'],
  [HTMLElement.prototype, 'offsetHeight'],
] as const

const originais = PROPRIEDADES_DE_LAYOUT.map(([alvo, nome]) => Object.getOwnPropertyDescriptor(alvo, nome))

function bolhasDe(caixa: Element): Element[] {
  return [...caixa.querySelectorAll('[data-mensagem]')]
}

function ehThread(elemento: Element): boolean {
  return elemento.getAttribute('role') === 'log'
}

function simularLayout() {
  const topos = new WeakMap<Element, number>()
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return ehThread(this) ? RESPIRO * 2 + bolhasDe(this).length * ALTURA_DA_BOLHA : 0
    },
  })
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      return ehThread(this) ? ALTURA_DA_CAIXA - encolhimento : 0
    },
  })
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return topos.get(this) ?? 0
    },
    set(this: Element, valor: number) {
      topos.set(this, Math.min(Math.max(0, valor), Math.max(0, this.scrollHeight - this.clientHeight)))
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const caixa = this.closest('[role="log"]')
      return caixa === null ? 0 : RESPIRO + bolhasDe(caixa).indexOf(this) * ALTURA_DA_BOLHA
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-mensagem') ? ALTURA_DA_BOLHA : 0
    },
  })
}

/** Mensagens com ids de `de` a `ate`, todas FICTÍCIAS. */
function serie(de: number, ate: number): Mensagem[] {
  return Array.from({ length: ate - de + 1 }, (_, indice) =>
    mensagem({ id: de + indice, corpo: `Mensagem fictícia ${de + indice}` }),
  )
}

function thread(conversaId: number, mensagens: Mensagem[]) {
  return <ThreadDaConversa conversaId={conversaId} mensagens={mensagens} podeReenviar onReenviar={vi.fn()} />
}

/** A pessoa rola a thread até `topo` — com o evento, como o navegador faz. */
function rolarAte(caixa: HTMLElement, topo: number) {
  caixa.scrollTop = topo
  fireEvent.scroll(caixa)
}

describe('ThreadDaConversa — a rolagem (conversa-legivel)', () => {
  beforeEach(() => {
    encolhimento = 0
    simularLayout()
  })

  afterEach(() => {
    PROPRIEDADES_DE_LAYOUT.forEach(([alvo, nome], indice) => {
      const original = originais[indice]
      if (original !== undefined) Object.defineProperty(alvo, nome, original)
    })
  })

  it('deve abrir a conversa na mensagem mais nova', () => {
    // ARRANGE — 10 bolhas (1.032 px) numa caixa de 300: a última só aparece rolando até o fim.
    // Prova por mutação: a regra antiga ("só acompanha quem está no fim", medida DEPOIS de
    // renderizar) deixava a caixa no topo, e este teste cai com ela
    const { getByRole } = render(thread(1, serie(1, 10)))

    // ACT
    const caixa = getByRole('log')

    // ASSERT — no fim: a última bolha (916–1016) inteira dentro da janela (732–1032)
    expect(caixa.scrollTop).toBe(RESPIRO * 2 + 10 * ALTURA_DA_BOLHA - ALTURA_DA_CAIXA)
  })

  it('deve abrir no fim também ao TROCAR de conversa sem remontar a thread', () => {
    // ARRANGE — quem lia o começo de uma conversa e abre outra
    const { getByRole, rerender } = render(thread(1, serie(1, 10)))
    const caixa = getByRole('log')
    rolarAte(caixa, 0)

    // ACT
    rerender(thread(2, serie(101, 110)))

    // ASSERT — prova por mutação: sem a chave da conversa, a pessoa "subiu" e ficava no topo
    expect(caixa.scrollTop).toBe(RESPIRO * 2 + 10 * ALTURA_DA_BOLHA - ALTURA_DA_CAIXA)
  })

  it('deve acompanhar a mensagem nova de quem está no fim', () => {
    // ARRANGE
    const { getByRole, rerender } = render(thread(1, serie(1, 10)))
    const caixa = getByRole('log')

    // ACT — o poll traz a 11ª
    rerender(thread(1, serie(1, 11)))

    // ASSERT
    expect(caixa.scrollTop).toBe(RESPIRO * 2 + 11 * ALTURA_DA_BOLHA - ALTURA_DA_CAIXA)
  })

  it('NÃO deve pular para o fim no poll quando a pessoa subiu para reler', () => {
    // ARRANGE — a pessoa subiu até a 3ª mensagem (topo da bolha 3 no topo da caixa)
    const { getByRole, rerender } = render(thread(1, serie(1, 10)))
    const caixa = getByRole('log')
    rolarAte(caixa, RESPIRO + 2 * ALTURA_DA_BOLHA)

    // ACT — o poll traz a 11ª
    rerender(thread(1, serie(1, 11)))

    // ASSERT — prova por mutação: "rolar sempre para o fim" leva a 832 e o teste cai
    expect(caixa.scrollTop).toBe(RESPIRO + 2 * ALTURA_DA_BOLHA)
  })

  it('NÃO deve deslocar a leitura quando a mensagem nova empurra a janela para cima', () => {
    // ARRANGE — a thread é a janela das N mais recentes: com a 11ª, a 1ª sai do topo. A pessoa
    // estava na 3ª
    const { getByRole, rerender } = render(thread(1, serie(1, 10)))
    const caixa = getByRole('log')
    rolarAte(caixa, RESPIRO + 2 * ALTURA_DA_BOLHA)

    // ACT
    rerender(thread(1, serie(2, 11)))

    // ASSERT — a 3ª continua no topo da caixa (agora é a 2ª bolha: 16 + 100). Prova por
    // mutação: sem a âncora, o `scrollTop` ficava em 216 e a pessoa pulava para a 4ª
    expect(caixa.scrollTop).toBe(RESPIRO + ALTURA_DA_BOLHA)
  })

  it('deve manter a pessoa na mesma mensagem ao carregar as anteriores', () => {
    // ARRANGE — a pessoa rolou até o topo da janela (a mensagem 11) e pede as anteriores
    const { getByRole, rerender } = render(thread(1, serie(11, 20)))
    const caixa = getByRole('log')
    rolarAte(caixa, 0)

    // ACT — entram 10 mensagens EM CIMA (1.000 px)
    rerender(thread(1, serie(1, 20)))

    // ASSERT — a 11 continua no topo da caixa. Prova por mutação: sem compensar, o `scrollTop`
    // ficava em 0 (a pessoa via a mensagem 1); tratando como abertura, pulava para o fim (1.732)
    expect(caixa.scrollTop).toBe(10 * ALTURA_DA_BOLHA)
  })
})

describe('ThreadDaConversa — a caixa que muda de tamanho sozinha (conversa-legivel)', () => {
  /** O que a thread OBSERVA — só um elemento observado avisa que mudou de tamanho. */
  const observados = new Map<Element, () => void>()

  /** O navegador redimensionou `alvo`: avisa quem o observa, como o `ResizeObserver` real. */
  function redimensionar(alvo: Element) {
    observados.get(alvo)?.()
  }

  class ObservadorFalso {
    private readonly callback: () => void
    private readonly meus = new Set<Element>()

    constructor(callback: () => void) {
      this.callback = callback
    }
    observe(alvo: Element): void {
      this.meus.add(alvo)
      observados.set(alvo, this.callback)
    }
    unobserve(): void {}
    disconnect(): void {
      this.meus.forEach((alvo) => observados.delete(alvo))
      this.meus.clear()
    }
  }

  beforeEach(() => {
    encolhimento = 0
    simularLayout()
    vi.stubGlobal('ResizeObserver', ObservadorFalso)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    observados.clear()
    PROPRIEDADES_DE_LAYOUT.forEach(([alvo, nome], indice) => {
      const original = originais[indice]
      if (original !== undefined) Object.defineProperty(alvo, nome, original)
    })
  })

  it('deve continuar na mensagem mais nova quando a caixa encolhe depois de aberta', () => {
    // ARRANGE — medido em produção: a conversa abria no fim, os contadores do topo chegavam, o
    // cabeçalho do shell crescia 16 px e a última mensagem ficava cortada
    const { getByRole } = render(thread(1, serie(1, 10)))
    const caixa = getByRole('log')

    // ACT
    encolhimento = 16
    redimensionar(caixa)

    // ASSERT — o fim novo: 1.032 de conteúdo numa caixa de 284
    expect(caixa.scrollTop).toBe(RESPIRO * 2 + 10 * ALTURA_DA_BOLHA - (ALTURA_DA_CAIXA - 16))
  })

  it('NÃO deve puxar para o fim quem subiu para reler quando a caixa muda de tamanho', () => {
    // ARRANGE — o teclado abre enquanto a pessoa lê o começo da conversa
    const { getByRole } = render(thread(1, serie(1, 10)))
    const caixa = getByRole('log')
    rolarAte(caixa, 0)

    // ACT
    encolhimento = 16
    redimensionar(caixa)

    // ASSERT
    expect(caixa.scrollTop).toBe(0)
  })
})
