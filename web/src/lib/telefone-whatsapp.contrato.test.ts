import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formaLegivel, lerTelefone, TIPOS_TELEFONICOS } from '@/lib/telefone-whatsapp'

/**
 * GUARDA DE CONTRATO — **o campo de telefone classifica como o lembrete envia**.
 *
 * `lerTelefone()` é cópia de `TelefoneE164::classificar()`. Se as duas divergirem, a tela diz
 * "WhatsApp: +55 …" para um número que o lembrete recusa (ou avisa erro num número bom), e cada
 * lado continua verde no próprio teste — foi assim que a tela e o servidor discordaram do que é
 * horário ocupado. Por isso a fixture abaixo é gerada pela função de PRODUÇÃO do servidor, nunca
 * escrita à mão. Para regerar depois de mexer em `TelefoneE164`:
 *
 *     cd api && php artisan telefones:casos --json > ../web/src/test/telefones-da-api.json
 *
 * Lida por `fs` de propósito: a fixture é DADO de teste, não entra no bundle.
 */

interface CasoDaApi {
  entrada: string
  forma: string | null
  tipo: 'celular' | 'fixo' | null
}

const CAMINHO_DA_FIXTURE = resolve(process.cwd(), 'src/test/telefones-da-api.json')

interface FixtureDaApi {
  tipos_telefonicos?: string[]
  casos?: CasoDaApi[]
}

function fixtureDaApi(): FixtureDaApi {
  return JSON.parse(readFileSync(CAMINHO_DA_FIXTURE, 'utf8')) as FixtureDaApi
}

function casosDaApi(): CasoDaApi[] {
  const casos = fixtureDaApi().casos

  if (casos === undefined || casos.length === 0) {
    throw new Error('fixture: telefones-da-api.json vazio — regere com `php artisan telefones:casos --json`')
  }

  return casos
}

describe('guarda de contrato — telefone da tela × telefone do servidor', () => {
  it('deve cobrir as três classes e os formatos digitados errado em 02/10', () => {
    // ARRANGE + ACT — sem isto a comparação abaixo poderia passar sobre uma fixture pobre
    const casos = casosDaApi()
    const tipos = new Set(casos.map((caso) => caso.tipo))

    // ASSERT
    expect(tipos).toEqual(new Set(['celular', 'fixo', null]))
    expect(casos.map((caso) => caso.entrada)).toContain('55 49912-3456')
  })

  it('deve cobrir o número de outro país, com e sem o +', () => {
    // ARRANGE + ACT — change telefone-estrangeiro: sem estes casos, a regra nova da tela poderia
    // divergir do servidor e a comparação abaixo continuaria verde
    const casos = casosDaApi()
    const estrangeiros = casos.filter((caso) => caso.forma !== null && !caso.forma.startsWith('+55'))
    const semMais = casos.find((caso) => caso.entrada === '447700900123')

    // ASSERT
    expect(estrangeiros.length).toBeGreaterThan(0)
    expect(estrangeiros.every((caso) => caso.tipo === 'celular')).toBe(true)
    expect(semMais).toEqual({ entrada: '447700900123', forma: null, tipo: null })
  })

  it('deve classificar cada caso exatamente como o servidor', () => {
    // ARRANGE
    const casos = casosDaApi()

    // ACT
    const daTela = casos.map((caso) => ({ entrada: caso.entrada, ...lerTelefone(caso.entrada) }))

    // ASSERT — a mensagem do `toEqual` aponta a entrada que divergiu
    expect(daTela).toEqual(casos)
  })

  it('deve avisar nos mesmos tipos de contato que o servidor trata como telefone', () => {
    // ARRANGE + ACT — gate r1, CR-TEL-10: a lista da tela é cópia da `ContatoNormalizado`
    const doServidor = fixtureDaApi().tipos_telefonicos

    // ASSERT
    expect(doServidor).toBeDefined()
    expect([...TIPOS_TELEFONICOS]).toEqual(doServidor)
  })

  it('deve mostrar a forma com a máscara da cobrança', () => {
    // ARRANGE / ACT / ASSERT
    expect(formaLegivel('+5549991234567')).toBe('+55 (49) 99123-4567')
    expect(formaLegivel('+554932221234')).toBe('+55 (49) 3222-1234')
    // a de fora sai como veio: 12 dígitos não fazem dela um fixo brasileiro
    expect(formaLegivel('+447700900123')).toBe('+447700900123')
  })
})
