import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { cn } from '@/lib/cn'
import { formatarBRL, somarDecimais } from '@/lib/dinheiro'
import { rotuloCurtoDoMes, rotuloDoMes } from '@/lib/meses'
import { formatarContagem } from '@/lib/numeros'

/**
 * Primitivos de gráfico do dashboard (§11) — divs com tokens do design system,
 * sem lib. O TEXTO carrega o dado (nome + número legíveis sempre); a barra é
 * reforço visual (aria-hidden): identidade nunca depende só de cor (WCAG 1.4.1).
 * Marcas finas, ponta de dado arredondada 4px ancorada na base, folgas ≥ 2px.
 *
 * Toda porta daqui é um LINK REAL (`para`) — nunca div clicável: papel de link,
 * foco visível, e ela só é renderizada quando o chamador tem a permissão do
 * DESTINO (drill-down: número bom gera a pergunta "quais são?").
 */

/** Número-destaque com rótulo — KPI é texto, não gráfico; com `para`, o número é porta. */
export function NumeroDestaque({ rotulo, valor, para }: { rotulo: string; valor: string; para?: string }) {
  const conteudo = (
    <>
      <span className="text-titulo font-semibold tabular-nums text-texto">{valor}</span>
      <span className="text-meta text-texto-suave">{rotulo}</span>
    </>
  )

  if (para === undefined) {
    return <p className="flex flex-col gap-0.5">{conteudo}</p>
  }

  return (
    <p>
      <Link
        to={para}
        className="flex w-fit flex-col gap-0.5 rounded-controle hover:bg-hover-de-linha focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        {conteudo}
      </Link>
    </p>
  )
}

export interface LinhaDeBarraProps {
  rotulo: string
  total: number
  /** O maior total do conjunto — a barra é proporção dele (≥ 1 para não dividir por zero) */
  maximo: number
  /** Cor DERIVADA (via `derivarTonsStatus`) quando o dado tem cor própria; ausente = acento */
  estilo?: CSSProperties
  /** Destino do drill — a linha vira LINK real; ausente (cauda "Outras", "Sem convênio"), fica texto */
  para?: string
  /**
   * A cor da barra sem `estilo`: `acento` (a de sempre) ou, nos gráficos com destaque
   * (indicadores-profissionais), `destaque` para o valor que importa e `recessivo` para o resto.
   */
  tom?: 'acento' | 'destaque' | 'recessivo'
}

const COR_DA_BARRA: Record<NonNullable<LinhaDeBarraProps['tom']>, string> = {
  acento: 'bg-acento',
  destaque: 'bg-grafico-destaque',
  recessivo: 'bg-grafico-recessivo',
}

/** Barra horizontal com o rótulo e a contagem SEMPRE em texto; com `para`, a linha é porta. */
export function LinhaDeBarra({ rotulo, total, maximo, estilo, para, tom = 'acento' }: LinhaDeBarraProps) {
  const proporcao = Math.max(0, Math.min(100, (total / Math.max(maximo, 1)) * 100))

  const conteudo = (
    <>
      {/* `max-w-56` em vez de `w-32` fixo: com 128px o rótulo cortava "Desmarcado pelo …" —
          e o corte caía justamente na palavra que separa "pelo Paciente" de "pelo
          Profissional" — num cartão de 554px que tinha folga de sobra (DQ-04). O `min-w-32`
          mantém as barras alinhadas entre as linhas; a barra encolhe, o rótulo não mente. */}
      <span className="min-w-32 max-w-56 shrink-0 truncate text-corpo text-texto" title={rotulo}>
        {rotulo}
      </span>
      {/* `data-grafico`: a barra é FUNDO de cor, e o papel não imprime fundo — sem a marca, a trilha
          sumia na impressão e sobrava um vão entre o nome e o número (DQ-08) */}
      <div aria-hidden="true" data-grafico className="h-2.5 flex-1 overflow-hidden rounded-r-marca-de-dado bg-fundo">
        <div
          data-tom={estilo === undefined ? tom : undefined}
          className={cn('h-full rounded-r-marca-de-dado', estilo === undefined && COR_DA_BARRA[tom])}
          style={{ width: `${proporcao}%`, ...estilo }}
        />
      </div>
      <span className="min-w-8 shrink-0 text-right text-corpo font-medium tabular-nums text-texto">{formatarContagem(total)}</span>
    </>
  )

  if (para === undefined) {
    return <div className="flex items-center gap-3 px-1 py-0.5">{conteudo}</div>
  }

  return (
    <Link
      to={para}
      className="flex items-center gap-3 rounded-controle px-1 py-0.5 hover:bg-hover-de-linha focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
    >
      {conteudo}
    </Link>
  )
}

