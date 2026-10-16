import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel, dataLegivel } from '@/lib/datas'
import { listarEvolucoesEmAberto } from '@/servicos/atendimentos'
import type { EvolucaoEmAberto } from '@/tipos'

/**
 * A fila de evoluções em aberto.
 *
 * Cada linha é uma sessão que ACONTECEU com uma criança e cujo registro clínico não foi
 * escrito. É a obrigação da §7 que ninguém via — o contador do cabeçalho mostrava o número
 * e não levava a lugar nenhum.
 *
 * **Só metadados.** Conteúdo de evolução aqui não existe, por definição: a fila é a dos
 * atendimentos que ainda NÃO têm evolução. E `prazo_ate`/`vencida` vêm CALCULADOS do
 * servidor, no fuso da clínica — a tela exibe e não refaz a conta (o navegador pode estar
 * em outro fuso, e a clínica tem o dela).
 */
export function PaginaEvolucoes() {
  // chegada pela FICHA do profissional: recorta a fila por ele (o plano filtra; o
  // escopado já é forçado ao próprio no servidor) e dá a volta para a ficha
  const [parametros] = useSearchParams()
  const profissionalBruto = Number(parametros.get('profissional_id'))
  const profissionalDaFicha =
    Number.isInteger(profissionalBruto) && profissionalBruto > 0 ? profissionalBruto : null

  const [pagina, setPagina] = useState(1)

  const fila = useQuery({
    queryKey: chaves.evolucoesEmAberto({ pagina, profissionalId: profissionalDaFicha }),
    queryFn: () => listarEvolucoesEmAberto({ pagina, profissionalId: profissionalDaFicha }),
  })

  return (
    <div className="flex flex-col gap-5">
      <header>
        {profissionalDaFicha !== null ? (
          <Link
            to={`/profissionais/${profissionalDaFicha}`}
            className="mb-1 flex w-fit items-center gap-1 rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Ficha do profissional
          </Link>
        ) : null}
        <h1 className="text-titulo font-semibold text-texto">Evoluções em aberto</h1>
        <p className="mt-1 text-corpo text-texto-suave">
          Sessões que aconteceram e ainda não têm registro clínico. O prazo é o da clínica.
        </p>
      </header>

      {fila.isPending ? <Skeleton className="h-64 w-full" /> : null}

      {fila.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar as evoluções em aberto."
          aoTentarNovamente={() => void fila.refetch()}
        />
      ) : null}

      {fila.isSuccess && fila.data.data.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma evolução em aberto."
          descricao="Toda sessão registrada tem o seu registro clínico escrito."
        />
      ) : null}

      {fila.isSuccess && fila.data.data.length > 0 ? (
        <>
          <Tabela legenda={`${fila.data.total} evoluções em aberto`}>
            <Tabela.Cabecalho>
              <Tabela.Linha>
                <Tabela.CelulaCabecalho scope="col">Criança</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Profissional</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Sessão</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Prazo</Tabela.CelulaCabecalho>
              </Tabela.Linha>
            </Tabela.Cabecalho>
            <Tabela.Corpo>
              {fila.data.data.map((item: EvolucaoEmAberto) => (
                <Tabela.Linha key={item.atendimento_id}>
                  <Tabela.Celula>{item.paciente?.nome ?? '—'}</Tabela.Celula>
                  <Tabela.Celula>{item.profissional?.nome ?? '—'}</Tabela.Celula>
                  <Tabela.Celula>{dataHoraLegivel(item.finalizado_em)}</Tabela.Celula>
                  <Tabela.Celula>
                    {/* O destaque do VENCIDO não depende só de cor (WCAG 1.4.1):
                        ícone + palavra carregam o significado sozinhos. */}
                    {item.vencida ? (
                      <span className="flex items-center gap-1 font-medium text-alerta-texto">
                        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
                        Venceu em {dataLegivel(item.prazo_ate)}
                      </span>
                    ) : (
                      <span className="text-texto-suave">Até {dataLegivel(item.prazo_ate)}</span>
                    )}
                  </Tabela.Celula>
                </Tabela.Linha>
              ))}
            </Tabela.Corpo>
          </Tabela>

          <Paginacao
            pagina={fila.data.current_page}
            totalPaginas={fila.data.last_page}
            totalItens={fila.data.total}
            aoMudar={setPagina}
          />
        </>
      ) : null}
    </div>
  )
}
