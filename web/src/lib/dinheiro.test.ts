import { describe, expect, it } from 'vitest'

import { formatarBRL, formatarPercentual, paraDecimalDaApi, somarDecimais } from '@/lib/dinheiro'

/**
 * GUARDA DO CENTAVO — "o valor do servidor, exibido sem passar por float".
 *
 * O atalho tentador é `Number('1234.50').toLocaleString('pt-BR', ...)`. Para a
 * maioria dos valores funciona; para os que caem no erro binário do ponto
 * flutuante, um centavo aparece ou some — e num recibo com CPF isso é um documento
 * errado. O sinal aqui é o valor com 2 casas exatas: a formatação tem de preservá-lo
 * byte a byte.
 */
describe('formatarBRL — string decimal exibida sem perder centavo', () => {
  it('deve agrupar milhares e usar vírgula decimal', () => {
    // ARRANGE
    const valor = '1234.50'

    // ACT
    const formatado = formatarBRL(valor)

    // ASSERT
    expect(formatado).toBe('R$ 1.234,50')
  })

  it('deve preservar os centavos exatos (sem arredondar por float)', () => {
    // ARRANGE — valor clássico onde 0.1 + 0.2 em float erra
    const valor = '0.30'

    // ACT
    const formatado = formatarBRL(valor)

    // ASSERT
    expect(formatado).toBe('R$ 0,30')
  })

  it('deve formatar milhão com dois pontos de milhar', () => {
    // ARRANGE
    const valor = '1234567.89'

    // ACT
    const formatado = formatarBRL(valor)

    // ASSERT
    expect(formatado).toBe('R$ 1.234.567,89')
  })

  it('deve exibir o sinal negativo (saldo do período no vermelho)', () => {
    // ARRANGE
    const valor = '-250.00'

    // ACT
    const formatado = formatarBRL(valor)

    // ASSERT
    expect(formatado).toBe('-R$ 250,00')
  })

  it('deve tratar −0,00 como 0,00 (sem sinal fantasma)', () => {
    // ARRANGE
    const valor = '-0.00'

    // ACT
    const formatado = formatarBRL(valor)

    // ASSERT
    expect(formatado).toBe('R$ 0,00')
  })

  it('deve completar casas quando o servidor manda menos de duas', () => {
    // ARRANGE
    const valor = '10.5'

    // ACT
    const formatado = formatarBRL(valor)

    // ASSERT
    expect(formatado).toBe('R$ 10,50')
  })
})

describe('paraDecimalDaApi — a entrada do usuário vira o decimal da API', () => {
  it('deve converter a forma pt-BR (ponto de milhar + vírgula) para ponto decimal', () => {
    // ARRANGE
    const entrada = '1.234,50'

    // ACT
    const decimal = paraDecimalDaApi(entrada)

    // ASSERT
    expect(decimal).toBe('1234.50')
  })

  it('deve aceitar a vírgula como separador decimal simples', () => {
    // ARRANGE
    const entrada = '1234,5'

    // ACT
    const decimal = paraDecimalDaApi(entrada)

    // ASSERT
    expect(decimal).toBe('1234.5')
  })

  it('deve deixar o ponto decimal como está', () => {
    // ARRANGE
    const entrada = '1234.50'

    // ACT
    const decimal = paraDecimalDaApi(entrada)

    // ASSERT
    expect(decimal).toBe('1234.50')
  })

  it('deve manter vazio como vazio (a API valida o formato final)', () => {
    // ARRANGE
    const entrada = '   '

    // ACT
    const decimal = paraDecimalDaApi(entrada)

    // ASSERT
    expect(decimal).toBe('')
  })
})

/**
 * GUARDA DA SOMA — a cauda "Outras (+N)" de uma quebra por categoria é o único
 * total que a TELA calcula.
 *
 * **Condição medida:** a mutação para `reduce(Number).toFixed(2)` NÃO derruba os
 * casos de valor realista — o `toFixed` arredonda por cima do erro binário. Os dois
 * últimos testes são os que realmente distinguem as implementações, e cada um diz em
 * que condição vale.
 */
describe('somarDecimais — soma em centavos inteiros, nunca em float', () => {
  it('deve somar sem o erro binário do ponto flutuante', () => {
    // ARRANGE — 0.1 + 0.2 em float dá 0.30000000000000004
    const valores = ['0.10', '0.20']

    // ACT
    const total = somarDecimais(valores)

    // ASSERT
    expect(total).toBe('0.30')
  })

  it('deve somar uma cauda longa de centavos sem perder um centavo', () => {
    // ARRANGE — 10 valores de 0,07: em float o acumulado desvia
    const valores = Array.from({ length: 10 }, () => '0.07')

    // ACT
    const total = somarDecimais(valores)

    // ASSERT
    expect(total).toBe('0.70')
  })

  it('deve somar valores grandes com centavos preservando as duas casas', () => {
    // ARRANGE
    const valores = ['1234.56', '8765.44', '0.01']

    // ACT
    const total = somarDecimais(valores)

    // ASSERT
    expect(total).toBe('10000.01')
  })

  it('deve tratar negativo e devolver zero para lista vazia', () => {
    // ARRANGE
    const comNegativo = ['100.00', '-30.50']

    // ACT
    const total = somarDecimais(comNegativo)
    const vazio = somarDecimais([])

    // ASSERT
    expect(total).toBe('69.50')
    expect(vazio).toBe('0.00')
  })
})

