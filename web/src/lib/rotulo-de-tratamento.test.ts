import { describe, expect, it } from 'vitest'

import { rotuloDoTratamento, rotuloDoTratamentoDoPagamento, type NomesDoTratamento } from '@/lib/rotulo-de-tratamento'
import type { TratamentoDaSelecao } from '@/tipos'

const ESPECIALIDADES = [
  { id: 1, nome: 'Fisioterapia ABA' },
  { id: 2, nome: 'Fonoaudiologia' },
]

function pacote(sobrescritas: Partial<TratamentoDaSelecao> = {}): TratamentoDaSelecao {
  return {
    id: 140,
    especialidade_id: 1,
    status: 'andamento',
    sessoes_total: 10,
    sessoes_saldo: 9, // 1 realizada de 10 — a leitura é a mesma do cartão na ficha da criança
    vencido: false,
    ...sobrescritas,
  }
}

describe('rótulo do pacote no campo Tratamento', () => {
  it('deve nomear a especialidade e omitir o identificador interno', () => {
    // ARRANGE: o caso do print da clínica — pacote único da especialidade
    const tratamento = pacote()

    // ACT
    const rotulo = rotuloDoTratamento(tratamento, ESPECIALIDADES, [tratamento])

    // ASSERT: REALIZADAS/total, como o card da grade, o painel e a ficha
    expect(rotulo).toBe('Fisioterapia ABA · 1/10 sessões')
  })

  it('deve dizer a situação do pacote junto do saldo', () => {
    // ARRANGE
    const tratamento = pacote({ status: 'finalizado', sessoes_saldo: 0, vencido: true })

    // ACT
    const rotulo = rotuloDoTratamento(tratamento, ESPECIALIDADES, [tratamento])

    // ASSERT: as dez foram feitas — e o pacote está fechado E vencido
    expect(rotulo).toBe('Fisioterapia ABA · 10/10 sessões · vencido · finalizado')
  })

  it('deve desempatar com o identificador quando dois pacotes ficariam iguais', () => {
    // ARRANGE: guia mensal do convênio produz pacote repetido da mesma especialidade
    const primeiro = pacote({ id: 140 })
    const segundo = pacote({ id: 139 })
    const todos = [primeiro, segundo]

    // ACT
    const rotulos = todos.map((item) => rotuloDoTratamento(item, ESPECIALIDADES, todos))

    // ASSERT: distinguíveis, e o código só neles
    expect(rotulos).toEqual([
      'Fisioterapia ABA · 1/10 sessões · #140',
      'Fisioterapia ABA · 1/10 sessões · #139',
    ])
  })

  it('deve não desempatar quem já se distingue pelo saldo', () => {
    // ARRANGE: mesma especialidade, saldos diferentes
    const cheio = pacote({ id: 140 })
    const gasto = pacote({ id: 139, sessoes_saldo: 3 })
    const todos = [cheio, gasto]

    // ACT
    const rotulos = todos.map((item) => rotuloDoTratamento(item, ESPECIALIDADES, todos))

    // ASSERT: nenhum código na tela do caso comum
    expect(rotulos).toEqual(['Fisioterapia ABA · 1/10 sessões', 'Fisioterapia ABA · 7/10 sessões'])
  })

  it('deve não desempatar pacotes de especialidades diferentes', () => {
    // ARRANGE: mesmo saldo, especialidades distintas — o nome já separa
    const fisio = pacote({ id: 140, especialidade_id: 1 })
    const fono = pacote({ id: 139, especialidade_id: 2 })
    const todos = [fisio, fono]

    // ACT
    const rotulos = todos.map((item) => rotuloDoTratamento(item, ESPECIALIDADES, todos))

    // ASSERT
    expect(rotulos).toEqual(['Fisioterapia ABA · 1/10 sessões', 'Fonoaudiologia · 1/10 sessões'])
  })

  it('deve cair no identificador interno quando o catálogo não tem a especialidade', () => {
    // ARRANGE: catálogo ainda carregando — a opção não pode ficar sem nome
    const tratamento = pacote()

    // ACT
    const rotulo = rotuloDoTratamento(tratamento, [], [tratamento])

    // ASSERT: é o rótulo de antes da change, nunca um rótulo vazio
    expect(rotulo).toBe('#140 · 1/10 sessões')
  })
})

describe('rótulo do pacote no lançamento de caixa', () => {
  const NOMES: NomesDoTratamento = {
    especialidades: ESPECIALIDADES,
    profissionais: [
      { id: 5, nome: 'Profissional Fictícia Ana' },
      { id: 6, nome: 'Profissional Fictício Bruno' },
    ],
    convenios: [
      { id: 3, nome: 'Particular' },
      { id: 4, nome: 'Convênio Fictício' },
    ],
  }

  function pacoteDoCaixa(sobrescritas: Partial<TratamentoDaSelecao & { profissional_id: number; convenio_id: number }> = {}) {
    return { ...pacote(), profissional_id: 5, convenio_id: 3, ...sobrescritas }
  }

  it('deve nomear especialidade, profissional e convênio, nesta ordem, antes do saldo', () => {
    // ARRANGE — é por este rótulo que a recepção liga o pagamento ao profissional
    const tratamento = pacoteDoCaixa()

    // ACT
    const rotulo = rotuloDoTratamentoDoPagamento(tratamento, NOMES, [tratamento])

    // ASSERT
    expect(rotulo).toBe('Fisioterapia ABA · Profissional Fictícia Ana · Particular · 1/10 sessões')
  })

  it('deve separar pela profissional o que na agenda empataria', () => {
    // ARRANGE — mesma especialidade e saldo, duas terapeutas: na agenda seria #id; aqui, o nome
    const daAna = pacoteDoCaixa({ id: 140 })
    const doBruno = pacoteDoCaixa({ id: 139, profissional_id: 6 })
    const todos = [daAna, doBruno]

    // ACT
    const rotulos = todos.map((item) => rotuloDoTratamentoDoPagamento(item, NOMES, todos))

    // ASSERT
    expect(rotulos).toEqual([
      'Fisioterapia ABA · Profissional Fictícia Ana · Particular · 1/10 sessões',
      'Fisioterapia ABA · Profissional Fictício Bruno · Particular · 1/10 sessões',
    ])
  })

  it('deve omitir o nome cujo catálogo não chegou, em vez de inventá-lo', () => {
    // ARRANGE — sem `convenios.ver`, o convênio da criança não é dito
    const tratamento = pacoteDoCaixa()

    // ACT
    const rotulo = rotuloDoTratamentoDoPagamento(tratamento, { ...NOMES, convenios: [] }, [tratamento])

    // ASSERT
    expect(rotulo).toBe('Fisioterapia ABA · Profissional Fictícia Ana · 1/10 sessões')
  })

  it('deve desempatar com o identificador quando tudo o mais é igual', () => {
    // ARRANGE — o pacote mensal repetido, mesma terapeuta e mesmo convênio
    const setembro = pacoteDoCaixa({ id: 140 })
    const agosto = pacoteDoCaixa({ id: 139 })
    const todos = [setembro, agosto]

    // ACT
    const rotulos = todos.map((item) => rotuloDoTratamentoDoPagamento(item, NOMES, todos))

    // ASSERT
    expect(rotulos).toEqual([
      'Fisioterapia ABA · Profissional Fictícia Ana · Particular · 1/10 sessões · #140',
      'Fisioterapia ABA · Profissional Fictícia Ana · Particular · 1/10 sessões · #139',
    ])
  })
})
