import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'

import { ChipStatus } from '@/componentes/ui/chip-status'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { MarcadorEspecialidade } from '@/componentes/ui/marcador-especialidade'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { dataLegivel } from '@/lib/datas'
import { buscarComparecimentoRecente } from '@/servicos/agenda'

interface HistoricoComparecimentoProps {
  pacienteId: number
}

/**
 * Acordeão "Atendimentos dos últimos 90 dias" (change painel-enriquecido).
 *
 * Carrega SOB DEMANDA — a query só é habilitada quando o acordeão expande (§16: o
 * painel é sob demanda; a grade cheia não pode pagar por este histórico ao abrir).
 * Os quatro estados (carregando/vazio/erro/sucesso) vivem dentro da região.
 *
 * O payload já chega MINIMIZADO do servidor (data · serviço · profissional ·
 * status): nada de conteúdo clínico atravessa esta lista.
 */
export function HistoricoComparecimento({ pacienteId }: HistoricoComparecimentoProps) {
  const [expandido, setExpandido] = useState(false)
  const idRegiao = useId()

  const comparecimento = useQuery({
    queryKey: chaves.comparecimentoRecente(pacienteId),
    queryFn: () => buscarComparecimentoRecente(pacienteId),
    // a chave do sob-demanda: nada é buscado enquanto o acordeão está fechado
    enabled: expandido,
  })

  return (
    <section className="mt-4 rounded-campo border border-linha">
      <button
        type="button"
        aria-expanded={expandido}
        // a região só existe no DOM quando expandido — apontar para um id inexistente
        // enquanto fechado é IDREF pendurada (4.1.2); só referenciar quando montada
        aria-controls={expandido ? idRegiao : undefined}
        onClick={() => {
          setExpandido((valor) => !valor)
        }}
        className="flex w-full items-center justify-between gap-2 rounded-campo px-3 py-2.5 text-rotulo font-medium text-texto outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        <span>Atendimentos dos últimos 90 dias</span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 shrink-0 text-texto-suave transition-transform duration-(--duracao-1)', expandido && 'rotate-180')}
        />
      </button>

      {expandido ? (
        // `aria-busy` anuncia o carregamento ao leitor de tela (4.1.3) — o Skeleton é aria-hidden
        <div id={idRegiao} aria-busy={comparecimento.isPending} className="border-t border-linha p-3">
          {comparecimento.isPending ? (
            <>
              {/* o Skeleton é aria-hidden; sem este texto o leitor de tela encontra a região vazia */}
              <span className="sr-only">Carregando atendimentos dos últimos 90 dias…</span>
              <ul className="flex flex-col gap-2">
                {[0, 1, 2].map((indice) => (
                  <li key={indice} className="rounded-superficie border border-linha p-3">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="mt-2 h-3 w-48" />
                  </li>
                ))}
              </ul>
            </>
          ) : comparecimento.isError ? (
            <EstadoErro
              mensagem="Não foi possível carregar os atendimentos recentes deste paciente."
              aoTentarNovamente={() => void comparecimento.refetch()}
            />
          ) : comparecimento.data.itens.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum atendimento recente"
              descricao="Este paciente não teve atendimentos nos últimos 90 dias."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {comparecimento.data.itens.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-superficie border border-linha p-3"
                >
                  <div className="flex min-w-0 items-stretch gap-2">
                    {item.especialidade !== null ? <MarcadorEspecialidade cor={item.especialidade.cor} /> : null}
                    <div className="min-w-0">
                      <p className="text-rotulo text-texto">{dataLegivel(item.data)}</p>
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
          )}
        </div>
      ) : null}
    </section>
  )
}
