import { CartaoComErro, CartaoDoIndicador, CartaoSemDados } from '@/componentes/indicadores/cartao-do-indicador'
import {
  ColunasComDestaque,
  EquivalenteEmTabela,
  LegendaDoParcial,
  LegendaSemDados,
  QuadroDoGrafico,
} from '@/componentes/indicadores/graficos-do-painel'
import { CartaoPendente, QuadroPendente } from '@/componentes/indicadores/moldura-dos-indicadores'
import { formatarBRL } from '@/lib/dinheiro'
import {
  DEFINICAO_DAS_EVOLUCOES_EM_DIA,
  DEFINICAO_DO_RECEBIDO,
  DEFINICAO_DOS_ATIVOS,
  definicaoDaOcupacao,
} from '@/lib/indicadores/definicoes'
import {
  avisoDeSemComparacao,
  compararMoeda,
  compararTaxa,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarTaxa,
  fraseDasEvolucoes,
  fraseDoCartaoDaAgenda,
  fraseDoCartaoDoDinheiro,
  fraseDoCartaoDosPacientes,
  linhaDosNovos,
  mesAntesDoHistorico,
  tituloDaTendenciaDoRecebido,
} from '@/lib/indicadores/frases'
import { usePainelDaAgenda, usePainelDaEquipe, usePainelDoDinheiro, usePainelDosPacientes } from '@/lib/indicadores/paineis'
import { rotuloCurtoDoMes, rotuloDoMes } from '@/lib/meses'
import { formatarContagem } from '@/lib/numeros'
import type { PainelDoDinheiro } from '@/tipos'

/**
 * Os QUATRO CARTÕES da Visão geral (D6) — um por frente, cada um com a SUA consulta e os seus
 * quatro estados. Quem monta cada cartão é a página, e só com a permissão do módulo dono do painel:
 * o cartão sem permissão não existe, e por isso não busca (T-not-13).
 *
 * Os quatro têm a MESMA anatomia (DQ-05): número, legenda curta, a linha da comparação (ou, nos
 * Pacientes, a dos novos, sem seta), a frase e a porta. O esqueleto de cada um reserva as linhas
 * que a frase dele costuma ter no celular (PERF-01).
 *
 * Cada cartão é porta para a aba de detalhe da frente — que exige a MESMA permissão do painel, então
 * a porta nunca promete uma tela que o servidor recusaria.
 */

export function CartaoDoDinheiro({ mes }: { mes: string }) {
  const consulta = usePainelDoDinheiro(mes)
  const rotulo = 'Dinheiro'

  if (consulta.isPending) {
    return <CartaoPendente rotulo={rotulo} linhasDaFrase={[5, 4, 3]} comPorta />
  }
  if (consulta.isError) {
    return (
      <CartaoComErro
        rotulo={rotulo}
        mensagem="Não foi possível carregar os números do dinheiro."
        aoTentarNovamente={() => void consulta.refetch()}
      />
    )
  }
  const painel = consulta.data
  if (mesAntesDoHistorico(painel)) {
    return <CartaoSemDados rotulo={rotulo} definicao={DEFINICAO_DO_RECEBIDO} />
  }

  return (
    <CartaoDoIndicador
      rotulo={rotulo}
      valor={formatarMoeda(painel.recebido.atual)}
      legenda="recebido"
      comparacao={compararMoeda(painel.recebido, painel.periodo, 'subir-e-bom')}
      frase={fraseDoCartaoDoDinheiro(painel)}
      definicao={DEFINICAO_DO_RECEBIDO}
      porta={{ para: `/indicadores/financeiro?mes=${mes}`, rotulo: 'Ver o financeiro do mês' }}
    />
  )
}

