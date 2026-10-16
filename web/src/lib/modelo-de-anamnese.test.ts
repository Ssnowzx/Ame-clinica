import { describe, expect, it } from 'vitest'

import {
  camposDeModelo,
  campoNovo,
  paraCamposJson,
  temErroDeModelo,
  validarModelo,
  type CampoEmEdicao,
} from '@/lib/modelo-de-anamnese'
import type { AnamneseModelo } from '@/tipos'

function campo(sobrescritas: Partial<CampoEmEdicao> = {}): CampoEmEdicao {
  return { _key: 1, rotulo: 'Campo', tipo: 'texto', obrigatorio: false, opcoes: [], ...sobrescritas }
}

describe('paraCamposJson — id estável, único e preservado', () => {
  it('deve derivar o id do rótulo (slug sem acento) na criação', () => {
    // ARRANGE
    const campos = [campo({ _key: 1, rotulo: 'Queixa Principal' })]

    // ACT
    const resultado = paraCamposJson(campos)

    // ASSERT
    expect(resultado[0].id).toBe('queixa_principal')
    expect(resultado[0].rotulo).toBe('Queixa Principal')
  })

  it('deve desambiguar ids colididos com sufixo _2', () => {
    // ARRANGE: dois campos novos com o mesmo rótulo gerariam o mesmo slug
    const campos = [
      campo({ _key: 1, rotulo: 'Sono' }),
      campo({ _key: 2, rotulo: 'Sono' }),
    ]

    // ACT
    const ids = paraCamposJson(campos).map((c) => c.id)

    // ASSERT
    expect(ids).toEqual(['sono', 'sono_2'])
  })

  it('deve PRESERVAR o idOriginal e nunca reescrevê-lo ao editar o rótulo', () => {
    // ARRANGE: campo existente 'queixa' com rótulo renomeado
    const campos = [campo({ _key: 1, idOriginal: 'queixa', rotulo: 'Queixa inicial' })]

    // ACT
    const resultado = paraCamposJson(campos)

    // ASSERT: o id é o original, não o slug do novo rótulo
    expect(resultado[0].id).toBe('queixa')
    expect(resultado[0].rotulo).toBe('Queixa inicial')
  })

  it('deve reservar os idOriginal ANTES, para um campo novo não colidir com id já respondido', () => {
    // ARRANGE: campo existente com id 'nota' + campo novo cujo slug seria 'nota'
    const campos = [
      campo({ _key: 1, idOriginal: 'nota', rotulo: 'Observação antiga' }),
      campo({ _key: 2, rotulo: 'Nota' }),
    ]

    // ACT
    const ids = paraCamposJson(campos).map((c) => c.id)

    // ASSERT: o novo desvia para 'nota_2'; o original permanece 'nota'
    expect(ids).toEqual(['nota', 'nota_2'])
  })

  it('deve incluir opcoes (aparadas e sem vazias) só no tipo opcoes', () => {
    // ARRANGE
    const campos = [
      campo({ _key: 1, rotulo: 'Nível', tipo: 'opcoes', opcoes: [' Leve ', '', 'Grave'] }),
      campo({ _key: 2, rotulo: 'Idade', tipo: 'numero', opcoes: ['ignorado'] }),
    ]

    // ACT
    const resultado = paraCamposJson(campos)

    // ASSERT
    expect(resultado[0].opcoes).toEqual(['Leve', 'Grave'])
    expect(resultado[1].opcoes).toBeUndefined()
  })

  it('deve limitar o id a 60 caracteres para respeitar o servidor', () => {
    // ARRANGE
    const campos = [campo({ _key: 1, rotulo: 'a'.repeat(200) })]

    // ACT
    const resultado = paraCamposJson(campos)

    // ASSERT
    expect(resultado[0].id.length).toBeLessThanOrEqual(60)
  })
})

describe('validarModelo — recusa de cliente que espelha o servidor', () => {
  it('deve exigir título', () => {
    // ARRANGE / ACT
    const erros = validarModelo('   ', [campo({ rotulo: 'X' })])

    // ASSERT
    expect(erros.titulo).toBeDefined()
    expect(temErroDeModelo(erros)).toBe(true)
  })

  it('deve exigir ao menos um campo', () => {
    // ARRANGE / ACT
    const erros = validarModelo('Título', [])

    // ASSERT
    expect(erros.geralCampos).toBeDefined()
  })

  it('deve exigir rótulo em cada campo', () => {
    // ARRANGE
    const semRotulo = campo({ _key: 7, rotulo: '  ' })

    // ACT
    const erros = validarModelo('Título', [semRotulo])

    // ASSERT
    expect(erros.porCampo.get(7)?.rotulo).toBeDefined()
  })

  it('deve exigir ao menos uma opção em campo do tipo opcoes', () => {
    // ARRANGE
    const semOpcao = campo({ _key: 9, rotulo: 'Nível', tipo: 'opcoes', opcoes: ['', '  '] })

    // ACT
    const erros = validarModelo('Título', [semOpcao])

    // ASSERT
    expect(erros.porCampo.get(9)?.opcoes).toBeDefined()
  })

  it('deve aprovar um modelo válido', () => {
    // ARRANGE
    const campos = [
      campo({ _key: 1, rotulo: 'Queixa', tipo: 'texto' }),
      campo({ _key: 2, rotulo: 'Nível', tipo: 'opcoes', opcoes: ['Leve'] }),
    ]

    // ACT
    const erros = validarModelo('Anamnese', campos)

    // ASSERT
    expect(temErroDeModelo(erros)).toBe(false)
  })
})

describe('camposDeModelo — hidratação para a tela', () => {
  it('deve começar com um campo em branco na criação', () => {
    // ARRANGE / ACT
    const campos = camposDeModelo(undefined)

    // ASSERT
    expect(campos).toHaveLength(1)
    expect(campos[0].rotulo).toBe('')
    expect(campos[0].idOriginal).toBeUndefined()
  })

  it('deve carregar os campos de um modelo com o idOriginal preservado', () => {
    // ARRANGE
    const modelo: AnamneseModelo = {
      id: 1,
      titulo: 'M',
      especialidade_id: null,
      ativo: true,
      updated_at: '2026-07-20T10:00:00.000000Z',
      campos_json: [
        { id: 'queixa', tipo: 'texto', rotulo: 'Queixa', obrigatorio: true },
        { id: 'nivel', tipo: 'opcoes', rotulo: 'Nível', obrigatorio: false, opcoes: ['Leve'] },
      ],
    }

    // ACT
    const campos = camposDeModelo(modelo)

    // ASSERT
    expect(campos.map((c) => c.idOriginal)).toEqual(['queixa', 'nivel'])
    expect(campos[1].opcoes).toEqual(['Leve'])
  })
})

describe('campoNovo — chave de cliente única', () => {
  it('deve gerar campos com _key distintos', () => {
    // ARRANGE / ACT
    const a = campoNovo()
    const b = campoNovo()

    // ASSERT
    expect(a._key).not.toBe(b._key)
  })
})
