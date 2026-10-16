import { describe, expect, it } from 'vitest'

import { primeiroControleFocavel } from '@/lib/primeiro-controle-focavel'

/** Gate A11Y-EVO-R3-01: o foco ao abrir ia para o espelho escondido do checkbox do Radix. */
describe('primeiroControleFocavel', () => {
  it('deve pular o espelho escondido, o desabilitado e o campo oculto, e achar o primeiro controle real', () => {
    // ARRANGE — a ordem que derrubaria um "primeiro input": tudo o que não se alcança pelo Tab vem antes
    const dialogo = document.createElement('div')
    dialogo.innerHTML = `
      <input type="checkbox" aria-hidden="true" tabindex="-1" />
      <button type="button" tabindex="-1">Fora da ordem do Tab</button>
      <div aria-hidden="true"><button type="button">Atrás</button></div>
      <div hidden><button type="button">Oculto</button></div>
      <div inert><button type="button">Inerte</button></div>
      <button type="button" style="display: none">Sem caixa</button>
      <fieldset disabled><button type="button">No fieldset desabilitado</button></fieldset>
      <input type="hidden" name="token" />
      <button type="button" disabled>Desabilitado</button>
      <button type="button" aria-disabled="true">Indisponível</button>
      <label>Hora <input type="time" /></label>
    `

    // ACT
    const alvo = primeiroControleFocavel(dialogo)

    // ASSERT
    expect(alvo?.getAttribute('type')).toBe('time')
  })

  it('deve devolver nada quando não há controle alcançável', () => {
    // ARRANGE — o formulário ainda carregando: quem chama foca o próprio diálogo
    const dialogo = document.createElement('div')
    dialogo.innerHTML = '<div aria-hidden="true"><span>carregando</span></div>'

    // ACT + ASSERT
    expect(primeiroControleFocavel(dialogo)).toBeNull()
    expect(primeiroControleFocavel(null)).toBeNull()
  })
})
