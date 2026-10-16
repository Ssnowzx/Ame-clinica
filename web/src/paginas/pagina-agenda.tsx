import { useQuery } from '@tanstack/react-query'
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  ListChecks,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { AvisoDeAtualizacao } from '@/componentes/agenda/aviso-de-atualizacao'
import {
  ConfirmacaoDeRemarcacao,
  type PedidoDeRemarcacao,
  type ResultadoDaRemarcacao,
} from '@/componentes/agenda/confirmacao-de-remarcacao'
import { FormularioAgendamento } from '@/componentes/agenda/formulario-agendamento'
import { GradeAgenda } from '@/componentes/agenda/grade-agenda'
import { ListaAgenda } from '@/componentes/agenda/lista-agenda'
import { MenuDeStatus } from '@/componentes/agenda/menu-de-status'
import { BaixaEmLote } from '@/componentes/agenda/baixa-em-lote'
import { DesmarqueEmLote } from '@/componentes/agenda/desmarque-em-lote'
import { FaixaDeConfirmacoes } from '@/componentes/agenda/faixa-de-confirmacoes'
import { ListaProfissionais } from '@/componentes/agenda/lista-profissionais'
import { PainelAgendamento } from '@/componentes/agenda/painel-agendamento'
import { PainelBloqueio } from '@/componentes/agenda/painel-bloqueio'
import { PainelListaEspera } from '@/componentes/agenda/painel-lista-espera'
import { AcaoDoPreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { Botao } from '@/componentes/ui/botao'
import { Segmento } from '@/componentes/ui/segmento'
import { SeletorDeData } from '@/componentes/ui/seletor-de-data'
import { EstadoErro } from '@/componentes/ui/estado-erro'
import { EstadoVazio } from '@/componentes/ui/estado-vazio'
import { Skeleton } from '@/componentes/ui/skeleton'

import { mensagemDaFalhaDeAtualizacao, usarAgendaViva } from '@/hooks/usar-agenda-viva'
import { usarAgoraNaClinica } from '@/hooks/usar-agora-na-clinica'
import { usarTelaEmpilhada, usarTelaEstreita } from '@/hooks/usar-tela-estreita'
import { CAMINHOS } from '@/lib/caminhos-dos-cadastros'
import { chaves } from '@/lib/chaves-query'
import { contarConfirmacoes } from '@/lib/confirmacao-do-lembrete'
import { periodoEmPalavras, TIMEZONE_PADRAO } from '@/lib/datas'
import { dataEhValida, diasDaSemanaVisiveis, montarGrade, somarDias } from '@/lib/grade-agenda'
import { TEMPO_AGENDA_MS, TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { buscarAgenda, buscarPacientePorId, buscarSelecaoDaAgenda } from '@/servicos/agenda'
import { buscarConfiguracaoAgenda } from '@/servicos/catalogos'
import { listarFila } from '@/servicos/lista-espera'
import { useAuthStore } from '@/stores/auth-store'
import type { CardAgendamento, EntradaDaFila, EstadoDaConfirmacao, VisaoAgenda } from '@/tipos'

const VISOES: ReadonlyArray<{ valor: VisaoAgenda; rotulo: string }> = [
  { valor: 'dia', rotulo: 'Dia' },
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'geral', rotulo: 'Visão geral' },
]

const VALORES_DE_VISAO: VisaoAgenda[] = ['dia', 'semana', 'geral']

/**
 * O elemento FOCÁVEL de um card da grade: o gatilho de remarcação, senão o primeiro botão. Lido
 * do DOM porque o card é da grade e a página não guarda ref por card. `null` = o card não está
 * no período visível.
 */
function gatilhoDoCard(cardId: number): HTMLElement | null {
  const card = document.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`)
  if (card === null) {
    return null
  }

  return card.querySelector<HTMLElement>('[aria-label^="Remarcar"]') ?? card.querySelector<HTMLElement>('button')
}

export function PaginaAgenda() {
  const [parametros, setParametros] = useSearchParams()
  const temPermissao = useAuthStore((estado) => estado.temPermissao)
  const profissionalDoUsuario = useAuthStore((estado) => estado.usuario?.profissional_id ?? null)
  const [formularioAberto, setFormularioAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<CardAgendamento | null>(null)
  const [novoAgendamento, setNovoAgendamento] = useState<{ profissionalId: number; inicio: string } | null>(null)
  // A entrada é CONGELADA ao abrir o formulário: se ela sumisse da fila no meio
  // do preenchimento (outra recepcionista encaixou), um formulário derivado da
  // fila viva trocaria de operação sob os dedos do usuário — o título viraria
  // "Novo agendamento" e o submit iria para outro endpoint (parecer §9)
  const [encaixeDoFormulario, setEncaixeDoFormulario] = useState<EntradaDaFila | null>(null)
  // Clicar num item abre o PAINEL DE LEITURA (agendamento ou bloqueio); a edição é destino.
  const [cardEmLeitura, setCardEmLeitura] = useState<CardAgendamento | null>(null)
  const [bloqueioEmLeitura, setBloqueioEmLeitura] = useState<CardAgendamento | null>(null)
  // Arrastar-para-remarcar: o soltar (ou a escolha por teclado) vira um PEDIDO
  // que abre a confirmação de→para — soltar nunca grava direto (D2).
  const [pedidoDeRemarcacao, setPedidoDeRemarcacao] = useState<PedidoDeRemarcacao | null>(null)
  // Modo teclado "Remarcar para…" (D3): com um card aqui, os slots livres da
  // grade agem como ALVO da remarcação em vez de "marcar".
  const [cardEmRemarcacao, setCardEmRemarcacao] = useState<CardAgendamento | null>(null)
  // Um cartão no AR (o gesto de arrastar ativo): a grade não se atualiza sozinha no meio dele (D11)
  const [arrastando, setArrastando] = useState(false)
  // O estado que a faixa de respostas ao lembrete destaca. Vive AQUI, fora do dado: a busca de
  // minuto em minuto troca os cartões e não pode apagar o que a recepção escolheu ver
  const [destaqueDaConfirmacao, setDestaqueDaConfirmacao] = useState<EstadoDaConfirmacao | null>(null)

  // leitura → edição: fecha os painéis e abre o formulário no mesmo agendamento
  function abrirFormularioDeEdicao(card: CardAgendamento): void {
    setCardEmLeitura(null)
    setBloqueioEmLeitura(null)
    setEmEdicao(card)
    setNovoAgendamento(null)
    setEncaixeDoFormulario(null)
    setFormularioAberto(true)
  }

  const configuracao = useQuery({
    queryKey: chaves.configuracaoAgenda(),
    queryFn: buscarConfiguracaoAgenda,
    staleTime: TEMPO_CATALOGO_MS,
  })
  /**
   * UMA consulta para tudo o que a grade DESENHA — e ela vive sob `agenda.ver`.
   *
   * Antes eram TRÊS (`/profissionais`, `/especialidades`, `/feriados`), cada uma atrás da
   * permissão do SEU módulo. Um nível customizado (§12) com `agenda.ver` e sem
   * `profissionais.ver` levava três 403 e via "Não foi possível carregar a agenda": a permissão
   * que dá a TELA não dava os CATÁLOGOS de que a tela precisa para EXIBIR.
   *
   * O precedente já era da casa: `CHAVES_EXIBICAO_AGENDA` nasceu porque "a grade não pode exigir
   * `configuracoes.ver`", e `/agenda/selecao/pacientes` porque entrar na fila não pode exigir
   * `pacientes.ver`. O `/agenda/selecao` já existia sob `agenda.ver` — a grade só não o usava.
   */
  const selecao = useQuery({
    queryKey: chaves.selecaoDaAgenda(),
    queryFn: buscarSelecaoDaAgenda,
    staleTime: TEMPO_CATALOGO_MS,
  })

  // A fila só é buscada por quem pode vê-la — sem a permissão, a agenda é
  // exatamente o que era (mesma chave do painel: uma consulta, não duas)
  const podeVerFila = temPermissao('lista_espera.ver')
  const fila = useQuery({
    queryKey: chaves.listaEspera(),
    queryFn: listarFila,
    enabled: podeVerFila,
  })

  const config = configuracao.data
  const listaDeProfissionais = useMemo(() => selecao.data?.profissionais ?? [], [selecao.data])
  const feriadosDaClinica = useMemo(() => selecao.data?.feriados ?? [], [selecao.data])

  // O gesto exige a config da clínica LIGADA (§6/§13 — default false, fail-safe)
  // E `agenda.editar` (o gate do PUT): com só `agenda.ver`, o card continua
  // abrindo em leitura, sem afordância nenhuma.
  const podeArrastar = config?.arrastarParaRemarcar === true && temPermissao('agenda.editar')

  // Iniciadores do modo teclado (card e painel de leitura). `useCallback` para
  // não quebrar o memo dos ~330 cards da grade cheia (§16).
  // Identidade ESTÁVEL (perf-engineer PERF-AV-01): uma arrow inline aqui quebrava o `memo` dos
  // 320 cards da grade cheia — e, com a linha do agora, isso virou 320 cards + 320 menus
  // re-renderizados a cada minuto. Tudo abre em LEITURA: agendamento no painel, bloqueio no card.
  const abrirCardEmLeitura = useCallback((cardAberto: CardAgendamento) => {
    if (cardAberto.tipo === 'atendimento') {
      setCardEmLeitura(cardAberto)
    } else {
      setBloqueioEmLeitura(cardAberto)
    }
  }, [])

  const iniciarRemarcacao = useCallback((card: CardAgendamento) => {
    setCardEmLeitura(null)
    setCardEmRemarcacao(card)
  }, [])

  const abrirConfirmacaoDeRemarcacao = useCallback((dados: PedidoDeRemarcacao) => {
    setPedidoDeRemarcacao(dados)
  }, [])

  /*
   * Fonte ÚNICA do foco de volta ao card (2.4.3): mira o GATILHO "Remarcar…"
   * (fallback: o primeiro botão do card); card ausente da grade cai no contêiner dela — o
   * foco nunca evapora para o `<body>`.
   *
   * **SEM `grade.tabIndex = -1` aqui.** A linha existia porque, antes da change
   * `agenda-no-mouse`, o contêiner não era focável e precisava ser tornado focável na hora.
   * Agora ele nasce com `tabIndex={0}` — e a escrita imperativa era pior que redundante:
   * o React NÃO enxerga a escrita externa, então a prop continua `0`, o diff não acha
   * mudança, e o `tabindex="-1"` fica gravado no DOM **até o remount da página**. A região
   * rolável saía da ordem de tabulação de forma permanente e silenciosa, levando junto a
   * rolagem por setas — e nada parecia quebrado, porque os botões de coluna continuavam
   * tabuláveis. Achado do gate, provado por mutação.
   */
  const focarNoGatilhoDoCard = useCallback((cardId: number): void => {
    const gatilho = gatilhoDoCard(cardId)
    if (gatilho === null) {
      document.querySelector<HTMLElement>('[data-grade-agenda]')?.focus()
      return
    }
    gatilho.focus()
  }, [])

  // Sucesso da confirmação (2.4.3): o foco vai ao card remarcado no DESTINO —
  // a invalidação re-renderiza a grade, então ESPERA o card existir (rAF por
  // quadro, com teto); se ele saiu do período visível, cai no fallback da grade.
  const focarNoCardRemarcado = useCallback(
    (cardId: number): void => {
      let tentativas = 30
      const tentar = (): void => {
        const card = document.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`)
        if (card !== null) {
          card.tabIndex = -1
          card.focus()
          return
        }
        tentativas -= 1
        if (tentativas > 0) {
          window.requestAnimationFrame(tentar)
        } else {
          focarNoGatilhoDoCard(cardId)
        }
      }
      window.requestAnimationFrame(tentar)
    },
    [focarNoGatilhoDoCard],
  )

  // Saída ÚNICA do modo teclado (Escape E botão Cancelar convergem aqui):
  // termina sem efeito e devolve o foco ao gatilho de origem (2.4.3).
  const sairDoModoDeRemarcacao = useCallback(
    (idDeOrigem: number): void => {
      setCardEmRemarcacao(null)
      focarNoGatilhoDoCard(idDeOrigem)
    },
    [focarNoGatilhoDoCard],
  )

  function cancelarRemarcacao(): void {
    if (cardEmRemarcacao !== null) {
      sairDoModoDeRemarcacao(cardEmRemarcacao.id)
    }
  }

  // `Escape` cancela o modo de escolha SEM efeito — ouvinte só enquanto ativo
  useEffect(() => {
    if (cardEmRemarcacao === null) {
      return
    }
    const idDeOrigem = cardEmRemarcacao.id
    function aoTeclar(evento: KeyboardEvent): void {
      // um menu/diálogo Radix aberto consome o Esc primeiro (defaultPrevented):
      // ignorar, senão UM Esc fecharia a camada de cima E o modo de uma vez
      if (evento.key === 'Escape' && !evento.defaultPrevented) {
        sairDoModoDeRemarcacao(idDeOrigem)
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => {
      window.removeEventListener('keydown', aoTeclar)
    }
  }, [cardEmRemarcacao, sairDoModoDeRemarcacao])

  // Estado na URL: visão, data e profissional sobrevivem ao recarregamento
  const visaoDaUrl = parametros.get('visao')
  const visao: VisaoAgenda = VALORES_DE_VISAO.includes(visaoDaUrl as VisaoAgenda)
    ? (visaoDaUrl as VisaoAgenda)
    : (config?.visaoPadrao ?? 'dia')

  /*
   * A SEMANA DEGRADA PARA O DIA em tela estreita (design D6).
   *
   * São sete colunas de dias, e nenhuma cabe num telefone. Virar a semana em lista também
   * não serve: seriam centenas de itens numa rolagem única — pior que o problema.
   *
   * `visao` continua sendo A ESCOLHA DO USUÁRIO, e é ela que manda na URL e na aba marcada.
   * O que degrada é o que se RENDERIZA. Trocar a URL faria a escolha evaporar ao girar o
   * telefone, e quem chegou por link compartilhado perderia o que o link dizia.
   */
  const telaEstreita = usarTelaEstreita()
  const telaEmpilhada = usarTelaEmpilhada()
  const semanaDegradada = telaEstreita && visao === 'semana'
  const visaoEfetiva: VisaoAgenda = semanaDegradada ? 'dia' : visao

  // `data` vem da URL: valor não confiável. Sem esta validação, `data=banana`
  // chegaria à aritmética de datas e derrubaria o render (SEC-R1).
  const dataDaUrl = parametros.get('data')
  const agora = usarAgoraNaClinica(config?.timezone ?? TIMEZONE_PADRAO)
  const hoje = agora.data
  const data = dataEhValida(dataDaUrl) ? dataDaUrl : hoje

  // `profissional` também vem da URL: `?profissional=abc` viraria NaN e iria
  // para a API (que responde 422) — o `??` não pega NaN.
  const profissionalDaUrl = Number(parametros.get('profissional'))
  const profissionalSelecionado = Number.isInteger(profissionalDaUrl) && profissionalDaUrl > 0
    ? profissionalDaUrl
    : null

  // A visão Geral é multi-profissional por definição; Dia/Semana precisam de um
  // profissional. Sem escolha na URL, abre no profissional VINCULADO a quem está logado
  // (change agenda-abre-no-profissional-logado) — só se ele estiver na lista que o servidor
  // deixou ver (inativo ou fora do escopo cairia numa grade vazia); senão, no primeiro ativo.
  // Não é gravado na URL: o padrão continua padrão, e a escolha explícita continua vencendo.
  const profissionalPadrao = listaDeProfissionais.some((item) => item.id === profissionalDoUsuario)
    ? profissionalDoUsuario
    : (listaDeProfissionais[0]?.id ?? null)
  const profissionalDaGrade =
    visaoEfetiva === 'geral' ? null : (profissionalSelecionado ?? profissionalPadrao)

  // Modo encaixe: `?encaixe=<id>` vem da URL (valor não confiável — `abc` viraria
  // NaN e a agenda não pode quebrar por isso). Entrada que não está mais na fila
  // (outra recepcionista encaixou) simplesmente não destaca nada.
  //
  // O modo exige a MESMA dupla de permissões que o servidor exige: sem elas, o
  // formulário abriria titulado "Encaixar" e o botão prometeria um 403
  // (parecer SEC-LE-12).
  const podeEncaixar = temPermissao('lista_espera.excluir') && temPermissao('agenda.criar')
  const encaixeDaUrl = Number(parametros.get('encaixe'))
  // "existe um encaixe candidato?" é UMA pergunta, respondida UMA vez: o modo encaixe e a
  // precedência sobre o retorno leem daqui. Enquanto eram dois predicados (um exigindo id válido +
  // permissão, outro só a presença do parâmetro), `?encaixe=abc&paciente=10` matava os DOIS modos —
  // o retorno morria por um encaixe que nunca engataria.
  const encaixeEhCandidato = podeEncaixar && Number.isInteger(encaixeDaUrl) && encaixeDaUrl > 0
  const entradaDoEncaixe = encaixeEhCandidato
    ? (fila.data?.find((entrada) => entrada.id === encaixeDaUrl) ?? null)
    : null

  // Modo RETORNO: `?paciente=<id>` vem da fila de pendências. É o caminho de "agendar o retorno"
  // desta criança — e o id viaja sozinho porque o NOME de um MENOR não pode entrar em query
  // string (gatilho `LOG`); ele chega depois, por leitura autorizada por-id.
  //
  // Mesma defesa dos outros parâmetros (`?paciente=abc` viraria NaN) e o mesmo espelho de
  // permissão do encaixe: sem `agenda.criar` o modo não engata, porque marcar é o que ele existe
  // para fazer. Precedência (D8): havendo um encaixe CANDIDATO, o encaixe VENCE — ele é a operação
  // que o servidor consome e já traz paciente próprio, em campo de leitura. A decisão olha o
  // parâmetro (via `encaixeEhCandidato`), NUNCA a entrada resolvida: depender do carregamento da
  // fila faria o modo piscar.
  const podeMarcar = temPermissao('agenda.criar')
  const pacienteDaUrl = Number(parametros.get('paciente'))
  const idDoRetorno =
    podeMarcar && !encaixeEhCandidato && Number.isInteger(pacienteDaUrl) && pacienteDaUrl > 0
      ? pacienteDaUrl
      : null

  // Não resolveu — id inexistente, paciente inativado, cadastro apagado, rede fora? O modo
  // simplesmente NÃO engata: sem faixa, agenda normal, formulário com o campo de paciente vazio
  // (design D6). Nunca um modo meio ligado, prometendo uma criança que a tela não sabe nomear.
  const pacienteDoRetorno = useQuery({
    queryKey: chaves.pacienteDaSelecao(idDoRetorno ?? 0),
    queryFn: () => buscarPacientePorId(idDoRetorno ?? 0),
    enabled: idDoRetorno !== null,
    // paridade com a busca de paciente do formulário (que também cacheia nome de MENOR): o balcão
    // é máquina compartilhada, então o nome não fica 5 minutos no cache depois de o modo encerrar
    gcTime: 30 * 1000,
  })
  const retornoEmCurso = pacienteDoRetorno.data ?? null
  const nomeDoRetorno = retornoEmCurso?.nome_social ?? retornoEmCurso?.nome ?? null

  function sairDoModoRetorno(): void {
    atualizarUrl({ paciente: null })
  }

  // baixa em massa da agenda de UM profissional (change desmarque-do-profissional): só faz
  // sentido com um profissional escolhido — na visão geral não há "a agenda dele"
  const [desmarqueAberto, setDesmarqueAberto] = useState(false)
  const profissionalDoDesmarque = listaDeProfissionais.find((item) => item.id === profissionalDaGrade)
  const podeDesmarcarEmLote =
    temPermissao('agenda.editar') && visao !== 'geral' && profissionalDoDesmarque !== undefined

  // "Dar baixa" (change baixa-em-lote-por-status, D14): as mesmas condições, lidas por
  // `visaoEfetiva` — na semana degradada em 390 o "dia à vista" bate com o que a tela mostra.
  // Sem status aplicável o botão NÃO some: o diálogo abre no estado vazio com o caminho.
  const [baixaAberta, setBaixaAberta] = useState(false)
  const refBotaoDarBaixa = useRef<HTMLButtonElement>(null)
  // o card do MESMO dia que "Ver na agenda" escolheu: o destino do foco ao fechar, resolvido
  // pelo `focoAoFechar` do diálogo (ver `localizarAgendamentoDaBaixa`)
  const cardAlvoDaBaixa = useRef<number | null>(null)
  const podeDarBaixa =
    temPermissao('agenda.editar') && visaoEfetiva !== 'geral' && profissionalDoDesmarque !== undefined

  const periodo = useMemo(() => {
    if (visaoEfetiva !== 'semana' || config === undefined) {
      return { de: data, ate: data }
    }
    const dias = diasDaSemanaVisiveis(data, config)
    return { de: dias[0], ate: dias.at(-1) ?? data }
  }, [visaoEfetiva, data, config])

  // O período em PALAVRAS sob o título: o campo `dd/mm/aaaa` não diz o dia da semana, e é
  // ele que a recepção procura ("é terça?"). Deriva do MESMO `periodo` da consulta.
  const periodoLegivel = periodoEmPalavras(periodo.de, periodo.ate)

  const catalogosProntos =
    config !== undefined && selecao.data !== undefined

  const chaveDaAgenda = chaves.agenda({
    de: periodo.de,
    ate: periodo.ate,
    profissionalId: profissionalDaGrade,
    visao: visaoEfetiva,
  })

  /*
   * A GRADE SE ATUALIZA SOZINHA (change lembrete-com-botoes-de-resposta, D11): o toque da família
   * no lembrete — e a resolução da recepção — aparece para a profissional em até um minuto, sem
   * ninguém recarregar a página nem ir avisar.
   *
   * PAUSA quando uma busca tiraria a pessoa do lugar: um cartão no ar (arraste ou "Remarcar para…"
   * pelo teclado, que é o mesmo gesto — 2.5.7), a confirmação de→para aberta, ou o formulário de
   * agendamento aberto. Pausar é desligar o INTERVALO, nunca a consulta.
   */
  const atualizacaoPausada =
    arrastando || formularioAberto || pedidoDeRemarcacao !== null || cardEmRemarcacao !== null
  const ritmoDaAgenda = usarAgendaViva(chaveDaAgenda, atualizacaoPausada)

  const agenda = useQuery({
    queryKey: chaveDaAgenda,
    ...ritmoDaAgenda,
    // Dia/Semana filtram no servidor; a Visão Geral traz o dia inteiro e agrupa
    // no cliente — uma chamada em vez de 20 (design D5)
    queryFn: () => buscarAgenda({ ...periodo, profissionalId: profissionalDaGrade }),
    staleTime: TEMPO_AGENDA_MS,
    enabled: catalogosProntos,
  })

  /**
   * "Ver na agenda" de um recusado da baixa (D15): fecha o diálogo e leva o foco ao card. Mesmo
   * dia → o gatilho do card vira o destino do `focoAoFechar` do diálogo: o Radix devolve o foco
   * num `setTimeout(0)` no desmonte, e um rAF disparado daqui corria contra ele — na conferência
   * ao vivo (2026-09-11) o foco terminava no botão da barra, não no card. Outro dia → navega por
   * `?data=` (id, nunca nome de menor, na URL) e espera o card existir com o mesmo rAF da
   * remarcação, que insiste por 30 quadros e por isso vence o restore.
   */
  function localizarAgendamentoDaBaixa(id: number, dataDoAgendamento: string): void {
    setBaixaAberta(false)
    if (dataDoAgendamento === data) {
      cardAlvoDaBaixa.current = id
      return
    }
    atualizarUrl({ data: dataDoAgendamento })
    focarNoCardRemarcado(id)
  }

  /** O destino do foco ao fechar "Dar baixa": o card escolhido em "Ver na agenda", senão o botão. */
  function destinoDoFocoDaBaixa(): HTMLElement | null {
    const cardId = cardAlvoDaBaixa.current
    cardAlvoDaBaixa.current = null

    return (cardId === null ? null : gatilhoDoCard(cardId)) ?? refBotaoDarBaixa.current
  }

  function atualizarUrl(mudancas: Record<string, string | null>) {
    const proximos = new URLSearchParams(parametros)
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) {
        proximos.delete(chave)
      } else {
        proximos.set(chave, valor)
      }
    }
    setParametros(proximos, { replace: true })
  }

  // avança 7 dias só quando a semana está de fato na tela — degradada, o passo é de um dia,
  // senão o botão "próximo" pularia uma semana mostrando um dia
  const passoDoAvanco = visaoEfetiva === 'semana' ? 7 : 1

  // cor por especialidade (catálogo da seleção): o anel do avatar nos cabeçalhos da grade
  const corPorEspecialidade = useMemo(
    () => new Map((selecao.data?.especialidades ?? []).map((item) => [item.id, item.cor])),
    [selecao.data?.especialidades],
  )

  const grade = useMemo(() => {
    if (!catalogosProntos || agenda.data === undefined) {
      return null
    }
    const profissionaisDaVisao =
      visaoEfetiva === 'geral'
        ? listaDeProfissionais
        : listaDeProfissionais.filter((item) => item.id === profissionalDaGrade)

    return montarGrade({
      corPorEspecialidade,
      visao: visaoEfetiva,
      data,
      agendamentos: agenda.data,
      profissionais: profissionaisDaVisao,
      feriados: feriadosDaClinica,
      config: config as NonNullable<typeof config>,
    })
  }, [catalogosProntos, agenda.data, visaoEfetiva, data, listaDeProfissionais, profissionalDaGrade, feriadosDaClinica, config, corPorEspecialidade])

  // O que a região viva ANUNCIA é o que a grade DESENHA (code-reviewer CR-FP-02): a lista crua da
  // API pode trazer card de profissional sem coluna (inativado com agenda), e o leitor ouviria
  // "1 agendamento" com a tela dizendo "nenhum". Bloqueio não é agendamento.
  const atendimentosNaGrade = useMemo(
    () =>
      grade === null
        ? 0
        : grade.linhas.reduce(
            (total, linha) =>
              total
              + linha.celulas.reduce(
                (daLinha, celula) => daLinha + celula.cards.filter((card) => card.tipo === 'atendimento').length,
                0,
              ),
            0,
          ),
    [grade],
  )

  // A FAIXA de respostas ao lembrete conta o que a grade DESENHA — a mesma régua do anúncio acima:
  // cartão sem coluna não é destacável, então não pode ser contado (D9: sem leitura a mais)
  const contagemDasConfirmacoes = useMemo(
    () =>
      contarConfirmacoes(
        grade === null ? [] : grade.linhas.flatMap((linha) => linha.celulas.flatMap((celula) => celula.cards)),
      ),
    [grade],
  )
  const consultas = [configuracao, selecao, agenda]
  // A seleção traz TUDO o que a grade desenha (profissionais, cores, feriados): se ela cai, não
  // há grade para mostrar. Antes eram três consultas, e a de especialidades era tolerável — hoje
  // não existe mais "só a cor falhou".
  const essenciais = [configuracao, selecao, agenda]
  /*
   * A tela de erro só entra quando NÃO HÁ o que mostrar (achado CRB-01 / A11Y-BT-03 do gate).
   *
   * Com a agenda viva, a consulta do período busca sozinha de minuto em minuto. Decidir o erro por
   * `error != null` fazia uma falha dessa busca de FUNDO — um redeploy, um 502, o Wi-Fi do balcão —
   * trocar a grade inteira por "Não foi possível carregar a agenda.", com o foco caindo no `body`
   * e a rolagem perdida, no meio do trabalho de alguém. Com dado na tela, a falha vira o aviso
   * `falhouAoAtualizar`, logo abaixo, e a grade fica.
   */
  const erro = essenciais.find((consulta) => consulta.error != null && consulta.data === undefined)?.error
  const falhouAoAtualizar = agenda.isRefetchError

  /*
   * O aviso da falha sai da tela quando a busca volta — e, se o foco estava nele (a pessoa clicou em
   * "Tentar de novo" e deu certo), o foco iria para o `body` (achado A11Y-BT-12). Ele vai para a
   * GRADE, que é o padrão desta página para "o foco não pode evaporar" (ver `focarNoGatilhoDoCard`):
   * uma região rolável, focável e nomeada — e é o que acabou de ser atualizado. Na lista do celular,
   * que não tem esse contêiner, vai para o título da página.
   */
  const focoSaiuDoAviso = useRef(false)
  const refTitulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (falhouAoAtualizar || !focoSaiuDoAviso.current) {
      return
    }
    focoSaiuDoAviso.current = false
    const destino = document.querySelector<HTMLElement>('[data-grade-agenda]') ?? refTitulo.current
    destino?.focus()
  }, [falhouAoAtualizar])
  const carregando = !catalogosProntos || agenda.isPending

  // Refaz TODAS as que falharam (inclusive a acessória): se quem quebrou foi um
  // catálogo, refazer só a agenda deixaria o erro permanente (catalogosProntos
  // nunca ficaria true).
  function tentarNovamente(): void {
    for (const consulta of consultas) {
      if (consulta.error != null) {
        void consulta.refetch()
      }
    }
  }

  const nomeEmRemarcacao =
    cardEmRemarcacao?.paciente?.nome_social ?? cardEmRemarcacao?.paciente?.nome ?? 'o agendamento'

  /*
   * O que a região viva diz sobre o PERÍODO — e QUANDO diz (achado A11Y-BT-08 do gate).
   *
   * Ela anuncia o resultado da troca de período (4.1.3, SLH-01): "3 agendamentos em …". Derivada
   * da grade a cada render, ela passou a falar a cada busca de FUNDO que mudasse a contagem — um
   * agendamento novo de outra recepcionista e o leitor de tela interrompia quem trabalhava. Agora
   * o texto é FIXADO quando a pessoa muda dia, profissional ou visão (a chave do período), e só
   * muda sozinho para dizer que a atualização falhou e, depois, que voltou.
   *
   * É o padrão "guardar informação do render anterior" do React (estado ajustado no render, não
   * efeito): o texto novo já sai no mesmo commit, sem um quadro com o texto velho.
   */
  const chaveDoPeriodo = `${periodo.de}|${periodo.ate}|${profissionalDaGrade ?? 'todos'}|${visaoEfetiva}`
  const textoDoPeriodo =
    grade !== null && periodoLegivel !== null
      ? atendimentosNaGrade === 0
        ? `Nenhum agendamento em ${periodoLegivel}.`
        : `${atendimentosNaGrade} ${atendimentosNaGrade === 1 ? 'agendamento' : 'agendamentos'} em ${periodoLegivel}.`
      : null
  const [anuncioDoPeriodo, setAnuncioDoPeriodo] = useState<{
    chave: string
    /** O resultado da troca de período — fixado quando a pessoa muda dia, profissional ou visão. */
    textoDoPeriodo: string
    falhou: boolean
    /** A notícia da atualização (falhou / voltou), que fala POR CIMA do texto do período. */
    noticia: string | null
  } | null>(null)
  // um MODO (remarcar pelo teclado, marcar retorno) ocupa a mesma região viva
  const modoNaRegiao = cardEmRemarcacao !== null || nomeDoRetorno !== null
  /*
   * A VOLTA da atualização no modo retorno (achado A11Y-BT-20): a região da página está com o texto
   * do modo, e o aviso — que disse a falha (A11Y-BT-18) — sai da tela justamente quando a busca
   * volta. Quem diz a volta é uma região própria, que existe enquanto o modo retorno durar. O modo de
   * remarcar não precisa dela: ele PAUSA a atualização, então a volta não acontece no meio dele.
   */
  const [noticiaDoRetorno, setNoticiaDoRetorno] = useState('')
  if (nomeDoRetorno === null && noticiaDoRetorno !== '') {
    setNoticiaDoRetorno('')
  }
  if (textoDoPeriodo !== null) {
    if (anuncioDoPeriodo === null || anuncioDoPeriodo.chave !== chaveDoPeriodo) {
      setAnuncioDoPeriodo({
        chave: chaveDoPeriodo,
        textoDoPeriodo,
        falhou: falhouAoAtualizar,
        noticia: falhouAoAtualizar ? mensagemDaFalhaDeAtualizacao(agenda.dataUpdatedAt) : null,
      })
    } else if (anuncioDoPeriodo.falhou !== falhouAoAtualizar) {
      const voltouNoRetorno = !falhouAoAtualizar && nomeDoRetorno !== null
      setAnuncioDoPeriodo({
        ...anuncioDoPeriodo,
        falhou: falhouAoAtualizar,
        noticia: falhouAoAtualizar
          ? mensagemDaFalhaDeAtualizacao(agenda.dataUpdatedAt)
          : voltouNoRetorno
            ? null
            : 'A agenda voltou a se atualizar.',
      })
      // a falha zera a região do retorno, para a PRÓXIMA volta ser uma mudança de texto (e anunciada)
      setNoticiaDoRetorno(voltouNoRetorno ? 'A agenda voltou a se atualizar.' : '')
    } else if (modoNaRegiao && !falhouAoAtualizar && anuncioDoPeriodo.noticia !== null) {
      // "voltou a se atualizar" é notícia de UM momento: depois que um modo usou a região, a volta
      // dela é para o texto do período, e não para uma notícia que já passou (achado A11Y-BT-15).
      // A falha, não — enquanto ela durar, o aviso está na tela e a notícia continua verdadeira.
      setAnuncioDoPeriodo({ ...anuncioDoPeriodo, noticia: null })
    }
  }

  return (
    /*
      ALTURA CONTIDA a partir do `xl` (change agenda-no-mouse, D1/D4 — limiar revisto pelo gate).

      Sem ela a página inteira era o scroller vertical: 8290px de documento numa janela de
      986. Disso vinham os TRÊS sintomas do mouse — a roda morria sobre a grade (contêiner que
      rola em X prende o gesto e não repassa o delta; provado em caso mínimo), a barra
      horizontal ficava ~950px abaixo da dobra, e os cabeçalhos `sticky` não grudavam porque
      quem rolava era a página.

      **Por que `xl` e não `md`:** a linha de três colunas custa 576px irredutíveis (240 + 24 +
      24 + 288, com os dois painéis `shrink-0`) e o cromo do shell come 316. Abaixo de ~892px a
      linha simplesmente não cabe, e a grade recebia largura NEGATIVA — o documento voltava a
      rolar de lado. A primeira tentativa de conserto trocou a grade por lista no meio; não
      devolvia um pixel, porque o déficit é dos painéis, não do meio.

      Abaixo do `xl` os painéis EMPILHAM em largura cheia e a página rola, como no celular — e
      a grade, mesmo empilhada, MANTÉM altura própria (ver `grade-agenda`), para a roda do mouse
      não voltar a morrer em cima dela.
    */
    <div className="flex flex-col gap-6 xl:h-[calc(100dvh-var(--moldura-do-shell))] xl:min-h-0">
      {/* Região viva PERMANENTE do modo teclado (4.1.3): ela nasce VAZIA com a
          página e só o CONTEÚDO troca ao entrar/sair do modo — região criada
          já com o texto dentro não é anunciada de forma confiável. `sr-only`
          é position:absolute: não participa do gap deste flex. */}
      <p role="status" className="sr-only">
        {cardEmRemarcacao !== null
          ? `Remarcando ${nomeEmRemarcacao}: escolha um horário livre na grade. Esc cancela.`
          : // O modo retorno divide a MESMA região (os dois são "escolha um horário livre"), e a
            // remarcação tem precedência no anúncio porque é o modo que o usuário acabou de
            // acionar com o teclado. Chegar de `/pendencias` com o modo já ligado é estado da
            // página, não mudança — quem lê com leitor de tela encontra a faixa na ordem do
            // documento, antes da grade; o anúncio aqui serve à resolução ASSÍNCRONA do nome.
            nomeDoRetorno !== null
            ? `Marcando retorno de ${nomeDoRetorno}: escolha um horário livre na grade.`
            : // Fora dos modos, a região diz o RESULTADO da troca de período (4.1.3, a11y-auditor
              // SLH-01): "nenhum agendamento" ou quantos — o vazio desenhado é só visual. E a falha
              // da busca de fundo, quando acontece (ver `anuncioDoPeriodo`).
              anuncioDoPeriodo !== null && anuncioDoPeriodo.chave === chaveDoPeriodo
              ? (anuncioDoPeriodo.noticia ?? anuncioDoPeriodo.textoDoPeriodo)
              : null}
      </p>

      {nomeDoRetorno !== null ? (
        <p role="status" className="sr-only">
          {noticiaDoRetorno}
        </p>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          {/* `tabIndex={-1}`: destino do foco quando o aviso de falha some e não há grade (celular) */}
          <h1 ref={refTitulo} tabIndex={-1} className="text-display font-semibold text-texto">
            Agenda
          </h1>
          {/* `first-letter:uppercase` capitaliza SÓ na tela: a função devolve o pt-BR canônico
              (dia da semana em minúscula) e é isso que o leitor de tela e os testes leem. */}
          {periodoLegivel !== null ? (
            <p className="text-corpo text-texto-suave first-letter:uppercase">{periodoLegivel}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Segmento
            rotulo="Visão da agenda"
            opcoes={VISOES}
            valor={visao}
            aoMudar={(valor) => {
              atualizarUrl({ visao: valor })
            }}
          />

          {/* `flex-wrap` na PRÓPRIA linha: o pai já quebra, mas esta não quebrava, e o gesto
              "Desmarcar agenda" a esticou até a página rolar na horizontal em 390px (medido:
              457 num viewport de 390 — achado do gate, provado tirando só esse botão do DOM). */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Anterior · data · próximo são UM grupo encadeado (design D3): as bordas se
                fundem (`-ml-px`) e só as pontas têm raio. Três controles no DOM, como antes —
                o que mudou é a pele. `relative` + `z` no foco: sem isso o anel do controle do
                meio some sob a borda do vizinho. */}
            <div className="flex items-center rounded-botao shadow-e1">
              <Botao
                variante="secundario"
                tamanho="sm"
                aria-label="Período anterior"
                onClick={() => {
                  atualizarUrl({ data: somarDias(data, -passoDoAvanco) })
                }}
                className="relative rounded-r-none px-2 focus-visible:z-(--z-fixo)"
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </Botao>
              {/* Nunca o `<input type="date">`: no nativo, trocar o ANO é achar o segmento certo
                  e teclar setas — a recepção não conseguia (achado do usuário, 2026-09-02).
                  Aqui se digita `dd/mm/aaaa` ou se abre o calendário com mês e ano em listas. */}
              <SeletorDeData
                id="data-da-agenda"
                rotulo="Data da agenda"
                valor={data}
                hoje={hoje}
                encadeado
                aoMudar={(iso) => {
                  atualizarUrl({ data: iso })
                }}
              />
              <Botao
                variante="secundario"
                tamanho="sm"
                aria-label="Próximo período"
                onClick={() => {
                  atualizarUrl({ data: somarDias(data, passoDoAvanco) })
                }}
                className="relative -ml-px rounded-l-none px-2 focus-visible:z-(--z-fixo)"
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </Botao>
            </div>
            <Botao
              variante="secundario"
              tamanho="sm"
              onClick={() => {
                atualizarUrl({ data: null })
              }}
            >
              <CalendarCheck aria-hidden="true" className="size-4" />
              Hoje
            </Botao>
            {/* "Dar baixa" entre "Hoje" e "Desmarcar agenda" (nome congelado em agenda-grade):
                `secundario`, nunca a cor de perigo — dar baixa não destrói e é reversível linha a
                linha; dois blocos vermelhos lado a lado parecem com a referência (§2). O nome
                acessível CONTÉM o texto visível (2.5.3). */}
            {podeDarBaixa ? (
              <Botao
                ref={refBotaoDarBaixa}
                variante="secundario"
                tamanho="sm"
                aria-label="Dar baixa na agenda"
                onClick={() => {
                  setBaixaAberta(true)
                }}
              >
                <ListChecks aria-hidden="true" className="size-4" />
                Dar baixa
              </Botao>
            ) : null}
            {/* baixa em massa: só com UM profissional na tela — na visão geral não existe
                "a agenda dele" para desmarcar. `perigo-suave`: ação de IMPACTO fora do diálogo
                (§5.2) — visível, mas o sólido de perigo fica para a confirmação. */}
            {podeDesmarcarEmLote ? (
              <Botao
                variante="perigo-suave"
                tamanho="sm"
                onClick={() => {
                  setDesmarqueAberto(true)
                }}
              >
                <CalendarOff aria-hidden="true" className="size-4" />
                Desmarcar agenda
              </Botao>
            ) : null}
          </div>
        </div>
      </header>

      {/* A cara do modo RETORNO. Fica FORA da grade de propósito: o modo nasce da URL (não de um
          card já desenhado, como o de remarcação), então ele está ligado enquanto a agenda ainda
          carrega — e se a grade falhar. Uma faixa que só aparece no sucesso deixaria a recepção
          olhando um skeleton com o modo ativo e nada dizendo isso.

          Sem ela o modo seria estado invisível: a recepção clicaria num horário e veria uma
          criança aparecer "do nada" no formulário — ou marcaria para a criança errada sem
          entender por quê. Quem ANUNCIA é a região viva do topo; aqui é o que se VÊ (e o que se
          cancela). */}
      {/*
        O AVISO DA SEMANA DEGRADADA (design D6).

        Na TELA, e não toast: toast some, e quem chegou por link compartilhado com
        `visao=semana` nunca o veria — leria a agenda de um dia achando que é a da semana.

        A aba "Semana" continua marcada, porque a escolha continua sendo dela; o que mudou é
        o que cabe. Deixar a aba pular para "Dia" faria parecer que o clique não funcionou.
      */}
      {semanaDegradada ? (
        <div className="flex flex-wrap items-center gap-3 rounded-campo bg-info-suave px-3 py-2 text-rotulo font-medium text-info-texto">
          <span>
            A semana não cabe nesta tela — mostrando o dia. Gire o aparelho ou abra num monitor
            para ver a semana inteira.
          </span>
        </div>
      ) : null}

      {nomeDoRetorno !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-campo bg-info-suave px-3 py-2 text-rotulo font-medium text-info-texto">
          <span>Marcando retorno de {nomeDoRetorno}: escolha um horário livre na grade.</span>
          <Botao variante="fantasma" tamanho="sm" onClick={sairDoModoRetorno}>
            Cancelar retorno
          </Botao>
        </div>
      ) : null}

      {/*
        As três colunas — profissionais, grade e fila — EMPILHAM em tela estreita.

        Sem isto elas disputam a mesma linha e a página transborda a viewport: os textos se
        sobrepõem e sobra conteúdo fora da tela (achado da conferência ao vivo, 2026-08-26).
        Consertar o shell devolveu a largura à página, e revelou que a página tinha o mesmo
        defeito um nível abaixo.

        A GRADE vem primeiro no empilhamento (`order`), e não na ordem do DOM: a lista de
        profissionais é FILTRO, e pôr o filtro antes do conteúdo obrigaria a recepcionista a
        rolar vinte nomes para ver o primeiro agendamento do dia. Em tela larga a ordem visual
        é a do DOM, como sempre foi.
      */}
      {/* A LINHA das três colunas: ela toma a altura que sobra e cada coluna rola por dentro
          de si. É o que mata a CAUDA — a lista de espera com 60 entradas esticava a página a
          8290px e as outras duas colunas terminavam muito antes, deixando uma faixa de branco
          com a coluna da direita sozinha. `min-h-0` em cada elo: sem ele o item flex assume
          `min-height:auto` e volta a crescer com o conteúdo, que é o estado de antes. */}
      {/* montado SÓ quando aberto: o diálogo dispara a prévia sozinho ao montar (D4), e o estado
          (status marcado, alcance, prévia) nasce fresco a cada abertura */}
      {baixaAberta && podeDarBaixa && profissionalDoDesmarque !== undefined ? (
        <BaixaEmLote
          aberto
          aoFechar={() => {
            setBaixaAberta(false)
          }}
          profissionalId={profissionalDoDesmarque.id}
          nomeDoProfissional={profissionalDoDesmarque.nome}
          dataDaAgenda={data}
          hoje={hoje}
          status={selecao.data?.status ?? []}
          aoLocalizarAgendamento={localizarAgendamentoDaBaixa}
          focoAoFechar={destinoDoFocoDaBaixa}
        />
      ) : null}

      {podeDesmarcarEmLote && profissionalDoDesmarque !== undefined ? (
        <DesmarqueEmLote
          aberto={desmarqueAberto}
          aoFechar={() => {
            setDesmarqueAberto(false)
          }}
          profissionalId={profissionalDoDesmarque.id}
          nomeDoProfissional={profissionalDoDesmarque.nome}
          dataDaAgenda={data}
          status={selecao.data?.status}
          aoEscolherHorarioEspecifico={() => {
            // a outra saída do popup: volta para a grade, onde desmarcar UM agendamento já
            // é o fluxo de sempre (clicar o card → painel → status)
            setDesmarqueAberto(false)
          }}
        />
      ) : null}

      <div className="flex flex-col gap-6 xl:min-h-0 xl:flex-1 xl:flex-row">
        <ListaProfissionais
          profissionais={listaDeProfissionais}
          especialidades={selecao.data?.especialidades ?? []}
          // empilhada (768–1279): a lista cede o espaço vertical à grade, virando um seletor
          compacta={telaEmpilhada}
          selecionado={visao === 'geral' ? null : profissionalDaGrade}
          aoSelecionar={(profissionalId) => {
            atualizarUrl({
              profissional: profissionalId === null ? null : String(profissionalId),
              // escolher um profissional na visão geral leva para o dia dele
              ...(profissionalId !== null && visao === 'geral' ? { visao: 'dia' } : {}),
              // ...e "Todos os profissionais" leva para a visão que MOSTRA todos.
              //
              // Sem isto, o botão mentia: Dia é a visão de UM profissional (§6), então
              // limpar o filtro caía em silêncio no primeiro ativo — a grade continuava
              // mostrando uma pessoa só, com "Todos" aparentemente escolhido. Para a
              // recepção, o clique não fazia nada, e ela só via a clínica inteira se
              // descobrisse sozinha a aba "Visão geral". Botão que não faz o que promete é o
              // mesmo defeito do botão que promete o que o servidor nega; aqui quem nega é a
              // própria visão.
              ...(profissionalId === null && visao !== 'geral' ? { visao: 'geral' } : {}),
            })
          }}
        />

        <div className="order-first min-w-0 flex-1 md:order-none xl:flex xl:min-h-0 xl:flex-col">
          {/*
            Os QUATRO estados dividem a MESMA caixa (achado do gate).

            Só o ramo de sucesso tinha `md:flex-1`; os outros três colapsavam para a altura
            natural dentro de uma caixa de ~724px, com as duas colunas laterais de altura cheia
            ao lado. E o esqueleto reservava 496px onde a grade ocupa ~724 — o dado chegando
            empurrava a tela 228px para baixo, na tela mais usada da clínica.

            O esqueleto agora tem a FORMA da grade: faixa de cabeçalho fixa e linhas que
            dividem o que sobra, em vez de nove barras de altura fixa.
          */}
          {erro != null ? (
            <div className="xl:min-h-0 xl:flex-1">
              <EstadoErro mensagem="Não foi possível carregar a agenda." aoTentarNovamente={tentarNovamente} />
            </div>
          ) : carregando ? (
            <div aria-busy="true" className="flex flex-col gap-2 xl:min-h-0 xl:flex-1">
              <Skeleton className="h-10 w-full shrink-0" />
              {Array.from({ length: 8 }, (_, indice) => (
                <Skeleton key={indice} className="h-12 w-full shrink-0 xl:h-auto xl:flex-1" />
              ))}
            </div>
          ) : grade === null || grade.colunas.length === 0 || listaDeProfissionais.length === 0 ? (
            /*
              Sem profissional ativo, a SEMANA também cai aqui: as colunas dela são dias, então
              nunca ficavam vazias — e a grade aparecia inteira livre, sem ninguém para atender.
              A saída para o cadastro só aparece quando a lista está de fato vazia: com gente
              ativa, coluna nenhuma é um `?profissional=` fora da lista, e cadastrar outro
              profissional não resolveria (change o-sistema-avisa-o-que-falta).
            */
            <div className="xl:min-h-0 xl:flex-1">
              {/* `nivel={2}`: logo abaixo do h1 da página, como o vazio do período (o h3 pulava um nível) */}
              <EstadoVazio
                nivel={2}
                titulo="Nenhum profissional ativo na agenda"
                // neutra: a saída (cadastrar, ou a quem pedir) é a ação logo abaixo, conforme a permissão
                descricao="A grade aparece quando há um profissional ativo com janela de atendimento."
                acao={
                  listaDeProfissionais.length === 0 ? <AcaoDoPreRequisito para={CAMINHOS.profissional} /> : undefined
                }
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3 xl:min-h-0 xl:flex-1">
              {/* A busca de fundo falhou: a grade FICA, e o aviso diz de quando ela é (CRB-01). */}
              {falhouAoAtualizar ? (
                <AvisoDeAtualizacao
                  carregadoEm={agenda.dataUpdatedAt}
                  falhouEm={agenda.errorUpdatedAt}
                  tentando={agenda.isFetching}
                  aoTentarDeNovo={() => {
                    void agenda.refetch()
                  }}
                  aoSairComFoco={() => {
                    focoSaiuDoAviso.current = true
                  }}
                  regiaoDaPaginaOcupada={modoNaRegiao}
                />
              ) : null}

              {/* A faixa de respostas ao lembrete: acima da grade, com o que ela desenhou. Some
                  sozinha quando nenhum cartão do período teve lembrete. */}
              <FaixaDeConfirmacoes
                contagem={contagemDasConfirmacoes}
                destaque={destaqueDaConfirmacao}
                aoDestacar={setDestaqueDaConfirmacao}
              />

              {grade.vazia ? (
                <EstadoVazio
                  nivel={2}
                  className="py-6"
                  icone={<CalendarDays className="size-8" />}
                  titulo="Nenhum agendamento neste período"
                  descricao="Clique num horário livre da grade para marcar."
                  acao={
                    visaoEfetiva === 'semana' ? undefined : (
                      <Botao
                        variante="secundario"
                        tamanho="sm"
                        onClick={() => {
                          atualizarUrl({ visao: 'semana' })
                        }}
                      >
                        Ver a semana
                      </Botao>
                    )
                  }
                />
              ) : null}

              {/* O banner VISÍVEL do modo teclado (D3). Quem anuncia é a região
                  viva permanente no topo da página (4.1.3) — este bloco é só a
                  cara do modo; Esc (ou o botão) cancela sem efeito. */}
              {cardEmRemarcacao !== null ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-campo bg-info-suave px-3 py-2 text-rotulo font-medium text-info-texto">
                  <span className="flex items-center gap-2">
                    <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
                    {/* a menção ao Esc some no toque, onde não existe tecla — a saída ali é o
                        botão ao lado, que a change tornou alcançável no celular (DQ-08) */}
                    <span>
                      Remarcando {nomeEmRemarcacao}: escolha um horário livre na grade.
                      <span className="hidden pointer-fine:inline"> Esc cancela.</span>
                    </span>
                  </span>
                  {/* secundário, com borda: em `fantasma` lia como texto solto no aviso
                      (change botoes-com-nome-na-agenda) */}
                  <Botao variante="secundario" tamanho="sm" onClick={cancelarRemarcacao}>
                    Cancelar remarcação
                  </Botao>
                </div>
              ) : null}

              {/*
                A VISÃO GERAL vira LISTA em tela estreita (design D4).

                Só ela: a Dia é um profissional (uma coluna, cabe depois que o shell devolveu a
                largura) e a Semana degrada antes de chegar aqui. Construir a lista para a Dia
                seria trabalho onde não há defeito.

                A lista recebe a MESMA `grade` — é o que impede que as duas formas divirjam de
                recorte. O que muda é o desenho, nunca o que entra nele.
              */}
              {telaEstreita && visaoEfetiva === 'geral' ? (
                <ListaAgenda
                  grade={grade}
                  legenda={`Agenda — ${periodo.de}`}
                  destaque={destaqueDaConfirmacao}
                  aoAbrirCard={temPermissao('agenda.ver') ? abrirCardEmLeitura : undefined}
                  chipDoCard={(cardDaLista) =>
                    temPermissao('agenda.editar')
                    && cardDaLista.tipo === 'atendimento'
                    && cardDaLista.status !== null ? (
                      <MenuDeStatus card={cardDaLista} podeEditar />
                    ) : undefined
                  }
                />
              ) : (
              <GradeAgenda
                grade={grade}
                legenda={`Agenda — ${periodo.de} a ${periodo.ate}`}
                data={data}
                profissionalDaVisao={profissionalDaGrade}
                nomeDoProfissionalDaVisao={
                  listaDeProfissionais.find((item) => item.id === profissionalDaGrade)?.nome ?? null
                }
                podeCriar={temPermissao('agenda.criar')}
                podeEditar={temPermissao('agenda.editar')}
                podeVer={temPermissao('agenda.ver')}
                podeArrastar={podeArrastar}
                agora={agora}
                destaque={destaqueDaConfirmacao}
                aoMudarArrasto={setArrastando}
                aoSoltarCard={abrirConfirmacaoDeRemarcacao}
                aoRemarcarCard={iniciarRemarcacao}
                remarcando={cardEmRemarcacao}
                aoEscolherAlvo={(alvo) => {
                  if (cardEmRemarcacao === null) {
                    return
                  }
                  // mesma confirmação do arrasto (D3) — o modo termina aqui
                  setPedidoDeRemarcacao({ card: cardEmRemarcacao, alvo })
                  setCardEmRemarcacao(null)
                }}
                aoAbrirCard={abrirCardEmLeitura}
                aoMarcarNoSlot={(dados) => {
                  setNovoAgendamento(dados)
                  setEmEdicao(null)
                  setEncaixeDoFormulario(entradaDoEncaixe)
                  setFormularioAberto(true)
                }}
              />
              )}
            </div>
          )}
        </div>

        {/* a largura é do PAINEL, que é quem recolhe — a grade (min-w-0) ocupa o
            que ele devolver. Sem `lista_espera.ver` não há painel, nem trilho,
            nem botão: não se recolhe o que não existe. */}
        {podeVerFila ? (
          <PainelListaEspera
            profissionalId={profissionalDaGrade}
            encaixando={entradaDoEncaixe}
            podeEncaixar={podeEncaixar}
            aoEncaixar={(entrada) => {
              atualizarUrl({ encaixe: String(entrada.id) })
            }}
            aoCancelarEncaixe={() => {
              atualizarUrl({ encaixe: null })
            }}
          />
        ) : null}
      </div>

      {formularioAberto ? (
        <FormularioAgendamento
          aberto={formularioAberto}
          card={emEdicao}
          inicial={novoAgendamento}
          // encaixe só vale para agendamento NOVO (num slot livre) — abrir um
          // card existente é edição, não encaixe
          encaixe={emEdicao === null ? encaixeDoFormulario : null}
          aoEncaixado={() => {
            atualizarUrl({ encaixe: null })
          }}
          // ...e o mesmo vale para o retorno: abrir um card existente é edição, e a criança dele
          // é a que está gravada — não a que o modo trouxe. Não congelamos em estado (como a
          // entrada da fila): o paciente vem de leitura por-id, então não muda de identidade
          // debaixo do formulário.
          pacienteInicial={emEdicao === null ? retornoEmCurso : null}
          aoCriado={() => {
            // o retorno foi marcado (ou a recepção marcou outra coisa daqui): o modo cumpriu o
            // papel. Quem continuar sem horário futuro volta à fila sozinho — ela é DERIVADA.
            if (idDoRetorno !== null) {
              sairDoModoRetorno()
            }
          }}
          podeExcluir={temPermissao('agenda.excluir')}
          aoFechar={() => {
            setFormularioAberto(false)
            setEmEdicao(null)
            setNovoAgendamento(null)
            setEncaixeDoFormulario(null)
            // Os MODOS da URL (`?encaixe=`, `?paciente=`) NÃO caem aqui: cancelar o
            // formulário porque o slot era o errado deve deixar a recepção
            // escolher outro horário. O encaixe sai no sucesso (`aoEncaixado`) e no
            // "cancelar encaixe" do painel; o retorno, no sucesso (`aoCriado`) e no
            // "cancelar retorno" da faixa.
          }}
        />
      ) : null}

      <PainelAgendamento
        aberto={cardEmLeitura !== null}
        card={cardEmLeitura}
        aoFechar={() => {
          setCardEmLeitura(null)
        }}
        aoEditar={abrirFormularioDeEdicao}
        // a ação existe no painel sob as MESMAS condições do gesto (spec 2.5.7)
        aoRemarcar={podeArrastar ? iniciarRemarcacao : undefined}
      />

      {/* A confirmação de→para do arrasto/teclado: busca a versão FRESCA e só
          então dispara o MESMO PUT da edição — cancelar não emite nada (D2). */}
      <ConfirmacaoDeRemarcacao
        pedido={pedidoDeRemarcacao}
        profissionais={listaDeProfissionais}
        aoFechar={(resultado: ResultadoDaRemarcacao) => {
          const pedido = pedidoDeRemarcacao
          setPedidoDeRemarcacao(null)
          if (pedido === null) {
            return
          }
          // Foco pós-diálogo (2.4.3): o restore do Radix mira o que estava
          // focado ANTES de abrir (no arrasto, o body) — o destino certo é
          // declarado AQUI, um quadro depois do restore dele.
          if (resultado === 'sucesso') {
            focarNoCardRemarcado(pedido.card.id)
          } else {
            window.requestAnimationFrame(() => {
              focarNoGatilhoDoCard(pedido.card.id)
            })
          }
        }}
      />

      <PainelBloqueio
        aberto={bloqueioEmLeitura !== null}
        card={bloqueioEmLeitura}
        aoFechar={() => {
          setBloqueioEmLeitura(null)
        }}
        aoEditar={abrirFormularioDeEdicao}
      />
    </div>
  )
}
