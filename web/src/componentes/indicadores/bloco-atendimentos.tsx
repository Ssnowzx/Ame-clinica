import { useQuery } from '@tanstack/react-query'

import type { IndicadoresDeAtendimentos } from '@/tipos'

import { QuadroVazio } from '@/componentes/indicadores/estados-da-aba'
import { NumeroDestaque, Quebra } from '@/componentes/indicadores/graficos'
import { QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { chaves } from '@/lib/chaves-query'
import { formatarContagem } from '@/lib/numeros'
import { buscarIndicadoresDeAtendimentos } from '@/servicos/indicadores'

/** O título-conclusão: a especialidade que mais atendeu no mês. */
function tituloDosAtendimentos(vista: IndicadoresDeAtendimentos): string {
  const maior = vista.por_especialidade.reduce<IndicadoresDeAtendimentos['por_especialidade'][number] | null>(
    (atual, linha) => (atual === null || linha.total > atual.total ? linha : atual),
    null,
  )
  if (vista.total === 0 || maior === null) {
    return 'Nenhum atendimento finalizado no mês'
  }

  return `${maior.especialidade.nome ?? 'Sem especialidade'} é a especialidade com mais atendimentos`
}

/**
 * Atendimentos FINALIZADOS no mês, por especialidade e por convênio — na aba Equipe (change
 * indicadores-profissionais). O total e cada linha das quebras são PORTAS para a lista daqueles
 * atendimentos (`/indicadores/itens`, só ids e o mês na URL — nunca nome). Monta só com
 * `atendimentos.ver`, o módulo dono da vista.
 */
export function BlocoAtendimentos({ mes }: { mes: string }) {
  const vista = useQuery({
    queryKey: chaves.indicadores('atendimentos', mes),
    queryFn: () => buscarIndicadoresDeAtendimentos(mes),
  })

  return (
    <QuadroDoGrafico
      id="atendimentos-por-especialidade"
      titulo={vista.isSuccess ? tituloDosAtendimentos(vista.data) : 'Atendimentos finalizados no mês'}
      subtitulo="Atendimentos finalizados no mês inteiro, por especialidade e por convênio"
    >
      {vista.isPending ? (
        <div aria-busy="true">
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {vista.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar os números dos atendimentos."
          aoTentarNovamente={() => void vista.refetch()}
        />
      ) : null}

      {vista.isSuccess && vista.data.total === 0 ? (
        <QuadroVazio>Nenhum atendimento finalizado no mês. Atendimento conta aqui quando é finalizado.</QuadroVazio>
      ) : null}

      {vista.isSuccess && vista.data.total > 0 ? <QuebrasDosAtendimentos vista={vista.data} mes={mes} /> : null}
    </QuadroDoGrafico>
  )
}

/** O total (porta para o mês inteiro) e as duas quebras, cada linha porta para a sua dimensão. */
function QuebrasDosAtendimentos({ vista, mes }: { vista: IndicadoresDeAtendimentos; mes: string }) {
  return (
    <div className="flex flex-col gap-5">
      {/* o TOTAL também é porta: o mês inteiro, sem dimensão */}
      <NumeroDestaque
        rotulo="atendimentos finalizados no mês"
        valor={formatarContagem(vista.total)}
        para={`/indicadores/itens?origem=atendimentos&mes=${mes}`}
      />

      <div className="grid gap-x-10 gap-y-5 @min-[40rem]:grid-cols-2">
        <Quebra
          destacarMaior
          titulo="Por especialidade"
          linhas={vista.por_especialidade.map((linha) => ({
            chave: `especialidade-${String(linha.especialidade.id)}`,
            rotulo: linha.especialidade.nome ?? '—',
            total: linha.total,
            para: `/indicadores/itens?origem=atendimentos&especialidade_id=${String(linha.especialidade.id)}&mes=${mes}`,
          }))}
        />

        <Quebra
          destacarMaior
          titulo="Por convênio"
          linhas={vista.por_convenio.map((linha) => ({
            chave: linha.convenio === null ? 'sem-convenio' : `convenio-${String(linha.convenio.id)}`,
            // `convenio: null` é linha PRÓPRIA do contrato — aqui ela ganha nome, e fica SEM porta (não
            // há id para filtrar; o drill é por dimensão)
            rotulo: linha.convenio === null ? 'Sem convênio' : (linha.convenio.nome ?? '—'),
            total: linha.total,
            para:
              linha.convenio === null
                ? undefined
                : `/indicadores/itens?origem=atendimentos&convenio_id=${String(linha.convenio.id)}&mes=${mes}`,
          }))}
        />
      </div>
    </div>
  )
}
