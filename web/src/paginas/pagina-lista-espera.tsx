import { useQuery } from '@tanstack/react-query'
import { CalendarPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { FormularioEntrada } from '@/componentes/lista-espera/formulario-entrada'
import { Botao } from '@/componentes/ui/botao'
import { Etiqueta } from '@/componentes/ui/etiqueta'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'
import { Tabela } from '@/componentes/ui/tabela'
import { usarMutacaoDaFila } from '@/hooks/usar-mutacao-da-fila'
import { chaves } from '@/lib/chaves-query'
import { nomeDoPaciente, ordenarFila, rotuloDaPrioridade, tempoDeEspera } from '@/lib/fila-espera'
import { listarFila } from '@/servicos/lista-espera'
import { useAuthStore } from '@/stores/auth-store'
import type { EntradaDaFila } from '@/tipos'

/**
 * A lista de espera (§6): a fila na ordem REAL de atendimento, com contador — e
 * o encaixe, que acontece na agenda (é lá que se vê o horário que abriu).
 */
/** Urgente grita em perigo, Alta avisa em âmbar, Normal fica neutra — sempre com a palavra. */
function tomDaPrioridade(prioridade: number): 'perigo' | 'alerta' | 'neutro' {
  if (prioridade >= 10) {
    return 'perigo'
  }

  return prioridade >= 5 ? 'alerta' : 'neutro'
}

export function PaginaListaEspera() {
  const navigate = useNavigate()
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const [formularioAberto, setFormularioAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<EntradaDaFila | null>(null)
  const [saindo, setSaindo] = useState<EntradaDaFila | null>(null)
  const { sair, gravando } = usarMutacaoDaFila()

  const fila = useQuery({ queryKey: chaves.listaEspera(), queryFn: listarFila })

  const podeCriar = temPermissao('lista_espera.criar')
  const podeEditar = temPermissao('lista_espera.editar')
  const podeExcluir = temPermissao('lista_espera.excluir')
  // encaixar é escrita COMPOSTA: o servidor exige as duas permissões
  const podeEncaixar = podeExcluir && temPermissao('agenda.criar')

  const entradas = ordenarFila(fila.data ?? [])

  function abrirNova() {
    setEmEdicao(null)
    setFormularioAberto(true)
  }

  function confirmarSaida() {
    if (saindo === null) {
      return
    }
    // promessa que REJEITA na recusa: o dialog não pode fechar como se tivesse
    // dado certo quando o servidor disse não
    return new Promise<void>((resolver, rejeitar) => {
      sair.mutate(saindo.id, {
        onSuccess: () => {
          setSaindo(null)
          resolver()
        },
        onError: () => {
          rejeitar(new Error('recusado'))
        },
      })
    })
  }

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-titulo font-semibold text-texto">Lista de espera</h1>
          <p className="mt-1 text-corpo text-texto-suave">
            {fila.isPending
              ? 'Carregando a fila…'
              : `${entradas.length} ${entradas.length === 1 ? 'paciente esperando' : 'pacientes esperando'}`}
          </p>
        </div>
        {podeCriar ? (
          <Botao tamanho="lg" onClick={abrirNova}>
            Entrar na fila
          </Botao>
        ) : null}
      </header>

      {fila.isPending ? <Skeleton className="h-64 w-full" /> : null}

      {fila.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar a lista de espera."
          aoTentarNovamente={() => {
            void fila.refetch()
          }}
        />
      ) : null}

      {fila.isSuccess && entradas.length === 0 ? (
        <EstadoVazio
          icone={<Users size={32} />}
          titulo="Ninguém na lista de espera."
          descricao="Quando um horário abrir, é aqui que a recepção descobre quem chamar."
          acao={podeCriar ? <Botao onClick={abrirNova}>Entrar na fila</Botao> : undefined}
        />
      ) : null}

      {fila.isSuccess && entradas.length > 0 ? (
        <Tabela legenda={`Lista de espera — ${entradas.length} na fila`} densidade="confortavel">
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho>Paciente</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Espera por</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Prioridade</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Na fila</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Observação</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho>Ações</Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {entradas.map((entrada) => {
              const desejo = [entrada.especialidade?.nome, entrada.profissional?.nome].filter(Boolean).join(' · ')

              return (
                <Tabela.Linha key={entrada.id}>
                  <Tabela.Celula>{nomeDoPaciente(entrada)}</Tabela.Celula>
                  <Tabela.Celula>{desejo !== '' ? desejo : 'Qualquer horário'}</Tabela.Celula>
                  <Tabela.Celula>
                    <Etiqueta tom={tomDaPrioridade(entrada.prioridade)}>{rotuloDaPrioridade(entrada.prioridade)}</Etiqueta>
                  </Tabela.Celula>
                  <Tabela.Celula>{tempoDeEspera(entrada.created_at)}</Tabela.Celula>
                  <Tabela.Celula>{entrada.obs ?? '—'}</Tabela.Celula>
                  <Tabela.Celula>
                    <div className="flex flex-wrap gap-2">
                      {podeEncaixar ? (
                        <Botao
                          tamanho="sm"
                          onClick={() => {
                            // o encaixe acontece na AGENDA: é lá que se vê o
                            // horário que abriu (um fluxo só — design D6)
                            navigate(`/agenda?encaixe=${entrada.id}`)
                          }}
                        >
                          <CalendarPlus size={16} aria-hidden="true" />
                          Encaixar
                        </Botao>
                      ) : null}
                      {podeEditar ? (
                        <Botao
                          tamanho="sm"
                          variante="secundario"
                          onClick={() => {
                            setEmEdicao(entrada)
                            setFormularioAberto(true)
                          }}
                        >
                          Editar
                        </Botao>
                      ) : null}
                      {podeExcluir ? (
                        <Botao
                          tamanho="sm"
                          variante="perigo-suave"
                          onClick={() => {
                            setSaindo(entrada)
                          }}
                        >
                          Sair da fila
                        </Botao>
                      ) : null}
                    </div>
                  </Tabela.Celula>
                </Tabela.Linha>
              )
            })}
          </Tabela.Corpo>
        </Tabela>
      ) : null}

      <FormularioEntrada
        aberto={formularioAberto}
        entrada={emEdicao}
        aoFechar={() => {
          setFormularioAberto(false)
          setEmEdicao(null)
        }}
      />

      <DialogConfirmacao
        aberto={saindo !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) {
            setSaindo(null)
          }
        }}
        titulo={saindo !== null ? `Tirar ${nomeDoPaciente(saindo)} da lista de espera?` : ''}
        consequencia="A entrada é removida da fila. O paciente não fica agendado — para isso, use “Encaixar”."
        rotuloConfirmar="Sair da fila"
        tom="perigo"
        carregando={gravando}
        aoConfirmar={confirmarSaida}
      />
    </section>
  )
}
