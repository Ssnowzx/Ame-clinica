import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CATALOGOS_DE_APOIO, PERMISSOES_DE_CADASTRO } from '@/lib/catalogos'

/**
 * GUARDA DE CONTRATO — **cartão no hub que não tem rota é um 404 publicado**.
 *
 * `CATALOGOS_DE_APOIO` é a lista única: o hub desenha um cartão por entrada e a navegação
 * deriva dela as permissões que abrem "Cadastros". A ROTA, porém, é declarada à mão em
 * `app.tsx` — e é exatamente aí que a lista e o roteador podem divergir sem que nada
 * reprove: a entrada nova aparece no hub, a recepcionista clica, e cai numa tela em branco.
 *
 * Esta guarda amarra as duas pontas: toda entrada precisa de uma `<Route path=…>` protegida
 * pela permissão de VER do seu módulo.
 *
 * O que ela NÃO cobre: se a rota renderiza a página certa (um `path` apontando para o
 * componente errado passa aqui). Isso é trabalho do teste de cada página.
 */
const APP = readFileSync(join(process.cwd(), 'src', 'app.tsx'), 'utf8')

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * O par `path` + `permissao` DENTRO do mesmo `<Route>`.
 *
 * A primeira versão desta guarda usava uma janela de 400 caracteres — e o gate provou por
 * mutação que ela aprovava uma rota SEM proteção nenhuma: a janela atravessava o bloco
 * seguinte e lia a permissão do vizinho (308 caracteres) ou a da rota filha (223). Uma
 * guarda que aprova o que existe para reprovar é pior que guarda nenhuma.
 *
 * A segunda versão parava no próximo `path=` — e o gate achou QUATRO desvios que ela ainda
 * aprovava, todos com a rota SEM guarda: vizinha escrita `element` antes de `path` (não há
 * `path=` no caminho até a prova), rota DUPLICADA com a segunda protegida (o React Router
 * serve a primeira), guarda COMENTADA, e `<Route index>` filho protegido sob mãe aberta.
 *
 * Agora a prova tem de estar COLADA: `path="X" element={ <ExigePermissao permissao="Y.ver"`.
 * **Preço explícito** (falso negativo aceito): rota válida escrita com `element` ANTES de
 * `path` reprova aqui. É o lado certo para errar — as 15 rotas da casa escrevem `path`
 * primeiro; reprovar código válido custa um ajuste, aprovar rota aberta custa a clínica.
 */
function blocoDaRota(rota: string, modulo: string): RegExp {
  return new RegExp(
    `path="${escaparRegex(rota)}"\\s*element=\\{\\s*<ExigePermissao permissao="${escaparRegex(modulo)}\\.ver"`,
  )
}

/**
 * Rotas SEM autenticação — públicas por desenho.
 *
 * `/login` e `/cadastro/:slug` (o link que a família preenche) existem para quem ainda não
 * entrou; `*` é o 404.
 */
const ROTAS_PUBLICAS = ['/login', '/cadastro/:slug', '*']

/**
 * Rotas autenticadas que dispensam `ExigePermissao` — e por que cada uma.
 *
 * ⚠️ "Sem `ExigePermissao`" NÃO é "sem guarda". Chamar `/profissionais/:id` de "ficha
 * pública", como esta lista já fez, é o tipo de rótulo errado que convida a expor (achado
 * da rodada 4 do gate): ela vive sob `RotaProtegida` e SE AUTOGUARDA em
 * `pagina-ficha-profissional.tsx` (`profissionais.ver || ehProprio`) — pôr um
 * `ExigePermissao permissao="profissionais.ver"` ali trancaria o profissional fora da
 * PRÓPRIA ficha. Cada entrada aqui cita o teste que prova a sua guarda.
 */
const ROTAS_COM_GUARDA_PROPRIA = [
  '/', // só redireciona para a agenda; não lê dado
  '/profissionais/:id', // guarda interna `profissionais.ver || ehProprio` — pagina-ficha-profissional.test.tsx
  '/manual', // não faz uma única chamada de API (guarda em navegacao.contrato.test.ts)
]

/** A união é o que a varredura do roteador aceita ver sem `ExigePermissao`. */
const ROTAS_ABERTAS = ['/login', '/cadastro/:slug', '/', '/profissionais/:id', '/manual', '*']

/** Rotas de DETALHE que não são cartão do hub — sem isto, ninguém as fiscaliza. */
const ROTAS_FILHAS: ReadonlyArray<readonly [string, string]> = [
  ['/categorias/:id', 'categorias'],
  ['/convenios/:id', 'convenios'],
]

