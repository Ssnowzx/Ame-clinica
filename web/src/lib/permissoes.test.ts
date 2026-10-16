import { describe, expect, it } from 'vitest'

import { alcancaOUsuario } from '@/lib/permissoes'

/** O verificador do auth-store, montado de uma lista. */
function com(permissoes: string[]): (permissao: string) => boolean {
  return (permissao) => permissoes.includes(permissao)
}

const EU = { id: 1, profissional_id: 10 }

describe('alcancaOUsuario — a régua do servidor na tela (trava-de-usuarios-e-niveis)', () => {
  it('deve alcançar a si mesmo, mesmo com menos permissões', () => {
    // ARRANGE + ACT + ASSERT
    expect(alcancaOUsuario(com([]), EU, { id: 1, profissional_id: 10, permissoes: ['agenda.ver'] })).toBe(true)
  })

  it('deve recusar quem tem uma permissão que eu não tenho', () => {
    // ARRANGE + ACT + ASSERT
    expect(alcancaOUsuario(com(['agenda.ver']), EU, { id: 2, profissional_id: null, permissoes: ['agenda.ver', 'fluxo_caixa.ver'] })).toBe(false)
  })

  it('deve alcançar quem não tem vínculo ou é do meu profissional, sem as flags', () => {
    // ARRANGE
    const temPermissao = com(['agenda.ver'])

    // ACT + ASSERT
    expect(alcancaOUsuario(temPermissao, EU, { id: 2, profissional_id: null, permissoes: ['agenda.ver'] })).toBe(true)
    expect(alcancaOUsuario(temPermissao, EU, { id: 3, profissional_id: 10, permissoes: ['agenda.ver'] })).toBe(true)
  })

  it('deve recusar o colega de outro profissional a quem não tem as duas flags, e deixar a quem tem', () => {
    // ARRANGE
    const colega = { id: 4, profissional_id: 20, permissoes: ['agenda.ver'] }

    // ACT + ASSERT
    expect(alcancaOUsuario(com(['agenda.ver', 'agenda.ver_todos']), EU, colega)).toBe(false)
    expect(alcancaOUsuario(com(['agenda.ver', 'agenda.ver_todos', 'clinico.ver_todos']), EU, colega)).toBe(true)
  })
})
