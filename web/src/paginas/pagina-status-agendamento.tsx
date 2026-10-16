import { useQuery } from '@tanstack/react-query'
import { Info, Pencil, Plus, Trash2 } from 'lucide-react'
import { AlertDialog } from 'radix-ui'
import { useState, type FormEvent } from 'react'

import { CabecalhoDeCadastro } from '@/componentes/cadastro/cabecalho-de-cadastro'
import { EstadosDaLista } from '@/componentes/cadastro/estados-da-lista'
import { ProtegidoPorPermissao } from '@/componentes/protegido-por-permissao'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoCor } from '@/componentes/ui/campo-cor'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { ChipStatus } from '@/componentes/ui/chip-status'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { Tabela } from '@/componentes/ui/tabela'
import { usarMutacaoDeCatalogo } from '@/hooks/usar-mutacao-de-catalogo'
import { chaves } from '@/lib/chaves-query'
import { COR_DE_RESERVA } from '@/lib/cor-status'
import { statusAgendamento, type PayloadStatus } from '@/servicos/catalogos-de-apoio'
import {
  consequenciasDaRegra,
  FLAGS_DO_STATUS_NOVO,
  type ValoresDoStatus,
} from '@/lib/regras-do-status'
import type { StatusAgendamento } from '@/tipos'

const CAMPOS = new Set([
  'nome',
  'cor',
  'cor_borda',
  'desconta_sessao',
  'ocupa_horario',
  'marca_falta',
  'marca_reserva',
  // os invariantes das flags do lote chegam por estas chaves (change baixa-em-lote-por-status)
  'em_aberto',
  'aplicavel_em_lote',
  'tipo',
  'ordem',
])

/** Os slugs que o servidor aceita (`CatalogoIconesStatus::ICONES`). */
const ICONES = [
  'circle-dot',
  'circle-dashed',
  'clock',
  'check',
  'clipboard-check',
  'user-x',
  'file-check',
  'calendar-x',
  'bookmark',
  'stethoscope',
  'rotate-ccw',
  'ban',
  'coffee',
  'users',
]

function valoresIniciais(status?: StatusAgendamento): ValoresDoStatus {
  return {
    nome: status?.nome ?? '',
    cor: status?.cor ?? COR_DE_RESERVA,
    cor_borda: status?.cor_borda ?? '',
    desconta_sessao: status?.desconta_sessao ?? FLAGS_DO_STATUS_NOVO.desconta_sessao,
    ocupa_horario: status?.ocupa_horario ?? FLAGS_DO_STATUS_NOVO.ocupa_horario,
    marca_falta: status?.marca_falta ?? FLAGS_DO_STATUS_NOVO.marca_falta,
    marca_reserva: status?.marca_reserva ?? FLAGS_DO_STATUS_NOVO.marca_reserva,
    em_aberto: status?.em_aberto ?? FLAGS_DO_STATUS_NOVO.em_aberto,
    aplicavel_em_lote: status?.aplicavel_em_lote ?? FLAGS_DO_STATUS_NOVO.aplicavel_em_lote,
    tipo: status?.tipo ?? 'circle-dot',
    ordem: String(status?.ordem ?? 100),
  }
}

/**
 * Status de agendamento — **a tela onde a clínica edita REGRA** (§13), não
 * aparência.
 *
 * Três flags decidem comportamento do sistema, e uma quarta coisa decide mais que
 * todas elas: a **ordem**. O status de MENOR ordem é aquele com que todo
 * agendamento nasce — reordenar a lista muda a regra de nascimento da agenda
 * inteira. O servidor guarda esse invariante (`GuardaDoStatusInicial`); esta tela
 * avisa, para que a recepção não descubra pela recusa.
 *
 * Nenhuma flag muda sem confirmação que diga **o que vai passar a acontecer** —
 * e a confirmação NÃO PODE mentir sobre o passado (ver `regras-do-status.ts`).
 */
