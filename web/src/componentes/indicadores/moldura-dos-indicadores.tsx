import { useId, type ReactNode } from 'react'

import { useTagDoTitulo } from '@/componentes/indicadores/nivel-do-titulo'
import { cn } from '@/lib/cn'

/**
 * As MOLDURAS e os ESQUELETOS da área de Indicadores (change indicadores-profissionais) — num módulo
 * LEVE de propósito: só React, `cn` e tokens. As páginas da área são carregadas sob demanda
 * (`React.lazy`, PERF-08), e o esqueleto que segura a caixa enquanto o código da aba chega mora aqui:
 * se ele importasse as frases, os gráficos ou o Popover, o pacote principal voltaria a carregar tudo.
 *
 * O esqueleto desenha a MESMA anatomia do conteúdo, linha por linha, com a MESMA tipografia: cada
 * linha pendente é um parágrafo do papel tipográfico final (`text-display`, `text-meta`…) com uma
 * barra no lugar das letras — a altura é a da linha de verdade, não um palpite em pixels. Assim o
 * cartão não muda de tamanho quando o número chega (DQ-15, PERF-01).
 */

/**
 * Quantas colunas por quantidade de cartões, pela largura da ÁREA (container query) — nunca um
 * cartão órfão sozinho numa linha nem um buraco no fim dela (DQ-13). Com número ÍMPAR de cartões, o
 * PRIMEIRO (a manchete da aba: ocupação, ativos, evoluções em dia) ocupa duas colunas quando a linha
 * não comporta todos:
 * - cinco: um por linha no celular; no tablet (a área tem ~28rem com a barra lateral aberta) a
 *   manchete larga e 2 + 2; de 36rem, a manchete larga + 1 e depois 3; de 64rem, os cinco lado a lado;
 * - quatro: 2 + 2, e os quatro lado a lado de 60rem;
 * - três: a manchete larga e 2 lado a lado; de 36rem, os três.
 * "3 + 2" com a área de 28rem dava cartões de 140px, com a frase em colunas de doze letras.
 */
const COLUNAS_POR_QUANTIDADE: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 @min-[26rem]:grid-cols-2',
  3: 'grid-cols-1 @min-[26rem]:grid-cols-2 @min-[26rem]:[&>:first-child]:col-span-2 @min-[36rem]:grid-cols-3 @min-[36rem]:[&>:first-child]:col-span-1',
  4: 'grid-cols-1 @min-[26rem]:grid-cols-2 @min-[60rem]:grid-cols-4',
  5: 'grid-cols-1 @min-[26rem]:grid-cols-2 @min-[26rem]:[&>:first-child]:col-span-2 @min-[36rem]:grid-cols-3 @min-[64rem]:grid-cols-5 @min-[64rem]:[&>:first-child]:col-span-1',
}

/** A grade dos cartões de uma linha. A página diz QUANTOS vão nela; a grade escolhe as colunas. */
export function GradeDeCartoes({ quantidade, children }: { quantidade: number; children: ReactNode }) {
  return <div className={cn('grid gap-4', COLUNAS_POR_QUANTIDADE[Math.min(5, Math.max(1, quantidade))])}>{children}</div>
}

/**
 * Duas peças lado a lado no monitor, empilhadas no celular — pela largura da ÁREA, não da janela.
 * As duas com a MESMA altura (o `stretch` padrão da grade): um quadro curto ao lado de um alto deixava
 * um buraco embaixo e a linha parecia torta (DQ-04).
 */
export function ParDeQuadros({ children, proporcao = 'igual' }: { children: ReactNode; proporcao?: 'igual' | 'tendencia' }) {
  return (
    <div
      className={cn(
        'grid gap-4',
        proporcao === 'igual' ? '@min-[56rem]:grid-cols-2' : '@min-[60rem]:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]',
      )}
    >
      {children}
    </div>
  )
}

/**
 * A moldura de UM cartão: o rótulo como título da seção e um acessório ao lado (o "i" da definição,
 * que mora em `cartao-do-indicador` — aqui só o lugar dele).
 *
 * As SEIS FAIXAS do cartão — rótulo, número, legenda, comparação, frase e porta — são linhas da grade
 * da LINHA de cartões (`subgrid`), não do cartão: a comparação de um cartão que quebra em duas linhas
 * empurra a frase de TODOS os vizinhos junto, e o fio da frase fica na mesma altura de ponta a ponta
 * (DQ-05). Cada cartão preenche as seis faixas, mesmo vazias.
 */
