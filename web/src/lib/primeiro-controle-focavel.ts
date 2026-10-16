/**
 * O primeiro controle que a pessoa alcança pelo Tab dentro de um diálogo — para onde o foco vai ao abri-lo.
 *
 * "O primeiro `input`" pegava o ESPELHO que o Radix põe atrás do checkbox ("Bloqueio de agenda"):
 * `aria-hidden`, `tabindex=-1`, invisível — o foco caía num campo sem nome, e Espaço marcava a caixa
 * escondida (gate A11Y-EVO-R3-01 / CR-EVO-R3-01). Vale só o que está na ordem do Tab e pode receber
 * foco: fora de árvore `aria-hidden`, `hidden` ou `inert`, não desabilitado (nem por um `fieldset`) e
 * não escondido pelo estilo (A11Y-EVO-R4-01 / CR-EVO-R4-04). Nada assim, quem chama foca o próprio diálogo.
 */
export function primeiroControleFocavel(dentroDe: HTMLElement | null): HTMLElement | null {
  if (dentroDe === null) {
    return null
  }
  const candidatos = dentroDe.querySelectorAll<HTMLElement>(
    'input, select, textarea, button, [role="checkbox"], [role="combobox"], [tabindex]',
  )
  for (const candidato of candidatos) {
    if (candidato.tabIndex >= 0 && podeReceberFoco(candidato)) {
      return candidato
    }
  }

  return null
}

function podeReceberFoco(candidato: HTMLElement): boolean {
  const escondido = candidato.closest('[aria-hidden="true"], [hidden], [inert]') !== null
  const desabilitado = candidato.matches(':disabled') || candidato.getAttribute('aria-disabled') === 'true'
  const campoOculto = candidato instanceof HTMLInputElement && candidato.type === 'hidden'
  const estilo = getComputedStyle(candidato)
  const semCaixa = estilo.display === 'none' || estilo.visibility === 'hidden'

  return !escondido && !desabilitado && !campoOculto && !semCaixa
}
