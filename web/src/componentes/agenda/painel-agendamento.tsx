import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CircleX, Lock, TriangleAlert } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useEffect, useId, useRef, useState, type Ref } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { DialogoFaturarSessao } from '@/componentes/agenda/dialogo-faturar-sessao'
import { DialogoDaTrocaDeStatus } from '@/componentes/agenda/dialogo-troca-de-status'
import { PELE_DA_CONFIRMACAO } from '@/componentes/agenda/pele-da-confirmacao'
import { HistoricoComparecimento } from '@/componentes/agenda/historico-comparecimento'
import { ProximasSessoesDoPaciente } from '@/componentes/agenda/proximas-sessoes-do-paciente'
import { HistoricoDeMovimentacao } from '@/componentes/agenda/historico-movimentacao'
import { MenuDeStatus } from '@/componentes/agenda/menu-de-status'
import { SecaoAtendimento } from '@/componentes/atendimento/secao-atendimento'
import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { Botao } from '@/componentes/ui/botao'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { Dialog } from '@/componentes/ui/dialog'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { ListaDescricao, type ItemDescricao } from '@/componentes/ui/lista-descricao'
import { MarcadorEspecialidade } from '@/componentes/ui/marcador-especialidade'
import { usarToast } from '@/componentes/ui/toast'
import { usarMutacaoDeAgendamento } from '@/hooks/usar-mutacao-de-agendamento'
import { usarTrocaDeStatus, type StatusDaSelecao } from '@/hooks/usar-troca-de-status'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { cartaoNaGrade } from '@/lib/cartao-na-grade'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { descreverConfirmacao } from '@/lib/confirmacao-do-lembrete'
import { rotuloDePeriodo } from '@/lib/convenios'
import { dataComHorarioLegivel } from '@/lib/datas'
import {
  cartaoDepoisDaTroca,
  derivarDoCard,
  nomeCurtoDoAgendamento,
  type RespostaDaTrocaDeStatus,
} from '@/lib/card-agendamento'
import { formatarCpf, ROTULOS_DE_CONTATO, ROTULOS_DE_NECESSIDADE } from '@/lib/pacientes'
import { ErroDeApi } from '@/lib/http'
import { buscarPaciente } from '@/servicos/pacientes'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import {
  abrirConversaDaSessao,
  buscarAgendamento,
  buscarSelecaoDaAgenda,
  buscarTamanhoDaSerie,
  confirmarPelaClinica,
  manterSessao,
} from '@/servicos/agenda'
import { useAuthStore } from '@/stores/auth-store'
import type { CardAgendamento, ConfirmacaoDoCard } from '@/tipos'

interface PainelAgendamentoProps {
  aberto: boolean
  card: CardAgendamento | null
  aoFechar: () => void
  /** "Editar" leva ao FormularioAgendamento (a página o abre). */
  aoEditar: (card: CardAgendamento) => void
  /**
   * "Remarcar para…" — a alternativa por teclado do arrasto (2.5.7, change
   * arrastar-para-remarcar). A página só a passa com a config da clínica ligada
   * + `agenda.editar` (as MESMAS condições do gesto); ausente, o item não existe.
   */
  aoRemarcar?: (card: CardAgendamento) => void
}

const ITEM_MENU =
  'flex w-full cursor-pointer items-center rounded-controle px-2 py-1.5 text-corpo text-texto outline-none data-[highlighted]:bg-acento-suave data-[highlighted]:text-acento'

// Excluir é destrutivo: cor de perigo em vez do acento (sem misturar highlights).
// `perigo-texto` sobre `perigo-suave` é o par documentado do sistema (o mesmo do EstadoErro).
const ITEM_MENU_PERIGO =
  'flex w-full cursor-pointer items-center rounded-controle px-2 py-1.5 text-corpo text-perigo-texto outline-none data-[highlighted]:bg-perigo-suave data-[highlighted]:text-perigo-texto'

// Ação INDISPONÍVEL por falta de pré-requisito (o-sistema-avisa-o-que-falta, D5): ao contrário de um
// item `disabled`, ela recebe foco pelas setas — é o foco que leva quem usa leitor de tela ao motivo.
// O realce do foco é o fundo neutro das peças "desligadas", não o acento de quem age.
const ITEM_MENU_INDISPONIVEL =
  'flex w-full cursor-not-allowed flex-col items-start gap-0.5 rounded-controle px-2 py-1.5 text-corpo text-texto-suave outline-none data-[highlighted]:bg-neutro-100'

/**
 * Por que "Lançar no financeiro" está indisponível sem pacote, e o caminho conforme a permissão: o
 * campo Tratamento do "Editar" vincula o pacote (e, se a criança não tem nenhum, diz onde cadastrar).
 */
function motivoDoFaturarSemPacote(podeEditar: boolean): string {
  const porque = 'Sem pacote vinculado: o valor do lançamento vem do serviço do pacote.'

  return podeEditar
    ? `${porque} Vincule o pacote em Editar, no campo Tratamento.`
    : `${porque} Peça a quem cuida da agenda para vincular o pacote.`
}

/** Por que o "Desmarcar (a família pediu)" abre o menu de status, e onde se configura (D4). */
// neutro de propósito: o servidor manda a flag falsa também quando o status ESCOLHIDO deixou de valer
// (passou a descontar sessão ou a segurar o horário) — "ainda não escolheu" mentiria para o admin (CR-AVI-05)
const SEM_STATUS_DA_FAMILIA =
  'um status válido para o desmarque pela família. Por isso “Desmarcar” abre a lista de status. Fica em Configurações › Comunicação, em “Status aplicado quando a família desmarca”.'

/** Como o pedido da família foi resolvido pelo painel — é o que a linha de resolução diz. */
type PedidoResolvido = 'desmarcada' | 'mantida'

/**
 * A família tocou em "Preciso desmarcar" no lembrete (change lembrete-com-botoes-de-resposta): o
 * pedido em palavras e, para quem pode mudar o status, as duas saídas.
 *
 * - "Desmarcar (a família pediu)" aplica o status do desmarque pela família (o da seleção com
 *   `desmarque_da_familia`) pelo MESMO caminho do chip — leitura fresca, versão, confirmação quando
 *   mexe no saldo —, e nunca manda o aviso de "a clínica cancelou". Sem esse status configurado,
 *   abre o menu de status para a recepção escolher (por isso o `aria-haspopup` nesse caso).
 * - "Manter a sessão (a família desistiu)" é para o toque errado desfeito por telefone (decisão
 *   CRB-08 do gate): a sessão continua marcada e passa a constar como confirmada.
 *
 * Componente próprio para os hooks da troca só existirem no cartão que tem o pedido.
 */
