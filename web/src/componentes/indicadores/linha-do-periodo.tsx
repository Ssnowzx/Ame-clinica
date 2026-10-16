import { useQueries } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import type { BaseDoPainel, FrenteDoPainel } from '@/tipos'

import { LinhaDoPeriodoPendente } from '@/componentes/indicadores/moldura-dos-indicadores'
import { usePeriodoDosIndicadores } from '@/componentes/indicadores/periodo-dos-indicadores'
import { fraseDoPeriodo, mesAntesDoHistorico, motivoDeSemDados } from '@/lib/indicadores/frases'
import { opcoesRotuladasDaFrente } from '@/lib/indicadores/paineis'
import { rotuloDoMes } from '@/lib/meses'

/**
 * A LINHA DO PERÍODO no topo de cada aba: o que foi medido e contra o quê — "De 1º a 6 de outubro de
 * 2026, até hoje, comparado com 1º a 6 de setembro de 2026." — ou por que não há comparação. Sem ela,
 * a seta dos cartões não diria contra o quê compara.
 *
 * Ficou no lugar dos RESUMOS em frase (change inicio-dos-indicadores, D8): o usuário os tirou em
 * 06/10 — a manchete montada por regra errou na produção ("3.337% a mais" contra a semana da
 * implantação), e a narração fica para a IA, numa change futura. Esta linha não interpreta nada.
 *
 * No mês ANTERIOR ao início dos indicadores, diz isso uma vez, NA MESMA linha, com a `acao` de quem a
 * passa (a Visão geral leva ao primeiro mês que existe). Na mesma linha, e não num bloco abaixo: o
 * esqueleto reserva a altura de uma linha, e o bloco empurrava os cartões 85–90 px quando o painel
 * chegava (gate r2, design-qa — CLS).
 */
export function LinhaDoPeriodo({ base, acao }: { base: BaseDoPainel; acao?: ReactNode }) {
  const antes = mesAntesDoHistorico(base)

  return (
    <p className="text-pretty text-meta text-texto-suave">
      {fraseDoPeriodo(base)}
      {antes ? (
        <>
          {' '}
          <span className="font-medium text-texto">{motivoDeSemDados(base)}</span>
        </>
      ) : null}
      {antes && acao !== undefined ? <> {acao}</> : null}
    </p>
  )
}

// o link dentro do texto é SEMPRE sublinhado: a cor sozinha não o distingue (WCAG 1.4.1, A11Y-AVI-01)
const CLASSES_DO_LINK =
  'font-medium text-acento underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco'

/**
 * A saída do mês ANTERIOR ao histórico: o primeiro mês que existe, pelo período da ÁREA (a URL) — como
 * nas abas de detalhe (`SemHistoricoNaAba`). Sem ela, a Visão geral de julho era um beco: quatro "sem
 * dados" e nenhum caminho (DQ-14).
 */
function IrAoInicioDoHistorico({ inicio }: { inicio: string }) {
  const { trocarMes } = usePeriodoDosIndicadores()

  return (
    <button type="button" className={CLASSES_DO_LINK} onClick={() => trocarMes(inicio)}>
      Ver {rotuloDoMes(inicio)}
    </button>
  )
}

/**
 * A linha do período da VISÃO GERAL, que não tem um painel só: a base vem do primeiro painel permitido
 * que chegou — o período e o início são os mesmos em todos. As consultas são as MESMAS dos cartões
 * (chave por frente e mês): a linha não custa requisição. Nenhum painel chegou → nada aqui; cada
 * cartão mostra o próprio erro.
 */
export function PeriodoDaVisaoGeral({ mes, frentes }: { mes: string; frentes: readonly FrenteDoPainel[] }) {
  const consultas = useQueries({ queries: frentes.map((frente) => opcoesRotuladasDaFrente(frente, mes)) })

  if (consultas.some((consulta) => consulta.isPending)) {
    return <LinhaDoPeriodoPendente />
  }
  const base = consultas.find((consulta) => consulta.isSuccess)?.data?.painel
  if (base === undefined) {
    return null
  }

  return (
    <LinhaDoPeriodo
      base={base}
      acao={base.inicio_historico === null ? undefined : <IrAoInicioDoHistorico inicio={base.inicio_historico} />}
    />
  )
}
