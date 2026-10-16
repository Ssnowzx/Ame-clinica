import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CakeSlice,
  CircleCheck,
  CalendarX,
  CircleAlert,
  CircleX,
  FileClock,
  FileWarning,
  Inbox,
  ListTodo,
  Megaphone,
  MessageSquare,
  PackageOpen,
  TriangleAlert,
  UserMinus,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Popover } from '@/componentes/ui/popover'
import { usarToast } from '@/componentes/ui/toast'
import { saldoRestanteEmPalavras } from '@/lib/saldo-de-pacote'
import { chaves } from '@/lib/chaves-query'
import { cn } from '@/lib/cn'
import { dataHoraLegivel, dataLegivel, periodoEmPalavras } from '@/lib/datas'
import { formatarBRL } from '@/lib/dinheiro'
import { ROTULO_DA_COLUNA } from '@/lib/quadro-de-tarefas'
import { TEMPO_AGENDA_MS, TEMPO_SINO_MS } from '@/lib/query-client'
import { buscarNotificacoes } from '@/servicos/catalogos'
import { lerTodosEventos } from '@/servicos/tarefas'
import { useAuthStore } from '@/stores/auth-store'
import type { BlocoEvolucoesEmAberto, EventoDoMural, ItemPedidoMedico, Notificacoes } from '@/tipos'

/** O que os renderizadores dos painéis precisam saber além dos itens. */
interface ContextoDoPainel {
  /** Fecha o painel — TODA navegação chama (o `Link` não fecha o Popover sozinho). */
  fechar: () => void
  /**
   * Permissões das ROTAS de destino. O painel as CONSULTA — não confia em a API ter
   * mandado o bloco (gate SEC F-02): a permissão do bloco e a do destino podem diferir
   * (faltas vêm com `agenda.ver`; a ficha exige `pacientes.ver`), e link que promete o
   * que o servidor nega é promessa vazia.
   */
  podeVerFicha: boolean
  podeAbrirFinanceiro: boolean
}

type ChaveComPainel = Exclude<
  keyof Notificacoes,
  'evolucoes_em_aberto' | 'pendencias_de_retorno' | 'tarefas' | 'mensagens'
>

// Rótulo e ícone por bloco. A API OMITE o bloco quando falta a permissão do
// módulo dono — ausência não é contagem: nada é renderizado (nem "0").
// Evoluções é LINK direto para a fila (é o número que mais pede ação — cada
// unidade é uma sessão que aconteceu com uma criança e não foi registrada; um
// painel no caminho seria um clique a mais). Os demais abrem PAINEL com os
// itens que a API já manda.
const BLOCOS: ReadonlyArray<
  | {
      chave: 'evolucoes_em_aberto' | 'pendencias_de_retorno' | 'tarefas' | 'mensagens'
      rotulo: string
      rotuloCurto: string
      icone: LucideIcon
      destino: string
      permissaoDoDestino: string
    }
  | { chave: ChaveComPainel; rotulo: string; rotuloCurto: string; icone: LucideIcon; destino?: undefined }
