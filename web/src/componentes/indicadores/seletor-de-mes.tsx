import { ChevronLeft, ChevronRight } from 'lucide-react'

import { PRIMEIRO_MES_DOS_INDICADORES } from '@/componentes/indicadores/periodo-dos-indicadores'
import { Botao } from '@/componentes/ui/botao'
import { rotuloDoMes, somarMeses } from '@/lib/meses'

/**
 * O SELETOR DE MÊS dos painéis — o da área de Indicadores e o da ficha do profissional são um só (o
 * mesmo alcance, os mesmos limites): anterior, o mês por extenso e próximo.
 *
 * No mês corrente da clínica não há "próximo": o mês futuro não tem números (o servidor responde 422),
 * e o botão fica desligado em vez de convidar a uma tela de erro. Abaixo de 2000-01, o mesmo, pelo piso
 * do servidor.
 */
export function SeletorDeMes({
  mes,
  mesCorrente,
  trocarMes,
  rotulo,
}: {
  mes: string
  mesCorrente: string
  trocarMes: (proximo: string) => void
  /** O nome do grupo para o leitor de tela: de QUE período se trata */
  rotulo: string
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex items-center gap-2">
      <Botao
        variante="secundario"
        tamanho="sm"
        aria-label="Mês anterior"
        disabled={mes <= PRIMEIRO_MES_DOS_INDICADORES}
        onClick={() => trocarMes(somarMeses(mes, -1))}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Botao>
      <span aria-live="polite" className="min-w-36 text-center text-corpo font-medium text-texto">
        {rotuloDoMes(mes)}
      </span>
      <Botao
        variante="secundario"
        tamanho="sm"
        aria-label="Próximo mês"
        disabled={mes >= mesCorrente}
        onClick={() => trocarMes(somarMeses(mes, 1))}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </Botao>
    </div>
  )
}
