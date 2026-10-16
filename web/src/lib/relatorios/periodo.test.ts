import { describe, expect, it } from 'vitest'

import {
  diasDoPeriodo,
  periodoDoAtalho,
  periodoDoEnvelope,
  TETO_DE_DIAS_DO_PERIODO,
  validarPeriodo,
} from '@/lib/relatorios/periodo'
import { envelopeFicticio } from '@/test/dados-relatorios'

describe('Atalhos de período — a partir de HOJE na clínica', () => {
  it('deve fazer de "este ano" o ano civil inteiro, e caber no teto até no bissexto', () => {
    // ACT — o DRE lê o ano mês a mês
    const periodo = periodoDoAtalho('este-ano', '2028-09-25')

    // ASSERT — 366 dias em 2028: ainda dentro do teto do servidor
    expect(periodo).toEqual({ de: '2028-01-01', ate: '2028-12-31' })
    expect(validarPeriodo(periodo.de, periodo.ate)).toEqual({ valido: true })
  })

  it('deve fazer de "hoje" um período de um dia só, o dia da clínica', () => {
    // ACT — o fechamento de caixa confere a gaveta do dia
    const periodo = periodoDoAtalho('hoje', '2026-09-03')

    // ASSERT
    expect(periodo).toEqual({ de: '2026-09-03', ate: '2026-09-03' })
  })

  it('deve preencher "mês passado" com o primeiro e o último dia do mês anterior', () => {
    // ARRANGE — hoje é 3 de setembro; agosto tem 31 dias
    const hoje = '2026-09-03'

    // ACT
    const periodo = periodoDoAtalho('mes-passado', hoje)

    // ASSERT
    expect(periodo).toEqual({ de: '2026-08-01', ate: '2026-08-31' })
  })

  it('deve cruzar o ano em "mês passado" quando hoje é janeiro', () => {
    // ACT
    const periodo = periodoDoAtalho('mes-passado', '2027-01-15')

    // ASSERT
    expect(periodo).toEqual({ de: '2026-12-01', ate: '2026-12-31' })
  })

  it('deve preencher "este mês" com o mês inteiro, e fevereiro bissexto com 29', () => {
    // ACT + ASSERT
    expect(periodoDoAtalho('este-mes', '2026-09-03')).toEqual({ de: '2026-09-01', ate: '2026-09-30' })
    expect(periodoDoAtalho('este-mes', '2028-02-10')).toEqual({ de: '2028-02-01', ate: '2028-02-29' })
  })

  it('deve contar hoje entre os "últimos 30 dias" e os "últimos 90 dias"', () => {
    // ACT
    const trinta = periodoDoAtalho('ultimos-30-dias', '2026-09-03')
    const noventa = periodoDoAtalho('ultimos-90-dias', '2026-09-03')

    // ASSERT — as duas pontas contam
    expect(trinta).toEqual({ de: '2026-08-05', ate: '2026-09-03' })
    expect(diasDoPeriodo(trinta)).toBe(30)
    expect(diasDoPeriodo(noventa)).toBe(90)
  })
})

describe('Validação do período — a razão em texto', () => {
  it('deve recusar período ausente ou fora do calendário', () => {
    // ACT + ASSERT
    expect(validarPeriodo('', '2026-06-30')).toEqual({ valido: false, razao: 'Informe o início e o fim do período.' })
    expect(validarPeriodo('2026-02-30', '2026-06-30').valido).toBe(false)
  })

  it('deve recusar o fim antes do início', () => {
    // ACT
    const resultado = validarPeriodo('2026-06-30', '2026-06-01')

    // ASSERT
    expect(resultado).toEqual({ valido: false, razao: 'O fim do período vem antes do início.' })
  })

  it('deve aceitar exatamente 366 dias e recusar 367 dizendo o teto', () => {
    // ARRANGE — 2026-01-01 a 2027-01-01 são 366 dias com as duas pontas
    const noTeto = validarPeriodo('2026-01-01', '2027-01-01')
    const acima = validarPeriodo('2026-01-01', '2027-01-02')

    // ASSERT
    expect(noTeto).toEqual({ valido: true })
    expect(acima).toEqual({
      valido: false,
      razao: `O período tem 367 dias; o máximo é ${TETO_DE_DIAS_DO_PERIODO} dias (um ano).`,
    })
  })

  it('deve escrever o período do envelope por extenso', () => {
    // ACT + ASSERT
    expect(periodoDoEnvelope(envelopeFicticio())).toBe('1º a 30 de junho de 2026')
    expect(periodoDoEnvelope(envelopeFicticio({ periodo: null }))).toBeNull()
  })
})
