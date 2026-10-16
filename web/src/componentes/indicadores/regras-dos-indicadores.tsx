import { useQueries } from '@tanstack/react-query'
import { CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import type { CaminhoDoCadastro } from '@/lib/caminhos-dos-cadastros'
import type { BaseDoPainel, FrenteDoPainel, PainelDaAgenda } from '@/tipos'

import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { cn } from '@/lib/cn'
import { diaEmPalavras, mesAntesDoHistorico } from '@/lib/indicadores/frases'
import { opcoesRotuladasDaFrente } from '@/lib/indicadores/paineis'
import { formatarContagem } from '@/lib/numeros'

type Estado = 'em-ordem' | 'quebrada' | 'informa'

const ESTADOS: Record<Estado, { Icone: typeof CircleCheck; tom: string }> = {
  'em-ordem': { Icone: CircleCheck, tom: 'text-sucesso-texto' },
  quebrada: { Icone: TriangleAlert, tom: 'text-alerta-texto' },
  informa: { Icone: Info, tom: 'text-texto-suave' },
}

/**
 * "PARA OS NÚMEROS FICAREM CERTOS" (change inicio-dos-indicadores, D6): as regras que fazem os
 * indicadores dizerem a verdade, uma frase cada, no fim da Visão geral.
 *
 * Nasceu da conferência da produção em 06/10: a ocupação de 16% era de 9 dos 20 profissionais (os
 * outros não tinham horário), 38% das sessões que já passaram estavam sem baixa e o resumo comparava
 * contra a semana da implantação. Os números estavam certos sobre o que estava REGISTRADO — o que
 * faltava era dizer à clínica o que registrar.
 *
 * Cada linha só aparece para quem vê a frente dela, e só depois que o painel dela chegou: os números
 * saem do cache dos cartões (as mesmas consultas, rotuladas pela frente), sem requisição própria. A
 * regra quebrada diz o número no texto — o ícone é enfeite, nunca o único sinal — e o caminho para
 * resolver só vai a quem tem a permissão da tela de destino; os outros leem a quem pedir.
 *
 * No mês ANTERIOR ao início dos indicadores, só a linha do início: os cartões dizem "sem dados", e
 * "Só 8 de 10 profissionais…" sobre esse mês desmentiria a tela (gate r1, design-qa).
 */
export function RegrasDosIndicadores({ mes, frentes }: { mes: string; frentes: readonly FrenteDoPainel[] }) {
  const chegaram = useQueries({ queries: frentes.map((frente) => opcoesRotuladasDaFrente(frente, mes)) }).flatMap(
    (consulta) => (consulta.isSuccess ? [consulta.data] : []),
  )
  // a base (o início dos indicadores) vem de QUALQUER painel que chegou: é a mesma em todos
  const base: BaseDoPainel | undefined = chegaram[0]?.painel
  if (base === undefined) {
    return null
  }

  const linhas: Array<{ chave: string; estado: Estado; texto: ReactNode }> = []
  const agenda = chegaram.find((rotulado) => rotulado.frente === 'agenda')
  const veDinheiro = chegaram.some((rotulado) => rotulado.frente === 'dinheiro')
  if (!mesAntesDoHistorico(base)) {
    if (agenda?.frente === 'agenda') {
      linhas.push(linhaDoHorario(agenda.painel), linhaDaBaixa(agenda.painel))
    }
    if (veDinheiro) {
      linhas.push({ chave: 'caixa', estado: 'informa', texto: 'O dinheiro é só o que foi lançado no caixa: lance todo recebimento.' })
    }
  }
  linhas.push(linhaDoInicio(base))

  return (
    <section
      aria-labelledby="regras-dos-indicadores"
      className="flex min-w-0 flex-col gap-3 rounded-superficie border border-linha bg-superficie p-5 shadow-e1 print:break-inside-avoid print:shadow-none"
    >
      <h2 id="regras-dos-indicadores" className="text-pretty text-corpo font-semibold text-texto">
        Para os números ficarem certos
      </h2>
      <ul className="flex flex-col gap-2">
        {linhas.map(({ chave, estado, texto }) => {
          const { Icone, tom } = ESTADOS[estado]

          return (
            <li key={chave} className="flex items-start gap-2 text-pretty text-meta text-texto-suave">
              <Icone aria-hidden="true" className={cn('mt-px size-4 shrink-0', tom)} />
              <span className="min-w-0">{texto}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** O número da regra quebrada, em destaque no texto — no tom de aviso, como o ícone da linha. */
function Destaque({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-alerta-texto tabular-nums">{children}</strong>
}

/** A frase e, quando a regra está quebrada, o caminho (ou a quem pedir). */
function ComCaminho({ para, children }: { para: CaminhoDoCadastro; children: ReactNode }) {
  return (
    <>
      {children}{' '}
      <span data-nao-imprimir>
        <AvisoDePreRequisito para={para} oQueFalta="" />
      </span>
    </>
  )
}

function linhaDoHorario(painel: PainelDaAgenda) {
  const { profissionais, profissionais_com_grade: comGrade } = painel.ocupacao

  if (profissionais === 0) {
    return { chave: 'horario', estado: 'informa' as const, texto: 'Sem horário de atendimento cadastrado, o profissional fica fora da ocupação.' }
  }
  if (comGrade >= profissionais) {
    return { chave: 'horario', estado: 'em-ordem' as const, texto: 'Todo profissional com sessão tem horário de atendimento: a ocupação conta todos.' }
  }

  return {
    chave: 'horario',
    estado: 'quebrada' as const,
    texto: (
      <ComCaminho para={CAMINHOS.horarioDoProfissional}>
        Só <Destaque>{`${formatarContagem(comGrade)} de ${formatarContagem(profissionais)}`}</Destaque> profissionais com
        sessão têm horário de atendimento; os outros ficam fora da ocupação.
      </ComCaminho>
    ),
  }
}

function linhaDaBaixa(painel: PainelDaAgenda) {
  const semBaixa = painel.sem_baixa

  if (semBaixa === 0) {
    return { chave: 'baixa', estado: 'em-ordem' as const, texto: 'Toda sessão que já passou tem baixa: as realizadas estão contadas.' }
  }

  return {
    chave: 'baixa',
    estado: 'quebrada' as const,
    texto: (
      <ComCaminho para={CAMINHOS.baixaNaAgenda}>
        <Destaque>{formatarContagem(semBaixa)}</Destaque>{' '}
        {semBaixa === 1
          ? 'sessão que já passou está sem baixa e não conta como realizada.'
          : 'sessões que já passaram estão sem baixa e não contam como realizadas.'}
      </ComCaminho>
    ),
  }
}

function linhaDoInicio(base: BaseDoPainel) {
  if (base.inicio_historico_dia === null) {
    return { chave: 'inicio', estado: 'informa' as const, texto: 'Os indicadores começam no primeiro agendamento da clínica.' }
  }

  return {
    chave: 'inicio',
    estado: 'informa' as const,
    texto: (
      <ComCaminho para={CAMINHOS.inicioDosIndicadores}>
        Os indicadores contam e comparam a partir de {diaEmPalavras(base.inicio_historico_dia)}.
      </ComCaminho>
    ),
  }
}
