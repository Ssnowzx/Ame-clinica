/**
 * Detector de PII em disco — o controle DETECTIVO do armazenamento local.
 *
 * O controle preventivo (a peneira de `preferencias-locais.ts`) é quem impede o
 * nome de um menor de chegar ao `localStorage`. Este aqui é a fiscalização: roda
 * ao fim de CADA teste e reprova se sobrou no disco qualquer chave fora do
 * formato de layout, ou qualquer campo que não seja um painel conhecido.
 *
 * Ele NÃO importa `preferencias-locais.ts`: auditor que pergunta ao auditado o
 * que é aceitável não audita nada. A lista de campos é repetida de propósito.
 *
 * Tolera VALOR adulterado (os testes semeiam lixo de propósito, para provar que
 * a leitura aguenta) e JSON truncado — mas nunca um NOME de campo estranho, que
 * é como um dado de paciente entraria.
 */
const CHAVE_DE_LAYOUT = /^xiax:layout:\d+$/
const CAMPOS_CONHECIDOS = ['menu', 'filaAgenda']

export interface AchadoDeArmazenamento {
  chave: string
  motivo: string
}

/**
 * Varre o `localStorage` atrás do que não deveria estar lá.
 * @returns Os achados (lista vazia = disco limpo). NUNCA lança.
 */
export function auditarArmazenamento(): AchadoDeArmazenamento[] {
  const achados: AchadoDeArmazenamento[] = []

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const chave = window.localStorage.key(i) ?? ''

    if (!CHAVE_DE_LAYOUT.test(chave)) {
      achados.push({ chave, motivo: 'chave fora do formato de layout' })
      continue
    }

    const bruto = window.localStorage.getItem(chave) ?? ''
    let campos: string[]

    try {
      const valor: unknown = JSON.parse(bruto)
      // JSON válido mas não-objeto é lixo de fixture, não é PII: só nome de
      // campo carrega informação
      campos =
        typeof valor === 'object' && valor !== null && !Array.isArray(valor)
          ? Object.keys(valor)
          : []
    } catch {
      // JSON truncado: os nomes de campo ainda são legíveis no bruto, e é isso
      // que interessa — um nome de paciente apareceria aqui do mesmo jeito
      campos = [...bruto.matchAll(/"([^"]+)"\s*:/g)].map((achado) => achado[1])
    }

    for (const campo of campos) {
      if (!CAMPOS_CONHECIDOS.includes(campo)) {
        achados.push({ chave, motivo: `campo desconhecido no disco: "${campo}"` })
      }
    }
  }

  return achados
}
