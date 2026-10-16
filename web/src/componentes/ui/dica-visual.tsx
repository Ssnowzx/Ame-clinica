import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'

export interface DicaVisualProps {
  /**
   * O texto da dica — o MESMO que já é nome acessível do alvo, nunca informação
   * nova. É `string` de propósito: um `ReactNode` convidaria a pendurar aqui algo
   * derivado de dado, e esta dica vive num trilho aberto o dia inteiro no balcão.
   */
  children: string
  /** Lado em que a dica aparece (o trilho da navegação usa `direita`) */
  lado?: 'direita' | 'esquerda'
  className?: string
}

/**
 * Dica visual (design-system.md §5): devolve aos OLHOS o rótulo que um alvo de
 * ícone só mostra ao leitor de tela. Renderize-a DENTRO do alvo; ela se pendura
 * no elemento-pai.
 *
 * Ela é `fixed`, medida do alvo ao aparecer — NUNCA `absolute`: o trilho da
 * navegação recolhida vive numa lista `overflow-y-auto`, e overflow num eixo
 * força overflow no outro — uma dica absoluta era CLIPADA pela lista, e o
 * trilho ficava sem seu único rótulo visual (achado do parecer). `fixed`
 * escapa do clip dos ancestrais sem sair da árvore DOM: a dica continua
 * descendente do alvo, então mouseleave/focusout seguem valendo. Qualquer
 * rolagem a esconde (listener em capture) — coordenada de viewport envelhece
 * junto com o scroll.
 *
 * Ela é DECORATIVA por contrato — `aria-hidden`, sem foco, sem papel de widget.
 * O nome acessível do alvo NÃO PODE (MUST NOT) depender dela: quem usa leitor de
 * tela já ouve o rótulo (`sr-only`) e ouviria a dica duas vezes. Por isso não há
 * `role="tooltip"` nem `aria-describedby` — seria eco, e um widget a mais para o
 * teclado atravessar.
 *
 * **WCAG 2.2 SC 1.4.13** (conteúdo que aparece no hover/foco):
 * - *Dispensável*: Esc esconde a dica sem tirar o foco do alvo.
 * - *Sobrevoável*: a dica é filha do alvo e recebe o ponteiro — levar o mouse
 *   até ela não a faz sumir (um `pointer-events-none` mataria este critério). O
 *   afastamento de 8px é coberto por uma PONTE (`::before`): sem ela, o ponteiro
 *   atravessaria um vão fora do alvo, o `mouseleave` dispararia e a dica sumiria
 *   antes de ser alcançada — critério reprovado por um detalhe de 8 pixels.
 * - *Persistente*: só some por Esc, ou quando o alvo perde hover/foco.
 *
 * Daí ela precisar de estado: uma dica só de CSS (`group-hover`) não tem como
 * ser dispensada pelo teclado.
 */
export function DicaVisual({ children, lado = 'direita', className }: DicaVisualProps) {
  const referencia = useRef<HTMLSpanElement>(null)
  const [visivel, setVisivel] = useState(false)
  const [dispensada, setDispensada] = useState(false)
  // coordenadas de viewport, medidas do alvo no instante de aparecer
  const [posicao, setPosicao] = useState({ top: 0, lateral: 0 })

  useEffect(() => {
    const alvo = referencia.current?.parentElement
    if (alvo === null || alvo === undefined) return
    // function declaration é içada para antes do guard — o narrowing do `alvo`
    // não entra nela; este const pós-guard entra
    const alvoMedivel: HTMLElement = alvo

    // dispensar vale para a aparição CORRENTE, não para as futuras: sem este
    // reset, um Esc qualquer (fechar um dialog) envenenava a próxima passagem de
    // mouse de TODAS as dicas montadas — e no trilho a dica é o único rótulo visual
    function mostrar() {
      const caixa = alvoMedivel.getBoundingClientRect()
      setPosicao({
        top: caixa.top + caixa.height / 2,
        // `direita` ancora o left da dica na borda direita do alvo; `esquerda`
        // ancora o right (medido da borda direita da viewport) na borda esquerda
        lateral: lado === 'direita' ? caixa.right : window.innerWidth - caixa.left,
      })
      setVisivel(true)
      setDispensada(false)
    }

    // mouseleave/focusout NÃO disparam ao entrar num descendente: o ponteiro
    // pode caminhar do ícone até a dica sem que ela desapareça (1.4.13)
    function esconder() {
      setVisivel(false)
      setDispensada(false)
    }

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === 'Escape') setDispensada(true)
    }


    alvo.addEventListener('mouseenter', mostrar)
    alvo.addEventListener('mouseleave', esconder)
    alvo.addEventListener('focusin', mostrar)
    alvo.addEventListener('focusout', esconder)
    document.addEventListener('keydown', aoTeclar)
    // rolagem de QUALQUER container (capture): a coordenada fixa envelheceu
    document.addEventListener('scroll', esconder, { capture: true, passive: true })

    return () => {
      alvo.removeEventListener('mouseenter', mostrar)
      alvo.removeEventListener('mouseleave', esconder)
      alvo.removeEventListener('focusin', mostrar)
      alvo.removeEventListener('focusout', esconder)
      document.removeEventListener('keydown', aoTeclar)
      document.removeEventListener('scroll', esconder, { capture: true })
    }
  }, [lado])

  return (
    <span
      ref={referencia}
      aria-hidden="true"
      data-visivel={visivel && !dispensada ? 'sim' : 'nao'}
      style={lado === 'direita' ? { top: posicao.top, left: posicao.lateral } : { top: posicao.top, right: posicao.lateral }}
      className={cn(
        'fixed -translate-y-1/2 whitespace-nowrap',
        // a camada de tooltip existe justamente para não empatar com os
        // cabeçalhos fixos da grade (--z-fixo), que pintariam por cima
        'z-(--z-tooltip) rounded-controle bg-tooltip px-2 py-1 text-meta text-sobre-tooltip shadow-e2',
        'opacity-0 transition-opacity duration-(--duracao-1) motion-reduce:transition-none',
        'data-[visivel=nao]:invisible data-[visivel=sim]:opacity-100',
        // a ponte que cobre o vão de 8px — caminho contínuo de hover do alvo até a dica
        "before:absolute before:top-0 before:h-full before:w-2 before:content-['']",
        lado === 'direita' ? 'ml-2 before:-left-2' : 'mr-2 before:-right-2',
        className,
      )}
    >
      {children}
    </span>
  )
}
