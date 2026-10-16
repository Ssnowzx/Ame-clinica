import { garantirCsrf, http } from '@/lib/http'
import type { ReguaDoCadastro } from '@/tipos'

/**
 * A RÉGUA DO CADASTRO (capability `campos-do-cadastro`): o que a clínica exige e o que ela
 * escondeu do formulário.
 *
 * A tela NÃO mantém a própria lista de campos obrigatórios — rótulo, seção, estado e trava
 * vêm todos daqui. Foi lista paralela mantida à mão que deixou `required_unless` vazar em
 * inglês para a tela em produção (change `texto-de-maquina-fora-da-tela`).
 */
export async function buscarReguaDoCadastro(formulario = 'paciente'): Promise<ReguaDoCadastro> {
  const { data } = await http.get<ReguaDoCadastro>(`/api/campos-cadastro/${formulario}`)
  return data
}

/**
 * Grava o estado de um ou mais campos e devolve a régua efetiva já atualizada.
 *
 * A escrita é por CAMPO, e `null` numa chave devolve o campo ao padrão do catálogo — é o
 * "não opinei", diferente de `false`.
 */
export async function salvarReguaDoCadastro(
  campos: Record<string, { obrigatorio?: boolean | null; desabilitado?: boolean | null }>,
  formulario = 'paciente',
): Promise<ReguaDoCadastro> {
  await garantirCsrf()
  const { data } = await http.put<ReguaDoCadastro>(`/api/campos-cadastro/${formulario}`, { campos })
  return data
}

/**
 * Quantas fichas ficariam INCOMPLETAS com a régua proposta — antes de gravar.
 *
 * É uma LEITURA que manda a régua no corpo (não cabe em query string sem virar ilegível),
 * daí o `POST`. Serve para que apertar a régua seja decisão informada: a diferença entre
 * "3 fichas" e "1.847 fichas" é a diferença entre um ajuste e um mutirão.
 */
export async function previaDaRegua(
  campos: Record<string, { obrigatorio?: boolean | null; desabilitado?: boolean | null }>,
  formulario = 'paciente',
): Promise<{ total: number; incompletos: number }> {
  await garantirCsrf()
  const { data } = await http.post<{ total: number; incompletos: number }>(
    `/api/campos-cadastro/${formulario}/previa`,
    { campos },
  )
  return data
}
