import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TEMAS_DA_CLINICA } from '@/lib/tema-da-clinica'

/**
 * GUARDA DE CONTRATO — **o tema da clínica é curadoria com contraste, e não toca o que se lê**
 * (change tema-da-clinica).
 *
 * O jsdom não calcula cor (`css: false`), então a guarda lê o `index.css` como texto, junta TODAS
 * as declarações de toda regra cujo seletor tem o atributo do tema (inclusive dentro de
 * `@media`), resolve cada papel até o hex do primitivo e calcula o contraste WCAG de cada par
 * texto × fundo que o tema redefine. Ela existe para o dia em que alguém "clarear um pouquinho o
 * verde para ficar mais parecido com a logo": o verde cru da logo (#00A884) dá 3,0:1 com texto
 * branco, e o menta das letras dá 1,7:1.
 *
 * - **COBRE** o contraste dos pares redefinidos; que o tema tem UM bloco só, em qualquer grafia do
 *   seletor (um segundo bloco num `@media`, ou com aspas simples, passava — gates r1 e r2); que o
 *   tema não redefine primitivo de cor nem papel intocável, conferindo o VALOR resolvido e não só o
 *   nome (gate r2: redefinir `--neutro-0` pintava a superfície sem tocar o papel); que a raiz tem
 *   um `:root` só; e que a amostra do Padrão resolve exatamente o valor da raiz em cada papel.
 * - **NÃO COBRE** se o tema está bonito, nem cor escrita fora dos papéis — isso é a guarda
 *   `design-system.contrato` e o olho (as capturas do design-qa).
 */

const CSS = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * O que um tema NUNCA redefine: o texto, a superfície do conteúdo (onde o profissional lê o dia)
 * e as cores de aviso. Erro tem de parecer erro em qualquer clínica.
 */
const PAPEIS_INTOCAVEIS = [
  'texto', 'texto-suave', 'texto-desativado', 'superficie', 'superficie-elevada',
  'perigo', 'perigo-intenso', 'sobre-perigo', 'perigo-texto', 'perigo-suave',
  'sucesso-texto', 'sucesso-suave', 'alerta-texto', 'alerta-suave', 'info-texto', 'info-suave',
  'tooltip', 'sobre-tooltip',
]

/** Casa o atributo do tema em qualquer grafia: aspas duplas, simples ou nenhuma, com espaços. */
function seletorDoTema(tema: string): RegExp {
  return new RegExp(`\\[data-tema\\s*[~|^$*]?=\\s*["']?${tema}["']?\\s*[is]?\\]`)
}

/** Declarações de TODAS as regras cujo seletor casa com `casa`, na ordem em que aparecem. */
function declaracoes(casa: (seletor: string) => boolean): { ocorrencias: number; papeis: Record<string, string> } {
  const papeis: Record<string, string> = {}
  let ocorrencias = 0
  for (const regra of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!casa(regra[1].trim())) {
      continue
    }
    ocorrencias += 1
    for (const declaracao of regra[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      papeis[declaracao[1]] = declaracao[2].trim()
    }
  }

  return { ocorrencias, papeis }
}

/**
 * TODAS as regras de seletor exatamente `:root` (um segundo `:root` num `@media` escapava — gate
 * r2). Os pesos nomeados são do Tailwind e não moram aqui: entram com o valor padrão dele.
 */
const DA_RAIZ = declaracoes((seletor) => /(^|,)\s*:root\s*(?=,|$)/.test(seletor))
const RAIZ: Record<string, string> = {
  'font-weight-normal': '400',
  'font-weight-medium': '500',
  'font-weight-semibold': '600',
  ...DA_RAIZ.papeis,
}

