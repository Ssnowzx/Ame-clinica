import { describe, expect, it } from 'vitest'

import {
  avaliarAlvoDoArrasto,
  lerAlvoDoSlot,
  montarDataSlot,
  montarPayloadDeRemarcacao,
  type AlvoDeRemarcacao,
} from '@/lib/arrastar-remarcar'
import type { CardAgendamento } from '@/tipos'

function card(sobrescritas: Partial<CardAgendamento> = {}): CardAgendamento {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    tipo: 'atendimento',
    profissional_id: 1,
    paciente_id: 10,
    tratamento_id: 5,
    status_id: 1,
    inicio: '2026-07-13 08:00',
    fim: '2026-07-13 08:40',
    duracao_minutos: 40,
    is_reposicao: false,
    paciente: { id: 10, nome: 'Paciente Fictício', nome_social: null },
    especialidade: { id: 1, nome: 'Fonoaudiologia', cor: '#A85550' },
    status: { id: 1, nome: 'Em Aberto', cor: '#64748B', cor_borda: null, tipo: 'circle-dashed' },
    profissional: { id: 1, nome: 'Profissional Fictício A' },
    sala: null,
    tratamento_saldo: 9,
    tratamento_total: 12,
    tratamento_realce: 'nenhum' as const,
    convenio: { id: 1, nome: 'Convênio Fictício', particular: false },
    ...sobrescritas,
  }
}

const ALVO: AlvoDeRemarcacao = { profissionalId: 2, data: '2026-07-14', horario: '09:00' }

describe('avaliarAlvoDoArrasto — o que a UX não promete (D5)', () => {
  it('deve aceitar célula disponível em outra posição', () => {
    // ARRANGE + ACT
    const avaliacao = avaliarAlvoDoArrasto(card(), ALVO, false)

    // ASSERT
    expect(avaliacao).toEqual({ valido: true })
  })

  it('deve recusar a célula indisponível', () => {
    // ARRANGE + ACT: dia em que o profissional de destino não atende
    const avaliacao = avaliarAlvoDoArrasto(card(), ALVO, true)

    // ASSERT
    expect(avaliacao).toEqual({ valido: false, motivo: 'celula_indisponivel' })
  })

  it('deve recusar a mesma posição (soltar onde estava = cancelar)', () => {
    // ARRANGE: mesmo profissional, mesma data e hora do card
    const mesmaPosicao: AlvoDeRemarcacao = { profissionalId: 1, data: '2026-07-13', horario: '08:00' }

    // ACT
    const avaliacao = avaliarAlvoDoArrasto(card(), mesmaPosicao, false)

    // ASSERT
    expect(avaliacao).toEqual({ valido: false, motivo: 'mesma_posicao' })
  })

  it('deve aceitar o mesmo horário quando o profissional muda', () => {
    // ARRANGE: só troca a coluna — remarcação legítima na visão Dia/Geral
    const outraColuna: AlvoDeRemarcacao = { profissionalId: 2, data: '2026-07-13', horario: '08:00' }

    // ACT + ASSERT
    expect(avaliarAlvoDoArrasto(card(), outraColuna, false)).toEqual({ valido: true })
  })

  it('deve recusar o card de bloqueio, mesmo em célula válida', () => {
    // ARRANGE + ACT: bloqueio não é arrastável nesta versão (spec agenda-grade)
    const avaliacao = avaliarAlvoDoArrasto(card({ tipo: 'bloqueio' }), ALVO, false)

    // ASSERT
    expect(avaliacao).toEqual({ valido: false, motivo: 'bloqueio' })
  })
})

describe('montarPayloadDeRemarcacao — payload parcial (D2, corrigido ao vivo)', () => {
  it('deve enviar inicio E profissional_id mesmo quando o profissional não mudou', () => {
    // ARRANGE: mesmo profissional do card, outro horário — o contrato do PUT
    // exige profissional_id SEMPRE (Ana→Ana dava 422 sem ele)
    const alvo: AlvoDeRemarcacao = { profissionalId: 1, data: '2026-07-13', horario: '09:00' }

    // ACT
    const payload = montarPayloadDeRemarcacao(alvo)

    // ASSERT: o par obrigatório do alvo, e NADA além — a edição parcial preserva o resto
    expect(payload).toEqual({ inicio: '2026-07-13 09:00', profissional_id: 1 })
    expect(Object.keys(payload).sort()).toEqual(['inicio', 'profissional_id'])
  })

  it('deve levar o profissional do ALVO quando a coluna mudou', () => {
    // ARRANGE + ACT
    const payload = montarPayloadDeRemarcacao(ALVO)

    // ASSERT
    expect(payload).toEqual({ inicio: '2026-07-14 09:00', profissional_id: 2 })
  })

  it('deve levar aplicar_na_serie quando o usuário estendeu aos seguintes', () => {
    // ARRANGE + ACT
    const payload = montarPayloadDeRemarcacao(ALVO, true)

    // ASSERT
    expect(payload.aplicar_na_serie).toBe(true)
  })

  it('deve JAMAIS incluir paciente, especialidade ou qualquer vínculo', () => {
    // ARRANGE: o gesto só move tempo/profissional — trocar a criança tem outro
    // caminho (a palavra digitada CORRIGIR), fora do alcance do arrasto
    const proibidos = [
      'paciente_id',
      'especialidade_id',
      'tratamento_id',
      'sala_id',
      'equipamento_id',
      'medico_id',
      'status_id',
      'obs',
      'tipo',
      'duracao_minutos',
    ]

    // ACT: com e sem série, com e sem troca de profissional
    const payloads = [
      montarPayloadDeRemarcacao(ALVO),
      montarPayloadDeRemarcacao(ALVO, true),
      montarPayloadDeRemarcacao({ profissionalId: 1, data: '2026-07-13', horario: '09:00' }),
    ]

    // ASSERT
    for (const payload of payloads) {
      for (const campo of proibidos) {
        expect(payload).not.toHaveProperty(campo)
      }
    }
  })
})

describe('lerAlvoDoSlot — o DOM é entrada não confiável', () => {
  it('deve fazer round-trip com montarDataSlot', () => {
    // ARRANGE + ACT + ASSERT
    expect(lerAlvoDoSlot(montarDataSlot(ALVO))).toEqual(ALVO)
  })

  it('deve devolver null para atributo ausente ou malformado, sem lançar', () => {
    // ARRANGE: o que um DOM adulterado ou quebrado poderia entregar
    const lixos = [
      undefined,
      '',
      'banana',
      '0|2026-07-13|08:00', // profissional inválido
      'x|2026-07-13|08:00',
      '2|2026-02-30|08:00', // data inexistente
      '2|2026-07-13|25:00', // hora impossível
      '2|2026-07-13|8:00', // sem zero à esquerda
      '2|2026-07-13', // parte faltando
    ]

    // ACT + ASSERT
    for (const lixo of lixos) {
      expect(lerAlvoDoSlot(lixo)).toBeNull()
    }
  })
})
