import { useLayoutEffect, type RefObject } from 'react'

/**
 * Os respiros verticais do shell FORA do cabeçalho: o `p-3` da raiz (em cima e embaixo), o
 * `gap-3` entre o cabeçalho e o `main`, e o `p-3` do `main` (em cima e embaixo) — 5 × 0,75rem.
 * Em `rem` porque escalam com a fonte-raiz, como as classes que eles espelham.
 */
const RESPIROS_DO_SHELL = '3.75rem'

/**
 * A MOLDURA DO SHELL MEDIDA, não suposta (change conversa-legivel, medido em produção).
 *
 * `--moldura-do-shell` era `7rem` fixo: o cabeçalho de 52px mais os respiros. No celular, com os
 * contadores reais da clínica, o cabeçalho tem 68px — e toda tela que desconta a moldura da
 * viewport (Mensagens, a grade da agenda) ficava 16px maior que a tela, rolando o documento. A
 * guarda de contrato já dizia que não cobria isso ("se alguém aumentar o cabeçalho, o token fica
 * errado"); o cabeçalho é dirigido por conteúdo, então a única medida certa é a do navegador.
 *
 * Mede no `useLayoutEffect` (antes do primeiro quadro pintado, sem pulo) e acompanha o cabeçalho
 * com `ResizeObserver` (contador que aparece, nome que quebra, rotação). O `7rem` do `index.css`
 * continua valendo antes da medida e onde não há layout (jsdom).
 */
function useMolduraDoShell(cabecalho: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const elemento = cabecalho.current
    if (elemento === null) {
      return
    }
    const raiz = document.documentElement

    const medir = (): void => {
      const altura = elemento.getBoundingClientRect().height
      // altura 0 = sem layout (elemento oculto, ambiente de teste): o token do CSS vale mais
      if (altura > 0) {
        raiz.style.setProperty('--moldura-do-shell', `calc(${altura}px + ${RESPIROS_DO_SHELL})`)
      }
    }

    medir()
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir)
    // `border-box`: a medida acima é a da caixa INTEIRA (com padding e borda) — observar só o
    // conteúdo (o padrão) deixava passar o cabeçalho que cresce pelo respiro (visto no teste local)
    observador?.observe(elemento, { box: 'border-box' })

    return () => {
      observador?.disconnect()
      raiz.style.removeProperty('--moldura-do-shell')
    }
  }, [cabecalho])
}

// nome do repo é pt-BR; o lint exige o prefixo `use` na declaração (mesmo padrão do `usarToast`)
export { useMolduraDoShell as usarMolduraDoShell }
