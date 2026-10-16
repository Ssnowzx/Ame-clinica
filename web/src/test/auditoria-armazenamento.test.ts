import { describe, expect, it } from 'vitest'

import { auditarArmazenamento } from '@/test/auditoria-armazenamento'

/**
 * Suja o disco, audita e limpa DENTRO do teste — nunca num `afterEach`.
 *
 * O `afterEach` global é o próprio detector: se o lixo deste arquivo sobrevivesse
 * ao corpo do teste, ele reprovaria (com razão). Limpar aqui torna estes testes
 * independentes da ordem em que o Vitest empilha os hooks.
 */
function comDiscoSujo<T>(conteudo: Record<string, string>, verificar: () => T): T {
  for (const [chave, valor] of Object.entries(conteudo)) {
    window.localStorage.setItem(chave, valor)
  }
  try {
    return verificar()
  } finally {
    window.localStorage.clear()
  }
}

describe('auditarArmazenamento', () => {
  it('deve aprovar um disco só com preferência de layout', () => {
    // ARRANGE / ACT
    const achados = comDiscoSujo(
      { 'xiax:layout:7': '{"menu":true,"filaAgenda":false}' },
      auditarArmazenamento,
    )

    // ASSERT
    expect(achados).toEqual([])
  })

  it('deve DISPARAR quando um nome de paciente aparece no disco', () => {
    // ARRANGE / ACT: o cenário que o detector existe para pegar — os pacientes
    // são MENORES e o balcão é máquina compartilhada
    const achados = comDiscoSujo(
      { 'xiax:layout:7': '{"menu":true,"paciente":"Nome Fictício"}' },
      auditarArmazenamento,
    )

    // ASSERT
    expect(achados).toHaveLength(1)
    expect(achados[0].motivo).toContain('paciente')
  })

  it('deve DISPARAR quando uma chave estranha aparece no disco', () => {
    // ARRANGE / ACT
    const achados = comDiscoSujo({ token: 'nem-pensar' }, auditarArmazenamento)

    // ASSERT
    expect(achados).toEqual([{ chave: 'token', motivo: 'chave fora do formato de layout' }])
  })

  it('deve enxergar o nome de campo mesmo com o JSON truncado', () => {
    // ARRANGE / ACT: um write interrompido não pode ser porta de saída da fiscalização
    const achados = comDiscoSujo(
      { 'xiax:layout:7': '{"menu":true,"paciente":"Nome Fictí' },
      auditarArmazenamento,
    )

    // ASSERT
    expect(achados).toHaveLength(1)
    expect(achados[0].motivo).toContain('paciente')
  })

  it('deve tolerar valor adulterado sem nome — é fixture, não é PII', () => {
    // ARRANGE / ACT: os testes da leitura semeiam tipo errado de propósito
    const achados = comDiscoSujo(
      { 'xiax:layout:7': '{"menu":"recolhido"}', 'xiax:layout:8': '{"menu": tru' },
      auditarArmazenamento,
    )

    // ASSERT: nome de CAMPO é o que carrega informação — valor torto, não
    expect(achados).toEqual([])
  })

  it('deve nunca lançar, mesmo com o disco cheio de lixo', () => {
    // ARRANGE / ACT / ASSERT: falha de gate tem que virar asserção legível, não
    // um SyntaxError sem nome de teste nem chave
    expect(() =>
      comDiscoSujo(
        {
          'xiax:layout:7': 'nem json isso é',
          'xiax:layout:8': 'null',
          'xiax:layout:9': '[1,2,3]',
        },
        auditarArmazenamento,
      ),
    ).not.toThrow()
  })
})