> = [
  {
    chave: 'evolucoes_em_aberto',
    rotulo: 'Evoluções em aberto',
    rotuloCurto: 'Evoluções',
    icone: FileClock,
    destino: '/evolucoes',
    permissaoDoDestino: 'evolucoes.ver',
  },
  // pendências de RETORNO (protocolo-de-pendencias): como evoluções, é LINK direto — a
  // lista existe para ser TRABALHADA (ligar para a família e marcar), e o teto de 50 do
  // centro não a comporta. O destino é a mesma `agenda.ver` que trouxe o bloco.
  {
    chave: 'pendencias_de_retorno',
    rotulo: 'Pendências de retorno',
    rotuloCurto: 'Retornos',
    icone: CalendarX,
    destino: '/pendencias',
    permissaoDoDestino: 'agenda.ver',
  },
  // mural de tarefas: era LINK direto (kanban-da-equipe); com os eventos
  // (alertas-do-mural) virou PAINEL de novidades — a porta para o mural fica no
  // rodapé, e cada novidade aponta para a SUA tarefa (?tarefa=<id>)
  {
    chave: 'tarefas',
    rotulo: 'Tarefas da equipe',
    rotuloCurto: 'Tarefas',
    icone: ListTodo,
    destino: '/tarefas',
    permissaoDoDestino: 'tarefas.ver',
  },
  // conversas de WhatsApp esperando resposta (mensageria-whatsapp): LINK direto, como
  // evoluções — a lista existe para ser TRABALHADA (abrir e responder), e o item aponta
  // para a SUA conversa (?conversa=<id>)
  {
    chave: 'mensagens',
    rotulo: 'Conversas não lidas',
    rotuloCurto: 'Mensagens',
    icone: MessageSquare,
    destino: '/mensagens',
    permissaoDoDestino: 'mensagens.ver',
  },
  { chave: 'aniversariantes', rotulo: 'Aniversariantes', rotuloCurto: 'Aniversários', icone: CakeSlice },
  { chave: 'termos_pendentes', rotulo: 'Termos pendentes', rotuloCurto: 'Termos', icone: CircleAlert },
  { chave: 'lancamentos_em_atraso', rotulo: 'Lançamentos em atraso', rotuloCurto: 'Atrasos', icone: FileClock },
  { chave: 'faltas_consecutivas', rotulo: 'Faltas consecutivas', rotuloCurto: 'Faltas', icone: UserMinus },
  // a família tocou em "Preciso desmarcar" no lembrete e a recepção ainda não resolveu
  // (lembrete-com-botoes-de-resposta) — PAINEL por dia, cada dia levando à agenda daquele dia.
  // O ícone é o MESMO do cartão que pediu: quem vê um e outro está vendo o mesmo fato
  { chave: 'pedidos_de_desmarque', rotulo: 'Pediram para desmarcar', rotuloCurto: 'Desmarques', icone: CircleX },
  // pedidos médicos vencidos/a vencer (limites-e-pedidos) — só chega sob `tratamentos.ver`
  { chave: 'pedidos_medicos', rotulo: 'Pedidos médicos', rotuloCurto: 'Pedidos', icone: FileWarning },
  // pacotes no FIM (alerta-de-fim-de-pacote) — PAINEL, não link direto: o realce vermelho no
  // card só é visto por quem está olhando aquele card naquele dia, e quem não abre a agenda
  // daquela criança não via nada. O painel dá a fila; o rodapé leva à lista para trabalhá-la.
  { chave: 'pacotes_acabando', rotulo: 'Pacotes acabando', rotuloCurto: 'Pacotes', icone: PackageOpen },
  // cadastros enviados pelas famílias pelo link (cadastro-online-do-paciente): sem contador, a
  // fila é um formulário que a clínica divulgou e não lê — e quem paga é a família esperando
  { chave: 'cadastros_recebidos', rotulo: 'Cadastros recebidos', rotuloCurto: 'Cadastros', icone: Inbox },
  { chave: 'informativos', rotulo: 'Informativos', rotuloCurto: 'Avisos', icone: Megaphone },
]

const CLASSE_LINHA_NAVEGAVEL =
  'flex flex-wrap items-baseline gap-x-2 rounded-controle px-2 py-1.5 text-corpo text-texto hover:bg-hover-de-linha focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco'
const CLASSE_LINHA_INFORMATIVA = 'flex flex-wrap items-baseline gap-x-2 px-2 py-1.5 text-corpo text-texto'

/**
 * Esqueleto comum das linhas que levam à ficha: com a permissão do destino a
 * linha é porta; sem ela, o MESMO conteúdo fica informativo — o dado o servidor
 * já autorizou por bloco, só a navegação não é prometida (F-02).
 */
function LinhaComFicha({
  pacienteId,
  contexto,
  children,
}: {
  pacienteId: number
  contexto: ContextoDoPainel
  children: ReactNode
}) {
  return contexto.podeVerFicha ? (
    <Link to={`/pacientes/${pacienteId}`} onClick={contexto.fechar} className={CLASSE_LINHA_NAVEGAVEL}>
      {children}
    </Link>
  ) : (
    <span className={CLASSE_LINHA_INFORMATIVA}>{children}</span>
  )
}

/**
 * O estado do pedido em palavras (SEC-LP-13: "pedido médico", nunca guia/TISS).
 * `vencido` e os dias vêm DECIDIDOS do servidor (fuso da clínica) — a tela nunca
 * compara datas; sem os dias, degrada para a data (fail-safe).
 */
function vencimentoDoPedido(item: ItemPedidoMedico): string {
  // Sem data-limite (`?string` no servidor — convênio sem validade em meses), a PALAVRA
  // ainda informa: o servidor mandou o item, então há o que renovar. "Vencido em —" não
  // é frase, e concatenar `undefined` era o que o tipo mentiroso deixava passar.
  if (item.vence_em === null) {
    return item.vencido ? 'Pedido vencido' : 'Pedido a vencer'
  }
  if (item.vencido) {
    return `Vencido em ${dataLegivel(item.vence_em)}`
  }
  if (item.vence_em_dias === null) {
    return `Vence em ${dataLegivel(item.vence_em)}`
  }
  if (item.vence_em_dias === 0) {
    return 'Vence hoje'
  }
  return item.vence_em_dias === 1
    ? 'Vence em 1 dia'
    : `Vence em ${item.vence_em_dias} dias`
}

