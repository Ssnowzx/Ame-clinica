import { useLayoutEffect } from 'react'

import { temaConhecido } from '@/lib/tema-da-clinica'

/**
 * Aplica o tema da clínica no `<html>` enquanto a tela que o chama estiver montada (change
 * tema-da-clinica).
 *
 * Quem segura o atributo é o CICLO DE VIDA de quem chama (o shell autenticado, a página pública
 * de cadastro), e não o store da sessão: ao sair, ou quando a sessão expira, o shell desmonta e
 * o tema sai junto. Por isso a tela de login, que vive fora do shell, nunca herda a cor de
 * uma clínica e continua com a marca do produto (spec identidade-da-clinica).
 *
 * **Um dono por vez.** O shell e a página pública são rotas exclusivas; uma prévia do formulário
 * público montada DENTRO do shell tiraria o tema ao desmontar. Se isso um dia existir, o hook
 * passa a contar referências.
 *
 * `useLayoutEffect`, e não `useEffect`: o atributo entra antes da primeira pintura — sem ele, o
 * primeiro quadro do shell sairia nas cores do Padrão e trocaria em seguida (um piscar de cor ao
 * abrir o sistema).
 */
function useTemaDaClinica(tema: string | null | undefined): void {
  const aplicado = temaConhecido(tema)

  useLayoutEffect(() => {
    // Padrão = ausência do atributo; quem o tira é a limpeza do valor anterior, logo abaixo
    if (aplicado === null) {
      return undefined
    }

    const raiz = document.documentElement
    raiz.dataset.tema = aplicado

    return () => {
      delete raiz.dataset.tema
    }
  }, [aplicado])
}

export { useTemaDaClinica as usarTemaDaClinica }
