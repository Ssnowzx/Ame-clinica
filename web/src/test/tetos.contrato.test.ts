import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { reguaFicticia } from '@/test/dados-cadastros'

/**
 * GUARDA DE CONTRATO — **o teto da fixture é o teto do servidor**.
 *
 * A change `tetos-do-cadastro-na-tela` existe porque um número de forma escrito duas vezes não
 * diverge com erro: diverge com uma família digitando o que uma borda aceita e a outra recusa.
 * O código de produção cumpre isso. A FIXTURE do web não cumpria — ela transcreve os tetos à
 * mão, porque precisa devolver um JSON pronto sem subir o Laravel.
 *
 * **A primeira versão desta guarda lia o `FormaDoCampo.php` com REGEX, e o code review a
 * atravessou por dois caminhos** (rodada 2): um campo que trocasse `'string'` por outra coisa
 * (o servidor passaria a mandar `null` e a regex continuaria lendo o número) e os tetos dos
 * SUBCAMPOS, que ela nem olhava. O segundo é exatamente a classe do defeito que esta change
 * descobriu à mão — o `email` do responsável, sem `'string'` e portanto sem teto. Uma rede que
 * não pega o próprio caso que a motivou não é rede.
 *
 * Agora os dois lados usam o MESMO predicado: a fixture abaixo é gerada pelas funções de
 * produção (`Catalogo::tamanho()` e `::tamanhosDosItens()`), e não por uma reimplementação.
 * Para regerar depois de mexer em `FormaDoCampo`:
 *
 *     cd api && php artisan campos:tetos --json > ../web/src/test/tetos-da-api.json
 *
 * Lida por `fs` de propósito: a fixture é DADO de teste, não entra no bundle.
 */

interface CampoDaApi {
  campo: string
  tamanho: number | null
  tamanhos_dos_itens: Record<string, number> | never[]
}

const CAMINHO_DA_FIXTURE = resolve(process.cwd(), 'src/test/tetos-da-api.json')

function tetosDaApi(): CampoDaApi[] {
  const bruto: { campos?: CampoDaApi[] } = JSON.parse(readFileSync(CAMINHO_DA_FIXTURE, 'utf8'))
  const campos = bruto.campos

  if (campos === undefined || campos.length === 0) {
    throw new Error('fixture: tetos-da-api.json vazio — regere com `php artisan campos:tetos --json`')
  }

  return campos
}

/** O JSON do PHP emite `[]` para mapa vazio; normaliza para comparar com o do web. */
function itens(bruto: CampoDaApi['tamanhos_dos_itens']): Record<string, number> {
  return Array.isArray(bruto) ? {} : bruto
}

describe('guarda de contrato — tetos da fixture × tetos do servidor', () => {
  it('deve cobrir todos os campos do catálogo', () => {
    // ARRANGE + ACT — sem isto a comparação poderia passar vazia
    const daApi = tetosDaApi().map((campo) => campo.campo).sort()
    const daFixture = reguaFicticia().campos.map((campo) => campo.campo).sort()

    // ASSERT
    expect(daFixture).toEqual(daApi)
  })

  it('deve manter cada teto da fixture igual ao do servidor', () => {
    // ARRANGE
    const daApi = Object.fromEntries(tetosDaApi().map((campo) => [campo.campo, campo.tamanho]))
    const daFixture = Object.fromEntries(reguaFicticia().campos.map((campo) => [campo.campo, campo.tamanho]))

    // ACT + ASSERT — inclusive os `null`, que é o lado que a regex não via
    expect(daFixture).toEqual(daApi)
  })

  it('deve manter cada teto de SUBCAMPO igual ao do servidor', () => {
    // ARRANGE — a regex nem olhava para `itensDe()`: era o segundo ponto cego
    const daApi = Object.fromEntries(tetosDaApi().map((campo) => [campo.campo, itens(campo.tamanhos_dos_itens)]))
    const daFixture = Object.fromEntries(
      reguaFicticia().campos.map((campo) => [campo.campo, campo.tamanhos_dos_itens]),
    )

    // ACT + ASSERT
    expect(daFixture).toEqual(daApi)
  })
})
