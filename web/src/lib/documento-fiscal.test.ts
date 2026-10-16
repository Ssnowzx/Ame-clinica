import { describe, expect, it } from 'vitest'

import { digitosDoDocumento, formatarCpfOuCnpj } from '@/lib/documento-fiscal'

/** O documento do fornecedor: dígitos no formulário, pontuação na tela. Números de EXEMPLO. */
describe('Documento fiscal — CPF ou CNPJ num campo só', () => {
  it('deve pontuar como CPF até 11 dígitos', () => {
    // ARRANGE + ACT
    const formatado = formatarCpfOuCnpj('52998224725')

    // ASSERT
    expect(formatado).toBe('529.982.247-25')
  })

  it('deve pontuar como CNPJ a partir do 12º dígito', () => {
    // ARRANGE + ACT
    const formatado = formatarCpfOuCnpj('11222333000181')

    // ASSERT
    expect(formatado).toBe('11.222.333/0001-81')
  })

  it('deve pontuar o que houver enquanto se digita', () => {
    // ARRANGE + ACT — apagar o último dígito não pode trazer o separador de volta sozinho
    const formatado = formatarCpfOuCnpj('5299')

    // ASSERT
    expect(formatado).toBe('529.9')
  })

  it('deve guardar só os dígitos de um documento colado com pontuação, até 14', () => {
    // ARRANGE + ACT — é assim que o CNPJ chega: copiado de uma nota
    const digitos = digitosDoDocumento('11.222.333/0001-81 99')

    // ASSERT
    expect(digitos).toBe('11222333000181')
  })
})
