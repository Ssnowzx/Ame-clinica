import { ErroDeApi, type MotivoErro } from '@/lib/http'

/**
 * Distribuidor GENÉRICO das recusas do servidor (o de agenda passa a usar este).
 *
 * O Laravel recusa por chave — e nos cadastros essa chave é **indexada**:
 * `responsaveis_json.0.nome`, `contatos_json.2.tipo`. Uma mensagem sobre o
 * terceiro contato que aparece "no formulário" é uma mensagem que a recepcionista
 * não consegue resolver: ela precisa pousar NO ITEM.
 *
 * As chaves vêm do servidor, então o mapa é um `Map` — nunca um objeto literal:
 * `objeto['__proto__'] = '...'` reescreveria o protótipo.
 */

export interface ErrosDoServidor {
  /** Mensagem por chave EXATA do servidor (`cpf`, `responsaveis_json.0.nome`) */
  campos: Map<string, string>
  /** O que não pertence a nenhum campo conhecido — vai para o aviso geral */
  gerais: string[]
  /** O motivo normalizado da recusa — `conflito` liga a ação "Recarregar" */
  motivo?: MotivoErro
}

/**
 * Vazio COMPARTILHADO e congelado: como singleton mutável, um `push` acidental
 * num consumidor contaminaria o estado de todas as telas (parecer code-review §11).
 */
const SEM_ERROS: ErrosDoServidor = Object.freeze({
  campos: new Map<string, string>(),
  gerais: Object.freeze<string[]>([]) as string[],
})

/** O valor de `errors` pode vir como lista, string ou lixo — nada quebra a tela. */
function primeiraMensagem(valor: unknown): string | null {
  if (typeof valor === 'string' && valor !== '') {
    return valor
  }
  if (Array.isArray(valor)) {
    const texto = valor.find((item) => typeof item === 'string' && item !== '')
    return typeof texto === 'string' ? texto : null
  }
  return null
}

/**
 * Separa as recusas entre os campos que a tela conhece e o que sobra.
 *
 * @param erro - Exceção de qualquer origem (só `ErroDeApi` carrega recusa de domínio)
 * @param raizesConhecidas - Campos da tela; `responsaveis_json.0.nome` casa por
 *   `responsaveis_json` (a raiz antes do primeiro ponto)
 * @returns Mensagens por chave e mensagens gerais — nunca ambas vazias quando há recusa
 */
export function distribuirErrosDoServidor(
  erro: unknown,
  raizesConhecidas: ReadonlySet<string>,
): ErrosDoServidor {
  const resultado: ErrosDoServidor = { campos: new Map(), gerais: [] }

  if (erro instanceof ErroDeApi) {
    resultado.motivo = erro.motivo
  }

  if (!(erro instanceof ErroDeApi)) {
    resultado.gerais.push('Não foi possível concluir. Tente novamente.')
    return resultado
  }

  for (const [chave, valor] of Object.entries(erro.camposInvalidos)) {
    const mensagem = primeiraMensagem(valor)
    if (mensagem === null) {
      continue
    }

    const raiz = chave.split('.')[0]
    if (raizesConhecidas.has(raiz)) {
      resultado.campos.set(chave, mensagem)
    } else {
      resultado.gerais.push(mensagem)
    }
  }

  // Recusa sem detalhe (403, rede, 5xx): o usuário precisa ver ALGO
  if (resultado.gerais.length === 0 && resultado.campos.size === 0) {
    resultado.gerais.push(erro.message)
  }

  return resultado
}

/** O estado inicial de erros de qualquer formulário (imutável). */
export function semErros(): ErrosDoServidor {
  return SEM_ERROS
}

/** Erro de um item de lista: `responsaveis_json.0.nome`. */
export function erroDoItem(
  erros: ErrosDoServidor,
  lista: string,
  indice: number,
  campo?: string,
): string | undefined {
  const chave = campo !== undefined ? `${lista}.${indice}.${campo}` : `${lista}.${indice}`
  return erros.campos.get(chave)
}

/** Erro da lista inteira (`responsaveis_json`: "menor exige um responsável"). */
export function erroDaLista(erros: ErrosDoServidor, lista: string): string | undefined {
  return erros.campos.get(lista)
}
