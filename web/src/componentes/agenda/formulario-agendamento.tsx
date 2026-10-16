import { useQuery } from '@tanstack/react-query'
import { AlertDialog } from 'radix-ui'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import { SecaoAtendimento } from '@/componentes/atendimento/secao-atendimento'
import { AvisoDePreRequisito } from '@/componentes/ui/aviso-de-pre-requisito'
import { AvisoErro } from '@/componentes/ui/aviso-erro'
import { Botao } from '@/componentes/ui/botao'
import { CampoBusca, type OpcaoDeBusca } from '@/componentes/ui/campo-busca'
import { CampoCheckbox } from '@/componentes/ui/campo-checkbox'
import { CampoSelect } from '@/componentes/ui/campo-select'
import { CampoTexto } from '@/componentes/ui/campo-texto'
import { SeletorDeData } from '@/componentes/ui/seletor-de-data'
import { DialogConfirmacao } from '@/componentes/ui/dialog-confirmacao'
import { usarEscolhaDePaciente } from '@/hooks/usar-escolha-de-paciente'
import { usarMutacaoDeAgendamento } from '@/hooks/usar-mutacao-de-agendamento'
import { primeiroControleFocavel } from '@/lib/primeiro-controle-focavel'
import { caminhoDaFichaDoProfissional, caminhoDoPacoteDoPaciente } from '@/lib/caminhos-dos-cadastros'
import { chaves } from '@/lib/chaves-query'
import { nomeDoPaciente, tempoDeEspera } from '@/lib/fila-espera'
import { TEMPO_CATALOGO_MS } from '@/lib/query-client'
import { rotuloDoTratamento } from '@/lib/rotulo-de-tratamento'
import {
  buscarSelecaoDaAgenda,
  buscarTamanhoDaSerie,
  listarTratamentosDoPaciente,
} from '@/servicos/agenda'
import type {
  CardAgendamento,
  EntradaDaFila,
  PacienteDaBusca,
  PayloadAgendamento,
  PayloadEncaixe,
  SelecaoDaAgenda,
} from '@/tipos'

/** Valores do formulário — strings, como os controles falam. */
interface Formulario {
  bloqueio: boolean
  paciente: OpcaoDeBusca | null
  profissionalId: string
  especialidadeId: string
  tratamentoId: string
  salaId: string
  medicoId: string
  data: string
  hora: string
  duracao: string
  obs: string
  /** 0 = não repete; 1 = semanal; 2 = quinzenal; 3..8 = a cada N semanas. */
  recorrenciaCadencia: string
  /** Como a série termina: por data ou por número de sessões. */
  recorrenciaModo: 'ate' | 'ocorrencias'
  recorrenciaAte: string
  recorrenciaOcorrencias: string
  aplicarNaSerie: boolean
  /** Pedido de avisar a família pelo WhatsApp — só quando a edição muda dia, hora ou profissional */
  avisarFamilia: boolean
}

/** Espelho de `AgendamentoService::MAX_OCORRENCIAS_SERIE` — quem recusa é o servidor. */
const MAX_OCORRENCIAS_DA_SERIE = 52

/** O que a tela oferece; o contrato leva o NÚMERO de semanas (design D1). */
const OPCOES_DE_INTERVALO = [
  { valor: '0', rotulo: 'Não repete' },
  { valor: '1', rotulo: 'Toda semana' },
  { valor: '2', rotulo: 'A cada duas semanas (quinzenal)' },
  { valor: '3', rotulo: 'A cada três semanas' },
  { valor: '4', rotulo: 'A cada quatro semanas' },
  // MESES são cadência própria, não "quatro semanas": a cada ciclo o dia do mês se mantém
  // (change `recorrencia-mensal`). O prefixo `m` distingue a unidade no mesmo `<select>`.
  { valor: 'm1', rotulo: 'Todo mês' },
  { valor: 'm2', rotulo: 'A cada dois meses' },
]

/** Traduz a opção escolhida no `<select>` para a cadência que o contrato entende. */
function cadenciaDoValor(valor: string): { intervalo_semanas: number } | { intervalo_meses: number } | null {
  if (valor === '0') {
    return null
  }

  return valor.startsWith('m')
    ? { intervalo_meses: Number(valor.slice(1)) }
    : { intervalo_semanas: Number(valor) }
}

export interface FormularioAgendamentoProps {
  aberto: boolean
  aoFechar: () => void
  /** Edição quando presente; criação quando ausente */
  card?: CardAgendamento | null
  /** Pré-preenchimento vindo do slot livre clicado */
  inicial?: { profissionalId: number; inicio: string } | null
  /**
   * Modo ENCAIXE: o agendamento nasce de quem estava na fila. O paciente vem da
   * entrada e não é escolhido aqui (o servidor recusa `paciente_id`); a criação
   * vai para `POST /lista-espera/{id}/encaixar`, que agenda e tira da fila numa
   * transação só. Sem recorrência: encaixe é UM horário que abriu.
   */
  encaixe?: EntradaDaFila | null
  /** Encaixe CONCLUÍDO — a página sai do modo (a entrada não existe mais) */
  aoEncaixado?: () => void
  /**
   * Criação CONCLUÍDA (a comum, não o encaixe) — a página encerra o modo que a trouxe.
   *
   * Não distingue QUAL criança acabou salva (a recepção pode ter trocado no campo): a pendência
   * de retorno é DERIVADA, então quem continuar sem horário futuro reaparece na fila sozinho. Uma
   * segunda fonte da verdade para "já tratei" é exatamente o que a fila existe para não ter.
   */
  aoCriado?: () => void
  /**
   * Modo RETORNO: a criança já vem escolhida (a fila de pendências mandou o id na URL; o NOME
   * chegou por leitura por-id, nunca pela query string — gatilho `LOG`).
   *
   * Distinto de `encaixe` DE PROPÓSITO: aqui a criação é a comum (`POST /agendamentos`, o
   * `paciente_id` sai do formulário), então o campo segue **editável** — quem acionou a linha
   * errada da fila precisa poder trocar. Pendurar isto no `encaixe` mudaria de uma vez o título,
   * o payload, a recorrência e o campo de leitura.
   */
  pacienteInicial?: PacienteDaBusca | null
  podeExcluir?: boolean
}

const VAZIO: Formulario = {
  bloqueio: false,
  paciente: null,
  profissionalId: '',
  especialidadeId: '',
  tratamentoId: '',
  salaId: '',
  medicoId: '',
  data: '',
  hora: '',
  duracao: '',
  obs: '',
  recorrenciaCadencia: '0',
  recorrenciaModo: 'ocorrencias',
  recorrenciaAte: '',
  recorrenciaOcorrencias: '',
  aplicarNaSerie: false,
  avisarFamilia: false,
}

/** O rótulo do paciente pré-selecionado sai da MESMA regra do resto da tela: social antes do civil. */
function opcaoDoPacienteInicial(paciente: PacienteDaBusca): OpcaoDeBusca {
  return { valor: paciente.id, rotulo: paciente.nome_social ?? paciente.nome }
}

function doCard(card: CardAgendamento): Formulario {
  return {
    ...VAZIO,
    bloqueio: card.tipo === 'bloqueio',
    paciente:
      card.paciente !== null
        ? { valor: card.paciente.id, rotulo: card.paciente.nome_social ?? card.paciente.nome }
        : null,
    profissionalId: String(card.profissional_id),
    especialidadeId: card.especialidade !== null ? String(card.especialidade.id) : '',
    tratamentoId: card.tratamento_id !== null ? String(card.tratamento_id) : '',
    salaId: card.sala !== null ? String(card.sala.id) : '',
    data: card.inicio.slice(0, 10),
    hora: card.inicio.slice(11, 16),
    duracao: String(card.duracao_minutos),
    obs: card.obs ?? '',
  }
}

