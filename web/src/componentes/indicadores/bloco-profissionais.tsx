import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { QuadroVazio } from '@/componentes/indicadores/estados-da-aba'
import { QuadroDoGrafico } from '@/componentes/indicadores/graficos-do-painel'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { RoladorHorizontal } from '@/componentes/ui/rolador-horizontal'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { rotuloDoMes } from '@/lib/meses'
import { formatarContagem } from '@/lib/numeros'
import { buscarProducaoDoMes } from '@/servicos/indicadores'
import type { ProducaoDoMes } from '@/tipos'

/**
 * A PRODUÇÃO do mês POR profissional — na aba Equipe (change indicadores-profissionais: saiu da
 * Visão geral). Reusa a vista de relatório (sob `atendimentos.ver`; o escopo D11 vale no servidor:
 * o escopado vê a própria linha). Cada nome é porta para a página do profissional, com o mês.
 *
 * São números DIFERENTES das "realizadas" da tabela de cima, e o subtítulo diz por quê: aqui contam
 * os atendimentos FINALIZADOS e as sessões CONSUMIDAS do pacote; lá, o status da sessão na agenda.
 */
export function BlocoProfissionais({ mes }: { mes: string }) {
  const vista = useQuery({
    queryKey: chaves.indicadores('profissionais', mes),
    queryFn: () => buscarProducaoDoMes(mes),
  })

  return (
    <QuadroDoGrafico
      id="producao-por-profissional"
      titulo="Produção do mês por profissional"
      // a JANELA em palavras (CR-IND-03): esta tabela é do mês INTEIRO, e a de cima, do período até
      // hoje — e a régua das sessões (change producao-pelo-dia-da-sessao): a baixa de setembro feita
      // em outubro conta em setembro, e a clínica perguntou "do dia ou do mês?"
      subtitulo={`O mês inteiro de ${rotuloDoMes(mes)}: atendimentos finalizados, sessões consumidas (contadas pelo dia da sessão) e evoluções preenchidas.`}
    >
      {vista.isPending ? (
        <div aria-busy="true">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {vista.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar a produção por profissional."
          aoTentarNovamente={() => void vista.refetch()}
        />
      ) : null}

      {vista.isSuccess && vista.data.linhas.length === 0 ? (
        <QuadroVazio>Sem produção no mês. Atendimentos finalizados aparecem aqui por profissional.</QuadroVazio>
      ) : null}

      {vista.isSuccess && vista.data.linhas.length > 0 ? <TabelaDaProducao linhas={vista.data.linhas} mes={mes} /> : null}
    </QuadroDoGrafico>
  )
}

/** A tabela, quem mais produziu primeiro (apresentação — a vista reusada ordena por nome). */
function TabelaDaProducao({ linhas, mes }: { linhas: ProducaoDoMes['linhas']; mes: string }) {
  return (
    <RoladorHorizontal rotulo="Produção por profissional — role para ver as colunas">
      <Tabela legenda="Produção do mês por profissional" densidade="compacta" rolagem="externa">
        <Tabela.Cabecalho>
          <Tabela.Linha>
            <Tabela.CelulaCabecalho>Profissional</Tabela.CelulaCabecalho>
            <Tabela.CelulaCabecalho className="text-right">Atendimentos</Tabela.CelulaCabecalho>
            <Tabela.CelulaCabecalho className="text-right">Sessões</Tabela.CelulaCabecalho>
            <Tabela.CelulaCabecalho className="text-right">Evoluções</Tabela.CelulaCabecalho>
          </Tabela.Linha>
        </Tabela.Cabecalho>
        <Tabela.Corpo>
          {[...linhas]
            .sort((a, b) => b.atendimentos - a.atendimentos)
            .map((linha) => (
              <Tabela.Linha key={linha.profissional.id}>
                <Tabela.CelulaCabecalho scope="row" pele="corpo">
                  <Link
                    to={`/indicadores/profissionais/${String(linha.profissional.id)}?mes=${mes}`}
                    className="rounded-controle font-medium text-texto underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                  >
                    {linha.profissional.nome ?? '—'}
                  </Link>
                </Tabela.CelulaCabecalho>
                <Tabela.Celula numerica>{formatarContagem(linha.atendimentos)}</Tabela.Celula>
                <Tabela.Celula numerica>{formatarContagem(linha.sessoes_consumidas)}</Tabela.Celula>
                <Tabela.Celula numerica>{formatarContagem(linha.evolucoes_preenchidas)}</Tabela.Celula>
              </Tabela.Linha>
            ))}
        </Tabela.Corpo>
      </Tabela>
    </RoladorHorizontal>
  )
}
