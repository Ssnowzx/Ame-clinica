import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CATALOGO_DE_RELATORIOS } from '@/lib/relatorios/catalogo'

/**
 * GUARDA DE CONTRATO WEB × API (change `area-de-relatorios`, task 1.7).
 *
 * Dois catálogos que divergem é o link morto: um slug que só o web conhece vira um cartão
 * que abre em 404, e uma permissão errada aqui é um cartão que aparece para quem o servidor
 * vai recusar com 403 (ou pior, um cartão escondido de quem podia ver o dado).
 *
 * A fixture é o índice REAL da API — o mesmo de `GET /api/relatorios`. Para regerar depois
 * de mexer no catálogo da API (`api/app/Support/Relatorios/CatalogoDeRelatorios.php` ou nas
 * `permissoes()` de um relatório):
 *
 *     cd api && php artisan relatorios:catalogo --json > ../web/src/lib/relatorios/catalogo-da-api.json
 *
 * Lida por `fs` de propósito: a fixture é DADO de teste, não entra no bundle da aplicação.
 */

interface RelatorioDaApi {
  slug: string
  titulo: string
  permissoes: string[]
  eixo: string | null
  expoe_nome: boolean
}

// a partir da raiz do `web/` (onde o vitest roda): sob o transform do Vite, `import.meta.url`
// não é um caminho de arquivo
const CAMINHO_DA_FIXTURE = resolve(process.cwd(), 'src/lib/relatorios/catalogo-da-api.json')

function indiceDaApi(): RelatorioDaApi[] {
  const bruto: { relatorios?: RelatorioDaApi[] } = JSON.parse(readFileSync(CAMINHO_DA_FIXTURE, 'utf8'))
  const relatorios = bruto.relatorios

  if (relatorios === undefined || relatorios.length === 0) {
    throw new Error('fixture: catalogo-da-api.json sem relatórios — regere com `php artisan relatorios:catalogo --json`')
  }

  return relatorios
}

describe('Catálogo de relatórios — web × API', () => {
  it('deve ter exatamente os mesmos slugs que a API publica no índice', () => {
    // ARRANGE
    const daApi = indiceDaApi().map((relatorio) => relatorio.slug)
    const doWeb = CATALOGO_DE_RELATORIOS.map((relatorio) => relatorio.slug)

    // ACT — a ordem é de apresentação em cada lado; o que importa é o conjunto
    const soNoWeb = doWeb.filter((slug) => !daApi.includes(slug))
    const soNaApi = daApi.filter((slug) => !doWeb.includes(slug))

    // ASSERT — um slug só no web é cartão que abre em 404; só na API é relatório inalcançável
    expect(soNoWeb).toEqual([])
    expect(soNaApi).toEqual([])
  })

  it('deve exigir, em cada slug, o MESMO conjunto de permissões que a API exige', () => {
    // ARRANGE — conjunto, não lista: a ordem não é contrato, a composição é
    const daApi = Object.fromEntries(
      indiceDaApi().map((relatorio) => [relatorio.slug, [...relatorio.permissoes].sort()]),
    )

    // ACT
    const doWeb = Object.fromEntries(
      CATALOGO_DE_RELATORIOS.map((relatorio) => [relatorio.slug, [...relatorio.permissoes].sort()]),
    )

    // ASSERT
    expect(doWeb).toEqual(daApi)
  })
})
