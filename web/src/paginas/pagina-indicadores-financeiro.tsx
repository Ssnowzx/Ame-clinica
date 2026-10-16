import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ColunasPareadas, LegendaPareada, QuebraDeValores } from '@/componentes/indicadores/graficos'
import { EquivalenteEmTabela, LegendaSemDados, QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { DinheiroNoMes } from '@/componentes/indicadores/dinheiro-no-mes'
import { ParDeQuadros } from '@/componentes/indicadores/moldura-dos-indicadores'
import { PRIMEIRO_MES_DOS_INDICADORES, usePeriodoDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'
import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { FolhaImpressa } from '@/componentes/ui/folha-impressa'
import { RoladorHorizontal } from '@/componentes/ui/rolador-horizontal'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { formatarBRL } from '@/lib/dinheiro'
import { usePainelDoDinheiro } from '@/lib/indicadores/paineis'
import { rotuloCurtoDoMes, rotuloDoMes, somarMeses } from '@/lib/meses'
import { buscarGraficosDoFinanceiro } from '@/servicos/indicadores'
import type { GraficosFinanceiros, LinhaDeCategoria } from '@/tipos'

/**
 * A tela Gráficos Financeiros (§11): de onde veio o dinheiro do MÊS e o que
 * acontece no ANO.
 *
 * **Um controle de período só.** O mês vem da URL e o ano das duas séries SAI dele;
 * as setas de ano movem o mês em 12. A tela do ClinicaÁgil tem seletor de mês para
 * as quebras e seletor de ano para a série, o que permite "pizza de março/2026 ao
 * lado da série de 2025" — um estado inconsistente que aqui é inexpressável.
 *
 * **Os dois regimes nunca se somam.** "Já entrou/saiu" é caixa (`pago_em`); "vai
 * vencer" é o não pago pelo `vencimento`. São blocos separados, cada um dizendo o
 * seu regime, e não existe nenhum total juntando os dois — seria um número que não
 * aparece em relatório nenhum. Mesma disciplina que mantém transferência fora de
 * entradas/saídas (T-fin-19).
 */
export function PaginaIndicadoresFinanceiro() {
  // o mês vem do SHELL da área — o seletor, a leitura da URL e o fuso da clínica moram lá
  // (change `indicadores-como-area`). Esta aba só ACRESCENTA o salto de ano, porque tem
  // duas séries anuais; e ele move o MESMO mês em 12, nunca um segundo eixo.
  const { mes } = usePeriodoDosIndicadores()

  const vista = useQuery({
    queryKey: chaves.graficosFinanceiros(mes),
    queryFn: () => buscarGraficosDoFinanceiro(mes),
  })

  return (
    <FolhaImpressa titulo="Indicadores — financeiro" periodo={rotuloDoMes(mes)}>
      <div className="@container flex flex-col gap-5">
        {/* o padrão das abas de detalhe (indicadores-profissionais): a linha do período e os cartões do
            mês no topo; os gráficos que a aba já tinha seguem embaixo */}
        <DinheiroNoMes mes={mes} />
        <SaltoDeAno />

      {vista.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
          <Skeleton className="h-[36rem] w-full" />
          <Skeleton className="h-[40rem] w-full" />
        </div>
      ) : null}

      {vista.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar os gráficos financeiros."
          aoTentarNovamente={() => void vista.refetch()}
        />
      ) : null}

        {vista.isSuccess ? <Conteudo dados={vista.data} mes={mes} /> : null}
      </div>
    </FolhaImpressa>
  )
}

/**
 * O salto de ANO das duas séries anuais: move o MESMO mês do alto em 12, nunca um segundo eixo de
 * período (o mês vem do SHELL da área — change `indicadores-como-area`).
 */
