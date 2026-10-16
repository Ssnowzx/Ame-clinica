import { describe, expect, it } from 'vitest'

import {
  contarConfirmacoes,
  descreverConfirmacao,
  ESTADOS_DA_CONFIRMACAO,
  rotuloDaContagem,
} from '@/lib/confirmacao-do-lembrete'
import { cardFicticio } from '@/test/dados-agenda'

/** Um instante às 08:12 no relógio de QUEM RODA o teste — o mesmo relógio que a tela usa. */
const OITO_E_DOZE = new Date(2026, 6, 12, 8, 12).toISOString()

describe('descreverConfirmacao — o estado em palavras', () => {
  it('deve dizer que o lembrete saiu e ninguém respondeu', () => {
    // ARRANGE + ACT
    const texto = descreverConfirmacao({ estado: 'aguardando', em: null })

    // ASSERT
    expect(texto).toBe('Lembrete enviado, sem resposta da família')
  })

  it('deve dizer a hora em que a família confirmou', () => {
    // ARRANGE + ACT
    const texto = descreverConfirmacao({ estado: 'confirmado', em: OITO_E_DOZE })

    // ASSERT
    expect(texto).toBe('Confirmado pela família às 08:12')
  })

  it('deve confirmar sem hora quando o instante não é legível', () => {
    // ARRANGE + ACT — nunca "às Invalid Date"
    const texto = descreverConfirmacao({ estado: 'confirmado', em: 'ontem de manhã' })

    // ASSERT
    expect(texto).toBe('Confirmado pela família')
  })

  it('deve dizer que a família confirmou pelo botão quando o servidor diz por família', () => {
    // ARRANGE + ACT
    const texto = descreverConfirmacao({ estado: 'confirmado', em: OITO_E_DOZE, por: 'familia' })

    // ASSERT
    expect(texto).toBe('Confirmado pela família às 08:12')
  })

  it('deve dizer a hora em que a clínica confirmou pela família', () => {
    // ARRANGE + ACT — a família confirmou por telefone, e a recepção registrou (confirmacao-pela-clinica)
    const texto = descreverConfirmacao({ estado: 'confirmado', em: OITO_E_DOZE, por: 'clinica' })

    // ASSERT
    expect(texto).toBe('Confirmado pela clínica às 08:12')
  })

  it('deve dizer que a clínica confirmou mesmo sem hora legível', () => {
    // ARRANGE + ACT
    const texto = descreverConfirmacao({ estado: 'confirmado', em: null, por: 'clinica' })

    // ASSERT
    expect(texto).toBe('Confirmado pela clínica')
  })

  it('deve dizer que a família pediu para desmarcar', () => {
    // ARRANGE + ACT
    const texto = descreverConfirmacao({ estado: 'pediu_desmarque', em: OITO_E_DOZE })

    // ASSERT
    expect(texto).toBe('A família pediu para desmarcar')
  })

  it('deve mandar ligar quando o lembrete não foi entregue', () => {
    // ARRANGE + ACT
    const texto = descreverConfirmacao({ estado: 'nao_entregue', em: null })

    // ASSERT
    expect(texto).toBe('Lembrete não entregue — ligue para a família')
  })

  it('deve dizer por que o lembrete não saiu, com o motivo do servidor', () => {
    // ARRANGE + ACT — change telefone-que-chega-no-whatsapp: o motivo manda a recepção ao cadastro
    const texto = descreverConfirmacao({ estado: 'nao_enviado', em: null, motivo: 'telefone inválido no cadastro' })

    // ASSERT
    expect(texto).toBe('Lembrete não enviado: telefone inválido no cadastro')
  })

  it('deve dizer que o lembrete não saiu mesmo sem o motivo', () => {
    // ARRANGE + ACT — nunca "Lembrete não enviado: undefined"
    const texto = descreverConfirmacao({ estado: 'nao_enviado', em: null })

    // ASSERT
    expect(texto).toBe('Lembrete não enviado')
  })
})

describe('contarConfirmacoes — a faixa do topo', () => {
  it('deve contar cada estado e ignorar o cartão sem lembrete', () => {
    // ARRANGE — dois confirmados, um pedido, um sem lembrete (null) e um de payload antigo (ausente)
    const cards = [
      cardFicticio({ id: 1, confirmacao: { estado: 'confirmado', em: OITO_E_DOZE } }),
      cardFicticio({ id: 2, confirmacao: { estado: 'confirmado', em: OITO_E_DOZE } }),
      cardFicticio({ id: 3, confirmacao: { estado: 'pediu_desmarque', em: OITO_E_DOZE } }),
      cardFicticio({ id: 4, confirmacao: null }),
      cardFicticio({ id: 5 }),
      cardFicticio({ id: 6, confirmacao: { estado: 'nao_enviado', em: null, motivo: 'sem telefone no cadastro' } }),
    ]

    // ACT
    const contagem = contarConfirmacoes(cards)

    // ASSERT
    expect(contagem).toEqual({ confirmado: 2, aguardando: 0, pediu_desmarque: 1, nao_entregue: 0, nao_enviado: 1 })
  })

  it('deve manter a ordem da faixa do resolvido ao que pede ligação', () => {
    // ARRANGE + ACT + ASSERT
    expect(ESTADOS_DA_CONFIRMACAO).toEqual(['confirmado', 'aguardando', 'pediu_desmarque', 'nao_entregue', 'nao_enviado'])
  })
})

describe('rotuloDaContagem — o número concorda com a palavra', () => {
  it.each([
    ['confirmado', 1, '1 confirmado'],
    ['confirmado', 38, '38 confirmados'],
    ['aguardando', 1, '1 sem resposta'],
    ['aguardando', 6, '6 sem resposta'],
    ['pediu_desmarque', 1, '1 pediu para desmarcar'],
    ['pediu_desmarque', 2, '2 pediram para desmarcar'],
    ['nao_entregue', 1, '1 não entregue'],
    ['nao_entregue', 3, '3 não entregues'],
    ['nao_enviado', 1, '1 sem lembrete'],
    ['nao_enviado', 2, '2 sem lembrete'],
  ] as const)('deve escrever %s com %i como "%s"', (estado, quantidade, esperado) => {
    // ARRANGE + ACT
    const rotulo = rotuloDaContagem(estado, quantidade)

    // ASSERT
    expect(rotulo).toBe(esperado)
  })
})