const TETO_DE_LINHAS = 8

export interface LinhaDaQuebra {
  chave: string
  rotulo: string
  total: number
  /** Destino do drill (quando a linha filtra uma dimensão); ausente = fica texto */
  para?: string
}

/**
 * Uma quebra (por especialidade, convênio, sexo, indicação…): barras com rótulo e
 * contagem em TEXTO. Em escala (dezenas de categorias) o card não estica: as 8
 * maiores aparecem e a cauda vira UMA linha declarada "Outras (+N)" com o total
 * somado — teto visual, nunca corte silencioso; o dado da API segue íntegro. A
 * cauda agregada não tem porta (não há UMA dimensão que a filtre).
 *
 * **Esta mede CONTAGEM.** Para DINHEIRO use a irmã `QuebraDeValores`: aqui o total
 * é `number` e sai por `formatarContagem`, o que num valor financeiro seria float
 * na entrada e "1.234" no lugar de "R$ 1.234,50" na saída.
 */
export function Quebra({
  titulo,
  linhas,
  destacarMaior = false,
}: {
  titulo: string
  linhas: LinhaDaQuebra[]
  /** O maior valor em DESTAQUE e o resto RECESSIVO (o padrão das abas de detalhe) */
  destacarMaior?: boolean
}) {
  const maximo = Math.max(...linhas.map((linha) => linha.total), 1)
  const tomDa = (total: number): LinhaDeBarraProps['tom'] =>
    destacarMaior ? (total === maximo && total > 0 ? 'destaque' : 'recessivo') : 'acento'
  const visiveis = linhas.slice(0, TETO_DE_LINHAS)
  const cauda = linhas.slice(TETO_DE_LINHAS)
  const totalDaCauda = cauda.reduce((soma, linha) => soma + linha.total, 0)

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-meta font-medium text-texto-suave">{titulo}</h3>
      {visiveis.map((linha) => (
        <LinhaDeBarra
          key={linha.chave}
          rotulo={linha.rotulo}
          total={linha.total}
          maximo={maximo}
          para={linha.para}
          tom={tomDa(linha.total)}
        />
      ))}
      {cauda.length > 0 ? (
        // a cauda agregada nunca é o destaque: ela não é UMA categoria
        <LinhaDeBarra
          rotulo={`Outras (+${cauda.length})`}
          total={totalDaCauda}
          maximo={maximo}
          tom={destacarMaior ? 'recessivo' : 'acento'}
        />
      ) : null}
    </div>
  )
}

export interface LinhaDeValor {
  chave: string
  rotulo: string
  /** decimal string — nunca float (D1) */
  valor: string
}

/**
 * A irmã de `Quebra` para DINHEIRO: mesma leitura (barra + rótulo + valor em texto,
 * teto de 8 linhas e cauda "Outras (+N)"), mas o valor é STRING decimal e sai por
 * `formatarBRL`.
 *
 * `Number(valor)` aparece aqui uma vez e SÓ dimensiona a GEOMETRIA da barra — nunca
 * é exibido nem somado. O total da cauda vem de `somarDecimais` (centavos inteiros),
 * porque um `reduce` de float inventaria centavo justamente na linha que ninguém
 * conferiria.
 */
export function QuebraDeValores({
  titulo,
  linhas,
  tom = 'receita',
}: {
  titulo: string
  linhas: LinhaDeValor[]
  /** Governa a cor da barra: despesa em `perigo`, receita em `acento` (achado NIT-9 — a
   *  barra verde sob um valor vermelho, no mesmo cartão, era ruído semântico). */
  tom?: 'receita' | 'despesa'
}) {
  const maximo = Math.max(...linhas.map((linha) => Number(linha.valor)), 1)
  const visiveis = linhas.slice(0, TETO_DE_LINHAS)
  const cauda = linhas.slice(TETO_DE_LINHAS)
  const totalDaCauda = somarDecimais(cauda.map((linha) => linha.valor))

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-meta font-medium text-texto-suave">{titulo}</h3>
      {visiveis.map((linha) => (
        <LinhaDeBarraDeValor key={linha.chave} rotulo={linha.rotulo} valor={linha.valor} maximo={maximo} tom={tom} />
      ))}
      {cauda.length > 0 ? (
        <LinhaDeBarraDeValor rotulo={`Outras (+${cauda.length})`} valor={totalDaCauda} maximo={maximo} tom={tom} />
      ) : null}
    </div>
  )
}

