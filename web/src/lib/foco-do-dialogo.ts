import type { RefObject } from 'react'

import { primeiroControleFocavel } from '@/lib/primeiro-controle-focavel'

/*
 * O foco de um `AlertDialog` aberto pelo ESTADO e sem `AlertDialog.Cancel` (gate A11Y-AVI-02).
 *
 * O Radix só leva o foco ao `Cancel`; sem ele, o diálogo abria com o foco no fundo da página, atrás do
 * véu. E, sem `Trigger`, o Radix não sabe a quem devolver o foco ao fechar: ele caía no `body`. As duas
 * funções vão no `onOpenAutoFocus` e no `onCloseAutoFocus` do conteúdo — o que o `formulario-agendamento`
 * faz à mão, com o mesmo `primeiroControleFocavel`.
 */

/**
 * Ao abrir: guarda quem abriu e leva o foco ao primeiro controle — sem nenhum (um carregamento), ao
 * próprio diálogo.
 *
 * Quem abriu é guardado UMA vez: um diálogo de carregamento pode dar lugar ao do formulário, e quando o
 * segundo abre o foco já saiu do botão.
 */
export function levarOFocoParaDentro(
  evento: Event,
  conteudo: HTMLElement | null,
  disparador: RefObject<HTMLElement | null>,
): void {
  evento.preventDefault()
  if (disparador.current === null) {
    const ativo = document.activeElement
    disparador.current = ativo instanceof HTMLElement && ativo !== document.body ? ativo : null
  }
  const alvo = primeiroControleFocavel(conteudo) ?? conteudo
  alvo?.focus()
}

/**
 * Ao fechar: devolve o foco a quem abriu — só quando ele se PERDEU no `body`. Na troca do carregamento
 * pelo formulário, o diálogo que sai também "fecha", mas o foco já está no primeiro campo do que entrou:
 * puxá-lo de volta ao botão tiraria a pessoa do formulário.
 */
export function devolverOFoco(evento: Event, disparador: RefObject<HTMLElement | null>): void {
  evento.preventDefault()
  const perdido = document.activeElement === null || document.activeElement === document.body
  if (perdido && disparador.current?.isConnected === true) {
    disparador.current.focus()
    // devolvido, esquece: num diálogo que não remonta a cada abertura, a 2ª abertura guarda o SEU
    // disparador, e não o da 1ª (gate CR-AVI-R2-04)
    disparador.current = null
  }
}
