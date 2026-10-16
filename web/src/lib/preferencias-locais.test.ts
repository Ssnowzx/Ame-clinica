import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  alternarPreferenciaDeLayout,
  chaveDeLayout,
  gravarPreferenciaDeLayout,
  lerPreferenciaDeLayout,
} from '@/lib/preferencias-locais'

// este arquivo semeia lixo ADVERSARIAL de propósito (JSON truncado, tipo
// adulterado): limpa a própria bagunça para que a auditoria global fiscalize o
// que a PRODUÇÃO grava, não o que um fixture plantou
afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('chaveDeLayout', () => {
  it('deve dar uma chave por usuário — o balcão compartilha a máquina', () => {
    // ARRANGE / ACT
    const daRecepcionista = chaveDeLayout(7)
    const daColega = chaveDeLayout(8)

    // ASSERT
    expect(daRecepcionista).not.toBe(daColega)
  })
})

describe('lerPreferenciaDeLayout', () => {
  it('deve devolver o padrão (tudo expandido) quando o usuário nunca escolheu', () => {
    // ARRANGE / ACT
    const preferencia = lerPreferenciaDeLayout(1)

    // ASSERT
    expect(preferencia).toEqual({})
  })

  it('deve devolver a preferência gravada', () => {
    // ARRANGE
    gravarPreferenciaDeLayout(1, { menu: true, filaAgenda: false })

    // ACT
    const preferencia = lerPreferenciaDeLayout(1)

    // ASSERT
    expect(preferencia).toEqual({ menu: true, filaAgenda: false })
  })

  it('deve cair no padrão quando o JSON está corrompido', () => {
    // ARRANGE
    window.localStorage.setItem(chaveDeLayout(1), '{"menu": tru')

    // ACT
    const preferencia = lerPreferenciaDeLayout(1)

    // ASSERT
    expect(preferencia).toEqual({})
  })

  it('deve cair no padrão quando o valor foi adulterado para outro tipo', () => {
    // ARRANGE — o DevTools escreve o que quiser nesta chave
    window.localStorage.setItem(chaveDeLayout(1), JSON.stringify({ menu: 'recolhido' }))

    // ACT
    const preferencia = lerPreferenciaDeLayout(1)

    // ASSERT
    expect(preferencia).toEqual({})
  })

  it('deve cair no padrão quando o valor não é sequer um objeto', () => {
    // ARRANGE: o DevTools escreve o que quiser — primitivo, lista, o que for
    window.localStorage.setItem(chaveDeLayout(1), JSON.stringify('recolhido'))
    window.localStorage.setItem(chaveDeLayout(2), JSON.stringify([true, false]))

    // ACT / ASSERT
    expect(lerPreferenciaDeLayout(1)).toEqual({})
    expect(lerPreferenciaDeLayout(2)).toEqual({})
  })

  it('deve preservar as escolhas válidas mesmo com campo desconhecido junto', () => {
    // ARRANGE: uma aba com a versão nova grava um painel que esta ainda não
    // conhece — descartar o objeto INTEIRO apagaria o que o usuário escolheu
    window.localStorage.setItem(
      chaveDeLayout(1),
      JSON.stringify({ menu: true, painelDoFuturo: true }),
    )

    // ACT
    const preferencia = lerPreferenciaDeLayout(1)

    // ASSERT
    expect(preferencia).toEqual({ menu: true })

    // o campo desconhecido é fixture: sai do disco aqui, senão a auditoria global
    // (que existe para pegar exatamente isso) reprovaria — com razão
    window.localStorage.clear()
  })

  it('deve cair no padrão quando o armazenamento lança (modo privativo)', () => {
    // ARRANGE
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('acesso negado', 'SecurityError')
    })

    // ACT
    const preferencia = lerPreferenciaDeLayout(1)

    // ASSERT — sem exceção escapando: nada de tela branca no balcão
    expect(preferencia).toEqual({})
  })
})

describe('gravarPreferenciaDeLayout', () => {
  it('deve engolir a falha de escrita e deixar a aplicação de pé', () => {
    // ARRANGE — cota estourada
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cota excedida', 'QuotaExceededError')
    })

    // ACT / ASSERT
    expect(() => {
      gravarPreferenciaDeLayout(1, { menu: true })
    }).not.toThrow()
  })

  it('deve gravar só estado de interface — nenhum dado de paciente (LGPD)', () => {
    // ARRANGE / ACT
    gravarPreferenciaDeLayout(1, { menu: true, filaAgenda: true })

    // ASSERT — o que está no disco é auditável a olho nu
    expect(window.localStorage.getItem(chaveDeLayout(1))).toBe('{"menu":true,"filaAgenda":true}')
  })

  it('deve descartar qualquer campo que não seja layout, mesmo passado à força', () => {
    // ARRANGE — o tipo sozinho não segura um `as`; o balcão é máquina
    // compartilhada e os pacientes são MENORES: nome nenhum vai ao disco
    const contrabando = {
      menu: true,
      encaixando: { paciente: { nome: 'Paciente Fictício' } },
    } as unknown as Parameters<typeof gravarPreferenciaDeLayout>[1]

    // ACT
    gravarPreferenciaDeLayout(1, contrabando)

    // ASSERT
    expect(window.localStorage.getItem(chaveDeLayout(1))).toBe('{"menu":true}')
  })

  it('deve recusar id de usuário que não seja um id', () => {
    // ARRANGE: a chave nasce do id — nunca de string arbitrária, que poderia
    // carregar o NOME de um menor para dentro do disco
    const naoEhId = Number.NaN

    // ACT
    gravarPreferenciaDeLayout(naoEhId, { menu: true })

    // ASSERT
    expect(window.localStorage.length).toBe(0)
  })
})

describe('alternarPreferenciaDeLayout', () => {
  it('deve somar a escolha à que já está no disco, não sobrescrevê-la', () => {
    // ARRANGE: os dois painéis dividem a chave; cada um tem sua cópia em memória
    gravarPreferenciaDeLayout(1, { menu: true })

    // ACT
    const preferencia = alternarPreferenciaDeLayout(1, 'filaAgenda')

    // ASSERT: o menu recolhido não evapora porque a fila foi recolhida depois
    expect(preferencia).toEqual({ menu: true, filaAgenda: true })
    expect(lerPreferenciaDeLayout(1)).toEqual({ menu: true, filaAgenda: true })
  })

  it('deve alternar de volta a partir do disco', () => {
    // ARRANGE
    gravarPreferenciaDeLayout(1, { menu: true, filaAgenda: true })

    // ACT
    const preferencia = alternarPreferenciaDeLayout(1, 'menu')

    // ASSERT
    expect(preferencia).toEqual({ menu: false, filaAgenda: true })
  })
})
