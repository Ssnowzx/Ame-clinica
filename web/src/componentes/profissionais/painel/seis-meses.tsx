import type { VozDaFicha } from '@/lib/indicadores/frases-do-profissional'
import type { BaseDoPainel, MesDaSerieDoProfissional, PainelDaAgenda, ParDoPainel } from '@/tipos'

import { ParDeQuadros } from '@/componentes/indicadores/moldura-dos-indicadores'
import { QuadroDaSerie, type PontoDaSerie } from '@/componentes/profissionais/painel/quadro-da-serie'
import { SecaoDoPainel } from '@/componentes/profissionais/painel/secao-do-painel'
import { avisoDeSemComparacao } from '@/lib/indicadores/frases'
import {
  ATENDIMENTOS,
  atendimentosDe,
  diaDeHojeDoPeriodo,
  FALTAS,
  tituloDaTendenciaDaContagem,
  type CoisaContada,
} from '@/lib/indicadores/frases-do-profissional'
import { formatarContagem } from '@/lib/numeros'

/**
 * Os pontos de uma série de contagem: `sem_dados` (ou o número nulo) vira coluna hachurada, nunca zero.
 * Quem monta "Seis meses" garante que as contagens vieram (só com a produtividade); a ausência, se um
 * dia escapar, também vira "sem dados" — jamais um zero que o servidor não mandou.
 */
function pontosDaContagem(
  serie: readonly MesDaSerieDoProfissional[],
  valor: (mes: MesDaSerieDoProfissional) => number | null | undefined,
): PontoDaSerie[] {
  return serie.map((mes) => {
    const medida = mes.sem_dados ? null : (valor(mes) ?? null)

    return {
      mes: mes.mes,
      parcial: mes.parcial,
      medida,
      rotulo: medida === null ? '' : formatarContagem(medida),
      exato: medida === null ? '' : formatarContagem(medida),
    }
  })
}

/**
 * SEIS MESES (D2/D5): as colunas mês a mês dos realizados e das faltas. O título é a conclusão pela
 * comparação JUSTA do painel (o mesmo período do mês anterior, como no recebido dos Indicadores); sem o
 * bloco da agenda para comparar, o título só diz o que a série mede.
 */
export function SeisMeses({
  base,
  serie,
  agenda,
  voz,
}: {
  base: BaseDoPainel
  serie: readonly MesDaSerieDoProfissional[]
  agenda?: PainelDaAgenda
  voz: VozDaFicha
}) {
  const dia = diaDeHojeDoPeriodo(base)
  const titulo = (par: ParDoPainel<number> | undefined, coisa: CoisaContada, semPar: string): string =>
    par === undefined ? semPar : tituloDaTendenciaDaContagem(par, base, coisa)

  return (
    <SecaoDoPainel
      id="painel-seis-meses"
      titulo="Seis meses"
      subtitulo={`Os ${atendimentosDe(voz)}, mês a mês, nos seis meses que terminam no mês escolhido.${avisoDeSemComparacao(base)}`}
    >
      <ParDeQuadros>
        <QuadroDaSerie
          id="painel-serie-realizados"
          titulo={titulo(agenda?.realizadas, ATENDIMENTOS, 'Atendimentos realizados mês a mês')}
          subtitulo="Atendimentos realizados por mês"
          pontos={pontosDaContagem(serie, (mes) => mes.realizados)}
          coluna="Realizados"
          diaDeHoje={dia}
          vazio="Nenhum atendimento realizado nos seis meses."
        />
        <QuadroDaSerie
          id="painel-serie-faltas"
          titulo={titulo(agenda === undefined ? undefined : faltasEmPar(agenda), FALTAS, 'Faltas mês a mês')}
          subtitulo="Sessões com status que marca falta, por mês"
          pontos={pontosDaContagem(serie, (mes) => mes.faltas)}
          coluna="Faltas"
          diaDeHoje={dia}
          vazio="Nenhuma falta nos seis meses."
        />
      </ParDeQuadros>
    </SecaoDoPainel>
  )
}

/** As faltas do painel da agenda como par de contagens (o painel as manda com a taxa junto). */
function faltasEmPar(agenda: PainelDaAgenda): ParDoPainel<number> {
  return { atual: agenda.faltas.atual.quantidade, anterior: agenda.faltas.anterior?.quantidade ?? null }
}
