import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Botao } from '@/componentes/ui/botao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { buscarAuditoriaDoAgendamento } from '@/servicos/auditoria'

interface HistoricoDeMovimentacaoProps {
  agendamentoId: number
  aoVoltar: () => void
}

const ROTULO_ACAO: Record<string, string> = {
  criou: 'Criado',
  atualizou: 'Alterado',
  excluiu: 'Excluído',
  // a recepção resolveu o pedido da família mantendo a sessão (change lembrete-com-botoes-de-resposta)
  manteve_sessao: 'Sessão mantida (a família desistiu)',
  // a família confirmou por telefone ou mensagem, e a clínica registrou (change confirmacao-pela-clinica)
  confirmou_pela_clinica: 'Confirmada pela clínica (a família confirmou por outro canal)',
}

function rotuloAcao(acao: string): string {
  return ROTULO_ACAO[acao] ?? acao
}

function valorLegivel(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') {
    return '—'
  }
  return String(valor)
}

/**
 * A trilha de auditoria de UM agendamento (change detalhe-do-agendamento) — os
 * quatro estados, mais recente no topo. O diff já chega MASCARADO e com rótulo
 * humano do servidor (art. 11): a tela nunca mostra a chave crua nem valor clínico.
 *
 * A saída ("Voltar ao agendamento") é PERSISTENTE (em todos os estados, nunca um
 * beco) e recebe o foco ao entrar na sub-view (2.4.3).
 */
export function HistoricoDeMovimentacao({ agendamentoId, aoVoltar }: HistoricoDeMovimentacaoProps) {
  const refVoltar = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    refVoltar.current?.focus()
  }, [])

  const trilha = useQuery({
    queryKey: chaves.auditoriaDoAgendamento(agendamentoId),
    queryFn: () => buscarAuditoriaDoAgendamento(agendamentoId),
  })

  return (
    <div>
      <div className="mb-4">
        <Botao ref={refVoltar} variante="secundario" onClick={aoVoltar}>
          <ArrowLeft aria-hidden className="size-4" />
          Voltar ao agendamento
        </Botao>
      </div>

      {/* `aria-busy` fala "carregando" ao leitor de tela (4.1.3): o `Skeleton` é
          aria-hidden, então sem isto o estado de carga não é anunciado. */}
      <div aria-busy={trilha.isPending}>
        {trilha.isPending ? (
          // esqueleto na CAIXA EXATA da lista: as mesmas linhas emolduradas, sem salto
          <ol className="flex flex-col gap-3">
            {[0, 1, 2].map((indice) => (
              <li key={indice} className="rounded-superficie border border-linha p-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-full" />
              </li>
            ))}
          </ol>
        ) : trilha.isError ? (
          <EstadoErro
            mensagem="Não foi possível carregar o histórico deste agendamento."
            aoTentarNovamente={() => void trilha.refetch()}
          />
        ) : trilha.data.length === 0 ? (
          <EstadoVazio
            titulo="Nenhuma movimentação"
            descricao="Este agendamento ainda não teve alterações registradas."
          />
        ) : (
          <ol className="flex flex-col gap-3">
            {trilha.data.map((linha) => (
              <li key={linha.id} className="rounded-superficie border border-linha p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-rotulo font-medium text-texto">{rotuloAcao(linha.acao)}</span>
                  <span className="text-meta text-texto-suave">
                    {linha.autor} · {dataHoraLegivel(linha.criado_em)}
                  </span>
                </div>
                {/* "Criado" é auto-explicativo (tudo foi de nada a algo) — só a linha, sem o
                    dump. O valor está nas MUDANÇAS; os demais eventos mostram suas alterações. */}
                {linha.acao !== 'criou' && linha.alteracoes.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {linha.alteracoes.map((alteracao) => (
                      <li key={alteracao.campo} className="text-meta text-texto-suave">
                        <span className="text-texto">{alteracao.campo}:</span>{' '}
                        {/* a relação antes/depois não pode depender só do "→" (1.3.1) */}
                        <span className="sr-only">de </span>
                        {valorLegivel(alteracao.de)} <span aria-hidden>→</span>
                        <span className="sr-only"> para </span> {valorLegivel(alteracao.para)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
