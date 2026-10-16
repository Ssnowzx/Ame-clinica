import { describe, expect, it } from 'vitest'

import {
  avisoDoTelefone,
  escolherPais,
  formaLegivel,
  lerTelefone,
  TEXTO_DO_CODIGO_INVALIDO,
  TEXTO_DO_INVALIDO,
  TEXTO_DO_QUE_PARECE_DE_FORA,
} from '@/lib/telefone-whatsapp'

/**
 * O número de outro país no aviso do campo (change telefone-estrangeiro, tarefa 1.3). A classificação
 * em si é conferida contra o servidor pelo teste de contrato; aqui mora o que é só da TELA: o texto
 * do aviso e a conferência do tamanho de cada país. Números do Reino Unido da faixa de ficção da
 * Ofcom (`+44 7700 900xxx`).
 */

describe('Telefone de outro país — a leitura', () => {
  it('deve dar ao número com + e código de fora a forma E.164, como celular', () => {
    // ARRANGE + ACT
    const leitura = lerTelefone('+44 7700 900123')

    // ASSERT — de fora não se sabe se é fixo: para o lembrete, é celular
    expect(leitura).toEqual({ forma: '+447700900123', tipo: 'celular' })
  })

  it('deve mostrar a forma estrangeira sem máscara, e a brasileira com a de sempre', () => {
    // ARRANGE / ACT / ASSERT
    expect(formaLegivel('+447700900123')).toBe('+447700900123')
    expect(formaLegivel('+5549991234567')).toBe('+55 (49) 99123-4567')
  })
})

describe('Telefone de outro país — o aviso', () => {
  it('deve dizer para onde vai o número do Reino Unido', () => {
    // ARRANGE + ACT
    const aviso = avisoDoTelefone('+44 7700 900123')

    // ASSERT — o cenário "Família com celular do Reino Unido" da spec
    expect(aviso).toEqual({ alerta: false, anunciar: false, perguntarSeRepete: true, texto: 'WhatsApp: +447700900123' })
  })

  it('deve pedir o + e o código do país ao número comprido demais sem o +', () => {
    // ARRANGE + ACT
    const aviso = avisoDoTelefone('447700900123')

    // ASSERT — o cenário "Sem o mais, continua brasileiro"
    expect(aviso).toEqual({ alerta: true, anunciar: true, perguntarSeRepete: false, texto: TEXTO_DO_QUE_PARECE_DE_FORA })
    expect(TEXTO_DO_QUE_PARECE_DE_FORA).toMatch(/\+ e o código/)
  })

  it.each([
    ['com o DDI e um dígito a menos (02/10)', '55 49912-3456'],
    // comprido como um número de fora, mas o 55 na frente diz que é brasileiro
    ['com o DDI e um dígito a mais', '55 11 98765-43210'],
  ])('deve manter o aviso brasileiro no número %s', (_caso, valor) => {
    // ARRANGE + ACT
    const aviso = avisoDoTelefone(valor)

    // ASSERT — não é "de outro país"
    expect(aviso?.texto).toBe(TEXTO_DO_INVALIDO)
  })

  it.each([
    ['dois a menos', '+44 7700 9001', 'Faltam 2 dígitos: um número do Reino Unido tem 10 depois do +44.'],
    ['um a menos', '+351 912 345 67', 'Falta 1 dígito: um número de Portugal tem 9 depois do +351.'],
    ['um a mais', '+44 7700 900123 4', 'Sobra 1 dígito: um número do Reino Unido tem 10 depois do +44.'],
    ['fora da faixa de dois tamanhos', '+54 9 11 2345 67890', 'Sobra 1 dígito: um número da Argentina tem 10 ou 11 depois do +54.'],
    ['fora da faixa de três tamanhos', '+64 2112 345', 'Falta 1 dígito: um número da Nova Zelândia tem de 8 a 10 depois do +64.'],
    ['o código sozinho', '+1', 'Faltam 10 dígitos: um número dos Estados Unidos tem 10 depois do +1.'],
  ])('deve avisar o tamanho errado para o país — %s', (_caso, valor, esperado) => {
    // ARRANGE + ACT
    const aviso = avisoDoTelefone(valor)

    // ASSERT
    expect(aviso).toEqual({ alerta: true, anunciar: true, perguntarSeRepete: false, texto: esperado })
  })

  it('deve pedir para tirar o 0 da ligação nacional depois do código', () => {
    // ARRANGE + ACT — `07700 …` é como o celular inglês se escreve lá dentro; com o +44, o 0 sobra
    const aviso = avisoDoTelefone('+44 07700 900123')

    // ASSERT
    expect(aviso?.texto).toBe('Tire o 0 do começo do número: com o +44 na frente, ele não entra.')
  })

  it('deve aceitar o 0 do fixo italiano, que faz parte do número', () => {
    // ARRANGE + ACT
    const aviso = avisoDoTelefone('+39 06 1234 5678')

    // ASSERT
    expect(aviso?.texto).toBe('WhatsApp: +390612345678')
  })

  it.each([
    ['o celular argentino, com o 9', '+54 9 11 2345 6789', 'WhatsApp: +5491123456789'],
    ['o fixo argentino', '+54 11 2345 6789', 'WhatsApp: +541123456789'],
  ])('deve aceitar os dois tamanhos do país — %s', (_caso, valor, esperado) => {
    // ARRANGE / ACT / ASSERT
    expect(avisoDoTelefone(valor)?.texto).toBe(esperado)
  })

  it('deve pedir o código e os dígitos ao + de um país fora da lista sem tamanho internacional', () => {
    // ARRANGE + ACT
    const aviso = avisoDoTelefone('+999 1234')

    // ASSERT
    expect(aviso).toEqual({ alerta: true, anunciar: true, perguntarSeRepete: false, texto: TEXTO_DO_CODIGO_INVALIDO })
  })

  it('deve aceitar o país fora da lista com tamanho internacional, sem conferir o tamanho dele', () => {
    // ARRANGE / ACT / ASSERT — 12 dígitos: não é também um número do Brasil
    expect(avisoDoTelefone('+999 1234 56789')?.texto).toBe('WhatsApp: +999123456789')
  })

  it('deve manter o número brasileiro com +55 exatamente como antes', () => {
    // ARRANGE / ACT / ASSERT
    expect(avisoDoTelefone('+55 11 98765-4321')?.texto).toBe('WhatsApp: +55 (11) 98765-4321')
    expect(avisoDoTelefone('+55 49912-3456')?.texto).toBe(TEXTO_DO_INVALIDO)
  })
})