function SaltoDeAno() {
  const { mes, trocarMes, mesCorrente } = usePeriodoDosIndicadores()
  // o salto não passa dos limites da área: no ano corrente não há "próximo ano" (o mês futuro é 422),
  // e de um ano antes do corrente o salto para no mês corrente (`trocarMes` segura no limite)
  const ano = mes.slice(0, 4)

  return (
    <div data-nao-imprimir className="flex flex-wrap items-center justify-between gap-3 border-t border-linha pt-5">
      <p className="text-pretty text-corpo text-texto-suave">
        As categorias de {rotuloDoMes(mes)} e o ano de {mes.slice(0, 4)} — o que já entrou e saiu, e o
        que ainda vai vencer.
      </p>
      <div role="group" aria-label="Saltar o período de ano em ano" className="flex items-center gap-2">
        <Botao
          variante="secundario"
          tamanho="sm"
          aria-label="Ano anterior"
          disabled={ano <= PRIMEIRO_MES_DOS_INDICADORES.slice(0, 4)}
          onClick={() => trocarMes(somarMeses(mes, -12))}
        >
          <ChevronLeft aria-hidden="true" className="size-3.5" />
        </Botao>
        <span className="min-w-16 text-center text-corpo font-medium text-texto">{mes.slice(0, 4)}</span>
        <Botao
          variante="secundario"
          tamanho="sm"
          aria-label="Próximo ano"
          disabled={ano >= mesCorrente.slice(0, 4)}
          onClick={() => trocarMes(somarMeses(mes, 12))}
        >
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Botao>
      </div>
    </div>
  )
}

function Conteudo({ dados, mes }: { dados: GraficosFinanceiros; mes: string }) {
  // o início do histórico vem do painel do dinheiro desta MESMA página (a mesma chave do topo: não
  // custa requisição). Enquanto ele não chega, nada é hachurado — a tela de sempre, sem palpite
  const painel = usePainelDoDinheiro(mes)
  const inicioHistorico = painel.isSuccess ? painel.data.inicio_historico : undefined

  return (
    <div className="flex flex-col gap-4">
      {/* os dois no padrão dos gráficos da área (DQ-07): título que diz a conclusão, subtítulo com o
          regime, as barras e a tabela equivalente recolhida — e a mesma altura lado a lado */}
      <ParDeQuadros>
        <CategoriasDoMes linhas={dados.recebido_por_categoria} natureza="recebido" mes={mes} />
        <CategoriasDoMes linhas={dados.pago_por_categoria} natureza="pago" mes={mes} />
      </ParDeQuadros>

      <SerieDoAno ano={dados.ano} serie={dados.serie_do_ano} inicioHistorico={inicioHistorico} />
      <PrevisaoDoAno ano={dados.ano} previsao={dados.previsao_do_ano} vencido={dados.vencido} inicioHistorico={inicioHistorico} />
    </div>
  )
}

/** O rótulo da linha: "Categoria › Subcategoria", ou a categoria sozinha quando não há nível. */
function rotuloDaCategoria(linha: LinhaDeCategoria): string {
  const categoria = linha.categoria ?? 'Sem categoria'

  return linha.subcategoria === null ? categoria : `${categoria} › ${linha.subcategoria}`
}

/** A categoria com o MAIOR valor, só quando é uma só e maior que zero — senão não há conclusão. */
function maiorCategoria(linhas: readonly LinhaDeCategoria[]): LinhaDeCategoria | null {
  // `Number()` aqui só COMPARA tamanhos — nenhum valor é exibido nem somado a partir dele (D1)
  const maior = Math.max(0, ...linhas.map((linha) => Number(linha.total)))
  const donas = linhas.filter((linha) => Number(linha.total) === maior)

  return maior > 0 && donas.length === 1 ? donas[0] : null
}

const DA_NATUREZA = {
  recebido: { titulo: 'Recebido por categoria', conclusao: 'foi a maior entrada', quebra: 'Categorias de receita', tom: 'receita' },
  pago: { titulo: 'Pago por categoria', conclusao: 'foi a maior saída', quebra: 'Categorias de despesa', tom: 'despesa' },
} as const

/**
 * As categorias do MÊS, de um lado (o que entrou ou o que saiu). O título diz a conclusão quando há
 * uma ("Recebido por categoria em junho: Atendimentos › Sessão foi a maior entrada"); sem ela, só o
 * que a seção é — o nome que o papel imprime.
 */
