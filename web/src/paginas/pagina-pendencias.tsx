import { useQuery } from '@tanstack/react-query'
import { CalendarPlus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Paginacao } from '@/componentes/ui/paginacao'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { chaves } from '@/lib/chaves-query'
import { dataLegivel } from '@/lib/datas'
import { listarPendenciasDeRetorno } from '@/servicos/catalogos'
import { useAuthStore } from '@/stores/auth-store'
import type { ItemPendenciaDeRetorno } from '@/tipos'

/**
 * A fila de RETORNOS — quem parou de ser agendado.
 *
 * Cada linha é uma criança com tratamento em andamento, saldo de sessões e NENHUMA próxima
 * sessão marcada. Foi o pedido verbatim da clínica (PR-09): pacientes ficaram mais de um mês
 * sem os próximos agendamentos porque a recepção esquece quando a família não retorna — e a
 * ausência de agendamento é invisível por construção.
 *
 * **Não é a Lista de Espera.** Aquela é a fila de ENTRADA (quem ainda não tem horário); esta
 * é a de CONTINUIDADE (quem tinha e parou).
 *
 * **Nada aqui se resolve por um botão de "resolver".** A pendência é derivada: some sozinha
 * quando o agendamento nasce. Por isso a única ação é agendar — no fluxo que já existe, para
 * não duplicar as regras de conflito, horário do profissional e limite de convênio.
 *
 * `dias_sem_agendamento` vem calculado do servidor, no fuso da clínica; a tela não refaz a conta.
 */
export function PaginaPendencias() {
  const [pagina, setPagina] = useState(1)
  const temPermissao = useAuthStore((estado) => estado.temPermissao)

  // a permissão do DESTINO é consultada aqui, não presumida da permissão da fila
  // (gate SEC F-02): link que promete o que o servidor nega é promessa vazia
  const podeVerFicha = temPermissao('pacientes.ver')
  const podeAgendar = temPermissao('agenda.criar')

  const fila = useQuery({
    queryKey: chaves.pendenciasDeRetorno({ pagina }),
    queryFn: () => listarPendenciasDeRetorno({ pagina }),
  })

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-titulo font-semibold text-texto">Pendências de retorno</h1>
        <p className="mt-1 text-corpo text-texto-suave">
          {fila.isSuccess
            ? `Crianças em tratamento sem próxima sessão marcada há mais de ${fila.data.janela_dias} dias.`
            : 'Crianças em tratamento sem próxima sessão marcada.'}
        </p>
      </header>

      {fila.isPending ? <Skeleton className="h-64 w-full" /> : null}

      {fila.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar as pendências de retorno."
          aoTentarNovamente={() => void fila.refetch()}
        />
      ) : null}

      {fila.isSuccess && fila.data.data.length === 0 ? (
        <EstadoVazio
          titulo="Nenhuma pendência de retorno."
          descricao="Todos os pacientes em tratamento têm próxima sessão marcada."
        />
      ) : null}

      {fila.isSuccess && fila.data.data.length > 0 ? (
        <>
          <Tabela legenda={`${fila.data.total} pendências de retorno`}>
            <Tabela.Cabecalho>
              <Tabela.Linha>
                <Tabela.CelulaCabecalho scope="col">Criança</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Sem agendamento</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Desde</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Em tratamento</Tabela.CelulaCabecalho>
                <Tabela.CelulaCabecalho scope="col">Ação</Tabela.CelulaCabecalho>
              </Tabela.Linha>
            </Tabela.Cabecalho>
            <Tabela.Corpo>
              {fila.data.data.map((item: ItemPendenciaDeRetorno) => (
                <Tabela.Linha key={item.paciente.id}>
                  <Tabela.Celula>
                    {podeVerFicha ? (
                      <Link
                        to={`/pacientes/${item.paciente.id}`}
                        className="rounded-controle font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                      >
                        {item.paciente.nome}
                      </Link>
                    ) : (
                      item.paciente.nome
                    )}
                  </Tabela.Celula>
                  <Tabela.Celula>{diasEmPalavras(item.dias_sem_agendamento)}</Tabela.Celula>
                  <Tabela.Celula className="text-texto-suave">{desdeQuando(item)}</Tabela.Celula>
                  <Tabela.Celula className="text-texto-suave">
                    {item.especialidades.length > 0
                      ? item.especialidades.map((especialidade) => especialidade.nome).join(' · ')
                      : '—'}
                  </Tabela.Celula>
                  <Tabela.Celula>
                    {podeAgendar ? (
                      <Link
                        // A criança vai JUNTO — por id, nunca pelo nome (gatilho `LOG`): a agenda
                        // entra em modo retorno e resolve o nome por leitura autorizada. Sem isto,
                        // a recepção caía na grade e tinha de redigitar o nome que acabou de ler.
                        to={`/agenda?paciente=${item.paciente.id}`}
                        className="flex w-fit items-center gap-1 rounded-controle text-meta font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                      >
                        <CalendarPlus aria-hidden="true" className="size-3.5" />
                        Agendar retorno
                      </Link>
                    ) : (
                      <span className="text-meta text-texto-suave">—</span>
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

/** Os dias em português, sem "1 dias" e sem afirmar nada quando o servidor não contou. */
function diasEmPalavras(dias: number | null): string {
  if (dias === null) {
    return '—'
  }
  return dias === 1 ? '1 dia' : `${dias} dias`
}

/**
 * De quando parte a contagem. Sem sessão nenhuma, a âncora é o início do tratamento — e a
 * tela DIZ isso: "pacote vendido e nunca agendado" é outro problema que "sumiu depois de vir",
 * e confundir os dois faria a recepção procurar uma sessão que nunca existiu.
 */
function desdeQuando(item: ItemPendenciaDeRetorno): string {
  if (item.ultima_ocorrencia_em !== null) {
    return `Última sessão em ${dataLegivel(item.ultima_ocorrencia_em)}`
  }
  if (item.inicio_tratamento_em !== null) {
    return `Nunca agendado · tratamento de ${dataLegivel(item.inicio_tratamento_em)}`
  }
  return '—'
}
