import { CalendarX, CircleAlert } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { TratamentoDaLista } from '@/tipos'

const ROTULO_DA_SITUACAO: Record<TratamentoDaLista['status'], string> = {
  andamento: 'Em andamento',
  parado: 'Parado',
  finalizado: 'Finalizado',
}

export interface SituacaoDoTratamentoProps {
  tratamento: TratamentoDaLista
  className?: string
}

/**
 * O saldo e o vencimento do pacote — **como o servidor mandou**.
 *
 * `sessoes_saldo` e `vencido` chegam CALCULADOS (o vencimento no fuso da clínica,
 * §13). Esta tela os exibe e não refaz a conta: o saldo é o mesmo número que a
 * agenda usa para recusar um agendamento sem sessões, e duas contas para o mesmo
 * número garantem que uma delas estará errada na hora errada.
 *
 * O alerta nunca é só cor (§2): ícone e texto sempre acompanham.
 */
export function SituacaoDoTratamento({ tratamento, className }: SituacaoDoTratamentoProps) {
  /*
   * O veredito vem do SERVIDOR, do mesmo `RealceDoPacote` que governa o card da agenda e o
   * contador. Esta tela refazia a conta com uma constante do front, e o comentário daquela
   * constante já dizia o que ia acontecer: "no dia em que divergirem, a aba Acabando e o selo
   * contariam histórias diferentes sobre a mesma criança".
   *
   * `vencido` continua sendo checado aqui porque é OUTRO fato (passou da validade), e ele tem
   * selo próprio logo abaixo — dois selos vermelhos na mesma linha seriam ruído.
   */
  const acabando = !tratamento.vencido && tratamento.realce === 'acabando'

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <span className="text-corpo font-medium tabular-nums text-texto">
        {tratamento.sessoes_realizadas}/{tratamento.sessoes_total} sessões
      </span>

      <span className="text-meta text-texto-suave">
        {ROTULO_DA_SITUACAO[tratamento.status]}
      </span>

      {tratamento.vencido ? (
        <span className="flex items-center gap-1 text-meta font-medium text-perigo-texto">
          <CalendarX aria-hidden="true" className="size-3.5" />
          Vencido
        </span>
      ) : null}

      {acabando ? (
        <span className="flex items-center gap-1 text-meta font-medium text-alerta-texto">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {tratamento.sessoes_saldo === 1
            ? 'Última sessão'
            : `Faltam ${tratamento.sessoes_saldo} sessões`}
        </span>
      ) : null}

      {tratamento.realce === 'sem-saldo' ? (
        <span className="flex items-center gap-1 text-meta font-medium text-perigo-texto">
          <CircleAlert aria-hidden="true" className="size-3.5" />
          Sem saldo
        </span>
      ) : null}
    </div>
  )
}