function CategoriasDoMes({ linhas, natureza, mes }: { linhas: LinhaDeCategoria[]; natureza: 'recebido' | 'pago'; mes: string }) {
  const textos = DA_NATUREZA[natureza]
  const maior = maiorCategoria(linhas)
  const base = `${textos.titulo} em ${nomeDoMes(mes)}`

  return (
    <QuadroDoGrafico
      id={`${natureza}-por-categoria`}
      titulo={maior === null ? base : `${base}: ${rotuloDaCategoria(maior)} ${textos.conclusao}`}
      subtitulo={`Regime de caixa — o que foi ${natureza} de fato no mês, por categoria.`}
    >
      {linhas.length === 0 ? (
        <CategoriasVazias natureza={natureza} />
      ) : (
        <>
          <QuebraDeValores
            tom={textos.tom}
            titulo={textos.quebra}
            linhas={linhas.map((linha) => ({
              // chave como STRING sempre: chave numérica em array vira int e o casamento quebra em
              // silêncio (lição da casa)
              chave: `${linha.categoria_id}-${linha.subcategoria_id ?? 'sem'}`,
              rotulo: rotuloDaCategoria(linha),
              valor: linha.total,
            }))}
          />
          <EquivalenteEmTabela
            legenda={`Valores ${natureza === 'recebido' ? 'recebidos' : 'pagos'} por categoria no mês`}
            colunas={[{ rotulo: 'Categoria' }, { rotulo: 'Valor', numerica: true }]}
            linhas={linhas.map((linha) => ({
              chave: `${linha.categoria_id}-${linha.subcategoria_id ?? 'sem'}`,
              celulas: [
                rotuloDaCategoria(linha),
                <ValorDoMes key="valor" valor={linha.total} natureza={natureza === 'recebido' ? 'entrada' : 'saida'} />,
              ],
            }))}
          />
        </>
      )}
    </QuadroDoGrafico>
  )
}

/**
 * O lado sem movimento no mês. A descrição diz a natureza CERTA (sob "Nada recebido", falar em pago
 * lia como saída — IMP-8) e a porta leva ao financeiro (o vazio era beco sem saída — IMP-7); o
 * contrato do `EstadoVazio` pede Botão (os outros call sites da casa fazem assim).
 */
function CategoriasVazias({ natureza }: { natureza: 'recebido' | 'pago' }) {
  return (
    <VazioComSaida
      titulo={natureza === 'recebido' ? 'Nada recebido neste mês.' : 'Nada pago neste mês.'}
      descricao={
        natureza === 'recebido'
          ? 'A conta é de regime de caixa: entra aqui o que a clínica efetivamente RECEBEU no mês.'
          : 'A conta é de regime de caixa: entra aqui o que a clínica efetivamente PAGOU no mês.'
      }
    />
  )
}

/** Um vazio com a porta para o financeiro (fora do papel: no PDF um botão não leva a lugar nenhum). */
function VazioComSaida({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <EstadoVazio
      titulo={titulo}
      descricao={descricao}
      acao={
        <Botao asChild variante="secundario" data-nao-imprimir>
          <Link to="/financeiro">Abrir financeiro</Link>
        </Botao>
      }
    />
  )
}

/** Zero de verdade (`"0.00"`, `"0"`, `"-0.00"`) — a forma decimal, sem passar por ponto flutuante. */
function ehZero(valor: string): boolean {
  return /^[+-]?0+(\.0+)?$/.test(valor.trim())
}

/**
 * O mês é SEM DADOS: anterior ao início do histórico da clínica (o painel do dinheiro desta mesma
 * página o traz) e sem nenhum valor registrado. Mês com dinheiro de verdade nunca vira "sem dados",
 * mesmo antes do histórico — esconder valor real seria pior que mostrar um zero. Sem o início (o
 * painel ainda não chegou, ou falhou), nada é hachurado: a tela antiga, e não um palpite.
 */
function mesSemDados(mes: string, valores: readonly string[], inicioHistorico: string | null | undefined): boolean {
  return inicioHistorico !== null && inicioHistorico !== undefined && mes < inicioHistorico && valores.every(ehZero)
}

/**
 * Um valor da tabela mensal. A COR só para valor diferente de zero: doze linhas de "R$ 0,00" em
 * vermelho, mês a mês, eram a queixa que abriu a change — zero não é saída nem entrada, é neutro.
 */
function ValorDoMes({ valor, natureza }: { valor: string; natureza: 'entrada' | 'saida' }) {
  const tom = ehZero(valor) ? 'text-texto-suave' : natureza === 'entrada' ? 'text-sucesso-texto' : 'text-perigo-texto'

  return <span className={cn('whitespace-nowrap tabular-nums', tom)}>{formatarBRL(valor)}</span>
}

/** O mês com o MAIOR valor, só quando é um só e maior que zero — senão não há conclusão a escrever. */
function mesDoMaior<T extends { mes: string }>(serie: readonly T[], valor: (bucket: T) => string): string | null {
  // `Number()` aqui só COMPARA tamanhos — nenhum valor é exibido nem somado a partir dele (D1)
  const maior = Math.max(0, ...serie.map((bucket) => Number(valor(bucket))))
  const donos = serie.filter((bucket) => Number(valor(bucket)) === maior)

  return maior > 0 && donos.length === 1 ? donos[0].mes : null
}