export function CartaoDaAgenda({ mes }: { mes: string }) {
  const consulta = usePainelDaAgenda(mes)
  const rotulo = 'Agenda'

  if (consulta.isPending) {
    return <CartaoPendente rotulo={rotulo} linhasDaFrase={[7, 5, 4]} comPorta />
  }
  if (consulta.isError) {
    return (
      <CartaoComErro
        rotulo={rotulo}
        mensagem="Não foi possível carregar os números da agenda."
        aoTentarNovamente={() => void consulta.refetch()}
      />
    )
  }
  const painel = consulta.data
  if (mesAntesDoHistorico(painel)) {
    return <CartaoSemDados rotulo={rotulo} definicao={definicaoDaOcupacao(painel)} />
  }

  return (
    <CartaoDoIndicador
      rotulo={rotulo}
      valor={painel.ocupacao.atual === null ? null : formatarTaxa(painel.ocupacao.atual)}
      legenda="ocupação"
      comparacao={compararTaxa(painel.ocupacao.atual, painel.ocupacao.anterior, painel.periodo, 'subir-e-bom')}
      frase={fraseDoCartaoDaAgenda(painel)}
      definicao={definicaoDaOcupacao(painel)}
      porta={{ para: `/indicadores/agenda?mes=${mes}`, rotulo: 'Ver a agenda do mês' }}
    />
  )
}

export function CartaoDosPacientes({ mes }: { mes: string }) {
  const consulta = usePainelDosPacientes(mes)
  const rotulo = 'Pacientes'

  if (consulta.isPending) {
    return <CartaoPendente rotulo={rotulo} linhasDaFrase={[4, 4, 2]} comPorta />
  }
  if (consulta.isError) {
    return (
      <CartaoComErro
        rotulo={rotulo}
        mensagem="Não foi possível carregar os números dos pacientes."
        aoTentarNovamente={() => void consulta.refetch()}
      />
    )
  }
  const painel = consulta.data
  if (mesAntesDoHistorico(painel)) {
    return <CartaoSemDados rotulo={rotulo} definicao={DEFINICAO_DOS_ATIVOS} />
  }

  return (
    // os ATIVOS são uma foto do momento: sem comparação por natureza (nem "sem comparação") — no
    // lugar dela, a linha dos NOVOS, sem seta
    <CartaoDoIndicador
      rotulo={rotulo}
      valor={formatarContagem(painel.ativos)}
      legenda="em atendimento"
      contexto={linhaDosNovos(painel)}
      frase={fraseDoCartaoDosPacientes(painel)}
      definicao={DEFINICAO_DOS_ATIVOS}
      porta={{ para: `/indicadores/pacientes?mes=${mes}`, rotulo: 'Ver os pacientes do mês' }}
    />
  )
}

export function CartaoDaEquipe({ mes }: { mes: string }) {
  const consulta = usePainelDaEquipe(mes)
  const rotulo = 'Equipe'

  if (consulta.isPending) {
    return <CartaoPendente rotulo={rotulo} linhasDaFrase={[4, 4, 2]} comPorta />
  }
  if (consulta.isError) {
    return (
      <CartaoComErro
        rotulo={rotulo}
        mensagem="Não foi possível carregar os números da equipe."
        aoTentarNovamente={() => void consulta.refetch()}
      />
    )
  }
  const painel = consulta.data
  if (mesAntesDoHistorico(painel)) {
    return <CartaoSemDados rotulo={rotulo} definicao={DEFINICAO_DAS_EVOLUCOES_EM_DIA} />
  }
  const emDia = painel.evolucoes.em_dia

  return (
    <CartaoDoIndicador
      rotulo={rotulo}
      valor={emDia.atual === null ? null : formatarTaxa(emDia.atual)}
      legenda="com evolução em dia"
      comparacao={compararTaxa(emDia.atual, emDia.anterior, painel.periodo, 'subir-e-bom')}
      frase={fraseDasEvolucoes(painel)}
      definicao={DEFINICAO_DAS_EVOLUCOES_EM_DIA}
      porta={{ para: `/indicadores/equipe?mes=${mes}`, rotulo: 'Ver a equipe do mês' }}
    />
  )
}

/** Dia do mês sem o zero: `"2026-10-05"` → `5`. */
function diaDe(ymd: string): string {
  return String(Number(ymd.slice(8, 10)))
}

/**
 * Os meses SEM DADOS em palavras: `mai–ago`, ou `mai` sozinho — o trecho contínuo antes do histórico.
 */
