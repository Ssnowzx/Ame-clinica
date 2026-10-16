import { useEffect, useRef, useState, type RefObject } from 'react'

import { avaliarAlvoDoArrasto, lerAlvoDoSlot, type AlvoDeRemarcacao } from '@/lib/arrastar-remarcar'
import type { CardAgendamento as DadosDoCard } from '@/tipos'

/**
 * O gesto de arrastar-para-remarcar (D1): Pointer Events próprios, sem
 * dependência nova. Três decisões de performance que este componente encarna:
 *
 * - **Delegação no contêiner**: um `pointerdown` só, nativo — os ~330 cards
 *   memoizados não ganham handler nem prop nova, e a tabela não re-renderiza
 *   quando o gesto começa (o estado do arrasto vive AQUI, num irmão da tabela).
 * - **Ghost único por `transform`**: reposicionado direto no DOM em cada
 *   `pointermove` — NUNCA estado React no move (piso §16, grade cheia fluida).
 * - **Highlight por `data-*` + CSS**: a célula alvo ganha `data-alvo-arrasto`
 *   imperativamente; quem pinta é o Tailwind da própria célula.
 *
 * O que decide "alvo válido" é o modelo puro (`lib/arrastar-remarcar`); aqui só
 * mora a mecânica do ponteiro.
 */

/** Limiar de ativação no mouse (D1): abaixo dele, o clique de leitura segue vivo. */
const LIMIAR_MOUSE_PX = 4
/** Press-and-hold do toque (D1): antes disso, o dedo está rolando a grade. */
const ESPERA_TOQUE_MS = 250
/** Movimento que cancela o hold do toque — o scroll venceu o gesto. */
const TOLERANCIA_TOQUE_PX = 8
/** Deslocamento do ghost em relação ao ponteiro (não cobre o alvo do hit-test). */
const DESLOCAMENTO_FANTASMA_PX = 12

export interface DadosDoSoltar {
  card: DadosDoCard
  alvo: AlvoDeRemarcacao
}

interface CamadaDeArrastoProps {
  /** O contêiner rolável da grade — o gesto é delegado nele. */
  conteinerRef: RefObject<HTMLDivElement | null>
  /** Índice id→card da grade (bloqueio fica de fora: não é arrastável). */
  buscarCard: (id: number) => DadosDoCard | undefined
  /** Soltar num alvo VÁLIDO — quem abre a confirmação é a página (nunca grava direto). */
  aoSoltar: (dados: DadosDoSoltar) => void
  /**
   * As BORDAS do gesto: `true` quando o arrasto ativa, `false` quando termina (solto, cancelado
   * ou desmontado). A página pausa a atualização sozinha da grade no meio (change
   * lembrete-com-botoes-de-resposta, D11). Nunca chamado no `pointermove`.
   */
  aoMudarArrasto?: (arrastando: boolean) => void
}

interface Gesto {
  card: DadosDoCard
  pointerId: number
  toque: boolean
  x0: number
  y0: number
  x: number
  y: number
  ativo: boolean
  timer: number | null
  celulaAlvo: HTMLElement | null
  /**
   * O alvo JÁ RESOLVIDO — guardado, nunca recalculado no soltar.
   *
   * O horário vem da FAIXA sob o ponteiro, não da célula (a linha coberta por um `rowSpan` não
   * tem célula). Reler `celulaAlvo.dataset.slot` na hora de soltar descartava exatamente essa
   * resolução e devolvia o início do card — que era metade do defeito.
   */
  alvoResolvido: AlvoDeRemarcacao | null
  alvoValido: boolean
}