/** Primitivo de cor = variável cujo valor na raiz é um hex literal. Tema nenhum redefine um. */
const PRIMITIVOS_DE_COR = Object.keys(DA_RAIZ.papeis).filter((nome) => /^#[0-9A-Fa-f]{3,8}$/.test(DA_RAIZ.papeis[nome]))

/** `var(--x)` → valor de `--x` no escopo (ou na raiz), até chegar num valor literal. */
function resolver(valor: string, escopo: Record<string, string>, profundidade = 0): string {
  const referencia = /^var\(--([\w-]+)\)$/.exec(valor)
  if (referencia === null || profundidade > 20) {
    return valor
  }
  const nome = referencia[1]

  return resolver(escopo[nome] ?? RAIZ[nome] ?? '', escopo, profundidade + 1)
}

function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((inicio) => Number.parseInt(hex.slice(inicio, inicio + 2), 16) / 255)
  const [r, g, b] = canais.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [clara, escura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)

  return (clara + 0.05) / (escura + 0.05)
}

/** [primeiro plano, fundo, mínimo] — texto 4,5:1; controle, foco e marcador 3:1. */
const PARES: Array<[string, string, number]> = [
  ['sobre-botao-primario', 'botao-primario', 4.5],
  ['sobre-botao-primario', 'botao-primario-hover', 4.5],
  ['sobre-segmento-ativo', 'segmento-ativo', 4.5],
  ['sobre-acento', 'acento', 4.5],
  ['sobre-acento', 'acento-intenso', 4.5],
  ['acento', 'superficie', 4.5],
  ['acento', 'fundo', 4.5],
  ['acento', 'acento-suave', 4.5],
  ['acento', 'moldura', 4.5],
  ['acento', 'moldura-ativo', 4.5],
  ['acento', 'cabecalho-tabela', 4.5],
  ['texto', 'fundo', 4.5],
  ['texto', 'moldura', 4.5],
  ['texto-suave', 'fundo', 4.5],
  ['texto-suave', 'moldura', 4.5],
  ['texto-suave', 'trilho', 4.5],
  ['texto-suave', 'cabecalho-tabela', 4.5],
  ['rotulo-de-grupo', 'moldura', 4.5],
  ['borda-campo', 'superficie', 3],
  ['foco', 'superficie', 3],
  ['foco', 'fundo', 3],
  ['destaque', 'superficie', 3],
  ['destaque', 'fundo', 3],
  ['destaque', 'acento-suave', 3],
  ['destaque', 'moldura-ativo', 3],
  ['vazio-icone', 'vazio-icone-fundo', 3],
  ['segmento-ativo-borda', 'trilho', 3],
  ['sobre-chip-de-marca', 'chip-de-marca', 4.5],
  ['borda-botao', 'superficie', 3],
  ['borda-botao', 'moldura', 3],
  ['texto', 'avatar-fundo', 4.5],
  // os gráficos (indicadores-profissionais): o rótulo DENTRO da célula do mapa de ocupação troca de
  // tinta só no último degrau; o destaque é o que chama o olho (≥ 3:1 contra o recessivo e contra o
  // branco); e o contorno do "sem dados" se vê como objeto (A11Y-IND-05)
  ['texto', 'grafico-mapa-1', 4.5],
  ['texto', 'grafico-mapa-2', 4.5],
  ['texto', 'grafico-mapa-3', 4.5],
  ['texto', 'grafico-mapa-4', 4.5],
  ['sobre-acento', 'grafico-mapa-5', 4.5],
  ['grafico-destaque', 'superficie', 3],
  ['grafico-destaque', 'grafico-recessivo', 3],
  ['grafico-sem-dados-contorno', 'superficie', 3],
]

/** Pares que só precisam SE DISTINGUIR (não são texto): o hover não pode parecer a seleção. */
const DISTINTOS: Array<[string, string, number]> = [['hover-de-linha', 'selecao', 1.04]]