export function PaginaStatusAgendamento() {
  const consulta = useQuery({
    queryKey: chaves.statusAgendamento(),
    queryFn: statusAgendamento.listar,
  })
  const { erros, limparErros, criar, atualizar, excluir, salvando, excluindo } =
    usarMutacaoDeCatalogo<StatusAgendamento, PayloadStatus>({
      recurso: statusAgendamento,
      chave: chaves.statusAgendamento(),
      campos: CAMPOS,
      rotuloSingular: 'status',
      genero: 'm',
    })

  const [emEdicao, setEmEdicao] = useState<StatusAgendamento | null>(null)
  const [formularioAberto, setFormularioAberto] = useState(false)
  const [valores, setValores] = useState<ValoresDoStatus>(() => valoresIniciais())
  const [aConfirmar, setAConfirmar] = useState<readonly string[] | null>(null)
  const [aExcluir, setAExcluir] = useState<StatusAgendamento | null>(null)

  const lista = [...(consulta.data ?? [])].sort((a, b) => a.ordem - b.ordem || a.id - b.id)
  const inicial = lista[0]

  /**
   * O que o diálogo de confirmação de regra mostra: além do aviso geral, a recusa de um
   * INVARIANTE das flags (em aberto × desconto/falta/reserva/horário × opção de baixa; o inicial
   * em aberto). Ela chega pela chave da flag em conflito e pousa nela no formulário — mas, com a
   * confirmação aberta POR CIMA, é aqui que a recepção está olhando (o Radix esconde o resto).
   */
  const errosDaRegra = [
    ...erros.gerais,
    ...['em_aberto', 'aplicavel_em_lote', 'marca_reserva', 'desconta_sessao', 'ocupa_horario', 'marca_falta', 'ordem']
      .map((chave) => erros.campos.get(chave))
      .filter((mensagem): mensagem is string => mensagem !== undefined),
  ]

  function definir(parciais: Partial<ValoresDoStatus>): void {
    setValores((anteriores) => ({ ...anteriores, ...parciais }))
  }

  function abrirFormulario(status?: StatusAgendamento): void {
    limparErros()
    setEmEdicao(status ?? null)
    setValores(valoresIniciais(status))
    setFormularioAberto(true)
  }

  function paraPayload(): PayloadStatus {
    return {
      nome: valores.nome,
      cor: valores.cor,
      cor_borda: valores.cor_borda === '' ? null : valores.cor_borda,
      desconta_sessao: valores.desconta_sessao,
      ocupa_horario: valores.ocupa_horario,
      marca_falta: valores.marca_falta,
      marca_reserva: valores.marca_reserva,
      em_aberto: valores.em_aberto,
      aplicavel_em_lote: valores.aplicavel_em_lote,
      tipo: valores.tipo === '' ? null : valores.tipo,
      ordem: Number(valores.ordem),
    }
  }

  function salvar(): void {
    const fechar = {
      onSuccess: () => {
        setFormularioAberto(false)
        setAConfirmar(null)
      },
    }
    if (emEdicao === null) {
      criar.mutate(paraPayload(), fechar)
      return
    }
    atualizar.mutate({ id: emEdicao.id, payload: paraPayload(), versao: emEdicao.updated_at }, fechar)
  }

  function submeter(evento: FormEvent): void {
    evento.preventDefault()

    // mudou REGRA? então a clínica confirma sabendo a consequência (§2)
    const consequencias = consequenciasDaRegra(valores, emEdicao ?? undefined)
    if (consequencias.length > 0) {
      setAConfirmar(consequencias)
      return
    }
    salvar()
  }

  return (
    <section className="flex flex-col gap-6">
      <CabecalhoDeCadastro
        titulo="Status de agendamento"
        voltar={{ rota: '/cadastros', rotulo: 'Cadastros' }}
        contador={consulta.isSuccess ? `${lista.length} status` : undefined}
        acao={
          <ProtegidoPorPermissao permissao="status_agendamento.criar">
            <Botao
              onClick={() => {
                abrirFormulario()
              }}
            >
              <Plus aria-hidden="true" className="size-4" />
              Cadastrar status
            </Botao>
          </ProtegidoPorPermissao>
        }
      />

      {/* a `ordem` parece decoração e é REGRA: quem chega aqui precisa saber
          disso ANTES de arrastar números, não pela recusa do servidor */}
      <p className="flex items-start gap-2 rounded-superficie border border-linha-forte bg-superficie p-4 text-corpo text-texto-suave">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-acento" />
        <span>
          O status de <strong className="font-semibold text-texto">menor ordem</strong> é aquele com
          que todo agendamento novo nasce
          {inicial !== undefined ? (
            <>
              {' '}
              — hoje, <strong className="font-semibold text-texto">{inicial.nome}</strong>
            </>
          ) : null}
          . Por isso ele precisa estar em aberto — e não pode descontar sessão nem deixar de ocupar
          horário.
        </span>
      </p>

      <EstadosDaLista
        carregando={consulta.isPending}
        erro={consulta.isError}
        aoTentarNovamente={() => {
          void consulta.refetch()
        }}
        vazio={consulta.isSuccess && lista.length === 0}
        vazioTitulo="Nenhum status cadastrado"
        vazioDescricao="Sem status, nenhum agendamento pode ser criado."
      >
        <Tabela legenda={`${lista.length} status de agendamento`}>
          <Tabela.Cabecalho>
            <Tabela.Linha>
              <Tabela.CelulaCabecalho scope="col">Ordem</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Status</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Regras</Tabela.CelulaCabecalho>
              <Tabela.CelulaCabecalho scope="col">Ações</Tabela.CelulaCabecalho>
            </Tabela.Linha>
          </Tabela.Cabecalho>
          <Tabela.Corpo>
            {lista.map((status) => (
              <Tabela.Linha key={status.id}>
                <Tabela.Celula>
                  <span className="tabular-nums">{status.ordem}</span>
                  {status.id === inicial?.id ? (
                    <span className="ml-2 text-meta text-acento">inicial</span>
                  ) : null}
                </Tabela.Celula>
                <Tabela.Celula>
                  {/* o preview usa o MESMO caminho de cor da grade (derivarTonsStatus):
                      pintar o hex cru aqui faria a tela mostrar uma cor e a agenda outra */}
                  <ChipStatus nome={status.nome} cor={status.cor} corBorda={status.cor_borda} tipo={status.tipo} />
                </Tabela.Celula>
                <Tabela.Celula>
                  <span className="text-meta text-texto-suave">
                    {[
                      status.desconta_sessao ? 'consome sessão' : null,
                      status.ocupa_horario ? 'ocupa horário' : 'libera o horário',
                      status.marca_falta ? 'conta como falta' : null,
                      status.marca_reserva ? 'marca reserva' : null,
                      status.em_aberto ? 'em aberto' : null,
                      status.aplicavel_em_lote ? 'opção de baixa em lote' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Tabela.Celula>
                <Tabela.Celula>
                  <div className="flex gap-2">
                    <ProtegidoPorPermissao permissao="status_agendamento.editar">
                      <Botao
                        variante="secundario"
                        tamanho="sm"
                        onClick={() => {
                          abrirFormulario(status)
                        }}
                      >
                        <Pencil aria-hidden="true" className="size-3.5" />
                        Editar
                      </Botao>
                    </ProtegidoPorPermissao>
                    <ProtegidoPorPermissao permissao="status_agendamento.excluir">
                      <Botao
                        variante="perigo-suave"
                        tamanho="sm"
                        onClick={() => {
                          limparErros()
                          setAExcluir(status)
                        }}
                      >
                        <Trash2 aria-hidden="true" className="size-3.5" />
                        Excluir
                      </Botao>
                    </ProtegidoPorPermissao>
                  </div>
                </Tabela.Celula>
              </Tabela.Linha>
            ))}
          </Tabela.Corpo>
        </Tabela>
      </EstadosDaLista>

      {formularioAberto ? (
        <AlertDialog.Root
          open
          onOpenChange={(aberto) => {
            if (!aberto && !salvando) setFormularioAberto(false)
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-(--z-dialogo) max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-janela bg-superficie-elevada p-6 shadow-e3">
              <AlertDialog.Title className="text-titulo font-semibold text-texto">
                {emEdicao === null ? 'Cadastrar status' : `Editar ${emEdicao.nome}`}
              </AlertDialog.Title>
              <AlertDialog.Description className="sr-only">
                As flags deste formulário mudam o comportamento da agenda.
              </AlertDialog.Description>

              <form onSubmit={submeter} className="mt-5 flex flex-col gap-4">
                {/* com o diálogo de regra aberto, a recusa aparece LÁ — dois
                    role="alert" com o mesmo texto fazem o leitor de tela repetir */}
                <AvisoErro mensagens={aConfirmar === null ? erros.gerais : []} />

                <CampoTexto
                  rotulo="Nome"
                  obrigatorio
                  value={valores.nome}
                  onChange={(evento) => {
                    definir({ nome: evento.target.value })
                  }}
                  erro={erros.campos.get('nome')}
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <CampoCor
                    rotulo="Cor"
                    obrigatorio
                    valor={valores.cor}
                    aoMudar={(cor) => {
                      definir({ cor })
                    }}
                    erro={erros.campos.get('cor')}
                  />
                  <CampoSelect
                    rotulo="Ícone"
                    value={valores.tipo}
                    onChange={(evento) => {
                      definir({ tipo: evento.target.value })
                    }}
                    opcoes={ICONES.map((slug) => ({ valor: slug, rotulo: slug }))}
                    erro={erros.campos.get('tipo')}
                  />
                </div>

                <div className="flex items-center gap-3 rounded-superficie border border-linha bg-fundo p-3">
                  <span className="text-meta text-texto-suave">Como aparece na grade:</span>
                  <ChipStatus
                    nome={valores.nome === '' ? 'Status' : valores.nome}
                    cor={valores.cor}
                    corBorda={valores.cor_borda === '' ? null : valores.cor_borda}
                    tipo={valores.tipo === '' ? null : valores.tipo}
                  />
                </div>

                <CampoTexto
                  rotulo="Ordem"
                  obrigatorio
                  type="number"
                  min={0}
                  max={999}
                  value={valores.ordem}
                  onChange={(evento) => {
                    definir({ ordem: evento.target.value })
                  }}
                  ajuda="O menor número é o status inicial — aquele com que todo agendamento nasce."
                  erro={erros.campos.get('ordem')}
                />

                <fieldset className="flex flex-col gap-3 rounded-superficie border border-linha-forte p-4">
                  <legend className="px-1 text-rotulo font-medium text-texto">
                    Regras deste status
                  </legend>

                  <CampoCheckbox
                    rotulo="Consome uma sessão do tratamento"
                    marcado={valores.desconta_sessao}
                    aoMudar={(marcado) => {
                      definir({ desconta_sessao: marcado })
                    }}
                    ajuda="Pôr o agendamento neste status desconta uma sessão do saldo do tratamento."
                  />

                  <CampoCheckbox
                    rotulo="Ocupa o horário"
                    marcado={valores.ocupa_horario}
                    aoMudar={(marcado) => {
                      definir({ ocupa_horario: marcado })
                    }}
                    ajuda="Desmarcado, o horário fica livre para um novo agendamento (é o caso do desmarcado)."
                  />

                  <CampoCheckbox
                    rotulo="Conta como falta"
                    marcado={valores.marca_falta}
                    aoMudar={(marcado) => {
                      definir({ marca_falta: marcado })
                    }}
                    ajuda="Alimenta o alerta de faltas consecutivas do paciente."
                    erro={erros.campos.get('marca_falta')}
                  />

                  <CampoCheckbox
                    rotulo="Marca reserva"
                    marcado={valores.marca_reserva}
                    aoMudar={(marcado) => {
                      definir({ marca_reserva: marcado })
                    }}
                    ajuda="Agendamentos neste status são reserva de horário: só recebem lembrete quando a clínica pede que reservas sejam lembradas."
                    erro={erros.campos.get('marca_reserva')}
                  />

                  {/* as duas regras do lote (change baixa-em-lote-por-status): a consequência em
                      prosa aqui, e o invariante (em aberto × desfecho × opção de baixa) no
                      servidor — a recusa pousa junto da flag em conflito */}
                  <CampoCheckbox
                    rotulo="Em aberto"
                    marcado={valores.em_aberto}
                    aoMudar={(marcado) => {
                      definir({ em_aberto: marcado })
                    }}
                    ajuda="Agendamentos neste status ainda não têm desfecho: são os que entram na baixa em lote da agenda."
                    erro={erros.campos.get('em_aberto')}
                  />

                  <CampoCheckbox
                    rotulo="Pode ser aplicado em lote"
                    marcado={valores.aplicavel_em_lote}
                    aoMudar={(marcado) => {
                      definir({ aplicavel_em_lote: marcado })
                    }}
                    ajuda="Aparece como opção no botão Dar baixa da agenda, para toda a agenda em aberto de um profissional de uma vez."
                    erro={erros.campos.get('aplicavel_em_lote')}
                  />
                </fieldset>

                <div className="mt-2 flex justify-end gap-3">
                  <Botao
                    type="button"
                    variante="secundario"
                    tamanho="lg"
                    disabled={salvando}
                    onClick={() => {
                      setFormularioAberto(false)
                    }}
                  >
                    Cancelar
                  </Botao>
                  <Botao type="submit" tamanho="lg" carregando={salvando}>
                    {emEdicao === null ? 'Cadastrar' : 'Salvar'}
                  </Botao>
                </div>
              </form>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}

      {/* mudança de REGRA: tom `atencao`, e a consequência dita em português de
          balcão — nunca o nome da flag */}
      <DialogConfirmacao
        aberto={aConfirmar !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setAConfirmar(null)
        }}
        titulo={`Mudar a regra de ${valores.nome || 'este status'}?`}
        consequencia={(aConfirmar ?? []).join(' ')}
        rotuloConfirmar="Mudar a regra"
        tom="atencao"
        carregando={salvando}
        erros={errosDaRegra}
        aoConfirmar={() =>
          new Promise<void>((resolver, rejeitar) => {
            const fechar = {
              onSuccess: () => {
                setFormularioAberto(false)
                setAConfirmar(null)
                resolver()
              },
              onError: () => {
                rejeitar(new Error('recusado'))
              },
            }
            if (emEdicao === null) {
              criar.mutate(paraPayload(), fechar)
              return
            }
            atualizar.mutate({ id: emEdicao.id, payload: paraPayload(), versao: emEdicao.updated_at }, fechar)
          })
        }
      />

      <DialogConfirmacao
        aberto={aExcluir !== null}
        aoMudarAberto={(aberto) => {
          if (!aberto) setAExcluir(null)
        }}
        titulo={aExcluir !== null ? `Excluir ${aExcluir.nome}?` : ''}
        consequencia="Status usado por algum agendamento não pode ser excluído — o sistema recusa. E a clínica não pode ficar sem status: sem eles, nenhum agendamento pode ser criado. Se este status for o alvo do encadeamento automático, a automação é DESLIGADA junto."
        rotuloConfirmar="Excluir status"
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
