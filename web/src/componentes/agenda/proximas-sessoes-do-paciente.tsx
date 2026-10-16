import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { ChipStatus } from '@/componentes/ui/chip-status'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { MarcadorEspecialidade } from '@/componentes/ui/marcador-especialidade'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { dataComHorarioLegivel } from '@/lib/datas'
import { buscarAgendamentosDoPaciente } from '@/servicos/agenda'
import { useAuthStore } from '@/stores/auth-store'

/** Quantas próximas sessões o painel mostra — o resto mora na ficha, a um clique. */
const QUANTAS_NO_PAINEL = 4

interface ProximasSessoesDoPacienteProps {
  pacienteId: number
  /** O agendamento aberto no painel: ele não se repete na lista das "próximas". */
  agendamentoId: number
  /** O início dele (`Y-m-d H:i`): decide se ele está entre os próximos mesmo além do corte do servidor. */
  inicioDoAberto: string
}

/**
 * "Próximas sessões" no painel do agendamento (change horario-de-termino-no-card, pedido da
 * clínica): o card diz só o horário DAQUELE dia; ao abrir, a recepção vê as próximas sessões da
 * criança, cada uma com data e "das 08:40 às 09:20" — o tratamento de 20 sessões não tem um
 * horário só.
 *
 * Nasce ABERTO, ao contrário do acordeão dos 90 dias: é a resposta que a clínica pediu ao abrir o
 * card. Reusa a leitura da ficha (`/pacientes/{id}/agendamentos`, mesma chave de cache, mesma
 * minimização no servidor) — nada de endpoint novo, e a ficha aberta depois já chega pronta.
 */
export function ProximasSessoesDoPaciente({ pacienteId, agendamentoId, inicioDoAberto }: ProximasSessoesDoPacienteProps) {
  const [expandido, setExpandido] = useState(true)
  const idRegiao = useId()
  const podeAbrirAFicha = useAuthStore((estado) => estado.temPermissao('pacientes.ver'))

  const agendamentos = useQuery({
    queryKey: chaves.agendamentosDoPaciente(pacienteId),
    queryFn: () => buscarAgendamentosDoPaciente(pacienteId),
    enabled: expandido,
  })

  const itens = agendamentos.data?.proximos.itens ?? []
  const total = agendamentos.data?.proximos.total ?? 0
  const outras = itens.filter((item) => item.id !== agendamentoId)
  const visiveis = outras.slice(0, QUANTAS_NO_PAINEL)
  // o total é o do SERVIDOR, e o bloco vem cortado no teto: o aberto pode estar entre os próximos
  // SEM estar nos itens (a 55ª de 60). Ele conta se veio nos itens, ou se o bloco foi cortado e ele
  // começa depois do último item que veio (code-reviewer r1: "Mais 56" no lugar de "Mais 55").
  // Card passado (a baixa de ontem) não está entre os próximos e não desconta nada.
  const ultimo = itens.at(-1)
  const abertoEntreOsProximos =
    itens.some((item) => item.id === agendamentoId) ||
    (total > itens.length && ultimo !== undefined && inicioDoAberto >= ultimo.inicio)
  const totalDeOutras = Math.max(0, total - (abertoEntreOsProximos ? 1 : 0))

  return (
    <section className="mt-4 rounded-campo border border-linha">
      <button
        type="button"
        aria-expanded={expandido}
        aria-controls={expandido ? idRegiao : undefined}
        onClick={() => {
          setExpandido((valor) => !valor)
        }}
        className="flex w-full items-center justify-between gap-2 rounded-campo px-3 py-2.5 text-rotulo font-medium text-texto outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        <span>Próximas sessões</span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 shrink-0 text-texto-suave transition-transform duration-(--duracao-1)', expandido && 'rotate-180')}
        />
      </button>

      {expandido ? (
        <div id={idRegiao} aria-busy={agendamentos.isPending} className="border-t border-linha p-3">
          {agendamentos.isPending ? (
            <>
              <span className="sr-only">Carregando as próximas sessões…</span>
              <ul className="flex flex-col gap-2">
                {[0, 1].map((indice) => (
                  <li key={indice} className="rounded-superficie border border-linha p-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="mt-2 h-3 w-48" />
                  </li>
                ))}
              </ul>
            </>
          ) : agendamentos.isError ? (
            <EstadoErro
              mensagem="Não foi possível carregar as próximas sessões deste paciente."
              aoTentarNovamente={() => void agendamentos.refetch()}
            />
          ) : visiveis.length === 0 ? (
            <EstadoVazio
              titulo="Nenhuma outra sessão marcada"
              descricao="Fora desta, o paciente não tem sessão na agenda daqui para a frente."
            />
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {visiveis.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-superficie border border-linha p-3"
                  >
                    <div className="flex min-w-0 items-stretch gap-2">
                      {item.especialidade !== null ? <MarcadorEspecialidade cor={item.especialidade.cor} /> : null}
                      <div className="min-w-0">
                        <p className="text-rotulo tabular-nums text-texto">{dataComHorarioLegivel(item.inicio, item.fim)}</p>
                        <p className="mt-0.5 truncate text-meta text-texto-suave">
                          {[item.especialidade?.nome, item.profissional?.nome].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                    </div>
                    {item.status !== null ? (
                      <ChipStatus
                        nome={item.status.nome}
                        cor={item.status.cor}
                        corBorda={item.status.cor_borda}
                        tipo={item.status.tipo}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
              {totalDeOutras > visiveis.length ? (
                <p className="mt-2 text-meta text-texto-suave">
                  Mais {totalDeOutras - visiveis.length}{' '}
                  {totalDeOutras - visiveis.length === 1 ? 'sessão marcada' : 'sessões marcadas'}.{' '}
                  {podeAbrirAFicha ? (
                    <Link
                      to={`/pacientes/${pacienteId}/agendamentos`}
                      className="rounded-controle font-medium text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                    >
                      Ver todas na ficha
                    </Link>
                  ) : null}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}