export function MolduraDoCartao({
  rotulo,
  acessorio,
  ocupado = false,
  children,
}: {
  rotulo: string
  acessorio?: ReactNode
  ocupado?: boolean
  children: ReactNode
}) {
  const id = useId()
  const Titulo = useTagDoTitulo()

  return (
    <section
      aria-labelledby={id}
      aria-busy={ocupado || undefined}
      // `min-w-0`: item de grade com `min-width: auto` se infla até o maior texto sem quebra e
      // empurra a página de lado no celular (lição do BLOQ-12 dos cartões antigos)
      // SEM `@container` aqui: ele liga a contenção de layout, e um elemento contido não pode ser
      // `subgrid` — as seis faixas deixavam de seguir as dos vizinhos (medido na aba Equipe)
      className="row-span-6 grid min-w-0 grid-rows-subgrid gap-y-0 rounded-superficie border border-linha bg-superficie p-5 shadow-e1 print:break-inside-avoid print:shadow-none"
    >
      <div className="flex min-h-6 items-start justify-between gap-3">
        <Titulo id={id} className="pt-0.5 text-meta font-semibold uppercase tracking-wider text-texto-suave">
          {rotulo}
        </Titulo>
        {acessorio}
      </div>
      {children}
    </section>
  )
}

/**
 * Uma LINHA pendente: o parágrafo com a tipografia da linha final e uma barra no lugar do texto. A
 * altura é exatamente UMA linha do papel (`1lh`, a `line-height` dele) — nem a métrica da fonte nem a
 * troca da fonte na carga mexem nela —, e bate com a linha do texto que vai chegar.
 */
function LinhaPendente({ className, largura }: { className: string; largura: string }) {
  return (
    // o respiro é PADDING do parágrafo, não margem da barra: margem vertical de filho atravessa o pai
    // e colapsa com a da linha vizinha, e cada linha pendente ficava com 0,8 linha
    <p aria-hidden="true" className={cn('py-[0.2lh]', className)}>
      <span className={cn('block h-[0.6lh] animate-pulse rounded-campo bg-neutro-200', largura)} />
    </p>
  )
}

/**
 * Quantas linhas a frase reserva em cada largura do CONTEÚDO do cartão (a caixa do `@container`, sem o
 * respiro): estreito (< 12rem), médio (12–18rem) e largo (≥ 18rem). A frase quebra mais no cartão estreito — no tablet, com dois cartões lado a lado,
 * a da Agenda tem 8 linhas; no celular, de largura cheia, 4 —, e a linha de cartões tem a altura do
 * mais alto. Os números saíram da medida das frases de outubro em 390, 768, 1024 e 1440 px.
 */
export type LinhasPorLargura = readonly [estreito: number, medio: number, largo: number]

/** A linha `indice` aparece só nas larguras em que a frase tem tantas linhas. */
function visibilidadeDaLinha(indice: number, [estreito, medio, largo]: LinhasPorLargura): string {
  return cn(
    indice >= estreito && 'hidden',
    indice < medio ? '@min-[12rem]:block' : '@min-[12rem]:hidden',
    indice < largo ? '@min-[18rem]:block' : '@min-[18rem]:hidden',
  )
}

/**
 * CARREGANDO um cartão: a mesma moldura, com o número, a legenda, a linha da comparação, a frase e a
 * porta na tipografia de cada um. `linhasDaFrase` é quantas linhas a frase daquele cartão costuma ter
 * no celular — o cartão mais alto de uma linha é que dita a altura dela.
 */
/** As linhas de uma faixa do cartão pendente, dentro de um `@container` com a largura do conteúdo. */
function LinhasDaFaixa({ linhas, className, tipo }: { linhas: LinhasPorLargura; className: string; tipo: string }) {
  const maximo = Math.max(...linhas)

  return (
    <div className={cn('@container', className)}>
      {Array.from({ length: maximo }, (_, indice) => (
        <LinhaPendente
          key={indice}
          className={cn(tipo, visibilidadeDaLinha(indice, linhas))}
          largura={indice === maximo - 1 && maximo > 1 ? 'w-3/5' : 'w-full max-w-40'}
        />
      ))}
    </div>
  )
}

/** Um número vira as três larguras iguais. */
function porLargura(linhas: number | LinhasPorLargura): LinhasPorLargura {
  return typeof linhas === 'number' ? [linhas, linhas, linhas] : linhas
}

export function CartaoPendente({
  rotulo,
  linhasDaFrase = 2,
  linhasDaComparacao = [2, 2, 1],
  linhasDaLegenda = 1,
  comPorta = false,
}: {
  rotulo: string
  /** Um número (o mesmo em toda largura) ou as linhas por largura do cartão */
  linhasDaFrase?: number | LinhasPorLargura
  /** "↓ 45% a menos / que em 1º a 5 de setembro" quebra em duas no cartão estreito e no médio */
  linhasDaComparacao?: number | LinhasPorLargura
  linhasDaLegenda?: number | LinhasPorLargura
  comPorta?: boolean
}) {
  const linhas = porLargura(linhasDaFrase)
  const maximo = Math.max(...linhas)

  return (
    <MolduraDoCartao rotulo={rotulo} ocupado>
      <LinhaPendente className="mt-2 font-display text-display font-semibold" largura="w-28" />
      <LinhasDaFaixa className="mt-1" tipo="text-meta" linhas={porLargura(linhasDaLegenda)} />
      <LinhasDaFaixa className="mt-1.5" tipo="text-meta" linhas={porLargura(linhasDaComparacao)} />
      {maximo > 0 ? (
        // `@container`: as linhas reservadas seguem a largura do CONTEÚDO do cartão
        <div className="@container mt-4 border-t border-linha pt-3">
          {Array.from({ length: maximo }, (_, indice) => (
            <LinhaPendente
              key={indice}
              className={cn('text-corpo', visibilidadeDaLinha(indice, linhas))}
              largura={indice === maximo - 1 ? 'w-3/4' : 'w-full'}
            />
          ))}
        </div>
      ) : (
        <div />
      )}
      {comPorta ? <LinhaPendente className="pt-3 text-meta" largura="w-32" /> : <div />}
    </MolduraDoCartao>
  )
}