function mesesSemDados(serie: PainelDoDinheiro['serie_recebido']): string | null {
  const vazios = serie.filter((bucket) => bucket.valor === null)
  if (vazios.length === 0) {
    return null
  }
  const [primeiro, ultimo] = [vazios[0].mes, vazios[vazios.length - 1].mes]

  return primeiro === ultimo ? rotuloCurtoDoMes(primeiro) : `${rotuloCurtoDoMes(primeiro)}–${rotuloCurtoDoMes(ultimo)}`
}

/** As colunas da série: o mês pedido em destaque e, se ele está em curso, com o eixo curto `out*`. */
function colunasDoRecebido(painel: PainelDoDinheiro) {
  const maximo = Math.max(1, ...painel.serie_recebido.map((bucket) => (bucket.valor === null ? 0 : Number(bucket.valor))))
  const ultimo = painel.serie_recebido[painel.serie_recebido.length - 1]?.mes

  return painel.serie_recebido.map((bucket) => ({
    chave: bucket.mes,
    eixo: bucket.mes === ultimo && painel.periodo.parcial ? `${rotuloCurtoDoMes(bucket.mes)}*` : rotuloCurtoDoMes(bucket.mes),
    // `Number()` só dimensiona a GEOMETRIA da coluna — o valor escrito sai da string (D1)
    proporcao: bucket.valor === null ? null : (Number(bucket.valor) / maximo) * 100,
    rotulo: bucket.valor === null ? undefined : formatarMoedaCompacta(bucket.valor, { semSimbolo: true }),
    destaque: bucket.mes === ultimo,
  }))
}

const TITULO_DA_TENDENCIA_PENDENTE = 'Tendência do recebido'

/**
 * A TENDÊNCIA do recebido, 6 meses (D9): o mês pedido em destaque, os anteriores recessivos, e os
 * meses antes do sistema HACHURADOS e nomeados — nunca colunas zeradas (maio a agosto apareciam
 * vazios e liam como "a clínica não recebeu nada"). O título diz a conclusão pela comparação JUSTA:
 * o mês em curso contra o mesmo trecho do anterior, nunca contra o mês cheio.
 */
export function TendenciaDoRecebido({ mes }: { mes: string }) {
  const consulta = usePainelDoDinheiro(mes)

  if (consulta.isPending) {
    return <QuadroPendente titulo={TITULO_DA_TENDENCIA_PENDENTE} altura="h-62" />
  }
  // o erro do painel já aparece no cartão Dinheiro, com o tentar de novo: repetir aqui seria ruído
  if (consulta.isError || mesAntesDoHistorico(consulta.data)) {
    return null
  }

  return <QuadroDaTendencia painel={consulta.data} />
}

function QuadroDaTendencia({ painel }: { painel: PainelDoDinheiro }) {
  const semDados = mesesSemDados(painel.serie_recebido)

  return (
    <QuadroDoGrafico
      id="tendencia-do-recebido"
      titulo={tituloDaTendenciaDoRecebido(painel)}
      // sem comparação, o PORQUÊ vem aqui; o título fica com a conclusão (DQ-21)
      subtitulo={`Recebido por mês, em reais, pelo regime de caixa.${avisoDeSemComparacao(painel)}`}
    >
      <ColunasComDestaque colunas={colunasDoRecebido(painel)} />
      <div className="flex flex-col gap-1">
        {painel.periodo.parcial ? <LegendaDoParcial mes={rotuloCurtoDoMes(painel.periodo.mes)} dia={diaDe(painel.periodo.ate)} /> : null}
        {semDados === null ? null : <LegendaSemDados>{semDados}: antes dos indicadores, sem dados</LegendaSemDados>}
      </div>
      <EquivalenteEmTabela
        legenda="Recebido por mês, em regime de caixa"
        colunas={[{ rotulo: 'Mês' }, { rotulo: 'Recebido', numerica: true }]}
        linhas={painel.serie_recebido.map((bucket) => ({
          chave: bucket.mes,
          celulas: [rotuloDoMes(bucket.mes), bucket.valor === null ? 'sem dados' : formatarBRL(bucket.valor)],
        }))}
      />
    </QuadroDoGrafico>
  )
}
