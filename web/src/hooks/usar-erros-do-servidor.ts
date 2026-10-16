import { useState } from 'react'

import { usarToast } from '@/componentes/ui/toast'
import { distribuirErrosDoServidor, semErros, type ErrosDoServidor } from '@/lib/erros'

/**
 * A plumbing de recusa que TODA tela de cadastro repete (design D7): distribuir a
 * recusa entre os campos, e garantir que **nenhuma escrita falhe em silêncio** —
 * fluxos sem formulário (excluir, desativar) não têm campo onde a mensagem possa
 * pousar, e ali o toast é o único aviso.
 *
 * Escrita uma vez porque são nove cadastros: nove cópias divergem nove vezes
 * (parecer code-review §6).
 *
 * @param campos - Raízes das chaves que a tela conhece (`responsaveis_json.0.nome`
 *   casa por `responsaveis_json`)
 * @param opcoes - `toast: false` para o diálogo em que TODA recusa tem onde pousar (aviso geral
 *   sempre montado + um widget por campo): ali o toast era a mesma frase anunciada uma terceira
 *   vez e ainda roubava o Esc do diálogo (gatilho TOAST-ROUBA-O-ESC). Quem desliga assume a
 *   garantia de que nenhuma chave fica sem pouso — o toast deixa de ser a rede. `aoFalhar` devolve
 *   a recusa distribuída para isso: quem só tem pouso para os campos avisa as `gerais` à mão.
 */
function useErrosDoServidor(campos: ReadonlySet<string>, { toast = true }: { toast?: boolean } = {}) {
  const { notificar } = usarToast()
  const [erros, setErros] = useState<ErrosDoServidor>(semErros)

  function limparErros(): void {
    setErros(semErros())
  }

  function aoFalhar(erro: unknown): ErrosDoServidor {
    const distribuidos = distribuirErrosDoServidor(erro, campos)
    setErros(distribuidos)

    const mensagem = distribuidos.gerais[0] ?? [...distribuidos.campos.values()][0]
    if (toast && mensagem !== undefined) {
      notificar({ tom: 'erro', titulo: mensagem })
    }

    return distribuidos
  }

  return { erros, limparErros, aoFalhar, notificar }
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração
export { useErrosDoServidor as usarErrosDoServidor }
