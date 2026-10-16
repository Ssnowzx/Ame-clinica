import { ErroDeApi, garantirCsrf, http, MENSAGEM_DE_CONFLITO, putComVersao } from '@/lib/http'
import type {
  AgendamentosDoPaciente,
  AlcanceDaBaixa,
  CardAgendamento,
  ComparecimentoRecente,
  ConfirmacaoDoCard,
  DetalheDoAgendamento,
  DesfechoDaBaixa,
  PresencaDoPaciente,
  PreviaDaBaixa,
  PacienteDaBusca,
  PayloadAgendamento,
  PayloadRemarcacao,
  ResultadoDaBaixa,
  SelecaoDaAgenda,
  SerieCriada,
  TamanhoDaSerie,
  TratamentoDaSelecao,
} from '@/tipos'

export interface FiltroAgenda {
  /** "Y-m-d" — inclusivo */
  de: string
  ate: string
  /** Dia/Semana filtram no servidor; a Visão Geral traz o dia inteiro (design D5) */
  profissionalId?: number | null
}

/**
 * Agendamentos do período — a fonte das três visões da grade (§6).
 * @returns Os cards do período, ordenados por início
 */
export async function buscarAgenda({ de, ate, profissionalId }: FiltroAgenda): Promise<CardAgendamento[]> {
  const { data } = await http.get<CardAgendamento[]>('/api/agenda', {
    params: {
      de,
      ate,
      ...(profissionalId != null ? { profissional_id: profissionalId } : {}),
    },
  })
  return data
}

// ── Catálogos do formulário (sob a permissão da AGENDA) ──────────────────────

/** Catálogos estáveis do formulário — sem exigir `pacientes.ver` & cia. */
export async function buscarSelecaoDaAgenda(): Promise<SelecaoDaAgenda> {
  const { data } = await http.get<SelecaoDaAgenda>('/api/agenda/selecao')
  return data
}

/** A seleção com os profissionais DESLIGADOS (marcados em `ativo`) — o filtro do repasse. */
export async function buscarSelecaoComDesligados(): Promise<SelecaoDaAgenda> {
  const { data } = await http.get<SelecaoDaAgenda>('/api/agenda/selecao', { params: { com_desligados: 1 } })
  return data
}

/**
 * O resultado da busca: a lista e a resposta à pergunta "por que não achei?".
 *
 * `existeInativo` só vem verdadeiro quando o SERVIDOR o disse — e ele só diz a quem tem
 * `pacientes.ver`. A tela nunca infere isto por conta própria: inferir seria decidir autorização
 * no cliente, e daria a frase a quem o servidor calou (parecer SEC-PIS-06/§6).
 */
export interface ResultadoDaBuscaDePacientes {
  pacientes: PacienteDaBusca[]
  /** Existe cadastro INATIVO que casa com o termo — um bit, sem nome, id ou contagem */
  existeInativo: boolean
}

/**
 * O cabeçalho do marcador de inativo (`AgendaSelecaoController::CABECALHO_INATIVOS`).
 *
 * Mudar este nome sem mudar o do servidor faz a caixa voltar a dizer "nenhum resultado" para uma
 * criança que está ali, desligada — em silêncio, sem erro nenhum.
 */
const CABECALHO_INATIVOS = 'x-pacientes-inativos'

/** Busca de paciente: o servidor exige 2+ caracteres e devolve só o nome. */
export async function buscarPacientes(termo: string): Promise<ResultadoDaBuscaDePacientes> {
  const resposta = await http.get<PacienteDaBusca[]>('/api/agenda/selecao/pacientes', {
    params: { busca: termo },
  })

  return {
    pacientes: resposta.data,
    // o cabeçalho só existe no caso verdadeiro; ausente é o comportamento de sempre
    existeInativo: resposta.headers[CABECALHO_INATIVOS] === '1',
  }
}