describe.each(TEMAS_DA_CLINICA)('Tema "%s"', (tema) => {
  const { ocorrencias, papeis: doTema } = declaracoes((seletor) => seletorDoTema(tema).test(seletor))
  const cor = (nome: string): string => resolver(`var(--${nome})`, doTema)

  it('deve ter UM bloco no index.css — um segundo, escondido num @media, escaparia da conferência', () => {
    // ARRANGE + ACT + ASSERT
    expect(ocorrencias).toBe(1)
    expect(cor('acento')).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('não deve tocar texto, a superfície do conteúdo nem as cores de aviso', () => {
    // ARRANGE + ACT
    const tocados = Object.keys(doTema).filter((nome) => PAPEIS_INTOCAVEIS.includes(nome))

    // ASSERT — erro tem de parecer erro em qualquer clínica, e o dia se lê no branco
    expect(tocados).toEqual([])
  })

  it('não deve redefinir primitivo de cor — mudaria um papel intocável por tabela', () => {
    // ARRANGE + ACT
    const primitivos = Object.keys(doTema).filter((nome) => PRIMITIVOS_DE_COR.includes(nome))

    // ASSERT
    expect(primitivos).toEqual([])
  })

  it.each([...PAPEIS_INTOCAVEIS, 'raio-caixa'])('deve resolver %s no tema exatamente como no Padrão', (papel) => {
    // ARRANGE + ACT — o VALOR, não só o nome: a caixa de marcar continua caixa, o erro continua erro
    const noTema = resolver(`var(--${papel})`, doTema)
    const naRaiz = resolver(`var(--${papel})`, {})

    // ASSERT
    expect(noTema).toBe(naRaiz)
  })

  it.each(PARES)('deve manter %s legível sobre %s (mínimo %s:1)', (frente, fundo, minimo) => {
    // ARRANGE
    const [corDaFrente, corDoFundo] = [cor(frente), cor(fundo)]

    // ACT
    const razao = contraste(corDaFrente, corDoFundo)

    // ASSERT — a cor tem de ser um hex resolvido: papel que não resolve é papel que sumiu
    expect(corDaFrente).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(corDoFundo).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(razao).toBeGreaterThanOrEqual(minimo)
  })

  it.each(DISTINTOS)('deve distinguir %s de %s (mínimo %s:1)', (a, b, minimo) => {
    // ARRANGE + ACT — senão a conversa sob o mouse fica igual à escolhida (gate r3)
    const razao = contraste(cor(a), cor(b))

    // ASSERT
    expect(razao).toBeGreaterThanOrEqual(minimo)
  })

  it('deve ter a amostra do Padrão redefinindo os mesmos papéis', () => {
    // ARRANGE + ACT — senão, desenhada dentro de uma tela no tema, a amostra "Padrão" herda as
    // cores do tema e as duas opções de Configurações saem iguais
    const doPadrao = declaracoes((seletor) => seletorDoTema('padrao').test(seletor))

    // ASSERT
    expect(doPadrao.ocorrencias).toBe(1)
    expect(Object.keys(doPadrao.papeis).sort()).toEqual(Object.keys(doTema).sort())
  })
})

describe('Padrão', () => {
  const doPadrao = declaracoes((seletor) => seletorDoTema('padrao').test(seletor)).papeis

  it('deve ter um :root só — um segundo, num @media, escaparia da conferência', () => {
    // ARRANGE + ACT + ASSERT
    expect(DA_RAIZ.ocorrencias).toBe(1)
  })

  it.each(Object.keys(doPadrao))('deve ter a amostra do Padrão em %s igual ao valor da raiz', (papel) => {
    // ARRANGE + ACT — senão a amostra "Padrão" de Configurações mente sobre o que a clínica verá
    const naAmostra = resolver(doPadrao[papel], doPadrao)
    const naRaiz = resolver(`var(--${papel})`, {})

    // ASSERT
    expect(naAmostra).toBe(naRaiz)
  })
})

/**
 * O VALOR de cada papel novo no Padrão, fixado: é o que a peça já usava antes da change. Uma
 * mudança coerente na raiz E na amostra passaria pela paridade entre as duas (gate r3, M4b).
 */
const PADRAO_ANTIGO: Array<[string, string]> = [
  ['destaque', '#16695F'], ['botao-primario', '#16695F'], ['botao-primario-hover', '#10554E'],
  ['sobre-botao-primario', '#FFFFFF'], ['botao-primario-sombra', '0 0 #0000'], ['borda-botao', '#8F8A80'],
  ['raio-botao', '6px'], ['raio-caixa', '6px'], ['raio-trilho', '6px'], ['trilho', '#F1EFEB'],
  ['segmento-ativo', '#16695F'], ['segmento-ativo-hover', '#10554E'], ['sobre-segmento-ativo', '#FFFFFF'],
  ['segmento-ativo-borda', 'transparent'], ['cabecalho-tabela', '#FAF9F7'], ['vazio-icone', '#5F5A51'],
  ['vazio-icone-fundo', 'transparent'], ['vazio-icone-respiro', '0px'], ['avatar-fundo', '#F1EFEB'],
  ['hover-de-linha', '#F1EFEB'], ['chip-de-marca', '#EDF7F5'], ['sobre-chip-de-marca', '#16695F'],
  ['recuo-fio', '0px'], ['moldura', '#FFFFFF'], ['moldura-linha', '#E5E2DC'], ['moldura-ativo', '#EDF7F5'],
  ['moldura-hover', '#F1EFEB'], ['rotulo-de-grupo', '#5F5A51'], ['assinatura', 'none'], ['peso-texto', '400'],
  // change tema-xclinicas: o ornamento, a subida e o peso do título — no Padrão, nada
  ['botao-primario-losango', 'none'], ['botao-primario-elevacao', '0px'], ['losango', 'transparent'],
  ['variacao-display', 'normal'],
]

describe('Padrão — papéis novos', () => {
  it.each(PADRAO_ANTIGO)('deve manter %s no valor que a peça já usava (%s)', (papel, antigo) => {
    // ARRANGE + ACT
    const valor = resolver(`var(--${papel})`, {})

    // ASSERT — nenhuma clínica no Padrão vê diferença
    expect(valor.toUpperCase()).toBe(antigo.toUpperCase())
  })

  it('deve ter os papéis novos iguais ao que já existia, para nenhuma clínica no Padrão ver diferença', () => {
    // ARRANGE + ACT + ASSERT
    expect(RAIZ.destaque).toBe('var(--acento)')
    expect(RAIZ['botao-primario']).toBe('var(--acento)')
    expect(RAIZ['sobre-botao-primario']).toBe('var(--sobre-acento)')
    expect(RAIZ['raio-botao']).toBe('var(--raio-controle)')
    expect(RAIZ['moldura']).toBe('var(--superficie)')
    expect(RAIZ.assinatura).toBe('none')
    expect(RAIZ['segmento-ativo-borda']).toBe('transparent')
    expect(RAIZ['hover-de-linha']).toBe('var(--neutro-100)')
    expect(RAIZ['chip-de-marca']).toBe('var(--acento-suave)')
    expect(RAIZ['recuo-fio']).toBe('0px')
    expect(RAIZ['vazio-icone-respiro']).toBe('0px')
  })
})

describe('Menta — os papéis da change tema-xclinicas valem "nada"', () => {
  const doMenta = declaracoes((seletor) => seletorDoTema('menta').test(seletor)).papeis

  it.each([
    ['botao-primario-losango', 'none'],
    ['botao-primario-elevacao', '0px'],
    ['losango', 'transparent'],
    ['variacao-display', 'normal'],
  ])('deve manter %s no valor neutro (%s)', (papel, neutro) => {
    // ARRANGE + ACT — a paridade de NOMES entre os blocos não confere o valor (code-reviewer r1)
    const valor = resolver(doMenta[papel] ?? '', doMenta)

    // ASSERT — o Menta não ganha losango, subida nem peso de título de outro tema
    expect(valor).toBe(neutro)
  })
})

describe('O título lê o tema do elemento (change tema-xclinicas)', () => {
  it('deve ter a regra base de h1–h3 lendo os PAPÉIS da fonte e do peso, e não a ponte do Tailwind', () => {
    // ARRANGE — `--font-display` (a ponte) é resolvida no `:root` e herdada pronta: um `[data-tema]` no
    // `<main>` do login não a alcançava, e o título saía na fonte do Padrão
    const regra = /(?:^|\})\s*h1,\s*h2,\s*h3\s*\{([^}]*)\}/.exec(CSS)

    // ACT
    const corpo = regra?.[1] ?? ''

    // ASSERT
    expect(corpo).toContain('font-family: var(--fonte-display)')
    expect(corpo).toContain('font-variation-settings: var(--variacao-display)')
  })
})

