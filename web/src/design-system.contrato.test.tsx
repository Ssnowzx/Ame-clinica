/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { render, screen } from '@testing-library/react'

import { Botao } from '@/componentes/ui/botao'
import { cn } from '@/lib/cn'
import { razaoContraste } from '@/test/contraste'

/** Os papéis tipográficos DECLARADOS no index.css (`--text-<papel>`) — a fonte única. */
function papeisDeTamanho(): string[] {
  const css = readFileSync(join(RAIZ_SRC, 'index.css'), 'utf-8')
  const papeis = new Set<string>()
  for (const combinacao of css.matchAll(/--text-([\w-]+):/g)) {
    // `--text-corpo--line-height` e amigos são modificadores, não papéis
    if (!combinacao[1].includes('--')) papeis.add(combinacao[1])
  }
  return [...papeis]
}

/**
 * Fiscalização automatizada do design system (design-system.md §8.2 +
 * checklist do parecer security-design-system.md §5): contraste AA dos pares
 * semânticos documentados (§3) e varredura anti-valor-mágico/anti-XSS.
 */

// O vitest roda com cwd = web/ (raiz do projeto)
const RAIZ_SRC = join(process.cwd(), 'src')

// ── Tokens: resolve as variáveis do index.css (fonte única) ──────────────────

function resolverTokens(): Map<string, string> {
  const css = readFileSync(join(RAIZ_SRC, 'index.css'), 'utf-8')
  const declaracoes = new Map<string, string>()
  for (const combinacao of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const [, nome, valor] = combinacao
    if (!declaracoes.has(nome)) {
      declaracoes.set(nome, valor.trim())
    }
  }

  const resolvidos = new Map<string, string>()
  for (const nome of declaracoes.keys()) {
    let valor = declaracoes.get(nome) ?? ''
    let referencia = valor.match(/^var\(--([\w-]+)\)$/)
    while (referencia !== null) {
      valor = declaracoes.get(referencia[1]) ?? ''
      referencia = valor.match(/^var\(--([\w-]+)\)$/)
    }
    resolvidos.set(nome, valor)
  }
  return resolvidos
}

// Pares semânticos documentados na tabela §3 do contrato (fg, bg, piso)
const PARES_SEMANTICOS: ReadonlyArray<readonly [string, string, number]> = [
  ['texto', 'superficie', 4.5],
  ['texto', 'fundo', 4.5],
  ['texto-suave', 'superficie', 4.5],
  ['texto-suave', 'fundo', 4.5],
  ['texto-suave', 'neutro-100', 4.5],
  ['texto', 'selecao', 4.5],
  ['acento', 'superficie', 4.5],
  ['acento', 'fundo', 4.5],
  ['acento', 'acento-suave', 4.5],
  ['sobre-acento', 'acento', 4.5],
  ['sobre-acento', 'acento-intenso', 4.5],
  // o botão principal e o controle segmentado têm papel próprio (change tema-da-clinica)
  ['sobre-botao-primario', 'botao-primario', 4.5],
  ['sobre-botao-primario', 'botao-primario-hover', 4.5],
  ['sobre-segmento-ativo', 'segmento-ativo', 4.5],
  ['sobre-perigo', 'perigo', 4.5],
  ['sobre-perigo', 'perigo-intenso', 4.5],
  ['perigo-texto', 'perigo-suave', 4.5],
  ['perigo-texto', 'superficie', 4.5],
  ['sucesso-texto', 'sucesso-suave', 4.5],
  ['sucesso-texto', 'superficie', 4.5],
  ['alerta-texto', 'alerta-suave', 4.5],
  ['alerta-texto', 'superficie', 4.5],
  ['info-texto', 'info-suave', 4.5],
  ['sobre-tooltip', 'tooltip', 4.5],
  ['foco', 'superficie', 3],
  ['foco', 'fundo', 3],
  // Botão sólido DENTRO de um aviso âmbar — a composição que a faixa "Cadastro inativo" da ficha
  // do paciente inaugurou (change `paciente-inativo-com-saida`). Sem estes dois pares, o dia em
  // que o âmbar mudar de tom ninguém percebe que a ação sumiu dentro do aviso (achado DQ-PIS-02).
  ['acento', 'alerta-suave', 3],
  ['foco', 'alerta-suave', 3],
  ['borda-campo', 'superficie', 3],
  ['borda-campo', 'fundo', 3],
  // os gráficos dos indicadores (indicadores-profissionais), no Padrão: o rótulo dentro da célula do
  // mapa, o destaque que chama o olho e o contorno do "sem dados" (o Menta confere os mesmos
  // pares em `tema-da-clinica.contrato`)
  ['texto', 'grafico-mapa-1', 4.5],
  ['texto', 'grafico-mapa-2', 4.5],
  ['texto', 'grafico-mapa-3', 4.5],
  ['texto', 'grafico-mapa-4', 4.5],
  ['sobre-acento', 'grafico-mapa-5', 4.5],
  ['grafico-destaque', 'superficie', 3],
  ['grafico-destaque', 'grafico-recessivo', 3],
  ['grafico-sem-dados-contorno', 'superficie', 3],
]