/**
 * Espelho do teto por página do servidor (`TETO_BUSCA` em `AgendaSelecaoController`). É o
 * que permite decidir "veio página cheia, então PODE haver mais" sem que a resposta carregue
 * um total — e total de crianças é justamente o número que ninguém precisa ver para escolher
 * uma. Mudar um lado sem o outro faz a tela parar de paginar em silêncio (CR-BPL-13).
 */
export const PACIENTES_POR_PAGINA = 20

/**
 * O catálogo A→Z, para quem prefere reconhecer a digitar (change busca-de-paciente-com-lista).
 * A URL leva só a página: nome de MENOR não entra em query string (gatilho LOG).
 */
export async function listarPacientesDaSelecao(pagina: number): Promise<PacienteDaBusca[]> {
  const { data } = await http.get<PacienteDaBusca[]>('/api/agenda/selecao/pacientes', {
    params: { pagina },
  })
  return data
}

/** Quem teve movimento de agenda na janela recente — o atalho do caso comum. */
export async function buscarPacientesRecentes(): Promise<PacienteDaBusca[]> {
  const { data } = await http.get<PacienteDaBusca[]>('/api/agenda/selecao/pacientes', {
    params: { recentes: 1 },
  })
  return data
}

/**
 * NOMEIA um paciente que a tela já conhece pelo id — é assim que o modo retorno exibe de quem é
 * o horário que procura, sem o nome do MENOR ter viajado na URL (gatilho `LOG`).
 *
 * Devolve `null` quando não resolve (inexistente ou inativo): o servidor responde
 * lista vazia UNIFORME nos três casos, de propósito — a diferença entre eles não pode ser
 * observável. Quem chama trata o `null` desligando o modo, nunca inventando um nome.
 */
export async function buscarPacientePorId(id: number): Promise<PacienteDaBusca | null> {
  const { data } = await http.get<PacienteDaBusca[]>('/api/agenda/selecao/pacientes', {
    params: { id },
  })
  return data[0] ?? null
}

export async function listarTratamentosDoPaciente(pacienteId: number): Promise<TratamentoDaSelecao[]> {
  const { data } = await http.get<TratamentoDaSelecao[]>('/api/agenda/selecao/tratamentos', {
    params: { paciente_id: pacienteId },
  })
  return data
}

/**
 * Tamanho REAL da série. É a ÚNICA fonte de número para a confirmação: contar
 * irmãos pela grade mentiria (ela só conhece o período consultado).
 */
export async function buscarTamanhoDaSerie(id: number): Promise<TamanhoDaSerie> {
  const { data } = await http.get<TamanhoDaSerie>(`/api/agendamentos/${id}/serie`)
  return data
}

/** Leitura FRESCA de um agendamento — o `PUT` exige `inicio`/`profissional_id`. */
export async function buscarAgendamento(id: number): Promise<DetalheDoAgendamento> {
  const { data } = await http.get<DetalheDoAgendamento>(`/api/agendamentos/${id}`)
  return data
}

/**
 * Comparecimento recente do paciente (90 dias) — buscado SOB DEMANDA pelo acordeão
 * do painel, nunca ao montar a grade (§16). Payload minimizado (sem nada clínico).
 */
export async function buscarComparecimentoRecente(pacienteId: number): Promise<ComparecimentoRecente> {
  const { data } = await http.get<ComparecimentoRecente>(`/api/pacientes/${pacienteId}/comparecimento-recente`)
  return data
}

/**
 * Agendamentos do paciente para a FICHA — próximos + recentes numa leitura. Endpoint
 * PRÓPRIO da ficha: o comparecimento recente acima é do painel e não traz o futuro.
 */
export async function buscarAgendamentosDoPaciente(pacienteId: number): Promise<AgendamentosDoPaciente> {
  const { data } = await http.get<AgendamentosDoPaciente>(`/api/pacientes/${pacienteId}/agendamentos`)
  return data
}

/**
 * A assiduidade do paciente (seção Presença): contagens, taxa e faltas — tudo
 * classificado e CALCULADO no servidor (§13); a tela não reconta nada.
 */
