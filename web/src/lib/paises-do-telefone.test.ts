import { describe, expect, it } from 'vitest'

import {
  bandeira,
  comecaComMais,
  digitarNoNumero,
  numeroSemCodigo,
  OUTRO_PAIS,
  OUTROS_PAISES,
  PAISES_PROVAVEIS,
  paisAoReler,
  paisDoValor,
  paisPelaSigla,
  trocarDePais,
} from '@/lib/paises-do-telefone'

/**
 * O país do telefone (change telefone-estrangeiro, tarefa 1.3b). Números 100% fictícios: os do Reino
 * Unido são da faixa `+44 7700 900xxx`, que a Ofcom reserva para ficção; os brasileiros, os de sempre
 * dos testes desta casa.
 */

const TODOS = [...PAISES_PROVAVEIS, ...OUTROS_PAISES]

describe('Países do telefone — a lista', () => {
  it('deve pôr os prováveis no topo, na ordem combinada, começando pelo Brasil', () => {
    // ARRANGE + ACT
    const nomes = PAISES_PROVAVEIS.map((pais) => pais.nome)

    // ASSERT
    expect(nomes).toEqual([
      'Brasil',
      'Portugal',
      'Estados Unidos',
      'Reino Unido',
      'Argentina',
      'Paraguai',
      'Uruguai',
      'Espanha',
      'Itália',
      'Alemanha',
      'França',
      'Japão',
      'Canadá',
    ])
  })

  it('deve manter o resto em ordem alfabética do português', () => {
    // ARRANGE — quem acrescenta um país no fim da lista quebra a busca de olho
    const nomes = OUTROS_PAISES.map((pais) => pais.nome)

    // ACT
    const ordenados = [...nomes].sort(new Intl.Collator('pt-BR').compare)

    // ASSERT
    expect(nomes).toEqual(ordenados)
  })

  it('deve ter cada país uma vez só, e só o +1 repetido (Estados Unidos e Canadá)', () => {
    // ARRANGE + ACT
    const siglas = TODOS.map((pais) => pais.sigla)
    const repetidos = TODOS.filter((pais, indice) => TODOS.findIndex((outro) => outro.codigo === pais.codigo) !== indice)

    // ASSERT
    expect(new Set(siglas).size).toBe(siglas.length)
    expect(repetidos.map((pais) => pais.sigla)).toEqual(['CA'])
  })

  it('deve esperar de cada país um tamanho que sempre tem forma E.164 (8 a 15 dígitos com o código)', () => {
    // ARRANGE + ACT — um tamanho fora disso faria o campo pedir um número que o servidor recusa
    const foraDoE164 = TODOS.filter(
      ({ codigo, digitos: [minimo, maximo] }) => minimo > maximo || codigo.length + minimo < 8 || codigo.length + maximo > 15,
    )

    // ASSERT
    expect(foraDoE164).toEqual([])
  })

  it('deve desenhar a bandeira pelos indicadores regionais da sigla', () => {
    // ARRANGE / ACT / ASSERT
    expect(bandeira('GB')).toBe('🇬🇧')
    expect(bandeira('BR')).toBe('🇧🇷')
  })
})

describe('Países do telefone — o país de um valor gravado', () => {
  it.each([
    ['o celular de sempre', '(11) 98765-4321'],
    ['o vazio', ''],
    ['o +55', '+55 11 98765-4321'],
    // sem o `+` o servidor lê como brasileiro (e recusa): adivinhar o país mandaria o lembrete
    // para outra pessoa
    ['o número de fora sem o +', '447700900123'],
  ])('deve abrir no Brasil %s', (_caso, valor) => {
    // ARRANGE + ACT
    const sigla = paisDoValor(valor)

    // ASSERT
    expect(sigla).toBe('BR')
  })

  it.each([
    ['+44 7700 900123', 'GB'],
    ['+447700900123', 'GB'],
    ['+351 912 345 678', 'PT'],
    ['+598 9123 4567', 'UY'],
    // o +1 é dos dois; o primeiro da lista vence
    ['+1 202 555 0143', 'US'],
    ['+999 1234 5678', OUTRO_PAIS],
    ['+', OUTRO_PAIS],
  ])('deve achar pelo código o país de %s', (valor, esperado) => {
    // ARRANGE + ACT
    const sigla = paisDoValor(valor)

    // ASSERT
    expect(sigla).toBe(esperado)
  })

  it.each([
    ['o Canadá escolhido com o +1', '+1 204 555 0143', 'CA', 'CA'],
    ['os EUA escolhidos com o +1', '+1 202 555 0143', 'US', 'US'],
    ['o Brasil com o +1 digitado', '+1 202 555 0143', 'BR', 'US'],
    ['o Canadá com o +44 digitado', '+44 7700 900123', 'CA', 'GB'],
  ])('deve reler ao sair do campo %s', (_caso, valor, atual, esperado) => {
    // ARRANGE + ACT — gate r1: o escolhido fica quando o código dele é o do valor
    const sigla = paisAoReler(valor, atual)

    // ASSERT
    expect(sigla).toBe(esperado)
  })

  it('deve ler o + como o servidor: o trim do PHP não tira o espaço inquebrável', () => {
    // ARRANGE / ACT / ASSERT — `trim()` do JavaScript tiraria, e a tela diria "Reino Unido" a um
    // número que o servidor lê como brasileiro
    expect(comecaComMais(' \t+44 7700 900123')).toBe(true)
    expect(comecaComMais('\u00A0+44 7700 900123')).toBe(false)
    expect(paisDoValor('\u00A0+44 7700 900123')).toBe('BR')
  })

  it('deve ler o + do número colado do WhatsApp, embrulhado em marcas de direção', () => {
    // ARRANGE — gate r1: o WhatsApp entrega `\u202A+44 …\u202C`, e o + deixava de ser o primeiro
    const colado = '\u202A+44 7700 900123\u202C'

    // ACT / ASSERT — o país e o número sem as marcas, que não se veem
    expect(paisDoValor(colado)).toBe('GB')
    expect(numeroSemCodigo(colado, 'GB')).toBe('7700 900123')
    expect(paisDoValor(' \u2066+351 912 345 678\u2069')).toBe('PT')
  })
})

