import type { ReactNode } from 'react'

import { useTagDoTitulo } from '@/componentes/indicadores/nivel-do-titulo'
import { RoladorHorizontal } from '@/componentes/ui/rolador-horizontal'
import { Tabela } from '@/componentes/ui/tabela'
import { cn } from '@/lib/cn'

/**
 * Os gráficos das abas no padrão da change indicadores-profissionais — divs com tokens, sem
 * biblioteca, como as primitivas de `graficos.tsx`, mas com a regra nova:
 *
 * - **uma cor por série, o valor que importa em DESTAQUE e o resto RECESSIVO** (`grafico-destaque`
 *   e `grafico-recessivo`, validados pela skill de gráficos nos dois temas);
 * - **"sem dados" nunca é zero**: a coluna do mês antes do sistema é hachurada e rotulada;
 * - **o título diz a conclusão** ("As faltas se concentram na segunda-feira"), e o subtítulo diz o
 *   que foi medido;
 * - **o desenho é reforço** (`aria-hidden`): o equivalente em texto é a tabela logo abaixo, a
 *   mesma para quem lê com os olhos e para o leitor de tela.
 */

/** A moldura de um gráfico: o título-conclusão, o que foi medido, o desenho e a tabela. */
export function QuadroDoGrafico({
  id,
  titulo,
  subtitulo,
  children,
  className,
}: {
  id: string
  /** A CONCLUSÃO, não o nome do gráfico */
  titulo: string
  /** O que foi medido, em que unidade */
  subtitulo: string
  children: ReactNode
  className?: string
}) {
  const Titulo = useTagDoTitulo()

  return (
    <section
      aria-labelledby={id}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-superficie border border-linha bg-superficie p-5 shadow-e1 print:break-inside-avoid print:shadow-none',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <Titulo id={id} className="text-pretty text-subtitulo font-semibold text-texto">
          {titulo}
        </Titulo>
        <p className="text-pretty text-meta text-texto-suave">{subtitulo}</p>
      </div>
      {children}
    </section>
  )
}

export interface ColunaDoGrafico {
  chave: string
  /**
   * O rótulo do eixo, CURTO (`seg`, `out*`): o detalhe do mês parcial vai na legenda, não aqui — "out ·
   * até dia 5" quebrava em três linhas numa coluna de 44px do celular (DQ-03).
   */
  eixo: string
  /** A altura, de 0 a 100. `null` = SEM DADOS: coluna hachurada, nunca uma coluna zero */
  proporcao: number | null
  /** O valor escrito sobre a coluna; ausente em coluna sem dados */
  rotulo?: string
  destaque: boolean
}

/**
 * A coluna SEM DADOS: BAIXA (um terço da altura), hachurada e com o contorno que se vê (A11Y-IND-05).
 * Na altura inteira, quatro colunas tracejadas eram a coisa mais alta do gráfico e roubavam o olho do
 * mês medido (DQ-20); baixa, ela marca o lugar sem parecer um valor.
 */
function ColunaSemDados() {
  return (
    <div
      data-sem-dados
      className="h-1/3 w-full max-w-6 rounded-t-marca-de-dado border border-b-0 border-dashed border-grafico-sem-dados-contorno fundo-sem-dados"
    />
  )
}

/**
 * A coluna com valor, e o valor escrito LOGO ACIMA dela (DQ-03): o rótulo anda com a ponta da coluna,
 * em vez de ficar no teto do gráfico, longe da coluna baixa que ele nomeia. Uma linha só
 * (`whitespace-nowrap`), centrado na coluna — pode passar da largura dela, nunca da do vizinho.
 */
