import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Info } from 'lucide-react'
import { useState } from 'react'

import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { LeitorDeEvolucao } from '@/componentes/pacientes/ficha/leitor-de-evolucao'
import { Botao } from '@/componentes/ui/botao'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { dataHoraLegivel } from '@/lib/datas'
import { buscarAtendimentosDoPaciente } from '@/servicos/atendimentos'
import { useAuthStore } from '@/stores/auth-store'
import type { Atendimento } from '@/tipos'

interface SecaoProntuarioProps {
  pacienteId: number
}

/**
 * Seção Prontuário da ficha — a linha do tempo CLÍNICA do paciente (art. 11).
 *
 * A lista consome SÓ a listagem filtrada (`paciente_id`): metadados — data e o
 * estado da evolução. Conteúdo clínico NUNCA aparece aqui; a evolução abre sob
 * demanda pelo `LeitorDeEvolucao` (leitura AUDITADA — SEC-PF-06).
 *
 * A seção exige `evolucoes.ver` (registro); a LISTA vem de `atendimentos.ver` —
 * sem ela, a seção declara a permissão que falta (D4), nunca vazio mudo.
 */
export function SecaoProntuario({ pacienteId }: SecaoProntuarioProps) {
  const podeListarAtendimentos = useAuthStore((estado) => estado.temPermissao('atendimentos.ver'))
  const [aberta, setAberta] = useState<Atendimento | null>(null)
  const [pagina, setPagina] = useState(1)

  const lista = useQuery({
    queryKey: chaves.atendimentosDoPaciente(pacienteId, pagina),
    queryFn: () => buscarAtendimentosDoPaciente(pacienteId, pagina),
    enabled: podeListarAtendimentos,
  })

  if (!podeListarAtendimentos) {
    // permissão composta DECLARADA (D4): a lista é do módulo de atendimentos
    return (
      <p className="flex items-center gap-1.5 text-corpo text-texto-suave">
        <Info aria-hidden="true" className="size-4 shrink-0" />
        É preciso acesso aos atendimentos para ver a linha do tempo do prontuário.
      </p>
    )
  }

  const atendimentos = lista.data?.data ?? []
  const total = lista.data?.total ?? atendimentos.length
  const totalPaginas = lista.data?.last_page ?? 1

  return (
    <div className="flex flex-col gap-6">
      {lista.isSuccess ? (
        <p className="text-corpo text-texto-suave">
          {total} {total === 1 ? 'atendimento' : 'atendimentos'}
        </p>
      ) : null}

      <EstadosDaLista
        carregando={lista.isPending}
        erro={lista.isError}
        aoTentarNovamente={() => void lista.refetch()}
        vazio={atendimentos.length === 0}
        vazioTitulo="Nenhum atendimento registrado"
        vazioDescricao="As sessões atendidas deste paciente aparecem aqui, com a evolução de cada uma."
      >
        <Tabela densidade="confortavel" legenda="Atendimentos do paciente">
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho>Sessão</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Evolução</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>
                <span className="sr-only">Ações</span>
              </Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {atendimentos.map((atendimento) => {
              const quando = dataHoraLegivel(atendimento.finalizado_em)
              return (
                <Tabela.Linha key={atendimento.id}>
                  <Tabela.Celula className="text-texto">{quando}</Tabela.Celula>
                  <Tabela.Celula>
                    <EstadoDaEvolucao evolucaoId={atendimento.evolucao_id} />
                  </Tabela.Celula>
                  <Tabela.Celula className="text-right">
                    {/* o botão SÓ existe com id numérico — sem promessa vazia */}
                    {typeof atendimento.evolucao_id === 'number' ? (
                      <Botao
                        variante="fantasma"
                        tamanho="sm"
                        onClick={() => setAberta(atendimento)}
                        aria-label={`Abrir evolução da sessão de ${quando}`}
                      >
                        Abrir
                        <ChevronRight aria-hidden="true" className="size-4" />
                      </Botao>
                    ) : null}
                  </Tabela.Celula>
                </Tabela.Linha>
              )
            })}
          </Tabela.Corpo>
        </Tabela>

        {/* a linha do tempo cresce sem teto (anos de terapia) — o contador e a
            tabela não podem se contradizer: toda página é alcançável */}
        {totalPaginas > 1 ? (
          <Paginacao
            pagina={pagina}
            totalPaginas={totalPaginas}
            aoMudar={setPagina}
            totalItens={total}
          />
        ) : null}
      </EstadosDaLista>

      {aberta !== null && typeof aberta.evolucao_id === 'number' ? (
        <LeitorDeEvolucao
          evolucaoId={aberta.evolucao_id}
          finalizadoEm={aberta.finalizado_em}
          aberto={aberta !== null}
          aoFechar={() => setAberta(null)}
        />
      ) : null}
    </div>
  )
}

/**
 * Os TRÊS estados do `evolucao_id` (SEC-PF-05, `undefined ≠ null`):
 * - `undefined` — a API OMITIU (gate SEC F-03): "você não pode saber" → traço,
 *   nunca "em aberto" fabricado;
 * - `null` — não existe ainda → "Em aberto";
 * - número — existe → "Preenchida".
 */
function EstadoDaEvolucao({ evolucaoId }: { evolucaoId: number | null | undefined }) {
  if (evolucaoId === undefined) {
    return <span className="text-texto-suave">—</span>
  }
  if (evolucaoId === null) {
    return <span className="font-medium text-alerta-texto">Em aberto</span>
  }
  return <span className="font-medium text-sucesso-texto">Preenchida</span>
}
