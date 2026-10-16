import { garantirCsrf, http } from '@/lib/http'
import type { AnexoDoPaciente } from '@/tipos'

/** Metadados dos anexos do paciente — o conteúdo NUNCA vem na lista. */
export async function listarAnexos(pacienteId: number): Promise<AnexoDoPaciente[]> {
  const { data } = await http.get<AnexoDoPaciente[]>(`/api/pacientes/${pacienteId}/anexos`)

  return data
}

export async function enviarAnexo(pacienteId: number, arquivo: File): Promise<AnexoDoPaciente> {
  await garantirCsrf()
  const form = new FormData()
  form.append('arquivo', arquivo)
  const { data } = await http.post<AnexoDoPaciente>(`/api/pacientes/${pacienteId}/anexos`, form)

  return data
}

/**
 * O conteúdo desce pelo caminho AUTENTICADO (blob) — nunca por URL de storage.
 * O servidor audita a leitura (`consultou`): anexo é potencialmente laudo.
 */
export async function baixarAnexo(id: number): Promise<Blob> {
  const { data } = await http.get<Blob>(`/api/anexos/${id}/download`, { responseType: 'blob' })

  return data
}

/** SOFT-delete no servidor: some da lista, o arquivo permanece (retenção). */
export async function excluirAnexo(id: number): Promise<void> {
  await garantirCsrf()
  await http.delete(`/api/anexos/${id}`)
}