function SerieDoAno({
  ano,
  serie,
  inicioHistorico,
}: {
  ano: string
  serie: GraficosFinanceiros['serie_do_ano']
  inicioHistorico: string | null | undefined
}) {
  const semMovimento = serie.every((bucket) => ehZero(bucket.recebidas) && ehZero(bucket.pagas))
  const maiorMes = mesDoMaior(serie, (bucket) => bucket.recebidas)
  // o título diz a conclusão quando há uma; sem ela, só o que a seção é (o nome que o papel imprime)
  const titulo =
    maiorMes === null ? `Já entrou e saiu em ${ano}` : `Já entrou e saiu em ${ano}: ${nomeDoMes(maiorMes)} foi o mês que mais recebeu`

  return (
    <QuadroDoGrafico id="serie-do-ano" titulo={titulo} subtitulo="Regime de caixa — o que já foi pago e recebido, mês a mês.">
      {semMovimento ? (
        <VazioComSaida titulo="Nada pago nem recebido neste ano." descricao="A série cobre os doze meses do ano, pelo regime de caixa." />
      ) : (
        <ColunasDoAno
          rotulo="Contas pagas e recebidas mês a mês — role para ver os doze meses"
          legendas={['Recebidas', 'Pagas']}
          itens={serie.map((bucket) => ({
            mes: bucket.mes,
            primeira: bucket.recebidas,
            segunda: bucket.pagas,
            semDados: mesSemDados(bucket.mes, [bucket.recebidas, bucket.pagas], inicioHistorico),
          }))}
          tabela={{
            legenda: 'Contas recebidas e pagas por mês no ano, em regime de caixa',
            colunas: ['Mês', 'Recebidas', 'Pagas'],
          }}
        />
      )}
    </QuadroDoGrafico>
  )
}

/** "setembro" a partir de `2026-09` — o mês sozinho, no meio de uma frase. */
function nomeDoMes(mes: string): string {
  return rotuloDoMes(mes).replace(/ de \d{4}$/, '')
}

/**
 * As colunas do ano (o par acento × perigo de sempre) com os meses SEM DADOS hachurados e a tabela
 * equivalente dentro de "Ver os números em tabela" — fechada na tela, aberta no papel, como a dos
 * outros gráficos. As doze linhas que ocupavam a tela inteira viraram o equivalente do gráfico.
 */
function ColunasDoAno({
  rotulo,
  legendas,
  itens,
  tabela,
}: {
  rotulo: string
  legendas: [string, string]
  itens: Array<{ mes: string; primeira: string; segunda: string; semDados: boolean }>
  tabela: { legenda: string; colunas: [string, string, string] }
}) {
  const maximo = Math.max(...itens.flatMap((item) => [Number(item.primeira), Number(item.segunda)]), 1)
  const semDados = itens.filter((item) => item.semDados)

  return (
    <div className="flex flex-col gap-3">
      <LegendaPareada legendas={legendas} />
      {/* 12 colunas não cabem em 390px: rola no PRÓPRIO contêiner, nunca empurrando a página de
          lado (D5). `min-w-140` é a escala da casa e acompanha a fonte do usuário (CR-GF-08); o
          `RoladorHorizontal` dá o véu e o foco por teclado (BLOQ-1 e BLOQ-3). */}
      <RoladorHorizontal rotulo={rotulo}>
        <div className="min-w-140">
          <ColunasPareadas semLegenda legendas={legendas} itens={itens.map((item) => colunaPareada(item, legendas, maximo))} />
        </div>
      </RoladorHorizontal>
      {/* o ano do caixa mostra todo dinheiro que entrou, até antes do início dos indicadores: a legenda diz só
          que nada foi registrado nos meses hachurados, sem prometer o corte que a Visão geral faz (gate r1) */}
      {semDados.length === 0 ? null : <LegendaSemDados>{trechoSemDados(semDados)}: nada registrado no caixa</LegendaSemDados>}
      <EquivalenteEmTabela
        legenda={tabela.legenda}
        colunas={[{ rotulo: tabela.colunas[0] }, { rotulo: tabela.colunas[1], numerica: true }, { rotulo: tabela.colunas[2], numerica: true }]}
        linhas={itens.map((item) => ({
          chave: item.mes,
          celulas: item.semDados
            ? [rotuloDoMes(item.mes), <SemDadosNaTabela key="primeira" />, <SemDadosNaTabela key="segunda" />]
            : [
                rotuloDoMes(item.mes),
                <ValorDoMes key="primeira" valor={item.primeira} natureza="entrada" />,
                <ValorDoMes key="segunda" valor={item.segunda} natureza="saida" />,
              ],
        }))}
      />
    </div>
  )
}