export function CamadaDeArrasto({ conteinerRef, buscarCard, aoSoltar, aoMudarArrasto }: CamadaDeArrastoProps) {
  const [cardArrastado, setCardArrastado] = useState<DadosDoCard | null>(null)
  const gesto = useRef<Gesto | null>(null)
  const fantasma = useRef<HTMLDivElement | null>(null)

  // callbacks vivas em refs: os listeners nativos são registrados UMA vez e não
  // são re-anexados a cada render da página
  const refBuscarCard = useRef(buscarCard)
  refBuscarCard.current = buscarCard
  const refAoSoltar = useRef(aoSoltar)
  refAoSoltar.current = aoSoltar
  const refAoMudarArrasto = useRef(aoMudarArrasto)
  refAoMudarArrasto.current = aoMudarArrasto

  useEffect(() => {
    const inicial = conteinerRef.current
    if (inicial === null) {
      return
    }
    // const pós-guard: as funções declaradas abaixo são içadas e não herdam o
    // narrowing do `if` — esta atribuição fixa o tipo não-nulo para todas
    const conteiner: HTMLDivElement = inicial

    function posicionarFantasma(x: number, y: number): void {
      if (fantasma.current !== null) {
        fantasma.current.style.transform = `translate(${x + DESLOCAMENTO_FANTASMA_PX}px, ${y + DESLOCAMENTO_FANTASMA_PX}px)`
      }
    }

    function limparAlvo(): void {
      const atual = gesto.current
      if (atual?.celulaAlvo != null) {
        delete atual.celulaAlvo.dataset.alvoArrasto
        atual.celulaAlvo = null
        atual.alvoResolvido = null
        atual.alvoValido = false
      }
    }

    /**
     * `preventDefault()` no pointermove NÃO impede o pan nativo (spec de
     * Pointer Events): num contêiner com overflow o navegador dispara
     * `pointercancel` e mata o gesto pós-hold. Com o gesto de TOQUE ativo,
     * este listener `touchmove` NÃO-passivo segura o scroll — e sai no
     * `encerrar()`. (touch-action dinâmico não serve: o navegador decide no
     * INÍCIO do toque.)
     */
    function impedirPanNativo(evento: TouchEvent): void {
      evento.preventDefault()
    }

    function encerrar(): void {
      const atual = gesto.current
      if (atual === null) {
        return
      }
      if (atual.timer !== null) {
        window.clearTimeout(atual.timer)
      }
      limparAlvo()
      window.removeEventListener('pointermove', aoMover)
      window.removeEventListener('pointerup', aoSoltarPonteiro)
      window.removeEventListener('pointercancel', aoCancelar)
      window.removeEventListener('keydown', aoTeclar)
      window.removeEventListener('touchmove', impedirPanNativo)
      if (atual.ativo) {
        try {
          conteiner.releasePointerCapture(atual.pointerId)
        } catch {
          // ponteiro já solto (ou ambiente de teste sem Pointer Capture real)
        }
        delete conteiner.dataset.arrastando
        refAoMudarArrasto.current?.(false)
      }
      gesto.current = null
      setCardArrastado(null)
    }

    function ativar(): void {
      const atual = gesto.current
      if (atual === null || atual.ativo) {
        return
      }
      atual.ativo = true
      if (atual.timer !== null) {
        window.clearTimeout(atual.timer)
        atual.timer = null
      }
      try {
        conteiner.setPointerCapture(atual.pointerId)
      } catch {
        // jsdom/polyfill: a captura é reforço, não pré-condição do gesto
      }
      if (atual.toque) {
        // NÃO-passivo de propósito: é o único jeito de o preventDefault valer
        window.addEventListener('touchmove', impedirPanNativo, { passive: false })
      }
      conteiner.dataset.arrastando = 'true'
      setCardArrastado(atual.card)
      refAoMudarArrasto.current?.(true)
    }

    /**
     * A faixa vertical em que o ponteiro caiu — MEDIDA, nunca calculada por constante.
     *
     * A altura de linha da grade é variável: um card com aviso de fim de pacote é mais alto que
     * um card simples. Assumir um número aqui é o mesmo erro que assumir a largura de coluna
     * pelo `min-w-48` quando a tabela distribui outra coisa.
     */
    function horarioSobOPonteiro(y: number): string | null {
      for (const linha of conteiner.querySelectorAll<HTMLElement>('tr[data-horario]')) {
        const faixa = linha.getBoundingClientRect()
        if (y >= faixa.top && y < faixa.bottom) {
          return linha.dataset.horario ?? null
        }
      }
      return null
    }

    function atualizarAlvo(x: number, y: number): void {
      const atual = gesto.current
      if (atual === null || !atual.ativo) {
        return
      }
      // jsdom não implementa elementFromPoint: sem hit-test, sem alvo (os testes o stubam)
      const alvoBruto =
        typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
      const celula = alvoBruto instanceof Element ? alvoBruto.closest<HTMLElement>('[data-slot]') : null
      if (celula === atual.celulaAlvo) {
        return
      }
      limparAlvo()
      if (celula === null || !conteiner.contains(celula)) {
        return
      }
      const alvoDaCelula = lerAlvoDoSlot(celula.dataset.slot)
      if (alvoDaCelula === null) {
        return
      }
      /*
       * O HORÁRIO vem da FAIXA sob o ponteiro, não da célula.
       *
       * A célula sob o cursor pode ser a de OUTRA linha: um card de dois slots vive num
       * `<td rowspan="2">`, e a linha coberta não é renderizada (`continuacao`). Ali o
       * `closest('[data-slot]')` sobe e devolve o INÍCIO do card — então soltar na metade de
       * baixo resolvia para a posição atual, o modelo recusava o não-movimento (certo) e o
       * gesto morria em silêncio. Adiantar uma sessão longa em um slot era impossível.
       *
       * A COLUNA da célula continua certa (profissional e data vêm dela); só o horário erra.
       *
       * Sem faixa encontrada — jsdom, ou ponteiro fora do corpo da grade — cai no horário da
       * célula, que é o comportamento antigo e nunca pior.
       */
      const horarioDaFaixa = horarioSobOPonteiro(y)
      const alvo = horarioDaFaixa === null ? alvoDaCelula : { ...alvoDaCelula, horario: horarioDaFaixa }
      const avaliacao = avaliarAlvoDoArrasto(atual.card, alvo, celula.dataset.slotIndisponivel === 'true')
      atual.celulaAlvo = celula
      atual.alvoResolvido = alvo
      atual.alvoValido = avaliacao.valido
      // célula inválida SINALIZA a recusa (cursor + fundo via CSS) e não aceita soltar
      celula.dataset.alvoArrasto = avaliacao.valido ? 'aceita' : 'recusa'
    }

    function aoMover(evento: PointerEvent): void {
      const atual = gesto.current
      if (atual === null || (evento.pointerId ?? 0) !== atual.pointerId) {
        return
      }
      atual.x = evento.clientX
      atual.y = evento.clientY
      if (!atual.ativo) {
        const distancia = Math.max(Math.abs(evento.clientX - atual.x0), Math.abs(evento.clientY - atual.y0))
        if (atual.toque) {
          // mexeu antes do press-and-hold: é rolagem da grade, não arrasto
          if (distancia > TOLERANCIA_TOQUE_PX) {
            encerrar()
          }
          return
        }
        if (distancia < LIMIAR_MOUSE_PX) {
          return
        }
        ativar()
      }
      evento.preventDefault()
      posicionarFantasma(evento.clientX, evento.clientY)
      atualizarAlvo(evento.clientX, evento.clientY)
    }

    // O clique que o navegador emite DEPOIS do soltar é engolido por uma flag
    // DETERMINÍSTICA: o listener de click em captura a consome UMA vez, e o
    // PRÓXIMO pointerdown a desarma — nunca um setTimeout(0) correndo contra o
    // event loop (se o clique não vier, a flag espera o próximo gesto).
    let cliqueDoSoltarPendente = false

    function consumirCliqueDoSoltar(evento: MouseEvent): void {
      if (!cliqueDoSoltarPendente) {
        return
      }
      cliqueDoSoltarPendente = false
      evento.stopPropagation()
      evento.preventDefault()
    }

    function desarmarCliqueDoSoltar(): void {
      cliqueDoSoltarPendente = false
    }

    function aoSoltarPonteiro(evento: PointerEvent): void {
      const atual = gesto.current
      if (atual === null || (evento.pointerId ?? 0) !== atual.pointerId) {
        return
      }
      if (!atual.ativo) {
        // clique curto: nada aconteceu aqui — o clique segue e abre o painel de leitura
        encerrar()
        return
      }
      const alvo =
        atual.alvoValido ? atual.alvoResolvido : null
      const card = atual.card
      cliqueDoSoltarPendente = true
      encerrar()
      // soltar fora de alvo válido (célula indisponível, mesma posição, fora da
      // grade) = cancelar: o card nunca saiu do lugar, nada a desfazer
      if (alvo !== null) {
        refAoSoltar.current({ card, alvo })
      }
    }

    function aoCancelar(evento: PointerEvent): void {
      const atual = gesto.current
      if (atual !== null && (evento.pointerId ?? 0) === atual.pointerId) {
        encerrar()
      }
    }

    function aoTeclar(evento: KeyboardEvent): void {
      if (evento.key === 'Escape' && gesto.current?.ativo === true) {
        encerrar()
      }
    }

    function aoPressionar(evento: PointerEvent): void {
      if (gesto.current !== null) {
        return // um arrasto por vez
      }
      if (evento.button > 0) {
        return // só o botão principal inicia o gesto
      }
      const origem =
        evento.target instanceof Element ? evento.target.closest<HTMLElement>('[data-card-id]') : null
      if (origem === null || !conteiner.contains(origem)) {
        return
      }
      const card = refBuscarCard.current(Number(origem.dataset.cardId))
      // bloqueio não carrega data-card-id, mas o índice é a segunda tranca
      if (card === undefined || card.tipo === 'bloqueio') {
        return
      }
      const toque = evento.pointerType === 'touch'
      const atual: Gesto = {
        card,
        pointerId: evento.pointerId ?? 0,
        toque,
        x0: evento.clientX,
        y0: evento.clientY,
        x: evento.clientX,
        y: evento.clientY,
        ativo: false,
        timer: null,
        celulaAlvo: null,
        alvoResolvido: null,
        alvoValido: false,
      }
      gesto.current = atual
      if (toque) {
        atual.timer = window.setTimeout(() => {
          ativar()
          posicionarFantasma(atual.x, atual.y)
          atualizarAlvo(atual.x, atual.y)
        }, ESPERA_TOQUE_MS)
      }
      window.addEventListener('pointermove', aoMover)
      window.addEventListener('pointerup', aoSoltarPonteiro)
      window.addEventListener('pointercancel', aoCancelar)
      window.addEventListener('keydown', aoTeclar)
    }

    conteiner.addEventListener('pointerdown', aoPressionar)
    // captura na janela: o consumo vê o clique antes de qualquer handler de
    // card, e o desarme acontece no pointerdown SEGUINTE, antes do clique dele
    window.addEventListener('click', consumirCliqueDoSoltar, { capture: true })
    window.addEventListener('pointerdown', desarmarCliqueDoSoltar, { capture: true })
    return () => {
      encerrar()
      conteiner.removeEventListener('pointerdown', aoPressionar)
      window.removeEventListener('click', consumirCliqueDoSoltar, { capture: true })
      window.removeEventListener('pointerdown', desarmarCliqueDoSoltar, { capture: true })
    }
  }, [conteinerRef])

  if (cardArrastado === null) {
    return null
  }

  const nome = cardArrastado.paciente?.nome_social ?? cardArrastado.paciente?.nome ?? 'Agendamento'

  return (
    // Ghost ÚNICO: decorativo (aria-hidden) e transparente ao ponteiro — o
    // elementFromPoint enxerga a célula por baixo dele.
    <div
      ref={(no) => {
        fantasma.current = no
        const atual = gesto.current
        if (no !== null && atual !== null) {
          no.style.transform = `translate(${atual.x + DESLOCAMENTO_FANTASMA_PX}px, ${atual.y + DESLOCAMENTO_FANTASMA_PX}px)`
        }
      }}
      aria-hidden="true"
      data-fantasma-arrasto
      className="pointer-events-none fixed left-0 top-0 z-(--z-tooltip) flex items-center gap-2 rounded-campo border border-linha-forte bg-superficie-elevada px-2.5 py-1.5 shadow-e3"
    >
      <span className="text-meta font-semibold tabular-nums text-texto">
        {cardArrastado.inicio.slice(11, 16)}
      </span>
      <span className="max-w-52 truncate text-corpo font-medium text-texto">{nome}</span>
    </div>
  )
}
