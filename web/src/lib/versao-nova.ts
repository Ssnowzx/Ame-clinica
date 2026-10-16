import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

import { marcarRecargaPorVersaoNova } from '@/lib/preferencias-locais'

/**
 * A VERSÃO NOVA publicada com a página aberta (change indicadores-profissionais, PERF-12/CR-IND-18).
 *
 * As telas carregadas sob demanda (`React.lazy`) pedem pedaços de código com o nome da versão em que
 * a página foi aberta. Depois de um redeploy, o servidor já não tem esses arquivos (404) — e, sem
 * tratamento, a barreira de erro da raiz trocava o sistema inteiro por "Algo deu errado", com um
 * "Tentar novamente" que só repetia o mesmo import rejeitado.
 *
 * O conserto é recarregar a página UMA vez: a recarga traz o `index.html` novo, que aponta para os
 * arquivos novos. "Uma vez" porque, se a página acabou de recarregar e o código ainda não vem, a falha
 * é outra (rede, servidor) e recarregar de novo seria um laço — a guarda é o carimbo na sessão
 * (`marcarRecargaPorVersaoNova`). Dois caminhos levam aqui:
 * - o evento `vite:preloadError`, que o build dispara quando o import (ou o pré-carregamento dele) falha;
 * - a rejeição do `import()` das páginas sob demanda (`paginaSobDemanda`), que cobre o mesmo caso onde
 *   o evento não existe (no desenvolvimento e nos testes).
 */

/** Como a página recarrega e que horas são — injetáveis no teste (o jsdom não navega). */
export interface Recarga {
  recarregar: () => void
  agora: () => number
}

const RECARGA_DO_NAVEGADOR: Recarga = {
  recarregar: () => window.location.reload(),
  agora: () => Date.now(),
}

/**
 * As falhas de carga de código que já gastaram a recarga. A barreira de erro as reconhece e troca o
 * "Tentar novamente" (que repetiria o import rejeitado) por uma recarga pedida pela pessoa.
 */
const FALHAS_DE_CARGA = new WeakSet<object>()

/** O erro que chegou à barreira é uma falha de carga de código (versão velha)? */
export function ehFalhaDeCargaDeCodigo(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && FALHAS_DE_CARGA.has(erro)
}

/**
 * Recarrega a página, se ainda não recarregou por isso agora há pouco.
 * @returns `true` quando a recarga foi pedida; `false` quando a guarda a segurou
 */
export function recarregarUmaVezPorVersaoNova(recarga: Recarga = RECARGA_DO_NAVEGADOR): boolean {
  if (!marcarRecargaPorVersaoNova(recarga.agora())) {
    return false
  }
  recarga.recarregar()

  return true
}

/** O que nunca termina: a página está recarregando, e nada deve pintar o erro no meio dela. */
function aguardarARecarga<T>(): Promise<T> {
  return new Promise<T>(() => undefined)
}

/**
 * Escuta o `vite:preloadError` da janela. Quando a recarga sai, o evento é CANCELADO (`preventDefault`):
 * o build deixa de lançar o erro, e o import devolve vazio — que `paginaSobDemanda` segura até a página
 * recarregar, sem piscar a tela de erro. Quando a guarda segura a recarga, o erro segue seu caminho.
 * @returns A função que desliga a escuta
 */
export function instalarRecargaPorVersaoNova(alvo: Window = window, recarga: Recarga = RECARGA_DO_NAVEGADOR): () => void {
  const aoFalhar = (evento: Event): void => {
    if (recarregarUmaVezPorVersaoNova(recarga)) {
      evento.preventDefault()
    }
  }
  alvo.addEventListener('vite:preloadError', aoFalhar)

  return () => alvo.removeEventListener('vite:preloadError', aoFalhar)
}

/**
 * Uma página sob demanda (`React.lazy`) pelo export NOMEADO (a casa não usa default), que recarrega a
 * página uma vez quando o código dela não vem. Recebe o `import()` CRU: o build o embrulha no
 * pré-carregamento, e o vazio que volta quando o evento foi cancelado é tratado aqui.
 */
export function paginaSobDemanda<M extends Record<K, ComponentType>, K extends keyof M>(
  /** O `import()` cru. Pode resolver VAZIO: é o que o build devolve quando o `vite:preloadError` foi cancelado */
  importar: () => Promise<M | undefined>,
  nome: K,
  recarga: Recarga = RECARGA_DO_NAVEGADOR,
): LazyExoticComponent<M[K]> {
  return lazy(() =>
    importar().then(
      // vazio = o `vite:preloadError` foi cancelado porque a página já está recarregando
      (modulo: M | undefined) => (modulo === undefined ? aguardarARecarga<{ default: M[K] }>() : { default: modulo[nome] }),
      (erro: unknown) => {
        if (recarregarUmaVezPorVersaoNova(recarga)) {
          return aguardarARecarga<{ default: M[K] }>()
        }
        const falha = typeof erro === 'object' && erro !== null ? erro : new Error('Falha ao carregar o código da tela.')
        FALHAS_DE_CARGA.add(falha)
        throw falha
      },
    ),
  )
}