/** Os meses sem dados em palavras: `jan–ago`, ou `jan` sozinho. */
function trechoSemDados(meses: ReadonlyArray<{ mes: string }>): string {
  return meses.length === 1 ? rotuloCurtoDoMes(meses[0].mes) : `${rotuloCurtoDoMes(meses[0].mes)}–${rotuloCurtoDoMes(meses[meses.length - 1].mes)}`
}

/** Uma coluna do par: a geometria sai de `Number()` (só tamanho), e o título, do BRL exato (D1). */
function colunaPareada(
  item: { mes: string; primeira: string; segunda: string; semDados: boolean },
  legendas: [string, string],
  maximo: number,
) {
  return {
    mes: item.mes,
    semDados: item.semDados,
    primeira: {
      proporcao: (Number(item.primeira) / maximo) * 100,
      titulo: `${rotuloDoMes(item.mes)} — ${legendas[0].toLowerCase()}: ${formatarBRL(item.primeira)}`,
    },
    segunda: {
      proporcao: (Number(item.segunda) / maximo) * 100,
      titulo: `${rotuloDoMes(item.mes)} — ${legendas[1].toLowerCase()}: ${formatarBRL(item.segunda)}`,
    },
  }
}

function SemDadosNaTabela() {
  return <span className="text-texto-suave">sem dados</span>
}

/**
 * O já vencido no ano. É RECORTE dos buckets (o mesmo dinheiro, visto por outro corte), não uma
 * parcela a mais — o texto diz isso para ninguém somar de novo.
 */
function VencidoNoAno({ vencido }: { vencido: GraficosFinanceiros['vencido'] }) {
  return (
    <div className="flex flex-wrap gap-4 rounded-superficie border border-linha bg-fundo px-4 py-3">
      <div className="flex flex-col">
        <span className="text-meta text-texto-suave">A receber já vencido no ano</span>
        <span className="text-corpo font-semibold">
          <ValorDoMes valor={vencido.a_receber} natureza="entrada" />
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-meta text-texto-suave">A pagar já vencido no ano</span>
        <span className="text-corpo font-semibold">
          <ValorDoMes valor={vencido.a_pagar} natureza="saida" />
        </span>
      </div>
      <p className="basis-full text-pretty text-meta text-texto-suave">
        Estes dois valores já estão contados nos meses abaixo — são a parte que passou da data, não um
        valor à parte.
      </p>
    </div>
  )
}

function PrevisaoDoAno({
  ano,
  previsao,
  vencido,
  inicioHistorico,
}: {
  ano: string
  previsao: GraficosFinanceiros['previsao_do_ano']
  vencido: GraficosFinanceiros['vencido']
  inicioHistorico: string | null | undefined
}) {
  const semPrevisao = previsao.every((bucket) => ehZero(bucket.a_receber) && ehZero(bucket.a_pagar))
  const maiorMes = mesDoMaior(previsao, (bucket) => bucket.a_receber)
  const conclusao = maiorMes === null ? '' : `: o maior valor a receber vence em ${nomeDoMes(maiorMes)}`

  return (
    <QuadroDoGrafico
      id="previsao-do-ano"
      titulo={`Ainda vai vencer em ${ano}${conclusao}`}
      subtitulo="Pelo vencimento do que ainda NÃO foi pago. É outra conta: nada aqui está somado ao que já entrou e saiu."
    >
      {semPrevisao ? (
        <VazioComSaida
          titulo="Nada a vencer neste ano."
          descricao="Aqui entra o que ainda NÃO foi pago, pela data de vencimento — nada disso está na conta do caixa."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <VencidoNoAno vencido={vencido} />

          <ColunasDoAno
            rotulo="Contas a receber e a pagar por mês de vencimento — role para ver os doze meses"
            legendas={['A receber', 'A pagar']}
            itens={previsao.map((bucket) => ({
              mes: bucket.mes,
              primeira: bucket.a_receber,
              segunda: bucket.a_pagar,
              semDados: mesSemDados(bucket.mes, [bucket.a_receber, bucket.a_pagar], inicioHistorico),
            }))}
            tabela={{
              legenda: 'Contas a receber e a pagar por mês de vencimento, do que não foi pago',
              colunas: ['Mês do vencimento', 'A receber', 'A pagar'],
            }}
          />
        </div>
      )}
    </QuadroDoGrafico>
  )
}