describe('Catálogos de apoio — a lista única e o roteador não divergem', () => {
  it.each(CATALOGOS_DE_APOIO.map((catalogo) => [catalogo.rotulo, catalogo] as const))(
    'deve ter rota protegida para %s',
    (_rotulo, catalogo) => {
      // ARRANGE + ACT — o PAR, dentro do MESMO <Route>. Conferir os dois como fatos
      // independentes (`includes(path)` e `includes(permissao)`) deixava passar a troca
      // de permissões entre duas rotas: as duas strings continuam vivas no arquivo, cada
      // uma no bloco errado (achado SEC-CFT-01 do gate, provado por mutação).
      const bloco = blocoDaRota(catalogo.rota, catalogo.modulo)

      // ASSERT
      expect(
        bloco.test(APP),
        `em app.tsx, a rota "${catalogo.rota}" precisa estar dentro de <Route> com ExigePermissao permissao="${catalogo.modulo}.ver"`,
      ).toBe(true)
    },
  )

  it.each(ROTAS_FILHAS)(
    'deve proteger a rota filha %s com a permissão do módulo da mãe',
    (rota, modulo) => {
      // ARRANGE + ACT — `/categorias/:id` não está em CATALOGOS_DE_APOIO (não é cartão do
      // hub) e por isso não era coberta por guarda mecânica NENHUMA
      const bloco = blocoDaRota(rota, modulo)

      // ASSERT
      expect(bloco.test(APP), `a rota filha "${rota}" precisa exigir "${modulo}.ver"`).toBe(true)
    },
  )

  it('deve derivar as permissões do hub da própria lista, sem segunda lista à mão', () => {
    // ARRANGE + ACT
    const esperadas = CATALOGOS_DE_APOIO.map(({ modulo }) => `${modulo}.ver`)

    // ASSERT — o hub abre com QUALQUER uma delas; esquecer uma esconde o cartão de quem podia vê-lo
    expect([...PERMISSOES_DE_CADASTRO]).toEqual(esperadas)
  })

  it('deve exigir proteção — ou allowlist explícita — em TODA rota do roteador', () => {
    // ARRANGE — a guarda por catálogo fiscaliza só as rotas que estão nas duas listas. Uma
    // rota NOVA que ninguém listou (`/contas/nova`, um relatório, uma tela de detalhe)
    // nascia fora de qualquer vigia. Aqui a régua é o roteador inteiro: toda rota está
    // protegida OU está declarada aberta, e abrir uma passa a exigir editar esta lista.
    //
    // O QUE ESTA GUARDA VÊ E O QUE NÃO VÊ — medido na rodada 4 do gate, porque a versão
    // anterior deste comentário declarava um limite FALSO (dizia não pegar a duplicata, e
    // pega: a primeira ocorrência entra em `abertas` e a lista exata falha). Limite falso
    // numa guarda de segurança é pior que limite não documentado.
    //
    // PEGA: rota sem `ExigePermissao`; rota nova que ninguém listou; guarda comentada;
    // prop homônima no lugar do componente; permissões trocadas entre rotas; duplicata em
    // que a PRIMEIRA está desprotegida.
    //
    // NÃO PEGA (um caso, e está preso pelas duas asserções extras abaixo, que reprovam a
    // SINTAXE em vez de tentar entendê-la): duplicata em que a primeira está protegida por
    // permissão de OUTRO módulo — o React Router serve a primeira, e a permissão em vigor
    // é a errada. Isso pede análise sintática do JSX; até lá, é risco de revisão humana,
    // dito aqui em vez de escondido.
    const rotas = [...APP.matchAll(/path="([^"]+)"/g)].map((achado) => ({
      rota: achado[1] ?? '',
      protegida: /^\s*element=\{\s*<ExigePermissao permissao=/.test(
        APP.slice(achado.index + achado[0].length, achado.index + achado[0].length + 220),
      ),
    }))

    // ACT
    const abertas = rotas.filter((item) => !item.protegida).map((item) => item.rota)

    // ASSERT — lista EXATA; rota aberta é DECISÃO, e a decisão aparece no diff
    expect(abertas).toEqual(ROTAS_ABERTAS)
    // e a união das duas listas nomeadas é exatamente ela: nenhuma rota fica sem categoria
    expect([...ROTAS_ABERTAS].sort()).toEqual(
      [...ROTAS_PUBLICAS, ...ROTAS_COM_GUARDA_PROPRIA].sort(),
    )
    expect(rotas.length).toBeGreaterThan(40) // a varredura achou o roteador, não um resto
  })

  it('deve recusar as duas sintaxes que a varredura de rotas não enxerga', () => {
    // ARRANGE — a guarda acima lê `path="…"`. Duas formas legais de React Router escapam
    // dela e entrariam no roteador SEM fiscalização nenhuma: `path={'/x'}` (chaves) e
    // `<Route index>` (que não tem `path` nenhum). Em vez de tentar entender o JSX, esta
    // guarda proíbe as duas na casa — quem precisar delas reprova aqui e decide no diff.
    const comChaves = /path=\{/.test(APP)
    const rotaIndex = /<Route\s+index\b/.test(APP)

    // ASSERT
    expect(comChaves, 'use path="…" com aspas: `path={…}` escapa da guarda de permissão').toBe(
      false,
    )
    expect(rotaIndex, '`<Route index>` não tem path e escapa da guarda de permissão').toBe(false)
  })

  it('deve manter rota e módulo únicos — duas entradas na mesma rota escondem uma', () => {
    // ARRANGE + ACT
    const rotas = CATALOGOS_DE_APOIO.map((catalogo) => catalogo.rota)
    const modulos = CATALOGOS_DE_APOIO.map((catalogo) => catalogo.modulo)

    // ASSERT
    expect(new Set(rotas).size).toBe(rotas.length)
    expect(new Set(modulos).size).toBe(modulos.length)
  })

  it('deve descrever o que a clínica ganha, sem repetir o rótulo', () => {
    // ARRANGE + ACT
    const mudas = CATALOGOS_DE_APOIO.filter(
      (catalogo) =>
        catalogo.descricao.trim().length < 20 ||
        catalogo.descricao.toLowerCase() === catalogo.rotulo.toLowerCase(),
    )

    // ASSERT — o cartão do hub é a única explicação que a operadora recebe antes de clicar
    expect(mudas.map((catalogo) => catalogo.rotulo)).toEqual([])
  })
})