function ColunaComValor({ coluna, proporcao }: { coluna: ColunaDoGrafico; proporcao: number }) {
  return (
    <div
      data-destaque={coluna.destaque ? 'sim' : 'nao'}
      className={cn(
        'relative w-full max-w-6 rounded-t-marca-de-dado',
        coluna.destaque ? 'bg-grafico-destaque' : 'bg-grafico-recessivo',
      )}
      // um valor existente nunca some: 1% de altura mínima quando há medida
      style={{ height: `${String(Math.max(proporcao > 0 ? 1 : 0, Math.min(100, proporcao)))}%` }}
    >
      <span
        className={cn(
          'absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-meta leading-none tabular-nums',
          coluna.destaque ? 'font-semibold text-texto' : 'text-texto-suave',
        )}
      >
        {coluna.rotulo ?? ''}
      </span>
    </div>
  )
}

/**
 * Colunas de UMA série, com destaque. A coluna tem no máximo 24px (marcas finas: o vão é ar), a ponta
 * de dado arredondada e a base reta, e todas nascem de UMA linha de base, de ponta a ponta do gráfico
 * (DQ-03: uma base por coluna, com o vão entre elas, parecia uma régua quebrada). O valor vai sobre a
 * coluna — são poucas (6 meses, 7 dias), e cada uma é lida. A faixa de cima (`pt-5`) é o lugar do
 * rótulo da coluna mais alta.
 */