describe('tokens — contraste WCAG 2.2 AA (tabela §3 do contrato)', () => {
  it('deve atingir o piso AA em todo par semântico documentado', () => {
    // ARRANGE: tokens resolvidos direto do index.css (fonte única)
    const tokens = resolverTokens()

    for (const [fg, bg, piso] of PARES_SEMANTICOS) {
      const corFg = tokens.get(fg)
      const corBg = tokens.get(bg)

      // ASSERT: par existe e é hex resolvível
      expect(corFg, `token --${fg} ausente do index.css`).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(corBg, `token --${bg} ausente do index.css`).toMatch(/^#[0-9A-Fa-f]{6}$/)

      // ACT + ASSERT: razão calculada, nunca estimada
      const razao = razaoContraste(corFg as string, corBg as string)
      expect(razao, `par --${fg} / --${bg} abaixo de ${piso}:1`).toBeGreaterThanOrEqual(piso)
    }
  })
})

// ── Fiscalização de código (§8.2 + parecer §5) ───────────────────────────────

interface Arquivo {
  caminho: string
  conteudo: string
}

function listarArquivosFonte(): Arquivo[] {
  const arquivos: Arquivo[] = []
  for (const entrada of readdirSync(RAIZ_SRC, { recursive: true, withFileTypes: true })) {
    if (!entrada.isFile() || !/\.(ts|tsx)$/.test(entrada.name)) {
      continue
    }
    const caminho = join(entrada.parentPath, entrada.name)
    arquivos.push({ caminho, conteudo: readFileSync(caminho, 'utf-8') })
  }
  return arquivos
}

// a pasta de helpers é `src/test/` — ancorada, não um `/test/` qualquer no meio
// do caminho: uma pasta chamada `test/` em outro lugar escaparia de TODA a
// fiscalização (storage, XSS, valor mágico) sem ninguém notar
const ehTeste = (caminho: string): boolean =>
  /\.test\.(ts|tsx)$/.test(caminho) || relative(RAIZ_SRC, caminho).startsWith(`test${sep}`)

describe('fiscalização — nenhum valor mágico fora dos tokens (§8.2)', () => {
  const fontes = listarArquivosFonte()
  const componentes = fontes.filter(({ caminho }) => caminho.endsWith('.tsx') && !ehTeste(caminho))

  it('deve não conter cor hex hardcoded em componente', () => {
    // ARRANGE: todo .tsx de produção (allowlist §8.2: lib/cor-status.ts é .ts)
    for (const { caminho, conteudo } of componentes) {
      // ASSERT: nenhum literal #RGB/#RRGGBB(AA) fora dos tokens
      expect(conteudo, `hex hardcoded em ${caminho}`).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
    }
  })

  it('deve não conter utilitário arbitrário de cor/raio/sombra/z', () => {
    for (const { caminho, conteudo } of componentes) {
      for (const padrao of ['bg-[', 'text-[#', 'rounded-[', 'shadow-[', 'z-[']) {
        expect(conteudo.includes(padrao), `utilitário arbitrário "${padrao}" em ${caminho}`).toBe(false)
      }
      // o raio DIRECIONAL também (`rounded-t-[4px]`, `rounded-tl-[…]`): a guarda olhava só `rounded-[`, e a
      // ponta das barras dos gráficos entrou crua por aí (DQ-16) — o token é `rounded-t-marca-de-dado`
      expect(conteudo, `raio arbitrário direcional em ${caminho}`).not.toMatch(/rounded-(?:[tblrse]|[tb][lr]|s[se]|e[se])-\[/)
    }
  })

  it('deve não conter cor literal ou raio em px dentro de style inline', () => {
    for (const { caminho, conteudo } of componentes) {
      for (const bloco of conteudo.matchAll(/style=\{\{[^}]*\}\}/gs)) {
        expect(bloco[0], `cor/raio literal em style de ${caminho}`).not.toMatch(
          /(#[0-9A-Fa-f]{3,8}\b|rgb\(|hsl\(|borderRadius:\s*['"]?\d)/,
        )
      }
    }
  })

  it('deve não conter a escala tipográfica CRUA da Tailwind — só os papéis do §4', () => {
    // A fiscalização olhava cor, raio, sombra e z — e a TIPOGRAFIA passava batido. Foi por
    // esse buraco que uma change inteira (mensageria-whatsapp) entrou com 15 `text-sm`/
    // `text-xs` enquanto o resto do produto tinha ZERO: o ritmo vertical de uma área do
    // sistema divergiu do resto por construção, e nenhum teste reprovou.
    //
    // `text-sm` traz line-height 1.43; `text-corpo`, 1.5. Não é cosmético — e os papéis do
    // §4 (display · titulo · subtitulo · corpo-lg · corpo · rotulo · meta) carregam os
    // modificadores declarados no index.css, que a classe crua não herda.
    const CRUAS = /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/
    const violacoes: string[] = []

    for (const { caminho, conteudo } of componentes) {
      for (const [indice, linha] of conteudo.split('\n').entries()) {
        if (CRUAS.test(linha)) {
          violacoes.push(`${caminho}:${indice + 1} — ${CRUAS.exec(linha)?.[0]}`)
        }
      }
    }

    expect(violacoes, [
      'Escala tipográfica crua da Tailwind em componente de produção.',
      'Use os papéis do §4: text-display · text-titulo · text-subtitulo · text-corpo-lg ·',
      'text-corpo · text-rotulo · text-meta.',
      violacoes.join('\n'),
    ].join('\n')).toEqual([])
  })

  it('deve não conter classe de token que o index.css NUNCA definiu', () => {
    // A fiscalização olhava valor ARBITRÁRIO (`bg-[#fff]`) e não via o buraco maior: classe
    // com CARA de token que não existe. `border-borda` (o token é `borda-campo`),
    // `bg-neutro-50`, `text-legenda`, `text-titulo-grande`, `text-aviso-texto` — o Tailwind
    // não gera nada para elas, então a borda não pinta, o fundo não pinta, o tamanho não
    // aplica. Foi assim que o produto passou a ter caixa COM contorno ao lado de caixa SEM,
    // e nenhum teste reprovou: o componente renderiza, só que sem a pele da casa.
    //
    // Entraram junto com módulos PORTADOS de outro projeto, que trouxeram os nomes de lá.
    const css = readFileSync(join(RAIZ_SRC, 'index.css'), 'utf-8')
    const tokensDeCor = new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((achado) => achado[1]))
    const papeisDeTexto = new Set([...css.matchAll(/--text-([a-z0-9-]+):/g)].map((achado) => achado[1]))

    // utilitários do Tailwind que NÃO são token do design system
    const ESTRUTURAIS = new Set(['transparent', 'current', 'inherit', 'white', 'black', 'none', 'auto'])
    const TEXTO_ESTRUTURAL = /^(left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/
    // largura direcional (`border-b-2`, `border-l-0`) e estilo de traço não são cor.
    // `spacing` aceita o sufixo da escala (`border-spacing-0`, `border-spacing-x-2`): a lista
    // previa a classe só na forma nua, e a forma nua não existe no Tailwind — a guarda
    // reprovava um utilitário legítimo (achado ao pôr o cabeçalho da grade de permissões em
    // `border-separate`, que EXIGE zerar o espaçamento)
    const BORDA_ESTRUTURAL =
      /^[tblrxyse]$|^([tblrxyse]-)?(\d+|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing(-[xy])?(-\d+)?)$/
    // Gradiente tem a MESMA lacuna que `spacing` teve: a lista previa a forma nua, que não
    // existe no Tailwind. Mas a direção só vale para DOIS dos quatro tipos — e a primeira
    // versão deste conserto liberou os quatro, deixando 16 classes fantasma escaparem
    // (achado do gate).
    //
    // MEDIDO isolado no Tailwind 4.3.2 (projeto separado, para o próprio código-fonte não
    // contaminar o resultado — foi o erro da medição anterior): linear/gradiente ACEITAM a
    // direção `-to-<t|tr|r|br|b|bl|l|tl>`; radial e cônico só existem na forma nua (o
    // cônico com ângulo, que não casa este padrão). O nome canônico da v4 é `linear`;
    // `gradient` é o alias legado que o codemod da própria ferramenta reescreve.
    const FUNDO_ESTRUTURAL =
      /^(cover|contain|center|top|bottom|left|right|no-repeat|repeat|fixed|local|scroll|clip|origin|blend|(gradient|linear)(-to-(t|tr|r|br|b|bl|l|tl))?|radial|conic)$/

    const violacoes: string[] = []
    for (const { caminho, conteudo } of componentes) {
      // comentário explica o CSS o tempo todo ("text-overflow: ellipsis") e não pinta nada:
      // varrer prosa faria a guarda gritar onde não há defeito — e guarda que grita falso é
      // guarda que alguém desliga
      const semComentarios = conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const [indice, linha] of semComentarios.split('\n').entries()) {
        // `from|via|to` entram porque ESTA change estreia os primeiros stops de gradiente
        // do código: um `from-token-que-nao-existe` deixaria o véu transparente→transparente,
        // invisível EM SILÊNCIO — o mesmo "dado que não se anuncia como faltando" que a
        // change existe para consertar, voltando pela porta dos fundos (achado do gate).
        for (const achado of linha.matchAll(/(?<![\w-])(bg|text|border|from|via|to)-([a-z][a-z0-9-]*)(?![\w-])/g)) {
          const [classe, prefixo, nome] = [achado[0], achado[1]!, achado[2]!]
          if (ESTRUTURAIS.has(nome)) continue
          if (prefixo === 'text' && (TEXTO_ESTRUTURAL.test(nome) || papeisDeTexto.has(nome))) continue
          if (prefixo === 'border' && BORDA_ESTRUTURAL.test(nome)) continue
          if (prefixo === 'bg' && FUNDO_ESTRUTURAL.test(nome)) continue
          // posição do stop (`from-0%`, `to-90`) é número, não cor
          if (['from', 'via', 'to'].includes(prefixo) && /^(\d+%?)$/.test(nome)) continue
          // direcionais compõem com o token: `border-l-acento` é `border-l` + `acento`
          const semDirecao = prefixo === 'border' ? nome.replace(/^[tblrxyse]-/, '') : nome
          if (tokensDeCor.has(semDirecao)) continue
          // `border-l-[3px]` (valor arbitrário de LARGURA) é assunto da guarda de valor
          // mágico, e o `[` corta o match antes: sobra o nome terminado em `-`
          if (nome.endsWith('-')) continue
          violacoes.push(`${caminho}:${indice + 1} — ${classe}`)
        }
      }
    }

    expect(violacoes, [
      'Classe com cara de token que o index.css não define — ela não pinta NADA.',
      'Use um token existente (§3 do contrato) ou declare o token novo no index.css.',
      violacoes.join('\n'),
    ].join('\n')).toEqual([])
  })

  it('deve não conter sombra nem z-index CRUS da Tailwind — só os tokens', () => {
    // `shadow-lg` e `z-50` renderizam (diferente do fantasma acima), mas com a escala de
    // OUTRO projeto: a camada flutuante fica com elevação e empilhamento que não conversam
    // com `--sombra-e1..e3` e `--z-fixo..z-tooltip`. O index.css já diz "z-index
    // inline/arbitrário é PROIBIDO"; a regra valia só para `z-[...]`, e a forma crua passava.
    const CRUAS = /(?<![\w-])(shadow-(sm|md|lg|xl|2xl|inner)|z-\d+)(?![\w-])/
    const violacoes: string[] = []

    for (const { caminho, conteudo } of componentes) {
      for (const [indice, linha] of conteudo.split('\n').entries()) {
        const achado = CRUAS.exec(linha)
        if (achado !== null) violacoes.push(`${caminho}:${indice + 1} — ${achado[1]}`)
      }
    }

    expect(violacoes, [
      'Sombra ou z-index crus da Tailwind em componente de produção.',
      'Sombra: shadow-e1 · shadow-e2 · shadow-e3. Empilhamento: z-(--z-fixo) · z-(--z-menu) ·',
      'z-(--z-dialogo) · z-(--z-toast) · z-(--z-tooltip).',
      violacoes.join('\n'),
    ].join('\n')).toEqual([])
  })

  it('deve não conter dark: antes da change de dark mode (§8.3)', () => {
    for (const { caminho, conteudo } of componentes) {
      expect(conteudo, `dark: antecipado em ${caminho}`).not.toMatch(/\bdark:/)
    }
  })
})

describe('fiscalização — o compositor de classes não pode descartar token (§0)', () => {
  it('deve preservar tamanho E cor quando os dois vêm no mesmo componente', () => {
    // ARRANGE: `text-corpo` é TAMANHO, `text-sobre-acento` é COR — o merge
    // ingênuo tratava os dois como cor e o último vencia, apagando o outro
    const classes = cn('bg-acento text-sobre-acento', 'h-10 px-4 text-corpo')

    // ASSERT
    expect(classes).toContain('text-sobre-acento')
    expect(classes).toContain('text-corpo')
  })

  it('deve continuar resolvendo conflito real de tamanho e de cor', () => {
    // ARRANGE / ACT: dois tamanhos e duas cores — o último de CADA grupo vence
    const classes = cn('text-meta text-texto', 'text-corpo text-acento')

    // ASSERT
    expect(classes).toBe('text-corpo text-acento')
  })

  it('deve reconhecer como TAMANHO todo papel declarado no index.css', () => {
    // ARRANGE: a lista de `cn.ts` é manual. Lista manual sem guarda foi
    // exatamente o que custou 2,52:1 — um papel novo cairia calado no grupo de
    // COR e o defeito renasceria em outro componente.
    for (const papel of papeisDeTamanho()) {
      // ACT
      const classes = cn(`text-${papel}`, 'text-texto')

      // ASSERT: tamanho e cor convivem — nenhum dos dois é descartado
      expect(classes, `o papel --text-${papel} não é conhecido por cn.ts`).toContain(
        `text-${papel}`,
      )
      expect(classes, `a cor foi descartada junto com text-${papel}`).toContain('text-texto')
    }
  })

  it('deve manter o rótulo do botão primário com a cor que garante o contraste AA', () => {
    // ARRANGE: o defeito era invisível ao contrato de tokens — ele confere os
    // PARES, não o que a tela pinta. Aqui se renderiza o Botao DE VERDADE: uma
    // cópia datilografada das classes seria o mesmo proxy que deixou o bug passar.
    const tokens = resolverTokens()
    render(<Botao variante="primario">Salvar</Botao>)

    // ACT
    const classes = screen.getByRole('button', { name: 'Salvar' }).className
    const razao = razaoContraste(
      tokens.get('sobre-botao-primario') as string,
      tokens.get('botao-primario') as string,
    )

    // ASSERT: a cor sobrevive à composição E o par cumpre o piso (o primário tem papel próprio
    // desde a change tema-da-clinica; no Padrão ele É o acento com texto branco)
    expect(classes).toContain('text-sobre-botao-primario')
    expect(classes).toContain('text-corpo')
    expect(razao).toBeGreaterThanOrEqual(4.5)
  })

  it('deve manter a variante perigo-suave com contraste AA no padrão e no hover', () => {
    // ARRANGE: a variante nasce para a ação de impacto FORA do diálogo (agenda-com-presenca).
    // O par é texto de perigo sobre a superfície (padrão) e sobre o fundo suave (hover); um
    // conserto que trocasse o texto pelo sólido `bg-perigo` passaria despercebido a olho.
    const tokens = resolverTokens()
    render(<Botao variante="perigo-suave">Desmarcar agenda</Botao>)

    // ACT
    const classes = screen.getByRole('button', { name: 'Desmarcar agenda' }).className
    const texto = tokens.get('perigo-texto') as string
    const noPadrao = razaoContraste(texto, tokens.get('superficie') as string)
    const noHover = razaoContraste(texto, tokens.get('perigo-suave') as string)
    // a MOLDURA é o que distingue a variante do "Hoje" ao lado (design-qa DQ-01): um alfa
    // avulso (`perigo/40`) media 1,9:1 — abaixo do piso de 3:1 de componente (1.4.11)
    const moldura = razaoContraste(tokens.get('perigo') as string, tokens.get('superficie') as string)

    // ASSERT
    expect(classes).toContain('text-perigo-texto')
    expect(classes).toContain('border-perigo ')
    expect(moldura).toBeGreaterThanOrEqual(3)
    expect(classes).not.toMatch(/(^|\s)bg-perigo(\s|$)/)
    expect(noPadrao).toBeGreaterThanOrEqual(4.5)
    expect(noHover).toBeGreaterThanOrEqual(4.5)
  })
})

describe('fiscalização — a tela não pode divergir do catálogo do servidor', () => {
  it('deve manter os ícones de status iguais aos que a API aceita', () => {
    // ARRANGE: a tela lista os slugs à mão; o servidor recusa (422) o que não está no
    // catálogo dele — e a recepção não teria como adivinhar o motivo
    const php = readFileSync(
      join(process.cwd(), '..', 'api', 'app', 'Support', 'Agenda', 'CatalogoIconesStatus.php'),
      'utf-8',
    )
    // o BLOCO inteiro do const, não só as linhas comentadas: a primeira versão desta
    // regex casava só o único ícone que tinha comentário ao lado — passava verde e não
    // provava nada
    const bloco = php.match(/public const ICONES = \[([\s\S]*?)\];/)?.[1] ?? ''
    const doServidor = [...bloco.matchAll(/'([a-z-]+)'/g)].map((achado) => achado[1])
    const tsx = readFileSync(join(RAIZ_SRC, 'paginas', 'pagina-status-agendamento.tsx'), 'utf-8')
    const blocoDaTela = tsx.match(/const ICONES = \[([\s\S]*?)\]/)?.[1] ?? ''
    const daTela = [...blocoDaTela.matchAll(/'([a-z-]+)'/g)].map((achado) => achado[1])

    // ASSERT: os dois CONJUNTOS são iguais — um ícone a mais na tela é um 422 que a
    // recepção não sabe resolver; um a menos é uma opção que o servidor aceita e
    // ninguém pode escolher
    expect(doServidor).toHaveLength(14)
    expect([...daTela].sort()).toEqual([...doServidor].sort())
  })
})

describe('fiscalização — contratos de segurança (parecer §5)', () => {
  const fontes = listarArquivosFonte()
  const producao = fontes.filter(({ caminho }) => !ehTeste(caminho))

  it('deve não conter dangerouslySetInnerHTML em nenhum arquivo de produção', () => {
    // ARRANGE: needle montada em partes para este arquivo não se autoflagrar
    const proibido = ['dangerously', 'SetInnerHTML'].join('')

    for (const { caminho, conteudo } of producao) {
      // ASSERT: escaping do React é o único caminho de render de texto (T-ds-01)
      expect(conteudo.includes(proibido), `${proibido} em ${caminho}`).toBe(false)
    }
  })

  it('deve não tocar localStorage, sessionStorage ou document.cookie', () => {
    // `preferencias-locais.ts` é o ÚNICO módulo autorizado a falar com o
    // armazenamento do navegador (SEC-RP-01): a fronteira suja tem um endereço,
    // e nenhum componente, página, store ou hook fala com o disco por fora dela.
    // A permissão é deste caminho, não do padrão: afrouxar o teste para "quase
    // nenhum arquivo" abriria a porta para sempre por causa de dois booleanos.
    const MODULO_DE_PREFERENCIAS = join('lib', 'preferencias-locais.ts')

    for (const { caminho, conteudo } of producao) {
      // caminho EXATO (relativo a src/), nunca sufixo: `endsWith` isentaria
      // também um `src/qualquer/coisa/src/lib/preferencias-locais.ts`
      const ehOModuloAutorizado = relative(RAIZ_SRC, caminho) === MODULO_DE_PREFERENCIAS

      for (const padrao of ['localStorage', 'sessionStorage', 'document.cookie']) {
        // o módulo autorizado fala também com a SESSÃO, só para o carimbo da recarga por versão
        // nova (PERF-12) — o mesmo endereço único, sem abrir a porta a outro arquivo
        if ((padrao === 'localStorage' || padrao === 'sessionStorage') && ehOModuloAutorizado) continue

        // ASSERT: credencial nunca no alcance do JS (T-ds-04)
        expect(conteudo.includes(padrao), `${padrao} em ${caminho}`).toBe(false)
      }
    }
  })

  it('deve importar lucide-react somente com imports nomeados', () => {
    for (const { caminho, conteudo } of producao) {
      // ASSERT: import * é proibido (superfície/bundle — parecer §1)
      expect(conteudo, `import * de lucide-react em ${caminho}`).not.toMatch(
        /import\s+\*\s+as\s+\w+\s+from\s+['"]lucide-react['"]/,
      )
    }
  })
})