/**
 * Uma barra de valor em DUAS linhas: rótulo + BRL em cima, barra cheia embaixo.
 *
 * A primeira versão punha os três lado a lado, com o rótulo numa caixa fixa de `w-32`
 * (128px). Como o discriminador da quebra vem no FIM do rótulo
 * (`Atendimentos › Fonoaudiologia`), o truncamento comia exatamente o que diferencia:
 * três subcategorias da mesma categoria viravam três barras com o MESMO texto — em
 * 1440px tanto quanto em 390px. Era o núcleo da decisão D3 falhando (BLOQ-2 do gate).
 *
 * Empilhar resolveu 1440px e 768px — **e não resolveu 390px nem 320px**, o que este
 * docblock chegou a afirmar por engano. Com `justify-between`, o rótulo fica com o que
 * sobra do valor: duas linhas cujos valores têm a MESMA largura recebem caixas
 * idênticas (196px em 390px) e truncam no mesmo caractere. A "distinção" da terceira
 * era acidente da largura do valor dela.
 *
 * Por isso o rótulo **quebra em mais de uma linha** em vez de truncar. Custa altura
 * (medido: +189px no cartão em 390px) e devolve os 3 de 3 rótulos distintos, sem
 * reintroduzir arrasto de página. Num gráfico cujo contrato é "o TEXTO carrega o dado",
 * altura é o preço certo a pagar; reticências no lugar do nome, não.
 */
function LinhaDeBarraDeValor({
  rotulo,
  valor,
  maximo,
  tom,
}: {
  rotulo: string
  valor: string
  maximo: number
  tom: 'receita' | 'despesa'
}) {
  const proporcao = Math.max(0, Math.min(100, (Number(valor) / Math.max(maximo, 1)) * 100))

  return (
    <div className="flex flex-col gap-1 px-1">
      <div className="flex items-baseline justify-between gap-3">
        {/* sem `truncate`: o rótulo quebra em linha nova em vez de virar reticências —
            ver o docblock acima. `break-words` cobre o rótulo de palavra única gigante. */}
        <span className="min-w-0 break-words text-corpo text-texto" title={rotulo}>
          {rotulo}
        </span>
        <span className="shrink-0 whitespace-nowrap text-corpo font-medium tabular-nums text-texto">
          {formatarBRL(valor)}
        </span>
      </div>
      <div aria-hidden="true" data-grafico className="h-2 w-full overflow-hidden rounded-r-marca-de-dado bg-fundo">
        <div
          className={cn('h-full rounded-r-marca-de-dado', tom === 'despesa' ? 'bg-perigo' : 'bg-acento')}
          style={{ width: `${proporcao}%` }}
        />
      </div>
    </div>
  )
}

export interface ColunaPareada {
  mes: string
  /** Rótulos já FORMATADOS (BRL) — o par numérico vive na tabela ao lado */
  primeira: { proporcao: number; titulo: string }
  segunda: { proporcao: number; titulo: string }
  /**
   * Mês SEM DADOS — antes de o sistema existir na clínica: uma coluna hachurada no lugar do par,
   * nunca duas colunas zeradas (que liam como "a clínica não recebeu nem pagou nada").
   */
  semDados?: boolean
}

/**
 * Colunas pareadas (recebidas × pagas). Par acento × perigo validado no gate da
 * change: CVD na faixa 6–8 — LEGAL apenas com a codificação secundária que este
 * bloco carrega por contrato (ordem fixa, folga de 2px, legenda em texto e a
 * tabela de valores ao lado). Não remover um sem o outro.
 */
/**
 * A chave de cor do par acento×perigo, em TEXTO.
 *
 * Extraída de `ColunasPareadas` porque, quando as colunas passaram a viver dentro de um
 * rolador horizontal, a legenda rolava JUNTO e sumia — sobravam barras verdes e vermelhas
 * sem chave, quebrando o contrato de CVD que o próprio componente declara (achado IMP-14
 * do gate). Agora quem rola põe a legenda FORA do rolador; quem não rola segue usando a
 * legenda embutida.
 */
export function LegendaPareada({ legendas }: { legendas: [string, string] }) {
  return (
    <div className="flex items-center gap-4 text-meta text-texto-suave">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-acento" />
        {legendas[0]}
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-perigo" />
        {legendas[1]}
      </span>
    </div>
  )
}

