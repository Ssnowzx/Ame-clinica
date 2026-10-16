import { useQuery } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'

import { Botao } from '@/componentes/ui/botao'
import { Dialog } from '@/componentes/ui/dialog'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { ListaDescricao } from '@/componentes/ui/lista-descricao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { ErroDeApi } from '@/lib/http'
import { buscarEvolucao } from '@/servicos/atendimentos'

interface LeitorDeEvolucaoProps {
  /** O id vem da linha da lista (`evolucao_id` numérico — o botão Abrir só existe com ele). */
  evolucaoId: number
  /** Metadados do atendimento-mãe (título/descrição) — nunca conteúdo clínico. */
  finalizadoEm: string
  aberto: boolean
  aoFechar: () => void
}

/**
 * Leitura de UMA evolução — sob demanda e AUDITADA (art. 11), LEITURA PURA
 * (SEC-PF-10: nenhum caminho de mutação aqui; a escrita vive no fluxo do
 * atendimento da agenda).
 *
 * O detalhe (`GET /evolucoes/{id}`) é buscado SÓ quando o diálogo abre, por um
 * ÚNICO observer da chave `chaves.evolucao(id)` com `gcTime:0` + `staleTime:0` +
 * `retry:false` + `refetchOnReconnect:false` (SEC-PF-06/07): a trilha `consultou`
 * reflete leitura HUMANA e não se re-dispara sozinha; reabrir É re-auditar.
 * `refetchOnWindowFocus` herda o `false` global do query-client.
 *
 * O 403 é TERMINAL (SEC-PF-08): a evolução tem donos (autor, responsável técnico,
 * atendente) — "tentar novamente" seria martelo em porta alheia. Erro de rede
 * mantém o retry manual (re-ler por clique é re-auditar legítimo).
 */
export function LeitorDeEvolucao({ evolucaoId, finalizadoEm, aberto, aoFechar }: LeitorDeEvolucaoProps) {
  const detalhe = useQuery({
    queryKey: chaves.evolucao(evolucaoId),
    queryFn: () => buscarEvolucao(evolucaoId),
    enabled: aberto,
    // higiene de cache E integridade da auditoria: sem isto, reabrir renderizaria o
    // conteúdo sem novo `show` — releitura de dado de menor NÃO auditada (SEC-PF-07)
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnReconnect: false,
  })

  const semAcesso = detalhe.error instanceof ErroDeApi && detalhe.error.motivo === 'sem_acesso'

  const rodape = (
    <div className="flex justify-end">
      <Botao variante="fantasma" onClick={aoFechar}>
        Fechar
      </Botao>
    </div>
  )

  return (
    <Dialog
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (!proximo) {
          aoFechar()
        }
      }}
      titulo="Evolução clínica"
      descricao={`Sessão de ${dataHoraLegivel(finalizadoEm)}`}
      rodape={rodape}
    >
      {detalhe.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : semAcesso ? (
        // TERMINAL de propósito (SEC-PF-08): sem botão de retry — o dono é quem abre
        <div
          role="alert"
          className="flex items-start gap-2 rounded-superficie border border-linha-forte border-l-[3px] border-l-perigo-texto bg-superficie p-6"
        >
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-perigo-texto" />
          <div className="flex flex-col gap-1">
            <p className="text-corpo font-medium text-texto">Você não tem acesso a esta evolução</p>
            <p className="text-corpo text-texto-suave">
              A leitura é restrita a quem assina: o autor, o responsável técnico ou quem atendeu
              a sessão.
            </p>
          </div>
        </div>
      ) : detalhe.isError ? (
        <EstadoErro
          mensagem="Não foi possível abrir esta evolução."
          aoTentarNovamente={() => void detalhe.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* conteúdo clínico ESCAPADO (JSX children) — nunca em título, toast ou URL */}
          <p className="whitespace-pre-wrap break-words text-corpo text-texto">
            {detalhe.data.conteudo}
          </p>
          <ListaDescricao
            itens={[
              {
                chave: 'preenchida_em',
                rotulo: 'Preenchida em',
                valor: dataHoraLegivel(detalhe.data.preenchida_em),
              },
            ]}
          />
        </div>
      )}
    </Dialog>
  )
}