export function ColunasComDestaque({ colunas }: { colunas: readonly ColunaDoGrafico[] }) {
  return (
    <div aria-hidden="true" data-grafico className="flex flex-col gap-1.5">
      <div className="flex h-36 items-end gap-2 border-b border-linha pt-5">
        {colunas.map((coluna) => (
          <div key={coluna.chave} data-coluna={coluna.chave} className="flex h-full min-w-0 flex-1 items-end justify-center">
            {coluna.proporcao === null ? <ColunaSemDados /> : <ColunaComValor coluna={coluna} proporcao={coluna.proporcao} />}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        {colunas.map((coluna) => (
          <span
            key={coluna.chave}
            className={cn('min-w-0 flex-1 text-center text-meta', coluna.destaque ? 'font-medium text-texto' : 'text-texto-suave')}
          >
            {coluna.eixo}
          </span>
        ))}
      </div>
    </div>
  )
}

export interface BarraDoGrafico {
  chave: string
  rotulo: string
  /** De 0 a 100 */
  proporcao: number
  /** O valor em texto, à direita */
  valor: string
  destaque: boolean
}

/** Barras horizontais de UMA série, com destaque — o rótulo QUEBRA em vez de virar reticências. */
export function BarrasComDestaque({ barras }: { barras: readonly BarraDoGrafico[] }) {
  return (
    <div aria-hidden="true" data-grafico className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5">
      {barras.map((barra) => (
        <div key={barra.chave} className="contents">
          <span className={cn('break-words text-corpo', barra.destaque ? 'font-medium text-texto' : 'text-texto-suave')}>
            {barra.rotulo}
          </span>
          <span className="h-2 overflow-hidden rounded-r-marca-de-dado bg-fundo">
            <span
              data-destaque={barra.destaque ? 'sim' : 'nao'}
              className={cn('block h-full rounded-r-marca-de-dado', barra.destaque ? 'bg-grafico-destaque' : 'bg-grafico-recessivo')}
              style={{ width: `${String(Math.max(0, Math.min(100, barra.proporcao)))}%` }}
            />
          </span>
          <span className={cn('text-right text-corpo tabular-nums', barra.destaque ? 'font-semibold text-texto' : 'text-texto-suave')}>
            {barra.valor}
          </span>
        </div>
      ))}
    </div>
  )
}

type ColunasDaTabela = ReadonlyArray<{ rotulo: string; numerica?: boolean }>
type LinhasDaTabela = ReadonlyArray<{ chave: string; celulas: readonly ReactNode[] }>

function TabelaDosNumeros({ legenda, colunas, linhas }: { legenda: string; colunas: ColunasDaTabela; linhas: LinhasDaTabela }) {
  return (
    <Tabela legenda={legenda} densidade="compacta" rolagem="externa">
      <Tabela.Cabecalho>
        <Tabela.Linha>
          {colunas.map((coluna) => (
            <Tabela.CelulaCabecalho key={coluna.rotulo} className={coluna.numerica === true ? 'text-right' : undefined}>
              {coluna.rotulo}
            </Tabela.CelulaCabecalho>
          ))}
        </Tabela.Linha>
      </Tabela.Cabecalho>
      <Tabela.Corpo>
        {linhas.map((linha) => (
          <Tabela.Linha key={linha.chave}>
            {linha.celulas.map((celula, indice) => (
              <Tabela.Celula key={colunas[indice]?.rotulo ?? indice} numerica={colunas[indice]?.numerica === true}>
                {celula}
              </Tabela.Celula>
            ))}
          </Tabela.Linha>
        ))}
      </Tabela.Corpo>
    </Tabela>
  )
}

/**
 * O EQUIVALENTE EM TEXTO de um gráfico: a tabela com todos os números, recolhida num `details`
 * nativo (abre por teclado, sem JavaScript). O gráfico mostra a forma; a tabela, o valor exato — e
 * é ela que o leitor de tela lê, porque o desenho é `aria-hidden`.
 *
 * NO PAPEL a tabela vai aberta: um `details` fechado não imprime o conteúdo, e o mapa de ocupação
 * sem os números é só uma grade de cor. A cópia de impressão some da tela e do leitor de tela
 * (`hidden` + `aria-hidden`) — quem lê a tela já tem a tabela de cima.
 */
export function EquivalenteEmTabela({
  legenda,
  colunas,
  linhas,
}: {
  /** A legenda da tabela (`<caption>`) — o que ela lista */
  legenda: string
  colunas: ColunasDaTabela
  linhas: LinhasDaTabela
}) {
  return (
    <>
      <details data-nao-imprimir className="group">
        {/* o NOME da tabela vai junto, para o leitor de tela (A11Y-IND-06): numa aba com quatro
            gráficos, quatro "Ver os números em tabela" iguais não dizem qual abre o quê */}
        <summary className="w-fit cursor-pointer rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco">
          <span>Ver os números em tabela</span>
          <span className="sr-only">: {legenda}</span>
        </summary>
        {/* quem rola no celular é o `RoladorHorizontal` (véu + parada de teclado): rolando por dentro
            do invólucro da `Tabela`, a coluna da direita ficava fora do alcance do teclado (A11Y-02) */}
        <RoladorHorizontal rotulo={`${legenda} — role para ver as colunas`} className="mt-3">
          <TabelaDosNumeros legenda={legenda} colunas={colunas} linhas={linhas} />
        </RoladorHorizontal>
      </details>
      <div aria-hidden="true" className="hidden print:block">
        <TabelaDosNumeros legenda={legenda} colunas={colunas} linhas={linhas} />
      </div>
    </>
  )
}

/** A legenda do "sem dados": a amostra da hachura e o porquê, em texto. */
export function LegendaSemDados({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-pretty text-meta text-texto-suave">
      <span
        aria-hidden="true"
        data-grafico
        className="inline-block size-3 shrink-0 border border-dashed border-grafico-sem-dados-contorno fundo-sem-dados"
      />
      {children}
    </p>
  )
}

/**
 * A legenda do mês PARCIAL: o eixo diz só `out*`, e aqui vai o porquê — "out*: só até hoje, dia 5". A
 * coluna do mês em curso é baixa porque o mês ainda não acabou, não porque a clínica parou.
 */
export function LegendaDoParcial({ mes, dia }: { mes: string; dia: string }) {
  return <p className="text-pretty text-meta text-texto-suave">{`${mes}*: só até hoje, dia ${dia} — o mês ainda está em curso`}</p>
}

/** A legenda do destaque: o que a cor forte marca (identidade nunca só pela cor). */
export function LegendaDoDestaque({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-pretty text-meta text-texto-suave">
      <span aria-hidden="true" data-grafico className="inline-block size-3 shrink-0 bg-grafico-destaque" />
      {children}
    </p>
  )
}