/**
 * Formulário de agendamento (criar e editar), sobre a grade.
 *
 * Três regras que vêm do parecer e não são negociáveis:
 * - **Modo bloqueio monta o payload pelo MODO** (T-aes-11): a API PROÍBE
 *   paciente/especialidade/tratamento/médico/status no bloqueio — não basta
 *   deixar os campos vazios.
 * - **Payload de série = só o que mudou** (D10): o servidor propaga para as
 *   irmãs o que o payload envia; mandar tudo ressuscitaria ocorrências
 *   desmarcadas e consumiria sessão delas.
 * - **Nenhum número inventado** (D9): o alcance da série vem do servidor.
 */
export function FormularioAgendamento({
  aberto,
  aoFechar,
  card = null,
  inicial = null,
  encaixe = null,
  aoEncaixado,
  aoCriado,
  pacienteInicial = null,
  podeExcluir = false,
}: FormularioAgendamentoProps) {
  const editando = card !== null
  const encaixando = !editando && encaixe !== null
  const [form, setForm] = useState<Formulario>(VAZIO)
  const [termoDoPaciente, setTermoDoPaciente] = useState('')
  const [iniciado, setIniciado] = useState(false)
  const [confirmandoSerie, setConfirmandoSerie] = useState(false)
  const [confirmandoTrocaDeCrianca, setConfirmandoTrocaDeCrianca] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  // escopo da EXCLUSÃO é decidido na hora de excluir — quem marcou "aplicar na
  // série" para reagendar não pode chegar ao dialog com a série pré-armada
  // (§4.4: a ação padrão é a mais estreita)
  const [excluirSerie, setExcluirSerie] = useState(false)
  // o paciente do modo retorno é adotado UMA vez por abertura (na abertura, ou quando a leitura
  // por-id chega atrasada); sem isto, limpar o campo o traria de volta sozinho
  const pacienteInicialAplicado = useRef(false)
  // Aberto pelo estado, sem `AlertDialog.Cancel`: o padrão do Radix deixava o foco no cartão da grade,
  // atrás do diálogo e numa árvore `aria-hidden` — 13 Tabs até o formulário (gate A11Y-EVO-R2-02)
  const refConteudo = useRef<HTMLDivElement>(null)
  const refDisparador = useRef<HTMLElement | null>(null)
  const idDoMotivoQueImpede = useId()
  const { criar, atualizar, excluir, encaixar, erros, limparErros, gravando } = usarMutacaoDeAgendamento()
  // A evolução escrita AQUI pode finalizar a sessão — e trocar a versão do agendamento. O próximo
  // "Salvar" usa a versão nova, senão o 409 acusava a própria pessoa (gate CR-EVO-04). Mas só quando a
  // versão de ANTES da finalização é a que este formulário abriu: se outra pessoa mudou o agendamento
  // enquanto a evolução era escrita, adotar a nova desfaria a mudança dela sem 409 (gate CR-EVO-R3-02).
  const [versaoDepoisDaEvolucao, setVersaoDepoisDaEvolucao] = useState<{ id: number; versao: string } | null>(null)
  // a versão de TODA escrita do Editar sai daqui — o salvar, a troca de criança e a série (CR-EVO-R2-04)
  const versaoVigente =
    card !== null && versaoDepoisDaEvolucao?.id === card.id ? versaoDepoisDaEvolucao.versao : (card?.updated_at ?? '')

  const selecao = useQuery({
    queryKey: chaves.selecaoDaAgenda(),
    queryFn: buscarSelecaoDaAgenda,
    staleTime: TEMPO_CATALOGO_MS,
    enabled: aberto,
  })

  // A busca só sai com 2+ caracteres (o servidor recusa menos), com debounce (o
  // A escolha de paciente inteira (lista ao abrir, busca ao digitar, guardas de log) vive
  // no hook: no ENCAIXE e no modo LEITURA ela fica DESLIGADA — não há campo, e consultar
  // mandaria o nome de um MENOR para a query string sem que ninguém tivesse digitado nada
  // (parecer code-review §2 e gate SEC F-02).
  const pacientes = usarEscolhaDePaciente({
    aberto,
    termo: termoDoPaciente,
    rotuloEscolhido: form.paciente?.rotulo ?? null,
    habilitado: !form.bloqueio && !encaixando,
  })

  const tratamentos = useQuery({
    queryKey: chaves.tratamentosDoPaciente(form.paciente?.valor ?? 0),
    queryFn: () => listarTratamentosDoPaciente(form.paciente?.valor ?? 0),
    enabled: aberto && !form.bloqueio && form.paciente !== null,
  })

  const serie = useQuery({
    queryKey: chaves.serieDoAgendamento(card?.id ?? 0),
    queryFn: () => buscarTamanhoDaSerie(card?.id ?? 0),
    enabled: aberto && card !== null,
    // Esta contagem entra na CONFIRMAÇÃO DE UMA EXCLUSÃO ("apagar N agendamentos desta
    // série"). Servida do cache de 5 min, ela mostra um número que já não é verdade — depois
    // de editar a série, reabrir o card confirmava a destruição de crianças com o total
    // VELHO. Invalidar não basta: query inativa invalidada só fica stale, e o primeiro render
    // do remount ainda serve o cache (re-review r8).
    gcTime: 0,
  })

  // Modo RETORNO — só na criação, e nunca junto do encaixe (que já traz paciente próprio, em campo
  // de leitura, e é a operação que o servidor vai consumir). Só o PACIENTE vem escolhido: a
  // especialidade válida depende do profissional do slot, e o tratamento depende dela —
  // pré-escolher aqui produziria combinação inválida (design D7).
  const aceitaPacienteInicial = card === null && encaixe === null

  // Preenche uma vez, na abertura (edição, slot clicado ou encaixe)
  if (aberto && !iniciado) {
    const base = card !== null ? doCard(card) : { ...VAZIO }
    if (card === null && inicial !== null) {
      base.profissionalId = String(inicial.profissionalId)
      base.data = inicial.inicio.slice(0, 10)
      base.hora = inicial.inicio.slice(11, 16)
    }
    if (encaixe !== null && card === null) {
      base.paciente = { valor: encaixe.paciente_id, rotulo: nomeDoPaciente(encaixe) }
      base.especialidadeId = encaixe.especialidade_id !== null ? String(encaixe.especialidade_id) : ''
    }
    // Modo RETORNO (regra e razão na declaração de `aceitaPacienteInicial`, acima)
    if (aceitaPacienteInicial && pacienteInicial !== null) {
      base.paciente = opcaoDoPacienteInicial(pacienteInicial)
      pacienteInicialAplicado.current = true
    }
    setForm(base)
    // o termo alimenta a BUSCA: no encaixe ele ficaria com o nome do menor sem
    // que exista campo de busca na tela
    setTermoDoPaciente(encaixe !== null && card === null ? '' : (base.paciente?.rotulo ?? ''))
    setIniciado(true)
  }

  /**
   * A CORRIDA da abertura: o slot pode ser clicado ANTES de a leitura por-id do modo retorno
   * resolver o nome (rede lenta, um retry). O pré-preenchimento acima roda uma vez só — então, sem
   * isto, a criança nunca entraria, e a faixa da agenda prometeria alguém que o campo não mostra.
   * É o "modo meio ligado" que o design D6 proíbe, na direção inversa da prevista.
   *
   * Adota UMA vez (o ref), e só enquanto ninguém tocou no campo: quem já escolheu outra criança não
   * pode ver a escolha trocada debaixo dos dedos — é o pior caso do produto (marcar sessão no menor
   * errado), e o único em que rótulo e id trocariam JUNTOS, invisíveis ao servidor.
   *
   * Quem digitou e APAGOU cai no caso "campo intocado" e recebe a criança do modo: é deliberado —
   * a faixa continua dizendo que o modo está ligado, e nada do que a pessoa escreveu sobreviveu.
   */
  useEffect(() => {
    if (!iniciado || !aceitaPacienteInicial || pacienteInicial === null) {
      return
    }
    if (pacienteInicialAplicado.current || form.paciente !== null || termoDoPaciente !== '') {
      return
    }
    const opcao = opcaoDoPacienteInicial(pacienteInicial)
    pacienteInicialAplicado.current = true
    setForm((atual) => ({ ...atual, paciente: opcao, tratamentoId: '' }))
    setTermoDoPaciente(opcao.rotulo)
  }, [iniciado, aceitaPacienteInicial, pacienteInicial, form.paciente, termoDoPaciente])

  function fechar() {
    setIniciado(false)
    pacienteInicialAplicado.current = false
    aoFechar()
  }

  const catalogos: SelecaoDaAgenda | undefined = selecao.data

  // Especialidades do profissional escolhido (N:M) — a API recusa as outras
  const especialidadesDoProfissional = useMemo(() => {
    const profissional = catalogos?.profissionais.find((item) => String(item.id) === form.profissionalId)
    return profissional?.especialidades ?? []
  }, [catalogos, form.profissionalId])

  /**
   * A especialidade que a tela realmente tem (parecer code-review §3).
   *
   * No ENCAIXE ela vem da entrada da fila, e o profissional é o do slot — que
   * pode não atendê-la ("abriu com outro profissional"). Sem isto, o select
   * mostraria o placeholder enquanto o payload mandaria a especialidade
   * escondida: 422 num campo que aparenta estar vazio. Aqui ela some do estado
   * efetivo, o `required` do campo barra o submit, e a recepção escolhe uma que
   * exista.
   */
  const especialidadeEfetiva =
    catalogos === undefined
      || especialidadesDoProfissional.some((item) => String(item.id) === form.especialidadeId)
      ? form.especialidadeId
      : ''

  /**
   * O profissional escolhido que não atende NENHUMA especialidade: o pré-requisito que falta para
   * marcar com ele (change `o-sistema-avisa-o-que-falta`). Antes, o campo Especialidade ficava mudo
   * em "Selecione…" e o encaixe desabilitava o botão sem dizer por quê.
   *
   * Sai do catálogo que o formulário já carrega — nenhuma requisição a mais. `null` também quando o
   * catálogo não chegou ou o profissional não está nele (inativo, na edição): sem saber, a tela não
   * afirma nada sobre o cadastro de ninguém. No bloqueio não há especialidade, e nada falta.
   */
  const profissionalSemEspecialidade = (() => {
    if (form.bloqueio) {
      return null
    }
    const profissional = catalogos?.profissionais.find((item) => String(item.id) === form.profissionalId)
    return profissional !== undefined && profissional.especialidades.length === 0 ? profissional : null
  })()

  /**
   * Por que o envio não pode sair — escrito acima dos botões, e o botão fica `aria-disabled`
   * apontando para esta frase (o padrão do `Botao`: inerte, mas focável para dizer o que falta).
   * `null` = nada impede.
   *
   * No ENCAIXE, sem especialidade o payload próprio sairia como `Number('') = 0`, e o servidor diria
   * "selecionado é inválido" em vez de "obrigatório" — por isso ele trava; mas travava calado.
   *
   * A frase se sustenta sozinha e é curta (gate DQA-AVI-06): quem a ouve pelo botão não está no campo
   * Especialidade, e o caminho para resolver já mora lá.
   */
  const motivoQueImpedeEnviar = (() => {
    const verbo = encaixando ? 'encaixar' : editando ? 'salvar' : 'marcar'
    if (profissionalSemEspecialidade !== null) {
      return `Não dá para ${verbo}: ${profissionalSemEspecialidade.nome} não tem especialidade cadastrada.`
    }
    if (encaixando && especialidadeEfetiva === '') {
      return 'Escolha a especialidade para encaixar.'
    }
    return null
  })()

  /**
   * Os pacotes do paciente, e o recorte que a tela oferece.
   *
   * O recorte é SÓ por especialidade (design D2): pacote de outra especialidade o servidor recusa
   * SEMPRE ("O tratamento é de outra especialidade"), em qualquer estado — esconder é honesto.
   * Vencido, parado, finalizado e saldo 0 CONTINUAM na lista, marcados no rótulo: para o
   * agendamento que já consumiu daquele pacote o servidor dispensa essa revalidação, e sumir com
   * ele faria o Salvar DESVINCULAR em silêncio o pacote que a sessão de fato usou.
   */
  const tratamentosDoPaciente = tratamentos.data ?? []

  /**
   * Pacote que a agenda ACEITA para este agendamento: da especialidade escolhida, em andamento,
   * não vencido e com saldo — os quatro motivos pelos quais o servidor recusa um tratamento.
   *
   * A lista cresce todo mês nesta clínica: a guia do convênio pede SEMPRE 10 sessões, e cada guia
   * nova é um pacote novo (Mariana, 2026-09-09). Oferecer os antigos, já fechados, encheria o
   * campo de opções mortas exatamente na hora de escolher.
   */
  const pacoteUsavel = (item: (typeof tratamentosDoPaciente)[number]): boolean =>
    String(item.especialidade_id) === especialidadeEfetiva
    && item.status === 'andamento'
    && !item.vencido
    && item.sessoes_saldo > 0

  /**
   * O pacote JÁ GRAVADO neste agendamento, enquanto ninguém trocar a especialidade.
   *
   * Ele é oferecido MESMO quando a agenda não o aceitaria mais (vencido, fechado, sem saldo, ou de
   * outra especialidade — estado que existe porque a propagação de série grava as irmãs sem
   * revalidar o domínio; parecer SEC-TNE-01). Escondê-lo faria o campo dizer "Sem tratamento" para
   * um agendamento que TEM tratamento, e salvar a sala ou a observação mandaria `tratamento_id:
   * null`, que o servidor lê como DESVINCULAR: o elo clínico-financeiro morreria em silêncio.
   * Quem recusa a incoerência é o servidor, em voz alta — nunca a tela, calada.
   *
   * Quem trocou a especialidade NESTA sessão não cai aqui: ali o campo esvazia à vista, no gesto.
   */
  const pacoteGravado = (() => {
    const gravado = card === null ? null : doCard(card)
    if (gravado === null || gravado.tratamentoId === '' || form.especialidadeId !== gravado.especialidadeId) {
      return null
    }
    return tratamentosDoPaciente.find((item) => String(item.id) === gravado.tratamentoId) ?? null
  })()

  /*
   * `especialidadeEfetiva === ''` fica FORA (parecer SEC-TNE-05): é o estado em que o profissional
   * deixou de atender a especialidade do agendamento — a especialidade do pacote bate, quem não a
   * atende é o profissional. Sem esta cláusula a ajuda dizia "está com um pacote de outra
   * especialidade", que é falso, e o pacote ganhava marcador que não descreve nada.
   */
  const pacoteGravadoIndisponivel =
    especialidadeEfetiva !== '' && pacoteGravado !== null && !pacoteUsavel(pacoteGravado)
      ? pacoteGravado
      : null

  const tratamentosOferecidos =
    especialidadeEfetiva === ''
      ? []
      : [
          ...tratamentosDoPaciente.filter(pacoteUsavel),
          ...(pacoteGravadoIndisponivel === null ? [] : [pacoteGravadoIndisponivel]),
        ]

  /**
   * O tratamento que a tela realmente tem — mesmo padrão (e mesma razão) da `especialidadeEfetiva`.
   *
   * Trocar o profissional zera a especialidade, e trocar a especialidade tira o pacote da lista.
   * Sem isto, o `tratamento_id` do pacote antigo continuaria no payload sem aparecer em campo
   * nenhum: 422 apontando para um campo que a recepção vê vazio. Nada é apagado por efeito
   * colateral — o estado digitado fica, o que muda é o que a tela mostra e envia.
   */
  /**
   * Enquanto a lista de pacotes não CHEGOU, a tela não sabe nada — e não sabendo, não mexe.
   *
   * Sem esta guarda (parecer CR-TNE-01, bloqueante), abrir a edição de um agendamento com a rota
   * dos pacotes ainda em voo — ou em erro — fazia `tratamentosOferecidos` vir vazia, o efetivo
   * virar `''` e o primeiro Salvar mandar `tratamento_id: null`, que o servidor lê como
   * DESVINCULAR. E era invisível: o campo já NASCIA "Sem tratamento", ninguém viu esvaziar. Pior
   * que perder o vínculo: numa sessão já consumida, o estorno DEVOLVE ao pacote uma sessão que
   * foi prestada. É a mesma razão da `especialidadeEfetiva` não julgar sem `catalogos`.
   */
  const listaDePacotesChegou = tratamentos.data !== undefined

  const tratamentoEfetivo =
    !listaDePacotesChegou
    || especialidadeEfetiva === '' // mesma família do parecer acima: sem especialidade efetiva a
    // lista curto-circuita para vazia, e derivar `''` daí desvincularia. Hoje isso não chega a
    // gravar (o campo Especialidade é `obrigatorio` e o form não tem `noValidate`, então o
    // navegador barra o submit) — a cláusula é defesa em profundidade, para o dia em que a
    // validação nativa sair do caminho. SEC-TNE-05.
    || tratamentosOferecidos.some((item) => String(item.id) === form.tratamentoId)
      ? form.tratamentoId
      : ''

  /**
   * O saldo do pacote escolhido — a sugestão do "quantas sessões" (design D4 da change do encaixe).
   *
   * É SUGESTÃO, nunca trava: a agenda marca o que a clínica combinou com a família, e o pacote
   * é o que foi vendido. Marcar 20 com 18 de saldo é rotina quando a família vai renovar — e a
   * trava de saldo já vive onde deve, no consumo da sessão, com o aviso de fim de pacote.
   */
  const saldoDoPacote =
    tratamentosOferecidos.find((item) => String(item.id) === tratamentoEfetivo)?.sessoes_saldo ?? null

  /** Só dá para escolher pacote depois do paciente E da especialidade — nesta ordem. */
  const placeholderDoTratamento =
    form.paciente === null
      ? 'Escolha o paciente antes'
      : especialidadeEfetiva === ''
        ? 'Escolha a especialidade antes'
        : undefined

  /**
   * Vazio explicativo: lista curta sem explicação vira "cadê o pacote?" no balcão. Quando a criança
   * não tem pacote que a agenda aceite, a frase ganha o caminho para cadastrá-lo (change
   * `o-sistema-avisa-o-que-falta`) — cada guia nova do convênio é um pacote novo.
   */
  const ajudaDoTratamento = ((): ReactNode => {
    if (pacoteGravadoIndisponivel !== null) {
      return String(pacoteGravadoIndisponivel.especialidade_id) === especialidadeEfetiva
        ? 'Este agendamento usa um pacote que a agenda não aceita mais — ele fica aqui para não se desfazer sozinho.'
        : 'Este agendamento está com um pacote de outra especialidade. Corrija a especialidade ou escolha "Sem tratamento".'
    }
    // a lista não chegou porque a consulta falhou: dizer "não tem pacote" — e oferecer cadastrar
    // um — seria afirmar sobre a criança o que a tela não sabe
    if (form.paciente !== null && tratamentos.isError && !listaDePacotesChegou) {
      return 'Não foi possível carregar os pacotes deste paciente.'
    }
    // enquanto a lista não chegou, a tela não AFIRMA nada sobre a criança (parecer SEC-TNE-04):
    // "não tem pacote cadastrado" durante o carregamento é uma frase falsa sobre um paciente real
    if (
      form.paciente === null
      || placeholderDoTratamento !== undefined
      || !listaDePacotesChegou
      || tratamentosOferecidos.length > 0
    ) {
      return 'Só os pacotes da especialidade escolhida.'
    }
    // tem pacote NESTA especialidade, mas nenhum que a agenda aceite: a recepção precisa saber
    // POR QUE a lista está vazia, senão ela procura o pacote que sabe que existe
    const oQueFalta =
      tratamentosDoPaciente.length === 0
        ? 'Este paciente não tem pacote cadastrado.'
        : tratamentosDoPaciente.some((item) => String(item.especialidade_id) === especialidadeEfetiva)
          ? 'Os pacotes desta especialidade estão fechados, vencidos ou sem saldo.'
          : 'Este paciente não tem pacote nesta especialidade.'

    return (
      <AvisoDePreRequisito
        para={caminhoDoPacoteDoPaciente(form.paciente.valor)}
        oQueFalta={oQueFalta}
        aoNavegar={fechar}
      />
    )
  })()

  const tempoDaEspecialidade = catalogos?.especialidades.find(
    (item) => String(item.id) === form.especialidadeId,
  )?.tempo_sessao

  const ajudaDaDuracao = (() => {
    if (form.bloqueio) {
      return 'Obrigatória no bloqueio.'
    }
    if (editando && card !== null) {
      return `Vazio mantém a duração atual (${card.duracao_minutos} min).`
    }
    return tempoDaEspecialidade !== undefined
      ? `Vazio herda ${tempoDaEspecialidade} min da especialidade.`
      : undefined
  })()

  /**
   * A edição mexeu no que a família precisa saber — dia, hora ou profissional (change
   * avisos-do-agendamento-por-whatsapp). Só então a caixa "Avisar a família" aparece, e ela nasce
   * desmarcada: avisa-se só quando foi a clínica que mudou.
   */
  const mudouHorario = (() => {
    if (!editando || card === null || form.bloqueio) {
      return false
    }
    const original = doCard(card)
    return form.data !== original.data || form.hora !== original.hora || form.profissionalId !== original.profissionalId
  })()

  function montarPayload(): PayloadAgendamento {
    const inicio = `${form.data} ${form.hora}`
    const duracao = form.duracao !== '' ? Number(form.duracao) : undefined

    // BLOQUEIO: o payload é montado pelo MODO — os campos clínicos nem existem
    if (form.bloqueio) {
      return {
        tipo: 'bloqueio',
        inicio,
        profissional_id: Number(form.profissionalId),
        duracao_minutos: duracao ?? null,
        sala_id: form.salaId !== '' ? Number(form.salaId) : null,
        obs: form.obs !== '' ? form.obs : null,
      }
    }

    const payload: PayloadAgendamento = {
      tipo: 'atendimento',
      inicio,
      profissional_id: Number(form.profissionalId),
      paciente_id: form.paciente?.valor ?? null,
      especialidade_id: form.especialidadeId !== '' ? Number(form.especialidadeId) : null,
      tratamento_id: tratamentoEfetivo !== '' ? Number(tratamentoEfetivo) : null,
      sala_id: form.salaId !== '' ? Number(form.salaId) : null,
      medico_id: form.medicoId !== '' ? Number(form.medicoId) : null,
      obs: form.obs !== '' ? form.obs : null,
    }

    // duração explícita só quando o usuário informou (senão a API herda da
    // especialidade — regra do servidor, não nossa)
    if (duracao !== undefined) {
      payload.duracao_minutos = duracao
    }
    const cadencia = editando ? null : cadenciaDoValor(form.recorrenciaCadencia)
    if (cadencia !== null) {
      // exatamente UM dos dois modos — o servidor recusa os dois juntos (design D2)
      payload.recorrencia =
        form.recorrenciaModo === 'ate'
          ? { ...cadencia, ate: form.recorrenciaAte }
          : { ...cadencia, ocorrencias: Number(form.recorrenciaOcorrencias) }
    }
    if (mudouHorario && form.avisarFamilia) {
      payload.avisar_familia = true
    }

    return payload
  }

  /**
   * Payload da SÉRIE (D10): o servidor propaga para as irmãs exatamente o que o
   * payload traz. Enviar o formulário inteiro gravaria o status e a observação
   * DESTE card em todas as futuras — ressuscitando ocorrências desmarcadas e
   * consumindo sessão delas. Vai só o que mudou + o que o PUT exige.
   */
  function montarPayloadDaSerie(): PayloadAgendamento {
    const original = card !== null ? doCard(card) : VAZIO
    const payload: PayloadAgendamento = {
      inicio: `${form.data} ${form.hora}`,
      profissional_id: Number(form.profissionalId),
      aplicar_na_serie: true,
    }

    if (form.duracao !== original.duracao && form.duracao !== '') {
      payload.duracao_minutos = Number(form.duracao)
    }
    if (form.salaId !== original.salaId) {
      payload.sala_id = form.salaId !== '' ? Number(form.salaId) : null
    }
    if (form.especialidadeId !== original.especialidadeId && form.especialidadeId !== '') {
      payload.especialidade_id = Number(form.especialidadeId)
    }
    if (form.medicoId !== original.medicoId) {
      payload.medico_id = form.medicoId !== '' ? Number(form.medicoId) : null
    }
    if (mudouHorario && form.avisarFamilia) {
      payload.avisar_familia = true
    }
    // `status_id` e `obs` NUNCA vão na série — são do card, não da série.
    // `paciente_id` e `tratamento_id` também não: mudar o paciente de uma série
    // inteira não é reagendamento, é outra coisa (o formulário barra a edição
    // desses campos com "aplicar na série" marcado).

    return payload
  }

  /**
   * O que o usuário mexeu e a série NÃO leva (SEC-A2). O payload de série
   * deixa esses campos de fora de propósito (D10) — mas descartar em silêncio,
   * e ainda dizer "salvo", seria mentir. Ou o campo é editável, ou o usuário
   * sabe que ele não vai.
   */
  const alteradosForaDaSerie: string[] = (() => {
    if (!editando || card === null || !form.aplicarNaSerie) {
      return []
    }
    const original = doCard(card)
    const mudou: string[] = []
    if (form.obs !== original.obs) {
      mudou.push('observação')
    }
    if (form.paciente?.valor !== original.paciente?.valor) {
      mudou.push('paciente')
    }
    // `form.tratamentoId`, NUNCA o efetivo (parecer CR-TNE-02): este aviso é sobre o que a PESSOA
    // mexeu. Com o efetivo, trocar a especialidade com "aplicar na série" marcado acusava o campo
    // Tratamento — que ninguém tocou — e DESABILITAVA o Salvar, mandando "desfazer" o que ela fez
    // de propósito. A incoerência que sobra é do servidor recusar em voz alta, como antes.
    if (form.tratamentoId !== original.tratamentoId) {
      mudou.push('tratamento')
    }
    // o TIPO também não vai na série — e, pior, omiti-lo do payload contornaria
    // em silêncio a própria guarda do servidor ("não é possível mudar o tipo
    // aplicando na série"), que nunca dispararia (SEC-A5)
    if (form.bloqueio !== original.bloqueio) {
      mudou.push('bloqueio de agenda')
    }
    return mudou
  })()

  /**
   * Payload do ENCAIXE: sem `paciente_id` (o servidor o toma da entrada — mandá-lo
   * é 422) e sem recorrência. O resto é o mesmo horário que o formulário monta.
   */
  function montarPayloadDoEncaixe(): PayloadEncaixe {
    const duracao = form.duracao !== '' ? Number(form.duracao) : undefined

    return {
      inicio: `${form.data} ${form.hora}`,
      profissional_id: Number(form.profissionalId),
      especialidade_id: Number(especialidadeEfetiva),
      ...(duracao !== undefined ? { duracao_minutos: duracao } : {}),
      tratamento_id: tratamentoEfetivo !== '' ? Number(tratamentoEfetivo) : null,
      sala_id: form.salaId !== '' ? Number(form.salaId) : null,
      medico_id: form.medicoId !== '' ? Number(form.medicoId) : null,
      obs: form.obs !== '' ? form.obs : null,
    }
  }

  function submeter(evento: React.FormEvent) {
    evento.preventDefault()

    // o botão é `aria-disabled` (inerte por contrato, não pelo navegador), e o Enter num campo
    // também submete: a trava mora aqui
    if (motivoQueImpedeEnviar !== null) {
      return
    }

    if (encaixando && encaixe !== null) {
      encaixar.mutate(
        { entradaId: encaixe.id, payload: montarPayloadDoEncaixe() },
        {
          onSuccess: () => {
            aoEncaixado?.()
            fechar()
          },
        },
      )
      return
    }

    if (editando && card !== null) {
      // Aplicar na série atinge ocorrências que NÃO estão na tela: confirma
      // antes, com o número que veio do servidor (checklist §4.5)
      if (form.aplicarNaSerie) {
        setConfirmandoSerie(true)
        return
      }
      // Trocar a criança é a única edição da agenda que muda DE QUEM é o registro —
      // e o erro que ela corrige (irmãos, nomes parecidos no autocomplete) nasce de um
      // CLIQUE. Uma confirmação de um clique seria respondida pelo mesmo reflexo que
      // causou o engano: aqui a palavra é DIGITADA.
      if (trocouDeCrianca) {
        // A recusa da tentativa ANTERIOR não pode sobreviver à próxima: eu abri o diálogo
        // depois de DESFAZER o atendimento e ele ainda dizia "já tem atendimento
        // registrado" — uma tela que mente sobre o estado atual, e sobre a única coisa que
        // a pessoa precisa saber ali. (Achado dirigindo a app.)
        limparErros()
        setConfirmandoTrocaDeCrianca(true)
        return
      }
      atualizar.mutate({ id: card.id, payload: montarPayload(), versao: versaoVigente }, { onSuccess: fechar })
      return
    }

    criar.mutate(montarPayload(), {
      onSuccess: () => {
        aoCriado?.()
        fechar()
      },
    })
  }

  /**
   * Trocou a criança? Só na edição INDIVIDUAL: o payload da série já deixa
   * `paciente_id` de fora de propósito (D10), e o formulário avisa o usuário disso.
   */
  const trocouDeCrianca =
    editando &&
    card !== null &&
    !form.aplicarNaSerie &&
    form.paciente?.valor !== undefined &&
    form.paciente.valor !== doCard(card).paciente?.valor

  const criancaAtual = card?.paciente?.nome_social ?? card?.paciente?.nome ?? '—'
  const criancaNova = form.paciente?.rotulo ?? '—'

  /** A recusa do servidor, trazida para DENTRO do diálogo (o campo dela fica atrás dele). */
  const recusaDaTroca = [erros.porCampo.paciente_id, ...erros.gerais].filter(
    (mensagem): mensagem is string => mensagem !== undefined && mensagem !== '',
  )

  function confirmarTrocaDeCrianca() {
    if (card === null) {
      return
    }
    // promessa que REJEITA na recusa do servidor: o 422 do PAC-REP (agendamento já
    // atendido) tem que aparecer DENTRO do diálogo, não sumir num toast
    return new Promise<void>((resolver, rejeitar) => {
      atualizar.mutate(
        { id: card.id, payload: montarPayload(), versao: versaoVigente },
        {
          onSuccess: () => {
            setConfirmandoTrocaDeCrianca(false)
            fechar()
            resolver()
          },
          onError: () => {
            rejeitar(new Error('recusado'))
          },
        },
      )
    })
  }

  function confirmarSerie() {
    if (card === null) {
      return
    }
    // devolve promessa que REJEITA na recusa: sem isso o dialog fecharia como
    // se tivesse dado certo (mesmo defeito que o gate achou no chip de status)
    return new Promise<void>((resolver, rejeitar) => {
      atualizar.mutate(
        { id: card.id, payload: montarPayloadDaSerie(), versao: versaoVigente },
        {
          onSuccess: () => {
            setConfirmandoSerie(false)
            fechar()
            resolver()
          },
          onError: () => {
            rejeitar(new Error('recusado'))
          },
        },
      )
    })
  }

  const alcanceDaSerie = serie.data?.futuros ?? 0
  const emSerie = serie.data?.em_serie === true
  const nomeDoAlvo =
    card?.paciente?.nome_social ?? card?.paciente?.nome ?? (card?.tipo === 'bloqueio' ? 'bloqueio' : 'este horário')

  function confirmarExclusao() {
    if (card === null) {
      return
    }
    return new Promise<void>((resolver, rejeitar) => {
      excluir.mutate(
        { id: card.id, aplicarNaSerie: excluirSerie },
        {
          onSuccess: () => {
            setConfirmandoExclusao(false)
            fechar()
            resolver()
          },
          // mantém o dialog aberto: a recusa (sessão consumida, atendimento
          // registrado) já apareceu no toast e no aviso — e o motivo é acionável
          onError: () => {
            rejeitar(new Error('recusado'))
          },
        },
      )
    })
  }

  /** O número SEMPRE vem do servidor — a grade não conhece a série inteira (D9). */
  const consequenciaDaExclusao = (() => {
    const quando = card !== null ? `${card.inicio.slice(8, 10)}/${card.inicio.slice(5, 7)} às ${card.inicio.slice(11, 16)}` : ''

    if (!emSerie) {
      return `O agendamento de ${quando} será excluído. Esta ação não pode ser desfeita.`
    }
    if (excluirSerie) {
      const total = serie.data?.a_partir_deste ?? 0
      return `Este agendamento (${quando}) e os seguintes da série serão excluídos — ${total} no total, inclusive os que estão fora do período que você está vendo. Os anteriores permanecem.`
    }
    return `Só o agendamento de ${quando} será excluído. Os outros ${alcanceDaSerie} da série permanecem.`
  })()

  return (
    <AlertDialog.Root open={aberto} onOpenChange={(estado) => !estado && fechar()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-(--z-scrim) bg-texto/40" />
        <AlertDialog.Content
          ref={refConteudo}
          className="fixed left-1/2 top-1/2 z-(--z-dialogo) max-h-[90vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-janela bg-superficie-elevada p-6 shadow-e3"
          onOpenAutoFocus={(evento) => {
            evento.preventDefault()
            // o `body` não é quem abriu: pelo painel, o menu e o painel fecham antes, e o foco já está no
            // fundo da página — guardá-lo devolvia o foco ao fundo (medido no navegador)
            const ativo = document.activeElement
            refDisparador.current = ativo instanceof HTMLElement && ativo !== document.body ? ativo : null
            const alvo = primeiroControleFocavel(refConteudo.current) ?? refConteudo.current
            alvo?.focus()
            // se o foco não entrou (um controle que o estilo esconde de um jeito não previsto), o diálogo o recebe
            if (refConteudo.current !== null && !refConteudo.current.contains(document.activeElement)) {
              refConteudo.current.focus()
            }
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault()
            // quem abriu pode ter sumido (o item do menu do painel, que fecha ao editar): aí o foco
            // volta ao cartão do agendamento na grade, e não ao `body`
            const disparador = refDisparador.current?.isConnected === true ? refDisparador.current : null
            const doCartao =
              card !== null ? document.querySelector<HTMLElement>(`[data-card-id="${card.id}"] button`) : null
            const destino = disparador ?? doCartao
            destino?.focus()
            refDisparador.current = null
          }}
        >
          <AlertDialog.Title className="text-titulo font-semibold text-texto">
            {encaixando ? 'Encaixar da lista de espera' : editando ? 'Editar agendamento' : 'Novo agendamento'}
          </AlertDialog.Title>
          <AlertDialog.Description className="sr-only">
            Preencha os dados do agendamento.
          </AlertDialog.Description>

          <form onSubmit={submeter} className="mt-5 flex flex-col gap-4">
            <AvisoErro mensagens={erros.gerais} />

            {/* encaixe é sempre atendimento: bloqueio não tem paciente */}
            {!encaixando ? (
              <CampoCheckbox
                rotulo="Bloqueio de agenda (evento sem paciente)"
                marcado={form.bloqueio}
                aoMudar={(marcado) => {
                  setForm((atual) => ({ ...atual, bloqueio: marcado }))
                }}
                ajuda="A observação vira o rótulo da faixa na grade."
              />
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CampoSelect
                rotulo="Profissional"
                obrigatorio
                value={form.profissionalId}
                onChange={(evento) => {
                  setForm((atual) => ({ ...atual, profissionalId: evento.target.value, especialidadeId: '' }))
                }}
                opcoes={(catalogos?.profissionais ?? []).map((item) => ({
                  valor: String(item.id),
                  rotulo: item.nome,
                }))}
                placeholder="Selecione…"
                erro={erros.porCampo.profissional_id}
              />

              {/* No encaixe o paciente NÃO se escolhe: é quem estava na fila (o
                  servidor recusa `paciente_id`). Campo de leitura, com a espera
                  à vista — quem encaixa precisa saber há quanto tempo. */}
              {encaixando && encaixe !== null ? (
                <div className="flex flex-col gap-1">
                  <span className="text-meta font-medium text-texto">Paciente</span>
                  <p className="rounded-campo border border-borda-campo bg-fundo px-3 py-2 text-corpo text-texto">
                    {nomeDoPaciente(encaixe)}
                  </p>
                  <span className="text-meta text-texto-suave">
                    Na lista de espera {tempoDeEspera(encaixe.created_at)}.
                  </span>
                </div>
              ) : null}

              {!form.bloqueio && !encaixando ? (
                <CampoBusca
                  rotulo="Paciente"
                  obrigatorio
                  placeholder="Buscar ou escolher…"
                  selecionado={form.paciente}
                  aoSelecionar={(opcao) => {
                    setForm((atual) => ({ ...atual, paciente: opcao, tratamentoId: '' }))
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
              ) : null}
            </div>

            {/* 2fr/3fr, e não 50/50: o rótulo do pacote é o texto mais longo do formulário
                (especialidade + saldo + situação), e em coluna de 50% ele era CORTADO no meio da
                palavra — select nativo corta, não põe reticências. A linha de data/hora/duração
                já quebra o ritmo de duas colunas; esta acompanha. */}
            {!form.bloqueio ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[2fr_3fr]">
                <CampoSelect
                  rotulo="Especialidade"
                  obrigatorio
                  value={especialidadeEfetiva}
                  onChange={(evento) => {
                    setForm((atual) => ({ ...atual, especialidadeId: evento.target.value }))
                  }}
                  opcoes={especialidadesDoProfissional.map((item) => ({
                    valor: String(item.id),
                    rotulo: item.nome,
                  }))}
                  placeholder={
                    form.profissionalId === ''
                      ? 'Escolha o profissional antes'
                      : profissionalSemEspecialidade !== null
                        ? 'Sem especialidade'
                        : 'Selecione…'
                  }
                  ajuda={
                    profissionalSemEspecialidade !== null ? (
                      <AvisoDePreRequisito
                        para={caminhoDaFichaDoProfissional(profissionalSemEspecialidade.id)}
                        oQueFalta={`${profissionalSemEspecialidade.nome} não tem especialidade cadastrada, e a sessão precisa de uma.`}
                        aoNavegar={fechar}
                      />
                    ) : encaixando && especialidadeEfetiva === '' && form.especialidadeId !== '' ? (
                      'Este profissional não atende a especialidade que o paciente esperava — escolha uma que ele atenda.'
                    ) : (
                      // encurtada quando a coluna estreitou (2fr/3fr): a inteira quebrava
                      // em duas linhas ao lado de uma ajuda de uma só, e o rótulo do campo já
                      // diz "Especialidade"
                      'Só as que o profissional atende.'
                    )
                  }
                  erro={erros.porCampo.especialidade_id}
                />

                <CampoSelect
                  rotulo="Tratamento"
                  value={tratamentoEfetivo}
                  onChange={(evento) => {
                    setForm((atual) => ({ ...atual, tratamentoId: evento.target.value }))
                  }}
                  /* "Sem tratamento" é OPÇÃO, não placeholder: como placeholder ele nasce
                     `disabled`, e quem vinculava um pacote não tinha caminho de volta pela tela —
                     embora o servidor aceite a desvinculação (design D5). O placeholder fica só
                     para os estados em que ainda não dá para escolher. */
                  opcoes={
                    placeholderDoTratamento !== undefined
                      ? []
                      : [
                          { valor: '', rotulo: 'Sem tratamento' },
                          /* o valor gravado precisa de uma opção enquanto a lista não chega, senão
                             o `<select>` desenha VAZIO e a tela mente sobre o que vai enviar */
                          ...(!listaDePacotesChegou && form.tratamentoId !== ''
                            ? [
                                {
                                  valor: form.tratamentoId,
                                  rotulo: tratamentos.isError
                                    ? 'Pacote deste agendamento — não foi possível carregar a lista'
                                    : 'Carregando o pacote deste agendamento…',
                                },
                              ]
                            : []),
                          ...tratamentosOferecidos.map((tratamento) => ({
                            valor: String(tratamento.id),
                            rotulo:
                              rotuloDoTratamento(
                                tratamento,
                                catalogos?.especialidades ?? [],
                                tratamentosDoPaciente,
                              ) +
                              (tratamento.id === pacoteGravadoIndisponivel?.id
                                && String(tratamento.especialidade_id) !== especialidadeEfetiva
                                ? ' · de outra especialidade'
                                : ''),
                          })),
                        ]
                  }
                  placeholder={placeholderDoTratamento}
                  ajuda={ajudaDoTratamento}
                  erro={erros.porCampo.tratamento_id}
                />
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <span className="text-rotulo font-medium text-texto">
                  Data <span className="text-texto-suave">(obrigatório)</span>
                </span>
                {/* o seletor da casa, nunca `type="date"` cru: o campo nativo desenha
                    mm/dd/aaaa no navegador em inglês — e foi assim que ele apareceu na
                    captura do manual, "09/03/2026" para 3 de setembro. Data americana na
                    agenda é o erro mais caro que existe aqui (08/28 × 28/08), e a barra da
                    agenda já tinha trocado por isso; o formulário tinha ficado para trás. */}
                <SeletorDeData
                  rotulo="Data do agendamento"
                  valor={form.data}
                  aoMudar={(data) => {
                    setForm((atual) => ({ ...atual, data }))
                  }}
                />
                {erros.porCampo.inicio !== undefined ? (
                  <span className="text-meta text-perigo-texto">{erros.porCampo.inicio}</span>
                ) : null}
              </div>
              <CampoTexto
                rotulo="Hora"
                type="time"
                obrigatorio
                value={form.hora}
                onChange={(evento) => {
                  setForm((atual) => ({ ...atual, hora: evento.target.value }))
                }}
              />
              <CampoTexto
                rotulo="Duração (min)"
                type="number"
                value={form.duracao}
                onChange={(evento) => {
                  setForm((atual) => ({ ...atual, duracao: evento.target.value }))
                }}
                obrigatorio={form.bloqueio}
                // herdar da especialidade é regra de CRIAÇÃO; na edição, deixar
                // vazio PRESERVA a duração atual (a API mudou no gate — a ajuda
                // não pode prometer o contrato antigo)
                ajuda={ajudaDaDuracao}
                erro={erros.porCampo.duracao_minutos ?? erros.porCampo.fim}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CampoSelect
                rotulo="Sala"
                value={form.salaId}
                onChange={(evento) => {
                  setForm((atual) => ({ ...atual, salaId: evento.target.value }))
                }}
                opcoes={(catalogos?.salas ?? []).map((sala) => ({ valor: String(sala.id), rotulo: sala.nome }))}
                placeholder="Sem sala"
                erro={erros.porCampo.sala_id}
              />

              {!form.bloqueio ? (
                <CampoSelect
                  rotulo="Médico solicitante"
                  value={form.medicoId}
                  onChange={(evento) => {
                    setForm((atual) => ({ ...atual, medicoId: evento.target.value }))
                  }}
                  opcoes={(catalogos?.medicos ?? []).map((medico) => ({
                    valor: String(medico.id),
                    rotulo: medico.nome,
                  }))}
                  placeholder="Sem médico"
                  erro={erros.porCampo.medico_id}
                />
              ) : null}
            </div>

            <CampoTexto
              rotulo={form.bloqueio ? 'Rótulo do bloqueio' : 'Observação'}
              value={form.obs}
              onChange={(evento) => {
                setForm((atual) => ({ ...atual, obs: evento.target.value }))
              }}
              erro={erros.porCampo.obs}
            />

            {/* encaixe é um horário que abriu, não uma série (a API recusa) */}
            {!editando && !form.bloqueio && !encaixando ? (
              <div className="flex flex-col gap-3">
                <CampoSelect
                  rotulo="Repetir"
                  value={form.recorrenciaCadencia}
                  opcoes={OPCOES_DE_INTERVALO}
                  onChange={(evento) => {
                    const escolhido = evento.target.value
                    setForm((atual) => ({
                      ...atual,
                      recorrenciaCadencia: escolhido,
                      // ligar a repetição com um pacote escolhido sugere o SALDO dele (design D4):
                      // é o gesto que a clínica descreve — "marque o que falta do pacote". Só
                      // sugere com o campo vazio; número digitado não é sobrescrito.
                      recorrenciaOcorrencias:
                        escolhido !== '0' && atual.recorrenciaOcorrencias === '' && saldoDoPacote !== null
                          ? String(saldoDoPacote)
                          : atual.recorrenciaOcorrencias,
                    }))
                  }}
                  ajuda="A série é tudo-ou-nada: se qualquer data conflitar, nada é criado."
                />

                {form.recorrenciaCadencia !== '0' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <CampoSelect
                      rotulo="Terminar"
                      value={form.recorrenciaModo}
                      opcoes={[
                        { valor: 'ocorrencias', rotulo: 'Depois de N sessões' },
                        { valor: 'ate', rotulo: 'Na data' },
                      ]}
                      onChange={(evento) => {
                        setForm((atual) => ({
                          ...atual,
                          recorrenciaModo: evento.target.value === 'ate' ? 'ate' : 'ocorrencias',
                        }))
                      }}
                    />

                    {form.recorrenciaModo === 'ocorrencias' ? (
                      <CampoTexto
                        rotulo="Quantas sessões"
                        type="number"
                        min={1}
                        max={MAX_OCORRENCIAS_DA_SERIE}
                        value={form.recorrenciaOcorrencias}
                        onChange={(evento) => {
                          setForm((atual) => ({ ...atual, recorrenciaOcorrencias: evento.target.value }))
                        }}
                        ajuda={
                          saldoDoPacote === null
                            ? `Contando esta. No máximo ${String(MAX_OCORRENCIAS_DA_SERIE)}.`
                            : `Contando esta. O pacote tem ${String(saldoDoPacote)} sessões a fazer.`
                        }
                      />
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="text-rotulo font-medium text-texto">Até a data</span>
                        {/* o seletor da casa, nunca `type="date"` cru: o campo nativo desenha
                            mm/dd/aaaa no navegador em inglês, e data americana na agenda é o
                            convite ao erro mais caro que existe aqui (08/28 × 28/08) */}
                        <SeletorDeData
                          rotulo="Repetir até a data"
                          valor={form.recorrenciaAte}
                          aoMudar={(data) => {
                            setForm((atual) => ({ ...atual, recorrenciaAte: data }))
                          }}
                        />
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {editando && emSerie ? (
              <>
                <CampoCheckbox
                  rotulo="Aplicar também nos seguintes da série"
                  marcado={form.aplicarNaSerie}
                  aoMudar={(marcado) => {
                    setForm((atual) => ({ ...atual, aplicarNaSerie: marcado }))
                  }}
                  ajuda={`Desloca os ${alcanceDaSerie} agendamentos seguintes pelo mesmo intervalo. Só data, hora, duração, sala e especialidade são aplicados na série.`}
                />

                {/* nada de descarte silencioso: o usuário vê o que NÃO vai */}
                {alteradosForaDaSerie.length > 0 ? (
                  <AvisoErro
                    mensagens={[
                      `A alteração em ${alteradosForaDaSerie.join(', ')} NÃO será salva: esses campos são deste agendamento, não da série. Desmarque “aplicar na série” para gravá-los aqui, ou desfaça a alteração.`,
                    ]}
                  />
                ) : null}
              </>
            ) : null}

            {mudouHorario ? (
              <CampoCheckbox
                rotulo="Avisar a família pelo WhatsApp"
                marcado={form.avisarFamilia}
                aoMudar={(marcado) => {
                  setForm((atual) => ({ ...atual, avisarFamilia: marcado }))
                }}
                ajuda="Marque quando foi a clínica que mudou o horário. Se a família pediu a troca, ela já sabe."
              />
            ) : null}

            <div className="mt-2 flex flex-col">
              {/* a região viva fica SEMPRE montada (gate A11Y-AVI-05): trocar o profissional faz o
                  motivo aparecer ou mudar, e só região que já existia é anunciada. Vazia, ela não
                  ocupa espaço — por isso o respiro é a margem da frase, e não o `gap` da coluna */}
              <div aria-live="polite">
                {motivoQueImpedeEnviar !== null ? (
                  <p id={idDoMotivoQueImpede} className="mb-2 text-meta text-texto-suave">
                    {motivoQueImpedeEnviar}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3">
                {editando && podeExcluir ? (
                  <div className="flex flex-col gap-2">
                    <Botao
                      type="button"
                      variante="perigo-suave"
                      tamanho="lg"
                      disabled={gravando}
                      onClick={() => {
                        setConfirmandoExclusao(true)
                      }}
                    >
                      Excluir
                    </Botao>
                    {emSerie ? (
                      <CampoCheckbox
                        rotulo="Excluir também os seguintes da série"
                        marcado={excluirSerie}
                        aoMudar={setExcluirSerie}
                      />
                    ) : null}
                  </div>
                ) : (
                  <span />
                )}

                <div className="flex gap-3">
                  <Botao type="button" variante="secundario" tamanho="lg" onClick={fechar} disabled={gravando}>
                    Cancelar
                  </Botao>
                  {/* salvar com alteração que a série descarta produziria um "salvo com sucesso"
                      falso (SEC-A2) — o aviso logo acima diz o porquê. O que falta ANTES de salvar
                      (`motivoQueImpedeEnviar`) usa `aria-disabled` + `aria-describedby`: o botão
                      continua na sequência de Tab para dizer o que falta. O `gravando` entra junto
                      porque o `aria-disabled` daqui sobrescreve o do `carregando`. */}
                  <Botao
                    type="submit"
                    tamanho="lg"
                    carregando={gravando}
                    disabled={alteradosForaDaSerie.length > 0}
                    aria-disabled={gravando || motivoQueImpedeEnviar !== null || undefined}
                    aria-describedby={motivoQueImpedeEnviar !== null ? idDoMotivoQueImpede : undefined}
                  >
                    {encaixando ? 'Encaixar' : editando ? 'Salvar' : 'Marcar'}
                  </Botao>
                </div>
              </div>
            </div>
          </form>

          {/* O atendimento vive AQUI, e não num botão a mais no card: a grade cheia tem
              ~330 cards memoizados (piso de perf da §16). Fora do <form> de propósito —
              é outra entidade, com outras permissões (`atendimentos.*` × `agenda.*`), e
              salvar o agendamento não é registrar a sessão. */}
          {editando && card !== null && card.tipo !== 'bloqueio' ? (
            <SecaoAtendimento
              agendamentoId={card.id}
              nomeDaCrianca={nomeDoAlvo}
              profissionalId={card.profissional_id ?? null}
              statusDaSelecao={selecao.data?.status}
              statusAtualId={card.status_id}
              pacoteSemSaldo={card.tratamento_id !== null && (card.tratamento_saldo ?? 1) <= 0}
              aoFinalizar={(sessao) => {
                if (sessao.versao_antes === versaoVigente && typeof sessao.versao_depois === 'string') {
                  setVersaoDepoisDaEvolucao({ id: card.id, versao: sessao.versao_depois })
                }
              }}
            />
          ) : null}
        </AlertDialog.Content>
      </AlertDialog.Portal>

      <DialogConfirmacao
        aberto={confirmandoSerie}
        aoMudarAberto={setConfirmandoSerie}
        titulo={`Aplicar a mudança aos ${alcanceDaSerie} seguintes da série?`}
        consequencia={`Os ${alcanceDaSerie} agendamentos seguintes desta série serão deslocados pelo mesmo intervalo — inclusive os que estão fora do período que você está vendo. Se algum conflitar, nada é alterado. Status e observação não são propagados.`}
        rotuloConfirmar="Aplicar na série"
        tom="atencao"
        carregando={gravando}
        aoConfirmar={confirmarSerie}
      />

      {/* A troca de criança é a única edição que muda DE QUEM é o registro. A
          consequência NOMEIA as duas crianças: um texto genérico é confirmado sem
          que se saiba o que se está confirmando — e a palavra é digitada porque o
          engano que ela pega é, ele próprio, um clique errado. */}
      <DialogConfirmacao
        aberto={confirmandoTrocaDeCrianca}
        aoMudarAberto={setConfirmandoTrocaDeCrianca}
        titulo="Corrigir a criança deste agendamento?"
        consequencia={
          `Este horário deixa de ser de ${criancaAtual} e passa a ser de ${criancaNova}. ` +
          'A troca fica registrada na auditoria com o seu usuário, a data e a hora. ' +
          'Se a sessão já tiver atendimento registrado, o servidor recusa — a evolução ' +
          'clínica pertence à criança dela.'
        }
        rotuloConfirmar="Corrigir paciente"
        palavraDeConfirmacao="CORRIGIR"
        tom="perigo"
        carregando={gravando}
        // a recusa do PAC-REP chega na chave `paciente_id`, e o campo dela está ATRÁS
        // deste diálogo: sem trazê-la para cá, o servidor recusaria e o usuário veria
        // o diálogo intacto — "não aconteceu nada"
        erros={recusaDaTroca}
        aoConfirmar={confirmarTrocaDeCrianca}
      />

      {/* A consequência é VERDADEIRA: o número vem do servidor (D9). Contar
          irmãos pela grade diria "0 seguintes" enquanto a API apagaria 51. */}
      <DialogConfirmacao
        aberto={confirmandoExclusao}
        aoMudarAberto={setConfirmandoExclusao}
        titulo={`Excluir o agendamento de ${nomeDoAlvo}?`}
        consequencia={consequenciaDaExclusao}
        rotuloConfirmar={emSerie && form.aplicarNaSerie ? 'Excluir a série' : 'Excluir agendamento'}
        tom="perigo"
        carregando={gravando}
        aoConfirmar={confirmarExclusao}
      />
    </AlertDialog.Root>
  )
}