export async function buscarPresencaDoPaciente(pacienteId: number): Promise<PresencaDoPaciente> {
  const { data } = await http.get<PresencaDoPaciente>(`/api/pacientes/${pacienteId}/presenca`)

  return data
}

// ── Escrita ──────────────────────────────────────────────────────────────────

/**
 * Cria um agendamento (ou uma série, se `recorrencia` vier no payload).
 * @returns `SerieCriada` quando é série; o card criado quando é um só
 */
export async function criarAgendamento(payload: PayloadAgendamento): Promise<CardAgendamento | SerieCriada> {
  await garantirCsrf()
  const { data } = await http.post<CardAgendamento | SerieCriada>('/api/agendamentos', payload)
  return data
}

/** O formulário manda o payload cheio; o arrasto (D2) manda o PARCIAL — mesmo PUT, mesmo gate. */
export async function atualizarAgendamento(
  id: number,
  payload: PayloadAgendamento | PayloadRemarcacao,
  versao: string,
): Promise<CardAgendamento> {
  const data = await putComVersao<CardAgendamento>(`/api/agendamentos/${id}`, payload, versao)
  return data
}

/**
 * "Manter a sessão (a família desistiu)" (change lembrete-com-botoes-de-resposta): a família tocou
 * em "Preciso desmarcar" por engano e confirmou por telefone. Sem corpo e sem `If-Match` — não é
 * edição do agendamento, é a resolução do pedido; a sessão passa a constar como confirmada. O 422
 * (o pedido já não vale) chega como `ErroDeApi` com os `errors` do servidor.
 */
export async function manterSessao(id: number): Promise<{ confirmacao: ConfirmacaoDoCard }> {
  await garantirCsrf()
  const { data } = await http.post<{ confirmacao: ConfirmacaoDoCard }>(`/api/agendamentos/${id}/manter-sessao`)
  return data
}

/**
 * "Marcar como confirmada" (change confirmacao-pela-clinica): a família confirmou por telefone ou
 * mensagem — o lembrete estava sem resposta, não foi entregue ou nem saiu. Sem corpo e sem
 * `If-Match`, como o "Manter": não é edição do agendamento. O 422 (a sessão já não espera
 * confirmação) chega como `ErroDeApi` com os `errors` do servidor.
 */
export async function confirmarPelaClinica(id: number): Promise<{ confirmacao: ConfirmacaoDoCard }> {
  await garantirCsrf()
  const { data } = await http.post<{ confirmacao: ConfirmacaoDoCard }>(`/api/agendamentos/${id}/confirmar`)
  return data
}

/**
 * "Avisar no WhatsApp" (change avisar-no-whatsapp-abre-a-conversa): a conversa da família da sessão,
 * achada pelo celular de agora no cadastro ou criada vazia pelo servidor. Nada é enviado. O 422 (sem
 * celular válido) chega como `ErroDeApi` com o motivo.
 */
export async function abrirConversaDaSessao(id: number): Promise<{ conversa_id: number }> {
  await garantirCsrf()
  const { data } = await http.post<{ conversa_id: number }>(`/api/agendamentos/${id}/conversa`)
  return data
}