describe('Telefone com + que também é do Brasil (gate r1)', () => {
  const ambiguo = (ddd: string): string =>
    `Este número também é um telefone do Brasil (DDD ${ddd}). Se for do Brasil, escolha Brasil no país do telefone.`

  it.each([
    ['o celular de São Paulo digitado com o +', '+11 98765-4321', '11'],
    // o tamanho dos EUA (falta um dígito) importa menos que dizer que ele é do Brasil
    ['o fixo de São Paulo digitado com o +', '+11 3333-4444', '11'],
    // ambíguo de verdade: 51 é o DDD de Porto Alegre, e o celular peruano tem a forma de um de lá
    ['o celular do Peru', '+51 912 345 678', '51'],
    // gate r2: o celular de 8 dígitos, de antes do nono dígito, que o `telefones:conferir-mais` lista —
    // de um código fora da lista (+21) e de um país da lista com esse tamanho (Noruega, +47)
    ['o celular antigo do Rio de Janeiro com o +', '+21 8765-4321', '21'],
    ['o celular antigo de Joinville com o + (que também tem o tamanho da Noruega)', '+47 8765-4321', '47'],
  ])('deve avisar %s', (_caso, valor, ddd) => {
    // ARRANGE + ACT
    const aviso = avisoDoTelefone(valor)

    // ASSERT — é aviso, não bloqueio: a forma continua a de fora, e o repetido continua conferido
    expect(aviso).toEqual({ alerta: true, anunciar: true, perguntarSeRepete: true, texto: ambiguo(ddd) })
  })

  it.each([
    // 56 não é DDD: a lista é a dos DDDs que existem, não "de 11 em diante"
    ['o celular do Chile', '+56 9 1234 5678', 'WhatsApp: +56912345678'],
    ['o celular do Reino Unido', '+44 7700 900123', 'WhatsApp: +447700900123'],
    // tem a forma do celular de 8 dígitos de antes do nono dígito (DDD 44): esse formato não existe mais
    ['o celular do Reino Unido com dígitos a menos', '+44 7700 9001', 'Faltam 2 dígitos: um número do Reino Unido tem 10 depois do +44.'],
  ])('não deve avisar como do Brasil %s', (_caso, valor, esperado) => {
    // ARRANGE / ACT / ASSERT
    expect(avisoDoTelefone(valor)?.texto).toBe(esperado)
  })

  it('deve tirar só o + ao escolher o Brasil no número ambíguo, e o código inteiro no de fora', () => {
    // ARRANGE / ACT / ASSERT
    expect(escolherPais('+11 98765-4321', 'BR')).toBe('11 98765-4321')
    expect(escolherPais('+44 7700 900123', 'BR')).toBe('7700 900123')
    expect(escolherPais('+11 98765-4321', 'PT')).toBe('+351 1 98765-4321')
  })

  it.each([
    // gate r2: tirar o "+1" comia o 1 do DDD, e tirar o "+47", o DDD inteiro
    ['+11 8765-4321', '11 8765-4321'],
    ['+21 8765-4321', '21 8765-4321'],
    ['+47 8765-4321', '47 8765-4321'],
  ])('deve guardar todos os dígitos do celular antigo %s ao escolher o Brasil', (valor, esperado) => {
    // ARRANGE + ACT
    const novo = escolherPais(valor, 'BR')

    // ASSERT
    expect(novo).toBe(esperado)
  })
})
