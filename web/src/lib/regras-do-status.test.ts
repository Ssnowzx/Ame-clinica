import { describe, expect, it } from 'vitest'

import { consequenciasDaRegra, type ValoresDoStatus } from '@/lib/regras-do-status'
import type { StatusAgendamento } from '@/tipos'

function statusExistente(sobrescritas: Partial<StatusAgendamento> = {}): StatusAgendamento {
  return {
    id: 1,
    updated_at: '2026-07-15T10:00:00.000000Z',
    nome: 'Consulta',
    cor: '#3B82F6',
    cor_borda: null,
    tipo: 'stethoscope',
    desconta_sessao: false,
    ocupa_horario: true,
    marca_falta: false,
    marca_reserva: false,
    em_aberto: false,
    aplicavel_em_lote: false,
    ordem: 9,
    ...sobrescritas,
  }
}

function valores(sobrescritas: Partial<ValoresDoStatus> = {}): ValoresDoStatus {
  return {
    nome: 'Consulta',
    cor: '#3B82F6',
    cor_borda: '',
    desconta_sessao: false,
    ocupa_horario: true,
    marca_falta: false,
    marca_reserva: false,
    em_aberto: false,
    aplicavel_em_lote: false,
    tipo: 'stethoscope',
    ordem: '9',
    ...sobrescritas,
  }
}

describe('consequenciasDaRegra', () => {
  it('deve não pedir confirmação quando nenhuma regra mudou', () => {
    // ARRANGE: trocar a COR não é mudar regra — confirmação para tudo é ruído,
    // e ruído faz a recepção clicar em "confirmar" sem ler
    const original = statusExistente()

    // ACT
    const consequencias = consequenciasDaRegra(valores({ cor: '#FF0000' }), original)

    // ASSERT
    expect(consequencias).toEqual([])
  })

  it('deve dizer o que passa a acontecer ao LIGAR o consumo de sessão', () => {
    // ARRANGE
    const original = statusExistente({ desconta_sessao: false })

    // ACT
    const [consequencia] = consequenciasDaRegra(valores({ desconta_sessao: true }), original)

    // ASSERT
    expect(consequencia).toContain('passa a consumir uma sessão do tratamento')
    expect(consequencia).toContain('não mudam agora')
  })

  it('deve dizer a VERDADE INTEIRA ao DESLIGAR o consumo de sessão', () => {
    // ARRANGE: a versão óbvia ("não afeta o passado") MENTE — `reconciliar()` lê a
    // flag viva em toda mutação, então o próximo salvamento devolve a sessão; e se
    // o agendamento já foi faturado, ele fica INEDITÁVEL
    const original = statusExistente({ desconta_sessao: true })

    // ACT
    const [consequencia] = consequenciasDaRegra(valores({ desconta_sessao: false }), original)

    // ASSERT
    expect(consequencia).toContain('continuam descontadas')
    expect(consequencia).toContain('DEVOLVER a sessão')
    expect(consequencia).toContain('faturados não poderão ser editados')
    // e NÃO pode prometer congelamento do passado
    expect(consequencia).not.toContain('não afeta')
  })

  it('deve avisar que desligar "ocupa horário" abre o slot para dupla marcação', () => {
    // ARRANGE: o verificador de conflito só enxerga quem ocupa horário
    const original = statusExistente({ ocupa_horario: true })

    // ACT
    const [consequencia] = consequenciasDaRegra(valores({ ocupa_horario: false }), original)

    // ASSERT
    expect(consequencia).toContain('deixam de bloquear o horário')
    expect(consequencia).toContain('marcado de novo')
  })

  it('deve nomear o status na frase — nunca "este registro"', () => {
    // ARRANGE
    const original = statusExistente({ nome: 'Teleatendimento', ocupa_horario: true })

    // ACT
    const [consequencia] = consequenciasDaRegra(
      valores({ nome: 'Teleatendimento', ocupa_horario: false }),
      original,
    )

    // ASSERT
    expect(consequencia).toContain('"Teleatendimento"')
  })

  it('deve acumular uma frase por regra alterada', () => {
    // ARRANGE
    const original = statusExistente({ desconta_sessao: false, marca_falta: false })

    // ACT
    const consequencias = consequenciasDaRegra(
      valores({ desconta_sessao: true, marca_falta: true }),
      original,
    )

    // ASSERT
    expect(consequencias).toHaveLength(2)
  })

  it('deve confirmar só o que FOGE do padrão num status novo', () => {
    // ARRANGE: um status novo nasce ocupando horário e sem descontar — cadastrar
    // assim não é mudar regra nenhuma
    // ACT
    const semSurpresa = consequenciasDaRegra(valores({ nome: 'Novo' }))
    const descontante = consequenciasDaRegra(valores({ nome: 'Novo', desconta_sessao: true }))

    // ASSERT
    expect(semSurpresa).toEqual([])
    expect(descontante).toHaveLength(1)
  })
})

describe('consequenciasDaRegra — as flags do lote (baixa-em-lote-por-status)', () => {
  it('deve dizer que ligar "Em aberto" faz o status entrar na baixa em lote', () => {
    // ARRANGE
    const original = statusExistente({ em_aberto: false })

    // ACT
    const [consequencia] = consequenciasDaRegra(valores({ em_aberto: true }), original)

    // ASSERT
    expect(consequencia).toContain('entram na baixa em lote da agenda')
    expect(consequencia).toContain('"Consulta"')
  })

  it('deve dizer onde o status passa a aparecer ao ligar "Pode ser aplicado em lote"', () => {
    // ARRANGE
    const original = statusExistente({ aplicavel_em_lote: false })

    // ACT
    const [consequencia] = consequenciasDaRegra(valores({ aplicavel_em_lote: true }), original)

    // ASSERT
    expect(consequencia).toContain('opção no botão Dar baixa da agenda')
    expect(consequencia).toContain('toda a agenda em aberto de um profissional de uma vez')
  })

  it('deve dizer o efeito nos lembretes ao ligar "Marca reserva"', () => {
    // ARRANGE
    const original = statusExistente({ marca_reserva: false })

    // ACT
    const [consequencia] = consequenciasDaRegra(valores({ marca_reserva: true }), original)

    // ASSERT
    expect(consequencia).toContain('reserva de horário')
    expect(consequencia).toContain('só recebem lembrete quando a clínica pede')
  })

  it('não deve pedir confirmação quando as flags do lote não mudaram', () => {
    // ARRANGE
    const original = statusExistente({ em_aberto: true, aplicavel_em_lote: false })

    // ACT
    const consequencias = consequenciasDaRegra(valores({ em_aberto: true, aplicavel_em_lote: false }), original)

    // ASSERT
    expect(consequencias).toEqual([])
  })
})
