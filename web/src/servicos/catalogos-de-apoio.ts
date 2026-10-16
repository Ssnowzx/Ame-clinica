import { http } from '@/lib/http'
import { recursoDeCatalogo } from '@/lib/recurso-de-catalogo'
import type {
  AcaoDaRegraDeLimite,
  AnamneseModelo,
  PayloadAnamneseModelo,
  Convenio,
  Equipamento,
  Especialidade,
  Feriado,
  Medico,
  PeriodoDaRegraDeLimite,
  RegraLimiteConvenio,
  Sala,
  Servico,
  StatusAgendamento,
  TipoDeCorteDoCiclo,
} from '@/tipos'

export interface PayloadEspecialidade {
  nome: string
  tempo_sessao: number
  /** `#RRGGBB` — o servidor recusa qualquer outro formato */
  cor: string
  exige_termo: boolean
  oculta_agendamento_online: boolean
}

export interface PayloadSala {
  nome: string
  capacidade: number
  ativo: boolean
}

export interface PayloadEquipamento {
  nome: string
  quantidade_total: number
  especialidade_id: number | null
}

/** Sem `flags_tiss_json`: blob sem shape na API não é editável pela tela (SEC-CA-04). */
export interface PayloadConvenio {
  nome: string
  registro_ans: string | null
  codigo_operadora: string | null
  versao_tiss: string | null
  guia_sequencial: boolean
  alerta_agend_mesmo_dia: boolean
  particular: boolean
  /** Validade do pedido médico em MESES (1..36) — `null` desliga o acompanhamento */
  pedido_validade_meses: number | null
  /**
   * Calendário do ciclo de faturamento. `null` nos dois = o convênio não fecha período.
   * `ciclo_dia_corte` vai de 1 a 28 e só acompanha `dia_fixo` (SEC-FC-21).
   */
  ciclo_tipo_corte: TipoDeCorteDoCiclo | null
  ciclo_dia_corte: number | null
  ativo: boolean
}

export interface PayloadServico {
  procedimento: string
  /** `null` quando em branco — nunca string vazia (o servidor guarda ausência, não "") */
  codigo_procedimento: string | null
  valor: number
}

export interface PayloadMedico {
  nome: string
  conselho: string
  uf_conselho: string
  num_conselho: string
  cbos_id: number | null
}

export interface PayloadStatus {
  nome: string
  cor: string
  cor_borda: string | null
  desconta_sessao: boolean
  ocupa_horario: boolean
  marca_falta: boolean
  marca_reserva: boolean
  /** Entra na baixa em lote (change `baixa-em-lote-por-status`); invariantes no servidor */
  em_aberto: boolean
  /** Opção do "Dar baixa" da agenda; nunca junto de `em_aberto` */
  aplicavel_em_lote: boolean
  tipo: string | null
  /**
   * O de MENOR ordem é o status INICIAL — o servidor recusa promover a inicial um
   * status que desconta sessão ou que não ocupa horário (`GuardaDoStatusInicial`).
   */
  ordem: number
}

export interface PayloadFeriado {
  nome: string
  /** `Y-m-d` — o servidor exige o formato EXATO; nada de `toISOString()` */
  data: string
  recorrente: boolean
  ativo: boolean
}

export const especialidades = recursoDeCatalogo<Especialidade, PayloadEspecialidade>(
  '/api/especialidades',
)
export const salas = recursoDeCatalogo<Sala, PayloadSala>('/api/salas')
export const equipamentos = recursoDeCatalogo<Equipamento, PayloadEquipamento>('/api/equipamentos')
export const convenios = recursoDeCatalogo<Convenio, PayloadConvenio>('/api/convenios')
export const medicos = recursoDeCatalogo<Medico, PayloadMedico>('/api/medicos')
export const statusAgendamento = recursoDeCatalogo<StatusAgendamento, PayloadStatus>(
  '/api/status-agendamento',
)
export const feriados = recursoDeCatalogo<Feriado, PayloadFeriado>('/api/feriados')

/**
 * Modelos de anamnese — MESMO CRUD dos catálogos (o backend `AnamneseModeloController`
 * já entrega `index/store/show/update/destroy`, com título único da clínica, concorrência
 * otimista e recusa de exclusão em uso). `listar` é a fonte única do `GET /anamnese-modelos`
 * (o seletor de "Nova anamnese" na ficha também o consome).
 */
export const anamneseModelos = recursoDeCatalogo<AnamneseModelo, PayloadAnamneseModelo>(
  '/api/anamnese-modelos',
)

/** A tabela de serviços é AGREGADO do convênio (rotas aninhadas). */
export function servicosDoConvenio(convenioId: number) {
  return recursoDeCatalogo<Servico, PayloadServico>(`/api/convenios/${convenioId}/servicos`)
}

/** O domínio é FECHADO no servidor: período/ação fora do enum voltam 422 (SEC-LP-08). */
export interface PayloadRegraLimite {
  /** `null` = todas as especialidades */
  especialidade_id: number | null
  periodo: PeriodoDaRegraDeLimite
  /** 1..99 */
  limite: number
  acao: AcaoDaRegraDeLimite
}

/**
 * Regras de limite: filha do convênio, MESMO desenho da tabela de serviços
 * (rota aninhada, escopada pelo pai — paridade SEC-LP-07).
 */
export function regrasDoConvenio(convenioId: number) {
  return recursoDeCatalogo<RegraLimiteConvenio, PayloadRegraLimite>(
    `/api/convenios/${convenioId}/regras`,
  )
}

export async function buscarConvenio(id: number): Promise<Convenio> {
  const { data } = await http.get<Convenio>(`/api/convenios/${id}`)
  return data
}