/**
 * Cada painel renderiza os itens do SEU bloco — a união fica discriminada aqui
 * na configuração (cada entrada lê a própria chave do `Notificacoes` tipado),
 * nunca num `switch` no JSX.
 */
const PAINEIS: Record<
  ChaveComPainel,
  {
    /** Estado vazio NOMEADO — painel em branco não explica nada. */
    vazio: string
    renderizarItens: (notificacoes: Notificacoes, contexto: ContextoDoPainel) => ReactNode
    rodape?: (contexto: ContextoDoPainel) => ReactNode
    /**
     * Quanto do `total` os itens enviados cobrem. O padrão é um item por unidade do total; o bloco
     * que AGRUPA (pedidos de desmarque: o total é de sessões, o item é um dia) soma o que cada item
     * conta — senão o painel diria "Mostrando 2 de 5" com as 5 sessões na tela.
     */
    cobertos?: (notificacoes: Notificacoes) => number
  }
> = {
  aniversariantes: {
    vazio: 'Nenhum aniversariante este mês.',
    renderizarItens: (notificacoes, contexto) =>
      (notificacoes.aniversariantes?.itens ?? []).map((item) => (
        <li key={item.id}>
          <LinhaComFicha pacienteId={item.id} contexto={contexto}>
            <span className="tabular-nums text-texto-suave">dia {item.dia}</span>
            <span className="font-medium">{item.nome}</span>
          </LinhaComFicha>
        </li>
      )),
  },
  termos_pendentes: {
    vazio: 'Nenhum termo pendente.',
    renderizarItens: (notificacoes, contexto) =>
      (notificacoes.termos_pendentes?.itens ?? []).map((item) => (
        <li key={item.id}>
          <LinhaComFicha pacienteId={item.id} contexto={contexto}>
            <span className="font-medium">{item.nome}</span>
            {item.especialidade === null ? null : (
              <span className="text-meta text-texto-suave">{item.especialidade.nome}</span>
            )}
          </LinhaComFicha>
        </li>
      )),
  },
  lancamentos_em_atraso: {
    vazio: 'Nenhum lançamento em atraso.',
    // Itens informativos de propósito: não existe rota de detalhe de lançamento —
    // o rodapé é a ÚNICA porta (um link repetido 50× para a mesma tela é ruído).
    renderizarItens: (notificacoes) =>
      (notificacoes.lancamentos_em_atraso?.itens ?? []).map((item) => (
        <li key={item.lancamento_id} className={CLASSE_LINHA_INFORMATIVA}>
          <span className="tabular-nums text-texto-suave">{dataLegivel(item.vencimento)}</span>
          <span className="font-medium tabular-nums">{formatarBRL(item.valor_liquido)}</span>
          <span className="text-meta text-texto-suave">
            {item.tipo === 'receita' ? 'Receita' : 'Despesa'}
            {item.interessado?.nome == null ? '' : ` · ${item.interessado.nome}`}
          </span>
        </li>
      )),
    rodape: ({ fechar, podeAbrirFinanceiro }) =>
      podeAbrirFinanceiro ? (
        <Link
          to="/financeiro"
          onClick={fechar}
          className="text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
        >
          Abrir financeiro
        </Link>
      ) : null,
  },
  faltas_consecutivas: {
    vazio: 'Nenhum paciente no limite de faltas.',
    renderizarItens: (notificacoes, contexto) =>
      (notificacoes.faltas_consecutivas?.itens ?? []).map((item) => (
        <li key={item.paciente.id}>
          <LinhaComFicha pacienteId={item.paciente.id} contexto={contexto}>
            <span className="font-medium">{item.paciente.nome ?? '—'}</span>
            <span className="text-meta text-texto-suave">
              {item.faltas_consecutivas} faltas seguidas · última em {dataLegivel(item.ultima_falta_em)}
            </span>
          </LinhaComFicha>
        </li>
      )),
  },
  pedidos_de_desmarque: {
    vazio: 'Nenhum pedido de desmarque esperando a recepção.',
    /*
      SÓ o dia e quantas sessões — nunca o nome da criança: o centro fica aberto em tela de balcão,
      e o nome mora na agenda, que é aonde o item leva. O destino abre a VISÃO GERAL do dia: é ela
      que mostra todas as colunas, e a faixa de respostas lá em cima destaca quem pediu.
    */
    renderizarItens: (notificacoes, contexto) =>
      (notificacoes.pedidos_de_desmarque?.itens ?? []).map((item) => (
        <li key={item.dia}>
          <Link
            to={`/agenda?data=${item.dia}&visao=geral`}
            onClick={contexto.fechar}
            className={CLASSE_LINHA_NAVEGAVEL}
          >
            <span className="font-medium">{periodoEmPalavras(item.dia) ?? dataLegivel(item.dia)}</span>
            <span className="text-meta tabular-nums text-perigo-texto">
              {item.total === 1 ? '1 sessão' : `${item.total} sessões`}
            </span>
          </Link>
        </li>
      )),
    cobertos: (notificacoes) =>
      (notificacoes.pedidos_de_desmarque?.itens ?? []).reduce((soma, item) => soma + item.total, 0),
  },
  pedidos_medicos: {
    vazio: 'Nenhum pedido médico a vencer.',
    // whitelist SEC-LP-02: nome, convênio, especialidade e o vencimento — nunca o
    // pedido em si (sessões/semana), nunca matrícula/guia. A palavra diz o estado
    // (canal não-só-cor, 1.4.1); o destino é a ficha, onde o pedido se renova.
    renderizarItens: (notificacoes, contexto) =>
      (notificacoes.pedidos_medicos?.itens ?? []).map((item) => (
        <li key={item.tratamento_id}>
          <LinhaComFicha pacienteId={item.paciente.id} contexto={contexto}>
            <span className="font-medium">{item.paciente.nome_social ?? item.paciente.nome}</span>
            <span className="text-meta text-texto-suave">
              {item.convenio.nome}
              {item.especialidade === null ? '' : ` · ${item.especialidade.nome}`}
            </span>
            <span
              className={`text-meta font-medium ${
                item.vencido ? 'text-perigo-texto' : 'text-alerta-texto'
              }`}
            >
              {vencimentoDoPedido(item)}
            </span>
          </LinhaComFicha>
        </li>
      )),
  },
  cadastros_recebidos: {
    vazio: 'Nenhum cadastro esperando conferência.',
    /*
      SÓ o instante. O nome da criança fica na fila, e não aqui: o centro de notificações fica
      aberto em tela de balcão, e o que este bloco precisa dizer é "há três esperando você" — não
      quem são. Quem vai decidir abre a tela, que exige a permissão.
    */
    renderizarItens: (notificacoes) =>
      (notificacoes.cadastros_recebidos?.itens ?? []).map((item) => (
        <li key={item.id}>
          <Link to="/cadastros-recebidos" className={CLASSE_LINHA_NAVEGAVEL}>
            <span className="font-medium">Cadastro recebido</span>
            <span className="text-meta text-texto-suave">em {dataHoraLegivel(item.enviado_em)}</span>
          </Link>
        </li>
      )),
  },
  pacotes_acabando: {
    vazio: 'Nenhum pacote perto do fim.',
    /*
      O item diz QUEM, de QUE pacote e quanto FALTA — a whitelist do servidor, sem acrescentar
      nada aqui. O saldo vem em `perigo-texto`, o MESMO tom do realce do card: quem vê o card
      vermelho na agenda e o número vermelho aqui está vendo o mesmo fato, e não dois avisos.

      Cor não é canal único (1.4.1): o texto diz "faltam N", e o `X de Y` diz o resto.
    */
    renderizarItens: (notificacoes, contexto) =>
      (notificacoes.pacotes_acabando?.itens ?? []).map((item) => (
        <li key={item.tratamento_id}>
          <LinhaComFicha pacienteId={item.paciente.id} contexto={contexto}>
            <span className="font-medium">{item.paciente.nome_social ?? item.paciente.nome}</span>
            {/* omite o span inteiro quando não há nada a dizer — é o que os blocos irmãos
                fazem; "Sem especialidade" era texto inventado que não informa nem leva a nada */}
            {item.especialidade !== null || item.convenio !== null ? (
              <span className="text-meta text-texto-suave">
                {[
                  item.especialidade?.nome,
                  item.convenio === null
                    ? null
                    : item.convenio.particular
                      ? 'Particular'
                      : item.convenio.nome,
                ]
                  .filter((parte): parte is string => parte != null)
                  .join(' · ')}
              </span>
            ) : null}
            {/* a MESMA escada do card (D3): âmbar avisa, vermelho bloqueia */}
            <span
              className={cn(
                'text-meta font-medium tabular-nums',
                item.sessoes_saldo <= 0 ? 'text-perigo-texto' : 'text-alerta-texto',
              )}
            >
              {saldoRestanteEmPalavras(item.sessoes_saldo)} ·{' '}
              {item.sessoes_total - item.sessoes_saldo} de {item.sessoes_total}
            </span>
          </LinhaComFicha>
        </li>
      )),
    /*
      D5: o destino é a lista de tratamentos, que já existe e já é gated por `tratamentos.ver`
      — sem tela nova. E ela ABRE no recorte "Acabando" por padrão, então o link é direto.

      O rodapé é a porta única: 50 linhas apontando para a mesma tela seria ruído (o mesmo
      motivo do bloco de lançamentos). Aqui cada linha aponta para a FICHA, que é onde o
      pacote se renova — telas diferentes, papéis diferentes.
    */
    rodape: ({ fechar }) => (
      <Link
        to="/tratamentos"
        onClick={fechar}
        className="text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        Ver tratamentos acabando
      </Link>
    ),
  },
  informativos: {
    vazio: 'Nenhum informativo publicado.',
    // O painel É o destino: não existe tela de leitura de informativos (o CRUD
    // é da administração) — título e corpo integrais, legíveis aqui.
    renderizarItens: (notificacoes) =>
      (notificacoes.informativos?.itens ?? []).map((item) => (
        <li key={item.id} className="px-2 py-1.5">
          <article>
            <h3 className="text-corpo font-medium text-texto">{item.titulo}</h3>
            <p className="mt-0.5 whitespace-pre-line text-corpo text-texto-suave">{item.corpo}</p>
            <p className="mt-1 text-meta text-texto-suave">{dataHoraLegivel(item.publicado_em)}</p>
          </article>
        </li>
      )),
  },
}

