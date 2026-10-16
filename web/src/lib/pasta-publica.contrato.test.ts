import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * GUARDA DE CONTRATO — **nada em `web/public/` pode ter o nome de uma rota da aplicação**.
 *
 * `web/public/` é copiado como está para `dist/`, e o nginx da produção serve arquivo e pasta
 * ANTES de cair no `index.html` da SPA. Quando a pasta das capturas do manual se chamava
 * `public/manual/`, abrir `/manual` pelo endereço (ou dar F5 nele) virava um 301 para
 * `http://127.0.0.1/manual/` (o host de dentro do container) e depois um 403. Pelo menu
 * funcionava, porque a navegação interna não pergunta nada ao servidor, e por isso ninguém viu
 * por um mês (achado em 2026-10-01).
 *
 * - **COBRE** a colisão de nome entre o primeiro segmento de toda rota declarada em `app.tsx` e
 *   qualquer arquivo ou pasta da raiz de `public/`.
 * - **NÃO COBRE** a configuração do nginx em si (ela vive na VPS, fora deste repositório) nem
 *   rota montada fora de `app.tsx`.
 */

// `process.cwd()`, como as outras guardas de contrato desta casa: o `import.meta.url` do Vite
// resolve para o caminho SERVIDO (`/src`), não para o do disco.
const RAIZ = process.cwd()

function primeirosSegmentosDasRotas(): Set<string> {
  const app = readFileSync(join(RAIZ, 'src', 'app.tsx'), 'utf8')
  const segmentos = [...app.matchAll(/path="\/([^/":]+)/g)].map((achado) => achado[1])

  return new Set(segmentos)
}

describe('Pasta pública × rotas da aplicação', () => {
  it('deve achar as rotas em app.tsx, senão a guarda passa vazia', () => {
    // ARRANGE + ACT
    const rotas = primeirosSegmentosDasRotas()

    // ASSERT — a rota que motivou a guarda tem de estar no conjunto que ela confere
    expect(rotas.has('manual')).toBe(true)
    expect(rotas.size).toBeGreaterThan(20)
  })

  it('não deve ter em public/ arquivo ou pasta com o nome de uma rota', () => {
    // ARRANGE
    const rotas = primeirosSegmentosDasRotas()

    // ACT
    const colisoes = readdirSync(join(RAIZ, 'public')).filter((nome) => rotas.has(nome))

    // ASSERT
    expect(colisoes).toEqual([])
  })
})
