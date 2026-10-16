import { EquivalenteEmTabela, LegendaSemDados } from '@/componentes/indicadores/graficos-do-painel'
import { cn } from '@/lib/cn'
import { celulaMaisVazia, diaCurto, diaPorExtenso, formatarTaxa, PERIODOS_DO_DIA } from '@/lib/indicadores/frases'
import { formatarContagem } from '@/lib/numeros'
import type { PainelDaAgenda, PeriodoDoDia } from '@/tipos'

type Celula = PainelDaAgenda['ocupacao_por_periodo'][number]

/**
 * A escala SEQUENCIAL do mapa, do quase branco (vazio) ao verde médio (cheio) — uma cor só, cinco
 * degraus (`grafico-mapa-1..5`) validados pela skill de gráficos nos dois temas. Cinco faixas fixas de
 * 20 pontos: a legenda diz o intervalo de cada uma, e o mesmo tom quer dizer a mesma coisa em
 * qualquer mês. O degrau 1 encosta na superfície: uma célula com 0% fica quase sem tinta, nunca
 * "pintada" (DQ-02). O rótulo dentro da célula usa `texto` até o degrau 4 e `sobre-acento` no 5 —
 * todos com ≥ 4,5:1 (as guardas de contraste conferem os pares).
 */
const FAIXAS_DO_MAPA = [
  { fundo: 'bg-grafico-mapa-1', tinta: 'text-texto', rotulo: '0–19%' },
  { fundo: 'bg-grafico-mapa-2', tinta: 'text-texto', rotulo: '20–39%' },
  { fundo: 'bg-grafico-mapa-3', tinta: 'text-texto', rotulo: '40–59%' },
  { fundo: 'bg-grafico-mapa-4', tinta: 'text-texto', rotulo: '60–79%' },
  { fundo: 'bg-grafico-mapa-5', tinta: 'text-sobre-acento', rotulo: '80–100%' },
] as const

type Faixa = (typeof FAIXAS_DO_MAPA)[number]

function faixaDa(taxa: number): Faixa {
  return FAIXAS_DO_MAPA[Math.max(0, Math.min(FAIXAS_DO_MAPA.length - 1, Math.floor(taxa * FAIXAS_DO_MAPA.length)))]
}

function descricaoDaCelula(celula: Celula | undefined, dia: number, periodo: PeriodoDoDia): string {
  const locucao = PERIODOS_DO_DIA.find((item) => item.valor === periodo)?.locucao ?? ''
  const quando = `${diaPorExtenso(dia)} ${locucao}`
  if (celula === undefined || celula.taxa === null) {
    return `${quando}: sem horário na grade`
  }

  return `${quando}: ${formatarTaxa(celula.taxa)} (${formatarContagem(celula.marcadas)} de ${formatarContagem(celula.capacidade)} horários)`
}

/** Uma CÉLULA do mapa: hachurada sem capacidade, na faixa da taxa com ela; só a mais vazia leva o número. */
function CelulaDoMapa({ celula, dia, periodo, ehAMaisVazia }: { celula: Celula | undefined; dia: number; periodo: PeriodoDoDia; ehAMaisVazia: boolean }) {
  const titulo = descricaoDaCelula(celula, dia, periodo)
  const taxa = celula?.taxa ?? null

  if (taxa === null) {
    return (
      <span
        data-sem-dados
        title={titulo}
        className="h-9 rounded-controle border border-dashed border-grafico-sem-dados-contorno fundo-sem-dados"
      />
    )
  }
  const faixa = faixaDa(taxa)

  return (
    <span
      data-faixa={faixa.rotulo}
      title={titulo}
      className={cn(
        'flex h-9 items-center justify-center rounded-controle text-meta font-semibold tabular-nums',
        faixa.fundo,
        faixa.tinta,
        // a mais vazia ganha o anel: é o assunto do título
        ehAMaisVazia && 'ring-2 ring-texto ring-offset-1 ring-offset-superficie',
      )}
    >
      {ehAMaisVazia ? formatarTaxa(taxa) : null}
    </span>
  )
}