/**
 * A novidade em palavras (alertas-do-mural). O autor pode ter saído do sistema
 * (`null`) — a frase sobrevive; a coluna de destino chega nos `dados` e vira o
 * rótulo humano do quadro (nunca o slug).
 */
function fraseDoEvento(evento: EventoDoMural): string {
  const autor = evento.autor ?? 'Alguém'
  if (evento.tipo === 'atribuicao') {
    return evento.dados?.assumida === true
      ? `${autor} assumiu a demanda`
      : `${autor} atribuiu você`
  }
  if (evento.tipo === 'status') {
    const para = evento.dados?.para
    if (para === undefined) {
      return `${autor} moveu a tarefa`
    }
    return para === 'concluida'
      ? `${autor} concluiu`
      : `${autor} moveu para ${ROTULO_DA_COLUNA[para]}`
  }
  return `${autor} comentou`
}

/**
 * O aviso da trava do finalizar (change trava-de-evolucao, D3). A API manda
 * `vencidas`/`bloqueio_em_dias` SÓ para o usuário escopado a um profissional, e o
 * número chega PRONTO — a tela nunca lê a regra crua (prazo/carência não são chaves
 * de exibição). Canal não-só-cor (1.4.1): ícone + texto explícito, além do tom dos
 * tokens de alerta/perigo do DS. Sem vencida a API manda `null` — nada é renderizado.
 */
