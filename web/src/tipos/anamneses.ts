/**
 * Anamnese respondida (§7) — dado de saúde de MENOR (art. 11).
 *
 * A API cifra `respostas_json` em repouso, o mascara na auditoria e o OMITE da
 * listagem: a lista traz só metadados; as respostas só existem no detalhe, e o
 * detalhe é AUDITADO no servidor (`consultou`). A tela espelha esse regime —
 * respostas nunca em linha de lista, nunca em URL, escapadas por JSX na leitura.
 */

/** Os tipos de campo que o `AnamneseModeloRequest` do servidor permite. */
export type TipoDeCampoAnamnese = 'texto' | 'numero' | 'opcoes' | 'data' | 'booleano'

/** Um campo do modelo (`campos_json`) — o schema dinâmico que o formulário percorre. */
export interface CampoDeModelo {
  id: string
  tipo: TipoDeCampoAnamnese
  rotulo: string
  obrigatorio: boolean
  /** Presente só em `tipo: 'opcoes'` — o conjunto fechado que o valor deve pertencer. */
  opcoes?: string[]
}

/** Modelo de anamnese (`GET /anamnese-modelos`) — catálogo da clínica, ativos e inativos. */
export interface AnamneseModelo {
  id: number
  titulo: string
  especialidade_id: number | null
  campos_json: CampoDeModelo[]
  ativo: boolean
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/**
 * O que a tela de modelos ENVIA ao criar/editar (`POST`/`PUT /anamnese-modelos`).
 * Espelha o `AnamneseModeloRequest` do servidor — que é a autoridade: título único
 * na clínica, `especialidade_id` opcional, e `campos_json` tipado (≤60 campos; cada
 * campo `id`/`tipo`/`rotulo`/`obrigatorio`; `opcoes` obrigatória e ≤30 em `tipo: 'opcoes'`).
 */
export interface PayloadAnamneseModelo {
  titulo: string
  especialidade_id: number | null
  ativo: boolean
  campos_json: CampoDeModelo[]
}

/**
 * Uma linha da lista (`GET /pacientes/{id}/anamneses`) — METADADOS apenas.
 * `respostas_json` NÃO existe aqui (o index não o traz; a tela não o reintroduz).
 * `modelo` pode vir `null` (o `?->only` do servidor quando o modelo sumiu).
 */
export interface AnamneseDaLista {
  id: number
  paciente_id: number
  modelo: { id: number; titulo: string } | null
  /** `Y-m-d H:i` — parede da clínica, carimbada pelo servidor. */
  preenchida_em: string
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/** Mapa `{ campoId: valor }` com valores JSON-TIPADOS (string/number/bool). */
export type RespostasAnamnese = Record<string, unknown>

/**
 * O detalhe (`GET /anamneses/{id}`) — traz as respostas e o `modelo_id`, NÃO o
 * `campos_json` (a tela busca o modelo à parte para mapear id→rótulo). A leitura
 * desta forma É a leitura auditada.
 */
export interface Anamnese {
  id: number
  paciente_id: number
  modelo_id: number
  respostas_json: RespostasAnamnese
  preenchida_em: string
  /** token da concorrência otimista (If-Match) */
  updated_at: string
}

/** O que a tela envia ao CRIAR (`POST`) — modelo + respostas tipadas. */
export interface PayloadAnamnese {
  modelo_id: number
  respostas_json: RespostasAnamnese
}
