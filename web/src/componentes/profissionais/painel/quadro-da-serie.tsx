import { QuadroVazio } from '@/componentes/indicadores/estados-da-aba'
import {
  ColunasComDestaque,
  EquivalenteEmTabela,
  LegendaDoParcial,
  LegendaSemDados,
  QuadroDoGrafico,
} from '@/componentes/indicadores/graficos-do-painel'
import { rotuloCurtoDoMes, rotuloDoMes } from '@/lib/meses'

/** Um mês da série, já medido e escrito pelo chamador (contagem ou dinheiro). */
export interface PontoDaSerie {
  /** `YYYY-MM` */
  mes: string
  parcial: boolean
  /** O tamanho da coluna (contagem, ou o valor em reais só para a GEOMETRIA); `null` = SEM DADOS */
  medida: number | null
  /** O valor escrito sobre a coluna (curto: `1,8 mil`) */
  rotulo: string
  /** O valor exato, na tabela equivalente (`R$ 1.840,50`) */
  exato: string
}

/** Os meses sem dados em palavras: `mai–ago`, ou `mai` sozinho. */
function mesesSemDados(pontos: readonly PontoDaSerie[]): string | null {
  const vazios = pontos.filter((ponto) => ponto.medida === null)
  if (vazios.length === 0) {
    return null
  }

  return vazios.length === 1
    ? rotuloCurtoDoMes(vazios[0].mes)
    : `${rotuloCurtoDoMes(vazios[0].mes)}–${rotuloCurtoDoMes(vazios[vazios.length - 1].mes)}`
}

/**
 * A SÉRIE DE SEIS MESES do painel do profissional, no padrão dos Indicadores: o título diz a conclusão,
 * o valor vai escrito sobre cada coluna, o mês pedido em destaque e os anteriores recessivos. O mês antes
 * do início dos indicadores é HACHURADO e rotulado "sem dados" — nunca uma coluna zero —, e o mês em
 * curso leva o `*` no eixo, com a legenda dizendo "até hoje". A tabela equivalente traz os mesmos
 * valores, mês a mês, para quem não vê o gráfico.
 */
export function QuadroDaSerie({
  id,
  titulo,
  subtitulo,
  pontos,
  coluna,
  diaDeHoje,
  vazio,
}: {
  id: string
  titulo: string
  subtitulo: string
  pontos: readonly PontoDaSerie[]
  /** O cabeçalho da coluna de valores na tabela (`Realizados`) */
  coluna: string
  /** O dia de hoje no mês em curso (`5`), para a legenda do parcial */
  diaDeHoje: string
  /** A frase no lugar das colunas quando todo mês medido deu zero (DQ-22: nunca um gráfico de zeros) */
  vazio: string
}) {
  const tudoZero = pontos.every((ponto) => ponto.medida === null || ponto.medida === 0)

  return (
    <QuadroDoGrafico id={id} titulo={titulo} subtitulo={subtitulo}>
      {tudoZero ? <QuadroVazio>{vazio}</QuadroVazio> : <DesenhoDaSerie pontos={pontos} diaDeHoje={diaDeHoje} />}
      <EquivalenteEmTabela
        legenda={`${coluna} mês a mês, nos últimos seis meses`}
        colunas={[{ rotulo: 'Mês' }, { rotulo: coluna, numerica: true }]}
        linhas={pontos.map((ponto) => ({
          chave: ponto.mes,
          celulas: [
            ponto.parcial ? `${rotuloDoMes(ponto.mes)} (até hoje)` : rotuloDoMes(ponto.mes),
            ponto.medida === null ? 'sem dados' : ponto.exato,
          ],
        }))}
      />
    </QuadroDoGrafico>
  )
}

/** As colunas (o mês pedido em destaque) e as legendas do parcial e do "sem dados". */
function DesenhoDaSerie({ pontos, diaDeHoje }: { pontos: readonly PontoDaSerie[]; diaDeHoje: string }) {
  const maximo = Math.max(1, ...pontos.map((ponto) => ponto.medida ?? 0))
  const ultimo = pontos[pontos.length - 1]?.mes
  const semDados = mesesSemDados(pontos)
  const parcial = pontos.find((ponto) => ponto.parcial)

  return (
    <>
      <ColunasComDestaque
        colunas={pontos.map((ponto) => ({
          chave: ponto.mes,
          eixo: ponto.parcial ? `${rotuloCurtoDoMes(ponto.mes)}*` : rotuloCurtoDoMes(ponto.mes),
          proporcao: ponto.medida === null ? null : (ponto.medida / maximo) * 100,
          rotulo: ponto.medida === null ? undefined : ponto.rotulo,
          destaque: ponto.mes === ultimo,
        }))}
      />
      <div className="flex flex-col gap-1">
        {parcial === undefined ? null : <LegendaDoParcial mes={rotuloCurtoDoMes(parcial.mes)} dia={diaDeHoje} />}
        {semDados === null ? null : <LegendaSemDados>{semDados}: antes dos indicadores, sem dados</LegendaSemDados>}
      </div>
    </>
  )
}