/** A grade dia × período, desenhada. As colunas são os dias que o servidor mandou (com grade ou sessão). */
function GradeDoMapa({ celulas, dias }: { celulas: PainelDaAgenda['ocupacao_por_periodo']; dias: readonly number[] }) {
  const vazia = celulaMaisVazia(celulas)
  const celulaEm = (dia: number, periodo: PeriodoDoDia): Celula | undefined =>
    celulas.find((celula) => celula.dia === dia && celula.periodo === periodo)

  return (
    <div
      aria-hidden="true"
      data-grafico
      className="grid gap-0.5"
      style={{ gridTemplateColumns: `auto repeat(${String(dias.length)}, minmax(0, 1fr))` }}
    >
      <span />
      {dias.map((dia) => (
        <span key={dia} className="pb-1 text-center text-meta text-texto-suave">
          {diaCurto(dia)}
        </span>
      ))}
      {PERIODOS_DO_DIA.map((periodo) => (
        <div key={periodo.valor} className="contents">
          <span className="flex items-center pr-2 text-meta text-texto-suave">{periodo.rotulo}</span>
          {dias.map((dia) => {
            const celula = celulaEm(dia, periodo.valor)

            return <CelulaDoMapa key={dia} celula={celula} dia={dia} periodo={periodo.valor} ehAMaisVazia={vazia !== null && celula === vazia} />
          })}
        </div>
      ))}
    </div>
  )
}

/** A legenda da escala: do mais vazio ao mais cheio, e a hachura quando há período sem grade. */
function LegendaDoMapa({ comSemHorario }: { comSemHorario: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-texto-suave">
        <span>Mais vazio</span>
        <span aria-hidden="true" data-grafico className="flex gap-0.5">
          {FAIXAS_DO_MAPA.map((faixa) => (
            <span
              key={faixa.rotulo}
              title={faixa.rotulo}
              className={cn('h-3 w-6 border border-linha first:rounded-l-controle last:rounded-r-controle', faixa.fundo)}
            />
          ))}
        </span>
        <span>Mais cheio</span>
        <span className="sr-only">Cinco faixas de ocupação, de 20 em 20 pontos.</span>
      </div>
      {comSemHorario ? <LegendaSemDados>Sem horário na grade naquele período</LegendaSemDados> : null}
    </div>
  )
}

/**
 * O MAPA DE OCUPAÇÃO (D6): dia da semana × período do dia, numa cor só, do claro ao escuro. O vão de
 * 2px entre as células é a cor da superfície (nunca uma borda desenhada). Só a célula MAIS VAZIA leva
 * o número escrito — é ela que o título nomeia; o resto está na tabela logo abaixo, que é também o
 * equivalente para o leitor de tela (o desenho é `aria-hidden`).
 *
 * Célula sem capacidade (ninguém com horário naquele período) é HACHURADA, nunca um 0%.
 */
export function MapaDeOcupacao({ celulas }: { celulas: PainelDaAgenda['ocupacao_por_periodo'] }) {
  const dias = [...new Set(celulas.map((celula) => celula.dia))].sort((a, b) => a - b)
  const celulaEm = (dia: number, periodo: PeriodoDoDia): Celula | undefined =>
    celulas.find((celula) => celula.dia === dia && celula.periodo === periodo)

  return (
    <div className="flex flex-col gap-4">
      <GradeDoMapa celulas={celulas} dias={dias} />
      <LegendaDoMapa comSemHorario={celulas.some((celula) => celula.taxa === null)} />
      <EquivalenteEmTabela
        legenda="Ocupação por dia da semana e período do dia"
        colunas={[{ rotulo: 'Dia' }, ...PERIODOS_DO_DIA.map((periodo) => ({ rotulo: periodo.rotulo, numerica: true }))]}
        linhas={dias.map((dia) => ({
          chave: String(dia),
          celulas: [
            diaPorExtenso(dia),
            ...PERIODOS_DO_DIA.map((periodo) => {
              const celula = celulaEm(dia, periodo.valor)

              return celula === undefined || celula.taxa === null
                ? 'sem horário'
                : `${formatarTaxa(celula.taxa)} · ${formatarContagem(celula.marcadas)} de ${formatarContagem(celula.capacidade)}`
            }),
          ],
        }))}
      />
    </div>
  )
}
