import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * Conteúdo largo que rola no PRÓPRIO contêiner — com as duas coisas que
 * `overflow-x-auto` sozinho NÃO dá, ambas achadas pelo gate:
 *
 * 1. **Aviso de que há mais.** No macOS a barra de rolagem é overlay e mede 0px de
 *    altura. Sem sinal nenhum, 3 a 6 meses de um gráfico anual somem e a borda do
 *    cartão parece o fim do ano — dado que não se anuncia como faltando. O véu de
 *    fade aparece SÓ do lado que tem conteúdo escondido (BLOQ-1).
 * 2. **Acesso por teclado.** Região rolável sem `tabIndex` é WCAG 2.1.1. O Chromium
 *    a foca sozinho e o WebKit NÃO — o defeito fica invisível justamente no navegador
 *    em que se costuma testar (BLOQ-3). O molde é o mesmo de `grade-de-permissoes`:
 *    `tabIndex` + `role="region"` + nome acessível.
 *
 * O nome (`rotulo`) descreve o que rola E que rola: "…, role para ver os doze meses".
 */
export function RoladorHorizontal({
  rotulo,
  children,
  className,
}: {
  rotulo: string
  children: ReactNode
  className?: string
}) {
  const alvo = useRef<HTMLDivElement>(null)
  const [estado, setEstado] = useState({ rola: false, inicio: false, fim: false })

  const medir = useCallback(() => {
    const elemento = alvo.current
    if (elemento === null) {
      return
    }
    const sobra = elemento.scrollWidth - elemento.clientWidth
    // 1px de folga: zoom e subpixel deixam `scrollWidth` um cabelo maior que
    // `clientWidth` mesmo quando não há nada escondido, e o véu piscava
    const rola = sobra > 1
    const proximo = {
      rola,
      inicio: rola && elemento.scrollLeft > 1,
      fim: rola && elemento.scrollLeft < sobra - 1,
    }
    // update funcional + comparação: `onScroll` dispara por quadro, e trocar o objeto
    // a cada evento re-renderiza à toa
    setEstado((anterior) =>
      anterior.rola === proximo.rola && anterior.inicio === proximo.inicio && anterior.fim === proximo.fim
        ? anterior
        : proximo,
    )
  }, [])

  useEffect(() => {
    medir()
    const elemento = alvo.current
    // `ResizeObserver` não existe em todo ambiente (jsdom antigo): sem ele o véu
    // simplesmente não reage a redimensionamento, e nada quebra
    if (elemento === null || typeof ResizeObserver === 'undefined') {
      return
    }
    // observa o CONTEÚDO, não o contêiner: a caixa do scroller não muda quando só o
    // `scrollWidth` dos filhos muda, então observar o contêiner deixava o véu mentindo
    // depois de uma troca de conteúdo (achado do gate). `children` nas deps cobre a
    // troca de filhos que não mexe em tamanho de caixa nenhuma.
    const observador = new ResizeObserver(medir)
    observador.observe(elemento)
    if (elemento.firstElementChild !== null) {
      observador.observe(elemento.firstElementChild)
    }

    return () => {
      observador.disconnect()
    }
  }, [medir, children])

  return (
    <div className="relative">
      <div
        ref={alvo}
        // foco SÓ quando há o que rolar: `tabIndex={0}` incondicional criava duas paradas
        // de teclado por página em 1440px, onde nada rola — ruído justo na largura em que
        // a clínica trabalha (achado IMP-13 do gate)
        // `-1` e não `undefined`: sair da ordem de tabulação é o que o IMP-13 pedia, mas
        // REMOVER o atributo com o foco dentro faria o foco cair para o `body` quando a
        // janela alarga e a região deixa de rolar (zoom, rotação, o limiar dos 560px).
        // Com `-1` o elemento continua focável, só não é mais uma parada de Tab.
        tabIndex={estado.rola ? 0 : -1}
        role={estado.rola ? 'region' : undefined}
        aria-label={estado.rola ? rotulo : undefined}
        onScroll={medir}
        className={cn(
          'overflow-x-auto rounded-controle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
          className,
        )}
      >
        {children}
      </div>
      {estado.inicio ? <Veu lado="inicio" /> : null}
      {estado.fim ? <Veu lado="fim" /> : null}
    </div>
  )
}

/** O degradê que diz "tem mais para este lado". Decorativo: o nome da região já informa. */
function Veu({ lado }: { lado: 'inicio' | 'fim' }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-y-0 w-8 from-superficie to-transparent',
        lado === 'inicio' ? 'left-0 bg-linear-to-r' : 'right-0 bg-linear-to-l',
      )}
    />
  )
}
