import type { ParticipanteDoMural } from '@/tipos'

/**
 * Modelo PURO das menções @ do mural (kanban-da-equipe, design D7) — detecção
 * do gatilho sob o cursor, inserção do nome e destaque na leitura, testados SEM
 * DOM. O componente do composer só pergunta a este módulo.
 */

export interface GatilhoDeMencao {
  /** o trecho digitado depois do `@` (pode ser vazio — mostra os primeiros) */
  consulta: string
  /** onde o `@` começa no texto */
  inicio: number
}

// `@` seguido de até 40 chars sem espaço/quebra/novo `@`, ancorado no fim do
// trecho até o cursor. Unicode-friendly: acento em nome não quebra a detecção
// (lição do original, que usava [\w-] e falhava com "José").
const GATILHO = /@([^\s@]{0,40})$/u

/** Detecta um `@consulta` imediatamente antes do cursor — ou null. */
export function detectarGatilho(texto: string, cursor: number): GatilhoDeMencao | null {
  const atehOCursor = texto.slice(0, cursor)
  const casamento = GATILHO.exec(atehOCursor)
  if (casamento === null) {
    return null
  }
  return { consulta: casamento[1] ?? '', inicio: casamento.index }
}

/** Participantes que casam com a consulta (sem acento/caixa), teto de 8. */
export function filtrarParticipantes(
  participantes: readonly ParticipanteDoMural[],
  consulta: string,
): ParticipanteDoMural[] {
  const normalizada = normalizar(consulta)
  return participantes
    .filter((participante) => normalizar(participante.nome).includes(normalizada))
    .slice(0, 8)
}

/** Insere `@Nome ` no lugar do gatilho; devolve o texto novo e o cursor final. */
export function inserirMencao(
  texto: string,
  gatilho: GatilhoDeMencao,
  cursor: number,
  nome: string,
): { texto: string; cursor: number } {
  const antes = texto.slice(0, gatilho.inicio)
  const depois = texto.slice(cursor)
  const inserido = `@${nome} `
  return { texto: `${antes}${inserido}${depois}`, cursor: antes.length + inserido.length }
}

/**
 * Menções escolhidas que AINDA estão no texto — apagar o `@Nome` do corpo
 * remove a menção do payload (o texto é a fonte da verdade do que se diz).
 */
export function mencoesAindaNoTexto(
  texto: string,
  escolhidos: readonly ParticipanteDoMural[],
): ParticipanteDoMural[] {
  return escolhidos.filter((participante) => texto.includes(`@${participante.nome}`))
}

export type SegmentoDeCorpo =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'mencao'; valor: string; usuarioId: number }

/**
 * Quebra o corpo em segmentos texto/menção para o destaque na leitura. Os nomes
 * são casados do MAIS LONGO para o mais curto — `@Ana Clara` antes de `@Ana`
 * (lição do original) — e por igualdade literal `@Nome`, nunca regex do usuário.
 */
export function destacarMencoes(
  corpo: string,
  mencionados: readonly ParticipanteDoMural[],
): SegmentoDeCorpo[] {
  if (mencionados.length === 0 || corpo === '') {
    return corpo === '' ? [] : [{ tipo: 'texto', valor: corpo }]
  }

  const porTamanho = [...mencionados].sort((a, b) => b.nome.length - a.nome.length)
  const segmentos: SegmentoDeCorpo[] = []
  let resto = corpo

  while (resto !== '') {
    let maisCedo: { indice: number; participante: ParticipanteDoMural } | null = null
    for (const participante of porTamanho) {
      const indice = resto.indexOf(`@${participante.nome}`)
      // empate no MESMO índice: o primeiro da lista (mais longo) vence — por isso
      // o `<` estrito, nunca `<=`
      if (indice !== -1 && (maisCedo === null || indice < maisCedo.indice)) {
        maisCedo = { indice, participante }
      }
    }
    if (maisCedo === null) {
      segmentos.push({ tipo: 'texto', valor: resto })
      break
    }
    if (maisCedo.indice > 0) {
      segmentos.push({ tipo: 'texto', valor: resto.slice(0, maisCedo.indice) })
    }
    const rotulo = `@${maisCedo.participante.nome}`
    segmentos.push({ tipo: 'mencao', valor: rotulo, usuarioId: maisCedo.participante.id })
    resto = resto.slice(maisCedo.indice + rotulo.length)
  }

  return segmentos
}

function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
