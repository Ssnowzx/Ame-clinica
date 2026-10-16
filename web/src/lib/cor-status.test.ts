import { describe, expect, it } from 'vitest'

import { corHexSegura, derivarTonsStatus, normalizarCorMarcador } from '@/lib/cor-status'
import { razaoContraste } from '@/test/contraste'

// Seeds reais do backend (StatusAgendamentoDefaults) — referência §2.3 do contrato
const CORES_STATUS_SEED = [
  '#64748B', // Em Aberto
  '#F59E0B', // Aguardando Atendimento
  '#10B981', // Finalizado
  '#059669', // Finalizado com Evolução
  '#EF4444', // Não Compareceu
  '#F97316', // Falta Justificada
  '#94A3B8', // Desmarcado pelo Profissional
  '#8B5CF6', // Reserva de Agenda
  '#3B82F6', // Consulta
  '#14B8A6', // Reposição
] as const

// Paleta default das 12 especialidades — referência §2.4 do contrato
const CORES_ESPECIALIDADE_SEED = [
  '#A85550', '#A25E2B', '#8F6B09', '#707920', '#448247', '#09856E',
  '#0A818B', '#177BA8', '#526FB2', '#7763AB', '#915A95', '#A35475',
] as const

// Payloads do checklist §5.3 do parecer de segurança (T-ds-02)
const PAYLOADS_MALICIOSOS = [
  'red;background:url(//evil)',
  'url(javascript:alert(1))',
  'expression(alert(1))',
  '',
  null,
  undefined,
  '#FFF',
  '#16695F99',
  'rgb(0, 0, 0)',
  123,
] as const

describe('corHexSegura', () => {
  it('deve aceitar hex estrito #RRGGBB normalizado em caixa alta', () => {
    // ARRANGE + ACT + ASSERT: as duas caixas viram a mesma cor (uma entrada de
    // cache só; saída estável para os componentes)
    expect(corHexSegura('#16695F')).toBe('#16695F')
    expect(corHexSegura('#f59e0b')).toBe('#F59E0B')
  })

  it('deve rejeitar qualquer payload malicioso ou malformado sem crash', () => {
    // ARRANGE: payloads do parecer (injeção de estilo, tipos errados, vazios)
    // ACT + ASSERT: tudo cai em null (fail-safe), nunca exceção
    for (const payload of PAYLOADS_MALICIOSOS) {
      expect(corHexSegura(payload)).toBeNull()
    }
  })
})

describe('derivarTonsStatus', () => {
  it('deve garantir contraste AA (≥ 4.5:1) texto/fundo para os 10 status seedados', () => {
    // ARRANGE: cores cruas do cadastro seedado
    for (const cor of CORES_STATUS_SEED) {
      // ACT: derivação do trio suave
      const tons = derivarTonsStatus(cor)

      // ASSERT: AA por construção, qualquer que seja a cor cadastrada
      expect(razaoContraste(tons.texto, tons.fundo)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('deve reproduzir a referência calculada do contrato para Em Aberto', () => {
    // ARRANGE: referência da tabela §2.3 (texto/fundo/borda de #64748B)
    const referencia = { texto: '#3A495E', fundo: '#F0F4FA', borda: '#CBD5E3' }

    // ACT
    const tons = derivarTonsStatus('#64748B')

    // ASSERT: cada canal dentro de ±3 da referência (arredondamento de conversão)
    for (const chave of ['texto', 'fundo', 'borda'] as const) {
      for (let canal = 0; canal < 3; canal++) {
        const inicio = 1 + canal * 2
        const esperado = parseInt(referencia[chave].slice(inicio, inicio + 2), 16)
        const obtido = parseInt(tons[chave].slice(inicio, inicio + 2), 16)
        expect(Math.abs(obtido - esperado)).toBeLessThanOrEqual(3)
      }
    }
  })

  it('deve manter AA mesmo com cor saturada extrema cadastrada pela clínica', () => {
    // ARRANGE: o pior caso do §2 — a clínica cadastra vermelho puro
    const tons = derivarTonsStatus('#FF0000')

    // ASSERT: o chip nunca vira bloco saturado; AA por construção
    expect(razaoContraste(tons.texto, tons.fundo)).toBeGreaterThanOrEqual(4.5)
  })

  it('deve cair no tom neutro sem crash para cor inválida', () => {
    // ARRANGE: payloads maliciosos e valores ausentes
    for (const payload of PAYLOADS_MALICIOSOS) {
      // ACT: derivação fail-safe
      const tons = derivarTonsStatus(payload)

      // ASSERT: trio válido, AA preservado, nenhum estilo injetável
      expect(tons.texto).toMatch(/^#[0-9A-F]{6}$/)
      expect(tons.fundo).toMatch(/^#[0-9A-F]{6}$/)
      expect(tons.borda).toMatch(/^#[0-9A-F]{6}$/)
      expect(razaoContraste(tons.texto, tons.fundo)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('deve aplicar o mesmo clamp na cor_borda cadastrada', () => {
    // ARRANGE: cor_borda saturada vinda do cadastro
    const tons = derivarTonsStatus('#64748B', '#FF0000')

    // ASSERT: borda continua suave (clamp de croma) e válida
    expect(tons.borda).toMatch(/^#[0-9A-F]{6}$/)
    // contraste da borda vs branco fica decorativo (< 3:1) — nunca canal de identificação
    expect(razaoContraste(tons.borda, '#FFFFFF')).toBeLessThan(3)
  })

  it('deve memoizar a derivação por entrada (uma vez por status, não por card)', () => {
    // ACT: duas chamadas com a mesma entrada
    const primeira = derivarTonsStatus('#10B981')
    const segunda = derivarTonsStatus('#10B981')

    // ASSERT: mesma referência de objeto (cache)
    expect(segunda).toBe(primeira)
  })
})

describe('normalizarCorMarcador', () => {
  it('deve garantir visibilidade ≥ 3:1 sobre superfície e fundo para as 12 especialidades', () => {
    // ARRANGE: paleta default seedada
    for (const cor of CORES_ESPECIALIDADE_SEED) {
      // ACT
      const normalizada = normalizarCorMarcador(cor)

      // ASSERT: piso 1.4.11 sobre --superficie (#FFFFFF) e --fundo (#FAF9F7)
      expect(razaoContraste(normalizada, '#FFFFFF')).toBeGreaterThanOrEqual(3)
      expect(razaoContraste(normalizada, '#FAF9F7')).toBeGreaterThanOrEqual(3)
    }
  })

  it('deve clamped cor clara demais cadastrada pela clínica para o piso de visibilidade', () => {
    // ARRANGE: amarelo claro quase invisível sobre branco
    const normalizada = normalizarCorMarcador('#FFEE55')

    // ASSERT: clamp de luminosidade garante o piso
    expect(razaoContraste(normalizada, '#FFFFFF')).toBeGreaterThanOrEqual(3)
  })

  it('deve cair no neutro sem crash para cor inválida', () => {
    // ARRANGE + ACT + ASSERT: payloads maliciosos caem no primitivo neutro-450
    for (const payload of PAYLOADS_MALICIOSOS) {
      expect(normalizarCorMarcador(payload)).toBe('#8F8A80')
    }
  })
})
