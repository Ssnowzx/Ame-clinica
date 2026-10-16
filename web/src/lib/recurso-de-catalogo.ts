import { garantirCsrf, http, putComVersao } from '@/lib/http'

/**
 * O CRUD que todo catálogo da casa tem — de especialidades a contas do financeiro.
 * Uma cópia por catálogo divergiria uma vez por catálogo, e divergiria primeiro no
 * que não pode: o `If-Match` da edição e o CSRF da escrita.
 *
 * A API é a autoridade: aqui não há validação, só transporte. `garantirCsrf` em
 * toda escrita (o cookie do Sanctum morre com a sessão).
 *
 * Vive em `lib/` (e não dentro de um dos serviços) porque os catálogos CLÍNICOS e os
 * FINANCEIROS moram em módulos diferentes — cada um com os seus tipos e as suas chaves
 * de query — e nenhum dos dois deve importar do outro só para pegar a fábrica.
 */
export function recursoDeCatalogo<T, P>(caminho: string) {
  return {
    listar: async (): Promise<T[]> => {
      const { data } = await http.get<T[]>(caminho)
      return data
    },
    criar: async (payload: P): Promise<T> => {
      await garantirCsrf()
      const { data } = await http.post<T>(caminho, payload)
      return data
    },
    atualizar: async (id: number, payload: P, versao: string): Promise<T> => {
      const data = await putComVersao<T>(`${caminho}/${id}`, payload, versao)
      return data
    },
    excluir: async (id: number): Promise<void> => {
      await garantirCsrf()
      await http.delete(`${caminho}/${id}`)
    },
  }
}
