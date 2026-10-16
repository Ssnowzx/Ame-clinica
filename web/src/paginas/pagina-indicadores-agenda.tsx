import { Link } from 'react-router-dom'

import type { PainelDaAgenda } from '@/tipos'

import { CartaoDoIndicador } from '@/componentes/indicadores/cartao-do-indicador'
import { QuadroVazio, SemHistoricoNaAba } from '@/componentes/indicadores/estados-da-aba'
import { FaltasPorDia } from '@/componentes/indicadores/faltas-por-dia'
import { BarrasComDestaque, EquivalenteEmTabela, QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { MapaDeOcupacao } from '@/componentes/indicadores/mapa-de-ocupacao'
import {
  EsqueletoDaAba,
  GradeDeCartoes,
  ParDeQuadros,
  type EsqueletoDeCartao,
} from '@/componentes/indicadores/moldura-dos-indicadores'
import { useMesDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'
import { LinhaDoPeriodo } from '@/componentes/indicadores/linha-do-periodo'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { FolhaImpressa } from '@/componentes/ui/folha-impressa'
import { Tabela } from '@/componentes/ui/tabela'
import { derivarTonsStatus } from '@/lib/cor-status'
import {
  DEFINICAO_DAS_REALIZADAS,
  definicaoDaOcupacao,
  definicaoDasConfirmadas,
  definicaoDasFaltas,
  definicaoDosDesmarques,
} from '@/lib/indicadores/definicoes'
import {
  compararContagem,
  compararTaxa,
  formatarTaxa,
  fraseDaParteDasPassadas,
  fraseDasConfirmadas,
  fraseDoCartaoDaOcupacao,
  mesAntesDoHistorico,
  taxaOuSemDados,
  tituloDoMapa,
  tituloDosConvenios,
} from '@/lib/indicadores/frases'
import { usePainelDaAgenda } from '@/lib/indicadores/paineis'
import { rotuloDoMes } from '@/lib/meses'
import { formatarContagem } from '@/lib/numeros'

/** Os cinco cartões, cada um com as linhas que a frase dele costuma ter no celular (o esqueleto reserva). */
const CARTOES: readonly EsqueletoDeCartao[] = [
  { rotulo: 'Ocupação', linhasDaFrase: [4, 4, 2] },
  { rotulo: 'Realizadas', linhasDaFrase: [2, 2, 1] },
  { rotulo: 'Faltas', linhasDaFrase: [2, 2, 1] },
  { rotulo: 'Desmarques', linhasDaFrase: [2, 2, 1] },
  { rotulo: 'Confirmadas', linhasDaFrase: [3, 3, 2] },
]

/**
 * A aba AGENDA (change indicadores-profissionais) — o modelo das abas de detalhe: a linha do
 * período, os cinco cartões, os gráficos com título-conclusão e, por último, a tabela.
 *
 * Toda porcentagem é sobre as SESSÕES QUE JÁ PASSARAM: as futuras ("Em aberto") ainda não
 * aconteceram, e no dia 5 eram 2.815 sessões dominando a tela antiga. A aba diz isso em texto.
 * A ocupação diz sobre quantos profissionais foi calculada — quem não tem horário cadastrado fica
 * fora, e a Equipe lista a pendência.
 */
export function PaginaIndicadoresAgenda() {
  const mes = useMesDosIndicadores()
  const consulta = usePainelDaAgenda(mes)

  return (
    <FolhaImpressa titulo="Indicadores — agenda" periodo={rotuloDoMes(mes)}>
      <div className="@container flex flex-col gap-5">
        {consulta.isPending ? <EsqueletoDaAba titulo="Agenda no mês" cartoes={CARTOES} /> : null}

        {consulta.isError ? (
          <EstadoErro
            mensagem="Não foi possível carregar os números da agenda."
            aoTentarNovamente={() => void consulta.refetch()}
          />
        ) : null}

        {consulta.isSuccess ? (
          mesAntesDoHistorico(consulta.data) ? (
            <SemHistoricoNaAba base={consulta.data} />
          ) : (
            <ConteudoDaAgenda painel={consulta.data} mes={mes} />
          )
        ) : null}
      </div>
    </FolhaImpressa>
  )
}

function ConteudoDaAgenda({ painel, mes }: { painel: PainelDaAgenda; mes: string }) {
  return (
    <>
      <LinhaDoPeriodo base={painel} />
      <CartoesDaAgenda painel={painel} />

      <ParDeQuadros>
        <FaltasPorDia painel={painel} />
        <QuadroDoGrafico
          id="mapa-de-ocupacao"
          titulo={tituloDoMapa(painel.ocupacao_por_periodo)}
          subtitulo="Ocupação por dia da semana e período do dia — mais escuro, mais cheio"
        >
          {painel.ocupacao_por_periodo.length === 0 ? (
            <QuadroVazio>Nenhum profissional tem horário e especialidade cadastrados para medir a ocupação.</QuadroVazio>
          ) : (
            <MapaDeOcupacao celulas={painel.ocupacao_por_periodo} />
          )}
        </QuadroDoGrafico>
      </ParDeQuadros>

      <ParDeQuadros>
        <PorConvenio painel={painel} />
        <SituacaoDasSessoes painel={painel} mes={mes} />
      </ParDeQuadros>
    </>
  )
}

/**
 * Os cinco cartões da Agenda, com a MESMA anatomia (DQ-05): número, legenda curta, comparação e
 * frase — a frase de cada um diz de quantas sessões (ou lembretes) a porcentagem foi tirada.
 */
function CartoesDaAgenda({ painel }: { painel: PainelDaAgenda }) {
  const { periodo } = painel
  const faltas = painel.faltas.atual
  const desmarques = painel.desmarques.atual

  return (
    <GradeDeCartoes quantidade={CARTOES.length}>
      <CartaoDoIndicador
        rotulo="Ocupação"
        valor={painel.ocupacao.atual === null ? null : formatarTaxa(painel.ocupacao.atual)}
        legenda="da grade"
        comparacao={compararTaxa(painel.ocupacao.atual, painel.ocupacao.anterior, periodo, 'subir-e-bom')}
        frase={fraseDoCartaoDaOcupacao(painel)}
        definicao={definicaoDaOcupacao(painel)}
      />
      <CartaoDoIndicador
        rotulo="Realizadas"
        valor={formatarContagem(painel.realizadas.atual)}
        legenda="sessões"
        comparacao={compararContagem(painel.realizadas, periodo, 'subir-e-bom')}
        frase={fraseDaParteDasPassadas(painel.realizadas.atual, painel)}
        definicao={DEFINICAO_DAS_REALIZADAS}
      />
      <CartaoDoIndicador
        rotulo="Faltas"
        valor={faltas.taxa === null ? null : formatarTaxa(faltas.taxa)}
        legenda="das sessões"
        comparacao={compararTaxa(faltas.taxa, painel.faltas.anterior?.taxa ?? null, periodo, 'subir-e-ruim')}
        frase={fraseDaParteDasPassadas(faltas.quantidade, painel)}
        definicao={definicaoDasFaltas(painel)}
      />
      <CartaoDoIndicador
        rotulo="Desmarques"
        valor={desmarques.taxa === null ? null : formatarTaxa(desmarques.taxa)}
        legenda="das sessões"
        comparacao={compararTaxa(desmarques.taxa, painel.desmarques.anterior?.taxa ?? null, periodo, 'subir-e-ruim')}
        frase={fraseDaParteDasPassadas(desmarques.quantidade, painel)}
        definicao={definicaoDosDesmarques(painel)}
      />
      <CartaoDasConfirmadas painel={painel} />
    </GradeDeCartoes>
  )
}

/** As confirmadas: pela família no WhatsApp OU pela recepção (CR-IND-07) — "pelo WhatsApp" escondia a recepção. */
function CartaoDasConfirmadas({ painel }: { painel: PainelDaAgenda }) {
  const confirmadas = painel.confirmadas.atual

  return (
    <CartaoDoIndicador
      rotulo="Confirmadas"
      valor={confirmadas.taxa === null ? null : formatarTaxa(confirmadas.taxa)}
      legenda="dos lembretes"
      comparacao={compararTaxa(confirmadas.taxa, painel.confirmadas.anterior?.taxa ?? null, painel.periodo, 'subir-e-bom')}
      frase={fraseDasConfirmadas(painel)}
      definicao={definicaoDasConfirmadas(painel)}
    />
  )
}

function rotuloDoConvenio(linha: PainelDaAgenda['por_convenio'][number]): string {
  return linha.outros === undefined ? linha.nome : `${linha.nome} (${formatarContagem(linha.outros)})`
}

function PorConvenio({ painel }: { painel: PainelDaAgenda }) {
  const linhas = painel.por_convenio
  const maior = Math.max(0, ...linhas.filter((linha) => linha.outros === undefined).map((linha) => linha.taxa ?? 0))

  return (
    <QuadroDoGrafico
      id="por-convenio"
      titulo={linhas.length === 0 ? 'Ainda não há sessões que já passaram' : tituloDosConvenios(linhas)}
      subtitulo="Faltas e desmarques, em % das sessões de cada convênio que já passaram"
    >
      {linhas.length === 0 ? (
        <QuadroVazio>As taxas por convênio aparecem quando as primeiras sessões do período passarem.</QuadroVazio>
      ) : (
        <>
          <BarrasComDestaque
            barras={linhas.map((linha) => ({
              chave: `${linha.nome}-${String(linha.outros ?? 0)}`,
              rotulo: rotuloDoConvenio(linha),
              proporcao: linha.taxa === null || maior === 0 ? 0 : (linha.taxa / maior) * 100,
              valor: taxaOuSemDados(linha.taxa),
              // a linha agregada "Outros" nunca é o destaque: ela não é UM convênio
              destaque: linha.outros === undefined && maior > 0 && linha.taxa === maior,
            }))}
          />
          <EquivalenteEmTabela
            legenda="Faltas e desmarques por convênio nas sessões que já passaram"
            colunas={[
              { rotulo: 'Convênio' },
              { rotulo: 'Sessões', numerica: true },
              { rotulo: 'Faltas', numerica: true },
              { rotulo: 'Desmarques', numerica: true },
              { rotulo: '%', numerica: true },
            ]}
            linhas={linhas.map((linha) => ({
              chave: `${linha.nome}-${String(linha.outros ?? 0)}`,
              celulas: [
                rotuloDoConvenio(linha),
                formatarContagem(linha.sessoes),
                formatarContagem(linha.faltas),
                formatarContagem(linha.desmarques),
                taxaOuSemDados(linha.taxa),
              ],
            }))}
          />
        </>
      )}
    </QuadroDoGrafico>
  )
}

/**
 * O endereço da lista de UM status, só com as sessões que JÁ PASSARAM (`passadas=1`, contrato 2 da
 * rodada 1 do gate): a tabela conta as que passaram, e a lista sem o corte trazia também as futuras do
 * mesmo status — o número da linha e o tamanho da lista não batiam (CR-IND-02).
 */
function listaDoStatus(statusId: number, mes: string): string {
  return `/indicadores/itens?origem=agenda&status_id=${String(statusId)}&mes=${mes}&passadas=1`
}

/** Uma linha da situação: o ponto na cor do cadastro, o nome como porta, a contagem e a fatia. */
function LinhaDaSituacao({ linha, total, mes }: { linha: PainelDaAgenda['situacao'][number]; total: number; mes: string }) {
  return (
    <Tabela.Linha>
      <Tabela.Celula>
        <span className="flex items-center gap-2">
          {linha.cor === null ? null : (
            // a cor do CADASTRO nunca entra crua: o tom forte nasce em derivarTonsStatus (o suave do
            // cartão some num ponto de 10px); o nome ao lado é quem identifica
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-pilula"
              style={{ backgroundColor: derivarTonsStatus(linha.cor).texto }}
            />
          )}
          <Link
            to={listaDoStatus(linha.status_id, mes)}
            className="rounded-controle text-texto underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            {linha.nome}
          </Link>
        </span>
      </Tabela.Celula>
      <Tabela.Celula numerica>{formatarContagem(linha.quantidade)}</Tabela.Celula>
      {/* a fatia de cada status sobre o TOTAL desta tabela — a soma fecha em 100% */}
      <Tabela.Celula numerica>{total === 0 ? 'sem dados' : formatarTaxa(linha.quantidade / total)}</Tabela.Celula>
    </Tabela.Linha>
  )
}

/**
 * A SITUAÇÃO das sessões que já passaram — a tabela que substitui a quebra por status do painel
 * antigo, onde "Em Aberto 2.815" dominava a tela. A cor de cada status é DADO do cadastro (§13) e
 * só entra pelo `derivarTonsStatus`; o nome é porta para a lista daquele status, já com o corte das
 * que passaram.
 */
function SituacaoDasSessoes({ painel, mes }: { painel: PainelDaAgenda; mes: string }) {
  const total = painel.situacao.reduce((soma, linha) => soma + linha.quantidade, 0)

  return (
    <QuadroDoGrafico
      id="situacao-das-sessoes"
      titulo="Situação das sessões que já passaram"
      // genérico de propósito: o nome dos status é DADO do cadastro (§13). E um status "aberto"
      // PODE aparecer aqui — é a sessão que já passou e ninguém deu baixa; dizer que "os em aberto
      // ficam fora" contradizia a linha logo abaixo (validação local de 05/10)
      subtitulo="Só as sessões que já passaram; as que ainda vão acontecer ficam fora. Uma sessão em status aberto aqui já passou e ainda não teve baixa."
    >
      {painel.situacao.length === 0 ? (
        <QuadroVazio>Nenhuma sessão do período já passou.</QuadroVazio>
      ) : (
        <Tabela legenda="Situação das sessões que já passaram, por status" densidade="compacta">
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho>Situação</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho className="text-right">Sessões</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho className="text-right">%</Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {painel.situacao.map((linha) => (
              <LinhaDaSituacao key={linha.status_id} linha={linha} total={total} mes={mes} />
            ))}
            <Tabela.Linha>
              <Tabela.CelulaCabecalho scope="row" pele="corpo" className="font-semibold">
                Total
              </Tabela.CelulaCabecalho>
              <Tabela.Celula numerica className="font-semibold">
                {formatarContagem(total)}
              </Tabela.Celula>
              <Tabela.Celula numerica />
            </Tabela.Linha>
          </Tabela.Corpo>
        </Tabela>
      )}
    </QuadroDoGrafico>
  )
}
