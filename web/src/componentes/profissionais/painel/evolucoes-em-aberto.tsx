import { useQuery } from '@tanstack/react-query'

import { CartaoDaFicha, PortaDoBloco } from '@/componentes/profissionais/painel/secao-do-painel'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { formatarContagem } from '@/lib/numeros'
import { listarEvolucoesEmAberto } from '@/servicos/atendimentos'

/**
 * EVOLUÇÕES EM ABERTO (mantido da change ficha-do-profissional): a fila de sessões sem registro clínico.
 * Leitura ESCOPADA pelo eixo clínico — o número só na PRÓPRIA ficha; na de colega, a porta para a fila,
 * sem buscar nada (um "0" do recorte mentiria).
 */
export function EvolucoesEmAberto({ profissionalId, ehProprio }: { profissionalId: number; ehProprio: boolean }) {
  return (
    <CartaoDaFicha id="ficha-prof-evolucoes" titulo="Evoluções em aberto">
      {ehProprio ? (
        <ContagemDoProprio profissionalId={profissionalId} />
      ) : (
        <p className="text-corpo text-texto-suave">As pendências deste profissional se veem na fila, com o recorte do seu papel.</p>
      )}
      <PortaDoBloco para={`/evolucoes?profissional_id=${profissionalId}`}>Fila de evoluções</PortaDoBloco>
    </CartaoDaFicha>
  )
}

function ContagemDoProprio({ profissionalId }: { profissionalId: number }) {
  const evolucoes = useQuery({
    queryKey: chaves.evolucoesEmAberto({ pagina: 1, profissionalId }),
    queryFn: () => listarEvolucoesEmAberto({ pagina: 1, profissionalId }),
  })

  if (evolucoes.isPending) {
    return <Skeleton className="h-10 w-full" />
  }
  if (evolucoes.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível carregar as suas evoluções em aberto."
        aoTentarNovamente={() => void evolucoes.refetch()}
      />
    )
  }

  return (
    <p className="text-corpo text-texto">
      <span className="text-titulo font-semibold tabular-nums">{formatarContagem(evolucoes.data.total)}</span>{' '}
      <span className="text-texto-suave">
        {evolucoes.data.total === 1 ? 'sessão sem registro clínico' : 'sessões sem registro clínico'}
      </span>
    </p>
  )
}
