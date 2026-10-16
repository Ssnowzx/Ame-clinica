import { http } from '@/lib/http'
import type { EnvelopeDeRelatorio, ParametrosDeRelatorio } from '@/tipos'

/**
 * A área de Relatórios (change `area-de-relatorios`): um índice sem dado e UMA rota de
 * execução por slug. Cada relatório fica atrás das permissões que ELE declara (todas) e do
 * escopo D11 do seu eixo — o servidor responde 404 (slug), 403 (antes de validar) ou 422.
 */

/** Só o que tem valor viaja: parâmetro vazio na query string vira "" e o servidor recusa. */
function apenasPreenchidos(parametros: ParametrosDeRelatorio): Record<string, string> {
  return Object.fromEntries(
    Object.entries(parametros).filter((par): par is [string, string] => par[1] !== undefined && par[1] !== ''),
  )
}

/**
 * O nome que o SERVIDOR deu ao arquivo (`Content-Disposition`), com o `filename*` (UTF-8) antes do
 * `filename` simples. Sem cabeçalho legível, o padrão da casa: `<slug>.csv`. Barra e contrabarra
 * saem do nome — ele vira caminho de arquivo na máquina da clínica.
 */
export function nomeDoArquivoBaixado(disposicao: string | undefined, padrao: string): string {
  const estendido = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposicao ?? '')?.[1]
  const simples = /filename\s*=\s*"?([^";]+)"?/.exec(disposicao ?? '')?.[1]
  let nome = simples?.trim()
  if (estendido !== undefined) {
    try {
      nome = decodeURIComponent(estendido.trim())
    } catch {
      // `%` solto no nome: fica o `filename` simples
    }
  }

  return (nome === undefined || nome === '' ? padrao : nome).replace(/[\\/]/g, '-')
}

/**
 * `GET /api/relatorios/{slug}/planilha` — o MESMO recorte da tela, pela mesma porta (autorização,
 * validação, escopo). O CSV desce pelo caminho autenticado, como blob; cada download fica na
 * auditoria do servidor, sem o conteúdo.
 */
export async function baixarPlanilhaDoRelatorio(
  slug: string,
  parametros: ParametrosDeRelatorio,
): Promise<{ arquivo: Blob; nome: string }> {
  // os BYTES crus, e o blob montado aqui: o BOM do UTF-8 (que faz o Excel ler os acentos) chega
  // intacto, sem passar por decodificação de texto no meio do caminho
  const resposta = await http.get<ArrayBuffer>(`/api/relatorios/${encodeURIComponent(slug)}/planilha`, {
    params: apenasPreenchidos(parametros),
    responseType: 'arraybuffer',
  })
  const disposicao = resposta.headers['content-disposition']

  return {
    arquivo: new Blob([resposta.data], { type: 'text/csv;charset=utf-8' }),
    nome: nomeDoArquivoBaixado(typeof disposicao === 'string' ? disposicao : undefined, `${slug}.csv`),
  }
}

export async function executarRelatorio(
  slug: string,
  parametros: ParametrosDeRelatorio,
): Promise<EnvelopeDeRelatorio> {
  const { data } = await http.get<EnvelopeDeRelatorio>(`/api/relatorios/${encodeURIComponent(slug)}`, {
    params: apenasPreenchidos(parametros),
  })

  return data
}