function AvisoDaTravaDeEvolucao({ bloco }: { bloco: BlocoEvolucoesEmAberto | undefined }) {
  const vencidas = bloco?.vencidas ?? 0
  const dias = bloco?.bloqueio_em_dias ?? null
  if (vencidas === 0 || dias === null) {
    return null
  }

  const travado = dias === 0
  const rotuloVencidas = `${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'}`
  const texto = travado
    ? `${rotuloVencidas} · finalizar travado`
    : `${rotuloVencidas} · trava em ${dias} ${dias === 1 ? 'dia' : 'dias'}`

  return (
    <span
      className={`flex items-center gap-1 rounded-pilula px-1.5 py-0.5 text-meta font-medium ${
        travado ? 'bg-perigo-suave text-perigo-texto' : 'bg-alerta-suave text-alerta-texto'
      }`}
    >
      <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
      {texto}
    </span>
  )
}

/**
 * Contadores da barra do conteúdo (§4). O número exibido é o `total` do bloco —
 * nunca o tamanho da lista de itens, que a API amostra (o painel declara a amostra).
 */
export function ContadoresNotificacao() {
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const [painelAberto, setPainelAberto] = useState<ChaveComPainel | 'tarefas' | 'em-dia' | null>(null)
  const queryClient = useQueryClient()
  const { notificar } = usarToast()
  const { data: notificacoes } = useQuery({
    queryKey: chaves.notificacoes(),
    queryFn: buscarNotificacoes,
    staleTime: TEMPO_AGENDA_MS,
    // sino VIVO (alertas-do-mural D6): o alerta chega com a tela parada
    refetchInterval: TEMPO_SINO_MS,
  })
  const marcarTodas = useMutation({
    mutationFn: lerTodosEventos,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chaves.notificacoes() }),
    // gesto explícito do usuário — falha nunca vira silêncio (I4)
    onError: () => notificar({ tom: 'erro', titulo: 'Não foi possível marcar as novidades como lidas.' }),
  })

  if (notificacoes === undefined) {
    return null
  }

  const presentes = BLOCOS.filter(({ chave }) => notificacoes[chave] !== undefined)
  if (presentes.length === 0) {
    return null
  }

  // Zero não é notícia: nove zeros na tira viravam um código ("39 1 3 0 1 13 0 0 0 0 0 0") e
  // escondiam os que importam. Os blocos zerados se juntam num só controle, "Em dia", que ainda
  // os lista e leva a cada destino — nada some, só deixa de gritar. O bloco de tarefas conta
  // NOVIDADE como sinal (evento não lido), não só o total.
  const emDia = presentes.filter((bloco) => {
    const total = notificacoes[bloco.chave]?.total ?? 0
    const novidades = bloco.chave === 'tarefas' ? (notificacoes.tarefas?.eventos ?? []).length : 0

    return total === 0 && novidades === 0
  })
  const comPendencia = presentes.filter((bloco) => !emDia.includes(bloco))

  // O limiar do RÓTULO acompanha quantos contadores há na tira (design-qa DQ-02): o `88rem`
  // fixo foi calibrado para 11 blocos e, com "Em dia" tirando os zerados, escondia os nomes em
  // todo monitor de 1366–1536. ~106px por contador + ~230px de sessão: ≤ 6 cabem em 64rem,
  // ≤ 9 em 76rem, acima disso a medida antiga. Sempre em rem de CONTÊINER (a barra), nunca da
  // janela — é o eixo que a guarda de teste protege.
  const naTira = comPendencia.length + (emDia.length > 0 ? 1 : 0)
  // `sr-only` e não `hidden` abaixo do limiar: o rótulo curto SAI DA VISTA, mas continua no nome
  // acessível — é ele que abre o nome (2.5.3), e esconder da AT só na faixa estreita faria o nome
  // mudar de começo conforme a largura da barra
  const classeDoRotulo = cn(
    'sr-only',
    naTira <= 6
      ? '@min-[64rem]:not-sr-only'
      : naTira <= 9
        ? '@min-[76rem]:not-sr-only'
        : '@min-[88rem]:not-sr-only',
  )

  const contexto: ContextoDoPainel = {
    fechar: () => setPainelAberto(null),
    podeVerFicha: temPermissao('pacientes.ver'),
    podeAbrirFinanceiro: temPermissao('lancamentos.ver'),
  }

  return (
    <ul aria-label="Notificações" className="flex items-center gap-1">
      {comPendencia.map((blocoDeMenu) => {
        const { chave, rotulo, rotuloCurto, icone: Icone } = blocoDeMenu
        const total = notificacoes[chave]?.total ?? 0
        const conteudo = (
          <>
            <Icone aria-hidden="true" className="size-4" />
            {/* ícone sozinho não se explica (feedback de design): o rótulo curto é
                VISÍVEL onde há largura.

                RÓTULO NO NOME (2.5.3, achado A11Y-BT-01 do gate): o nome acessível COMEÇA pelo
                que se lê na tela — "Desmarques 3, Pediram para desmarcar". Antes o rótulo curto
                era `aria-hidden` e o nome virava "3Pediram para desmarcar": quem usa comando de
                voz dizia "clicar em Desmarques" e nada respondia. Valia para TODOS os contadores
                (Mensagens, Aniversários, Atrasos, Avisos…), porque o nome é montado só aqui. O
                nome completo vem depois, separado por vírgula, só quando ele diz algo a mais.

                A largura que decide é a da BARRA (`@container` no header do shell), não a da
                janela: recolher a navegação dá ~200px à barra sem mudar o viewport, então o limiar
                por janela (`xl:`, que estava aqui) escondia rótulo que caberia e mostrava rótulo que
                não cabia — foi assim que o nome do usuário passou a quebrar em 1494px.

                A CONTA, refeita em 26/08 (achado do gate, `design-qa`/`a11y-auditor`): ela fora
                calibrada para **8** blocos (~849px de rótulo + ~230px de sessão ⇒ `@6xl`), e o
                produto chegou a **11** — `mensagens`, `tarefas` e `pacotes_acabando` entraram
                depois, e ninguém releu o comentário duas linhas acima do código que alterava.
                A ~106px por contador, 11 rótulos pedem ~1166px + ~230px ⇒ **~1396px**, e o
                limiar antigo os ligava a partir de 1152px: a tira estourava e virava rolagem
                lateral, com "Pacotes" (o 10º) fora da vista em repouso. `@min-[88rem]`
                (1408px de BARRA) é a medida de agora — abaixo disso, só ícones, que cabem.

                Isto vai acontecer de novo no 12º bloco. A saída estrutural é contador
                prioritário fixo + "mais" (gatilho `CONTADORES-TIRA`), que é mudança de UX e
                pede medição em navegador — não a aritmética perseguida a cada bloco novo. */}
            {/* os espaços são nós de texto SOLTOS entre os itens: num contêiner flex eles não
                ocupam lugar na tela, e no cálculo do nome separam as palavras — dentro de cada
                `span` eles seriam aparados, e o nome sairia "Desmarques3" */}
            <span className={classeDoRotulo}>{rotuloCurto}</span>{' '}
            <span className="tabular-nums font-medium text-texto">{total}</span>
            {rotulo === rotuloCurto ? null : <span className="sr-only">{`, ${rotulo}`}</span>}
            {/* separa da pílula de novidades das tarefas, que vem logo depois */}
            {' '}
          </>
        )
        const classe = 'flex items-center gap-1.5 rounded-controle px-2 py-1 text-meta text-texto-suave'
        const classeAcionavel = `${classe} hover:bg-moldura-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco`

        // tarefas é PAINEL de novidades (alertas-do-mural): eventos não lidos
        // com deep-link por tarefa; a porta para o mural fica no rodapé
        if (blocoDeMenu.chave === 'tarefas') {
          const eventos = notificacoes.tarefas?.eventos ?? []
          const podeAbrirMural = temPermissao(blocoDeMenu.permissaoDoDestino)

          return (
            <li key={chave}>
              <Popover
                aberto={painelAberto === 'tarefas'}
                aoMudarAberto={(aberto) => setPainelAberto(aberto ? 'tarefas' : null)}
                titulo={rotulo}
                gatilho={
                  <button type="button" title={rotulo} className={classeAcionavel}>
                    {conteudo}
                    {/* novidade ≠ estado: a pílula acende só com evento não lido
                        (canal não-só-cor: a PALAVRA diz o que o tom sugere) */}
                    {eventos.length > 0 ? (
                      <span className="rounded-pilula bg-chip-de-marca px-1.5 py-0.5 text-meta font-medium text-sobre-chip-de-marca">
                        {eventos.length === 1 ? '1 novidade' : `${eventos.length} novidades`}
                      </span>
                    ) : null}
                  </button>
                }
                rodape={
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {podeAbrirMural ? (
                      <Link
                        to="/tarefas"
                        onClick={contexto.fechar}
                        className="text-corpo font-medium text-acento hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                      >
                        Abrir o mural
                      </Link>
                    ) : (
                      <span />
                    )}
                    {eventos.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => marcarTodas.mutate()}
                        disabled={marcarTodas.isPending}
                        className="text-corpo font-medium text-texto-suave hover:underline disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
                      >
                        Marcar todas como lidas
                      </button>
                    ) : null}
                  </div>
                }
              >
                {eventos.length === 0 ? (
                  <p className="text-corpo text-texto-suave">
                    Nenhuma novidade. Suas tarefas e demandas seguem no mural.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {eventos.map((evento) => {
                      const linha = (
                        <>
                          <span className="font-medium">{fraseDoEvento(evento)}</span>
                          {evento.titulo === null ? null : (
                            <span className="text-meta text-texto-suave">{evento.titulo}</span>
                          )}
                          <span className="text-meta text-texto-suave">
                            {dataHoraLegivel(evento.quando)}
                          </span>
                        </>
                      )

                      return (
                        <li key={evento.id}>
                          {podeAbrirMural ? (
                            <Link
                              to={`/tarefas?tarefa=${evento.tarefa_id}`}
                              onClick={contexto.fechar}
                              className={CLASSE_LINHA_NAVEGAVEL}
                            >
                              {linha}
                            </Link>
                          ) : (
                            <span className={CLASSE_LINHA_INFORMATIVA}>{linha}</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Popover>
            </li>
          )
        }

        if (blocoDeMenu.destino !== undefined) {
          const podeAbrir = temPermissao(blocoDeMenu.permissaoDoDestino)
          // o aviso vive junto do contador de evoluções: é dele que a trava fala
          const aviso =
            blocoDeMenu.chave === 'evolucoes_em_aberto' ? (
              <AvisoDaTravaDeEvolucao bloco={notificacoes[blocoDeMenu.chave]} />
            ) : null

          return (
            <li key={chave}>
              {podeAbrir ? (
                <Link to={blocoDeMenu.destino} title={rotulo} className={classeAcionavel}>
                  {conteudo}
                  {aviso}
                </Link>
              ) : (
                <span title={rotulo} className={classe}>
                  {conteudo}
                  {aviso}
                </span>
              )}
            </li>
          )
        }

        const painel = PAINEIS[blocoDeMenu.chave]
        // pela chave ESTREITADA (painel): o bloco de tarefas é link direto e não
        // passa por aqui — e o dele nem teria `itens`
        const bloco = notificacoes[blocoDeMenu.chave]
        const itensEnviados = painel.cobertos?.(notificacoes) ?? bloco?.itens.length ?? 0
        const rodape = painel.rodape?.(contexto)

        return (
          <li key={chave}>
            <Popover
              aberto={painelAberto === blocoDeMenu.chave}
              aoMudarAberto={(aberto) => setPainelAberto(aberto ? blocoDeMenu.chave : null)}
              titulo={rotulo}
              gatilho={
                <button type="button" title={rotulo} className={classeAcionavel}>
                  {conteudo}
                </button>
              }
              rodape={rodape ?? undefined}
            >
              {total === 0 ? (
                <p className="text-corpo text-texto-suave">{painel.vazio}</p>
              ) : (
                <>
                  <ul className="flex flex-col gap-0.5">
                    {painel.renderizarItens(notificacoes, contexto)}
                  </ul>
                  {/* a API amostra (teto de 50) — lista cortada se declara */}
                  {total > itensEnviados ? (
                    <p className="mt-2 text-meta text-texto-suave">
                      Mostrando {itensEnviados} de {total}.
                    </p>
                  ) : null}
                </>
              )}
            </Popover>
          </li>
        )
      })}
      {emDia.length === 0 ? null : (
        <li>
          <Popover
            aberto={painelAberto === 'em-dia'}
            aoMudarAberto={(aberto) => setPainelAberto(aberto ? 'em-dia' : null)}
            titulo="Em dia"
            gatilho={
              // "Em dia" é o contrário de pendência, e não pode PESAR como uma (design-qa DQ-01):
              // sem número à vista (o "7" ao lado de "39 · 1 · 3" lia como mais um alerta) e com o
              // rótulo sempre visível — é uma palavra só. A contagem fica no nome acessível.
              <button
                type="button"
                title="Em dia"
                className="flex items-center gap-1.5 rounded-controle px-2 py-1 text-meta text-texto-suave hover:bg-moldura-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
              >
                <CircleCheck aria-hidden="true" className="size-4 text-sucesso-texto" />
                <span aria-hidden="true">Em dia</span>
                <span className="sr-only">
                  {emDia.length === 1 ? 'Em dia: 1 bloco sem pendência' : `Em dia: ${emDia.length} blocos sem pendência`}
                </span>
              </button>
            }
          >
            <p className="mb-2 text-corpo text-texto-suave">Nada pendente em:</p>
            <ul className="flex flex-col gap-1">
              {emDia.map((bloco) => (
                <li key={bloco.chave}>
                  {bloco.destino !== undefined && temPermissao(bloco.permissaoDoDestino) ? (
                    <Link to={bloco.destino} onClick={contexto.fechar} className={CLASSE_LINHA_NAVEGAVEL}>
                      <bloco.icone aria-hidden="true" className="size-4 shrink-0 self-center text-texto-suave" />
                      <span className="font-medium text-acento">{bloco.rotulo}</span>
                    </Link>
                  ) : (
                    <span className={CLASSE_LINHA_INFORMATIVA}>
                      <bloco.icone aria-hidden="true" className="size-4 shrink-0 self-center text-texto-suave" />
                      {bloco.rotulo}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Popover>
        </li>
      )}
    </ul>
  )
}
