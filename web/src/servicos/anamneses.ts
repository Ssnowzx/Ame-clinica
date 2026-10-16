import { garantirCsrf, http, putComVersao } from '@/lib/http'
import { anamneseModelos } from '@/servicos/catalogos-de-apoio'
import type {
  Anamnese,
  AnamneseDaLista,
  AnamneseModelo,
  PayloadAnamnese,
  PaginaDeApi,
  RespostasAnamnese,
} from '@/tipos'

/**
 * Anamnese (§7) — dado de saúde de MENOR (art. 11). O regime do backend é o
 * contrato: a lista traz SÓ metadados (sem `respostas_json`); o detalhe traz as
 * respostas e é AUDITADO no servidor (`consultou`) — por isso a tela só o busca
 * sob demanda, nunca em massa. Mutação sempre depois de `garantirCsrf()`.
 */

/** Lista por paciente — METADADOS apenas (o index nunca devolve respostas). Paginado. */
export async function listarAnamneses(pacienteId: number): Promise<PaginaDeApi<AnamneseDaLista>> {
  const { data } = await http.get<PaginaDeApi<AnamneseDaLista>>(
    `/api/pacientes/${pacienteId}/anamneses`,
  )
  return data
}

/**
 * O detalhe com as respostas — a leitura AUDITADA (`GET /anamneses/{id}`).
 * Cada chamada grava `consultou` no servidor: quem a dispara é um clique humano,
 * nunca um render (a query que a consome fixa `enabled`, `gcTime:0`, `retry:false`).
 */
export async function buscarAnamnese(id: number): Promise<Anamnese> {
  const { data } = await http.get<Anamnese>(`/api/anamneses/${id}`)
  return data
}

/** Cria uma anamnese a partir de um modelo ativo (`modelo_id` + respostas tipadas). */
export async function criarAnamnese(pacienteId: number, payload: PayloadAnamnese): Promise<Anamnese> {
  await garantirCsrf()
  const { data } = await http.post<Anamnese>(`/api/pacientes/${pacienteId}/anamneses`, payload)
  return data
}

/**
 * Edita SÓ as respostas (`PUT /anamneses/{id}`) — o `modelo_id` NÃO vai: o
 * `AnamneseRequest` o recusa na edição (`missing`). O modelo de uma anamnese é fixo.
 */
export async function atualizarAnamnese(id: number, respostas: RespostasAnamnese, versao: string): Promise<Anamnese> {
  const data = await putComVersao<Anamnese>(`/api/anamneses/${id}`, { respostas_json: respostas }, versao)
  return data
}

/**
 * Catálogo de modelos (`GET /anamnese-modelos`) — ativos e inativos; array cru, não paginado.
 * Delega ao recurso de catálogo: fonte ÚNICA do endpoint (a tela de modelos e o seletor de
 * "Nova anamnese" na ficha leem o mesmo `listar`, sob a mesma `chaves.modelosDeAnamnese()`).
 */
export function listarModelosDeAnamnese(): Promise<AnamneseModelo[]> {
  return anamneseModelos.listar()
}
