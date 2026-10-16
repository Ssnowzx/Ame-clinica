import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { describe, expect, it } from 'vitest'

import { DESTAQUE_NO_CARTAO } from '@/componentes/agenda/pele-da-confirmacao'
import { ESTADOS_DA_CONFIRMACAO } from '@/lib/confirmacao-do-lembrete'

/**
 * GUARDA DE CONTRATO — **o destaque da faixa gera CSS que casa com o atributo do cartão**.
 *
 * Achado na validação da change telefone-que-chega-no-whatsapp (02/10): dentro de um valor
 * arbitrário (`data-[confirmacao=nao_entregue]`) o Tailwind troca `_` por ESPAÇO. A regra saía
 * `[data-confirmacao="nao entregue"]`, que nunca casa com `nao_entregue`. Tocar em "1 pediu para
 * desmarcar" deixava a grade INTEIRA cinza, sem o contorno — desde a change que criou a faixa. O
 * teste de tela não via: ele confere que a CLASSE está no cartão, e a classe estava. O que faltava
 * era o CSS, e só o compilador de verdade diz qual CSS sai.
 *
 * Por isso a guarda faz o caminho do BUILD inteiro:
 * - o scanner do Tailwind lê o TEXTO do arquivo, não o valor em execução. A primeira versão desta
 *   guarda compilava o valor em execução e passou com `'\\_'`, que no texto do arquivo tem DUAS
 *   barras e não gera regra nenhuma no build;
 * - o compilador recebe o CSS de entrada do APP (`src/index.css`, com o `@theme`), senão as cores
 *   do design system não geram CSS e a cor do contorno ficaria sem prova (gate r1, CR-TEL-07);
 * - os dois atributos têm de estar na MESMA regra, com a declaração dentro dela.
 */

const ARQUIVO = resolve(process.cwd(), 'src/componentes/agenda/pele-da-confirmacao.tsx')
const ESTILOS = resolve(process.cwd(), 'src')

/** Os candidatos que o build extrai do arquivo — o que de fato vira CSS. */
function candidatosDoArquivo(): string[] {
  return new Scanner({}).scanFiles([{ content: readFileSync(ARQUIVO, 'utf8'), extension: 'tsx' }])
}

async function cssDoDestaque(): Promise<string> {
  const compilador = await compile(readFileSync(resolve(ESTILOS, 'index.css'), 'utf8'), {
    base: ESTILOS,
    onDependency: () => undefined,
  })

  return compilador.build(candidatosDoArquivo())
}

/** As declarações das regras em que o MESMO estado está na grade e no cartão. */
function declaracoesDoEstado(css: string, estado: string): string {
  const regra = new RegExp(
    String.raw`\[data-destaque="${estado}"\] \*\) \{\s*&\[data-confirmacao="${estado}"\] \{([^}]*)\}`,
    'g',
  )

  return [...css.matchAll(regra)].map((casou) => casou[1] ?? '').join('\n')
}

describe('guarda de contrato — o destaque da faixa no CSS gerado', () => {
  it.each(ESTADOS_DA_CONFIRMACAO)('deve devolver a cor e pôr o contorno no cartão do estado %s', async (estado) => {
    // ARRANGE + ACT
    const declaracoes = declaracoesDoEstado(await cssDoDestaque(), estado)

    // ASSERT — volta a cor (grayscale-0), o anel de 2 px (ring-2) e a cor do anel (token do DS)
    expect(declaracoes).toContain('--tw-grayscale: grayscale(0%)')
    expect(declaracoes).toMatch(/--tw-ring-shadow: .*calc\(2px/)
    expect(declaracoes).toMatch(/--tw-ring-color: var\(--[a-z-]+\)/)
  })

  it('deve pôr no cartão exatamente as classes que o build encontrou no arquivo', () => {
    // ARRANGE + ACT
    const doBuild = new Set(candidatosDoArquivo())

    // ASSERT — classe que o cartão leva e o build não viu é classe sem CSS
    expect(DESTAQUE_NO_CARTAO.split(' ').filter((classe) => !doBuild.has(classe))).toEqual([])
  })

  it('não deve gerar regra para um valor que nenhum cartão tem', async () => {
    // ARRANGE + ACT
    const css = await cssDoDestaque()

    // ASSERT — "nao entregue" (com espaço) foi o defeito
    expect(css).not.toMatch(/data-(destaque|confirmacao)="[a-z]+ [a-z]+"/)
  })
})