/** `aplicarNaSerie` apaga ESTE e todos os seguintes do grupo (os anteriores ficam). */
export async function excluirAgendamento(id: number, aplicarNaSerie = false): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/agendamentos/${id}`, { params: { aplicar_na_serie: aplicarNaSerie ? 1 : 0 } })
}

/** O alcance de uma baixa em massa — o mesmo objeto na prévia e na execução (design D1). */
export interface AlcanceDoDesmarque {
  profissionalId: number
  de: string
  ate: string
  periodo: 'manha' | 'tarde' | 'dia'
}

export interface PreviaDoDesmarque {
  contagens: {
    agendamentos: number
    /** Quantos bloqueios a operação grava — a maior quantidade que ela escreve. */
    bloqueios: number
    criancas: number
    avisos: number
    sessoes_estornadas: number
  }
  recusados: { id: number; inicio: string; motivo: string }[]
}

export interface ResultadoDoDesmarque {
  desmarcados: number
  recusados: { id: number; inicio: string; motivo: string }[]
  avisados: number
  nao_avisados: { paciente_id: number | null; motivo: string }[]
}

function corpoDoDesmarque(alcance: AlcanceDoDesmarque): Record<string, unknown> {
  return {
    profissional_id: alcance.profissionalId,
    de: alcance.de,
    ate: alcance.ate,
    periodo: alcance.periodo,
  }
}

/** NÃO escreve nada — classifica o alcance e devolve os números (spec: prévia obrigatória). */
export async function preverDesmarqueEmLote(alcance: AlcanceDoDesmarque): Promise<PreviaDoDesmarque> {
  await garantirCsrf()
  const { data } = await http.post<PreviaDoDesmarque>(
    '/api/agendamentos/desmarque-em-lote/previa',
    corpoDoDesmarque(alcance),
  )

  return data
}

export async function executarDesmarqueEmLote(
  alcance: AlcanceDoDesmarque,
  opcoes: { statusId: number | null; bloquear: boolean; avisar: boolean; motivo: string },
): Promise<ResultadoDoDesmarque> {
  await garantirCsrf()
  const { data } = await http.post<ResultadoDoDesmarque>('/api/agendamentos/desmarque-em-lote', {
    ...corpoDoDesmarque(alcance),
    status_id: opcoes.statusId,
    bloquear: opcoes.bloquear,
    avisar: opcoes.avisar,
    motivo: opcoes.motivo,
  })

  return data
}

// ── Baixa em lote por status (change `baixa-em-lote-por-status`) ─────────────

function corpoDaBaixa(alcance: AlcanceDaBaixa): Record<string, unknown> {
  return {
    profissional_id: alcance.profissionalId,
    status_id: alcance.statusId,
    de: alcance.de,
    ate: alcance.ate,
  }
}

/** NÃO escreve nada — classifica o alcance pela flag `em_aberto` e devolve os números (D6). */
export async function preverBaixaEmLote(alcance: AlcanceDaBaixa): Promise<PreviaDaBaixa> {
  await garantirCsrf()
  const { data } = await http.post<PreviaDaBaixa>(
    '/api/agendamentos/baixa-em-lote/previa',
    corpoDaBaixa(alcance),
  )

  return data
}

/** O corpo dos 409 desta rota — discriminado pela chave `erro`, como a casa faz. */
type CorpoDo409 = { erro?: string; previa?: PreviaDaBaixa }

/**
 * Executa a baixa com a assinatura e a referência da prévia lida (D5): o servidor recalcula
 * sob lock e, se a agenda mudou, responde 409 `previa_desatualizada` com a prévia NOVA no corpo
 * — nada gravado. Esse 409 (e o `ciclo_em_alteracao`) sai do funil do interceptador porque é
 * pergunta ao operador, não conflito de concorrência otimista (mesmo molde do homônimo do
 * pré-cadastro). Um 409 desconhecido volta a ser conflito, com o texto de sempre.
 */
export async function executarBaixaEmLote(
  alcance: AlcanceDaBaixa,
  previa: { assinatura: string; referencia: string },
): Promise<DesfechoDaBaixa> {
  await garantirCsrf()
  const { status, data } = await http.post<ResultadoDaBaixa | CorpoDo409>(
    '/api/agendamentos/baixa-em-lote',
    { ...corpoDaBaixa(alcance), assinatura: previa.assinatura, referencia: previa.referencia },
    { validateStatus: (codigo) => codigo === 200 || codigo === 409 },
  )

  if (status === 409) {
    const corpo = data as CorpoDo409
    if (corpo.erro === 'previa_desatualizada' && corpo.previa !== undefined) {
      return { tipo: 'previa_desatualizada', previa: corpo.previa }
    }
    if (corpo.erro === 'ciclo_em_alteracao') {
      return { tipo: 'ciclo_em_alteracao' }
    }
    throw new ErroDeApi('conflito', MENSAGEM_DE_CONFLITO)
  }

  return { tipo: 'aplicada', resultado: data as ResultadoDaBaixa }
}
