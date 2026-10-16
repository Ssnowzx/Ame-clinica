import { describe, expect, it } from 'vitest'

import { avisoDeSaldo, cartaoDepoisDaTroca } from '@/lib/card-agendamento'
import { cardFicticio } from '@/test/dados-agenda'

/**
 * O AVISO DE SALDO NO CARD (change alerta-de-fim-de-pacote, achado da conferência ao vivo).
 *
 * A suíte inteira do realce roda no limiar 2 — o padrão do catálogo — e por isso nenhum teste
 * exercitava saldo 3, 4 ou 5. Era exatamente onde o texto mentia: o limiar virou dado (1–20) e
 * a frase continuou assumindo que só há dois degraus.
 */
describe('avisoDeSaldo — o card conta as sessões, não as adivinha', () => {
  it('deve anunciar a última sessão quando resta exatamente 1', () => {
    // ARRANGE / ACT
    const aviso = avisoDeSaldo(1)

    // ASSERT
    expect(aviso).toBe('Última sessão do tratamento')
  })

  it('deve CONTAR as sessões quando o limiar da clínica passa de 2', () => {
    /*
     * ARRANGE — limiar 5 na clínica, saldo 4: o realce acende (o servidor decidiu `acabando`) e
     * o card precisa dizer QUANTAS faltam. A frase antiga devolvia "Penúltima sessão do
     * tratamento" aqui, ao lado de "6/10 sessões" impresso no próprio card.
     */
    const saldo = 4

    // ACT
    const aviso = avisoDeSaldo(saldo)

    // ASSERT — o número do texto bate com o número do card
    expect(aviso).toBe('Faltam 4 sessões no tratamento')
    expect(aviso).not.toMatch(/Penúltima/)
  })

  it('deve contar também no limiar padrão, onde faltam 2', () => {
    // ARRANGE / ACT — o degrau que a redação antiga acertava por coincidência
    const aviso = avisoDeSaldo(2)

    // ASSERT
    expect(aviso).toBe('Faltam 2 sessões no tratamento')
  })

  it('deve anunciar a falta de saldo quando não há mais sessões', () => {
    // ARRANGE / ACT — `<= 0` e não `=== 0`: linha inconsistente não vira "ainda dá para atender"
    // ASSERT
    expect(avisoDeSaldo(0)).toBe('Tratamento sem saldo de sessões')
    expect(avisoDeSaldo(-1)).toBe('Tratamento sem saldo de sessões')
  })
})

describe('cartaoDepoisDaTroca — a foto do painel depois de trocar o status', () => {
  const PEDIU = cardFicticio({ confirmacao: { estado: 'pediu_desmarque', em: '2026-07-15T18:40:00-03:00' } })
  const RESPOSTA = { status_id: 4, updated_at: '2026-07-15T18:45:00.000000Z' }
  const ALVO = {
    id: 4,
    nome: 'Falta Justificada',
    cor: '#F59E0B',
    cor_borda: null,
    tipo: 'file-check',
    ordem: 4,
    desconta_sessao: false,
    marca_falta: false,
    aplicavel_em_lote: true,
  }

  it('deve manter a criança e o resto da foto, e trocar o status pelo escolhido', () => {
    // ARRANGE + ACT — a resposta da escrita só traz os escalares
    const depois = cartaoDepoisDaTroca(PEDIU, RESPOSTA, ALVO)

    // ASSERT
    expect(depois.paciente).toEqual(PEDIU.paciente)
    expect(depois.status_id).toBe(4)
    expect(depois.updated_at).toBe('2026-07-15T18:45:00.000000Z')
    expect(depois.status).toEqual({ id: 4, nome: 'Falta Justificada', cor: '#F59E0B', cor_borda: null, tipo: 'file-check' })
  })

  it('deve apagar a resposta ao lembrete quando o status novo não é de sessão marcada', () => {
    // ARRANGE + ACT
    const depois = cartaoDepoisDaTroca(PEDIU, RESPOSTA, { ...ALVO, sessao_marcada: false })

    // ASSERT
    expect(depois.confirmacao).toBeNull()
  })

  it('deve manter a resposta ao lembrete quando o status novo ainda é de sessão marcada ou não se sabe', () => {
    // ARRANGE + ACT
    const marcada = cartaoDepoisDaTroca(PEDIU, RESPOSTA, { ...ALVO, sessao_marcada: true })
    const semFlag = cartaoDepoisDaTroca(PEDIU, RESPOSTA, ALVO)

    // ASSERT — quem decide de verdade é a grade, na próxima busca
    expect(marcada.confirmacao).toEqual(PEDIU.confirmacao)
    expect(semFlag.confirmacao).toEqual(PEDIU.confirmacao)
  })
})
