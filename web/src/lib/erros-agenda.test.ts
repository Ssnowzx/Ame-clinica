import { describe, expect, it } from 'vitest'

import { distribuirErros } from '@/lib/erros-agenda'
import { ErroDeApi } from '@/lib/http'

function recusa(erros: Record<string, unknown>): ErroDeApi {
  return new ErroDeApi('invalido', 'Revise os dados.', erros as Record<string, string[]>)
}

describe('distribuirErros — cada recusa no lugar certo (T-aes-10)', () => {
  it('deve levar a recusa ao campo que a causou', () => {
    // ARRANGE: as mensagens reais da API
    const erro = recusa({
      profissional_id: ['Horário ocupado do profissional.'],
      tratamento_id: ['O tratamento está vencido.'],
    })

    // ACT
    const { porCampo, gerais } = distribuirErros(erro)

    // ASSERT
    expect(porCampo.profissional_id).toBe('Horário ocupado do profissional.')
    expect(porCampo.tratamento_id).toBe('O tratamento está vencido.')
    expect(gerais).toHaveLength(0)
  })

  it('deve mandar ao aviso geral o que não pertence a campo nenhum', () => {
    // ARRANGE: as três chaves que a API usa e que não são campo do formulário
    const erro = recusa({
      agendamento: ['Agendamento com sessão consumida não pode ser excluído — estorne primeiro mudando o status.'],
      recorrencia: ['Conflito de horário nas datas: 2026-07-18, 2026-07-25.'],
      aplicar_na_serie: ['Não é possível mudar o tipo aplicando na série.'],
    })

    // ACT
    const { porCampo, gerais } = distribuirErros(erro)

    // ASSERT
    expect(Object.keys(porCampo)).toHaveLength(0)
    expect(gerais).toHaveLength(3)
    expect(gerais[1]).toContain('2026-07-18')
  })

  it('deve mandar ao aviso a recusa de tipo (o modo bloqueio não é um campo)', () => {
    // ARRANGE
    const erro = recusa({ tipo: ['Agendamento com atendimento registrado não pode virar bloqueio.'] })

    // ACT
    const { gerais } = distribuirErros(erro)

    // ASSERT
    expect(gerais[0]).toContain('não pode virar bloqueio')
  })

  it('deve mandar ao aviso a chave pontuada e a desconhecida (fail-safe)', () => {
    // ARRANGE: a API pode inventar chave nova — o usuário PRECISA ver o motivo
    const erro = recusa({
      'recorrencia.ate': ['A data final deve ser depois do início.'],
      chave_que_a_tela_nao_conhece: ['Motivo novo do servidor.'],
    })

    // ACT
    const { gerais } = distribuirErros(erro)

    // ASSERT
    expect(gerais).toContain('A data final deve ser depois do início.')
    expect(gerais).toContain('Motivo novo do servidor.')
  })

  it('deve não quebrar com chave hostil nem com valor não-string', () => {
    // ARRANGE: `__proto__` não é campo (a família do iconeSeguro)
    const erro = recusa({
      __proto__: ['payload hostil'],
      constructor: ['idem'],
      profissional_id: 42,
      sala_id: [],
    })

    // ACT
    const { porCampo, gerais } = distribuirErros(erro)

    // ASSERT: nada explode, nada vira campo indevidamente
    expect(porCampo.profissional_id).toBeUndefined()
    expect(porCampo.sala_id).toBeUndefined()
    expect(gerais.length).toBeGreaterThan(0)
  })

  it('deve aceitar mensagem entregue como string simples', () => {
    // ARRANGE
    const erro = recusa({ inicio: 'Agendamento retroativo não é permitido.' })

    // ACT
    const { porCampo } = distribuirErros(erro)

    // ASSERT
    expect(porCampo.inicio).toBe('Agendamento retroativo não é permitido.')
  })

  it('deve dar um motivo visível quando a recusa não traz detalhe', () => {
    // ARRANGE: 403/rede/5xx — nenhuma escrita pode falhar em silêncio
    const erro = new ErroDeApi('sem_acesso', 'Você não tem acesso a este recurso.')

    // ACT
    const { gerais } = distribuirErros(erro)

    // ASSERT
    expect(gerais).toEqual(['Você não tem acesso a este recurso.'])
  })

  it('deve dar um motivo visível para exceção que não é da API', () => {
    // ARRANGE + ACT
    const { gerais } = distribuirErros(new TypeError('quebrou'))

    // ASSERT
    expect(gerais).toHaveLength(1)
  })
})
