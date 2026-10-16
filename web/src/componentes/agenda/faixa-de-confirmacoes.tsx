import { useId, useState } from 'react'

import { PELE_DA_CONFIRMACAO } from '@/componentes/agenda/pele-da-confirmacao'
import { cn } from '@/lib/cn'
import {
  ESTADOS_DA_CONFIRMACAO,
  fraseDoDestaque,
  rotuloDaContagem,
  type ContagemDasConfirmacoes,
} from '@/lib/confirmacao-do-lembrete'
import type { EstadoDaConfirmacao } from '@/tipos'

interface FaixaDeConfirmacoesProps {
  /** A contagem dos cartões que a grade JÁ desenhou — nenhuma leitura a mais no servidor (D9). */
  contagem: ContagemDasConfirmacoes
  destaque: EstadoDaConfirmacao | null
  aoDestacar: (estado: EstadoDaConfirmacao | null) => void
}

/**
 * A FAIXA DO TOPO da agenda (change lembrete-com-botoes-de-resposta, D9): quantas famílias
 * confirmaram, quantas não responderam, quantas pediram para desmarcar e quantos lembretes não
 * chegaram — para a recepção ligar só para quem precisa.
 *
 * Cada número é um botão de alternar (`aria-pressed`): tocar DESTACA os cartões daquele estado e
 * tocar de novo desfaz. Destacar não esconde nada — a grade é o mapa do dia, e um cartão sumido
 * seria um horário que parece livre.
 *
 * Estado com zero não aparece (zero não é notícia, como na barra do sino), e a faixa inteira some
 * quando nenhum cartão do período teve lembrete — com DUAS exceções, porque a busca de minuto em
 * minuto pode zerar um número enquanto alguém está nele (achado A11Y-BT-05 do gate):
 * - o botão PRESSIONADO fica, mesmo com 0, até a pessoa desfazer — sem ele, a grade ficaria toda
 *   sem cor e sem o botão que a devolve;
 * - o botão com FOCO fica enquanto tiver o foco — um botão sumindo debaixo do teclado joga o foco
 *   no `body`, e quem navega sem ver a tela perde o lugar.
 */
export function FaixaDeConfirmacoes({ contagem, destaque, aoDestacar }: FaixaDeConfirmacoesProps) {
  const idDoRotulo = useId()
  const [estadoComFoco, setEstadoComFoco] = useState<EstadoDaConfirmacao | null>(null)
  // A frase do destaque, fixada no TOQUE: se acompanhasse a contagem, a busca de fundo a mudaria
  // de minuto em minuto, e a região falaria sem ninguém ter pedido
  const [anuncio, setAnuncio] = useState('')

  const presentes = ESTADOS_DA_CONFIRMACAO.filter(
    (estado) => contagem[estado] > 0 || estado === destaque || estado === estadoComFoco,
  )

  if (presentes.length === 0) {
    return null
  }

  return (
    <div role="group" aria-labelledby={idDoRotulo} className="flex flex-wrap items-center gap-2">
      <span id={idDoRotulo} className="text-rotulo text-texto-suave">
        Respostas ao lembrete
      </span>
      {presentes.map((estado) => {
        const pele = PELE_DA_CONFIRMACAO[estado]
        const marcado = destaque === estado

        return (
          <button
            key={estado}
            type="button"
            aria-pressed={marcado}
            onClick={() => {
              aoDestacar(marcado ? null : estado)
              setAnuncio(marcado ? '' : fraseDoDestaque(estado, contagem[estado]))
            }}
            onFocus={() => {
              setEstadoComFoco(estado)
            }}
            onBlur={() => {
              setEstadoComFoco(null)
            }}
            className={cn(
              // h-8: 32px de alvo (2.5.8); o peso acompanha o `aria-pressed` — a cor nunca é o sinal só
              'inline-flex h-8 items-center gap-1.5 rounded-pilula border px-3 text-meta tabular-nums',
              'transition-colors duration-(--duracao-1) motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
              marcado
                ? cn('font-semibold', pele.botaoMarcado)
                : 'border-linha-forte bg-superficie font-medium text-texto hover:bg-fundo',
            )}
          >
            <pele.icone aria-hidden="true" className={cn('size-3.5 shrink-0', marcado ? undefined : pele.corDoIcone)} />
            {rotuloDaContagem(estado, contagem[estado])}
          </button>
        )
      })}
      {/* Região viva que nasce com a faixa, VAZIA, antes de qualquer toque — região criada já com
          o texto dentro não é anunciada de forma confiável. `sr-only` é absoluta: não ocupa lugar
          na linha dos botões. */}
      <p role="status" className="sr-only">
        {anuncio}
      </p>
    </div>
  )
}
