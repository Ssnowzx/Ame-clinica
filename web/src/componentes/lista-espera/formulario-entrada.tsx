import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { AlertDialog } from 'radix-ui'
import { useState } from 'react'

import { CardPreCadastro } from '@/componentes/lista-espera/card-pre-cadastro'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoBusca, type OpcaoDeBusca } from '@/componentes/ui/campo-busca'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { usarEscolhaDePaciente } from '@/hooks/usar-escolha-de-paciente'
import { usarMutacaoDaFila } from '@/hooks/usar-mutacao-da-fila'
import { chaves } from '@/lib/chaves-query'
import { DEGRAUS_DE_PRIORIDADE, rotuloDaPrioridade } from '@/lib/fila-espera'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarSelecaoDaAgenda } from '@/servicos/agenda'
import { useAuthStore } from '@/stores/auth-store'
import type { EntradaDaFila, PayloadDaFila } from '@/tipos'

interface Formulario {
  paciente: OpcaoDeBusca | null
  especialidadeId: string
  profissionalId: string
  prioridade: string
  obs: string
}

export interface FormularioEntradaProps {
  aberto: boolean
  aoFechar: () => void
  /** Edição quando presente; entrada nova quando ausente */
  entrada?: EntradaDaFila | null
}

const VAZIO: Formulario = {
  paciente: null,
  especialidadeId: '',
  profissionalId: '',
  prioridade: '0',
  obs: '',
}

function daEntrada(entrada: EntradaDaFila): Formulario {
  return {
    paciente:
      entrada.paciente !== null
        ? { valor: entrada.paciente.id, rotulo: entrada.paciente.nome_social ?? entrada.paciente.nome }
        : null,
    especialidadeId: entrada.especialidade_id !== null ? String(entrada.especialidade_id) : '',
    profissionalId: entrada.profissional_id !== null ? String(entrada.profissional_id) : '',
    prioridade: String(entrada.prioridade),
    obs: entrada.obs ?? '',
  }
}

/**
 * Entrar na fila / editar a entrada.
 *
 * O paciente vem da SELEÇÃO da agenda (`/agenda/selecao/pacientes`), que
 * devolve só id e nome: administrar a fila não pode exigir `pacientes.ver`, que
 * entregaria CPF, responsáveis e endereço de um menor a quem só quer um nome
 * (design D5).
 */
