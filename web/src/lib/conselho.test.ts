import { describe, expect, it } from 'vitest'

import { registroNoConselho } from '@/lib/conselho'

describe('registroNoConselho', () => {
  it('deve montar o registro completo quando as três partes existem', () => {
    // ARRANGE + ACT
    const registro = registroNoConselho({ conselho: 'CRP', uf_conselho: 'SP', num_conselho: '12345' })

    // ASSERT
    expect(registro).toBe('CRP/SP 12345')
  })

  it('deve omitir a UF ausente em vez de escrever "null" na tela', () => {
    // ARRANGE: 14 dos 20 profissionais de produção estão sem UF, e a interpolação direta
    // exibia `CRP/null 12/20988` para o usuário final (validação em produção, 2026-08-21)
    const registro = registroNoConselho({ conselho: 'CRP', uf_conselho: null, num_conselho: '12/20988' })

    // ASSERT
    expect(registro).toBe('CRP 12/20988')
    expect(registro).not.toContain('null')
  })

  it('deve omitir o número ausente', () => {
    // ARRANGE + ACT
    const registro = registroNoConselho({ conselho: 'Crefito', uf_conselho: 'RS', num_conselho: null })

    // ASSERT
    expect(registro).toBe('Crefito/RS')
  })

  it('deve devolver nulo quando não há conselho — quem chama decide o que mostrar', () => {
    // ARRANGE + ACT: string vazia conta como ausência (o formulário grava '' quando limpo)
    // ASSERT
    expect(registroNoConselho({ conselho: null, uf_conselho: 'SP', num_conselho: '1' })).toBeNull()
    expect(registroNoConselho({ conselho: '  ', uf_conselho: null, num_conselho: null })).toBeNull()
  })

  it('deve ignorar espaço em volta das partes', () => {
    // ARRANGE + ACT
    const registro = registroNoConselho({ conselho: ' CRFa-3 ', uf_conselho: ' ', num_conselho: ' 13288 ' })

    // ASSERT: a UF só com espaço não vira barra solta
    expect(registro).toBe('CRFa-3 13288')
  })
})
