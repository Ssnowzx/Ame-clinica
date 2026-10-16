import type { AnamneseModelo, CampoDeModelo, TipoDeCampoAnamnese } from '@/tipos'

/**
 * O campo COMO A TELA o edita — distinto do `CampoDeModelo` que persiste.
 *
 * `_key` é identidade de cliente só (chave de React e do mapa de erros); nunca vai
 * ao servidor. `idOriginal` guarda o `id` de um campo que JÁ existe no modelo: ele é
 * PRESERVADO ao salvar, porque trocar o `id` de um campo já respondido orfanaria a
 * resposta na leitura da anamnese (resíduo `ANM-SNAPSHOT`). Campo novo não tem
 * `idOriginal` — seu `id` nasce do rótulo em `paraCamposJson`.
 */
export interface CampoEmEdicao {
  _key: number
  idOriginal?: string
  rotulo: string
  tipo: TipoDeCampoAnamnese
  obrigatorio: boolean
  /** Sempre presente; só entra no payload quando `tipo === 'opcoes'`. */
  opcoes: string[]
}

/** Os cinco tipos que o `AnamneseModeloRequest` aceita, com rótulo em pt-BR. */
export const TIPOS_DE_CAMPO: ReadonlyArray<{ valor: TipoDeCampoAnamnese; rotulo: string }> = [
  { valor: 'texto', rotulo: 'Texto' },
  { valor: 'numero', rotulo: 'Número' },
  { valor: 'opcoes', rotulo: 'Opções' },
  { valor: 'data', rotulo: 'Data' },
  { valor: 'booleano', rotulo: 'Sim / Não' },
]

/** Limites do servidor (`AnamneseModeloRequest`) — espelhados para o feedback imediato. */
export const MAX_CAMPOS = 60
export const MAX_OPCOES = 30

// Contador de chave de cliente. Módulo-nível de propósito: a identidade só precisa ser
// única DENTRO da sessão do formulário; varia por render, nunca persiste.
let contadorDeChave = 0
function proximaChave(): number {
  contadorDeChave += 1
  return contadorDeChave
}

/** Um campo em branco, tipo `texto` — o ponto de partida de "adicionar campo". */
export function campoNovo(): CampoEmEdicao {
  return { _key: proximaChave(), rotulo: '', tipo: 'texto', obrigatorio: false, opcoes: [] }
}

/** Hidrata os campos da tela a partir de um modelo (edição) — ou um campo em branco (criação). */
export function camposDeModelo(modelo?: AnamneseModelo): CampoEmEdicao[] {
  if (modelo === undefined) {
    return [campoNovo()]
  }
  return modelo.campos_json.map((campo) => ({
    _key: proximaChave(),
    idOriginal: campo.id,
    rotulo: campo.rotulo,
    tipo: campo.tipo,
    obrigatorio: campo.obrigatorio,
    opcoes: campo.opcoes ?? [],
  }))
}

/** Slug estável a partir do rótulo — minúsculas, sem acento, `_` no lugar do resto. */
function slug(texto: string): string {
  const base = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 55)
  return base === '' ? 'campo' : base
}

/**
 * Converte os campos da tela no `campos_json` do servidor, com `id` estável e ÚNICO.
 *
 * `idOriginal` é preservado (nunca reescrito). Campo novo ganha o slug do rótulo; a
 * colisão é desfeita com sufixo `_2`, `_3`… — todos os `idOriginal` entram na reserva
 * ANTES, para que um campo novo nunca colida com um id já respondido.
 */
export function paraCamposJson(campos: CampoEmEdicao[]): CampoDeModelo[] {
  const usados = new Set<string>(
    campos.map((campo) => campo.idOriginal).filter((id): id is string => id !== undefined),
  )

  return campos.map((campo) => {
    let id = campo.idOriginal
    if (id === undefined) {
      const raiz = slug(campo.rotulo)
      let candidato = raiz
      let n = 2
      while (usados.has(candidato)) {
        candidato = `${raiz.slice(0, 52)}_${n}`
        n += 1
      }
      id = candidato
      usados.add(id)
    }

    const persistido: CampoDeModelo = {
      id,
      tipo: campo.tipo,
      rotulo: campo.rotulo.trim(),
      obrigatorio: campo.obrigatorio,
    }
    if (campo.tipo === 'opcoes') {
      persistido.opcoes = campo.opcoes.map((opcao) => opcao.trim()).filter((opcao) => opcao !== '')
    }
    return persistido
  })
}

/** Erro de UM campo do builder — por rótulo e/ou por lista de opções. */
export interface ErroDeCampo {
  rotulo?: string
  opcoes?: string
}

/** A recusa do modelo pela validação de CLIENTE — antes de tocar a rede. */
export interface ErrosDoModelo {
  titulo?: string
  /** Erro do conjunto de campos (nenhum campo, campos demais). */
  geralCampos?: string
  /** Por `_key` do campo. */
  porCampo: Map<number, ErroDeCampo>
}

/**
 * Validação de CLIENTE — feedback imediato espelhando o servidor (que é a autoridade):
 * título obrigatório, ≥1 campo, cada campo com rótulo, `opcoes` não-vazia em `tipo=opcoes`,
 * e os limites. A `id` distinta é garantida por `paraCamposJson`, então não vira erro de tela.
 */
export function validarModelo(titulo: string, campos: CampoEmEdicao[]): ErrosDoModelo {
  const porCampo = new Map<number, ErroDeCampo>()
  const erros: ErrosDoModelo = { porCampo }

  if (titulo.trim() === '') {
    erros.titulo = 'Informe um título para o modelo.'
  }

  if (campos.length === 0) {
    erros.geralCampos = 'Adicione ao menos um campo ao modelo.'
  } else if (campos.length > MAX_CAMPOS) {
    erros.geralCampos = `Um modelo tem no máximo ${MAX_CAMPOS} campos.`
  }

  for (const campo of campos) {
    const doCampo: ErroDeCampo = {}
    if (campo.rotulo.trim() === '') {
      doCampo.rotulo = 'Informe o rótulo do campo.'
    }
    if (campo.tipo === 'opcoes') {
      const validas = campo.opcoes.map((opcao) => opcao.trim()).filter((opcao) => opcao !== '')
      if (validas.length === 0) {
        doCampo.opcoes = 'Campos do tipo opções exigem ao menos uma opção.'
      } else if (validas.length > MAX_OPCOES) {
        doCampo.opcoes = `No máximo ${MAX_OPCOES} opções por campo.`
      }
    }
    if (doCampo.rotulo !== undefined || doCampo.opcoes !== undefined) {
      porCampo.set(campo._key, doCampo)
    }
  }

  return erros
}

/** Há alguma recusa de cliente? (bloqueia o envio) */
export function temErroDeModelo(erros: ErrosDoModelo): boolean {
  return (
    erros.titulo !== undefined || erros.geralCampos !== undefined || erros.porCampo.size > 0
  )
}