function PedidoDeDesmarqueDaFamilia({
  card,
  podeMudarStatus,
  aoAbrirMenuDeStatus,
  aoResolver,
  destinoDoFoco,
  aoSeguirParaAsConfiguracoes,
}: {
  card: CardAgendamento
  podeMudarStatus: boolean
  /** Abre o menu do chip — `origem` é o botão que o abriu, para onde o foco volta quando ele fecha. */
  aoAbrirMenuDeStatus: (origem: HTMLElement) => void
  aoResolver: (cardAtualizado: CardAgendamento, como: PedidoResolvido) => void
  /** A linha de resolução — o foco vai para ela quando o diálogo de confirmação fecha. */
  destinoDoFoco: () => HTMLElement | null
  /** Quem segue o link do aviso sai da agenda: o painel fecha. */
  aoSeguirParaAsConfiguracoes: () => void
}) {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const idDoMotivo = useId()
  const troca = usarTrocaDeStatus(card, podeMudarStatus)
  const statusDaFamilia = troca.statusDaClinica.find((status) => status.desmarque_da_familia === true)
  // A seleção CHEGOU, conhece a flag e nenhum status a tem: o botão vai abrir o menu de status, e a
  // tela diz por quê (D4). Seleção chegando, que falhou ou sem a flag não afirma nada. É a MESMA
  // consulta da troca de status — o aviso não custa requisição.
  const semStatusDaFamilia =
    troca.selecao.data !== undefined &&
    troca.statusDaClinica.some((status) => status.desmarque_da_familia !== undefined) &&
    statusDaFamilia === undefined

  const manter = useMutation({
    // escrita não se repete sozinha (T-aes-01)
    retry: 0,
    mutationFn: () => manterSessao(card.id),
    onSuccess: async ({ confirmacao }) => {
      aoResolver({ ...card, confirmacao }, 'mantida')
      notificar({ tom: 'sucesso', titulo: 'Sessão mantida: a família desistiu de desmarcar.' })
      // o cartão da grade e o contador "Desmarques" do sino deixam de mostrar o pedido
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chaves.agenda() }),
        queryClient.invalidateQueries({ queryKey: chaves.notificacoes() }),
      ])
    },
    onError: (falha: unknown) => {
      notificar({
        tom: 'erro',
        titulo:
          falha instanceof ErroDeApi
            ? (Object.values(falha.camposInvalidos)[0]?.[0] ?? falha.message)
            : 'Não foi possível manter a sessão. Tente novamente.',
      })
    },
  })

  function desmarcar(origem: HTMLElement): void {
    if (statusDaFamilia === undefined) {
      aoAbrirMenuDeStatus(origem)
      return
    }
    troca.escolher(statusDaFamilia, {
      daFamilia: true,
      aoConcluir: (resposta, alvo) => {
        aoResolver(cartaoDepoisDaTroca(card, resposta, alvo), 'desmarcada')
        // a agenda a mutação já invalida; o sino, não — e é ele que conta o pedido
        void queryClient.invalidateQueries({ queryKey: chaves.notificacoes() })
      },
    })
  }

  /*
   * Enquanto uma das duas saídas grava, as duas ficam INERTES — por `aria-disabled` e pela guarda no
   * clique, nunca por `disabled`/`carregando` (achado A11Y-BT-17 do gate): no navegador, desabilitar
   * o botão com foco o tira dali, e na recusa (422) ou na queda da rede o foco não voltava — a pessoa
   * ficava no `body`, sem saber onde estava. Inerte, o botão segue focável e a recusa, dita no toast,
   * encontra a pessoa no mesmo lugar.
   */
  const ocupado = troca.gravando || manter.isPending

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-campo bg-perigo-suave px-3 py-2">
      <p className="flex items-center gap-2 text-rotulo text-perigo-texto">
        <CircleX aria-hidden className="size-4 shrink-0" />
        A família pediu, pelo lembrete do WhatsApp, para desmarcar esta sessão.
      </p>
      {podeMudarStatus ? (
        <div className="flex flex-wrap gap-2">
          <Botao
            variante="perigo-suave"
            tamanho="sm"
            // sem status configurado, o botão ABRE o menu de status (A11Y-BT-11)
            aria-haspopup={statusDaFamilia === undefined ? 'menu' : undefined}
            // a seleção ainda chegando decidiria "sem status" e abriria o menu por engano — isto é ANTES
            // de qualquer clique, então o `disabled` não tira o foco de ninguém
            disabled={troca.selecao.isPending}
            aria-disabled={ocupado || undefined}
            aria-busy={troca.gravando || undefined}
            // o porquê de abrir um menu em vez de desmarcar mora junto do botão (D4)
            aria-describedby={semStatusDaFamilia ? idDoMotivo : undefined}
            onClick={(evento) => {
              if (!ocupado) {
                desmarcar(evento.currentTarget)
              }
            }}
          >
            Desmarcar (a família pediu)
          </Botao>
          <Botao
            variante="secundario"
            tamanho="sm"
            aria-disabled={ocupado || undefined}
            aria-busy={manter.isPending || undefined}
            onClick={() => {
              if (!ocupado) {
                manter.mutate()
              }
            }}
          >
            Manter a sessão (a família desistiu)
          </Botao>
        </div>
      ) : null}
      {podeMudarStatus && semStatusDaFamilia ? (
        <p id={idDoMotivo} className="text-meta text-texto">
          {/* o mesmo rótulo do aviso do desmarque em lote: sem ele, a frase parecia continuação do pedido da família (DQA-AVI-03) */}
          <strong className="font-semibold">Falta configurar:</strong>{' '}
          <AvisoDePreRequisito
            para={CAMINHOS.configuracoes}
            oQueFalta={SEM_STATUS_DA_FAMILIA}
            aoNavegar={aoSeguirParaAsConfiguracoes}
          />
        </p>
      ) : null}
      <DialogoDaTrocaDeStatus card={card} troca={troca} focoAoFechar={destinoDoFoco} />
    </div>
  )
}

/**
 * A resposta da família ao lembrete, EM PALAVRAS, no painel (achado A11Y-BT-06 do gate): no cartão
 * ela é um ícone com a frase no `title` e no nome acessível, e nem quem usa só o teclado nem o toque
 * do celular veem `title`. O painel diz a mesma frase, da mesma fonte (`descreverConfirmacao`).
 * O pedido de desmarque tem o bloco próprio, acima; os estados sem confirmação ganham, embaixo, o
 * registro pela clínica (`ConfirmacaoDoPainel`).
 */
function LinhaDaConfirmacao({
  confirmacao,
  refDaLinha,
  focavel = false,
}: {
  confirmacao: ConfirmacaoDoCard
  refDaLinha?: Ref<HTMLParagraphElement>
  /** Recebe o foco por programa — quando o botão que estava abaixo dela acabou de sair da tela. */
  focavel?: boolean
}) {
  const pele = PELE_DA_CONFIRMACAO[confirmacao.estado]
  // o não entregue e o não enviado pedem que alguém LIGUE: vão como aviso âmbar, como os outros
  // avisos do painel
  const pedeLigacao = confirmacao.estado === 'nao_entregue' || confirmacao.estado === 'nao_enviado'

  return (
    <p
      ref={refDaLinha}
      tabIndex={focavel ? -1 : undefined}
      className={cn(
        'mt-3 flex items-center gap-2 text-rotulo',
        pedeLigacao ? 'rounded-campo bg-alerta-suave px-3 py-2 text-alerta-texto' : 'text-texto',
      )}
    >
      <pele.icone aria-hidden className={cn('size-4 shrink-0', pedeLigacao ? undefined : pele.corDoIcone)} />
      {descreverConfirmacao(confirmacao)}
    </p>
  )
}