/**
 * O par de UM mês (ou a coluna hachurada do mês sem dados). Desconto sem teto pode deixar a soma
 * mensal NEGATIVA: altura negativa é CSS inválido (descartado em silêncio) — o clamp vive aqui, uma
 * vez (gate CR r1).
 */
function ParDoMes({ item }: { item: ColunaPareada }) {
  const altura = (proporcao: number): string => `${Math.max(0, Math.min(100, proporcao))}%`

  if (item.semDados === true) {
    return (
      <div
        data-sem-dados
        title={`${rotuloDoMes(item.mes)}: sem dados`}
        // baixa (um terço), como no painel: o mês sem dados marca o lugar sem parecer um valor (DQ-20)
        className="h-1/3 w-2/3 rounded-t-marca-de-dado border border-b-0 border-dashed border-grafico-sem-dados-contorno fundo-sem-dados"
      />
    )
  }

  return (
    <>
      <div className="w-1/3 rounded-t-marca-de-dado bg-acento" style={{ height: altura(item.primeira.proporcao) }} title={item.primeira.titulo} />
      <div className="w-1/3 rounded-t-marca-de-dado bg-perigo" style={{ height: altura(item.segunda.proporcao) }} title={item.segunda.titulo} />
    </>
  )
}

export function ColunasPareadas({
  itens,
  legendas,
  semLegenda = false,
}: {
  itens: ColunaPareada[]
  legendas: [string, string]
  /** Só passe `true` quando a legenda for renderizada FORA — nunca para omiti-la de vez:
   *  o contrato de CVD deste componente exige a chave em texto ao lado das barras. */
  semLegenda?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      {semLegenda ? null : <LegendaPareada legendas={legendas} />}
      {/* UMA linha de base de ponta a ponta (DQ-03): uma por mês, com o vão entre elas, parecia uma
          régua quebrada. Os meses vão numa linha própria, abaixo da base */}
      <div aria-hidden="true" data-grafico className="flex flex-col gap-1">
        <div className="flex h-16 items-end gap-2 border-b border-linha">
          {itens.map((item) => (
            <div key={item.mes} className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5">
              <ParDoMes item={item} />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          {itens.map((item) => (
            <span key={item.mes} className="min-w-0 flex-1 text-center text-meta text-texto-suave">
              {rotuloCurtoDoMes(item.mes)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Barra de PERCENTUAL (0–100) com o número em texto ao lado — para as taxas da aba
 * Produtividade. `null` é "não há o que medir" (sem denominador) e sai como "—", nunca
 * como 0%: zero é um resultado, travessão é a ausência dele. O percentual vem PRONTO do
 * servidor — a tela não divide nada (lição da change graficos-financeiros).
 */
export function BarraDePercentual({ valor }: { valor: number | null }) {
  const largura = valor === null ? 0 : Math.max(0, Math.min(100, valor))

  return (
    // SEM `aria-label` aqui: a ARIA 1.2 proíbe nomear um `span` genérico, e o Chromium
    // responde IGNORANDO o texto visível ("15%") enquanto o Gecko descarta o rótulo — o
    // número sumia para quem usa leitor de tela, dependendo do navegador (achado A11Y-04).
    // Quem nomeia a métrica é o cabeçalho da coluna (ou o `dt`, no detalhe); aqui fica só o
    // número, em texto. O travessão do `null` ganha a palavra que ele significa.
    <span className="flex items-center gap-2">
      {/* `data-nao-imprimir`: no PAPEL a barra não diz nada que o número não diga, e ela custa
          144px por coluna que NÃO encolhem (`w-24 shrink-0`) — com as duas, a tabela fechava em
          953px contra 696px de folha e a coluna "Produtividade" saía do cartão, encostada na
          borda da página (achado DQ-02 do design-qa, conferido na página renderizada). */}
      <span aria-hidden="true" data-nao-imprimir className="h-2.5 w-24 shrink-0 overflow-hidden rounded-r-marca-de-dado bg-fundo">
        <span className="block h-full rounded-r-marca-de-dado bg-acento" style={{ width: `${String(largura)}%` }} />
      </span>
      <span className="min-w-10 text-right text-corpo font-medium tabular-nums text-texto">
        {valor === null ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="sr-only">sem medida</span>
          </>
        ) : (
          `${String(valor)}%`
        )}
      </span>
    </span>
  )
}
