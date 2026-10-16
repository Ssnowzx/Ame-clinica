import type { VozDaFicha } from '@/lib/indicadores/frases-do-profissional'
import type { LinhaDeProdutividade, PainelDaAgenda } from '@/tipos'

import { QuadroVazio } from '@/componentes/indicadores/estados-da-aba'
import { BarrasComDestaque, EquivalenteEmTabela, LegendaDoDestaque, QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { MapaDeOcupacao } from '@/componentes/indicadores/mapa-de-ocupacao'
import { ParDeQuadros } from '@/componentes/indicadores/moldura-dos-indicadores'
import { SecaoDoPainel } from '@/componentes/profissionais/painel/secao-do-painel'
import { diaPorExtenso, tituloDoMapa } from '@/lib/indicadores/frases'
import { aAgendaDe, tituloDoDiaMaisCheio } from '@/lib/indicadores/frases-do-profissional'
import { formatarMinutosEmHoras } from '@/lib/minutos'
import { formatarContagem } from '@/lib/numeros'

/**
 * A SEMANA (D5): o mapa dia × período do dia (o `MapaDeOcupacao` dos Indicadores, no recorte dele) e os
 * atendimentos por dia da semana. Cada quadro sai do bloco que o traz — o mapa da `agenda`, as barras da
 * `produtividade` —, e o que não veio não deixa quadro vazio no lugar.
 */
export function ASemana({
  agenda,
  produtividade,
  voz,
}: {
  agenda?: PainelDaAgenda
  /** `null` = permitido, mas sem linha de produtividade no mês */
  produtividade?: LinhaDeProdutividade | null
  voz: VozDaFicha
}) {
  if (agenda === undefined && produtividade === undefined) {
    return null
  }

  return (
    <SecaoDoPainel id="painel-a-semana" titulo="A semana" subtitulo={`Em que dias e períodos ${aAgendaDe(voz)} enche.`}>
      <ParDeQuadros>
        {agenda === undefined ? null : (
          <QuadroDoGrafico
            id="painel-mapa-de-ocupacao"
            titulo={tituloDoMapa(agenda.ocupacao_por_periodo)}
            subtitulo="Ocupação por dia da semana e período do dia — mais escuro, mais cheio"
          >
            {agenda.ocupacao_por_periodo.length === 0 ? (
              <QuadroVazio>Sem horário e especialidade cadastrados não há grade para medir a ocupação.</QuadroVazio>
            ) : (
              <MapaDeOcupacao celulas={agenda.ocupacao_por_periodo} />
            )}
          </QuadroDoGrafico>
        )}
        {produtividade === undefined ? null : <AtendimentosPorDia linha={produtividade} />}
      </ParDeQuadros>
    </SecaoDoPainel>
  )
}

/**
 * Os atendimentos REALIZADOS por dia da semana, no mês inteiro (a régua da produtividade): o dia mais
 * cheio em destaque. Os marcados vão na tabela — eles contam também o que ainda vai acontecer.
 */
function AtendimentosPorDia({ linha }: { linha: LinhaDeProdutividade | null }) {
  const dias = (linha?.por_dia_da_semana ?? []).filter((dia) => dia.minutos_na_grade > 0 || dia.marcados > 0)

  return (
    <QuadroDoGrafico
      id="painel-atendimentos-por-dia"
      titulo={dias.length === 0 ? 'Nenhum dia com grade ou marcação no mês' : tituloDoDiaMaisCheio(dias)}
      subtitulo="Atendimentos realizados no mês inteiro, por dia da semana"
    >
      {dias.length === 0 ? (
        <QuadroVazio>Sem horário nem marcação neste mês, não há dia para comparar.</QuadroVazio>
      ) : (
        <>
          <BarrasDosDias dias={dias} />
          <EquivalenteEmTabela
            legenda="Grade, marcados e realizados por dia da semana"
            colunas={[
              { rotulo: 'Dia' },
              { rotulo: 'Na grade', numerica: true },
              { rotulo: 'Marcados', numerica: true },
              { rotulo: 'Realizados', numerica: true },
            ]}
            linhas={dias.map((dia) => ({
              chave: String(dia.dia),
              celulas: [diaPorExtenso(dia.dia), formatarMinutosEmHoras(dia.minutos_na_grade), formatarContagem(dia.marcados), formatarContagem(dia.realizados)],
            }))}
          />
        </>
      )}
    </QuadroDoGrafico>
  )
}

/** As barras dos realizados, o dia mais cheio em destaque — ou a frase, se nenhum foi realizado ainda. */
function BarrasDosDias({ dias }: { dias: LinhaDeProdutividade['por_dia_da_semana'] }) {
  const maior = Math.max(0, ...dias.map((dia) => dia.realizados))
  if (maior === 0) {
    return <QuadroVazio>Nenhum atendimento realizado no mês até agora.</QuadroVazio>
  }

  return (
    <>
      <BarrasComDestaque
        barras={dias.map((dia) => ({
          chave: String(dia.dia),
          rotulo: diaPorExtenso(dia.dia),
          proporcao: (dia.realizados / maior) * 100,
          valor: formatarContagem(dia.realizados),
          destaque: dia.realizados === maior,
        }))}
      />
      <LegendaDoDestaque>O dia com mais atendimentos</LegendaDoDestaque>
    </>
  )
}