describe('somarDecimais — os dois pontos em que float DIVERGE de centavo inteiro', () => {
  it('deve truncar a terceira casa como o servidor, não arredondar como toFixed', () => {
    // ARRANGE — o servidor manda 2 casas; se um dia vier uma 3ª, `bcadd(x,'0',2)`
    // TRUNCA e `toFixed(2)` ARREDONDARIA para cima
    const comTerceiraCasa = ['0.005']

    // ACT
    const total = somarDecimais(comTerceiraCasa)

    // ASSERT — trunca ("0.00"); o float daria "0.01"
    expect(total).toBe('0.00')
  })

  it('deve manter o centavo acima de 2^53 centavos, onde o float já o perdeu', () => {
    // ARRANGE — ~R$ 82 trilhões: FORA da escala desta clínica, medido aqui só
    // porque é a premissa que ninguém revisita. Em float o total sai ...91
    const acimaDoSeguro = ['81985529216486.89', '0.01']

    // ACT
    const total = somarDecimais(acimaDoSeguro)

    // ASSERT
    expect(total).toBe('81985529216486.90')
  })
})

describe('somarDecimais — não quebra a tela com lixo do servidor', () => {
  it('deve tratar como zero o que não tem dígito, em vez de lançar', () => {
    // ARRANGE — o tipo diz `string`, mas nada valida a resposta da API em runtime;
    // `null`/`undefined` chegando aqui quebravam a tela com "valor.trim is not a
    // function" (achado SEC-GF-03). O contrato é: sem dígito, vale zero.
    const semDigito = [null, undefined, '', 'abc', '.', '-'] as unknown as string[]

    // ACT
    const total = somarDecimais(semDigito)

    // ASSERT
    expect(total).toBe('0.00')
  })

  it('deve coagir número ao seu próprio decimal, não zerá-lo', () => {
    // ARRANGE — número não é lixo: `123.45` tem valor. Zerá-lo seria PERDER dinheiro
    // em silêncio, pior que quebrar. O contrato é coagir, não descartar.
    const numerico = [123.45, 10] as unknown as string[]

    // ACT
    const total = somarDecimais(numerico)

    // ASSERT
    expect(total).toBe('133.45')
  })

  it('deve somar os valores válidos ignorando o lixo no meio', () => {
    // ARRANGE
    const misturado = ['10.50', null, '20.25'] as unknown as string[]

    // ACT
    const total = somarDecimais(misturado)

    // ASSERT
    expect(total).toBe('30.75')
  })
})

/**
 * GUARDA CONTRA DINHEIRO INVENTADO — o achado mais sério do gate nesta família.
 *
 * A versão anterior extraía os DÍGITOS da string. O JavaScript imprime número muito
 * pequeno ou muito grande em notação científica, então `0.0000001` virava `"1e-7"`,
 * cujos dígitos são 1 e 7 — e a tela mostrava **R$ 17,00**. Zerar já seria ruim;
 * inventar é pior, porque o número parece plausível.
 */
describe('dinheiro — o que não tem forma de decimal NÃO vira valor', () => {
  it('deve zerar notação científica em vez de inventar reais', () => {
    // ARRANGE — o que `String()` produz para número pequeno/grande
    const cientificas = ['1e-7', '1e+21', '1e3']

    // ACT + ASSERT — cada uma sozinha, para o total não mascarar
    expect(somarDecimais(['1e-7'])).toBe('0.00')
    expect(somarDecimais(['1e+21'])).toBe('0.00')
    expect(somarDecimais(['1e3'])).toBe('0.00')
    expect(somarDecimais(cientificas)).toBe('0.00')
  })

  it('deve zerar no formatador o que zeraria na soma', () => {
    // ARRANGE — `formatarBRL` roda dezenas de vezes por tela financeira
    // ACT + ASSERT
    expect(formatarBRL('1e-7')).toBe('R$ 0,00')
    expect(formatarBRL('abc')).toBe('R$ 0,00')
    expect(formatarBRL(null as unknown as string)).toBe('R$ 0,00')
    expect(formatarBRL(undefined as unknown as string)).toBe('R$ 0,00')
  })

  it('deve continuar formatando o decimal legítimo, byte a byte', () => {
    // ARRANGE — a guarda não pode estreitar o que já funcionava
    // ACT + ASSERT
    expect(formatarBRL('1234.50')).toBe('R$ 1.234,50')
    expect(formatarBRL('-30.05')).toBe('-R$ 30,05')
    expect(formatarBRL('0.00')).toBe('R$ 0,00')
    expect(formatarBRL('0')).toBe('R$ 0,00')
    expect(formatarBRL('81985529216486.89')).toBe('R$ 81.985.529.216.486,89')
  })

  it('deve deixar o percentual vazio quando a forma não é decimal', () => {
    // ARRANGE + ACT + ASSERT
    expect(formatarPercentual('2.99')).toBe('2,99%')
    expect(formatarPercentual('1e-7')).toBe('')
    expect(formatarPercentual('')).toBe('')
  })
})
