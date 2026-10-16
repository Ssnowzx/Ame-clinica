import type { PainelDaAgenda } from '@/tipos'

import { QuadroVazio } from '@/componentes/indicadores/estados-da-aba'
import {
  ColunasComDestaque,
  EquivalenteEmTabela,
  LegendaDoDestaque,
  QuadroDoGrafico,
} from '@/componentes/indicadores/graficos-do-painel'
import { diaCurto, diaPorExtenso, formatarTaxa, plural, tituloDasFaltasPorDia } from '@/lib/indicadores/frases'
import { formatarContagem } from '@/lib/numeros'

/**
 * As FALTAS POR DIA DA SEMANA de um painel da agenda — o quadro da aba Agenda dos Indicadores e da ficha
 * do profissional ("Onde a agenda não rendeu"), um só desenho para as duas. O título diz o pior dia; sem
 * sessão que já passou, ou sem falta nenhuma, a frase fica no lugar de um gráfico de colunas zeradas
 * (DQ-22).
 */
export function FaltasPorDia({ painel, id = 'faltas-por-dia' }: { painel: PainelDaAgenda; id?: string }) {
  const linhas = [...painel.faltas_por_dia_semana].sort((a, b) => a.dia - b.dia)
  const maior = Math.max(0, ...linhas.map((linha) => linha.taxa))
  const semSessoes = painel.sessoes_passadas.atual === 0 || linhas.length === 0

  return (
    <QuadroDoGrafico
      id={id}
      titulo={semSessoes ? 'Ainda não há sessões que já passaram' : tituloDasFaltasPorDia(linhas)}
      subtitulo="Faltas por dia da semana, em % das sessões daquele dia que já passaram"
    >
      {semSessoes ? <QuadroVazio>As faltas aparecem aqui quando as primeiras sessões do período passarem.</QuadroVazio> : null}
      {!semSessoes && maior === 0 ? (
        <QuadroVazio>
          Nenhuma das {plural(painel.sessoes_passadas.atual, 'sessão que já passou', 'sessões que já passaram')} teve falta.
        </QuadroVazio>
      ) : null}
      {!semSessoes && maior > 0 ? <ColunasDasFaltas linhas={linhas} maior={maior} /> : null}
    </QuadroDoGrafico>
  )
}

/** As colunas das faltas por dia: o pior dia em destaque, e a tabela equivalente. */
function ColunasDasFaltas({ linhas, maior }: { linhas: PainelDaAgenda['faltas_por_dia_semana']; maior: number }) {
  return (
    <>
      <ColunasComDestaque
        colunas={linhas.map((linha) => ({
          chave: String(linha.dia),
          eixo: diaCurto(linha.dia),
          // escala pelo MAIOR dia: a diferença entre os dias é o assunto, não a distância do 100%
          proporcao: (linha.taxa / maior) * 100,
          rotulo: formatarTaxa(linha.taxa),
          destaque: linha.taxa === maior,
        }))}
      />
      <LegendaDoDestaque>O dia com mais faltas</LegendaDoDestaque>
      <EquivalenteEmTabela
        legenda="Faltas por dia da semana nas sessões que já passaram"
        colunas={[
          { rotulo: 'Dia' },
          { rotulo: 'Sessões', numerica: true },
          { rotulo: 'Faltas', numerica: true },
          { rotulo: '% de faltas', numerica: true },
        ]}
        linhas={linhas.map((linha) => ({
          chave: String(linha.dia),
          celulas: [diaPorExtenso(linha.dia), formatarContagem(linha.sessoes), formatarContagem(linha.faltas), formatarTaxa(linha.taxa)],
        }))}
      />
    </>
  )
}
