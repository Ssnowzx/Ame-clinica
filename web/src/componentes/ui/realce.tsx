import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export interface RealceProps {
  tom: 'dica' | 'atencao'
  /** O rótulo é TEXTO, não só cor (1.4.1): quem não distingue o azul do âmbar ainda sabe qual é o cuidado. */
  rotulo: string
  icone: ReactNode
  texto: string
  /**
   * A saída, quando o aviso TEM uma (change `paciente-inativo-com-saida`).
   *
   * Um aviso que diz o que está errado e não oferece o caminho de volta é o beco que a ficha do
   * paciente inativo era: "Cadastro inativo" sem nenhuma ação ao lado. Opcional de propósito —
   * a maioria dos realces é informativa, e botão onde não há decisão vira ruído.
   */
  acao?: ReactNode
}

/**
 * Dica e Atenção: mesma forma, tons diferentes (design-system §8).
 *
 * Nasceu no manual do operador (change `manual-do-operador`) e subiu para o Design System na
 * rodada 4 de `vinculo-previo-para-agendar`, quando a tela de níveis precisou de um aviso
 * informativo — que NÃO é erro (`AvisoErro` é `role="alert"` e vermelho) e não substitui a tela.
 */
export function Realce({ tom, rotulo, icone, texto, acao }: RealceProps) {
  return (
    <div
      className={cn(
        // `flex-wrap` só importa quando há `acao`: no celular a saída desce para a linha de
        // baixo em vez de espremer o texto até a coluna de uma palavra
        'flex flex-wrap items-start gap-2 rounded-campo border-l-[3px] p-3',
        tom === 'dica'
          ? 'border-l-info-texto bg-info-suave text-info-texto'
          : 'border-l-alerta-texto bg-alerta-suave text-alerta-texto',
      )}
    >
      {/* Ícone e texto num item SÓ, e `basis-56 grow` nele — não no `<p>`. Duas razões, as duas
          medidas pelo gate: com base 0 (`flex-1`) o texto encolhia indefinidamente, a linha nunca
          estourava e o `flex-wrap` acima nunca disparava (o texto ficava numa coluna de ~18
          caracteres a 320px, com vão morto ao lado do botão); e com o piso no próprio `<p>`, o
          ÍCONE passava a ser o item que quebra — abaixo de ~248px de largura interna ele descia
          sozinho para uma linha, em todos os 40 realces do manual. Envolvendo os dois, quem desce
          é a AÇÃO, que é o que se queria. */}
      <div className="flex min-w-0 grow basis-56 items-start gap-2">
        {icone}
        <p className="min-w-0 text-corpo leading-relaxed">
          <strong className="font-semibold">{rotulo}: </strong>
          {texto}
        </p>
      </div>
      {acao !== undefined ? <div className="shrink-0">{acao}</div> : null}
    </div>
  )
}