export function FormularioEntrada({ aberto, aoFechar, entrada = null }: FormularioEntradaProps) {
  const editando = entrada !== null
  const [form, setForm] = useState<Formulario>(VAZIO)
  const [termoDoPaciente, setTermoDoPaciente] = useState('')
  const [iniciado, setIniciado] = useState(false)
  // pré-cadastro pelo balcão (spec lista-espera): botão só com pacientes.criar
  const [criandoPaciente, setCriandoPaciente] = useState(false)
  const podeCriarPaciente = useAuthStore((estado) => estado.temPermissao('pacientes.criar'))
  const queryClient = useQueryClient()
  const { entrar, atualizar, erros, gravando } = usarMutacaoDaFila()

  const selecao = useQuery({
    queryKey: chaves.selecaoDaAgenda(),
    queryFn: buscarSelecaoDaAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: aberto,
  })

  /**
   * Os profissionais que ATENDEM a especialidade escolhida — todos, quando nenhuma foi.
   *
   * A fila aceita "qualquer especialidade" e "qualquer profissional" de propósito (é uma
   * ESPERA, não um agendamento). O que ela NÃO pode aceitar é o par impossível.
   */
  function profissionaisQueAtendem(especialidadeId: string) {
    const todos = selecao.data?.profissionais ?? []
    if (especialidadeId === '') {
      return todos
    }

    return todos.filter((profissional) =>
      profissional.especialidades.some((item) => String(item.id) === especialidadeId),
    )
  }

  // lista ao abrir, busca ao digitar — a coreografia inteira vive no hook
  const pacientes = usarEscolhaDePaciente({
    aberto,
    termo: termoDoPaciente,
    rotuloEscolhido: form.paciente?.rotulo ?? null,
  })

  if (aberto && !iniciado) {
    const base = entrada !== null ? daEntrada(entrada) : { ...VAZIO }
    setForm(base)
    setTermoDoPaciente(base.paciente?.rotulo ?? '')
    setIniciado(true)
  }

  function fechar() {
    setIniciado(false)
    setCriandoPaciente(false)
    aoFechar()
  }

  /** O criado entra SELECIONADO na busca — o gesto continua "entrar na fila". */
  function aoCriarPaciente(paciente: { id: number; nome: string }) {
    setForm((atual) => ({ ...atual, paciente: { valor: paciente.id, rotulo: paciente.nome } }))
    setTermoDoPaciente(paciente.nome)
    setCriandoPaciente(false)
    // a busca por nome agora deve ENCONTRAR o recém-criado (cache por termo)
    void queryClient.invalidateQueries({ queryKey: ['agenda-selecao', 'pacientes'] })
  }

  /**
   * Os três degraus — mais o valor que a entrada já tem, quando ele não é um
   * deles. A prioridade é 0–10 no dado (D7): sem esta linha, editar uma entrada
   * de prioridade 7 mostraria o select VAZIO, e salvar a rebaixaria para Normal
   * sem que ninguém tivesse pedido (parecer code-review §6).
   */
  const opcoesDePrioridade = (() => {
    const degraus = DEGRAUS_DE_PRIORIDADE.map((degrau) => ({
      valor: String(degrau.valor),
      rotulo: degrau.rotulo,
    }))
    const atual = form.prioridade
    if (atual !== '' && !degraus.some((degrau) => degrau.valor === atual)) {
      return [...degraus, { valor: atual, rotulo: rotuloDaPrioridade(Number(atual)) }]
    }
    return degraus
  })()

  function montarPayload(): PayloadDaFila {
    return {
      paciente_id: form.paciente?.valor ?? 0,
      especialidade_id: form.especialidadeId !== '' ? Number(form.especialidadeId) : null,
      profissional_id: form.profissionalId !== '' ? Number(form.profissionalId) : null,
      prioridade: Number(form.prioridade),
      obs: form.obs !== '' ? form.obs : null,
    }
  }

  function submeter(evento: React.FormEvent) {
    evento.preventDefault()

    if (editando && entrada !== null) {
      atualizar.mutate({ id: entrada.id, payload: montarPayload(), versao: entrada.updated_at }, { onSuccess: fechar })
      return
    }
    entrar.mutate(montarPayload(), { onSuccess: fechar })
  }

  return (
    <AlertDialog.Root open={aberto} onOpenChange={(estado) => !estado && fechar()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-(--z-dialogo) max-h-[90vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-janela bg-superficie-elevada p-6 shadow-e3">
          <AlertDialog.Title className="text-titulo font-semibold text-texto">
            {editando ? 'Editar espera' : 'Entrar na lista de espera'}
          </AlertDialog.Title>
          <AlertDialog.Description className="sr-only">
            Escolha o paciente e o que ele espera.
          </AlertDialog.Description>

          {/* o card de PRÉ-CADASTRO abre ACIMA do formulário (spec lista-espera):
              a criança ainda sem cadastro entra na fila sem ninguém sair da tela */}
          {criandoPaciente ? (
            <div className="mt-5">
              <CardPreCadastro
                aoCriar={aoCriarPaciente}
                aoCancelar={() => {
                  setCriandoPaciente(false)
                }}
              />
            </div>
          ) : null}

          <form onSubmit={submeter} className="mt-5 flex flex-col gap-4">
            <AvisoErro mensagens={erros.gerais} />

            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <CampoBusca
                  rotulo="Paciente"
                  obrigatorio
                  placeholder="Buscar ou escolher…"
                  selecionado={form.paciente}
                  aoSelecionar={(opcao) => {
                    setForm((atual) => ({ ...atual, paciente: opcao }))
                  }}
                  termo={termoDoPaciente}
                  aoDigitar={setTermoDoPaciente}
                  opcoes={pacientes.opcoes}
                  carregando={pacientes.carregando}
                  falhou={pacientes.falhou}
                  existeInativo={pacientes.existeInativo}
                  carregandoMais={pacientes.carregandoMais}
                  aoAproximarDoFim={pacientes.aoAproximarDoFim}
                  erro={erros.porCampo.paciente_id}
                />
              </div>
              {!editando && podeCriarPaciente ? (
                <Botao
                  type="button"
                  variante="secundario"
                  onClick={() => {
                    setCriandoPaciente(true)
                  }}
                  disabled={criandoPaciente}
                >
                  <UserPlus aria-hidden="true" className="size-4" />
                  Novo paciente
                </Botao>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CampoSelect
                rotulo="Especialidade desejada"
                value={form.especialidadeId}
                onChange={(evento) => {
                  const especialidadeId = evento.target.value
                  setForm((atual) => {
                    // trocar a especialidade pode invalidar o profissional já escolhido:
                    // ele sai, em vez de virar um par impossível
                    const aindaAtende =
                      atual.profissionalId === ''
                      || profissionaisQueAtendem(especialidadeId).some(
                        (item) => String(item.id) === atual.profissionalId,
                      )

                    return {
                      ...atual,
                      especialidadeId,
                      profissionalId: aindaAtende ? atual.profissionalId : '',
                    }
                  })
                }}
                opcoes={(selecao.data?.especialidades ?? []).map((item) => ({
                  valor: String(item.id),
                  rotulo: item.nome,
                }))}
                placeholder="Qualquer uma"
                erro={erros.porCampo.especialidade_id}
              />

              {/* Só quem ATENDE a especialidade escolhida. Sem isto dava para pedir
                  "Psicologia com a Carla" (que é de Terapia Ocupacional) — uma espera que o
                  agendamento SEMPRE recusaria, e que a recepcionista só descobria na hora do
                  encaixe, tendo de trocar em silêncio o que a família pediu. O servidor
                  também recusa (a fronteira é dele); aqui a lista simplesmente não mente. */}
              <CampoSelect
                rotulo="Profissional desejado"
                value={form.profissionalId}
                onChange={(evento) => {
                  setForm((atual) => ({ ...atual, profissionalId: evento.target.value }))
                }}
                opcoes={profissionaisQueAtendem(form.especialidadeId).map((item) => ({
                  valor: String(item.id),
                  rotulo: item.nome,
                }))}
                placeholder="Qualquer um"
                ajuda={
                  form.especialidadeId === ''
                    ? 'Sem escolha, o paciente cabe em qualquer horário que abrir.'
                    : 'Só quem atende a especialidade escolhida.'
                }
                erro={erros.porCampo.profissional_id}
              />
            </div>

            <CampoSelect
              rotulo="Prioridade"
              value={form.prioridade}
              onChange={(evento) => {
                setForm((atual) => ({ ...atual, prioridade: evento.target.value }))
              }}
              opcoes={opcoesDePrioridade}
              erro={erros.porCampo.prioridade}
            />

            <CampoTexto
              rotulo="Observação"
              value={form.obs}
              onChange={(evento) => {
                setForm((atual) => ({ ...atual, obs: evento.target.value }))
              }}
              // a `obs` da fila é OPERACIONAL e some na tela de quem tem
              // `lista_espera.ver` — dado clínico vai para a evolução, cifrada
              // em repouso (decisão do gate, SEC-LE-06)
              ajuda="Observação operacional (ex.: “prefere terça de manhã”). Não registre informação clínica."
              erro={erros.porCampo.obs}
            />

            <div className="mt-2 flex justify-end gap-3">
              <Botao type="button" variante="secundario" tamanho="lg" onClick={fechar} disabled={gravando}>
                Cancelar
              </Botao>
              <Botao type="submit" tamanho="lg" carregando={gravando} disabled={form.paciente === null}>
                {editando ? 'Salvar' : 'Entrar na fila'}
              </Botao>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