/**
 * A resposta ao lembrete no painel e, quando a família confirmou por telefone ou mensagem, o registro
 * pela clínica (change confirmacao-pela-clinica, D5). Componente próprio para a mutação só existir no
 * cartão que tem lembrete.
 *
 * O botão segue o "Manter a sessão": inerte por `aria-disabled` e pela guarda no clique, nunca por
 * `disabled` (A11Y-BT-17), e a recusa vem no toast com a pessoa ainda no botão. No sucesso o botão
 * SAI da tela — o foco vai à frase, que passa a dizer "Confirmado pela clínica", e não cai no `body`.
 *
 * Quem decide se a ação vale é o servidor (`confirmavel`, gate r1 CR-CC-04): a sessão que já começou
 * não oferece o que ele recusaria. Na recusa, o painel relê a grade (gate r1, A11Y-CC-01): o toast
 * some em segundos, e a tela não pode continuar dizendo "sem resposta" de uma sessão que outra pessoa
 * já confirmou.
 */
function ConfirmacaoDoPainel({
  card,
  confirmacao,
  podeConfirmar,
  aoConfirmar,
  aoSairDaTela,
}: {
  card: CardAgendamento
  confirmacao: ConfirmacaoDoCard
  podeConfirmar: boolean
  aoConfirmar: (cardAtualizado: CardAgendamento) => void
  /**
   * A recusa mostrou que este bloco já não vale (a família pediu para desmarcar, a sessão perdeu o
   * lembrete, ou saiu da grade): o PAI troca o bloco e leva o foco à linha com o motivo (gate r2,
   * CR-CC-11/A11Y-CC-04) — daqui, o foco iria junto com o botão e cairia no contêiner do painel.
   */
  aoSairDaTela: (motivo: string, relido: CardAgendamento | undefined) => void
}) {
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const idDaAjuda = useId()
  const refDaLinha = useRef<HTMLParagraphElement>(null)
  // o botão saiu da tela (confirmou, ou a recusa mostrou que já não vale): o foco vai à frase
  const [focarNaFrase, setFocarNaFrase] = useState(false)

  const confirmar = useMutation({
    // escrita não se repete sozinha (T-aes-01)
    retry: 0,
    mutationFn: () => confirmarPelaClinica(card.id),
    onSuccess: async ({ confirmacao: depois }) => {
      aoConfirmar({ ...card, confirmacao: depois })
      setFocarNaFrase(true)
      notificar({ tom: 'sucesso', titulo: 'Sessão marcada como confirmada.' })
      // o cartão da grade e a faixa do topo passam a contar a sessão como confirmada
      await queryClient.invalidateQueries({ queryKey: chaves.agenda() })
    },
    onError: async (falha: unknown) => {
      const motivo =
        falha instanceof ErroDeApi
          ? (Object.values(falha.camposInvalidos)[0]?.[0] ?? falha.message)
          : 'Não foi possível marcar a sessão como confirmada. Tente novamente.'
      notificar({ tom: 'erro', titulo: motivo })
      // só a RECUSA do servidor diz que a sessão mudou; rede ou servidor fora deixam tudo como está, com
      // o foco no botão, para tentar de novo
      if (!(falha instanceof ErroDeApi) || falha.motivo !== 'invalido') {
        return
      }
      // outra pessoa confirmou, a família tocou, a sessão começou: a grade relida é o estado de agora
      await queryClient.invalidateQueries({ queryKey: chaves.agenda() })
      const relido = cartaoNaGrade(queryClient, card.id)
      const relida = relido?.confirmacao
      if (relido !== undefined && relida != null && relida.estado !== 'pediu_desmarque') {
        // o bloco continua: o foco fica no botão se a ação ainda vale, ou vai à frase se ele saiu
        aoConfirmar(relido)
        if (relida.confirmavel !== true) {
          setFocarNaFrase(true)
        }
        return
      }
      aoSairDaTela(motivo, relido)
    },
  })

  useEffect(() => {
    if (focarNaFrase) {
      refDaLinha.current?.focus()
    }
  }, [focarNaFrase])

  const oferece = podeConfirmar && confirmacao.confirmavel === true

  return (
    <>
      <LinhaDaConfirmacao confirmacao={confirmacao} refDaLinha={refDaLinha} focavel={focarNaFrase} />
      {oferece ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Botao
            variante="secundario"
            tamanho="sm"
            aria-disabled={confirmar.isPending || undefined}
            aria-busy={confirmar.isPending || undefined}
            aria-describedby={idDaAjuda}
            onClick={() => {
              if (!confirmar.isPending) {
                confirmar.mutate()
              }
            }}
          >
            Marcar como confirmada
          </Botao>
          <p id={idDaAjuda} className="text-meta text-texto-suave">
            Use quando a família confirmar por telefone ou mensagem.
          </p>
        </div>
      ) : null}
    </>
  )
}

/** "vence em N dias" com concordância; 0 = hoje (o servidor conta, no fuso da clínica). */
function textoDoPedidoAVencer(dias: number): string {
  if (dias === 0) {
    return 'Pedido médico vence hoje — solicite a renovação.'
  }
  return dias === 1
    ? 'Pedido médico vence em 1 dia.'
    : `Pedido médico vence em ${dias} dias.`
}

/**
 * Painel de LEITURA do agendamento (change detalhe-do-agendamento).
 *
 * Quatro zonas — identidade, detalhes (`<dl>`), atendimento (a `SecaoAtendimento`
 * reusada, que provê a ação primária pelo estado do servidor) e ações (rodapé). O
 * status tem UMA fonte só (`MenuDeStatus`); o contador é "sessões", nunca "Guia"
 * (§14); o nome do paciente é um link DESABILITADO-com-motivo até a ficha (change #2).
 *
 * As ações do `⋮` são DERIVADAS de permissão + estado (Decisão 2b), não uma tela
 * por status: Editar (`agenda.editar`), Histórico (`auditoria.ver`), Excluir
 * (`agenda.excluir`), e os ganchos reservados (financeiro/WhatsApp) sem função morta.
 *
 * O diálogo hospeda uma pilha rasa: Leitura → Histórico de movimentação (sub-view).
 */
export function PainelAgendamento({ aberto, card, aoFechar, aoEditar, aoRemarcar }: PainelAgendamentoProps) {
  // Sem hooks aqui: com o painel fechado (`card` nulo) NADA monta — e a página não
  // precisa prover toast/mutação por um diálogo que não está na tela. Todo o corpo
  // (e seus hooks) vive no interno, que só existe com um card em mãos.
  if (card === null) {
    return null
  }
  return (
    <PainelAgendamentoAberto
      aberto={aberto}
      card={card}
      aoFechar={aoFechar}
      aoEditar={aoEditar}
      aoRemarcar={aoRemarcar}
    />
  )
}

interface PainelAbertoProps {
  aberto: boolean
  card: CardAgendamento
  aoFechar: () => void
  aoEditar: (card: CardAgendamento) => void
  aoRemarcar?: (card: CardAgendamento) => void
}