describe('Onde o rosa e o vermelho sólido podem aparecer', () => {
  const FONTES = (() => {
    const raiz = join(process.cwd(), 'src')
    const lista: string[] = []
    const andar = (dir: string): void => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome)
        if (statSync(caminho).isDirectory()) andar(caminho)
        else if (nome.endsWith('.tsx') && !nome.includes('.test.')) lista.push(caminho)
      }
    }
    andar(raiz)
    return lista.map((caminho) => ({ caminho: caminho.slice(raiz.length + 1), texto: readFileSync(caminho, 'utf8') }))
  })()

  it('deve usar o rosa como TEXTO só nos títulos de grupo do menu (e na miniatura do tema)', () => {
    // ARRANGE + ACT — "rosa = onde você está": o marcador é traço; o único texto rosa é o título
    const comRotulo = FONTES.filter((f) => f.texto.includes('text-rotulo-de-grupo')).map((f) => f.caminho).sort()
    const comDestaqueEmTexto = FONTES.filter((f) => /\btext-destaque\b/.test(f.texto)).map((f) => f.caminho)

    // ASSERT
    expect(comRotulo).toEqual(['componentes/administracao/amostra-do-tema.tsx', 'componentes/app-shell.tsx'])
    expect(comDestaqueEmTexto).toEqual([])
  })

  it('deve usar o rosé do losango só como ornamento, nunca como texto (manual Xclinicas)', () => {
    // ARRANGE + ACT — o rosé cru dá 2,3:1 no branco: como texto, ninguém o lê
    const comLosangoEmTexto = FONTES.filter((f) => /\btext-losango\b/.test(f.texto)).map((f) => f.caminho)

    // ASSERT
    expect(comLosangoEmTexto).toEqual([])
  })

  it('deve reservar o vermelho sólido ao botão que CONFIRMA, nunca ao que só abre a confirmação (§5.2)', () => {
    // ARRANGE — os que confirmam DENTRO da janela: excluir o lançamento e desmarcar em lote
    const PERMITIDOS: Record<string, number> = {
      // o botão que confirma DENTRO da janela de confirmação — é o lugar que a §5.2 reserva ao sólido
      'componentes/ui/dialog-confirmacao.tsx': 1,
      'componentes/agenda/desmarque-em-lote.tsx': 1,
      // o "Excluir" da LINHA abre a confirmação (moldura); o sólido é o que confirma dentro dela
      'componentes/financeiro/painel-lancamentos.tsx': 1,
      'test/mostruario-do-design-system.tsx': 1,
    }

    // ACT
    // qualquer grafia: `variante="perigo"`, `variante={'perigo'}` ou um ternário que dê 'perigo' (gate r4)
    const SOLIDO = /variante=(?:"perigo"|\{[^}]*['"]perigo['"][^}]*\})/g
    const fora = FONTES.filter((f) => (f.texto.match(SOLIDO) ?? []).length > (PERMITIDOS[f.caminho] ?? 0)).map((f) => f.caminho)

    // ASSERT — um "Excluir" novo nasce com moldura; vermelho sólido é decisão, não descuido
    expect(fora).toEqual([])
  })
})