/**
 * CARREGANDO a linha do período (`LinhaDoPeriodo`): uma linha de `text-meta`, que quebra em duas abaixo
 * de 36rem de área — a altura que ela vai ter quando chegar (CLS 0 — PERF-01).
 */
export function LinhaDoPeriodoPendente() {
  return (
    <div aria-hidden="true" className="@container">
      <LinhaPendente className="text-meta" largura="w-full max-w-md" />
      <LinhaPendente className="text-meta @min-[36rem]:hidden" largura="w-1/2" />
    </div>
  )
}

/**
 * CARREGANDO um quadro de gráfico: o título e o subtítulo no lugar, e a caixa do desenho (com as
 * legendas e o "Ver os números em tabela" que vêm abaixo dele). O título-conclusão costuma quebrar em
 * duas linhas abaixo de 36rem de área.
 */
export function QuadroPendente({ titulo, altura = 'h-56' }: { titulo: string; altura?: string }) {
  const id = useId()

  return (
    <section
      aria-labelledby={id}
      aria-busy="true"
      className="flex min-w-0 flex-col gap-4 rounded-superficie border border-linha bg-superficie p-5 shadow-e1"
    >
      <h2 id={id} className="sr-only">
        {titulo}
      </h2>
      <div className="flex flex-col gap-1">
        <div>
          <LinhaPendente className="text-subtitulo" largura="w-full" />
          <LinhaPendente className="text-subtitulo @min-[36rem]:hidden" largura="w-1/2" />
        </div>
        <LinhaPendente className="text-meta" largura="w-1/2" />
      </div>
      <div aria-hidden="true" className={cn('w-full animate-pulse rounded-campo bg-neutro-200', altura)} />
    </section>
  )
}

export interface EsqueletoDeCartao {
  rotulo: string
  linhasDaFrase?: number | LinhasPorLargura
  linhasDaComparacao?: number | LinhasPorLargura
  linhasDaLegenda?: number | LinhasPorLargura
  comPorta?: boolean
}

/**
 * O esqueleto de uma ABA DE DETALHE inteira — que vem de um painel só: enquanto ele não chega, a aba
 * desenha a mesma ordem do conteúdo (a linha do período, os cartões, os gráficos), na caixa de cada
 * peça, numa região só nomeada pela aba ("Agenda no mês").
 */
export function EsqueletoDaAba({
  titulo,
  cartoes,
  quadros = 2,
}: {
  titulo: string
  cartoes: readonly EsqueletoDeCartao[]
  /** Quantos quadros de gráfico seguem os cartões (0 quando vêm de outra consulta, com o esqueleto próprio) */
  quadros?: number
}) {
  return (
    <section aria-label={titulo} aria-busy="true" className="flex flex-col gap-5">
      <LinhaDoPeriodoPendente />
      <GradeDeCartoes quantidade={cartoes.length}>
        {cartoes.map((cartao) => (
          <CartaoPendente key={cartao.rotulo} {...cartao} />
        ))}
      </GradeDeCartoes>
      {quadros > 0 ? (
        <ParDeQuadros>
          {Array.from({ length: quadros }, (_, indice) => (
            <QuadroPendente key={indice} titulo="Carregando o gráfico" altura="h-64" />
          ))}
        </ParDeQuadros>
      ) : null}
    </section>
  )
}

/**
 * O que a área mostra enquanto o CÓDIGO de uma aba chega (o `Suspense` das rotas sob demanda): a
 * linha do período e uma linha de cartões, na caixa do conteúdo, numa região só ("Carregando a aba") —
 * quatro regiões chamadas "carregando" seriam ruído para o leitor de tela. Nada abaixo dele se move
 * quando a aba monta: ele é a última coisa da página.
 */
export function EsqueletoDaArea() {
  return (
    <section aria-label="Carregando a aba" className="@container flex flex-col gap-5" aria-busy="true">
      <LinhaDoPeriodoPendente />
      <div aria-hidden="true">
        <GradeDeCartoes quantidade={4}>
          {Array.from({ length: 4 }, (_, indice) => (
            <div key={indice} className="flex h-full min-w-0 flex-col rounded-superficie border border-linha bg-superficie p-5 shadow-e1">
              <LinhaPendente className="text-meta" largura="w-20" />
              <LinhaPendente className="mt-2 font-display text-display font-semibold" largura="w-28" />
              <LinhaPendente className="mt-1 text-meta" largura="w-24" />
              <LinhaPendente className="mt-1.5 text-meta" largura="w-40 max-w-full" />
            </div>
          ))}
        </GradeDeCartoes>
      </div>
    </section>
  )
}
