import type { TratamentoDaLista } from '@/tipos'

import { NomeDoPaciente } from '@/componentes/indicadores/nome-do-paciente'
import { useTratamentosAtivos } from '@/componentes/profissionais/painel/consultas-de-tratamentos'
import { CartaoDaFicha, PortaDoBloco } from '@/componentes/profissionais/painel/secao-do-painel'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'

const TETO_TRATAMENTOS = 8

/**
 * TRATAMENTOS ATIVOS (mantido da change ficha-do-profissional), teto declarado.
 *
 * A lista de tratamentos é escopada pelo eixo AGENDA (D11): para quem só vê a própria agenda, o
 * tratamento de um colega simplesmente não vem — e "Nenhum tratamento ativo" na ficha dele seria um zero
 * fabricado pelo recorte. Por isso a tabela só aparece para quem ALCANÇA este profissional; os outros
 * ganham a porta para Tratamentos, sem número.
 */
export function TratamentosAtivos({ profissionalId, alcanca }: { profissionalId: number; alcanca: boolean }) {
  return (
    <CartaoDaFicha id="ficha-prof-tratamentos" titulo="Tratamentos ativos">
      {alcanca ? (
        <ListaDosAtivos profissionalId={profissionalId} />
      ) : (
        <p className="text-corpo text-texto-suave">Os tratamentos deste profissional se veem em Tratamentos, com o recorte do seu papel.</p>
      )}
      <PortaDoBloco para={`/tratamentos?profissional_id=${profissionalId}`}>Todos em Tratamentos</PortaDoBloco>
    </CartaoDaFicha>
  )
}

function ListaDosAtivos({ profissionalId }: { profissionalId: number }) {
  const tratamentos = useTratamentosAtivos(profissionalId)

  if (tratamentos.isPending) {
    return <Skeleton className="h-24 w-full" />
  }
  if (tratamentos.isError) {
    return <EstadoErro mensagem="Não foi possível carregar os tratamentos." aoTentarNovamente={() => void tratamentos.refetch()} />
  }
  if (tratamentos.data.total === 0) {
    return <p className="text-corpo text-texto-suave">Nenhum tratamento ativo com este profissional.</p>
  }

  return (
    <>
      <TabelaDeTratamentos legenda="Tratamentos ativos do profissional" tratamentos={tratamentos.data.data.slice(0, TETO_TRATAMENTOS)} />
      {/* teto DECLARADO — lista cortada se anuncia (idioma da casa) */}
      {tratamentos.data.total > TETO_TRATAMENTOS ? (
        <p className="text-meta text-texto-suave">
          Mostrando {Math.min(TETO_TRATAMENTOS, tratamentos.data.data.length)} de {tratamentos.data.total} tratamentos.
        </p>
      ) : null}
    </>
  )
}

/** A tabela criança × sessões × saldo — a mesma nos ativos e nos pacotes perto do fim. */
export function TabelaDeTratamentos({ legenda, tratamentos }: { legenda: string; tratamentos: readonly TratamentoDaLista[] }) {
  return (
    <Tabela densidade="confortavel" legenda={legenda}>
      <Tabela.Cabecalho>
        <Tabela.Linha>
          <Tabela.CelulaCabecalho>Criança</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho>Sessões</Tabela.CelulaCabecalho>
          <Tabela.CelulaCabecalho>Saldo</Tabela.CelulaCabecalho>
        </Tabela.Linha>
      </Tabela.Cabecalho>
      <Tabela.Corpo>
        {tratamentos.map((tratamento) => (
          <Tabela.Linha key={tratamento.id}>
            <Tabela.Celula>
              <NomeDoPaciente
                paciente={tratamento.paciente === undefined ? null : { id: tratamento.paciente.id, nome: tratamento.paciente.nome }}
              />
            </Tabela.Celula>
            <Tabela.Celula className="tabular-nums">
              {tratamento.sessoes_realizadas}/{tratamento.sessoes_total}
            </Tabela.Celula>
            <Tabela.Celula className="tabular-nums">{tratamento.sessoes_saldo}</Tabela.Celula>
          </Tabela.Linha>
        ))}
      </Tabela.Corpo>
    </Tabela>
  )
}
