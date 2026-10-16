import { useQuery } from '@tanstack/react-query'
import { CalendarX, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { FormularioTratamento } from '@/componentes/tratamentos/formulario-tratamento'
import type { PadraoDoCadastro } from '@/componentes/tratamentos/formulario-tratamento'
import { SituacaoDoTratamento } from '@/componentes/tratamentos/situacao-do-tratamento'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { Botao } from '@/componentes/ui/botao'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { Skeleton } from '@/componentes/ui/skeleton'
import { usarMutacaoDeTratamento } from '@/hooks/usar-mutacao-de-tratamento'
import { chaves } from '@/lib/chaves-query'
import { dataLegivel } from '@/lib/datas'
import { listarTratamentos } from '@/servicos/tratamentos'
import { useAuthStore } from '@/stores/auth-store'
import type { TratamentoDaLista } from '@/tipos'

/**
 * A linha do PEDIDO MÉDICO na leitura do pacote (limites-e-pedidos, D4).
 *
 * Lê **só o que a LISTAGEM manda**: `pedido_vence_em` (derivado no servidor) e
 * `pedido_vencido` (o VEREDITO, decidido no servidor, no fuso da clínica). A emissão e o
 * override semanal são detail-only — pedi-los aqui deixava a linha morta em produção
 * (`pedido_emitido_em` nunca chega na lista, e o `return null` engolia tudo), com a suíte
 * verde porque a fixture mentia sobre a forma do servidor.
 *
 * A tela NÃO compara datas: comparar `Y-m-d` com o "hoje" do navegador usa o fuso da
 * RECEPCIONISTA, não o da clínica — era a única superfície do produto que ainda decidia
 * data no cliente, e com o fuso cravado no código.
 *
 * Sem pedido (ou convênio sem validade em meses) ⇒ `pedido_vence_em: null` ⇒ nada
 * renderiza: o ciclo do pacote segue como sempre (fail-safe SEC-LP-11).
 */
function LinhaDoPedido({ tratamento }: { tratamento: TratamentoDaLista }) {
  // `?? null` de propósito: se o servidor um dia parar de mandar o campo, a linha some
  // (degrada para "sem pedido") em vez de renderizar um vencimento inventado
  const venceEm = tratamento.pedido_vence_em ?? null

  if (venceEm === null) {
    return null
  }

  if (tratamento.pedido_vencido) {
    return (
      <p className="flex items-center gap-1 text-meta font-medium text-perigo-texto">
        <CalendarX aria-hidden="true" className="size-3.5 shrink-0" />
        Pedido médico vencido em {dataLegivel(venceEm)} — solicite a renovação.
      </p>
    )
  }

  return (
    <p className="text-meta text-texto-suave">
      Pedido médico vence em {dataLegivel(venceEm)}
    </p>
  )
}

export interface BlocoDeTratamentosProps {
  pacienteId: number
  /**
   * O convênio vigente do CADASTRO, para o pacote novo já nascer preenchido.
   *
   * Vem por prop, e não por consulta própria: o cadastro do paciente já está carregado
   * na página que monta este bloco — pedir de novo seria uma requisição por abertura de
   * ficha para um dado que está ao lado.
   */
  padraoDoCadastro?: PadraoDoCadastro
}

/**
 * Os pacotes de sessões da criança, na página dela — é aqui que a recepção olha
 * quando a mãe pergunta "quantas sessões ainda tenho?".
 *
 * O bloco vive FORA do `<form>` do cadastro do paciente de propósito: são entidades
 * diferentes, com permissões diferentes e escritas diferentes. Enfiá-lo dentro do
 * `PUT` do paciente traria de volta o bug que este projeto já pagou — um formulário
 * montado sobre cache apagando o que outra recepcionista acabou de gravar.
 */
export function BlocoDeTratamentos({ pacienteId, padraoDoCadastro }: BlocoDeTratamentosProps) {
  // o bloco se defende sozinho: sem a permissão ele não CONSULTA (depender só do
  // guard de fora deixa a consulta sair e voltar 403)
  const podeVer = useAuthStore((estado) => estado.temPermissao('tratamentos.ver'))
  const filtro = { paciente_id: pacienteId }
  const consulta = useQuery({
    queryKey: chaves.tratamentos(filtro),
    queryFn: () => listarTratamentos(filtro),
    enabled: podeVer,
  })
  const { erros, limparErros, excluir, excluindo } = usarMutacaoDeTratamento()

  const [formularioAberto, setFormularioAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<number | undefined>(undefined)
  const [aExcluir, setAExcluir] = useState<TratamentoDaLista | null>(null)

  const tratamentos = consulta.data?.data ?? []

  if (!podeVer) {
    return null
  }

  return (
    <section aria-labelledby="titulo-tratamentos" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="titulo-tratamentos" className="text-subtitulo font-semibold text-texto">
          Tratamentos
        </h2>
        <ProtegidoPorPermissao permissao="tratamentos.criar">
          <Botao
            variante="secundario"
            onClick={() => {
              limparErros()
              setEmEdicao(undefined)
              setFormularioAberto(true)
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            Novo tratamento
          </Botao>
        </ProtegidoPorPermissao>
      </div>

      {consulta.isPending ? <Skeleton className="h-24 w-full" /> : null}

      {consulta.isError ? (
        <EstadoErro
          mensagem="Não foi possível carregar os tratamentos."
          aoTentarNovamente={() => {
            void consulta.refetch()
          }}
        />
      ) : null}

      {consulta.isSuccess && tratamentos.length === 0 ? (
        <p className="rounded-superficie border border-dashed border-linha-forte p-6 text-corpo text-texto-suave">
          Nenhum tratamento cadastrado. É o pacote de sessões que a agenda desconta e o
          financeiro cobra.
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {tratamentos.map((tratamento) => (
          <li
            key={tratamento.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-superficie border border-linha-forte bg-superficie p-4"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <SituacaoDoTratamento tratamento={tratamento} />
              <p className="text-meta text-texto-suave">
                {tratamento.data_inicio === null
                  ? 'Sem data de início — o pacote não vence.'
                  : `Início em ${tratamento.data_inicio.split('-').reverse().join('/')}${
                      tratamento.validade_dias === null
                        ? ''
                        : ` · validade de ${tratamento.validade_dias} dias`
                    }`}
              </p>
              <LinhaDoPedido tratamento={tratamento} />
            </div>

            <div className="flex gap-2">
              <ProtegidoPorPermissao permissao="tratamentos.editar">
                <Botao
                  variante="secundario"
                  tamanho="sm"
                  onClick={() => {
                    limparErros()
                    // o ID, não o item da lista: o formulário carrega o DETALHE
                    // (a lista omite matrícula e guia — montar sobre ela os apagaria)
                    setEmEdicao(tratamento.id)
                    setFormularioAberto(true)
                  }}
                >
                  <Pencil aria-hidden="true" className="size-3.5" />
                  Editar
                </Botao>
              </ProtegidoPorPermissao>
              <ProtegidoPorPermissao permissao="tratamentos.excluir">
                <Botao
                  variante="perigo-suave"
                  tamanho="sm"
                  onClick={() => {
                    limparErros()
                    setAExcluir(tratamento)
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                  Excluir
                </Botao>
              </ProtegidoPorPermissao>
            </div>
          </li>
        ))}
      </ul>

      {formularioAberto ? (
        <FormularioTratamento
          pacienteId={pacienteId}
          tratamentoId={emEdicao}
          padraoDoCadastro={padraoDoCadastro}
          aoFechar={() => {
            setFormularioAberto(false)
            setEmEdicao(undefined)
          }}
        />
      ) : null}

      {/* excluir um pacote com sessões consumidas ou agendamentos é RECUSADO pelo
          servidor — a recusa aparece aqui, e o pacote continua na lista */}
      <DialogConfirmacao
        aberto={aExcluir !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setAExcluir(null)
        }}
        titulo="Excluir este tratamento?"
        consequencia="Um tratamento com sessões já realizadas ou com agendamentos não pode ser excluído — o sistema recusa. Nesse caso, marque-o como parado ou finalizado."
        rotuloConfirmar="Excluir tratamento"
        tom="perigo"
        carregando={excluindo}
        erros={erros.gerais}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            if (aExcluir === null) {
              resolver()
              return
            }
            excluir.mutate(aExcluir.id, {
              onSuccess: () => {
                setAExcluir(null)
                resolver()
              },
              onError: () => {
                rejeitar(new Error('recusado'))
              },
            })
          })
        }
      />
    </section>
  )
}
