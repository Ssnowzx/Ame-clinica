import { describe, expect, it } from 'vitest'

import {
  ehCobravel,
  fraseDaUltimaCobranca,
  linkDoWhatsapp,
  preencherMensagemDeCobranca,
  telefoneLegivel,
} from '@/lib/cobranca-pelo-whatsapp'
import type { LancamentoCaixa } from '@/tipos'

/** Dados 100% fictícios. */
const VALORES = {
  '{responsavel}': 'Juliana',
  '{crianca}': 'Pedro',
  '{valor}': 'R$ 450,00',
  '{vencimento}': '10/10/2026',
  '{clinica}': 'Clínica Exemplo',
} as const

function lancamento(sobrescritas: Partial<LancamentoCaixa> = {}): LancamentoCaixa {
  return {
    id: 1,
    updated_at: '2026-09-25T10:00:00.000000Z',
    tipo: 'receita',
    competencia: '2026-10-01',
    vencimento: '2026-10-10',
    categoria_id: 1,
    subcategoria_id: null,
    valor: '450.00',
    juros: '0.00',
    multa: '0.00',
    desconto: '0.00',
    liquido: '450.00',
    tipo_pagamento_id: 1,
    conta_id: 1,
    contabil: true,
    documento: null,
    agendamento_id: null,
    grupo_parcelamento: null,
    parcela: null,
    parcelas_total: null,
    pago_em: null,
    interessado: { tipo: 'paciente', id: 10, nome: 'Criança Fictícia' },
    ...sobrescritas,
  }
}

describe('Cobrança pelo WhatsApp — a prévia da mensagem', () => {
  it('deve trocar cada marca conhecida pelo seu valor', () => {
    // ARRANGE
    const texto = 'Olá, {responsavel}! {crianca}: {valor} até {vencimento}. {clinica}'

    // ACT
    const previa = preencherMensagemDeCobranca(texto, VALORES)

    // ASSERT
    expect(previa).toBe('Olá, Juliana! Pedro: R$ 450,00 até 10/10/2026. Clínica Exemplo')
  })

  it('deve deixar a marca desconhecida crua, como a família a leria', () => {
    // ARRANGE — `{paciente}` no lugar de `{crianca}` é o erro que o servidor recusa ao salvar
    const texto = 'Olá, {responsavel}! {paciente} deve {valor}.'

    // ACT
    const previa = preencherMensagemDeCobranca(texto, VALORES)

    // ASSERT
    expect(previa).toBe('Olá, Juliana! {paciente} deve R$ 450,00.')
  })
})

describe('Cobrança pelo WhatsApp — o link de conversa', () => {
  it('deve montar o wa.me com o número e a mensagem codificada', () => {
    // ARRANGE — acento, espaço, "&" e quebra de linha quebrariam o link sem codificar
    const mensagem = 'Olá, Mãe & Pai!\nR$ 450,00'

    // ACT
    const link = linkDoWhatsapp('5549998765432', mensagem)

    // ASSERT
    expect(link).toBe(`https://wa.me/5549998765432?text=${encodeURIComponent(mensagem)}`)
    expect(new URL(link).searchParams.get('text')).toBe(mensagem)
  })
})

describe('Cobrança pelo WhatsApp — o que se exibe', () => {
  it.each([
    ['celular com nono dígito', '5549998765432', '+55 (49) 99876-5432'],
    ['fixo', '554933221100', '+55 (49) 3322-1100'],
    ['formato desconhecido', '12345', '12345'],
    // change telefone-estrangeiro: 12 dígitos, como o fixo brasileiro, e não é do Brasil
    ['celular de outro país (faixa fictícia da Ofcom)', '447700900123', '+447700900123'],
  ])('deve exibir o telefone legível — %s', (_caso, telefone, esperado) => {
    // ARRANGE + ACT
    const legivel = telefoneLegivel(telefone)

    // ASSERT
    expect(legivel).toBe(esperado)
  })

  it('deve dizer "aberta", com dia/mês e quem abriu', () => {
    // ARRANGE + ACT
    const frase = fraseDaUltimaCobranca({ em: '2026-09-24 14:10', por: 'Operadora Fictícia' })

    // ASSERT — o sistema sabe que a conversa abriu, não que a mensagem foi enviada
    expect(frase).toBe('Cobrança aberta em 24/09 por Operadora Fictícia')
    expect(frase).not.toMatch(/enviad/i)
  })

  it('deve omitir o nome quando quem cobrou não existe mais', () => {
    // ARRANGE + ACT
    const frase = fraseDaUltimaCobranca({ em: '2026-09-24 14:10', por: null })

    // ASSERT
    expect(frase).toBe('Cobrança aberta em 24/09')
  })
})

describe('Cobrança pelo WhatsApp — só receita em aberto de criança', () => {
  it('deve aceitar a receita em aberto de uma criança', () => {
    // ARRANGE + ACT + ASSERT
    expect(ehCobravel(lancamento())).toBe(true)
  })

  it.each([
    ['já paga', { pago_em: '2026-10-05 10:00' }],
    ['despesa', { tipo: 'despesa' as const }],
    ['de fornecedor', { interessado: { tipo: 'fornecedor' as const, id: 3, nome: 'Fornecedor Fictício' } }],
    ['sem interessado', { interessado: undefined }],
  ])('deve recusar o lançamento %s', (_caso, sobrescritas) => {
    // ARRANGE + ACT + ASSERT — a mesma régua do 422 do servidor
    expect(ehCobravel(lancamento(sobrescritas))).toBe(false)
  })
})
