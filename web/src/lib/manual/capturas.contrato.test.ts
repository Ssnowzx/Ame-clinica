import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CAPTURAS } from '@/lib/manual/capturas'
import { SECOES_DO_MANUAL } from '@/lib/manual/conteudo'

/**
 * GUARDA DE CONTRATO — **o manifesto e o disco não podem divergir**.
 *
 * Manual ilustrado apodrece de dois jeitos, e os dois são silenciosos: alguém apaga um arquivo
 * de imagem e a página passa a exibir figura quebrada; ou alguém troca a figura e deixa a antiga
 * esquecida no repositório, engordando o pacote sem que nada aponte para ela.
 *
 * O que ela NÃO cobre: se a figura ainda RETRATA a tela. Isso nenhum teste vê — o que existe
 * para isso é a data em `capturadaEm` e o gatilho de revisão em `docs/GATILHOS.md`. Guarda que
 * não diz o que não cobre é guarda que engana.
 */

// `process.cwd()`, como as outras guardas de contrato desta casa: o `import.meta.url` do Vite
// resolve para o caminho SERVIDO (`/src`), não para o do disco.
const PASTA = join(process.cwd(), 'public', 'capturas-do-manual')

/**
 * As dimensões REAIS do arquivo, lidas do cabeçalho do JPEG.
 *
 * O manifesto declara `largura`/`altura` para o navegador reservar o espaço da figura antes de
 * ela chegar — sem isso a página pula durante a leitura. Declaração e arquivo divergem no dia em
 * que alguém recaptura uma tela e esquece de atualizar o número: o espaço reservado fica errado,
 * e o pulo volta. Ler o cabeçalho é mais barato que uma dependência de imagem.
 */
function dimensoesDoJpeg(caminho: string): { largura: number; altura: number } {
  const bytes = readFileSync(caminho)
  let posicao = 2 // pula o marcador de início (SOI)

  while (posicao < bytes.length - 8) {
    if (bytes[posicao] !== 0xff) {
      posicao += 1
      continue
    }

    const marcador = bytes[posicao + 1]
    // SOF0..SOF15 carregam o tamanho; C4 (Huffman), C8 (JPG) e CC (arithmetic) não são SOF
    const ehTamanho = marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)
    if (ehTamanho) {
      return { altura: bytes.readUInt16BE(posicao + 5), largura: bytes.readUInt16BE(posicao + 7) }
    }

    posicao += 2 + bytes.readUInt16BE(posicao + 2)
  }

  throw new Error(`não foi possível ler as dimensões de ${caminho}`)
}

describe('Capturas do manual — contrato com o disco', () => {
  it('deve ter em disco o arquivo de toda captura declarada', () => {
    // ARRANGE + ACT
    const faltando = Object.values(CAPTURAS)
      .map((captura) => captura.arquivo)
      .filter((arquivo) => !existsSync(join(PASTA, arquivo)))

    // ASSERT
    expect(faltando).toEqual([])
  })

  it('deve declarar toda imagem que está em disco', () => {
    // ARRANGE
    const declarados = new Set<string>(Object.values(CAPTURAS).map((captura) => captura.arquivo))

    // ACT: arquivo órfão pesa no repositório e ninguém sabe se ainda serve para alguma coisa
    const orfaos = readdirSync(PASTA).filter((arquivo) => !declarados.has(arquivo))

    // ASSERT
    expect(orfaos).toEqual([])
  })

  it('deve descrever toda captura para quem não a enxerga', () => {
    // ARRANGE + ACT: `alt` genérico é o mesmo que nenhum — quem ouve não recebe informação
    const semDescricao = Object.entries(CAPTURAS).filter(
      ([, captura]) =>
        captura.alt.trim().length < 40 ||
        captura.legenda.trim().length === 0 ||
        /^(captura|imagem|tela|print)\b/i.test(captura.alt.trim()),
    )

    // ASSERT
    expect(semDescricao.map(([id]) => id)).toEqual([])
  })

  it('deve declarar as dimensões REAIS de cada arquivo', () => {
    // ARRANGE + ACT: recapturar uma tela muda o tamanho do arquivo — e a declaração fica para
    // trás em silêncio, devolvendo à página o pulo que `width`/`height` existem para evitar
    const divergentes = Object.entries(CAPTURAS)
      .filter(([, captura]) => existsSync(join(PASTA, captura.arquivo)))
      .map(([id, captura]) => ({ id, declarado: captura, real: dimensoesDoJpeg(join(PASTA, captura.arquivo)) }))
      .filter(
        ({ declarado, real }) => declarado.largura !== real.largura || declarado.altura !== real.altura,
      )
      .map(({ id, declarado, real }) => `${id}: declarado ${String(declarado.largura)}×${String(declarado.altura)}, real ${String(real.largura)}×${String(real.altura)}`)

    // ASSERT
    expect(divergentes).toEqual([])
  })

  it('deve datar toda captura', () => {
    // ARRANGE + ACT: sem a data ninguém sabe se a figura é anterior à mudança da tela
    const semData = Object.entries(CAPTURAS).filter(
      ([, captura]) => !/^\d{4}-\d{2}-\d{2}$/.test(captura.capturadaEm),
    )

    // ASSERT
    expect(semData.map(([id]) => id)).toEqual([])
  })

  it('deve usar no manual toda captura declarada', () => {
    // ARRANGE
    const usadas = new Set<string>(
      SECOES_DO_MANUAL.flatMap((secao) =>
        secao.blocos.filter((bloco) => bloco.tipo === 'captura').map((bloco) => bloco.id),
      ),
    )

    // ACT: o inverso já é garantido pelo tipo — captura referenciada e não declarada não compila
    const naoUsadas = Object.keys(CAPTURAS).filter((id) => !usadas.has(id))

    // ASSERT
    expect(naoUsadas).toEqual([])
  })
})
