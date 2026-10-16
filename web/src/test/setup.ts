import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'

import { auditarArmazenamento } from './auditoria-armazenamento'
import { servidor } from './servidor-msw'
import { queryClient } from '@/lib/query-client'
import { useAuthStore } from '@/stores/auth-store'
import { TELA_ABAIXO_DE_LG, TELA_EMPILHADA, TELA_ESTREITA } from '@/lib/breakpoints'

// jsdom não implementa a Pointer Capture API nem o ResizeObserver, exigidos
// pelos primitivos Radix (Toast swipe, Checkbox, DropdownMenu); polyfills
// inertes só para o ambiente de teste.
window.HTMLElement.prototype.hasPointerCapture ??= () => false
window.HTMLElement.prototype.setPointerCapture ??= () => undefined
window.HTMLElement.prototype.releasePointerCapture ??= () => undefined
window.HTMLElement.prototype.scrollIntoView ??= () => undefined

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }))

/**
 * Todo teste é também uma auditoria do disco: nada além de layout pode ter
 * chegado ao `localStorage` (ver `auditarArmazenamento`).
 *
 * A preferência PERSISTE de propósito (sobrevive ao logout) — mas o balcão é
 * máquina compartilhada e os pacientes são MENORES. Limpar sem olhar apagaria a
 * evidência antes de alguém ler; então a suíte fiscaliza o que sobrou e só
 * depois limpa (sem limpar, o painel que um teste recolheu nasceria recolhido no
 * próximo).
 *
 * O teardown roda INTEIRO antes da asserção: auditoria que estourasse no meio da
 * limpeza deixaria o store logado e faria o próximo teste falhar por tabela — uma
 * falha de gate tem que produzir UMA falha legível, não dez.
 */
/**
 * `matchMedia` NÃO existe no jsdom, e o produto passou a depender dele (change
 * agenda-no-celular): a navegação e a agenda trocam de MECANISMO por largura de tela, não só de
 * classe CSS.
 *
 * O padrão é tela LARGA — é como as ~1160 células existentes foram escritas, e mudar o padrão
 * as reprovaria em massa por um motivo que nada tem a ver com o que cada uma prova.
 *
 * Quem exercita tela estreita chama `fingirTelaEstreita(true)` e o `afterEach` devolve ao
 * padrão. Redimensionar `window.innerWidth` NÃO funciona: o `matchMedia` real não olha para ele,
 * e um teste que "passa" assim está provando o mock, não a tela.
 */
let telaEstreita = false
let telaEmpilhada = false
let telaAbaixoDeLg = false

export function fingirTelaEstreita(estreita: boolean): void {
  telaEstreita = estreita
  ouvintes.forEach((ouvinte) => ouvinte())
}

/** A página empilhada (abaixo do `xl`) — a faixa 768–1279, onde a grade fica espremida. */
export function fingirTelaEmpilhada(empilhada: boolean): void {
  telaEmpilhada = empilhada
  ouvintes.forEach((ouvinte) => ouvinte())
}

/** Abaixo do `lg` (1024) — o toast mostra só o mais recente, no topo (change conversa-legivel). */
export function fingirTelaAbaixoDeLg(abaixo: boolean): void {
  telaAbaixoDeLg = abaixo
  ouvintes.forEach((ouvinte) => ouvinte())
}

const ouvintes = new Set<() => void>()

/*
 * O dublê responde pela consulta EXATA, não por `includes('max-width')` (achado do gate).
 *
 * A versão antiga devolvia `!telaEstreita` para toda consulta sem `max-width` — isto é, `true`
 * no padrão. `matchMedia('(prefers-reduced-motion: reduce)').matches` era `true` em todas as
 * ~1200 células, e ninguém tinha pedido isso. Nada dependia disso ainda; era infra compartilhada
 * mentindo para o próximo. E, com duas consultas de `max-width` diferentes, a heurística antiga
 * passou a ser incapaz de distinguir "celular" de "sem espaço para a grade".
 */
window.matchMedia = ((consulta: string) => ({
  matches:
    consulta === TELA_ESTREITA
      ? telaEstreita
      : consulta === TELA_EMPILHADA
        ? telaEmpilhada
        : consulta === TELA_ABAIXO_DE_LG
          ? telaAbaixoDeLg
          : false,
  media: consulta,
  onchange: null,
  addEventListener: (_: string, ouvinte: () => void) => ouvintes.add(ouvinte),
  removeEventListener: (_: string, ouvinte: () => void) => ouvintes.delete(ouvinte),
  addListener: (ouvinte: () => void) => ouvintes.add(ouvinte),
  removeListener: (ouvinte: () => void) => ouvintes.delete(ouvinte),
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

afterEach(() => {
  cleanup() // sem globals:true o auto-cleanup do Testing Library não se registra
  servidor.resetHandlers()
  queryClient.clear() // o cliente é singleton: cada teste começa com cache limpo

  const achados = auditarArmazenamento()

  window.localStorage.clear()
  fingirTelaEstreita(false) // devolve ao padrão: célula que não declara largura roda em tela larga
  fingirTelaEmpilhada(false)
  fingirTelaAbaixoDeLg(false)
  useAuthStore.setState({ usuario: null, carregandoSessao: true })

  expect(achados, `armazenamento local sujo: ${JSON.stringify(achados)}`).toEqual([])
})

afterAll(() => servidor.close())
