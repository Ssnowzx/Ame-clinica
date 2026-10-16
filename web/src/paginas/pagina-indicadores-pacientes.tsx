import type { PainelDosPacientes } from '@/tipos'

import { BlocoDemografiaDosPacientes } from '@/componentes/indicadores/bloco-pacientes'
import { CartaoDoIndicador } from '@/componentes/indicadores/cartao-do-indicador'
import { SemHistoricoNaAba } from '@/componentes/indicadores/estados-da-aba'
import {
  ColunasComDestaque,
  EquivalenteEmTabela,
  LegendaDoParcial,
  LegendaSemDados,
  QuadroDoGrafico,
} from '@/componentes/indicadores/graficos-do-painel'
import {
  EsqueletoDaAba,
  GradeDeCartoes,
  type EsqueletoDeCartao,
} from '@/componentes/indicadores/moldura-dos-indicadores'
import { useMesDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'
import { LinhaDoPeriodo } from '@/componentes/indicadores/linha-do-periodo'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { FolhaImpressa } from '@/componentes/ui/folha-impressa'
import {
  DEFINICAO_DA_FILA,
  DEFINICAO_DOS_ATIVOS,
  DEFINICAO_DOS_NOVOS,
  DEFINICAO_DOS_PACOTES_NO_FIM,
  DEFINICAO_DOS_QUE_SAIRAM,
} from '@/lib/indicadores/definicoes'
import {
  avisoDeSemComparacao,
  compararContagem,
  mesAntesDoHistorico,
  tituloDosNovos,
} from '@/lib/indicadores/frases'
import { usePainelDosPacientes } from '@/lib/indicadores/paineis'
import { rotuloCurtoDoMes, rotuloDoMes } from '@/lib/meses'
import { formatarContagem } from '@/lib/numeros'
import { useAuthStore } from '@/stores/auth-store'

/** A grandeza que é uma FOTO do momento: no lugar da comparação, esta linha neutra (DQ-05). */
const DE_HOJE = 'situação de hoje'

/**
 * Os cartões que a pessoa VÊ: "Pacotes no fim" só com `tratamentos.ver` e "Fila de espera" só com
 * `lista_espera.ver` — sem a permissão o servidor nem manda a chave (SEC-IND-01). O esqueleto usa a
 * mesma conta, para reservar a linha com o número certo de cartões.
 */
function cartoesVisiveis(permissoes: readonly string[] | undefined): readonly EsqueletoDeCartao[] {
  const pode = (permissao: string): boolean => permissoes?.includes(permissao) === true

  return [
    { rotulo: 'Ativos', linhasDaFrase: 0, comPorta: true },
    { rotulo: 'Novos', linhasDaFrase: 0 },
    { rotulo: 'Saíram', linhasDaFrase: 0 },
    ...(pode('tratamentos.ver') ? [{ rotulo: 'Pacotes no fim', linhasDaFrase: 0, comPorta: true }] : []),
    ...(pode('lista_espera.ver') ? [{ rotulo: 'Fila de espera', linhasDaFrase: 0, comPorta: true }] : []),
  ]
}

/**
 * A aba PACIENTES (change indicadores-profissionais): o bloco saiu da Visão geral para a aba própria,
 * no padrão das abas de detalhe — a linha do período, cartões, o crescimento e as quebras de quem são.
 *
 * O CRESCIMENTO usa a comparação JUSTA do servidor (o mesmo trecho do mês anterior), e não mais os
 * dois últimos meses da série: no mês seguinte à importação da virada, a série punha o mês parcial
 * contra o mês da importação e escrevia "−387". Os meses antes do histórico são "sem dados", nunca 0.
 */
export function PaginaIndicadoresPacientes() {
  const mes = useMesDosIndicadores()
  const consulta = usePainelDosPacientes(mes)
  const permissoes = useAuthStore((estado) => estado.usuario?.permissoes)

  return (
    <FolhaImpressa titulo="Indicadores — pacientes" periodo={rotuloDoMes(mes)}>
      <div className="@container flex flex-col gap-5">
        {consulta.isPending ? (
          <EsqueletoDaAba titulo="Pacientes no mês" cartoes={cartoesVisiveis(permissoes)} quadros={0} />
        ) : null}

        {consulta.isError ? (
          <EstadoErro
            mensagem="Não foi possível carregar os números dos pacientes."
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {consulta.isSuccess ? (
          mesAntesDoHistorico(consulta.data) ? (
            <SemHistoricoNaAba base={consulta.data} />
          ) : (
            <>
              <LinhaDoPeriodo base={consulta.data} />
              <CartoesDosPacientes painel={consulta.data} permissoes={permissoes} />
              <NovosPorMes painel={consulta.data} />
            </>
          )
        ) : null}

        {/* as quebras são uma foto da base ATIVA, de outra vista: aparecem mesmo no mês sem histórico */}
        <BlocoDemografiaDosPacientes mes={mes} />
      </div>
    </FolhaImpressa>
  )
}

/**
 * Os cartões, todos com a MESMA anatomia (DQ-05): número, legenda e a linha de baixo — a comparação
 * nos que se comparam (novos, saíram), "situação de hoje" nas fotos do momento. Nenhum tem frase: o
 * número, a legenda e a comparação já dizem tudo.
 */
function CartoesDosPacientes({ painel, permissoes }: { painel: PainelDosPacientes; permissoes: readonly string[] | undefined }) {
  const pode = (permissao: string): boolean => permissoes?.includes(permissao) === true
  const { periodo } = painel
  const quantidade = 3 + (painel.pacotes_no_fim === undefined ? 0 : 1) + (painel.fila_de_espera === undefined ? 0 : 1)

  return (
    <GradeDeCartoes quantidade={quantidade}>
      <CartaoDoIndicador
        rotulo="Ativos"
        valor={formatarContagem(painel.ativos)}
        legenda="em atendimento"
        contexto={DE_HOJE}
        definicao={DEFINICAO_DOS_ATIVOS}
        porta={{ para: '/pacientes', rotulo: 'Abrir pacientes' }}
      />
      <CartaoDoIndicador
        rotulo="Novos"
        valor={formatarContagem(painel.novos.atual)}
        legenda="cadastrados no período"
        comparacao={compararContagem(painel.novos, periodo, 'subir-e-bom')}
        definicao={DEFINICAO_DOS_NOVOS}
      />
      <CartaoDoIndicador
        rotulo="Saíram"
        valor={formatarContagem(painel.sairam.atual)}
        legenda="passaram a inativos"
        comparacao={compararContagem(painel.sairam, periodo, 'subir-e-ruim')}
        definicao={DEFINICAO_DOS_QUE_SAIRAM}
      />
      <CartoesDeHoje painel={painel} pode={pode} />
    </GradeDeCartoes>
  )
}

/**
 * Os pacotes no fim e a fila de espera — fotos do momento. AUSENTE não é zero: sem a chave (sem a
 * permissão), o cartão não existe (SEC-IND-01).
 */
function CartoesDeHoje({ painel, pode }: { painel: PainelDosPacientes; pode: (permissao: string) => boolean }) {
  const { pacotes_no_fim: pacotes, fila_de_espera: fila } = painel

  return (
    <>
      {pacotes === undefined ? null : (
        <CartaoDoIndicador
          rotulo="Pacotes no fim"
          valor={formatarContagem(pacotes)}
          legenda="perto da última sessão"
          contexto={DE_HOJE}
          definicao={DEFINICAO_DOS_PACOTES_NO_FIM}
          porta={pode('tratamentos.ver') ? { para: '/tratamentos', rotulo: 'Ver os tratamentos' } : undefined}
        />
      )}
      {fila === undefined ? null : (
        <CartaoDoIndicador
          rotulo="Fila de espera"
          valor={formatarContagem(fila)}
          legenda="esperando vaga"
          contexto={DE_HOJE}
          definicao={DEFINICAO_DA_FILA}
          porta={pode('lista_espera.ver') ? { para: '/lista-espera', rotulo: 'Abrir a lista de espera' } : undefined}
        />
      )}
    </>
  )
}

/** As colunas da série: o mês pedido em destaque e, se ele está em curso, com o eixo curto `out*`. */
function colunasDosNovos(painel: PainelDosPacientes) {
  const serie = painel.serie_novos
  const maximo = Math.max(1, ...serie.map((bucket) => bucket.quantidade ?? 0))
  const ultimo = serie[serie.length - 1]?.mes

  return serie.map((bucket) => ({
    chave: bucket.mes,
    eixo: bucket.mes === ultimo && painel.periodo.parcial ? `${rotuloCurtoDoMes(bucket.mes)}*` : rotuloCurtoDoMes(bucket.mes),
    proporcao: bucket.quantidade === null ? null : (bucket.quantidade / maximo) * 100,
    rotulo: bucket.quantidade === null ? undefined : formatarContagem(bucket.quantidade),
    destaque: bucket.mes === ultimo,
  }))
}

/** Os meses sem dados em palavras: `mai–ago`, ou `mai` sozinho. */
function mesesSemDados(serie: PainelDosPacientes['serie_novos']): string | null {
  const vazios = serie.filter((bucket) => bucket.quantidade === null)
  if (vazios.length === 0) {
    return null
  }

  return vazios.length === 1
    ? rotuloCurtoDoMes(vazios[0].mes)
    : `${rotuloCurtoDoMes(vazios[0].mes)}–${rotuloCurtoDoMes(vazios[vazios.length - 1].mes)}`
}

/** A série dos novos: o mês pedido em destaque, os anteriores recessivos, antes do histórico hachurado. */
function NovosPorMes({ painel }: { painel: PainelDosPacientes }) {
  const semDados = mesesSemDados(painel.serie_novos)

  return (
    <QuadroDoGrafico
      id="novos-por-mes"
      titulo={tituloDosNovos(painel)}
      // o mês em curso é uma coluna PARCIAL ao lado de meses cheios (e um deles pode ser o da
      // importação): o título usa a comparação justa, e a legenda diz por que a coluna é baixa
      subtitulo={`Pacientes cadastrados por mês, nos últimos seis meses.${avisoDeSemComparacao(painel)}`}
    >
      <ColunasComDestaque colunas={colunasDosNovos(painel)} />
      <div className="flex flex-col gap-1">
        {painel.periodo.parcial ? (
          <LegendaDoParcial mes={rotuloCurtoDoMes(painel.periodo.mes)} dia={String(Number(painel.periodo.ate.slice(8, 10)))} />
        ) : null}
        {semDados === null ? null : <LegendaSemDados>{semDados}: antes dos indicadores, sem dados</LegendaSemDados>}
      </div>
      <EquivalenteEmTabela
        legenda="Pacientes novos por mês"
        colunas={[{ rotulo: 'Mês' }, { rotulo: 'Novos', numerica: true }]}
        linhas={painel.serie_novos.map((bucket) => ({
          chave: bucket.mes,
          celulas: [rotuloDoMes(bucket.mes), bucket.quantidade === null ? 'sem dados' : formatarContagem(bucket.quantidade)],
        }))}
      />
    </QuadroDoGrafico>
  )
}