describe('Países do telefone — o número e o código', () => {
  it.each([
    ['+44 7700 900123', 'GB', '7700 900123'],
    ['+447700900123', 'GB', '7700900123'],
    [' +44 (0)7700 900123', 'GB', '(0)7700 900123'],
    ['(11) 98765-4321', 'BR', '(11) 98765-4321'],
    ['+55 11 98765-4321', 'BR', '+55 11 98765-4321'],
    ['+999 1234', OUTRO_PAIS, '+999 1234'],
    // o código não é o do país escolhido: nada some
    ['+351 912 345 678', 'GB', '+351 912 345 678'],
  ])('deve mostrar no campo do número %s como "%s" → %s', (valor, sigla, esperado) => {
    // ARRANGE + ACT
    const numero = numeroSemCodigo(valor, sigla)

    // ASSERT
    expect(numero).toBe(esperado)
  })

  it('deve gravar o número de cada país da lista com o código, e mostrá-lo de volta sem ele', () => {
    // ARRANGE + ACT
    const idas = TODOS.filter((pais) => pais.sigla !== 'BR').map((pais) => {
      const { valor } = digitarNoNumero(pais.sigla, '912 345')
      return { sigla: pais.sigla, valor, volta: numeroSemCodigo(valor, pais.sigla) }
    })

    // ASSERT
    expect(idas.filter(({ sigla, valor, volta }) => valor !== `+${paisPelaSigla(sigla)?.codigo ?? ''} 912 345` || volta !== '912 345')).toEqual([])
  })

  it.each([
    ['BR', '(11) 98765-4321', { sigla: 'BR', valor: '(11) 98765-4321' }],
    ['GB', '7700 900123', { sigla: 'GB', valor: '+44 7700 900123' }],
    ['GB', '', { sigla: 'GB', valor: '' }],
    // o `+` digitado com um país escolhido é o código digitado à mão: nada de `+44 +44 …`
    ['GB', '+44 7700 900123', { sigla: OUTRO_PAIS, valor: '+44 7700 900123' }],
    // em "Outro país" o `+` entra sozinho — sem ele o número seria lido como brasileiro
    [OUTRO_PAIS, '999 1234 5678', { sigla: OUTRO_PAIS, valor: '+999 1234 5678' }],
    [OUTRO_PAIS, '+999 1234', { sigla: OUTRO_PAIS, valor: '+999 1234' }],
    [OUTRO_PAIS, '', { sigla: OUTRO_PAIS, valor: '' }],
  ])('deve gravar a digitação no país "%s": %s', (sigla, texto, esperado) => {
    // ARRANGE + ACT
    const digitacao = digitarNoNumero(sigla, texto)

    // ASSERT
    expect(digitacao).toEqual(esperado)
  })

  it.each([
    ['7700 900123', 'GB', '+44 7700 900123'],
    ['+44 7700 900123', 'BR', '7700 900123'],
    ['+44 7700 900123', 'PT', '+351 7700 900123'],
    ['+44 7700 900123', OUTRO_PAIS, '+44 7700 900123'],
    ['', 'GB', ''],
    ['+999 123', 'GB', '+44 999 123'],
    // o código digitado sem o `+`, que o aviso manda trocar pela escolha do país: não fica duas vezes
    ['447700900123', 'GB', '+44 7700900123'],
    ['44 7700 900123', 'GB', '+44 7700 900123'],
    // um celular italiano que começa por 39: sem o 39 sobrariam 8 dígitos, então o 39 é do número
    ['391 234 5678', 'IT', '+39 391 234 5678'],
    // na Nova Zelândia (8 a 10 dígitos) as duas leituras cabem: nada se adivinha
    ['6421123456', 'NZ', '+64 6421123456'],
  ])('deve levar %s para o país "%s" como %s', (valor, para, esperado) => {
    // ARRANGE + ACT
    const novo = trocarDePais(valor, para)

    // ASSERT
    expect(novo).toBe(esperado)
  })
})