function PainelAgendamentoAberto({ aberto, card: cardAberto, aoFechar, aoEditar, aoRemarcar }: PainelAbertoProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { notificar } = usarToast()
  /*
   * O painel mostra uma FOTO do cartão tirada ao abrir. Uma troca de status feita AQUI (pelo chip ou
   * pelo pedido da família) devolve o cartão atualizado, e é ele que passa a ser mostrado — antes o
   * chip seguia dizendo o status antigo depois de a recepção mudá-lo (achado A11Y-BT-04 do gate).
   * Vale só para o MESMO agendamento: abrir outro volta à foto nova.
   */
  const [cardDaResposta, setCardDaResposta] = useState<CardAgendamento | null>(null)
  const card = cardDaResposta !== null && cardDaResposta.id === cardAberto.id ? cardDaResposta : cardAberto
  // o pedido da família resolvido por aqui: vira uma linha que recebe o FOCO (o bloco com os
  // botões some, e o foco não pode cair no contêiner do painel)
  const [pedidoResolvido, setPedidoResolvido] = useState<PedidoResolvido | null>(null)
  const refPedidoResolvido = useRef<HTMLParagraphElement>(null)
  // a recusa do "Marcar como confirmada" que tirou o bloco da tela: o motivo vira uma linha que recebe
  // o foco (gate r2, CR-CC-11/A11Y-CC-04 e CR-CC-14/A11Y-CC-05)
  const [recusaDaConfirmacao, setRecusaDaConfirmacao] = useState<string | null>(null)
  const refRecusaDaConfirmacao = useRef<HTMLParagraphElement>(null)
  // quem abriu o menu do chip POR FORA (o "Desmarcar" sem status configurado): o foco volta a ele
  const origemDoMenuDeStatus = useRef<HTMLElement | null>(null)
  // a troca pelo chip resolveu o pedido PASSANDO pelo diálogo: o fechamento dele é o último a mover o
  // foco, e tem de mandá-lo à linha de resolução (A11Y-BT-19) — senão ele vai ao chip, em silêncio
  const focarLinhaAoFecharDialogo = useRef(false)

  /**
   * Uma troca pelo chip do painel: a foto ganha o status novo (`cartaoDepoisDaTroca`). Se ela
   * apagou um pedido de desmarque da família — o menu aberto pelo "Desmarcar", por exemplo —, o
   * bloco com os botões sai da tela, e o foco precisa ir à linha que diz o que aconteceu.
   */
  function aoTrocarPeloChip(resposta: RespostaDaTrocaDeStatus, alvo: StatusDaSelecao, peloDialogo: boolean): void {
    const depois = cartaoDepoisDaTroca(card, resposta, alvo)
    setCardDaResposta(depois)
    if (card.confirmacao?.estado === 'pediu_desmarque' && depois.confirmacao == null) {
      setPedidoResolvido('desmarcada')
      // sem diálogo, o efeito do `pedidoResolvido` basta; com ele, quem manda é o fechamento do diálogo
      focarLinhaAoFecharDialogo.current = peloDialogo
    }
  }

  const podeEditar = useAuthStore((estado) => estado.temPermissao('agenda.editar'))
  const podeVerHistorico = useAuthStore((estado) => estado.temPermissao('auditoria.ver'))
  const podeExcluir = useAuthStore((estado) => estado.temPermissao('agenda.excluir'))
  const podeVerAtendimento = useAuthStore((estado) => estado.temPermissao('atendimentos.ver'))
  const podeVerPaciente = useAuthStore((estado) => estado.temPermissao('pacientes.ver'))
  // Faturar é permissão do DINHEIRO (a mesma da rota), não da agenda: quem só agenda não
  // vê o item, e o servidor continua sendo quem decide se ESTE agendamento é faturável.
  const podeFaturar = useAuthStore((estado) => estado.temPermissao('lancamentos.criar'))
  // Falar com a família é permissão da MENSAGERIA, não da agenda (a mesma da rota): quem não responde
  // conversas não vê o item. `ver` junto, porque é a tela Mensagens que abre
  const podeAvisarNoWhatsApp = useAuthStore(
    (estado) => estado.temPermissao('mensagens.responder') && estado.temPermissao('mensagens.ver'),
  )

  // "Avisar no WhatsApp" (change avisar-no-whatsapp-abre-a-conversa): o servidor acha ou cria a conversa
  // pelo celular de agora no cadastro, e a tela Mensagens abre nela. Nada é enviado daqui
  const abrirConversa = useMutation({
    // escrita (pode criar a conversa) não se repete sozinha (T-aes-01)
    retry: 0,
    mutationFn: () => abrirConversaDaSessao(card.id),
    onError: (falha: unknown) => {
      notificar({
        tom: 'erro',
        titulo:
          falha instanceof ErroDeApi
            ? (Object.values(falha.camposInvalidos)[0]?.[0] ?? falha.message)
            : 'Não foi possível abrir a conversa. Tente novamente.',
      })
    },
  })

  /*
   * CPF e CARTEIRINHA vêm do cadastro, e só para quem tem `pacientes.ver`.
   *
   * O painel abre sob `agenda.ver`, que deliberadamente NÃO inclui `pacientes.ver` — o papel
   * "Prof. e Agenda" da matriz AP-10 nasce sem ela, por decisão do usuário. CPF e carteirinha
   * são documentos de um MENOR: o gatilho `ENUM` registra que o CPF é gated por `pacientes.ver`
   * ("CPF só no recibo"), e a carteirinha é da mesma classe.
   *
   * Entregá-los a todo `agenda.ver` seria a exposição nova que aquele gatilho existe para não
   * deixar acumular em silêncio. Gated, a recepção — que tem `pacientes.ver` — vê os dois; o
   * profissional escopado continua vendo a agenda sem os documentos da criança.
   *
   * `gcTime: 0` porque é chave de DETALHE: a guarda `detalhe-sem-cache` exige, e o motivo é
   * cache quente hidratando formulário de edição sobre dado velho.
   */
  const cadastro = useQuery({
    queryKey: chaves.paciente(card.paciente?.id ?? 0),
    queryFn: () => buscarPaciente(card.paciente?.id as number),
    enabled: podeVerPaciente && card.paciente?.id != null,
    gcTime: 0,
  })

  /*
   * O contato de FALAR — e o TIPO importa, por isso ele é o rótulo.
   *
   * A recepção precisa saber se pode mandar mensagem ou se só resta ligar: um número rotulado
   * "Telefone" e outro rotulado "WhatsApp" mudam o que ela faz em seguida. Rotular tudo de
   * "Telefone" esconderia justamente a informação útil.
   *
   * A ORDEM da preferência é a da ação mais barata primeiro: WhatsApp (a clínica já tem canal,
   * e a mensagem não interrompe ninguém), depois celular, depois fixo. E-mail fica de fora: se
   * a criança está na agenda de hoje, e-mail não é o canal de quem precisa avisar agora.
   */
  const contatos = cadastro.data?.contatos_json ?? []
  const contatoParaFalar =
    (['whatsapp', 'celular', 'telefone'] as const)
      .map((tipo) => contatos.find((contato) => contato.tipo === tipo && contato.valor !== ''))
      .find((contato) => contato !== undefined) ?? null

  const [vista, setVista] = useState<'leitura' | 'historico'>('leitura')
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  // A escolha "só este" × "este e os seguintes" vive AQUI, no momento de excluir.
  // Antes ela morava dentro de "Editar", e o painel mandava a pessoa editar para APAGAR —
  // a recepção da clínica excluiu uma sexta achando que tinha apagado a série de 50.
  const [excluirSerie, setExcluirSerie] = useState(false)
  const [faturando, setFaturando] = useState(false)
  // o menu do chip aberto por fora: o "Desmarcar (a família pediu)" sem status configurado o abre
  const [menuDeStatusAberto, setMenuDeStatusAberto] = useState(false)
  const { excluir, erros, gravando } = usarMutacaoDeAgendamento()

  // Foco declarado na volta do Histórico: o gatilho de origem ("Mais ações").
  // Entrar na sub-view foca a saída ("Voltar", no topo dela) pelo próprio componente.
  const refMaisAcoes = useRef<HTMLButtonElement>(null)
  const vistaAnterior = useRef(vista)

  // Trocar de card volta para a leitura — a sub-view e a confirmação não
  // sobrevivem à troca (o interno permanece montado ao trocar de card).
  useEffect(() => {
    setVista('leitura')
    setConfirmandoExclusao(false)
    setMenuDeStatusAberto(false)
    setPedidoResolvido(null)
    setRecusaDaConfirmacao(null)
  }, [card.id])

  // resolvido o pedido, o foco vai à linha que diz como — o bloco com os botões saiu da tela
  useEffect(() => {
    if (pedidoResolvido !== null) {
      refPedidoResolvido.current?.focus()
    }
  }, [pedidoResolvido])

  // a recusa trocou o bloco da confirmação: o foco vai à linha que diz por quê
  useEffect(() => {
    if (recusaDaConfirmacao !== null) {
      refRecusaDaConfirmacao.current?.focus()
    }
  }, [recusaDaConfirmacao])

  // Voltar do Histórico devolve o foco à ação de origem (WCAG 2.4.3). O `Dialog`
  // NÃO remonta na troca de vista (mesmo elemento-raiz), então `onOpenAutoFocus` não
  // dispara aqui e não briga com este foco.
  useEffect(() => {
    if (vistaAnterior.current === 'historico' && vista === 'leitura') {
      refMaisAcoes.current?.focus()
    }
    vistaAnterior.current = vista
  }, [vista])

  // Alcance REAL da série (a tela NÃO conta irmãos — D9): entra na confirmação da
  // exclusão. `gcTime: 0` porque um número velho de cache confirmaria a destruição
  // de crianças sobre um total que já não é verdade (mesmo motivo do formulário).
  const serie = useQuery({
    queryKey: chaves.serieDoAgendamento(card.id),
    queryFn: () => buscarTamanhoDaSerie(card.id),
    enabled: aberto && podeExcluir,
    gcTime: 0,
  })

  // As flags do status (DADO, §13) chegam pela seleção. Só é buscada quando a
  // seção de atendimento REALMENTE renderiza (`atendimentos.ver`) — senão a
  // derivação de `marca_falta` não teria efeito e a chamada seria desperdício.
  const selecao = useQuery({
    queryKey: chaves.selecaoDaAgenda(),
    queryFn: buscarSelecaoDaAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: aberto && podeVerAtendimento,
  })

  // A `obs` (nota de recepção — "trazer exames") é detail-only: o card da grade a
  // omite, o detalhe (`show`, sob `agenda.ver`) a traz. Sob demanda, no painel.
  const detalhe = useQuery({
    queryKey: chaves.agendamentoDetalhe(card.id),
    queryFn: () => buscarAgendamento(card.id),
    enabled: aberto,
  })

  const ehHistorico = vista === 'historico'

  // ── Leitura ──
  // a MESMA regra do card, da fonte única — incluindo `realizadas`, que estava recalculado
  // aqui à mão ao lado da fonte que já o devolve. Numa change cujo tema é "cópia de regra é
  // onde as telas começam a discordar", era a cópia sobrevivente (achado do gate).
  const { realizadas, realce } = derivarDoCard(card)

  // Necessidade especial é dado do PACIENTE, não um status → MARCADOR de leitura,
  // nunca checkbox (Decisão 2b). Vem do `show` (sob demanda, `agenda.ver`), MINIMIZADO
  // a um booleano (`necessidade_especial`) — nunca do card da grade, que não o carrega
  // (art. 11). Enquanto o `show` carrega, ou se vier false/null, o slot não renderiza
  // — como a recorrência do bloqueio (Decisão 6).
  const necessidadeEspecial = detalhe.data?.necessidade_especial === true

  // Produção em período fechado (SEC-TS) — vem do MESMO `show` (detail-only, SEC-FC-09).
  // Congela SÓ a troca de status: o chip permanece (leitura), a afordância some e a
  // linha abaixo explica; os demais campos seguem a régua existente (editar continua).
  const emCicloFechado = detalhe.data?.em_ciclo_fechado === true
  // a MESMA régua do chip: quem pode mudar o status pelo menu pode resolver o pedido da família
  const podeMudarStatus = podeEditar && !emCicloFechado

  // Ação primária DERIVADA da flag do status (Decisão 2b): um status que marca falta
  // não oferece "Iniciar atendimento". Seleção ainda carregando ⇒ não marca falta
  // (fail-safe: o servidor recusa registro inválido de qualquer forma).
  const statusMarcaFalta =
    selecao.data?.status.find((item) => item.id === card.status_id)?.marca_falta ?? false

  // Nota de recepção do agendamento (logística, não a nota clínica da sessão — essa vive
  // na SecaoAtendimento, sob demanda auditada). Some quando vazia.
  const observacao = detalhe.data?.obs?.trim()

  // Faltas consecutivas: o SERVIDOR decide o disparo (N é DADO da clínica, §13). A tela
  // NÃO conta a sequência — só mostra o banner quando o detalhe traz o alerta.
  const alertaFaltas = detalhe.data?.alerta_faltas ?? null

  // Pedido médico e limite do convênio (limites-e-pedidos): os dois sinais são
  // DECIDIDOS no servidor e vêm SÓ no `show` (SEC-LP-03) — o card da grade não os
  // carrega, e a tela nunca conta sessões nem compara datas.
  const alertaPedido = detalhe.data?.alerta_pedido ?? null
  const alertaLimite = detalhe.data?.alerta_limite ?? null

  const detalhes: ItemDescricao[] = [
    // início E término (change horario-de-termino-no-card): "15/10/2026, das 08:40 às 09:20 · 40 min"
    { rotulo: 'Quando', valor: `${dataComHorarioLegivel(card.inicio, card.fim)} · ${card.duracao_minutos} min` },
    ...(card.profissional !== null ? [{ rotulo: 'Profissional', valor: card.profissional.nome }] : []),
    ...(card.especialidade !== null
      ? [
          {
            rotulo: 'Serviço',
            valor: (
              <span className="inline-flex items-center gap-2">
                <MarcadorEspecialidade cor={card.especialidade.cor} />
                {card.especialidade.nome}
              </span>
            ),
          },
        ]
      : []),
    // Convênio é dado DESTE sistema; "Particular" é a flag do cadastro, nunca o nome (§14).
    ...(card.convenio !== null
      ? [{ rotulo: 'Convênio', valor: card.convenio.particular ? 'Particular' : card.convenio.nome }]
      : []),
    ...(card.sala !== null ? [{ rotulo: 'Sala', valor: card.sala.nome }] : []),
    // os documentos por último: quem abre o painel quer saber QUANDO e COM QUEM antes de
    // qualquer número. Só aparecem quando existem — e só para quem pode vê-los.
    ...(cadastro.data?.cpf != null && cadastro.data.cpf !== ''
      ? [{ rotulo: 'CPF', valor: formatarCpf(cadastro.data.cpf) }]
      : []),
    ...(cadastro.data?.carteirinha != null && cadastro.data.carteirinha !== ''
      ? [{ rotulo: 'Carteirinha', valor: cadastro.data.carteirinha }]
      : []),
    ...(contatoParaFalar !== undefined && contatoParaFalar !== null
      ? [{ rotulo: ROTULOS_DE_CONTATO[contatoParaFalar.tipo], valor: contatoParaFalar.valor }]
      : []),
  ]

  // "Lançar no financeiro" só faz sentido num ATENDIMENTO com criança e pacote — bloqueio
  // não fatura; sem tratamento não há serviço para precificar (e o servidor diria o mesmo).
  const ofereceFaturar = podeFaturar && card.paciente_id !== null && card.tratamento_id !== null
  // Com criança e SEM pacote, a ação não some mais: fica no menu, indisponível, dizendo o que falta
  // (o-sistema-avisa-o-que-falta, D5). Sem a permissão de faturar, continua não existindo.
  const faturarSemPacote = podeFaturar && card.paciente_id !== null && card.tratamento_id === null
  const ofereceWhatsApp = podeAvisarNoWhatsApp && card.paciente_id !== null
  const temAcoesDeBaixo = ofereceFaturar || faturarSemPacote || ofereceWhatsApp
  const temMenuDeAcoes = podeEditar || podeVerHistorico || podeExcluir || temAcoesDeBaixo
  const idDoRotuloDoFaturar = useId()
  const idDoMotivoDoFaturar = useId()

  // A consequência é VERDADEIRA — o número vem do servidor (D9). Excluir aqui é a
  // ação MAIS ESTREITA (só este; §4.4): a série inteira sai por "Editar". Se a
  // série ainda não carregou, cai no texto sem contexto de série (fail-safe).
  const emSerie = serie.data?.em_serie === true
  const alcanceDaSerie = serie.data?.futuros ?? 0
  const nomeDoAlvo = card.paciente?.nome_social ?? card.paciente?.nome ?? 'este horário'
  const quando = `${card.inicio.slice(8, 10)}/${card.inicio.slice(5, 7)} às ${card.inicio.slice(11, 16)}`
  const totalDaSerie = serie.data?.a_partir_deste ?? 0
  const consequenciaDaExclusao = (() => {
    if (!emSerie) {
      return `O agendamento de ${quando} será excluído. Esta ação não pode ser desfeita.`
    }
    if (excluirSerie) {
      return `Este agendamento (${quando}) e os seguintes da série serão excluídos — ${totalDaSerie} no total, inclusive os que estão fora do período que você está vendo. Os anteriores permanecem. Esta ação não pode ser desfeita.`
    }

    return `Só o agendamento de ${quando} será excluído; os outros ${alcanceDaSerie} da série permanecem. Esta ação não pode ser desfeita.`
  })()

  function confirmarExclusao() {
    // Promessa que REJEITA na recusa: sem isso o diálogo fecharia como se a
    // exclusão tivesse dado certo. A recusa do servidor (sessão consumida,
    // atendimento registrado) já aparece DENTRO do diálogo por `erros.gerais`.
    return new Promise<void>((resolver, rejeitar) => {
      excluir.mutate(
        { id: card.id, aplicarNaSerie: excluirSerie },
        {
          onSuccess: () => {
            setConfirmandoExclusao(false)
            aoFechar()
            resolver()
          },
          onError: () => {
            rejeitar(new Error('recusado'))
          },
        },
      )
    })
  }

  return (
    <>
      {/* UM Dialog só — título/rodapé/corpo trocam por vista. NÃO remontar entre
          leitura↔histórico é o que evita a briga de foco (ALTO-1): o `Dialog`
          permanece montado, `onOpenAutoFocus` dispara uma vez (na abertura). */}
      <Dialog
        aberto={aberto}
        aoMudarAberto={(estaAberto) => {
          if (!estaAberto) {
            aoFechar()
          }
        }}
        titulo={ehHistorico ? 'Histórico de movimentação' : 'Detalhes do agendamento'}
        rodape={
          ehHistorico || !temMenuDeAcoes ? undefined : (
            <div className="flex justify-end">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Botao ref={refMaisAcoes} variante="secundario">
                    Mais ações
                  </Botao>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={4}
                    className="z-(--z-menu) min-w-56 rounded-campo border border-linha-forte bg-superficie-elevada p-1 shadow-e2"
                  >
                    {podeEditar ? (
                      <DropdownMenu.Item
                        className={ITEM_MENU}
                        onSelect={() => {
                          aoEditar(card)
                        }}
                      >
                        Editar
                      </DropdownMenu.Item>
                    ) : null}
                    {/* mesma função do arrasto, por teclado (2.5.7): entra no modo
                        de escolha de destino na grade — a página fecha o painel */}
                    {podeEditar && aoRemarcar !== undefined ? (
                      <DropdownMenu.Item
                        className={ITEM_MENU}
                        onSelect={() => {
                          aoRemarcar(card)
                        }}
                      >
                        Remarcar para…
                      </DropdownMenu.Item>
                    ) : null}
                    {podeVerHistorico ? (
                      <DropdownMenu.Item
                        className={ITEM_MENU}
                        onSelect={() => {
                          setVista('historico')
                        }}
                      >
                        Histórico de movimentação
                      </DropdownMenu.Item>
                    ) : null}
                    {podeExcluir ? (
                      <DropdownMenu.Item
                        className={ITEM_MENU_PERIGO}
                        onSelect={() => {
                          setConfirmandoExclusao(true)
                        }}
                      >
                        Excluir
                      </DropdownMenu.Item>
                    ) : null}

                    {/* a linha separa os dois grupos; sozinha, sem item abaixo ou acima, seria só um traço */}
                    {temAcoesDeBaixo && (podeEditar || podeVerHistorico || podeExcluir) ? (
                      <DropdownMenu.Separator className="my-1 h-px bg-linha" />
                    ) : null}
                    {/* O gancho do financeiro virou ação (change faturar-pelo-painel-da-agenda):
                        abre o diálogo que chama a rota de faturamento — o preço e a
                        elegibilidade são do servidor, a tela só repete o veredito. */}
                    {ofereceFaturar ? (
                      <DropdownMenu.Item
                        className={ITEM_MENU}
                        onSelect={() => {
                          setFaturando(true)
                        }}
                      >
                        Lançar no financeiro
                      </DropdownMenu.Item>
                    ) : null}
                    {/* Indisponível COM motivo (D5): `aria-disabled`, nunca `disabled` — o Radix tira
                        o item `disabled` das setas, e o motivo sumiria junto. Escolher não faz nada e
                        o menu continua aberto; o nome é só o rótulo, e o motivo é a descrição. */}
                    {faturarSemPacote ? (
                      <DropdownMenu.Item
                        className={ITEM_MENU_INDISPONIVEL}
                        aria-disabled="true"
                        aria-labelledby={idDoRotuloDoFaturar}
                        aria-describedby={idDoMotivoDoFaturar}
                        textValue="Lançar no financeiro"
                        onSelect={(evento) => {
                          evento.preventDefault()
                        }}
                      >
                        <span id={idDoRotuloDoFaturar}>Lançar no financeiro</span>
                        {/* `max-w-64`: o menu mede a largura pelo item mais largo, e a frase inteira
                            numa linha só o estouraria no celular */}
                        <span id={idDoMotivoDoFaturar} className="max-w-64 text-meta">
                          {motivoDoFaturarSemPacote(podeEditar)}
                        </span>
                      </DropdownMenu.Item>
                    ) : null}
                    {/* O gancho virou atalho (change avisar-no-whatsapp-abre-a-conversa): abre a conversa
                        da família na tela Mensagens. Sem criança, ou sem a permissão, não há item. */}
                    {ofereceWhatsApp ? (
                      <DropdownMenu.Item
                        className={ITEM_MENU}
                        onSelect={() => {
                          if (!abrirConversa.isPending) {
                            // o `onSuccess` vai na CHAMADA, não nas opções (gate r1, CR-WA-08): o da
                            // chamada não roda se o painel fechar antes da resposta — quem fechou não é
                            // levado a Mensagens sem querer
                            abrirConversa.mutate(undefined, {
                              onSuccess: ({ conversa_id }) => {
                                navigate(`/mensagens?conversa=${conversa_id}`)
                              },
                            })
                          }
                        }}
                      >
                        Avisar no WhatsApp
                      </DropdownMenu.Item>
                    ) : null}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          )
        }
      >
        {ehHistorico ? (
          <HistoricoDeMovimentacao
            agendamentoId={card.id}
            aoVoltar={() => {
              setVista('leitura')
            }}
          />
        ) : (
          <>
            {/* Zona 1 — identidade */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {/* O nome LEVA à ficha do paciente (change ficha-do-paciente, Decisão 7 da #1
                    acesa): link só quando há paciente e `pacientes.ver`; senão, texto — nunca
                    um link morto (bloqueio sem paciente, ou sem a permissão). */}
                {card.paciente_id !== null && podeVerPaciente ? (
                  <Link
                    to={`/pacientes/${card.paciente_id}`}
                    className="rounded-controle text-subtitulo font-semibold text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                  >
                    {card.paciente?.nome_social ?? card.paciente?.nome ?? 'Sem paciente'}
                  </Link>
                ) : (
                  <span className="text-subtitulo font-semibold text-texto">
                    {card.paciente?.nome_social ?? card.paciente?.nome ?? 'Sem paciente'}
                  </span>
                )}
                {realizadas !== null ? (
                  <p className="mt-0.5 text-meta text-texto-suave">
                    {realizadas}/{card.tratamento_total} sessões
                  </p>
                ) : null}
                {/* MARCADOR de leitura, não checkbox de status (Decisão 2b) */}
                {necessidadeEspecial ? (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-pilula bg-neutro-100 px-2.5 py-0.5 text-meta font-medium text-texto-suave">
                    <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                    {ROTULOS_DE_NECESSIDADE.necessidades_especiais}
                  </p>
                ) : null}
              </div>
              <MenuDeStatus
                card={card}
                podeEditar={podeMudarStatus}
                menuAberto={menuDeStatusAberto}
                aoMudarMenuAberto={setMenuDeStatusAberto}
                aoConcluirTroca={aoTrocarPeloChip}
                focoAoFecharDialogo={() => {
                  if (!focarLinhaAoFecharDialogo.current) {
                    return null
                  }
                  focarLinhaAoFecharDialogo.current = false
                  const linha = refPedidoResolvido.current
                  return linha !== null && linha.isConnected ? linha : null
                }}
                focoAoFecharMenu={() => {
                  const origem = origemDoMenuDeStatus.current
                  origemDoMenuDeStatus.current = null
                  return origem !== null && origem.isConnected ? origem : null
                }}
              />
            </div>

            {/* A resposta da família ao lembrete vem PRIMEIRO entre os avisos: o pedido de desmarque
                é o único que pede uma decisão da recepção agora, e as saídas estão nele. */}
            {/* resolvido o pedido que causou a recusa, a linha de resolução é a que vale (gate r3, CR-CC-16) */}
            {recusaDaConfirmacao !== null && pedidoResolvido === null ? (
              <p
                ref={refRecusaDaConfirmacao}
                tabIndex={-1}
                className="mt-3 flex items-center gap-2 rounded-campo bg-neutro-100 px-3 py-2 text-rotulo text-texto"
              >
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-alerta-texto" />
                {`Não foi possível marcar como confirmada: ${recusaDaConfirmacao}`}
              </p>
            ) : null}
            {pedidoResolvido !== null ? (
              <p
                ref={refPedidoResolvido}
                tabIndex={-1}
                className="mt-3 flex items-center gap-2 rounded-campo bg-neutro-100 px-3 py-2 text-rotulo text-texto"
              >
                <CircleCheck aria-hidden className="size-4 shrink-0 text-sucesso-texto" />
                {pedidoResolvido === 'desmarcada'
                  ? 'Pedido da família resolvido: sessão desmarcada.'
                  : 'Pedido da família resolvido: a sessão continua marcada, como confirmada.'}
              </p>
            ) : card.confirmacao?.estado === 'pediu_desmarque' && card.status !== null ? (
              <PedidoDeDesmarqueDaFamilia
                key={card.id}
                card={card}
                podeMudarStatus={podeMudarStatus}
                aoAbrirMenuDeStatus={(origem) => {
                  origemDoMenuDeStatus.current = origem
                  setMenuDeStatusAberto(true)
                }}
                aoResolver={(cardAtualizado, como) => {
                  setCardDaResposta(cardAtualizado)
                  setPedidoResolvido(como)
                }}
                destinoDoFoco={() => refPedidoResolvido.current}
                aoSeguirParaAsConfiguracoes={aoFechar}
              />
            ) : card.confirmacao != null && recusaDaConfirmacao === null ? (
              <ConfirmacaoDoPainel
                key={card.id}
                card={card}
                confirmacao={card.confirmacao}
                podeConfirmar={podeMudarStatus}
                aoConfirmar={setCardDaResposta}
                aoSairDaTela={(motivo, relido) => {
                  if (relido !== undefined) {
                    setCardDaResposta(relido)
                  }
                  setRecusaDaConfirmacao(motivo)
                }}
              />
            ) : null}

            {emCicloFechado ? (
              <p
                role="status"
                className="mt-3 flex items-center gap-2 rounded-campo bg-neutro-100 px-3 py-2 text-rotulo text-texto-suave"
              >
                <Lock aria-hidden className="size-3.5 shrink-0" />
                Status protegido: a produção deste período já foi fechada — a reabertura é do
                administrador.
              </p>
            ) : null}

            {/*
              PERIGO só nesta faixa (D3). As de faltas e de período fechado seguem em ÂMBAR: se
              tudo virasse vermelho, nada seria urgente. O que sobe de tom é o que custa
              DINHEIRO à clínica quando passa batido.
            */}
            {realce !== 'nenhum' ? (
              <p
                role="status"
                className={cn(
                  'mt-3 flex items-center gap-2 rounded-campo px-3 py-2 text-rotulo',
                  // a MESMA escada do card: âmbar avisa, vermelho bloqueia
                  realce === 'sem-saldo'
                    ? 'bg-perigo-suave text-perigo-texto'
                    : 'bg-alerta-suave text-alerta-texto',
                )}
              >
                <TriangleAlert aria-hidden className="size-4 shrink-0" />
                {card.tratamento_saldo === 0
                  ? 'Sem saldo de sessões no tratamento.'
                  : `Faltam ${card.tratamento_saldo} sessões no tratamento.`}
              </p>
            ) : null}

            {/* Alerta de faltas consecutivas — o servidor já decidiu o disparo (N da clínica). */}
            {alertaFaltas !== null ? (
              <p
                role="status"
                className="mt-3 flex items-center gap-2 rounded-campo bg-alerta-suave px-3 py-2 text-rotulo text-alerta-texto"
              >
                <TriangleAlert aria-hidden className="size-4 shrink-0" />
                {/* N é DADO da clínica e o mínimo é 1 (§13) — concorda no singular. */}
                {alertaFaltas.consecutivas === 1
                  ? '1 falta consecutiva — atenção ao acompanhamento.'
                  : `${alertaFaltas.consecutivas} faltas consecutivas — atenção ao acompanhamento.`}
              </p>
            ) : null}

            {/* Pedido médico VENCIDO (limites-e-pedidos): perigo — atender sem pedido válido
                é atendimento que não fatura. Ícone + texto, cor nunca como canal único (1.4.1).
                "Pedido médico", nunca guia/TISS (§14, SEC-LP-13). */}
            {alertaPedido !== null && alertaPedido.vencido ? (
              <p
                role="status"
                className="mt-3 flex items-center gap-2 rounded-campo bg-perigo-suave px-3 py-2 text-rotulo text-perigo-texto"
              >
                <TriangleAlert aria-hidden className="size-4 shrink-0" />
                Pedido médico vencido — solicite a renovação.
              </p>
            ) : null}

            {/* Pedido a VENCER: alerta com os dias que o SERVIDOR contou (antecedência §13). */}
            {alertaPedido !== null && !alertaPedido.vencido && alertaPedido.vence_em_dias !== null ? (
              <p
                role="status"
                className="mt-3 flex items-center gap-2 rounded-campo bg-alerta-suave px-3 py-2 text-rotulo text-alerta-texto"
              >
                <TriangleAlert aria-hidden className="size-4 shrink-0" />
                {textoDoPedidoAVencer(alertaPedido.vence_em_dias)}
              </p>
            ) : null}

            {/* Limite do convênio atingido (regra `avisar`, D3) — minimizado a limite +
                período + convênio (SEC-LP-01): nunca a contagem nem as demais sessões. */}
            {alertaLimite !== null ? (
              <p
                role="status"
                className="mt-3 flex items-center gap-2 rounded-campo bg-alerta-suave px-3 py-2 text-rotulo text-alerta-texto"
              >
                <TriangleAlert aria-hidden className="size-4 shrink-0" />
                {`Limite do convênio atingido: ${alertaLimite.limite} por ${rotuloDePeriodo(alertaLimite.periodo)} — ${alertaLimite.convenio}.`}
              </p>
            ) : null}

            {/* Zona 2 — detalhes só-leitura */}
            <ListaDescricao itens={detalhes} className="mt-5" />

            {/* Observação de recepção (some quando vazia — nunca um rótulo vazio) */}
            {observacao !== undefined && observacao !== '' ? (
              <div className="mt-4">
                <p className="text-rotulo text-texto-suave">Observação</p>
                <p className="mt-0.5 whitespace-pre-wrap text-corpo text-texto">{observacao}</p>
              </div>
            ) : null}

            {/* As próximas sessões da criança, cada uma com o próprio horário (change
                horario-de-termino-no-card): o card diz só o daquele dia. Nasce aberto. */}
            {card.paciente_id !== null ? (
              <ProximasSessoesDoPaciente
                pacienteId={card.paciente_id}
                agendamentoId={card.id}
                inicioDoAberto={card.inicio}
              />
            ) : null}

            {/* Comparecimento recente (90 dias) — acordeão sob demanda; só há paciente
                em agendamento (bloqueio não tem criança). */}
            {card.paciente_id !== null ? <HistoricoComparecimento pacienteId={card.paciente_id} /> : null}

            {/* Zona 3 — atendimento: a SecaoAtendimento provê a ação primária pelo estado do
                servidor; `permiteRegistrar` a deriva da flag `marca_falta` do status (Decisão 2b) */}
            <SecaoAtendimento
              agendamentoId={card.id}
              nomeDaCrianca={nomeCurtoDoAgendamento(card)}
              profissionalId={card.profissional_id}
              permiteRegistrar={!statusMarcaFalta}
              statusDaSelecao={selecao.data?.status}
              statusAtualId={card.status_id}
              pacoteSemSaldo={card.tratamento_id !== null && (card.tratamento_saldo ?? 1) <= 0}
              // a evolução finalizou a sessão: a foto vira o cartão da grade recém-relida, com status e
              // saldo novos (gate CR-EVO-03). Nunca o detalhe: ele não tem as relações do cartão (R2-01)
              aoFinalizar={() => {
                const relido = cartaoNaGrade(queryClient, card.id)
                if (relido !== undefined) {
                  setCardDaResposta(relido)
                }
              }}
            />
          </>
        )}
      </Dialog>

      {/* A consequência NOMEIA o alvo e traz o número da série do SERVIDOR (D9) —
          contar irmãos pela grade diria "0 seguintes" enquanto a API apagaria a série. */}
      <DialogConfirmacao
        aberto={confirmandoExclusao}
        aoMudarAberto={(estado) => {
          // fechar zera a escolha: reabrir o diálogo não pode herdar o "série" de antes
          setConfirmandoExclusao(estado)
          if (!estado) {
            setExcluirSerie(false)
          }
        }}
        titulo={`Excluir o agendamento de ${nomeDoAlvo}?`}
        consequencia={consequenciaDaExclusao}
        rotuloConfirmar="Excluir agendamento"
        tom="perigo"
        carregando={gravando}
        erros={erros.gerais}
        aoConfirmar={confirmarExclusao}
      >
        {emSerie ? (
          <CampoCheckbox
            rotulo="Excluir também os seguintes da série"
            marcado={excluirSerie}
            aoMudar={setExcluirSerie}
          />
        ) : null}
      </DialogConfirmacao>

      {ofereceFaturar ? (
        <DialogoFaturarSessao
          aberto={faturando}
          card={card}
          aoFechar={() => {
            setFaturando(false)
          }}
        />
      ) : null}
    </>
  )
}
