import { CalendarRange } from 'lucide-react'
import type { ReactNode } from 'react'

import type { BaseDoPainel } from '@/tipos'

import { usePeriodoDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'
import { Botao } from '@/componentes/ui/botao'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { motivoDeSemDados } from '@/lib/indicadores/frases'
import { rotuloDoMes } from '@/lib/meses'

/**
 * Os estados VAZIOS de uma aba de detalhe. O carregando (o esqueleto na caixa de cada peça) mora em
 * `moldura-dos-indicadores`, o módulo leve que a área usa também enquanto o código da aba chega.
 */

/**
 * O mês anterior ao histórico da clínica: nada de zeros. A ação leva ao primeiro mês com dados —
 * pelo período da ÁREA (a URL), então as outras abas vão junto.
 */
export function SemHistoricoNaAba({ base }: { base: BaseDoPainel }) {
  const { trocarMes } = usePeriodoDosIndicadores()
  const inicio = base.inicio_historico

  return (
    <EstadoVazio
      nivel={2}
      icone={<CalendarRange className="size-8" />}
      titulo="Sem dados para este mês"
      descricao={motivoDeSemDados(base)}
      acao={
        inicio === null ? undefined : (
          <Botao variante="primario" onClick={() => trocarMes(inicio)}>
            Ver {rotuloDoMes(inicio)}
          </Botao>
        )
      }
    />
  )
}

/** Um quadro sem o que desenhar: a frase do porquê, no lugar do gráfico (nunca um gráfico em branco). */
export function QuadroVazio({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-campo border border-dashed border-linha-forte px-4 py-6 text-center text-pretty text-corpo text-texto-suave">
      {children}
    </p>
  )
}
