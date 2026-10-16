import type { LinhaDeProdutividade, PainelDaAgenda } from '@/tipos'

import { QuadroVazio } from '@/componentes/indicadores/estados-da-aba'
import { FaltasPorDia } from '@/componentes/indicadores/faltas-por-dia'
import { BarrasComDestaque, EquivalenteEmTabela, LegendaDoDestaque, QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { ParDeQuadros } from '@/componentes/indicadores/moldura-dos-indicadores'
import { SecaoDoPainel } from '@/componentes/profissionais/painel/secao-do-painel'
import { fraseDasHorasOciosas, perdasDoMes, tituloDaPerda } from '@/lib/indicadores/frases-do-profissional'
import { formatarMinutosEmHoras } from '@/lib/minutos'
import { formatarContagem } from '@/lib/numeros'

/**
 * ONDE A AGENDA NÃO RENDEU (D5): a diferença entre o que cabia e o que aconteceu, item a item — a mesma
 * conta da página de produtividade (faltas, horários liberados, os ocupados sem cobrança e as horas da
 * grade sem marcação), e as faltas por dia da semana do painel da agenda. Cada quadro sai do bloco que
 * o traz.
 */
export function OndeNaoRendeu({
  produtividade,
  agenda,
}: {
  /** `null` = permitido, mas sem linha de produtividade no mês */
  produtividade?: LinhaDeProdutividade | null
  agenda?: PainelDaAgenda
}) {
  if (produtividade === undefined && agenda === undefined) {
    return null
  }

  return (
    <SecaoDoPainel
      id="painel-onde-nao-rendeu"
      titulo="Onde a agenda não rendeu"
      subtitulo="Faltas e liberações seguem a situação marcada na agenda. Os sem cobrança são horários ocupados que não descontaram sessão nem viraram falta, como os que ainda estão em aberto."
    >
      <ParDeQuadros>
        {produtividade === undefined ? null : <PerdasDoMes linha={produtividade} />}
        {agenda === undefined ? null : <FaltasPorDia painel={agenda} id="painel-faltas-por-dia" />}
      </ParDeQuadros>
    </SecaoDoPainel>
  )
}

/** As perdas que se contam em sessões, a maior em destaque — e, à parte, as horas ociosas. */
function PerdasDoMes({ linha }: { linha: LinhaDeProdutividade | null }) {
  if (linha === null) {
    return (
      <QuadroDoGrafico id="painel-perdas" titulo="Sem grade nem marcação no mês" subtitulo="As perdas do mês inteiro, pela régua da produtividade">
        <QuadroVazio>Sem horário nem marcação neste mês, não há perda para medir.</QuadroVazio>
      </QuadroDoGrafico>
    )
  }
  const perdas = perdasDoMes(linha)
  const maior = Math.max(0, ...perdas.map((perda) => perda.quantidade))

  return (
    <QuadroDoGrafico id="painel-perdas" titulo={tituloDaPerda(perdas)} subtitulo="As perdas do mês inteiro, em sessões, pela régua da produtividade">
      {maior === 0 ? (
        <QuadroVazio>Nenhuma falta, liberação ou horário sem cobrança no mês.</QuadroVazio>
      ) : (
        <>
          <BarrasComDestaque
            barras={perdas.map((perda) => ({
              chave: perda.chave,
              rotulo: perda.rotulo,
              proporcao: (perda.quantidade / maior) * 100,
              valor: formatarContagem(perda.quantidade),
              destaque: perda.quantidade === maior,
            }))}
          />
          <LegendaDoDestaque>A maior perda do mês</LegendaDoDestaque>
        </>
      )}
      <p className="text-pretty text-corpo text-texto-suave">{fraseDasHorasOciosas(linha)}</p>
      <EquivalenteEmTabela
        legenda="Onde a agenda não rendeu no mês"
        colunas={[{ rotulo: 'Perda' }, { rotulo: 'Quanto', numerica: true }]}
        linhas={[
          ...perdas.map((perda) => ({ chave: perda.chave, celulas: [perda.rotulo, formatarContagem(perda.quantidade)] })),
          { chave: 'ociosas', celulas: ['Horas ociosas (sem marcação)', formatarMinutosEmHoras(linha.minutos_ociosos)] },
        ]}
      />
    </QuadroDoGrafico>
  )
}
