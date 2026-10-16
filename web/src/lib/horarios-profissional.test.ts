import { describe, expect, it } from 'vitest'

import {
  formParaMapa,
  mapaParaForm,
  resumoDeHorarios,
  validarHorarios,
  type FormHorarios,
} from '@/lib/horarios-profissional'

describe('mapaParaForm / formParaMapa — ida e volta', () => {
  it('deve converter o mapa da API (chaves string) no estado do form (chaves número)', () => {
    // ARRANGE / ACT
    const form = mapaParaForm({ '2': [{ inicio: '09:00', fim: '12:00' }] })

    // ASSERT
    expect(form[2]).toEqual([{ inicio: '09:00', fim: '12:00' }])
  })

  it('deve tratar o mapa ausente como vazio', () => {
    expect(mapaParaForm(undefined)).toEqual({})
  })

  it('deve emitir só os dias COM intervalo (dia vazio some do payload)', () => {
    // ARRANGE
    const form: FormHorarios = { 2: [{ inicio: '09:00', fim: '12:00' }], 3: [] }

    // ACT
    const mapa = formParaMapa(form)

    // ASSERT — o dia 3 (sem intervalo) não entra
    expect(mapa).toEqual({ '2': [{ inicio: '09:00', fim: '12:00' }] })
  })

  it('deve emitir mapa vazio quando não há dias (= todos os dias)', () => {
    expect(formParaMapa({})).toEqual({})
  })
})

describe('validarHorarios — espelha o servidor', () => {
  it('deve aprovar horários válidos (turno partido)', () => {
    // ARRANGE
    const form: FormHorarios = { 2: [{ inicio: '09:00', fim: '12:00' }, { inicio: '16:00', fim: '19:00' }] }

    // ACT
    const erros = validarHorarios(form)

    // ASSERT
    expect(erros.size).toBe(0)
  })

  it('deve recusar fim ≤ início, ancorando no fim do intervalo', () => {
    // ARRANGE
    const form: FormHorarios = { 2: [{ inicio: '12:00', fim: '09:00' }] }

    // ACT
    const erros = validarHorarios(form)

    // ASSERT
    expect(erros.get('2.0.fim')).toBeDefined()
  })

  it('deve recusar intervalos sobrepostos no mesmo dia', () => {
    // ARRANGE — 09:00–12:00 e 11:00–14:00 se sobrepõem
    const form: FormHorarios = { 2: [{ inicio: '09:00', fim: '12:00' }, { inicio: '11:00', fim: '14:00' }] }

    // ACT
    const erros = validarHorarios(form)

    // ASSERT — o erro pousa no segundo intervalo (ordenado por início)
    expect(erros.get('2.1.inicio')).toBeDefined()
  })

  it('deve permitir intervalos adjacentes (fim de um = início do outro)', () => {
    // ARRANGE — 09:00–12:00 e 12:00–15:00 encostam mas não sobrepõem
    const form: FormHorarios = { 2: [{ inicio: '09:00', fim: '12:00' }, { inicio: '12:00', fim: '15:00' }] }

    // ACT
    const erros = validarHorarios(form)

    // ASSERT
    expect(erros.size).toBe(0)
  })
})

describe('resumoDeHorarios — texto para lista/ficha', () => {
  it('deve dizer "Todos os dias" quando vazio', () => {
    expect(resumoDeHorarios({})).toBe('Todos os dias')
    expect(resumoDeHorarios(undefined)).toBe('Todos os dias')
  })

  it('deve resumir Seg–Sex quando são exatamente os dias úteis', () => {
    // ARRANGE
    const mapa = {
      '1': [{ inicio: '08:00', fim: '18:00' }],
      '2': [{ inicio: '08:00', fim: '18:00' }],
      '3': [{ inicio: '08:00', fim: '18:00' }],
      '4': [{ inicio: '08:00', fim: '18:00' }],
      '5': [{ inicio: '08:00', fim: '18:00' }],
    }

    // ACT / ASSERT
    expect(resumoDeHorarios(mapa)).toBe('Seg–Sex · 08:00–18:00')
  })

  it('deve marcar "turnos" quando há intervalo partido', () => {
    // ARRANGE
    const mapa = { '2': [{ inicio: '09:00', fim: '12:00' }, { inicio: '16:00', fim: '19:00' }] }

    // ACT / ASSERT
    expect(resumoDeHorarios(mapa)).toBe('Ter · 09:00–19:00 · turnos')
  })

  it('deve listar os dias avulsos quando não são Seg–Sex', () => {
    // ARRANGE
    const mapa = { '1': [{ inicio: '08:00', fim: '12:00' }], '3': [{ inicio: '08:00', fim: '12:00' }] }

    // ACT / ASSERT
    expect(resumoDeHorarios(mapa)).toBe('Seg, Qua · 08:00–12:00')
  })
})
